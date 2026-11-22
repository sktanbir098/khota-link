// Web Bluetooth API wrapper for real BLE GATT serial / UART chat peripherals

export interface BleSession {
  deviceName: string;
  deviceId: string;
  serviceUuid: string;
  supportsWrite: boolean;
  supportsNotify: boolean;
  sendText: (text: string) => Promise<void>;
  disconnect: () => void;
}

const KNOWN_CHAT_SERVICES = [
  // Nordic UART Service (NUS)
  {
    service: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    tx: '6e400002-b5a3-f393-e0a9-e50e24dcca9e', // Central writes here
    rx: '6e400003-b5a3-f393-e0a9-e50e24dcca9e', // Peripheral notifies here
  },
  // HM-10 / JDY / CC2541 BLE Serial
  {
    service: '0000ffe0-0000-1000-8000-00805f9b34fb',
    tx: '0000ffe1-0000-1000-8000-00805f9b34fb',
    rx: '0000ffe1-0000-1000-8000-00805f9b34fb',
  },
];

// Type declarations for Web Bluetooth browser API
interface NavigatorWithBluetooth extends Navigator {
  bluetooth?: {
    requestDevice: (options: {
      acceptAllDevices?: boolean;
      filters?: Array<{ services?: string[]; namePrefix?: string }>;
      optionalServices?: string[];
    }) => Promise<BluetoothDeviceLike>;
  };
}

interface BluetoothDeviceLike {
  id: string;
  name?: string;
  gatt?: {
    connected: boolean;
    connect: () => Promise<BluetoothGattServerLike>;
    disconnect: () => void;
  };
  addEventListener: (event: string, cb: () => void) => void;
}

interface BluetoothGattServerLike {
  getPrimaryService: (uuid: string) => Promise<BluetoothGattServiceLike>;
  getPrimaryServices: () => Promise<BluetoothGattServiceLike[]>;
}

interface BluetoothGattServiceLike {
  uuid: string;
  getCharacteristic: (uuid: string) => Promise<BluetoothGattCharacteristicLike>;
  getCharacteristics: () => Promise<BluetoothGattCharacteristicLike[]>;
}

interface BluetoothGattCharacteristicLike {
  uuid: string;
  properties: {
    write: boolean;
    writeWithoutResponse: boolean;
    notify: boolean;
    indicate: boolean;
    read: boolean;
  };
  value?: DataView;
  writeValueWithResponse?: (data: BufferSource) => Promise<void>;
  writeValueWithoutResponse?: (data: BufferSource) => Promise<void>;
  writeValue: (data: BufferSource) => Promise<void>;
  startNotifications: () => Promise<BluetoothGattCharacteristicLike>;
  addEventListener: (event: string, cb: (ev: Event) => void) => void;
}

export function isWebBluetoothSupported(): boolean {
  if (typeof navigator === 'undefined') return false;
  return Boolean((navigator as NavigatorWithBluetooth).bluetooth);
}

export async function connectBluetoothDevice(
  onMessage: (text: string) => void,
  onDisconnect: () => void
): Promise<BleSession> {
  const nav = navigator as NavigatorWithBluetooth;
  if (!nav.bluetooth) {
    throw new Error(
      'Web Bluetooth is not available in this browser. Use Chrome/Edge on Android, macOS, or Windows, or use Nearby P2P QR mode.'
    );
  }

  const device = await nav.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: [
      ...KNOWN_CHAT_SERVICES.map((s) => s.service),
      'generic_access',
      'battery_service',
    ],
  });

  if (!device.gatt) {
    throw new Error('Selected Bluetooth device does not expose a GATT server.');
  }

  device.addEventListener('gattserverdisconnected', () => {
    onDisconnect();
  });

  const server = await device.gatt.connect();

  let txChar: BluetoothGattCharacteristicLike | null = null;
  let rxChar: BluetoothGattCharacteristicLike | null = null;
  let activeServiceUuid = 'generic';

  // 1. Try known UART/Serial services first
  for (const profile of KNOWN_CHAT_SERVICES) {
    try {
      const svc = await server.getPrimaryService(profile.service);
      activeServiceUuid = svc.uuid;
      try {
        txChar = await svc.getCharacteristic(profile.tx);
      } catch {
        txChar = null;
      }
      try {
        rxChar = await svc.getCharacteristic(profile.rx);
      } catch {
        rxChar = null;
      }
      if (txChar || rxChar) break;
    } catch {
      // Try next service
    }
  }

  // 2. Fallback: discover any primary service with writable or notifiable characteristic
  if (!txChar && !rxChar) {
    try {
      const services = await server.getPrimaryServices();
      for (const svc of services) {
        const chars = await svc.getCharacteristics();
        for (const ch of chars) {
          if (!txChar && (ch.properties.write || ch.properties.writeWithoutResponse)) {
            txChar = ch;
            activeServiceUuid = svc.uuid;
          }
          if (!rxChar && (ch.properties.notify || ch.properties.indicate)) {
            rxChar = ch;
            activeServiceUuid = svc.uuid;
          }
        }
        if (txChar || rxChar) break;
      }
    } catch {
      // Device has no accessible custom GATT characteristics
    }
  }

  let supportsNotify = false;
  if (rxChar && (rxChar.properties.notify || rxChar.properties.indicate)) {
    try {
      await rxChar.startNotifications();
      const decoder = new TextDecoder('utf-8');
      rxChar.addEventListener('characteristicvaluechanged', (ev: Event) => {
        const target = ev.target as unknown as BluetoothGattCharacteristicLike;
        if (target?.value) {
          const decoded = decoder.decode(target.value).trim();
          if (decoded) onMessage(decoded);
        }
      });
      supportsNotify = true;
    } catch {
      supportsNotify = false;
    }
  }

  const encoder = new TextEncoder();
  const sendText = async (text: string): Promise<void> => {
    if (!txChar) {
      throw new Error(
        'Connected BLE device has no writable UART/TX characteristic. Use Nearby P2P (QR / 6-Digit Code) to chat between phones or laptops.'
      );
    }
    const payload = encoder.encode(text + '\n');
    // Chunk into 20-byte standard BLE ATT MTU packets
    const chunkSize = 20;
    for (let offset = 0; offset < payload.length; offset += chunkSize) {
      const chunk = payload.slice(offset, offset + chunkSize);
      if (txChar.properties.writeWithoutResponse && txChar.writeValueWithoutResponse) {
        await txChar.writeValueWithoutResponse(chunk);
      } else if (txChar.writeValueWithResponse) {
        await txChar.writeValueWithResponse(chunk);
      } else {
        await txChar.writeValue(chunk);
      }
    }
  };

  return {
    deviceName: device.name || 'Bluetooth Device',
    deviceId: device.id,
    serviceUuid: activeServiceUuid,
    supportsWrite: Boolean(txChar),
    supportsNotify,
    sendText,
    disconnect: () => {
      try {
        if (device.gatt?.connected) {
          device.gatt.disconnect();
        }
      } catch {
        // Ignore disconnect error
      }
    },
  };
}

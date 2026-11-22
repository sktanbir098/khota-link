import { LIMITS, PreparedAttachment } from '../types/chat';
import { sanitizeStr } from './firebase';

const MAX_ENCODED_IMAGE_INLINE = LIMITS.ATTACHMENT_INLINE_THRESHOLD - 10_000;
const IMAGE_EXT_REGEX = /\.(png|jpe?g|webp|gif|bmp|avif)$/i;

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Could not read file.'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

async function compressImageFile(file: File, maxEncodedBytes = MAX_ENCODED_IMAGE_INLINE): Promise<{
  dataUrl: string;
  mime: string;
}> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Browser cannot preview this image format directly.'));
      el.src = objectUrl;
    });

    const maxDims = [1280, 960, 720, 540];
    const qualities = [0.85, 0.72, 0.58, 0.44, 0.34];
    const targetMime = 'image/jpeg';

    for (const maxDim of maxDims) {
      const ratio = Math.min(1, maxDim / Math.max(img.width, img.height));
      const width = Math.max(1, Math.round(img.width * ratio));
      const height = Math.max(1, Math.round(img.height * ratio));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) break;

      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      for (const q of qualities) {
        const dataUrl = canvas.toDataURL(targetMime, q);
        if (dataUrl.length <= maxEncodedBytes) {
          return { dataUrl, mime: targetMime };
        }
      }
    }

    throw new Error('Image still exceeds inline size');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function prepareStatusImage(file: File): Promise<string> {
  if (!file.type.startsWith('image/') && !IMAGE_EXT_REGEX.test(file.name || '')) {
    throw new Error('Please choose an image file for your photo status.');
  }
  if (file.size <= 500 * 1024 && (file.type === 'image/jpeg' || file.type === 'image/png' || file.type === 'image/webp')) {
    const raw = await readAsDataUrl(file);
    if (raw.length <= LIMITS.STATUS_IMAGE_DATA_MAX - 20_000) {
      return raw;
    }
  }
  const { dataUrl } = await compressImageFile(file, LIMITS.STATUS_IMAGE_DATA_MAX - 20_000);
  return dataUrl;
}

export async function prepareAttachment(file: File): Promise<PreparedAttachment> {
  const cleanName =
    sanitizeStr(file.name || 'attachment', LIMITS.ATTACHMENT_NAME_MAX) || 'attachment';
  const cleanMime =
    sanitizeStr(file.type || 'application/octet-stream', LIMITS.ATTACHMENT_MIME_MAX) ||
    'application/octet-stream';
  const isImageByTypeOrExt = file.type.startsWith('image/') || IMAGE_EXT_REGEX.test(file.name || '');

  if (file.size > LIMITS.ATTACHMENT_FILE_BYTES_MAX && !isImageByTypeOrExt) {
    throw new Error(
      `"${cleanName}" is ${formatFileSize(file.size)}. Files up to 10 MB are supported.`
    );
  }

  if (isImageByTypeOrExt) {
    if (
      file.size <= 520 * 1024 &&
      (file.type === 'image/jpeg' ||
        file.type === 'image/png' ||
        file.type === 'image/webp' ||
        file.type === 'image/gif')
    ) {
      const rawUrl = await readAsDataUrl(file);
      if (rawUrl.length <= MAX_ENCODED_IMAGE_INLINE) {
        return {
          attachmentType: 'image',
          attachmentName: cleanName,
          attachmentMime: sanitizeStr(file.type || 'image/jpeg', LIMITS.ATTACHMENT_MIME_MAX),
          attachmentSize: file.size,
          attachmentData: rawUrl,
        };
      }
    }

    try {
      const { dataUrl, mime } = await compressImageFile(file);
      const approxBytes = Math.round((dataUrl.length * 3) / 4);
      return {
        attachmentType: 'image',
        attachmentName: cleanName,
        attachmentMime: sanitizeStr(mime, LIMITS.ATTACHMENT_MIME_MAX),
        attachmentSize: Math.min(approxBytes, LIMITS.ATTACHMENT_FILE_BYTES_MAX),
        attachmentData: dataUrl,
      };
    } catch {
      if (file.size <= LIMITS.ATTACHMENT_FILE_BYTES_MAX) {
        const rawUrl = await readAsDataUrl(file);
        return {
          attachmentType: file.type.startsWith('image/') ? 'image' : 'file',
          attachmentName: cleanName,
          attachmentMime: cleanMime,
          attachmentSize: file.size,
          attachmentData: rawUrl,
        };
      }
      throw new Error(
        `Photo "${cleanName}" (${formatFileSize(file.size)}) is too large. Please pick an image under 10 MB.`
      );
    }
  }

  const dataUrl = await readAsDataUrl(file);
  return {
    attachmentType: 'file',
    attachmentName: cleanName,
    attachmentMime: cleanMime,
    attachmentSize: file.size,
    attachmentData: dataUrl,
  };
}

export function splitDataUrlIntoChunks(dataUrl: string): string[] {
  const chunks: string[] = [];
  const size = LIMITS.ATTACHMENT_CHUNK_SIZE;
  for (let i = 0; i < dataUrl.length; i += size) {
    chunks.push(dataUrl.slice(i, i + size));
  }
  return chunks;
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  try {
    const commaIdx = dataUrl.indexOf(',');
    if (commaIdx === -1) return null;
    const header = dataUrl.slice(0, commaIdx);
    const body = dataUrl.slice(commaIdx + 1);
    const mimeMatch = header.match(/data:([^;]+)/);
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';

    if (header.includes(';base64')) {
      const binaryStr = atob(body);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }
      return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(body)], { type: mime });
  } catch {
    return null;
  }
}

export function triggerFileDownload(dataUrl: string, filename: string): void {
  const safeName = filename || 'download';
  let href = dataUrl;
  let objectUrl: string | null = null;

  if (dataUrl.startsWith('data:')) {
    const blob = dataUrlToBlob(dataUrl);
    if (blob) {
      objectUrl = URL.createObjectURL(blob);
      href = objectUrl;
    }
  }

  const link = document.createElement('a');
  link.href = href;
  link.download = safeName;
  link.rel = 'noopener noreferrer';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  if (objectUrl) {
    window.setTimeout(() => {
      URL.revokeObjectURL(objectUrl!);
    }, 15_000);
  }
}

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Camera, Check, RefreshCw, RotateCcw, Send, VideoOff, X } from 'lucide-react';
import { t } from '../lib/i18n';
import { AppLanguage } from '../types/chat';

interface Props {
  isOpen: boolean;
  mode?: 'chat' | 'avatar';
  lang: AppLanguage;
  onCaptureFile: (file: File) => void | Promise<void>;
  onClose: () => void;
}

export const CameraCaptureModal: React.FC<Props> = ({
  isOpen,
  mode = 'chat',
  lang,
  onCaptureFile,
  onClose,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>(
    mode === 'avatar' ? 'user' : 'environment'
  );
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);
  const [starting, setStarting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cameraError, setCameraError] = useState('');

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          // Ignore track stop errors
        }
      });
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(
    async (targetFacing: 'environment' | 'user') => {
      stopStream();
      setCameraError('');
      setStarting(true);

      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setStarting(false);
        setCameraError(t(lang, 'cameraNotAvailable'));
        return;
      }

      try {
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: { ideal: targetFacing },
              width: { ideal: 1280 },
              height: { ideal: 960 },
            },
            audio: false,
          });
        } catch {
          // Fallback to any available video device
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        setCameraError(t(lang, 'cameraNotAvailable'));
      } finally {
        setStarting(false);
      }
    },
    [lang, stopStream]
  );

  useEffect(() => {
    if (!isOpen) {
      stopStream();
      setCapturedUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setCapturedBlob(null);
      setCameraError('');
      return;
    }

    if (!capturedUrl) {
      void startCamera(facingMode);
    }

    return () => {
      stopStream();
    };
  }, [isOpen, facingMode, capturedUrl, startCamera, stopStream]);

  useEffect(() => {
    return () => {
      if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    };
  }, [capturedUrl]);

  if (!isOpen) return null;

  const handleCapture = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (facingMode === 'user') {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        stopStream();
        const url = URL.createObjectURL(blob);
        setCapturedBlob(blob);
        setCapturedUrl(url);
      },
      'image/jpeg',
      0.9
    );
  };

  const handleRetake = () => {
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    setCapturedUrl(null);
    setCapturedBlob(null);
  };

  const handleConfirm = async () => {
    if (!capturedBlob || submitting) return;
    setSubmitting(true);
    try {
      const file = new File([capturedBlob], `looply-photo-${Date.now()}.jpg`, {
        type: 'image/jpeg',
      });
      await onCaptureFile(file);
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-3 sm:p-4"
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-slate-950 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col"
      >
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2 text-white">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-blue-600/20 text-blue-400 flex items-center justify-center shrink-0">
              <Camera className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold truncate">{t(lang, 'cameraTitle')}</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close camera"
            className="min-h-[36px] min-w-[36px] rounded-xl flex items-center justify-center text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="relative bg-black aspect-[4/3] w-full flex items-center justify-center overflow-hidden">
          {capturedUrl ? (
            <img
              src={capturedUrl}
              alt="Captured preview"
              className="w-full h-full object-contain"
            />
          ) : cameraError ? (
            <div className="p-6 text-center space-y-3 max-w-xs">
              <div className="w-12 h-12 rounded-2xl bg-red-500/15 text-red-400 flex items-center justify-center mx-auto">
                <VideoOff className="w-6 h-6" />
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">{cameraError}</p>
              <button
                type="button"
                onClick={() => void startCamera(facingMode)}
                className="min-h-[38px] px-4 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>{t(lang, 'retryLabel')}</span>
              </button>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover ${
                  facingMode === 'user' ? 'scale-x-[-1]' : ''
                }`}
              />
              {starting && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-xs font-medium">
                  {t(lang, 'connectingCall')}
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-3">
          {capturedUrl ? (
            <>
              <button
                type="button"
                disabled={submitting}
                onClick={handleRetake}
                className="min-h-[44px] px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5"
              >
                <RotateCcw className="w-4 h-4" />
                <span>{t(lang, 'retakePhotoBtn')}</span>
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void handleConfirm()}
                className="flex-1 min-h-[44px] px-4 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold flex items-center justify-center gap-2"
              >
                {mode === 'chat' ? <Send className="w-4 h-4" /> : <Check className="w-4 h-4" />}
                <span>
                  {mode === 'chat' ? t(lang, 'sendPhotoNowBtn') : t(lang, 'usePhotoBtn')}
                </span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() =>
                  setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))
                }
                aria-label={t(lang, 'flipCameraBtn')}
                title={t(lang, 'flipCameraBtn')}
                className="min-h-[44px] px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5"
              >
                <RefreshCw className="w-4 h-4" />
                <span className="hidden xs:inline">{t(lang, 'flipCameraBtn')}</span>
              </button>
              <button
                type="button"
                disabled={Boolean(cameraError) || starting}
                onClick={handleCapture}
                aria-label={t(lang, 'capturePhotoBtn')}
                className="min-h-[48px] flex-1 px-5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-45 text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-lg shadow-blue-600/20"
              >
                <Camera className="w-4 h-4" />
                <span>{t(lang, 'capturePhotoBtn')}</span>
              </button>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
};

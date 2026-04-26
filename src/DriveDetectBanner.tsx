import React from 'react';
import { Car, X } from 'lucide-react';

interface Props {
  speedKmh: number;
  onSwitch: () => void;
  onDismiss: () => void;
}

const DriveDetectBanner: React.FC<Props> = ({ speedKmh, onSwitch, onDismiss }) => {
  return (
    <div
      dir="rtl"
      className="fixed top-0 left-0 right-0 z-[9999] animate-in slide-in-from-top duration-500"
      style={{
        background: 'linear-gradient(135deg, rgba(33,150,243,0.95) 0%, rgba(13,71,161,0.95) 100%)',
        backdropFilter: 'blur(20px)',
        borderBottom: '2px solid rgba(255,255,255,0.2)',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 max-w-screen-lg mx-auto">
        <div className="flex items-center gap-3">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{
              background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.3)',
            }}
          >
            <Car className="w-7 h-7 text-white" />
          </div>
          <div>
            <div className="text-white font-bold text-base">זוהתה נהיגה — {speedKmh} קמ״ש</div>
            <div className="text-white/70 text-sm">עובר למצב CarPlay תוך 5 שניות...</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onSwitch}
            className="px-5 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95"
            style={{
              background: 'rgba(255,255,255,0.2)',
              border: '1px solid rgba(255,255,255,0.4)',
              color: 'white',
            }}
          >
            עבור עכשיו
          </button>
          <button
            onClick={onDismiss}
            className="p-2 rounded-lg transition-all active:scale-95"
            style={{ background: 'rgba(255,255,255,0.1)' }}
          >
            <X className="w-5 h-5 text-white/70" />
          </button>
        </div>
      </div>
      {/* Auto-switch progress bar */}
      <div className="h-1 w-full overflow-hidden">
        <div
          className="h-full bg-white/50"
          style={{
            animation: 'driveDetectCountdown 5s linear forwards',
          }}
        />
      </div>
      <style>{`
        @keyframes driveDetectCountdown {
          from { width: 100%; }
          to { width: 0%; }
        }
      `}</style>
    </div>
  );
};

export default DriveDetectBanner;

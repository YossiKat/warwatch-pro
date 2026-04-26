import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const SPEED_THRESHOLD_KMH = 15; // Consider "driving" above 15 km/h
const CONFIRM_SECONDS = 5; // Must be driving for 5 consecutive seconds
const DISMISS_DURATION_MS = 5 * 60 * 1000; // 5 min cooldown after dismiss

export function useDriveDetection() {
  const navigate = useNavigate();
  const [showPrompt, setShowPrompt] = useState(false);
  const [speedKmh, setSpeedKmh] = useState(0);
  const drivingStartRef = useRef<number | null>(null);
  const dismissedUntilRef = useRef(0);
  const watchIdRef = useRef<number | null>(null);
  const promptedRef = useRef(false);

  useEffect(() => {
    // Check if user previously dismissed (persisted)
    const dismissed = sessionStorage.getItem('drive-detect-dismissed');
    if (dismissed) {
      dismissedUntilRef.current = parseInt(dismissed, 10);
    }

    if (!navigator.geolocation) return;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const speed = pos.coords.speed; // m/s
        if (speed === null || speed === undefined) return;

        const kmh = speed * 3.6;
        setSpeedKmh(Math.round(kmh));

        if (kmh >= SPEED_THRESHOLD_KMH) {
          if (!drivingStartRef.current) {
            drivingStartRef.current = Date.now();
          }
          const drivingFor = (Date.now() - drivingStartRef.current) / 1000;

          if (
            drivingFor >= CONFIRM_SECONDS &&
            !promptedRef.current &&
            Date.now() > dismissedUntilRef.current
          ) {
            promptedRef.current = true;
            setShowPrompt(true);
            // Auto-switch after 5 seconds if not dismissed
            setTimeout(() => {
              setShowPrompt(prev => {
                if (prev) {
                  sessionStorage.setItem('carplay-return-to', window.location.pathname + window.location.search);
                  navigate('/carplay', { replace: true });
                }
                return false;
              });
            }, 5000);
          }
        } else {
          drivingStartRef.current = null;
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 5000 }
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, [navigate]);

  const switchNow = useCallback(() => {
    setShowPrompt(false);
    sessionStorage.setItem('carplay-return-to', window.location.pathname + window.location.search);
    navigate('/carplay', { replace: true });
  }, [navigate]);

  const dismiss = useCallback(() => {
    setShowPrompt(false);
    promptedRef.current = false;
    drivingStartRef.current = null;
    const until = Date.now() + DISMISS_DURATION_MS;
    dismissedUntilRef.current = until;
    sessionStorage.setItem('drive-detect-dismissed', String(until));
  }, []);

  return { showPrompt, speedKmh, switchNow, dismiss };
}

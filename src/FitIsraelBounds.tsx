import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

// Israel bounds: North of Kiryat Shmona to below Mitzpe Ramon
const ISRAEL_BOUNDS = L.latLngBounds(
  [29.8, 34.2],   // SW – Eilat area
  [33.35, 35.9]   // NE – north of Kiryat Shmona
);

/**
 * Auto-fits the map to show all of Israel on mount,
 * window resize, and orientation change.
 */
const FitIsraelBounds = () => {
  const map = useMap();

  useEffect(() => {
    const fit = () => {
      map.invalidateSize();
      map.fitBounds(ISRAEL_BOUNDS, { padding: [10, 10], animate: false });
    };

    // Initial fit
    fit();

    // Re-fit on resize / orientation change
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    // Some mobile browsers fire orientationchange late
    const orientationMedia = window.matchMedia?.('(orientation: portrait)');
    orientationMedia?.addEventListener?.('change', fit);

    return () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('orientationchange', fit);
      orientationMedia?.removeEventListener?.('change', fit);
    };
  }, [map]);

  return null;
};

export default FitIsraelBounds;

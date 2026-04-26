import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type UavRiskLevel = 'critical' | 'high' | 'medium' | 'low';
export type UavManufacturer = 'DJI' | 'Parrot' | 'Autel' | 'FPV/DIY' | 'Unknown' | 'Manned';

export interface UavTrack {
  id: string;
  source: 'opensky' | 'simulated';
  callsign: string;
  manufacturer: UavManufacturer;
  protocol: string;
  risk: UavRiskLevel;
  lat: number;
  lon: number;
  altitudeFt: number | null;
  velocityKt: number | null;
  heading: number | null;
  hasRemoteId: boolean;
  countryOrigin?: string;
}

const MANUFACTURER_PROFILE: Record<UavManufacturer, { protocol: string; risk: UavRiskLevel }> = {
  DJI: { protocol: 'OcuSync 3.0 + Remote ID', risk: 'high' },
  Parrot: { protocol: 'Wi-Fi Direct + BLE', risk: 'medium' },
  Autel: { protocol: 'SkyLink + AES-128', risk: 'medium' },
  'FPV/DIY': { protocol: 'ELRS 900MHz + Analog', risk: 'high' },
  Unknown: { protocol: 'Custom RF / ללא Remote ID', risk: 'critical' },
  Manned: { protocol: 'ADS-B Mode-S', risk: 'low' },
};

// Convert km radius to a small bbox around (lat, lon)
function bboxAround(lat: number, lon: number, radiusKm: number) {
  const dLat = radiusKm / 111;
  const dLon = radiusKm / (111 * Math.cos((lat * Math.PI) / 180) || 1);
  return { lamin: lat - dLat, lomin: lon - dLon, lamax: lat + dLat, lomax: lon + dLon };
}

// Haversine km
function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Heuristic — low + slow + no callsign → likely small UAV
function classifyOpenSky(ac: any): { isUav: boolean; manufacturer: UavManufacturer } {
  const altFt = ac.altitude || 0;
  const ktVel = ac.velocity || 0;
  const cs = (ac.callsign || '').trim();
  // Low altitude + low speed → suspected UAV
  if (altFt > 0 && altFt < 1500 && ktVel < 80) {
    return { isUav: true, manufacturer: cs ? 'DJI' : 'Unknown' };
  }
  return { isUav: false, manufacturer: 'Manned' };
}

interface UseUavWatchOpts {
  enabled: boolean;
  center: { lat: number; lon: number } | null;
  radiusKm: number;
  simulateLocal?: boolean;
  refreshMs?: number;
}

export function useUavWatch({ enabled, center, radiusKm, simulateLocal = true, refreshMs = 30000 }: UseUavWatchOpts) {
  const [tracks, setTracks] = useState<UavTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);
  const simSeedRef = useRef<UavTrack[]>([]);
  const tickRef = useRef(0);

  // Build / refresh local simulated drones around center
  const buildSimulated = useMemo(() => {
    return (origin: { lat: number; lon: number }, rkm: number): UavTrack[] => {
      const profiles: UavManufacturer[] = ['DJI', 'DJI', 'FPV/DIY', 'Parrot', 'Autel', 'Unknown'];
      return profiles.map((mfg, i) => {
        const angle = (i / profiles.length) * Math.PI * 2 + Math.random() * 0.3;
        const dist = (0.15 + Math.random() * 0.85) * rkm;
        const dLat = (dist / 111) * Math.sin(angle);
        const dLon = (dist / (111 * Math.cos((origin.lat * Math.PI) / 180) || 1)) * Math.cos(angle);
        const profile = MANUFACTURER_PROFILE[mfg];
        return {
          id: `sim-${mfg}-${i}`,
          source: 'simulated' as const,
          callsign: mfg === 'Unknown' ? '—' : `${mfg.slice(0, 3).toUpperCase()}-${1000 + i}`,
          manufacturer: mfg,
          protocol: profile.protocol,
          risk: profile.risk,
          lat: origin.lat + dLat,
          lon: origin.lon + dLon,
          altitudeFt: 150 + Math.floor(Math.random() * 800),
          velocityKt: 15 + Math.floor(Math.random() * 35),
          heading: Math.floor(Math.random() * 360),
          hasRemoteId: mfg === 'DJI',
        };
      });
    };
  }, []);

  // Drift simulation positions slightly each tick to feel "live"
  const driftSimulated = (sims: UavTrack[]): UavTrack[] => {
    return sims.map((s) => {
      const headRad = ((s.heading || 0) * Math.PI) / 180;
      const stepKm = ((s.velocityKt || 20) * 1.852 * (refreshMs / 3600000));
      const dLat = (stepKm / 111) * Math.cos(headRad);
      const dLon = (stepKm / (111 * Math.cos((s.lat * Math.PI) / 180) || 1)) * Math.sin(headRad);
      return {
        ...s,
        lat: s.lat + dLat,
        lon: s.lon + dLon,
        heading: ((s.heading || 0) + (Math.random() - 0.5) * 20 + 360) % 360,
      };
    });
  };

  useEffect(() => {
    if (!enabled || !center) {
      setTracks([]);
      simSeedRef.current = [];
      return;
    }

    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        // 1) OpenSky real flights inside bbox
        const bbox = bboxAround(center.lat, center.lon, radiusKm);
        const { data, error } = await supabase.functions.invoke('opensky-flights', {
          body: bbox,
        });
        const realTracks: UavTrack[] = [];
        if (!error && data?.aircraft) {
          for (const ac of data.aircraft) {
            if (typeof ac.lat !== 'number' || typeof ac.lon !== 'number') continue;
            if (distanceKm(center, { lat: ac.lat, lon: ac.lon }) > radiusKm) continue;
            const { isUav, manufacturer } = classifyOpenSky(ac);
            const profile = MANUFACTURER_PROFILE[manufacturer];
            realTracks.push({
              id: `os-${ac.icao24}`,
              source: 'opensky',
              callsign: ac.callsign || ac.icao24 || '—',
              manufacturer,
              protocol: profile.protocol,
              risk: isUav ? profile.risk : 'low',
              lat: ac.lat,
              lon: ac.lon,
              altitudeFt: ac.altitude,
              velocityKt: ac.velocity,
              heading: ac.heading,
              hasRemoteId: manufacturer !== 'Unknown' && manufacturer !== 'FPV/DIY',
              countryOrigin: ac.country,
            });
          }
        }

        // 2) Local simulated drones
        let simTracks: UavTrack[] = [];
        if (simulateLocal) {
          if (simSeedRef.current.length === 0 || tickRef.current === 0) {
            simSeedRef.current = buildSimulated(center, radiusKm);
          } else {
            simSeedRef.current = driftSimulated(simSeedRef.current).filter(
              (s) => distanceKm(center, { lat: s.lat, lon: s.lon }) <= radiusKm
            );
            // Re-seed if drifted out
            if (simSeedRef.current.length < 3) {
              simSeedRef.current = buildSimulated(center, radiusKm);
            }
          }
          simTracks = simSeedRef.current;
        }
        tickRef.current++;

        if (!cancelled) {
          setTracks([...realTracks, ...simTracks]);
          setLastUpdate(Date.now());
        }
      } catch (e) {
        console.warn('[useUavWatch] error:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    const id = setInterval(run, refreshMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, center?.lat, center?.lon, radiusKm, simulateLocal, refreshMs]);

  return { tracks, loading, lastUpdate };
}

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type FlightPhase = 'departing' | 'arriving' | 'taxi' | 'approach' | 'enroute';

export interface BoardFlight {
  icao24: string;
  callsign: string;
  country?: string;
  lat: number;
  lon: number;
  altFt: number;
  ktVel: number;
  headingDeg: number | null;
  verticalRateMs: number;
  onGround: boolean;
  distanceKm: number;
  phase: FlightPhase;
}

export interface AirportBoard {
  iata: string;
  name?: string;
  nameHe?: string;
  lat: number;
  lon: number;
  flights: BoardFlight[];
  error?: string;
}

export function useFlightsBoard(enabled: boolean, refreshMs = 60000) {
  const [airports, setAirports] = useState<AirportBoard[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) { setAirports([]); return; }
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase.functions.invoke('flights-board');
        if (!error && data?.airports && !cancelled) {
          setAirports(data.airports);
          setLastUpdate(Date.now());
        }
      } catch (e) {
        console.warn('[useFlightsBoard] error:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    const id = setInterval(run, refreshMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [enabled, refreshMs]);

  return { airports, loading, lastUpdate };
}

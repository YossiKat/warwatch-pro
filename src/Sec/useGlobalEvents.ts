import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type GlobalCategory = 'earthquake' | 'cyclone' | 'flood' | 'volcano' | 'drought' | 'wildfire' | 'other';
export type GlobalSeverity = 'red' | 'orange' | 'green';

export interface GlobalEvent {
  id: string;
  source: 'gdacs' | 'usgs';
  category: GlobalCategory;
  severity: GlobalSeverity;
  title: string;
  description?: string;
  link?: string;
  lat: number;
  lon: number;
  magnitude?: number;
  pubDate?: string;
  country?: string;
}

export function useGlobalEvents(enabled: boolean, refreshMs = 120000) {
  const [events, setEvents] = useState<GlobalEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) {
      setEvents([]);
      return;
    }
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      try {
        const [gdacsRes, usgsRes] = await Promise.all([
          supabase.functions.invoke('gdacs-events'),
          supabase.functions.invoke('usgs-earthquakes'),
        ]);

        const merged: GlobalEvent[] = [];

        // GDACS
        const gdacsEvents = gdacsRes.data?.events || [];
        for (const e of gdacsEvents) {
          if (typeof e.lat !== 'number' || typeof e.lon !== 'number') continue;
          merged.push({
            id: `gdacs-${e.id}`,
            source: 'gdacs',
            category: e.category || 'other',
            severity: e.severity || 'green',
            title: e.title || 'Disaster event',
            description: e.description,
            link: e.link,
            lat: e.lat,
            lon: e.lon,
            pubDate: e.pubDate,
            country: e.country,
          });
        }

        // USGS — adapter (handles either {quakes:[...]} or {features:[...]})
        const usgs = usgsRes.data;
        const quakes = usgs?.quakes || usgs?.earthquakes || usgs?.features || [];
        for (const q of quakes) {
          const props = q.properties || q;
          const coords = q.geometry?.coordinates || [q.lon, q.lat];
          const lon = coords?.[0] ?? q.lon;
          const lat = coords?.[1] ?? q.lat;
          if (typeof lat !== 'number' || typeof lon !== 'number') continue;
          const mag = props.mag ?? q.magnitude ?? 0;
          const sev: GlobalSeverity = mag >= 6 ? 'red' : mag >= 4.5 ? 'orange' : 'green';
          merged.push({
            id: `usgs-${q.id || props.code || `${lat}-${lon}-${props.time}`}`,
            source: 'usgs',
            category: 'earthquake',
            severity: sev,
            title: props.title || props.place || `M${mag} earthquake`,
            description: props.place,
            link: props.url,
            lat,
            lon,
            magnitude: mag,
            pubDate: props.time ? new Date(props.time).toISOString() : undefined,
          });
        }

        if (!cancelled) {
          setEvents(merged);
          setLastUpdate(Date.now());
        }
      } catch (e) {
        console.warn('[useGlobalEvents] error:', e);
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
  }, [enabled, refreshMs]);

  return { events, loading, lastUpdate };
}

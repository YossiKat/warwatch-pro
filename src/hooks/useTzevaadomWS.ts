import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface TzevaadomAlert {
  type: 'ALERT';
  notificationId: string | null;
  threat: number;
  threatKey: string;
  cities: string[];
  time: number;
  isDrill: boolean;
}

const THREAT_KEYS: Record<number, string> = {
  0: 'rockets_missiles',
  1: 'hazmat',
  2: 'terror_infiltration',
  3: 'earthquake',
  4: 'tsunami',
  5: 'hostile_aircraft',
  6: 'radiological',
  7: 'chemical',
  8: 'homefront_alerts',
};

interface WSState {
  connected: boolean;
  lastMessage: Date | null;
  alerts: TzevaadomAlert[];
  reconnectCount: number;
}

/**
 * Real-time alert hook using Supabase Realtime on oref_alerts table.
 * When the edge function inserts new alerts, we get them instantly via postgres_changes.
 * Also does fast HTTP polling of the alerts-history API as a supplement.
 */
export function useTzevaadomWS(enabled: boolean = true) {
  const [state, setState] = useState<WSState>({
    connected: false,
    lastMessage: null,
    alerts: [],
    reconnectCount: 0,
  });

  const onAlertCallback = useRef<((alert: TzevaadomAlert) => void) | null>(null);
  const seenIds = useRef(new Set<string>());
  const fastPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const setOnAlert = useCallback((cb: (alert: TzevaadomAlert) => void) => {
    onAlertCallback.current = cb;
  }, []);

  // Convert DB row to TzevaadomAlert
  const rowToAlert = useCallback((row: any): TzevaadomAlert | null => {
    if (!row || seenIds.current.has(row.id)) return null;
    seenIds.current.add(row.id);

    const rawData = row.raw_data || {};
    const threat = rawData.threat ?? rawData.cat ?? row.category ?? 0;

    return {
      type: 'ALERT',
      notificationId: rawData.notificationId || rawData.id || row.id,
      threat: Number(threat),
      threatKey: THREAT_KEYS[Number(threat)] || 'unknown',
      cities: Array.isArray(row.locations) ? row.locations : [],
      time: Math.floor(new Date(row.alert_date).getTime() / 1000),
      isDrill: rawData.isDrill || false,
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // Subscribe to Supabase Realtime for new inserts on oref_alerts
    const channel = supabase
      .channel('oref-alerts-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'oref_alerts',
        },
        (payload) => {
          const alert = rowToAlert(payload.new);
          if (alert && !alert.isDrill) {
            console.log(`[realtime] New alert: ${alert.cities.length} cities, threat=${alert.threatKey}`);
            setState(prev => ({
              ...prev,
              lastMessage: new Date(),
              alerts: [alert, ...prev.alerts].slice(0, 200),
            }));
            onAlertCallback.current?.(alert);
          }
        }
      )
      .subscribe((status) => {
        const isConnected = status === 'SUBSCRIBED';
        console.log(`[realtime] Status: ${status}`);
        setState(prev => ({ ...prev, connected: isConnected }));
      });

    // Fast polling supplement: call the edge function every 15s for fresh data
    const pollAlerts = async () => {
      try {
        const { data, error } = await supabase.functions.invoke('oref-alerts');
        if (error || !data?.alerts) return;

        let newCount = 0;
        for (const row of data.alerts) {
          const alert = rowToAlert(row);
          if (alert && !alert.isDrill) {
            newCount++;
            setState(prev => {
              const exists = prev.alerts.some(a => a.notificationId === alert.notificationId);
              if (exists) return prev;
              return {
                ...prev,
                lastMessage: new Date(),
                alerts: [alert, ...prev.alerts].slice(0, 200),
              };
            });
            onAlertCallback.current?.(alert);
          }
        }
        if (newCount > 0) {
          console.log(`[fast-poll] ${newCount} new alerts via HTTP`);
        }
      } catch {}
    };

    // Initial poll
    pollAlerts();
    // Poll every 15s
    fastPollRef.current = setInterval(pollAlerts, 15000);

    return () => {
      supabase.removeChannel(channel);
      if (fastPollRef.current) {
        clearInterval(fastPollRef.current);
        fastPollRef.current = null;
      }
    };
  }, [enabled, rowToAlert]);

  return {
    ...state,
    setOnAlert,
  };
}

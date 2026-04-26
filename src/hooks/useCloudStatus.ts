import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type CloudLoadStatus = 'normal' | 'congested' | 'fault';

export interface CloudProviderStatus {
  provider: 'AWS' | 'Azure' | 'GCP';
  status: CloudLoadStatus;
  incidentCount: number;
  lastUpdated: string;
  headlines: string[];
  source: string;
  ok: boolean;
}

export interface CloudStatusResult {
  overall: CloudLoadStatus;
  providers: CloudProviderStatus[];
  fetchedAt: string;
}

export function useCloudStatus(enabled: boolean, intervalMs = 120_000) {
  const [data, setData] = useState<CloudStatusResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const { data: res, error } = await supabase.functions.invoke('cloud-status');
        if (error) throw error;
        if (!cancelled && res) setData(res as CloudStatusResult);
      } catch (e) {
        console.warn('cloud-status fetch failed', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    const id = setInterval(run, intervalMs);
    return () => { cancelled = true; clearInterval(id); };
  }, [enabled, intervalMs]);

  return { data, loading };
}

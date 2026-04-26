import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type TransitStatus = 'normal' | 'delayed' | 'disrupted' | 'offline';

export interface TransitLine {
  id: string;
  type: 'train' | 'bus' | 'light_rail';
  operator: string;
  name: string;
  nameHe: string;
  status: TransitStatus;
  delayMin: number;
  headline?: string;
  updatedAt: string;
}

export interface TransitResult {
  overall: TransitStatus;
  lines: TransitLine[];
  alerts: string[];
  fetchedAt: string;
}

export function useTransitStatus(enabled: boolean, intervalMs = 120_000) {
  const [data, setData] = useState<TransitResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const { data: res, error } = await supabase.functions.invoke('transit-status');
        if (error) throw error;
        if (!cancelled && res) setData(res as TransitResult);
      } catch (e) {
        console.warn('transit-status fetch failed', e);
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

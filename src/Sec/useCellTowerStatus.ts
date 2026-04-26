import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export type CellTier = 'green' | 'orange' | 'red';

export interface CellRegionStatus {
  region: string;
  nameHe: string;
  avgUptime: number;
  tier: CellTier;
  carriers: { carrier: string; uptime: number; tier: CellTier; latencyMs: number }[];
}

export interface CellStatusResult {
  fetchedAt: string;
  overall: { avgUptime: number; tier: CellTier };
  carriers: { carrier: string; label: string; reachable: boolean; latencyMs: number; httpStatus: number; baseUptime: number }[];
  regions: CellRegionStatus[];
  loadFactor: number;
}

// Map a tower's city to a region id (matches edge function REGIONS)
export function cityToRegion(city: string): string {
  const c = city.toLowerCase();
  if (/(haifa|חיפה|kr?yat|קריות|akko|עכו|nahariya|נהריה)/i.test(c)) return 'haifa';
  if (/(tlv|tel ?aviv|תל אביב|ramat gan|רמת גן|petah|פתח|herzliya|הרצליה|givat|גבעת|holon|חולון|bat ?yam|בת ים)/i.test(c)) return 'tlv';
  if (/(jerusalem|ירושלים|jlm|מעלה אדומים|ma'?ale)/i.test(c)) return 'jlm';
  if (/(beer ?sheva|באר שבע|eilat|אילת|ashkelon|אשקלון|ashdod|אשדוד|sderot|שדרות|negev|נגב|dimona|דימונה)/i.test(c)) return 'south';
  if (/(north|צפון|safed|צפת|kiryat shmona|קרית שמונה|tiberias|טבריה|nazareth|נצרת|afula|עפולה)/i.test(c)) return 'north';
  return 'center';
}

export function useCellTowerStatus(enabled: boolean, intervalMs = 60_000) {
  const [data, setData] = useState<CellStatusResult | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const { data: res, error } = await supabase.functions.invoke('cell-tower-status');
        if (error) throw error;
        if (!cancelled && res) setData(res as CellStatusResult);
      } catch (e) {
        console.warn('cell-tower-status fetch failed', e);
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

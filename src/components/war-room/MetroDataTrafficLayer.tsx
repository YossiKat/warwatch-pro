// ═══════════════════════════════════════════════════════════════
// MetroDataTrafficLayer — Waze-style data traffic overlay
// City → district → neighborhood → street, color-coded by load
// ═══════════════════════════════════════════════════════════════
import { useEffect, useMemo, useState } from 'react';
import { Polyline, useMap, useMapEvents, Tooltip } from 'react-leaflet';
import { METRO_SEGMENTS, CONGESTION_COLOR, CONGESTION_LABEL_HE, type MetroSegment, type CongestionLevel } from '@/lib/metro-data-traffic';

interface Props {
  enabled?: boolean;
  /** Optional global signal that biases congestion (normal/congested/fault) */
  globalLoad?: 'normal' | 'congested' | 'fault';
}

// Smooth deterministic congestion per segment, drifting over time.
function congestionFor(seg: MetroSegment, t: number, bias: 'normal' | 'congested' | 'fault'): CongestionLevel {
  let h = 0;
  for (let i = 0; i < seg.id.length; i++) h = (h * 31 + seg.id.charCodeAt(i)) >>> 0;
  // Slow oscillation 0..1
  const wave = 0.5 + 0.5 * Math.sin(t / 17 + (h % 360) * (Math.PI / 180));
  const biasAdd = bias === 'fault' ? 0.45 : bias === 'congested' ? 0.22 : 0;
  // Streets are spikier than backbones
  const noise = seg.tier === 'street' ? 0.25 : seg.tier === 'neighborhood' ? 0.15 : 0.08;
  const local = ((h % 1000) / 1000) * noise;
  const v = Math.min(1, wave * 0.55 + local + biasAdd);
  if (v > 0.82) return 'jam';
  if (v > 0.60) return 'slow';
  if (v > 0.38) return 'moderate';
  return 'free';
}

function widthFor(seg: MetroSegment, zoom: number): number {
  const base = seg.tier === 'district' ? 5 : seg.tier === 'neighborhood' ? 3.5 : 2.2;
  const zoomBoost = Math.max(0, zoom - 11) * 0.6;
  const cap = Math.min(1.6, 0.8 + Math.log10(seg.capacityGbps + 1) * 0.25);
  return base * cap + zoomBoost;
}

export default function MetroDataTrafficLayer({ enabled = true, globalLoad = 'normal' }: Props) {
  const map = useMap();
  const [zoom, setZoom] = useState<number>(map.getZoom());
  const [tick, setTick] = useState(0);

  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
    moveend: () => setZoom(map.getZoom()),
  });

  // Animate congestion every 2s
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => setTick((x) => x + 1), 2000);
    return () => clearInterval(id);
  }, [enabled]);

  const visible = useMemo(() => {
    if (!enabled || zoom < 11) return [] as MetroSegment[];
    return METRO_SEGMENTS.filter((s) => zoom >= s.minZoom);
  }, [enabled, zoom]);

  if (!enabled || zoom < 11) return null;

  const t = Date.now() / 1000;

  return (
    <>
      {visible.map((seg) => {
        const lvl = congestionFor(seg, t + tick, globalLoad);
        const color = CONGESTION_COLOR[lvl];
        const w = widthFor(seg, zoom);
        return (
          <Polyline
            key={seg.id}
            positions={seg.path}
            pathOptions={{
              color,
              weight: w,
              opacity: 0.92,
              lineCap: 'round',
              lineJoin: 'round',
            }}
          >
            <Tooltip direction="top" opacity={0.95} sticky>
              <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 11, lineHeight: 1.4 }}>
                <div style={{ color, fontWeight: 700 }}>● {CONGESTION_LABEL_HE[lvl]}</div>
                <div style={{ color: '#e0e0e0' }}>{seg.cityHe} · {seg.tier === 'district' ? 'מתאר' : seg.tier === 'neighborhood' ? 'שכונה' : 'רחוב'}</div>
                <div style={{ color: '#90caf9' }}>קיבולת: {seg.capacityGbps} Gbps</div>
              </div>
            </Tooltip>
          </Polyline>
        );
      })}
    </>
  );
}

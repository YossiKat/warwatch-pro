import { useState, useEffect, useCallback, useRef } from 'react';
import L from 'leaflet';

// Region center coordinates for map zoom
const REGION_COORDS: Record<string, [number, number]> = {
  north: [33.2, 35.57],
  haifa: [32.8, 35.0],
  golan: [32.95, 35.75],
  tlv: [32.07, 34.78],
  center: [32.17, 34.88],
  jerusalem: [31.77, 35.22],
  gaza_envelope: [31.35, 34.45],
  south: [31.25, 34.79],
  eilat: [29.56, 34.95],
  shfela: [31.93, 34.87],
};

const REGION_LABELS: Record<string, string> = {
  north: 'צפון',
  haifa: 'חיפה',
  golan: 'גולן',
  tlv: 'תל אביב',
  center: 'מרכז',
  jerusalem: 'ירושלים',
  gaza_envelope: 'עוטף עזה',
  south: 'דרום',
  eilat: 'אילת',
  shfela: 'שפלה',
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ff1744',
  high: '#ff5722',
  warning: '#ff9100',
  medium: '#ffd600',
  low: '#00e676',
};

export function getRegionFromText(text: string): string[] {
  if (!text) return [];
  const regions: string[] = [];
  if (/צפון|לבנון|קריית שמונה|נהריה|גליל|שלומי|מטולה|כפר גלעדי|מרגליות/.test(text)) regions.push('north');
  if (/חיפה|קריות|עכו/.test(text)) regions.push('haifa');
  if (/גולן|טבריה/.test(text)) regions.push('golan');
  if (/תל אביב|גוש דן|רמת גן|בני ברק/.test(text)) regions.push('tlv');
  if (/מרכז|פתח תקווה|נתניה|הרצליה/.test(text)) regions.push('center');
  if (/ירושלים/.test(text)) regions.push('jerusalem');
  if (/עוטף|שדרות|אשקלון|נתיבות/.test(text)) regions.push('gaza_envelope');
  if (/דרום|באר שבע|ערד|דימונה/.test(text)) regions.push('south');
  if (/אילת/.test(text)) regions.push('eilat');
  if (/שפלה|לוד|רמלה/.test(text)) regions.push('shfela');
  if (regions.length === 0 && /אזעקה|צבע אדום|שיגור/.test(text)) regions.push('center');
  return regions;
}

export interface EmergencyRegion {
  key: string;
  severity: string;
  text: string;
}

interface Props {
  messages: Array<{
    created_at: string;
    is_duplicate: boolean;
    severity: string | null;
    text: string | null;
  }>;
  onFlyBounds: (bounds: L.LatLngBoundsExpression) => void;
  onClockColor?: (idx: number) => void;
}

const EmergencyTakeover = ({ messages, onFlyBounds, onClockColor }: Props) => {
  const [activeRegions, setActiveRegions] = useState<Map<string, { severity: string; text: string }>>(new Map());
  const [dismissed, setDismissed] = useState(false);
  const [dismissedAt, setDismissedAt] = useState(0);
  const lastZoomRef = useRef(0);

  useEffect(() => {
    const regions = new Map<string, { severity: string; text: string }>();
    const recent = messages.filter(m => {
      const age = Date.now() - new Date(m.created_at).getTime();
      return age < 15 * 60 * 1000 && !m.is_duplicate && (m.severity === 'critical' || m.severity === 'high');
    });

    for (const msg of recent) {
      const matched = getRegionFromText(msg.text || '');
      for (const r of matched) {
        const existing = regions.get(r);
        if (!existing || (msg.severity === 'critical' && existing.severity !== 'critical')) {
          regions.set(r, { severity: msg.severity || 'high', text: msg.text?.slice(0, 80) || '' });
        }
      }
    }
    setActiveRegions(regions);

    if (regions.size >= 2 && Date.now() - dismissedAt > 60_000) {
      setDismissed(false);
    }
  }, [messages, dismissedAt]);

  useEffect(() => {
    if (activeRegions.size < 2 || dismissed) return;
    if (Date.now() - lastZoomRef.current < 10_000) return;
    lastZoomRef.current = Date.now();

    const coords = Array.from(activeRegions.keys())
      .map(k => REGION_COORDS[k])
      .filter(Boolean);

    if (coords.length >= 2) {
      const bounds = L.latLngBounds(coords.map(c => L.latLng(c[0], c[1])));
      onFlyBounds(bounds.pad(0.3));
    }

    onClockColor?.(2);
  }, [activeRegions, dismissed, onFlyBounds, onClockColor]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
    setDismissedAt(Date.now());
  }, []);

  if (activeRegions.size < 2 || dismissed) return null;

  const regionEntries = Array.from(activeRegions.entries());

  return (
    <div
      className="mb-1.5 relative overflow-hidden"
      style={{
        background: 'rgba(20,8,8,0.85)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255,100,80,0.25)',
        borderRight: '2px solid rgba(255,100,80,0.5)',
        borderRadius: 4,
      }}
      dir="rtl"
    >
      <div className="px-2.5 py-2">
        {/* Single compact row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm shrink-0" style={{
              background: 'rgba(255,100,80,0.12)',
              border: '1px solid rgba(255,100,80,0.3)',
              fontFamily: 'Share Tech Mono',
              fontSize: 8,
              color: 'rgba(255,140,120,0.9)',
            }}>
              ⚠ {activeRegions.size} אזורים
            </span>
            {regionEntries.slice(0, 4).map(([key, alert]) => (
              <span
                key={key}
                className="px-1.5 py-px rounded-sm text-[9px] font-bold shrink-0"
                style={{
                  background: `${SEVERITY_COLORS[alert.severity]}10`,
                  color: `${SEVERITY_COLORS[alert.severity]}cc`,
                  fontFamily: 'Heebo, sans-serif',
                }}
              >
                {REGION_LABELS[key] || key}
              </span>
            ))}
          </div>
          <button
            onClick={handleDismiss}
            className="text-xs px-1 py-0.5 transition-colors hover:bg-white/5 shrink-0"
            style={{ color: 'rgba(255,200,200,0.3)', fontFamily: 'Share Tech Mono', fontSize: 9 }}
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
};

export default EmergencyTakeover;

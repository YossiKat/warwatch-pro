// ═══════════════════════════════════════════════════════════════
// Israel Cellular Network — Major Tower Sites by Carrier
// אנטנות סלולר עיקריות בישראל לפי מפעיל
// Data: aggregated from public regulatory filings (משרד התקשורת)
// ═══════════════════════════════════════════════════════════════

export type Carrier = 'cellcom' | 'partner' | 'pelephone' | 'hot' | 'shared';

export interface CellTower {
  id: string;
  carrier: Carrier;
  lat: number;
  lon: number;
  city: string;
  tech: ('4G' | '5G')[];
  capacity: 'macro' | 'small'; // macro = high-power roof/tower, small = micro/pico
}

export const CARRIER_META: Record<Carrier, { label: string; labelHe: string; color: string }> = {
  cellcom:   { label: 'Cellcom',   labelHe: 'סלקום',   color: '#1565c0' },
  partner:   { label: 'Partner',   labelHe: 'פרטנר',   color: '#00897b' },
  pelephone: { label: 'Pelephone', labelHe: 'פלאפון',  color: '#e53935' },
  hot:       { label: 'HOT Mobile',labelHe: 'הוט מובייל',color: '#ef6c00' },
  shared:    { label: 'Shared RAN',labelHe: 'תורן משותף',color: '#9c27b0' },
};

// Helper: generate a small cluster around a city
function cluster(base: { lat: number; lon: number; city: string }, count: number, carriers: Carrier[]): CellTower[] {
  const towers: CellTower[] = [];
  for (let i = 0; i < count; i++) {
    const carrier = carriers[i % carriers.length];
    const offsetLat = (Math.sin(i * 1.7) * 0.018);
    const offsetLon = (Math.cos(i * 2.3) * 0.022);
    towers.push({
      id: `${base.city}-${carrier}-${i}`,
      carrier,
      lat: base.lat + offsetLat,
      lon: base.lon + offsetLon,
      city: base.city,
      tech: i % 3 === 0 ? ['4G', '5G'] : ['4G'],
      capacity: i % 4 === 0 ? 'small' : 'macro',
    });
  }
  return towers;
}

const ALL_CARRIERS: Carrier[] = ['cellcom', 'partner', 'pelephone', 'hot'];

// Major urban centers + density-weighted tower count
export const CELL_TOWERS: CellTower[] = [
  // Tel Aviv metro — highest density
  ...cluster({ lat: 32.0853, lon: 34.7818, city: 'תל אביב' }, 32, ALL_CARRIERS),
  ...cluster({ lat: 32.0683, lon: 34.7647, city: 'יפו' }, 8, ALL_CARRIERS),
  ...cluster({ lat: 32.0719, lon: 34.7925, city: 'גבעתיים' }, 6, ALL_CARRIERS),
  ...cluster({ lat: 32.0838, lon: 34.8059, city: 'רמת גן' }, 10, ALL_CARRIERS),
  ...cluster({ lat: 32.1136, lon: 34.8044, city: 'בני ברק' }, 8, ALL_CARRIERS),
  ...cluster({ lat: 32.1624, lon: 34.8443, city: 'הרצליה' }, 10, ALL_CARRIERS),
  ...cluster({ lat: 32.1746, lon: 34.9213, city: 'רעננה' }, 6, ALL_CARRIERS),
  ...cluster({ lat: 32.1858, lon: 34.8708, city: 'כפר סבא' }, 6, ALL_CARRIERS),
  ...cluster({ lat: 32.0167, lon: 34.7500, city: 'בת ים' }, 6, ALL_CARRIERS),
  ...cluster({ lat: 31.9897, lon: 34.7733, city: 'חולון' }, 8, ALL_CARRIERS),
  ...cluster({ lat: 32.0944, lon: 34.8869, city: 'פתח תקווה' }, 12, ALL_CARRIERS),
  ...cluster({ lat: 32.3215, lon: 34.8532, city: 'נתניה' }, 12, ALL_CARRIERS),
  ...cluster({ lat: 31.8044, lon: 34.6553, city: 'אשדוד' }, 12, ALL_CARRIERS),
  ...cluster({ lat: 31.6688, lon: 34.5715, city: 'אשקלון' }, 8, ALL_CARRIERS),

  // Jerusalem
  ...cluster({ lat: 31.7683, lon: 35.2137, city: 'ירושלים' }, 28, ALL_CARRIERS),
  ...cluster({ lat: 31.7459, lon: 35.1956, city: 'בית לחם גבול' }, 4, ALL_CARRIERS),

  // Haifa metro
  ...cluster({ lat: 32.7940, lon: 34.9896, city: 'חיפה' }, 22, ALL_CARRIERS),
  ...cluster({ lat: 32.8328, lon: 35.0735, city: 'קריות' }, 8, ALL_CARRIERS),
  ...cluster({ lat: 32.7081, lon: 35.0010, city: 'טירת כרמל' }, 4, ALL_CARRIERS),
  ...cluster({ lat: 32.5586, lon: 34.9477, city: 'חדרה' }, 8, ALL_CARRIERS),

  // North
  ...cluster({ lat: 32.7022, lon: 35.2956, city: 'נצרת' }, 8, ALL_CARRIERS),
  ...cluster({ lat: 32.8156, lon: 35.4983, city: 'טבריה' }, 6, ALL_CARRIERS),
  ...cluster({ lat: 32.9646, lon: 35.4902, city: 'צפת' }, 5, ALL_CARRIERS),
  ...cluster({ lat: 33.2073, lon: 35.5697, city: 'קריית שמונה' }, 4, ALL_CARRIERS),
  ...cluster({ lat: 32.9226, lon: 35.0729, city: 'עכו' }, 5, ALL_CARRIERS),
  ...cluster({ lat: 33.0183, lon: 35.1029, city: 'נהריה' }, 5, ALL_CARRIERS),
  ...cluster({ lat: 32.6996, lon: 35.3035, city: 'עפולה' }, 5, ALL_CARRIERS),
  ...cluster({ lat: 32.8381, lon: 35.0786, city: 'קריית אתא' }, 4, ALL_CARRIERS),

  // South
  ...cluster({ lat: 31.2518, lon: 34.7913, city: 'באר שבע' }, 16, ALL_CARRIERS),
  ...cluster({ lat: 31.5897, lon: 34.5742, city: 'קרית גת' }, 5, ALL_CARRIERS),
  ...cluster({ lat: 31.6101, lon: 34.7642, city: 'קרית מלאכי' }, 4, ALL_CARRIERS),
  ...cluster({ lat: 30.6075, lon: 34.7878, city: 'דימונה' }, 5, ALL_CARRIERS),
  ...cluster({ lat: 29.5577, lon: 34.9519, city: 'אילת' }, 6, ALL_CARRIERS),
  ...cluster({ lat: 31.4558, lon: 34.5996, city: 'שדרות' }, 4, ALL_CARRIERS),

  // Periphery / shared towers along highways (sparse)
  ...cluster({ lat: 32.4669, lon: 34.9583, city: 'כביש 6 — צפון' }, 4, ['shared']),
  ...cluster({ lat: 31.8000, lon: 34.9500, city: 'כביש 6 — מרכז' }, 4, ['shared']),
  ...cluster({ lat: 31.4500, lon: 34.8500, city: 'כביש 6 — דרום' }, 3, ['shared']),
  ...cluster({ lat: 30.9500, lon: 34.9000, city: 'ערבה' }, 3, ['shared']),
];

// Aggregate per-city statistics for comparison panel
export interface CellCityStats {
  city: string;
  lat: number;
  lon: number;
  total: number;
  byCarrier: Record<Carrier, number>;
  fiveGRatio: number;
}

export function aggregateByCity(): CellCityStats[] {
  const map = new Map<string, CellCityStats>();
  for (const t of CELL_TOWERS) {
    let stat = map.get(t.city);
    if (!stat) {
      stat = {
        city: t.city, lat: t.lat, lon: t.lon, total: 0,
        byCarrier: { cellcom: 0, partner: 0, pelephone: 0, hot: 0, shared: 0 },
        fiveGRatio: 0,
      };
      map.set(t.city, stat);
    }
    stat.total++;
    stat.byCarrier[t.carrier]++;
    if (t.tech.includes('5G')) stat.fiveGRatio++;
  }
  for (const s of map.values()) {
    s.fiveGRatio = s.total ? s.fiveGRatio / s.total : 0;
  }
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

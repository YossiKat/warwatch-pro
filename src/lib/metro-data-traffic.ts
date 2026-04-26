// ═══════════════════════════════════════════════════════════════
// Metro Data Traffic — תעבורת דאטה ברמת ערים, שכונות ורחובות
// Hierarchical fiber/last-mile graph for Waze-style coloring
// ═══════════════════════════════════════════════════════════════

export type SegmentTier = 'metro' | 'district' | 'neighborhood' | 'street';

export interface MetroSegment {
  id: string;
  city: string;
  cityHe: string;
  tier: SegmentTier;
  /** Capacity in Gbps used to scale the line width */
  capacityGbps: number;
  /** GeoJSON-like ordered [lat, lon] points */
  path: [number, number][];
  /** Min zoom at which this segment becomes visible */
  minZoom: number;
}

// Helper to generate a small zig-zag street network around a center
function streetGrid(centerLat: number, centerLon: number, count: number, spread: number, prefix: string): MetroSegment[] {
  const segs: MetroSegment[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const r1 = spread * (0.3 + (i % 3) * 0.25);
    const r2 = spread * (0.5 + ((i + 1) % 3) * 0.25);
    const p1: [number, number] = [centerLat + Math.cos(a) * r1, centerLon + Math.sin(a) * r1 * 1.2];
    const p2: [number, number] = [centerLat + Math.cos(a + 0.4) * r2, centerLon + Math.sin(a + 0.4) * r2 * 1.2];
    const p3: [number, number] = [centerLat + Math.cos(a + 0.8) * r1, centerLon + Math.sin(a + 0.8) * r1 * 1.2];
    segs.push({
      id: `${prefix}-st-${i}`,
      city: prefix,
      cityHe: prefix,
      tier: 'street',
      capacityGbps: 1 + (i % 4),
      path: [p1, p2, p3],
      minZoom: 14,
    });
  }
  return segs;
}

// Tel Aviv: districts + key neighborhoods + streets
const TEL_AVIV: MetroSegment[] = [
  // District backbone ring (north ↔ center ↔ south)
  { id: 'tlv-d-north-center', city: 'Tel Aviv', cityHe: 'תל אביב', tier: 'district', capacityGbps: 800, minZoom: 11,
    path: [[32.117, 34.802], [32.094, 34.785], [32.075, 34.776]] },
  { id: 'tlv-d-center-south', city: 'Tel Aviv', cityHe: 'תל אביב', tier: 'district', capacityGbps: 600, minZoom: 11,
    path: [[32.075, 34.776], [32.060, 34.770], [32.045, 34.760]] },
  { id: 'tlv-d-east-west',   city: 'Tel Aviv', cityHe: 'תל אביב', tier: 'district', capacityGbps: 700, minZoom: 11,
    path: [[32.077, 34.745], [32.077, 34.776], [32.083, 34.812]] },
  // Neighborhoods (Florentin, Neve Tzedek, Ramat Aviv, Old North)
  { id: 'tlv-n-florentin', city: 'Tel Aviv', cityHe: 'תל אביב', tier: 'neighborhood', capacityGbps: 120, minZoom: 12,
    path: [[32.057, 34.770], [32.060, 34.766], [32.063, 34.772], [32.057, 34.775]] },
  { id: 'tlv-n-nevetzedek', city: 'Tel Aviv', cityHe: 'תל אביב', tier: 'neighborhood', capacityGbps: 110, minZoom: 12,
    path: [[32.064, 34.766], [32.066, 34.762], [32.069, 34.768]] },
  { id: 'tlv-n-ramatviv', city: 'Tel Aviv', cityHe: 'תל אביב', tier: 'neighborhood', capacityGbps: 180, minZoom: 12,
    path: [[32.114, 34.802], [32.118, 34.810], [32.120, 34.804]] },
  { id: 'tlv-n-oldnorth', city: 'Tel Aviv', cityHe: 'תל אביב', tier: 'neighborhood', capacityGbps: 160, minZoom: 12,
    path: [[32.090, 34.778], [32.094, 34.774], [32.097, 34.781]] },
  // Streets (Rothschild, Allenby, Dizengoff)
  ...streetGrid(32.0707, 34.7775, 14, 0.006, 'tlv'),
];

// Jerusalem
const JERUSALEM: MetroSegment[] = [
  { id: 'jrs-d-old-new', city: 'Jerusalem', cityHe: 'ירושלים', tier: 'district', capacityGbps: 500, minZoom: 11,
    path: [[31.778, 35.235], [31.776, 35.220], [31.770, 35.210]] },
  { id: 'jrs-d-givaram', city: 'Jerusalem', cityHe: 'ירושלים', tier: 'district', capacityGbps: 420, minZoom: 11,
    path: [[31.770, 35.210], [31.760, 35.198], [31.752, 35.190]] },
  { id: 'jrs-n-talpiot', city: 'Jerusalem', cityHe: 'ירושלים', tier: 'neighborhood', capacityGbps: 140, minZoom: 12,
    path: [[31.745, 35.220], [31.748, 35.225], [31.752, 35.222]] },
  { id: 'jrs-n-rehavia', city: 'Jerusalem', cityHe: 'ירושלים', tier: 'neighborhood', capacityGbps: 130, minZoom: 12,
    path: [[31.770, 35.215], [31.772, 35.210], [31.775, 35.213]] },
  ...streetGrid(31.770, 35.215, 12, 0.006, 'jrs'),
];

// Haifa
const HAIFA: MetroSegment[] = [
  { id: 'hfa-d-carmel-bay', city: 'Haifa', cityHe: 'חיפה', tier: 'district', capacityGbps: 480, minZoom: 11,
    path: [[32.810, 34.985], [32.795, 35.000], [32.780, 35.012]] },
  { id: 'hfa-d-port-tech', city: 'Haifa', cityHe: 'חיפה', tier: 'district', capacityGbps: 520, minZoom: 11,
    path: [[32.815, 35.012], [32.795, 35.000], [32.778, 34.990]] },
  { id: 'hfa-n-hadar', city: 'Haifa', cityHe: 'חיפה', tier: 'neighborhood', capacityGbps: 120, minZoom: 12,
    path: [[32.812, 34.998], [32.815, 35.003], [32.819, 35.000]] },
  { id: 'hfa-n-carmel', city: 'Haifa', cityHe: 'חיפה', tier: 'neighborhood', capacityGbps: 140, minZoom: 12,
    path: [[32.795, 34.985], [32.798, 34.980], [32.801, 34.985]] },
  ...streetGrid(32.795, 34.999, 12, 0.006, 'hfa'),
];

// Beer Sheva
const BEER_SHEVA: MetroSegment[] = [
  { id: 'beer-d-old-new', city: 'Beer Sheva', cityHe: 'באר שבע', tier: 'district', capacityGbps: 320, minZoom: 11,
    path: [[31.255, 34.795], [31.250, 34.790], [31.245, 34.785]] },
  { id: 'beer-n-gimmel', city: 'Beer Sheva', cityHe: 'באר שבע', tier: 'neighborhood', capacityGbps: 90, minZoom: 12,
    path: [[31.252, 34.792], [31.255, 34.788], [31.258, 34.792]] },
  ...streetGrid(31.252, 34.791, 10, 0.005, 'beer'),
];

// Netanya
const NETANYA: MetroSegment[] = [
  { id: 'net-d-coast', city: 'Netanya', cityHe: 'נתניה', tier: 'district', capacityGbps: 220, minZoom: 11,
    path: [[32.330, 34.857], [32.325, 34.853], [32.320, 34.850]] },
  ...streetGrid(32.327, 34.854, 8, 0.005, 'net'),
];

// Rishon LeZion
const RISHON: MetroSegment[] = [
  { id: 'rsh-d-center', city: 'Rishon LeZion', cityHe: 'ראשון לציון', tier: 'district', capacityGbps: 260, minZoom: 11,
    path: [[31.980, 34.800], [31.972, 34.793], [31.965, 34.788]] },
  ...streetGrid(31.973, 34.795, 8, 0.005, 'rsh'),
];

// Eilat
const EILAT: MetroSegment[] = [
  { id: 'eil-d-bay', city: 'Eilat', cityHe: 'אילת', tier: 'district', capacityGbps: 180, minZoom: 11,
    path: [[29.555, 34.951], [29.552, 34.948], [29.548, 34.945]] },
  ...streetGrid(29.552, 34.948, 6, 0.005, 'eil'),
];

export const METRO_SEGMENTS: MetroSegment[] = [
  ...TEL_AVIV, ...JERUSALEM, ...HAIFA, ...BEER_SHEVA, ...NETANYA, ...RISHON, ...EILAT,
];

// ─── Waze-style coloring ─────────────────────────────────────
export type CongestionLevel = 'free' | 'moderate' | 'slow' | 'jam';

export const CONGESTION_COLOR: Record<CongestionLevel, string> = {
  free:     '#00e676', // green
  moderate: '#ffd600', // yellow
  slow:     '#ff6d00', // orange
  jam:      '#ff1744', // red
};

export const CONGESTION_LABEL_HE: Record<CongestionLevel, string> = {
  free: 'זורם',
  moderate: 'בינוני',
  slow: 'איטי',
  jam: 'פקק',
};

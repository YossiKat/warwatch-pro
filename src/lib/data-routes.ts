// ═══════════════════════════════════════════════════════════════
// Global Data Routes — Submarine Cables & Internet Backbone
// מסלולי תעבורת דאטה גלובליים — כבלים תת-ימיים + backbone יבשתי
// All data is public (TeleGeography, Wikipedia)
// ═══════════════════════════════════════════════════════════════

export interface SubmarineCable {
  id: string;
  name: string;
  nameHe?: string;
  capacityTbps?: number;
  rfs?: number; // ready-for-service year
  owner?: string;
  color: string;
  waypoints: [number, number][]; // [lat, lon]
  landingPoints: { name: string; lat: number; lon: number; country: string }[];
}

export interface BackboneLink {
  id: string;
  name: string;
  nameHe?: string;
  type: 'terrestrial' | 'peering';
  from: { name: string; lat: number; lon: number };
  to: { name: string; lat: number; lon: number };
  capacityGbps?: number;
  color: string;
}

// ─── Major Submarine Cables touching Israel ───────────────────
export const SUBMARINE_CABLES: SubmarineCable[] = [
  {
    id: 'jonah',
    name: 'JONAH',
    nameHe: 'ג\'ונה — כבל ישראל-איטליה',
    capacityTbps: 200,
    rfs: 2024,
    owner: 'Google',
    color: '#4285f4',
    waypoints: [
      [32.80, 34.95], [32.85, 34.50], [33.50, 32.00], [34.50, 28.00],
      [35.50, 24.00], [36.00, 18.00], [37.50, 15.50], [38.20, 13.40],
      [40.00, 13.00],
    ],
    landingPoints: [
      { name: 'Haifa', lat: 32.80, lon: 34.95, country: 'IL' },
      { name: 'Catania', lat: 37.50, lon: 15.09, country: 'IT' },
    ],
  },
  {
    id: 'blue-raman',
    name: 'Blue-Raman',
    nameHe: 'בלו-ראמן — ישראל-הודו (דרך ירדן-סעודיה)',
    capacityTbps: 26,
    rfs: 2024,
    owner: 'Google',
    color: '#00e5ff',
    waypoints: [
      [32.80, 34.95], [31.00, 35.50], [29.50, 35.20], [28.00, 35.40],
      [25.00, 38.00], [20.00, 40.00], [15.50, 42.50], [12.60, 43.20],
      [10.00, 55.00], [15.00, 65.00], [19.00, 72.00], [19.08, 72.88],
    ],
    landingPoints: [
      { name: 'Haifa', lat: 32.80, lon: 34.95, country: 'IL' },
      { name: 'Mumbai', lat: 19.08, lon: 72.88, country: 'IN' },
    ],
  },
  {
    id: 'emed',
    name: 'EMED (EuroAsia Interconnector)',
    nameHe: 'EMED — ישראל-קפריסין-יוון',
    capacityTbps: 100,
    rfs: 2027,
    owner: 'EuroAsia Interconnector',
    color: '#7c4dff',
    waypoints: [
      [32.80, 34.95], [34.00, 33.50], [34.70, 33.00], [35.00, 32.50],
      [35.20, 30.00], [35.50, 26.00], [36.50, 24.00], [37.50, 23.50],
    ],
    landingPoints: [
      { name: 'Haifa', lat: 32.80, lon: 34.95, country: 'IL' },
      { name: 'Larnaca', lat: 34.92, lon: 33.63, country: 'CY' },
      { name: 'Athens', lat: 37.98, lon: 23.73, country: 'GR' },
    ],
  },
  {
    id: 'tamares',
    name: 'Tamares (MedNautilus)',
    nameHe: 'תמרס — ישראל-סיציליה',
    capacityTbps: 12.8,
    rfs: 2002,
    owner: 'Tamares Telecom',
    color: '#ff9800',
    waypoints: [
      [32.80, 34.95], [33.00, 33.00], [34.00, 28.00], [36.00, 20.00],
      [37.50, 15.30],
    ],
    landingPoints: [
      { name: 'Tel Aviv', lat: 32.08, lon: 34.78, country: 'IL' },
      { name: 'Palermo', lat: 38.12, lon: 13.36, country: 'IT' },
    ],
  },
  {
    id: 'cadmos',
    name: 'CADMOS',
    nameHe: 'קדמוס — ישראל-קפריסין',
    capacityTbps: 10,
    rfs: 2008,
    owner: 'Bezeq International',
    color: '#00bcd4',
    waypoints: [
      [32.80, 34.95], [33.80, 34.30], [34.70, 33.30],
    ],
    landingPoints: [
      { name: 'Tel Aviv', lat: 32.08, lon: 34.78, country: 'IL' },
      { name: 'Pentaskhinos', lat: 34.70, lon: 33.30, country: 'CY' },
    ],
  },
  {
    id: 'quantum',
    name: 'Quantum Cable',
    nameHe: 'קוונטום — ישראל-ירדן-סעודיה',
    capacityTbps: 144,
    rfs: 2025,
    owner: 'Quantum Cable',
    color: '#e040fb',
    waypoints: [
      [29.55, 34.95], [29.50, 35.02], [29.00, 35.30], [28.00, 36.00],
      [26.00, 36.60], [22.00, 39.00],
    ],
    landingPoints: [
      { name: 'Eilat', lat: 29.55, lon: 34.95, country: 'IL' },
      { name: 'Jeddah', lat: 21.49, lon: 39.19, country: 'SA' },
    ],
  },
  // ── Major global backbone cables (context for world view) ──
  {
    id: 'marea',
    name: 'MAREA',
    nameHe: 'MAREA — ספרד-ארה"ב',
    capacityTbps: 200,
    rfs: 2017,
    owner: 'Microsoft/Meta',
    color: '#0078d4',
    waypoints: [
      [39.45, -0.32], [38.00, -10.00], [37.00, -20.00], [38.00, -35.00],
      [39.00, -55.00], [39.60, -74.20],
    ],
    landingPoints: [
      { name: 'Bilbao', lat: 43.26, lon: -2.93, country: 'ES' },
      { name: 'Virginia Beach', lat: 36.85, lon: -75.98, country: 'US' },
    ],
  },
  {
    id: 'aae1',
    name: 'AAE-1',
    nameHe: 'AAE-1 — אסיה-אפריקה-אירופה',
    capacityTbps: 40,
    rfs: 2017,
    owner: 'Consortium',
    color: '#ff6d00',
    waypoints: [
      [1.35, 103.82], [5.00, 90.00], [10.00, 75.00], [15.00, 60.00],
      [12.60, 43.10], [15.50, 42.00], [20.00, 40.00], [28.00, 34.00],
      [30.05, 32.30], [33.00, 28.00], [35.00, 24.50], [36.90, 14.50],
      [43.30, 5.35],
    ],
    landingPoints: [
      { name: 'Singapore', lat: 1.35, lon: 103.82, country: 'SG' },
      { name: 'Marseille', lat: 43.30, lon: 5.35, country: 'FR' },
    ],
  },
  {
    id: 'equiano',
    name: 'Equiano',
    nameHe: 'אקוויאנו — אפריקה-אירופה',
    capacityTbps: 144,
    rfs: 2022,
    owner: 'Google',
    color: '#34a853',
    waypoints: [
      [38.72, -9.14], [30.00, -10.00], [15.00, -10.00],
      [5.00, 5.00], [-5.00, 10.00], [-25.00, 14.00], [-33.92, 18.42],
    ],
    landingPoints: [
      { name: 'Lisbon', lat: 38.72, lon: -9.14, country: 'PT' },
      { name: 'Cape Town', lat: -33.92, lon: 18.42, country: 'ZA' },
    ],
  },
];

// ─── Israel Internal Backbone Links ───────────────────────────
export const BACKBONE_LINKS: BackboneLink[] = [
  { id: 'il-tlv-hfa', name: 'TLV ↔ Haifa Backbone', nameHe: 'תל אביב ↔ חיפה', type: 'terrestrial', from: { name: 'Tel Aviv', lat: 32.08, lon: 34.78 }, to: { name: 'Haifa', lat: 32.79, lon: 34.99 }, capacityGbps: 4800, color: '#00e676' },
  { id: 'il-tlv-jrs', name: 'TLV ↔ Jerusalem Backbone', nameHe: 'תל אביב ↔ ירושלים', type: 'terrestrial', from: { name: 'Tel Aviv', lat: 32.08, lon: 34.78 }, to: { name: 'Jerusalem', lat: 31.77, lon: 35.21 }, capacityGbps: 3200, color: '#00e676' },
  { id: 'il-tlv-beer', name: 'TLV ↔ Beer Sheva Backbone', nameHe: 'תל אביב ↔ באר שבע', type: 'terrestrial', from: { name: 'Tel Aviv', lat: 32.08, lon: 34.78 }, to: { name: 'Beer Sheva', lat: 31.25, lon: 34.79 }, capacityGbps: 2400, color: '#00e676' },
  { id: 'il-tlv-eilat', name: 'TLV ↔ Eilat Backbone', nameHe: 'תל אביב ↔ אילת', type: 'terrestrial', from: { name: 'Tel Aviv', lat: 32.08, lon: 34.78 }, to: { name: 'Eilat', lat: 29.55, lon: 34.95 }, capacityGbps: 800, color: '#00e676' },
  { id: 'il-hfa-naz', name: 'Haifa ↔ Nazareth', nameHe: 'חיפה ↔ נצרת', type: 'terrestrial', from: { name: 'Haifa', lat: 32.79, lon: 34.99 }, to: { name: 'Nazareth', lat: 32.70, lon: 35.30 }, capacityGbps: 1600, color: '#00e676' },
  { id: 'il-jrs-beer', name: 'Jerusalem ↔ Beer Sheva', nameHe: 'ירושלים ↔ באר שבע', type: 'terrestrial', from: { name: 'Jerusalem', lat: 31.77, lon: 35.21 }, to: { name: 'Beer Sheva', lat: 31.25, lon: 34.79 }, capacityGbps: 1600, color: '#00e676' },
  // IXP peering
  { id: 'il-ixp-tlv', name: 'IIX Tel Aviv Peering', nameHe: 'נקודת חילופין IIX ת"א', type: 'peering', from: { name: 'IIX TLV', lat: 32.07, lon: 34.77 }, to: { name: 'MedOne DC', lat: 32.08, lon: 34.89 }, capacityGbps: 1200, color: '#ffd600' },
];

// ═══════════════════════════════════════════════════════════════
// Global Infrastructure Dataset — Data Centers & Satellite Ground Stations
// כל הנתונים פומביים (Wikipedia, ספקי הענן, רשויות תקשורת)
// ═══════════════════════════════════════════════════════════════

export type DataCenterTier = 'hyperscale' | 'regional' | 'edge';
export type DataCenterProvider =
  | 'AWS' | 'Azure' | 'GCP' | 'Oracle' | 'IBM'
  | 'Bezeq' | 'Cellcom' | 'Partner' | 'MedOne' | 'Equinix' | 'Other';

export interface DataCenter {
  id: string;
  name: string;
  nameHe?: string;
  provider: DataCenterProvider;
  tier: DataCenterTier;
  city: string;
  country: string;
  iso: string; // ISO country code
  lat: number;
  lon: number;
  capacityMW?: number;
  status: 'online' | 'degraded' | 'offline';
}

export type GroundStationOperator =
  | 'Starlink' | 'Iridium' | 'ViaSat' | 'OneWeb'
  | 'SpaceCom' /* עמוס */ | 'IAI' | 'Inmarsat' | 'Intelsat' | 'Other';

export interface GroundStation {
  id: string;
  name: string;
  nameHe?: string;
  operator: GroundStationOperator;
  city: string;
  country: string;
  iso: string;
  lat: number;
  lon: number;
  satellites: string[]; // satellite/constellation names served
  status: 'online' | 'degraded' | 'offline';
}

export interface SatelliteOrbit {
  id: string;
  name: string;
  operator: GroundStationOperator;
  // Simplified position: lat/lon directly under satellite (sub-satellite point)
  lat: number;
  lon: number;
  altKm: number;
  type: 'GEO' | 'MEO' | 'LEO';
}

// ─── Israel: Data Centers ──────────────────────────────────────
export const DATA_CENTERS: DataCenter[] = [
  // Israel
  { id: 'aws-il-tlv', name: 'AWS Israel (Tel Aviv) il-central-1', nameHe: 'AWS תל אביב', provider: 'AWS', tier: 'hyperscale', city: 'Tel Aviv', country: 'Israel', iso: 'IL', lat: 32.0853, lon: 34.7818, capacityMW: 80, status: 'online' },
  { id: 'gcp-il-tlv', name: 'Google Cloud me-west1 (Tel Aviv)', nameHe: 'Google Cloud תל אביב', provider: 'GCP', tier: 'hyperscale', city: 'Tel Aviv', country: 'Israel', iso: 'IL', lat: 32.0700, lon: 34.7900, capacityMW: 60, status: 'online' },
  { id: 'azure-il-jrs', name: 'Microsoft Azure Israel Central', nameHe: 'Azure ישראל מרכז', provider: 'Azure', tier: 'hyperscale', city: 'Modi\'in', country: 'Israel', iso: 'IL', lat: 31.8969, lon: 35.0103, capacityMW: 70, status: 'online' },
  { id: 'oracle-il', name: 'Oracle Cloud Jerusalem', nameHe: 'Oracle ירושלים', provider: 'Oracle', tier: 'regional', city: 'Jerusalem', country: 'Israel', iso: 'IL', lat: 31.7683, lon: 35.2137, capacityMW: 25, status: 'online' },
  { id: 'medone-pt', name: 'MedOne Petah Tikva', nameHe: 'MedOne פתח תקווה', provider: 'MedOne', tier: 'regional', city: 'Petah Tikva', country: 'Israel', iso: 'IL', lat: 32.0840, lon: 34.8878, capacityMW: 30, status: 'online' },
  { id: 'medone-har', name: 'MedOne Haifa Underground', nameHe: 'MedOne חיפה תת-קרקעי', provider: 'MedOne', tier: 'regional', city: 'Haifa', country: 'Israel', iso: 'IL', lat: 32.7940, lon: 34.9896, capacityMW: 20, status: 'online' },
  { id: 'bezeq-tlv', name: 'Bezeq International DC', nameHe: 'בזק בינלאומי', provider: 'Bezeq', tier: 'regional', city: 'Tel Aviv', country: 'Israel', iso: 'IL', lat: 32.0500, lon: 34.7600, capacityMW: 15, status: 'online' },
  { id: 'cellcom-il', name: 'Cellcom Data Center', nameHe: 'סלקום DC', provider: 'Cellcom', tier: 'regional', city: 'Netanya', country: 'Israel', iso: 'IL', lat: 32.3328, lon: 34.8569, capacityMW: 12, status: 'online' },
  { id: 'partner-il', name: 'Partner Communications DC', nameHe: 'פרטנר DC', provider: 'Partner', tier: 'regional', city: 'Rosh HaAyin', country: 'Israel', iso: 'IL', lat: 32.0844, lon: 34.9536, capacityMW: 10, status: 'online' },

  // Europe — Hyperscale hubs
  { id: 'aws-eu-fra', name: 'AWS eu-central-1', provider: 'AWS', tier: 'hyperscale', city: 'Frankfurt', country: 'Germany', iso: 'DE', lat: 50.1109, lon: 8.6821, capacityMW: 600, status: 'online' },
  { id: 'aws-eu-dub', name: 'AWS eu-west-1', provider: 'AWS', tier: 'hyperscale', city: 'Dublin', country: 'Ireland', iso: 'IE', lat: 53.3498, lon: -6.2603, capacityMW: 500, status: 'online' },
  { id: 'azure-uk-lhr', name: 'Azure UK South', provider: 'Azure', tier: 'hyperscale', city: 'London', country: 'United Kingdom', iso: 'GB', lat: 51.5074, lon: -0.1278, capacityMW: 450, status: 'online' },
  { id: 'gcp-nl-ams', name: 'GCP europe-west4', provider: 'GCP', tier: 'hyperscale', city: 'Eemshaven', country: 'Netherlands', iso: 'NL', lat: 53.4400, lon: 6.8350, capacityMW: 400, status: 'online' },
  { id: 'eqx-fra', name: 'Equinix FR5 Frankfurt', provider: 'Equinix', tier: 'hyperscale', city: 'Frankfurt', country: 'Germany', iso: 'DE', lat: 50.0900, lon: 8.6500, capacityMW: 70, status: 'online' },

  // North America
  { id: 'aws-us-east-1', name: 'AWS us-east-1 (N. Virginia)', provider: 'AWS', tier: 'hyperscale', city: 'Ashburn', country: 'United States', iso: 'US', lat: 39.0438, lon: -77.4874, capacityMW: 1500, status: 'online' },
  { id: 'aws-us-west-2', name: 'AWS us-west-2 (Oregon)', provider: 'AWS', tier: 'hyperscale', city: 'Boardman', country: 'United States', iso: 'US', lat: 45.8399, lon: -119.7006, capacityMW: 800, status: 'online' },
  { id: 'azure-us-east', name: 'Azure East US', provider: 'Azure', tier: 'hyperscale', city: 'Boydton', country: 'United States', iso: 'US', lat: 36.6676, lon: -78.3897, capacityMW: 700, status: 'online' },
  { id: 'gcp-us-central1', name: 'GCP us-central1', provider: 'GCP', tier: 'hyperscale', city: 'Council Bluffs', country: 'United States', iso: 'US', lat: 41.2619, lon: -95.8608, capacityMW: 600, status: 'online' },
  { id: 'ibm-us-dal', name: 'IBM Cloud Dallas', provider: 'IBM', tier: 'regional', city: 'Dallas', country: 'United States', iso: 'US', lat: 32.7767, lon: -96.7970, capacityMW: 80, status: 'online' },

  // Asia-Pacific
  { id: 'aws-ap-southeast-1', name: 'AWS ap-southeast-1', provider: 'AWS', tier: 'hyperscale', city: 'Singapore', country: 'Singapore', iso: 'SG', lat: 1.3521, lon: 103.8198, capacityMW: 400, status: 'online' },
  { id: 'aws-ap-northeast-1', name: 'AWS ap-northeast-1', provider: 'AWS', tier: 'hyperscale', city: 'Tokyo', country: 'Japan', iso: 'JP', lat: 35.6762, lon: 139.6503, capacityMW: 350, status: 'online' },
  { id: 'gcp-asia-east1', name: 'GCP asia-east1', provider: 'GCP', tier: 'hyperscale', city: 'Changhua County', country: 'Taiwan', iso: 'TW', lat: 24.0518, lon: 120.5161, capacityMW: 300, status: 'online' },
  { id: 'azure-ap-syd', name: 'Azure Australia East', provider: 'Azure', tier: 'hyperscale', city: 'Sydney', country: 'Australia', iso: 'AU', lat: -33.8688, lon: 151.2093, capacityMW: 250, status: 'online' },

  // Middle East / nearby
  { id: 'aws-me-bah', name: 'AWS me-south-1 (Bahrain)', provider: 'AWS', tier: 'hyperscale', city: 'Manama', country: 'Bahrain', iso: 'BH', lat: 26.2235, lon: 50.5876, capacityMW: 120, status: 'online' },
  { id: 'aws-me-uae', name: 'AWS me-central-1 (UAE)', provider: 'AWS', tier: 'hyperscale', city: 'Dubai', country: 'United Arab Emirates', iso: 'AE', lat: 25.2048, lon: 55.2708, capacityMW: 200, status: 'online' },
  { id: 'azure-me-uae', name: 'Azure UAE North', provider: 'Azure', tier: 'hyperscale', city: 'Abu Dhabi', country: 'United Arab Emirates', iso: 'AE', lat: 24.4539, lon: 54.3773, capacityMW: 180, status: 'online' },

  // South America / Africa
  { id: 'aws-sa-gru', name: 'AWS sa-east-1', provider: 'AWS', tier: 'hyperscale', city: 'São Paulo', country: 'Brazil', iso: 'BR', lat: -23.5505, lon: -46.6333, capacityMW: 200, status: 'online' },
  { id: 'aws-af-cpt', name: 'AWS af-south-1', provider: 'AWS', tier: 'hyperscale', city: 'Cape Town', country: 'South Africa', iso: 'ZA', lat: -33.9249, lon: 18.4241, capacityMW: 100, status: 'online' },
];

// ─── Satellite Ground Stations ────────────────────────────────
export const GROUND_STATIONS: GroundStation[] = [
  // Israel
  { id: 'spacecom-emek', name: 'Spacecom Emek HaEla Teleport', nameHe: 'תחנת חלל-תקשורת עמק האלה', operator: 'SpaceCom', city: 'Emek HaEla', country: 'Israel', iso: 'IL', lat: 31.7000, lon: 34.9700, satellites: ['AMOS-3', 'AMOS-7', 'AMOS-17'], status: 'online' },
  { id: 'iai-yehud', name: 'IAI MBT Space Yehud', nameHe: 'IAI חלל יהוד', operator: 'IAI', city: 'Yehud', country: 'Israel', iso: 'IL', lat: 32.0333, lon: 34.8833, satellites: ['Ofek series', 'AMOS'], status: 'online' },
  { id: 'starlink-il', name: 'Starlink Israel Gateway', nameHe: 'Starlink ישראל', operator: 'Starlink', city: 'Negev', country: 'Israel', iso: 'IL', lat: 31.2500, lon: 34.7500, satellites: ['Starlink LEO'], status: 'online' },

  // Starlink global gateways (subset)
  { id: 'starlink-us-tx', name: 'Starlink Brownsville Gateway', operator: 'Starlink', city: 'Brownsville', country: 'United States', iso: 'US', lat: 25.9017, lon: -97.4975, satellites: ['Starlink LEO'], status: 'online' },
  { id: 'starlink-uk', name: 'Starlink Goonhilly Gateway', operator: 'Starlink', city: 'Goonhilly', country: 'United Kingdom', iso: 'GB', lat: 50.0480, lon: -5.1820, satellites: ['Starlink LEO'], status: 'online' },
  { id: 'starlink-au', name: 'Starlink Broken Hill', operator: 'Starlink', city: 'Broken Hill', country: 'Australia', iso: 'AU', lat: -31.9530, lon: 141.4530, satellites: ['Starlink LEO'], status: 'online' },
  { id: 'starlink-jp', name: 'Starlink Tokyo Gateway', operator: 'Starlink', city: 'Tokyo', country: 'Japan', iso: 'JP', lat: 35.6762, lon: 139.6503, satellites: ['Starlink LEO'], status: 'online' },

  // Iridium
  { id: 'iridium-az', name: 'Iridium Tempe Gateway', operator: 'Iridium', city: 'Tempe', country: 'United States', iso: 'US', lat: 33.4255, lon: -111.9400, satellites: ['Iridium NEXT (66 LEO)'], status: 'online' },
  { id: 'iridium-ak', name: 'Iridium Fairbanks TT&C', operator: 'Iridium', city: 'Fairbanks', country: 'United States', iso: 'US', lat: 64.8378, lon: -147.7164, satellites: ['Iridium NEXT'], status: 'online' },

  // ViaSat
  { id: 'viasat-ca', name: 'ViaSat Carlsbad HQ', operator: 'ViaSat', city: 'Carlsbad', country: 'United States', iso: 'US', lat: 33.1581, lon: -117.3506, satellites: ['ViaSat-2', 'ViaSat-3'], status: 'online' },
  { id: 'viasat-it', name: 'ViaSat Lario Teleport', operator: 'ViaSat', city: 'Como', country: 'Italy', iso: 'IT', lat: 45.8081, lon: 9.0852, satellites: ['ViaSat-2', 'KA-SAT'], status: 'online' },

  // OneWeb
  { id: 'oneweb-uk', name: 'OneWeb Talbot Gateway', operator: 'OneWeb', city: 'Talbot', country: 'United Kingdom', iso: 'GB', lat: 51.5074, lon: -0.1278, satellites: ['OneWeb LEO (648)'], status: 'online' },

  // Inmarsat / Intelsat
  { id: 'inmarsat-nl', name: 'Inmarsat Burum Teleport', operator: 'Inmarsat', city: 'Burum', country: 'Netherlands', iso: 'NL', lat: 53.2667, lon: 6.2167, satellites: ['Inmarsat-4/5 (GEO)'], status: 'online' },
  { id: 'intelsat-us', name: 'Intelsat Riverside Teleport', operator: 'Intelsat', city: 'Riverside', country: 'United States', iso: 'US', lat: 33.9806, lon: -117.3755, satellites: ['Intelsat (GEO)'], status: 'online' },
];

// ─── Active Satellites — sub-satellite points (illustrative) ──
// Note: GEO satellites are fixed over equator; LEO simplified positions
export const SATELLITES: SatelliteOrbit[] = [
  // Israeli AMOS over equator above Africa (~4°W)
  { id: 'amos-3', name: 'AMOS-3', operator: 'SpaceCom', lat: 0, lon: 4, altKm: 35786, type: 'GEO' },
  { id: 'amos-7', name: 'AMOS-7', operator: 'SpaceCom', lat: 0, lon: 4, altKm: 35786, type: 'GEO' },
  { id: 'amos-17', name: 'AMOS-17', operator: 'SpaceCom', lat: 0, lon: 17, altKm: 35786, type: 'GEO' },
  // Inmarsat / Intelsat GEO
  { id: 'inmarsat-eu', name: 'Inmarsat-5 EMEA', operator: 'Inmarsat', lat: 0, lon: 25, altKm: 35786, type: 'GEO' },
  { id: 'intelsat-eu', name: 'Intelsat 33e', operator: 'Intelsat', lat: 0, lon: 60, altKm: 35786, type: 'GEO' },
  // Starlink LEO sample (sub-satellite snapshot — illustrative)
  { id: 'starlink-leo-1', name: 'Starlink LEO #1', operator: 'Starlink', lat: 35, lon: 30, altKm: 550, type: 'LEO' },
  { id: 'starlink-leo-2', name: 'Starlink LEO #2', operator: 'Starlink', lat: 25, lon: 38, altKm: 550, type: 'LEO' },
  { id: 'starlink-leo-3', name: 'Starlink LEO #3', operator: 'Starlink', lat: 40, lon: 50, altKm: 550, type: 'LEO' },
  // Iridium LEO sample
  { id: 'iridium-leo-1', name: 'Iridium NEXT #1', operator: 'Iridium', lat: 50, lon: -120, altKm: 780, type: 'LEO' },
  // OneWeb LEO sample
  { id: 'oneweb-leo-1', name: 'OneWeb LEO #1', operator: 'OneWeb', lat: 55, lon: 10, altKm: 1200, type: 'LEO' },
];

export const PROVIDER_COLOR: Record<DataCenterProvider, string> = {
  AWS: '#ff9900',
  Azure: '#0078d4',
  GCP: '#4285f4',
  Oracle: '#f80000',
  IBM: '#1f70c1',
  Bezeq: '#00bcd4',
  Cellcom: '#e91e63',
  Partner: '#9c27b0',
  MedOne: '#4caf50',
  Equinix: '#e3242b',
  Other: '#9e9e9e',
};

export const OPERATOR_COLOR: Record<GroundStationOperator, string> = {
  Starlink: '#00e5ff',
  Iridium: '#ffd600',
  ViaSat: '#ff6d00',
  OneWeb: '#7c4dff',
  SpaceCom: '#00b0ff',
  IAI: '#00e676',
  Inmarsat: '#ff1744',
  Intelsat: '#e040fb',
  Other: '#9e9e9e',
};

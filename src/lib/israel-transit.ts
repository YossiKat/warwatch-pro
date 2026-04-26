// ═══════════════════════════════════════════════════════════════
// Israel Transit Infrastructure — stations, terminals, malls
// Public OSM / Wikipedia coordinates
// ═══════════════════════════════════════════════════════════════

export interface TransitNode {
  id: string;
  type: 'train' | 'bus_terminal' | 'light_rail' | 'mall';
  name: string;
  nameHe: string;
  lat: number;
  lon: number;
  city: string;
  capacity?: 'major' | 'medium' | 'minor';
}

export const TRAIN_STATIONS: TransitNode[] = [
  { id: 'tr-tlv-savidor', type: 'train', name: 'TLV Savidor Center', nameHe: 'תל אביב מרכז סבידור', lat: 32.0844, lon: 34.7989, city: 'Tel Aviv', capacity: 'major' },
  { id: 'tr-tlv-hashalom', type: 'train', name: 'TLV HaShalom', nameHe: 'תל אביב השלום', lat: 32.0727, lon: 34.7929, city: 'Tel Aviv', capacity: 'major' },
  { id: 'tr-tlv-hahagana', type: 'train', name: 'TLV HaHagana', nameHe: 'תל אביב ההגנה', lat: 32.0567, lon: 34.7920, city: 'Tel Aviv', capacity: 'major' },
  { id: 'tr-tlv-univ', type: 'train', name: 'TLV University', nameHe: 'תל אביב אוניברסיטה', lat: 32.1021, lon: 34.8056, city: 'Tel Aviv', capacity: 'medium' },
  { id: 'tr-hfa-merkaz', type: 'train', name: 'Haifa Center', nameHe: 'חיפה מרכז השמונה', lat: 32.8170, lon: 34.9989, city: 'Haifa', capacity: 'major' },
  { id: 'tr-hfa-hof', type: 'train', name: 'Haifa Hof HaCarmel', nameHe: 'חיפה חוף הכרמל', lat: 32.7833, lon: 34.9667, city: 'Haifa', capacity: 'major' },
  { id: 'tr-jrs-yitz', type: 'train', name: 'Jerusalem Yitzhak Navon', nameHe: 'ירושלים יצחק נבון', lat: 31.7886, lon: 35.2031, city: 'Jerusalem', capacity: 'major' },
  { id: 'tr-bsh-merkaz', type: 'train', name: 'Beer Sheva Center', nameHe: 'באר שבע מרכז', lat: 31.2433, lon: 34.7986, city: 'Beer Sheva', capacity: 'major' },
  { id: 'tr-bsh-univ', type: 'train', name: 'Beer Sheva University', nameHe: 'באר שבע אוניברסיטה', lat: 31.2614, lon: 34.8092, city: 'Beer Sheva', capacity: 'medium' },
  { id: 'tr-nhr', type: 'train', name: 'Nahariya', nameHe: 'נהריה', lat: 33.0058, lon: 35.0972, city: 'Nahariya', capacity: 'medium' },
  { id: 'tr-akko', type: 'train', name: 'Akko', nameHe: 'עכו', lat: 32.9233, lon: 35.0814, city: 'Akko', capacity: 'medium' },
  { id: 'tr-rmg', type: 'train', name: 'Ramat Gan', nameHe: 'רמת גן הסיטי', lat: 32.0844, lon: 34.8147, city: 'Ramat Gan', capacity: 'medium' },
  { id: 'tr-bnymina', type: 'train', name: 'Binyamina', nameHe: 'בנימינה', lat: 32.5197, lon: 34.9531, city: 'Binyamina', capacity: 'medium' },
  { id: 'tr-hadera', type: 'train', name: 'Hadera West', nameHe: 'חדרה מערב', lat: 32.4350, lon: 34.9089, city: 'Hadera', capacity: 'medium' },
  { id: 'tr-netanya', type: 'train', name: 'Netanya', nameHe: 'נתניה', lat: 32.3286, lon: 34.8550, city: 'Netanya', capacity: 'medium' },
  { id: 'tr-herzl', type: 'train', name: 'Herzliya', nameHe: 'הרצליה', lat: 32.1664, lon: 34.8186, city: 'Herzliya', capacity: 'medium' },
  { id: 'tr-lod', type: 'train', name: 'Lod', nameHe: 'לוד', lat: 31.9558, lon: 34.8919, city: 'Lod', capacity: 'medium' },
  { id: 'tr-rehovot', type: 'train', name: 'Rehovot', nameHe: 'רחובות', lat: 31.8950, lon: 34.8108, city: 'Rehovot', capacity: 'medium' },
  { id: 'tr-ashdod', type: 'train', name: 'Ashdod Ad Halom', nameHe: 'אשדוד עד הלום', lat: 31.7867, lon: 34.6711, city: 'Ashdod', capacity: 'medium' },
  { id: 'tr-ashkelon', type: 'train', name: 'Ashkelon', nameHe: 'אשקלון', lat: 31.6628, lon: 34.5650, city: 'Ashkelon', capacity: 'medium' },
];

export const BUS_TERMINALS: TransitNode[] = [
  { id: 'bt-tlv-2000', type: 'bus_terminal', name: 'TLV Central 2000', nameHe: 'תחנה מרכזית ת"א', lat: 32.0556, lon: 34.7806, city: 'Tel Aviv', capacity: 'major' },
  { id: 'bt-tlv-arlozorov', type: 'bus_terminal', name: 'Arlozorov Terminal', nameHe: 'תחנת ארלוזורוב', lat: 32.0856, lon: 34.7989, city: 'Tel Aviv', capacity: 'major' },
  { id: 'bt-jrs-central', type: 'bus_terminal', name: 'Jerusalem Central', nameHe: 'תחנה מרכזית ירושלים', lat: 31.7886, lon: 35.2031, city: 'Jerusalem', capacity: 'major' },
  { id: 'bt-hfa-merkazit', type: 'bus_terminal', name: 'Haifa HaMifratz', nameHe: 'תחנה מרכזית המפרץ', lat: 32.8200, lon: 35.0667, city: 'Haifa', capacity: 'major' },
  { id: 'bt-hfa-hof', type: 'bus_terminal', name: 'Haifa Hof HaCarmel', nameHe: 'חוף הכרמל מרכזית', lat: 32.7833, lon: 34.9667, city: 'Haifa', capacity: 'major' },
  { id: 'bt-bsh', type: 'bus_terminal', name: 'Beer Sheva Central', nameHe: 'תחנה מרכזית ב"ש', lat: 31.2433, lon: 34.7986, city: 'Beer Sheva', capacity: 'major' },
  { id: 'bt-eilat', type: 'bus_terminal', name: 'Eilat Central', nameHe: 'תחנה מרכזית אילת', lat: 29.5570, lon: 34.9519, city: 'Eilat', capacity: 'medium' },
  { id: 'bt-tib', type: 'bus_terminal', name: 'Tiberias Central', nameHe: 'תחנה מרכזית טבריה', lat: 32.7922, lon: 35.5311, city: 'Tiberias', capacity: 'medium' },
  { id: 'bt-naz', type: 'bus_terminal', name: 'Nazareth Central', nameHe: 'תחנה מרכזית נצרת', lat: 32.7019, lon: 35.2972, city: 'Nazareth', capacity: 'medium' },
  { id: 'bt-ashdod', type: 'bus_terminal', name: 'Ashdod Central', nameHe: 'תחנה מרכזית אשדוד', lat: 31.7967, lon: 34.6428, city: 'Ashdod', capacity: 'medium' },
  { id: 'bt-petahtikva', type: 'bus_terminal', name: 'Petah Tikva Central', nameHe: 'תחנה מרכזית פ"ת', lat: 32.0917, lon: 34.8867, city: 'Petah Tikva', capacity: 'medium' },
  { id: 'bt-rishon', type: 'bus_terminal', name: 'Rishon LeZion', nameHe: 'תחנה מרכזית ראשל"צ', lat: 31.9694, lon: 34.7747, city: 'Rishon LeZion', capacity: 'medium' },
];

export const LIGHT_RAIL_STOPS: TransitNode[] = [
  { id: 'lr-jrs-yaffo', type: 'light_rail', name: 'Jerusalem Yafo Center', nameHe: 'הרכבת הקלה - יפו מרכז', lat: 31.7833, lon: 35.2178, city: 'Jerusalem', capacity: 'major' },
  { id: 'lr-jrs-hrz', type: 'light_rail', name: 'Mount Herzl', nameHe: 'הר הרצל', lat: 31.7706, lon: 35.1797, city: 'Jerusalem', capacity: 'medium' },
  { id: 'lr-jrs-pisgat', type: 'light_rail', name: 'Pisgat Ze\'ev', nameHe: 'פסגת זאב', lat: 31.8233, lon: 35.2400, city: 'Jerusalem', capacity: 'medium' },
  { id: 'lr-tlv-allenby', type: 'light_rail', name: 'TLV Allenby', nameHe: 'הקו האדום - אלנבי', lat: 32.0664, lon: 34.7706, city: 'Tel Aviv', capacity: 'major' },
  { id: 'lr-tlv-savidor', type: 'light_rail', name: 'TLV Savidor LRT', nameHe: 'הקו האדום - סבידור', lat: 32.0844, lon: 34.7989, city: 'Tel Aviv', capacity: 'major' },
  { id: 'lr-tlv-petahtikva', type: 'light_rail', name: 'Petah Tikva LRT', nameHe: 'הקו האדום - פ"ת', lat: 32.0928, lon: 34.8856, city: 'Petah Tikva', capacity: 'medium' },
  { id: 'lr-tlv-bat-yam', type: 'light_rail', name: 'Bat Yam LRT', nameHe: 'הקו האדום - בת ים', lat: 32.0167, lon: 34.7500, city: 'Bat Yam', capacity: 'medium' },
];

export const MALLS: TransitNode[] = [
  { id: 'm-azrieli-tlv', type: 'mall', name: 'Azrieli Tel Aviv', nameHe: 'עזריאלי תל אביב', lat: 32.0744, lon: 34.7919, city: 'Tel Aviv', capacity: 'major' },
  { id: 'm-dizengoff', type: 'mall', name: 'Dizengoff Center', nameHe: 'דיזנגוף סנטר', lat: 32.0758, lon: 34.7747, city: 'Tel Aviv', capacity: 'major' },
  { id: 'm-ramat-aviv', type: 'mall', name: 'Ramat Aviv Mall', nameHe: 'קניון רמת אביב', lat: 32.1136, lon: 34.7986, city: 'Tel Aviv', capacity: 'major' },
  { id: 'm-malha', type: 'mall', name: 'Malha Mall', nameHe: 'קניון מלחה', lat: 31.7506, lon: 35.1881, city: 'Jerusalem', capacity: 'major' },
  { id: 'm-jrs-hadar', type: 'mall', name: 'Hadar Mall Jerusalem', nameHe: 'קניון הדר', lat: 31.7517, lon: 35.2089, city: 'Jerusalem', capacity: 'medium' },
  { id: 'm-grand-canyon', type: 'mall', name: 'Grand Kanyon Haifa', nameHe: 'גרנד קניון חיפה', lat: 32.7942, lon: 35.0244, city: 'Haifa', capacity: 'major' },
  { id: 'm-lev-hamifratz', type: 'mall', name: 'Lev HaMifratz', nameHe: 'לב המפרץ', lat: 32.8194, lon: 35.0667, city: 'Haifa', capacity: 'medium' },
  { id: 'm-bsh-grand', type: 'mall', name: 'Grand Kanyon Beer Sheva', nameHe: 'גרנד קניון ב"ש', lat: 31.2492, lon: 34.7906, city: 'Beer Sheva', capacity: 'major' },
  { id: 'm-ashdod', type: 'mall', name: 'Ashdod Big', nameHe: 'ביג אשדוד', lat: 31.7950, lon: 34.6500, city: 'Ashdod', capacity: 'medium' },
  { id: 'm-ayalon', type: 'mall', name: 'Ayalon Mall Ramat Gan', nameHe: 'קניון איילון', lat: 32.0833, lon: 34.8133, city: 'Ramat Gan', capacity: 'major' },
  { id: 'm-rishon', type: 'mall', name: 'Cinema City Rishon', nameHe: 'סינמה סיטי ראשל"צ', lat: 31.9586, lon: 34.7956, city: 'Rishon LeZion', capacity: 'major' },
  { id: 'm-7stars', type: 'mall', name: 'Seven Stars Herzliya', nameHe: 'שבעת הכוכבים הרצליה', lat: 32.1733, lon: 34.8456, city: 'Herzliya', capacity: 'major' },
  { id: 'm-bilu', type: 'mall', name: 'Bilu Center', nameHe: 'בילו סנטר', lat: 31.8839, lon: 34.7894, city: 'Rehovot', capacity: 'medium' },
  { id: 'm-arena', type: 'mall', name: 'Arena Herzliya Marina', nameHe: 'ארנה הרצליה', lat: 32.1639, lon: 34.7942, city: 'Herzliya', capacity: 'medium' },
  { id: 'm-ofer', type: 'mall', name: 'Ofer Petah Tikva', nameHe: 'קניון אופר פ"ת', lat: 32.0961, lon: 34.8917, city: 'Petah Tikva', capacity: 'medium' },
];

export const ALL_TRANSIT_NODES: TransitNode[] = [
  ...TRAIN_STATIONS, ...BUS_TERMINALS, ...LIGHT_RAIL_STOPS, ...MALLS,
];

export const TRANSIT_COLOR: Record<TransitNode['type'], string> = {
  train: '#00b0ff',
  bus_terminal: '#ffab00',
  light_rail: '#e040fb',
  mall: '#26a69a',
};

export const TRANSIT_ICON: Record<TransitNode['type'], string> = {
  train: '🚆',
  bus_terminal: '🚌',
  light_rail: '🚊',
  mall: '🛍️',
};

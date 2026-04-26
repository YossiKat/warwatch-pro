// Global conflict zones — selectable overlay for the tactical map.
// Source: same canonical list used by /global-war page.

export type GlobalZone = {
  id: string;
  flag: string;
  name: string;            // Hebrew name
  risk: 1 | 2 | 3 | 4 | 5; // 5 = active war
  center: [number, number]; // [lat, lon]
  radiusKm: number;         // visual radius on the map
  color: string;            // marker/ring color
  parties: string[];
  desc: string;
};

export const GLOBAL_ZONES: GlobalZone[] = [
  { id: 'ukraine',    flag: '🇺🇦', name: 'אוקראינה–רוסיה',    risk: 5, center: [49.5, 32],    radiusKm: 800, color: '#ff003c', parties: ['רוסיה', 'אוקראינה', 'NATO'],     desc: 'מלחמה מלאה מאז פברואר 2022' },
  { id: 'gaza',       flag: '🇵🇸', name: 'עזה–ישראל',         risk: 5, center: [31.4, 34.5],  radiusKm: 60,  color: '#ff003c', parties: ['ישראל', 'חמאס', 'חיזבאללה'],     desc: 'מלחמת חרבות ברזל' },
  { id: 'iran_proxy', flag: '🇮🇷', name: 'איראן ופרוקסי',      risk: 5, center: [33, 53],      radiusKm: 1200, color: '#ff003c', parties: ['איראן', 'ארה"ב', 'ישראל'],       desc: 'תוכנית גרעין + רשת פרוקסי' },
  { id: 'red_sea',    flag: '🌊', name: 'ים סוף',             risk: 4, center: [15, 43],      radiusKm: 600, color: '#ff8800', parties: ['חות׳ים', 'ארה"ב'],                desc: 'התקפות חות׳ים על ספינות' },
  { id: 'taiwan',     flag: '🇹🇼', name: 'מיצר טייוואן',       risk: 4, center: [24, 121],     radiusKm: 400, color: '#ff8800', parties: ['סין', 'טייוואן', 'ארה"ב'],       desc: 'מתיחות סינית מתגברת' },
  { id: 'nkorea',     flag: '🇰🇵', name: 'קוריאה הצפונית',     risk: 4, center: [39.5, 127.5], radiusKm: 350, color: '#ff8800', parties: ['צפון קוריאה', 'דרום קוריאה'],     desc: 'שיגורי טילים בליסטיים' },
  { id: 'myanmar',    flag: '🇲🇲', name: 'מיאנמר',             risk: 3, center: [19, 96.5],    radiusKm: 600, color: '#ffdd00', parties: ['חונטה', 'התנגדות'],               desc: 'מלחמת אזרחים' },
  { id: 'sudan',      flag: '🇸🇩', name: 'סודן',               risk: 3, center: [15, 32],      radiusKm: 900, color: '#ffdd00', parties: ['SAF', 'RSF'],                     desc: 'מלחמת אזרחים, 10M+ מורעבים' },
  { id: 'pakistan',   flag: '🇵🇰', name: 'פקיסטן–הודו',         risk: 3, center: [30, 73],      radiusKm: 600, color: '#ffdd00', parties: ['פקיסטן', 'הודו'],                  desc: 'מתיחות בקשמיר' },
  { id: 'sahel',      flag: '🌍', name: 'סאהל',                risk: 3, center: [13.5, 1],     radiusKm: 1500, color: '#ffdd00', parties: ['ISIS', 'JNIM', 'Wagner'],         desc: 'מאלי, בורקינה פאסו, ניז׳ר' },
  { id: 'scs',        flag: '🇨🇳', name: 'ים סין הדרומי',       risk: 3, center: [14, 114],     radiusKm: 800, color: '#ffdd00', parties: ['סין', 'פיליפינים', 'ארה"ב'],     desc: 'עימותים ימיים' },
];

export const RISK_LABEL: Record<number, string> = {
  1: 'שגרה', 2: 'עירנות', 3: 'מתיחות', 4: 'סכסוך', 5: 'מלחמה',
};

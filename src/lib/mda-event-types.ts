/**
 * קטלוג סוגי אירועים — חמ"ל מד"א לאומי
 * MDA National Command Center — Event Type Catalog
 * 
 * Each event type has a unique icon (Lucide), Hebrew label, English label,
 * severity color, and a keyword list for auto-classification.
 */

export interface MdaEventType {
  id: string;
  icon: string;          // Lucide icon name (kebab-case)
  emoji: string;         // Fallback emoji for ticker/feed
  labelHe: string;       // Hebrew label
  labelEn: string;       // English label
  category: 'impact' | 'shrapnel' | 'direct_hit' | 'identification' | 'fire' | 'infrastructure' | 'road' | 'medical' | 'trauma' | 'hazmat' | 'collapse' | 'shooting' | 'stabbing' | 'crowd' | 'maritime' | 'aviation' | 'obgyn' | 'units';
  defaultSeverity: 'low' | 'medium' | 'high' | 'critical';
  color: string;         // Hex color for map markers
  keywords: string[];    // Auto-match keywords from MDA reports
  hidden?: boolean;      // If true, excluded from classification results
}

export const MDA_EVENT_TYPES: MdaEventType[] = [
  // ═══ נפילות / פגיעות ביטחוניות ═══
  {
    id: 'open_area_no_casualties',
    icon: 'tree-pine',
    emoji: '🌲',
    labelHe: 'נפילת פריט בשטח פתוח, ללא נפגעים',
    labelEn: 'Impact in open area, no casualties',
    category: 'impact',
    defaultSeverity: 'low',
    color: '#4ade80',
    keywords: ['שטח פתוח', 'ללא נפגעים', 'open area'],
  },
  {
    id: 'building_courtyard',
    icon: 'home',
    emoji: '🏠',
    labelHe: 'נפילת פריט בחצר בניין',
    labelEn: 'Impact in building courtyard',
    category: 'impact',
    defaultSeverity: 'medium',
    color: '#fbbf24',
    keywords: ['חצר בניין', 'courtyard'],
  },
  {
    id: 'shrapnel_no_info',
    icon: 'sparkles',
    emoji: '✨',
    labelHe: 'נפילת פריט (שברי רסיסים), ללא מידע על נפגעים',
    labelEn: 'Shrapnel debris, no info on casualties',
    category: 'shrapnel',
    defaultSeverity: 'medium',
    color: '#f97316',
    keywords: ['שברי רסיסים', 'רסיסים', 'shrapnel'],
  },
  {
    id: 'direct_hit_collapse',
    icon: 'building-2',
    emoji: '🏚️',
    labelHe: 'נפילת פריט, פגיעה ישירה במבנה עם קריסה ונזק כבד',
    labelEn: 'Direct hit on building with collapse and heavy damage',
    category: 'direct_hit',
    defaultSeverity: 'critical',
    color: '#ef4444',
    keywords: ['פגיעה ישירה', 'קריסה', 'נזק כבד', 'direct hit', 'collapse'],
  },
  {
    id: 'rooftop_no_casualties',
    icon: 'arrow-up-to-line',
    emoji: '⬆️',
    labelHe: 'נפילת פריט על גג בניין, ללא נפגעים',
    labelEn: 'Impact on building rooftop, no casualties',
    category: 'impact',
    defaultSeverity: 'medium',
    color: '#fbbf24',
    keywords: ['גג בניין', 'גג', 'rooftop'],
  },
  {
    id: 'near_building_no_casualties',
    icon: 'map-pin',
    emoji: '📍',
    labelHe: 'נפילת פריט סמוך למבנה, ללא נפגעים',
    labelEn: 'Impact near building, no casualties',
    category: 'impact',
    defaultSeverity: 'low',
    color: '#4ade80',
    keywords: ['סמוך למבנה', 'near building'],
  },
  {
    id: 'item_identified',
    icon: 'search',
    emoji: '🔍',
    labelHe: 'זיהוי פריט במרחב, ללא מידע על נפגעים',
    labelEn: 'Item identified in area, no info on casualties',
    category: 'identification',
    defaultSeverity: 'low',
    color: '#60a5fa',
    keywords: ['זיהוי פריט', 'זיהוי', 'חפץ חשוד', 'identified'],
  },
  {
    id: 'parking_between_buildings',
    icon: 'car',
    emoji: '🚗',
    labelHe: 'פגיעה בחניה, בין שני בניינים',
    labelEn: 'Impact in parking area between two buildings',
    category: 'infrastructure',
    defaultSeverity: 'medium',
    color: '#f97316',
    keywords: ['חניה', 'בין שני בניינים', 'parking'],
    hidden: true,
  },
  {
    id: 'station_compound',
    icon: 'train-front',
    emoji: '🚂',
    labelHe: 'נפילת פריט במתחם התחנה, לא ידוע על נפגעים',
    labelEn: 'Impact in station compound, no info on casualties',
    category: 'infrastructure',
    defaultSeverity: 'medium',
    color: '#f97316',
    keywords: ['מתחם התחנה', 'תחנה', 'station'],
  },
  {
    id: 'open_area_black_smoke',
    icon: 'flame',
    emoji: '🔥',
    labelHe: 'נפילת פריט בשטח פתוח, עשן שחור, ללא נפגעים',
    labelEn: 'Impact in open area with black smoke, no casualties',
    category: 'fire',
    defaultSeverity: 'medium',
    color: '#a855f7',
    keywords: ['עשן שחור', 'עשן', 'black smoke', 'smoke'],
  },

  // ═══ כבישים ותנועה ═══
  {
    id: 'intercity_road_impact',
    icon: 'route',
    emoji: '🛣️',
    labelHe: 'נפילה בכביש בין-עירוני',
    labelEn: 'Impact on intercity road',
    category: 'road',
    defaultSeverity: 'high',
    color: '#f43f5e',
    keywords: ['כביש בין עירוני', 'בין-עירוני', 'כביש בינעירוני', 'intercity road', 'בינעירוני'],
  },
  {
    id: 'urban_road_impact',
    icon: 'milestone',
    emoji: '🏙️',
    labelHe: 'נפילה בכביש בתוך עיר',
    labelEn: 'Impact on urban road',
    category: 'road',
    defaultSeverity: 'high',
    color: '#f43f5e',
    keywords: ['כביש בתוך עיר', 'כביש עירוני', 'רחוב', 'urban road', 'בתוך עיר'],
  },
  {
    id: 'road_accident_intercity',
    icon: 'triangle-alert',
    emoji: '⚠️',
    labelHe: 'תאונת דרכים בכביש בין-עירוני',
    labelEn: 'Road accident on intercity highway',
    category: 'road',
    defaultSeverity: 'high',
    color: '#ef4444',
    keywords: ['תאונת דרכים', 'תאונה', 'כביש בין עירוני', 'road accident'],
  },
  {
    id: 'road_accident_urban',
    icon: 'car-front',
    emoji: '🚙',
    labelHe: 'תאונת דרכים בתוך עיר',
    labelEn: 'Road accident in urban area',
    category: 'road',
    defaultSeverity: 'medium',
    color: '#fbbf24',
    keywords: ['תאונת דרכים עירונית', 'תאונה עירונית', 'הולך רגל', 'pedestrian'],
  },
  {
    id: 'multi_vehicle_accident',
    icon: 'car-taxi-front',
    emoji: '💥',
    labelHe: 'תאונה רב-רכבית',
    labelEn: 'Multi-vehicle accident',
    category: 'road',
    defaultSeverity: 'critical',
    color: '#ef4444',
    keywords: ['רב-רכבית', 'רב רכבית', 'מספר כלי רכב', 'multi vehicle'],
  },

  // ═══ רפואי שגרה וחירום (Medical) ═══
  {
    id: 'heart_attack',
    icon: 'heart',
    emoji: '💔',
    labelHe: 'אוטם בשריר הלב (התקף לב)',
    labelEn: 'Heart attack / MI',
    category: 'medical',
    defaultSeverity: 'critical',
    color: '#ef4444',
    keywords: ['התקף לב', 'אוטם', 'כאבים בחזה', 'חזה', 'heart attack', 'MI', 'cardiac'],
    hidden: true,
  },
  {
    id: 'resuscitation',
    icon: 'heart-pulse',
    emoji: '❤️‍🩹',
    labelHe: 'החייאה / דום לב',
    labelEn: 'Resuscitation / CPR',
    category: 'medical',
    defaultSeverity: 'critical',
    color: '#ef4444',
    keywords: ['החייאה', 'דום לב', 'CPR', 'resuscitation'],
  },
  {
    id: 'breathing_difficulty',
    icon: 'wind',
    emoji: '🫁',
    labelHe: 'קוצר נשימה / אסתמה / חנק',
    labelEn: 'Breathing difficulty / asthma / choking',
    category: 'medical',
    defaultSeverity: 'high',
    color: '#f97316',
    keywords: ['קוצר נשימה', 'אסתמה', 'חנק', 'בצקת ריאות', 'גוף זר', 'נחנק', 'asthma', 'choking', 'dyspnea'],
  },
  {
    id: 'consciousness_change',
    icon: 'brain',
    emoji: '🧠',
    labelHe: 'שינוי במצב הכרה / עילפון / שבץ',
    labelEn: 'Altered consciousness / fainting / stroke',
    category: 'medical',
    defaultSeverity: 'high',
    color: '#f97316',
    keywords: ['עילפון', 'שבץ', 'אירוע מוחי', 'היפוגליקמיה', 'סוכרת', 'חסר הכרה', 'מצב הכרה', 'stroke', 'fainting', 'unconscious'],
  },
  {
    id: 'seizures',
    icon: 'zap',
    emoji: '⚡',
    labelHe: 'פרכוסים / אפילפסיה',
    labelEn: 'Seizures / epilepsy',
    category: 'medical',
    defaultSeverity: 'high',
    color: '#f97316',
    keywords: ['פרכוסים', 'אפילפסיה', 'פרכוסי חום', 'seizure', 'epilepsy'],
  },
  {
    id: 'injured_critical',
    icon: 'siren',
    emoji: '🚨',
    labelHe: 'פצוע קשה',
    labelEn: 'Critically injured',
    category: 'medical',
    defaultSeverity: 'critical',
    color: '#ef4444',
    keywords: ['פצוע קשה', 'מצב קשה', 'אנוש', 'critical condition'],
  },
  {
    id: 'injured_moderate',
    icon: 'ambulance',
    emoji: '🚑',
    labelHe: 'פצוע בינוני',
    labelEn: 'Moderately injured',
    category: 'medical',
    defaultSeverity: 'high',
    color: '#f97316',
    keywords: ['פצוע בינוני', 'מצב בינוני', 'moderate'],
  },
  {
    id: 'injured_light',
    icon: 'bandage',
    emoji: '🩹',
    labelHe: 'פצוע קל',
    labelEn: 'Lightly injured',
    category: 'medical',
    defaultSeverity: 'medium',
    color: '#fbbf24',
    keywords: ['פצוע קל', 'מצב קל', 'light injury'],
  },
  {
    id: 'mass_casualty',
    icon: 'users',
    emoji: '👥',
    labelHe: 'אירוע רב נפגעים (אר"ן)',
    labelEn: 'Mass casualty incident (MCI)',
    category: 'medical',
    defaultSeverity: 'critical',
    color: '#dc2626',
    keywords: ['רב נפגעים', 'אר"ן', 'ארן', 'mass casualty', 'MCI'],
  },

  // ═══ טראומה (Trauma) ═══
  {
    id: 'fall_from_height',
    icon: 'arrow-down-to-line',
    emoji: '⬇️',
    labelHe: 'נפילה מגובה',
    labelEn: 'Fall from height',
    category: 'trauma',
    defaultSeverity: 'high',
    color: '#f97316',
    keywords: ['נפילה מגובה', 'נפל מסולם', 'נפל מגג', 'נפילה מקומה', 'fall from height'],
  },
  {
    id: 'penetrating_injury',
    icon: 'target',
    emoji: '🎯',
    labelHe: 'פציעה חודרת (ירי / רסיסים)',
    labelEn: 'Penetrating injury',
    category: 'trauma',
    defaultSeverity: 'critical',
    color: '#ef4444',
    keywords: ['פציעה חודרת', 'פצע ירי', 'רסיס', 'penetrating'],
  },
  {
    id: 'burns',
    icon: 'thermometer',
    emoji: '🌡️',
    labelHe: 'כוויות',
    labelEn: 'Burns',
    category: 'trauma',
    defaultSeverity: 'high',
    color: '#f97316',
    keywords: ['כוויות', 'כוויה', 'כימי', 'burns'],
  },

  // ═══ אם וילד (OB/Pediatrics) ═══
  {
    id: 'active_birth',
    icon: 'baby',
    emoji: '👶',
    labelHe: 'לידה פעילה / סיבוכי היריון',
    labelEn: 'Active birth / pregnancy complication',
    category: 'obgyn',
    defaultSeverity: 'high',
    color: '#ec4899',
    keywords: ['לידה', 'לידת בית', 'היריון', 'סיבוכי היריון', 'birth', 'labor', 'pregnancy'],
  },
  {
    id: 'child_emergency',
    icon: 'baby',
    emoji: '🧒',
    labelHe: 'מצב חירום בילד / תינוק',
    labelEn: 'Child / infant emergency',
    category: 'obgyn',
    defaultSeverity: 'critical',
    color: '#ec4899',
    keywords: ['חנק ילד', 'מוות בעריסה', 'תינוק', 'פעוט', 'גן שעשועים', 'child', 'infant', 'SIDS'],
  },

  // ═══ יחידות תגובה (Response Units) ═══
  {
    id: 'unit_bls',
    icon: 'truck',
    emoji: '🚑',
    labelHe: 'אמבולנס לבן (BLS)',
    labelEn: 'BLS ambulance',
    category: 'units',
    defaultSeverity: 'low',
    color: '#94a3b8',
    keywords: ['אמבולנס לבן', 'BLS', 'צוות עזרה ראשונה'],
  },
  {
    id: 'unit_als',
    icon: 'siren',
    emoji: '🏥',
    labelHe: 'אט"ן / נט"ן (ALS)',
    labelEn: 'ALS / intensive care unit',
    category: 'units',
    defaultSeverity: 'high',
    color: '#ef4444',
    keywords: ['אט"ן', 'נט"ן', 'ALS', 'טיפול נמרץ', 'פראמדיק'],
  },
  {
    id: 'unit_motorcycle',
    icon: 'bike',
    emoji: '🏍️',
    labelHe: 'יחידת אופנועים — מגיב ראשון',
    labelEn: 'Motorcycle first responder',
    category: 'units',
    defaultSeverity: 'medium',
    color: '#22c55e',
    keywords: ['אופנוע', 'מגיב ראשון', 'motorcycle', 'first responder'],
  },
  {
    id: 'unit_helicopter',
    icon: 'plane',
    emoji: '🚁',
    labelHe: 'מסוק מד"א',
    labelEn: 'MDA helicopter',
    category: 'units',
    defaultSeverity: 'critical',
    color: '#6366f1',
    keywords: ['מסוק', 'פינוי אווירי', 'helicopter', 'medevac'],
  },

  // ═══ שריפות ═══
  {
    id: 'building_fire',
    icon: 'flame-kindling',
    emoji: '🏠🔥',
    labelHe: 'שריפה במבנה',
    labelEn: 'Building fire',
    category: 'fire',
    defaultSeverity: 'high',
    color: '#ef4444',
    keywords: ['שריפה במבנה', 'שריפת מבנה', 'building fire'],
  },
  {
    id: 'wildfire',
    icon: 'trees',
    emoji: '🌳🔥',
    labelHe: 'שריפת חורש / יער',
    labelEn: 'Wildfire / brush fire',
    category: 'fire',
    defaultSeverity: 'high',
    color: '#f97316',
    keywords: ['שריפת חורש', 'שריפת יער', 'שריפת שדה', 'wildfire', 'brush fire'],
  },
  {
    id: 'vehicle_fire',
    icon: 'car',
    emoji: '🚗🔥',
    labelHe: 'שריפת רכב',
    labelEn: 'Vehicle fire',
    category: 'fire',
    defaultSeverity: 'medium',
    color: '#f97316',
    keywords: ['שריפת רכב', 'רכב בוער', 'vehicle fire'],
  },
  {
    id: 'trapped_persons',
    icon: 'person-standing',
    emoji: '🆘',
    labelHe: 'לכודים',
    labelEn: 'Persons trapped',
    category: 'collapse',
    defaultSeverity: 'critical',
    color: '#ef4444',
    keywords: ['לכודים', 'חילוץ', 'trapped', 'rescue'],
  },

  // ═══ חומרים מסוכנים ═══
  {
    id: 'hazmat_leak',
    icon: 'biohazard',
    emoji: '☣️',
    labelHe: 'דליפת חומרים מסוכנים',
    labelEn: 'Hazmat leak',
    category: 'hazmat',
    defaultSeverity: 'critical',
    color: '#eab308',
    keywords: ['חומרים מסוכנים', 'חומ"ס', 'דליפה', 'גז', 'hazmat', 'chemical'],
  },
  {
    id: 'gas_leak',
    icon: 'wind',
    emoji: '💨',
    labelHe: 'דליפת גז',
    labelEn: 'Gas leak',
    category: 'hazmat',
    defaultSeverity: 'high',
    color: '#eab308',
    keywords: ['דליפת גז', 'ריח גז', 'gas leak'],
  },

  // ═══ פיגועים / ירי / דקירה ═══
  {
    id: 'shooting_attack',
    icon: 'crosshair',
    emoji: '🔫',
    labelHe: 'אירוע ירי / פיגוע ירי',
    labelEn: 'Shooting attack',
    category: 'shooting',
    defaultSeverity: 'critical',
    color: '#dc2626',
    keywords: ['ירי', 'פיגוע ירי', 'shooting', 'gunfire'],
  },
  {
    id: 'stabbing_attack',
    icon: 'sword',
    emoji: '🔪',
    labelHe: 'אירוע דקירה / פיגוע דקירה',
    labelEn: 'Stabbing attack',
    category: 'stabbing',
    defaultSeverity: 'critical',
    color: '#dc2626',
    keywords: ['דקירה', 'פיגוע דקירה', 'סכין', 'stabbing'],
  },
  {
    id: 'ramming_attack',
    icon: 'truck',
    emoji: '🚛',
    labelHe: 'פיגוע דריסה',
    labelEn: 'Vehicle ramming attack',
    category: 'road',
    defaultSeverity: 'critical',
    color: '#dc2626',
    keywords: ['דריסה', 'פיגוע דריסה', 'ramming'],
  },

  // ═══ אירועי המונים ═══
  {
    id: 'crowd_crush',
    icon: 'users-round',
    emoji: '🧑‍🤝‍🧑',
    labelHe: 'מעיכת המונים / אירוע המוני',
    labelEn: 'Crowd crush event',
    category: 'crowd',
    defaultSeverity: 'critical',
    color: '#dc2626',
    keywords: ['מעיכה', 'אירוע המוני', 'המונים', 'crowd crush'],
  },

  // ═══ קריסת מבנה ═══
  {
    id: 'building_collapse',
    icon: 'house',
    emoji: '🏗️',
    labelHe: 'קריסת מבנה (לא ביטחוני)',
    labelEn: 'Building collapse (non-security)',
    category: 'collapse',
    defaultSeverity: 'critical',
    color: '#ef4444',
    keywords: ['קריסת מבנה', 'קריסה', 'building collapse'],
  },

  // ═══ ימי / אווירי ═══
  {
    id: 'drowning',
    icon: 'waves',
    emoji: '🌊',
    labelHe: 'טביעה / אירוע ימי',
    labelEn: 'Drowning / maritime incident',
    category: 'maritime',
    defaultSeverity: 'high',
    color: '#3b82f6',
    keywords: ['טביעה בים', 'טביעה בבריכה', 'טביעה בנחל', 'טביעה בכנרת', 'טביעה במאגר', 'טביעה בנהר', 'אירוע ימי', 'טבע בים', 'טבע בבריכה', 'טבע בכנרת'],
  },
  {
    id: 'aviation_incident',
    icon: 'plane',
    emoji: '✈️',
    labelHe: 'אירוע תעופה',
    labelEn: 'Aviation incident',
    category: 'aviation',
    defaultSeverity: 'critical',
    color: '#6366f1',
    keywords: ['מטוס', 'מסוק', 'תעופה', 'נחיתת חירום', 'aviation', 'aircraft'],
  },
];

/**
 * Coastal / water-adjacent cities where drowning events are plausible.
 */
const WATER_CITIES = new Set([
  'תל אביב', 'חיפה', 'אשדוד', 'אשקלון', 'הרצליה', 'נתניה', 'בת ים',
  'עכו', 'נהריה', 'חולון', 'ראשון לציון', 'אילת', 'קיסריה', 'חדרה',
  'טבריה', 'עין גב', 'כנרת', 'דגניה', 'עין גדי', 'ים המלח',
  'מעגן מיכאל', 'עתלית', 'תנובות', 'יפו', 'שלומי',
]);

/**
 * Check if text mentions a water-adjacent location.
 */
function isNearWater(text: string): boolean {
  const lower = text.toLowerCase();
  for (const city of WATER_CITIES) {
    if (lower.includes(city)) return true;
  }
  // Explicit water-body mentions
  return /בים|בבריכה|בנחל|בכנרת|בנהר|חוף|במאגר|ים המלח|ים התיכון|ים סוף/.test(text);
}

/**
 * Auto-classify a title/description to an MDA event type.
 * Returns the best match or undefined.
 * Applies location-aware validation for certain event types.
 */
export function classifyMdaEvent(text: string): MdaEventType | undefined {
  if (!text) return undefined;
  const lower = text.toLowerCase();
  
  let bestMatch: MdaEventType | undefined;
  let bestScore = 0;

  for (const eventType of MDA_EVENT_TYPES) {
    if (eventType.hidden) continue;
    let score = 0;
    for (const kw of eventType.keywords) {
      if (lower.includes(kw.toLowerCase())) {
        score += kw.length;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = eventType;
    }
  }

  // Location-aware validation: drowning must be near water
  if (bestMatch?.id === 'drowning' && !isNearWater(text)) {
    // If the text contains generic "טביעה" without water context, 
    // don't classify as drowning — likely a false positive
    return undefined;
  }

  return bestScore > 0 ? bestMatch : undefined;
}

/**
 * Get event type by ID
 */
export function getMdaEventType(id: string): MdaEventType | undefined {
  return MDA_EVENT_TYPES.find(t => t.id === id);
}

/**
 * Get severity color for display
 */
export function getSeverityColor(severity: string): string {
  switch (severity) {
    case 'critical': return '#ef4444';
    case 'high': return '#f97316';
    case 'medium': return '#fbbf24';
    case 'low': return '#4ade80';
    default: return '#94a3b8';
  }
}

/**
 * Get all unique categories
 */
export function getMdaCategories(): { id: string; labelHe: string; count: number }[] {
  const cats = new Map<string, { labelHe: string; count: number }>();
  const catNames: Record<string, string> = {
    impact: 'נפילות',
    shrapnel: 'רסיסים',
    direct_hit: 'פגיעה ישירה',
    identification: 'זיהוי',
    fire: 'שריפות',
    infrastructure: 'תשתיות',
    road: 'כבישים ותנועה',
    medical: 'רפואי',
    trauma: 'טראומה',
    hazmat: 'חומ"ס',
    collapse: 'קריסה/לכודים',
    shooting: 'ירי',
    stabbing: 'דקירה',
    crowd: 'המונים',
    maritime: 'ימי',
    aviation: 'תעופה',
    obgyn: 'אם וילד',
    units: 'יחידות תגובה',
  };
  for (const evt of MDA_EVENT_TYPES) {
    const existing = cats.get(evt.category);
    if (existing) {
      existing.count++;
    } else {
      cats.set(evt.category, { labelHe: catNames[evt.category] || evt.category, count: 1 });
    }
  }
  return Array.from(cats.entries()).map(([id, v]) => ({ id, ...v }));
}

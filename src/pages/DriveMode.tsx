import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, CircleMarker, Circle, Marker, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { useWarRoom } from '@/hooks/useWarRoom';
import { supabase } from '@/integrations/supabase/client';
import { useLocale } from '@/hooks/useLocale';
import { useVoiceControl, type VoiceCommand } from '@/hooks/useVoiceControl';
import 'leaflet/dist/leaflet.css';
import FitIsraelBounds from '@/components/war-room/FitIsraelBounds';

// ── Map controller ──
const MapController = ({ center, zoom }: { center: [number, number] | null; zoom: number | null }) => {
  const map = useMap();
  useEffect(() => {
    if (center && zoom) map.flyTo(center, zoom, { duration: 1.5 });
  }, [center, zoom, map]);
  return null;
};

// ── GPS lookup ──
const CITY_GPS: Record<string, { lat: number; lon: number }> = {
  'שדרות': { lat: 31.52, lon: 34.60 }, 'אשקלון': { lat: 31.67, lon: 34.57 },
  'באר שבע': { lat: 31.25, lon: 34.79 }, 'תל אביב': { lat: 32.08, lon: 34.78 },
  'ירושלים': { lat: 31.77, lon: 35.21 }, 'חיפה': { lat: 32.79, lon: 34.99 },
  'נהריה': { lat: 33.00, lon: 35.10 }, 'צפת': { lat: 32.97, lon: 35.50 },
  'קריית שמונה': { lat: 33.21, lon: 35.57 }, 'מטולה': { lat: 33.28, lon: 35.58 },
  'אשדוד': { lat: 31.80, lon: 34.65 }, 'נתניה': { lat: 32.33, lon: 34.86 },
  'הרצליה': { lat: 32.16, lon: 34.79 }, 'רמת גן': { lat: 32.07, lon: 34.81 },
  'פתח תקווה': { lat: 32.09, lon: 34.88 }, 'ראשון לציון': { lat: 31.97, lon: 34.80 },
  'אילת': { lat: 29.56, lon: 34.95 }, 'עכו': { lat: 32.93, lon: 35.08 },
  'כרמיאל': { lat: 32.92, lon: 35.30 }, 'טבריה': { lat: 32.79, lon: 35.53 },
  'נתיבות': { lat: 31.42, lon: 34.59 }, 'אופקים': { lat: 31.32, lon: 34.62 },
  'דימונה': { lat: 31.07, lon: 35.03 }, 'ערד': { lat: 31.26, lon: 35.21 },
  'מודיעין': { lat: 31.90, lon: 34.96 }, 'בית שמש': { lat: 31.73, lon: 34.99 },
  'חדרה': { lat: 32.44, lon: 34.92 }, 'רחובות': { lat: 31.89, lon: 34.81 },
  'שלומי': { lat: 33.08, lon: 35.15 }, 'בצת': { lat: 33.06, lon: 35.15 },
  'כפר גלעדי': { lat: 33.24, lon: 35.57 }, 'מרגליות': { lat: 33.22, lon: 35.58 },
  'מעלות תרשיחא': { lat: 33.02, lon: 35.27 }, 'זרעית': { lat: 33.10, lon: 35.32 },
  'כיסופים': { lat: 31.38, lon: 34.40 }, 'ניר עוז': { lat: 31.34, lon: 34.40 },
  'בארי': { lat: 31.43, lon: 34.49 }, 'רעים': { lat: 31.41, lon: 34.47 },
  'נחל עוז': { lat: 31.48, lon: 34.49 }, 'זיקים': { lat: 31.62, lon: 34.52 },
  'כפר עזה': { lat: 31.48, lon: 34.47 }, 'מפלסים': { lat: 31.47, lon: 34.53 },
};

const SHELTER_TIMES: Record<string, number> = {
  'מטולה': 0, 'קריית שמונה': 0, 'שדרות': 15, 'נתיבות': 15, 'צפת': 15,
  'נהריה': 15, 'אשקלון': 30, 'עכו': 30, 'כרמיאל': 30, 'טבריה': 30,
  'באר שבע': 60, 'חיפה': 60, 'תל אביב': 90, 'ירושלים': 90, 'אשדוד': 45,
  'נתניה': 90, 'הרצליה': 90, 'רמת גן': 90, 'פתח תקווה': 90, 'ראשון לציון': 90,
  'אילת': 90, 'חדרה': 90, 'רחובות': 90, 'מודיעין': 90,
};

// ── Region grouping — map cities to broad regions ──
const CITY_TO_REGION: Record<string, string> = {
  'מטולה': 'גליל עליון', 'קריית שמונה': 'גליל עליון', 'כפר גלעדי': 'גליל עליון', 'מרגליות': 'גליל עליון',
  'צפת': 'גליל עליון', 'שלומי': 'גליל מערבי', 'בצת': 'גליל מערבי', 'זרעית': 'גליל מערבי',
  'נהריה': 'גליל מערבי', 'מעלות תרשיחא': 'גליל מערבי', 'עכו': 'גליל מערבי',
  'כרמיאל': 'גליל מרכזי', 'טבריה': 'גליל מרכזי',
  'חיפה': 'חיפה והקריות', 'חדרה': 'שרון',
  'נתניה': 'שרון', 'הרצליה': 'גוש דן',
  'תל אביב': 'גוש דן', 'רמת גן': 'גוש דן', 'פתח תקווה': 'גוש דן', 'ראשון לציון': 'גוש דן',
  'רחובות': 'גוש דן', 'מודיעין': 'מרכז',
  'ירושלים': 'ירושלים', 'בית שמש': 'ירושלים',
  'אשדוד': 'שפלה', 'אשקלון': 'שפלה',
  'שדרות': 'עוטף עזה', 'נתיבות': 'עוטף עזה', 'אופקים': 'עוטף עזה',
  'כיסופים': 'עוטף עזה', 'ניר עוז': 'עוטף עזה', 'בארי': 'עוטף עזה', 'רעים': 'עוטף עזה',
  'נחל עוז': 'עוטף עזה', 'זיקים': 'עוטף עזה', 'כפר עזה': 'עוטף עזה', 'מפלסים': 'עוטף עזה',
  'באר שבע': 'נגב', 'ערד': 'נגב', 'דימונה': 'נגב', 'אילת': 'אילת',
};

function getRegionForCity(city: string): string {
  if (CITY_TO_REGION[city]) return CITY_TO_REGION[city];
  for (const [name, region] of Object.entries(CITY_TO_REGION)) {
    if (city.includes(name) || name.includes(city)) return region;
  }
  return city; // fallback to city name itself
}

function getShelterSecForCity(city: string): number {
  if (SHELTER_TIMES[city] !== undefined) return SHELTER_TIMES[city];
  for (const [name, sec] of Object.entries(SHELTER_TIMES)) {
    if (city.includes(name) || name.includes(city)) return sec;
  }
  return 90;
}

interface RegionAlert {
  regionName: string;
  shelterSec: number;
  alertDate: number; // earliest alert time for this region
  elapsed: string;
  countdown: string | null;
  shelterExpired: boolean;
  cities: string[];
}

type ViewMode = 'compact' | 'full';

// ── Route danger levels ──
interface RouteDangerSegment {
  points: [number, number][];
  danger: 'safe' | 'caution' | 'danger' | 'critical';
  color: string;
}

// ── Predefined destination presets ──
const DESTINATIONS: { label: string; lat: number; lon: number }[] = [
  { label: 'תל אביב', lat: 32.08, lon: 34.78 },
  { label: 'ירושלים', lat: 31.77, lon: 35.21 },
  { label: 'חיפה', lat: 32.79, lon: 34.99 },
  { label: 'באר שבע', lat: 31.25, lon: 34.79 },
  { label: 'אילת', lat: 29.56, lon: 34.95 },
  { label: 'נתניה', lat: 32.33, lon: 34.86 },
];

const DriveMode = () => {
  const navigate = useNavigate();
  const war = useWarRoom('live');
  const { t, dir, locale, speechLang } = useLocale();
  const [userGPS, setUserGPS] = useState<{ lat: number; lon: number; speed: number | null } | null>(null);
  const [orefAlerts, setOrefAlerts] = useState<any[]>([]);
  const [flyTo, setFlyTo] = useState<{ center: [number, number]; zoom: number } | null>(null);
  const [countdownTick, setCountdownTick] = useState(0);
  const lastSeenIdRef = useRef<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('compact');
  const prevEmergencyRef = useRef(false);
  const mapRef = useRef<L.Map | null>(null);

  // ── Route planning state ──
  const [routePoints, setRoutePoints] = useState<[number, number][] | null>(null);
  const [routeDestination, setRouteDestination] = useState<string>('');
  const [routeLoading, setRouteLoading] = useState(false);
  const [showRoutePanel, setShowRoutePanel] = useState(false);
  const [routeDangerSegments, setRouteDangerSegments] = useState<RouteDangerSegment[]>([]);
  const [routeDangerSummary, setRouteDangerSummary] = useState<string>('');

  // ── Free text destination ──
  const [freeDestInput, setFreeDestInput] = useState('');
  const [freeDestSearching, setFreeDestSearching] = useState(false);

  // ── Map style & theater view ──
  const [driveMapStyle, setDriveMapStyle] = useState<'satellite' | 'google' | 'google_satellite'>('google');
  const [driveTheaterView, setDriveTheaterView] = useState(false);

  const toggleDriveTheater = useCallback(() => {
    setDriveTheaterView(prev => {
      if (!prev) {
        setFlyTo({ center: [28.0, 49.0], zoom: 5 });
      } else {
        const center: [number, number] = userGPS ? [userGPS.lat, userGPS.lon] : [31.5, 34.9];
        setFlyTo({ center, zoom: 10 });
      }
      return !prev;
    });
  }, [userGPS]);

  // Tick every second
  useEffect(() => {
    const t = setInterval(() => setCountdownTick(v => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // GPS tracking
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setUserGPS({ lat: pos.coords.latitude, lon: pos.coords.longitude, speed: pos.coords.speed }),
      () => {},
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // Fetch oref alerts
  useEffect(() => {
    const fetchAlerts = async () => {
      const { data } = await supabase
        .from('oref_alerts')
        .select('*')
        .gte('alert_date', new Date(Date.now() - 30 * 60 * 1000).toISOString())
        .order('alert_date', { ascending: false })
        .limit(50);
      if (data) setOrefAlerts(data);
    };
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 5000);
    const channel = supabase
      .channel('drive-oref')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'oref_alerts' }, () => fetchAlerts())
      .subscribe();
    return () => { clearInterval(interval); supabase.removeChannel(channel); };
  }, []);

  // ── Auto-redirect to war room on critical alert ──
  const redirectedRef = useRef(false);
  useEffect(() => {
    if (redirectedRef.current) return;
    // Check for fresh oref siren (last 60 seconds)
    const now = Date.now();
    const freshSiren = orefAlerts.some(a => {
      const alertTime = new Date(a.alert_date).getTime();
      return (now - alertTime) < 60_000;
    });
    // Check for critical/early-warning from intel feeds
    const criticalIntel = war.alerts.some(a =>
      (a.severity === 'critical' || a.earlyWarning) && (now - a.timestamp) < 120_000
    );
    if (freshSiren || criticalIntel) {
      redirectedRef.current = true;
      navigate('/', { replace: true });
    }
  }, [orefAlerts, war.alerts, navigate]);

  // Emergency zones
  const emergencyZones = useMemo(() => {
    const now = Date.now();
    const releaseMap = new Map<string, number>();
    for (const a of orefAlerts) {
      const t = (a.title || '');
      if (!t.includes('שחרור') && !t.includes('הותר')) continue;
      const time = new Date(a.alert_date).getTime();
      for (const loc of (a.locations || [])) {
        const prev = releaseMap.get(loc) || 0;
        if (time > prev) releaseMap.set(loc, time);
      }
    }
    const zones: { id: string; title: string; locations: string[]; alertDate: number; ageMs: number }[] = [];
    for (const a of orefAlerts) {
      const t = (a.title || '');
      if (t.includes('שחרור') || t.includes('הותר')) continue;
      const alertTime = new Date(a.alert_date).getTime();
      const ageMs = now - alertTime;
      if (ageMs > 600000) continue;
      const locs = (a.locations || []) as string[];
      const activeLocs = locs.filter(loc => {
        const relTime = releaseMap.get(loc) || 0;
        return relTime < alertTime;
      });
      if (activeLocs.length === 0) continue;
      zones.push({ id: a.id, title: t, locations: activeLocs, alertDate: alertTime, ageMs });
    }
    return zones;
  }, [orefAlerts]);

  const isEmergency = emergencyZones.length > 0;

  // Auto-expand to full on new alert, auto-collapse when calm
  useEffect(() => {
    if (isEmergency && !prevEmergencyRef.current) {
      setViewMode('full');
    }
    if (!isEmergency && prevEmergencyRef.current) {
      // Return to compact 10s after alert ends
      const timer = setTimeout(() => setViewMode('compact'), 10000);
      return () => clearTimeout(timer);
    }
    prevEmergencyRef.current = isEmergency;
  }, [isEmergency]);

  // Auto-zoom to alert location (full mode)
  useEffect(() => {
    if (emergencyZones.length === 0 || viewMode !== 'full') return;
    const newest = emergencyZones[0];
    if (newest.id === lastSeenIdRef.current) return;
    lastSeenIdRef.current = newest.id;
    const points: [number, number][] = [];
    for (const loc of newest.locations) {
      const trimmed = loc.trim();
      if (CITY_GPS[trimmed]) points.push([CITY_GPS[trimmed].lat, CITY_GPS[trimmed].lon]);
      for (const [name, coords] of Object.entries(CITY_GPS)) {
        if (trimmed.includes(name) || name.includes(trimmed)) { points.push([coords.lat, coords.lon]); break; }
      }
    }
    if (points.length > 0) {
      const avgLat = points.reduce((s, p) => s + p[0], 0) / points.length;
      const avgLon = points.reduce((s, p) => s + p[1], 0) / points.length;
      setFlyTo({ center: [avgLat, avgLon], zoom: 11 });
    }
  }, [emergencyZones, viewMode]);

  // Per-region alert countdowns
  const regionAlerts = useMemo((): RegionAlert[] => {
    if (emergencyZones.length === 0) return [];
    const now = Date.now();
    const regionMap = new Map<string, { shelterSec: number; alertDate: number; cities: Set<string> }>();

    for (const zone of emergencyZones) {
      for (const loc of zone.locations) {
        const trimmed = loc.trim();
        const regionName = getRegionForCity(trimmed);
        const shelterSec = getShelterSecForCity(trimmed);
        const existing = regionMap.get(regionName);
        if (!existing) {
          regionMap.set(regionName, { shelterSec, alertDate: zone.alertDate, cities: new Set([trimmed]) });
        } else {
          existing.cities.add(trimmed);
          // Use the earliest alert and minimum shelter time for the region
          if (zone.alertDate < existing.alertDate) existing.alertDate = zone.alertDate;
          if (shelterSec < existing.shelterSec) existing.shelterSec = shelterSec;
        }
      }
    }

    const results: RegionAlert[] = [];
    for (const [regionName, data] of regionMap) {
      const ageMs = now - data.alertDate;
      const elapsedMins = Math.floor(ageMs / 60000);
      const elapsedSecs = Math.floor((ageMs % 60000) / 1000);
      const remainingMs = Math.max(0, data.shelterSec * 1000 - ageMs);
      const remainMins = Math.floor(remainingMs / 60000);
      const remainSecs = Math.floor((remainingMs % 60000) / 1000);
      results.push({
        regionName,
        shelterSec: data.shelterSec,
        alertDate: data.alertDate,
        elapsed: `+${String(elapsedMins).padStart(2, '0')}:${String(elapsedSecs).padStart(2, '0')}`,
        countdown: remainingMs > 0 ? `${String(remainMins).padStart(2, '0')}:${String(remainSecs).padStart(2, '0')}` : null,
        shelterExpired: remainingMs <= 0,
        cities: [...data.cities],
      });
    }
    // Sort: non-expired first (by remaining time asc), then expired
    results.sort((a, b) => {
      if (a.shelterExpired !== b.shelterExpired) return a.shelterExpired ? 1 : -1;
      return a.alertDate - b.alertDate;
    });
    return results;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emergencyZones, countdownTick]);

  // Distance to nearest alert
  const distanceToAlert = useMemo(() => {
    if (!userGPS || emergencyZones.length === 0) return null;
    let minDist = Infinity;
    for (const zone of emergencyZones) {
      for (const loc of zone.locations) {
        const trimmed = loc.trim();
        let gps: { lat: number; lon: number } | null = null;
        if (CITY_GPS[trimmed]) gps = CITY_GPS[trimmed];
        else {
          for (const [name, coords] of Object.entries(CITY_GPS)) {
            if (trimmed.includes(name) || name.includes(trimmed)) { gps = coords; break; }
          }
        }
        if (gps) {
          const d = Math.sqrt(Math.pow((userGPS.lat - gps.lat) * 111, 2) + Math.pow((userGPS.lon - gps.lon) * 85, 2));
          if (d < minDist) minDist = d;
        }
      }
    }
    return minDist < Infinity ? Math.round(minDist) : null;
  }, [userGPS, emergencyZones]);

  // ── Route planning — fetch route from OSRM ──
  const fetchRoute = useCallback(async (destLat: number, destLon: number) => {
    const origin = userGPS || { lat: 32.08, lon: 34.78 }; // default TLV
    setRouteLoading(true);
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${destLon},${destLat}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.routes?.[0]?.geometry?.coordinates) {
        const coords: [number, number][] = data.routes[0].geometry.coordinates.map(
          (c: [number, number]) => [c[1], c[0]] as [number, number]
        );
        setRoutePoints(coords);
        analyzeRouteDanger(coords);
        // Fit map to route
        if (coords.length > 1) {
          const lats = coords.map(c => c[0]);
          const lons = coords.map(c => c[1]);
          const centerLat = (Math.min(...lats) + Math.max(...lats)) / 2;
          const centerLon = (Math.min(...lons) + Math.max(...lons)) / 2;
          setFlyTo({ center: [centerLat, centerLon], zoom: 9 });
        }
      }
    } catch (e) {
      console.error('Route fetch error:', e);
    }
    setRouteLoading(false);
  }, [userGPS]);

  // ── Analyze danger level along route segments ──
  const analyzeRouteDanger = useCallback((route: [number, number][]) => {
    // Build danger zones from active alerts
    const dangerZones: { lat: number; lon: number; radius: number; level: number }[] = [];
    const now = Date.now();
    for (const a of orefAlerts) {
      const t = (a.title || '');
      if (t.includes('שחרור') || t.includes('הותר')) continue;
      const ageMs = now - new Date(a.alert_date).getTime();
      if (ageMs > 3600000) continue; // 1 hour
      const level = ageMs < 120000 ? 3 : ageMs < 600000 ? 2 : 1;
      for (const loc of (a.locations || [])) {
        const trimmed = loc.trim();
        let gps: { lat: number; lon: number } | null = null;
        if (CITY_GPS[trimmed]) gps = CITY_GPS[trimmed];
        else {
          for (const [name, coords] of Object.entries(CITY_GPS)) {
            if (trimmed.includes(name) || name.includes(trimmed)) { gps = coords; break; }
          }
        }
        if (gps) dangerZones.push({ ...gps, radius: 15, level }); // 15km radius
      }
    }

    // Segment route by danger
    const segments: RouteDangerSegment[] = [];
    let currentSegment: [number, number][] = [];
    let currentDanger = 'safe';
    let maxDanger = 0;
    let dangerKm = 0;
    const totalPts = route.length;

    for (let i = 0; i < totalPts; i++) {
      const pt = route[i];
      let ptDanger = 0;
      for (const dz of dangerZones) {
        const dist = Math.sqrt(Math.pow((pt[0] - dz.lat) * 111, 2) + Math.pow((pt[1] - dz.lon) * 85, 2));
        if (dist < dz.radius) ptDanger = Math.max(ptDanger, dz.level);
      }
      const dangerLabel = ptDanger >= 3 ? 'critical' : ptDanger >= 2 ? 'danger' : ptDanger >= 1 ? 'caution' : 'safe';
      const dangerColor = ptDanger >= 3 ? '#ff1744' : ptDanger >= 2 ? '#ff6d00' : ptDanger >= 1 ? '#ffab00' : '#00e676';

      if (dangerLabel !== currentDanger && currentSegment.length > 0) {
        segments.push({ points: [...currentSegment], danger: currentDanger as any, color: dangerColor });
        currentSegment = [currentSegment[currentSegment.length - 1]]; // overlap last point
      }
      currentSegment.push(pt);
      currentDanger = dangerLabel;
      if (ptDanger > maxDanger) maxDanger = ptDanger;
      if (ptDanger > 0 && i > 0) {
        const prev = route[i - 1];
        dangerKm += Math.sqrt(Math.pow((pt[0] - prev[0]) * 111, 2) + Math.pow((pt[1] - prev[1]) * 85, 2));
      }
    }
    if (currentSegment.length > 0) {
      const color = maxDanger >= 3 ? '#ff1744' : maxDanger >= 2 ? '#ff6d00' : maxDanger >= 1 ? '#ffab00' : '#00e676';
      segments.push({ points: currentSegment, danger: currentDanger as any, color });
    }

    setRouteDangerSegments(segments);
    const dangerLabel = maxDanger >= 3 ? '🔴 מסלול מסוכן מאוד' : maxDanger >= 2 ? '🟠 מסלול מסוכן' : maxDanger >= 1 ? '🟡 מסלול בסיכון' : '🟢 מסלול בטוח';
    setRouteDangerSummary(dangerKm > 0 ? `${dangerLabel} — ${Math.round(dangerKm)} ק״מ באזור סכנה` : dangerLabel);
  }, [orefAlerts]);

  // Re-analyze when alerts change
  useEffect(() => {
    if (routePoints) analyzeRouteDanger(routePoints);
  }, [orefAlerts, routePoints, analyzeRouteDanger]);

  // ── Auto forward danger scan (25km radius from GPS, no route needed) ──
  const [forwardDangerZones, setForwardDangerZones] = useState<
    { lat: number; lon: number; radius: number; level: number; color: string; city: string; ageMin: number }[]
  >([]);
  const [forwardDangerSummary, setForwardDangerSummary] = useState<string>('');

  useEffect(() => {
    if (!userGPS) { setForwardDangerZones([]); setForwardDangerSummary(''); return; }
    const now = Date.now();
    const zones: typeof forwardDangerZones = [];

    for (const a of orefAlerts) {
      const t = (a.title || '');
      if (t.includes('שחרור') || t.includes('הותר')) continue;
      const ageMs = now - new Date(a.alert_date).getTime();
      if (ageMs > 3600000) continue; // ignore > 1h old

      // Danger level: fresh = critical, <5min = danger, <10min = caution
      const level = ageMs < 120000 ? 3 : ageMs < 300000 ? 2 : ageMs < 600000 ? 1 : 0.5;
      const color = level >= 3 ? '#ff1744' : level >= 2 ? '#ff6d00' : level >= 1 ? '#ffab00' : '#ffab0055';
      const ageMin = Math.round(ageMs / 60000);

      for (const loc of (a.locations || [])) {
        const trimmed = loc.trim();
        let gps: { lat: number; lon: number } | null = null;
        if (CITY_GPS[trimmed]) gps = CITY_GPS[trimmed];
        else {
          for (const [name, coords] of Object.entries(CITY_GPS)) {
            if (trimmed.includes(name) || name.includes(trimmed)) { gps = coords; break; }
          }
        }
        if (!gps) continue;

        // Distance from user
        const distKm = Math.sqrt(Math.pow((userGPS.lat - gps.lat) * 111, 2) + Math.pow((userGPS.lon - gps.lon) * 85, 2));
        if (distKm > 25) continue; // only within 25km

        // Avoid duplicates
        if (!zones.some(z => Math.abs(z.lat - gps!.lat) < 0.02 && Math.abs(z.lon - gps!.lon) < 0.02)) {
          zones.push({ ...gps, radius: Math.max(3000, 8000 - distKm * 200), level, color, city: trimmed, ageMin });
        }
      }
    }

    setForwardDangerZones(zones);

    if (zones.length === 0) {
      setForwardDangerSummary('');
    } else {
      const maxLevel = Math.max(...zones.map(z => z.level));
      const label = maxLevel >= 3 ? '🔴 סכנה גבוהה קדימה' : maxLevel >= 2 ? '🟠 סכנה במסלול' : maxLevel >= 1 ? '🟡 זהירות קדימה' : '⚪ סכנה ישנה באזור';
      const nearestDist = Math.min(...zones.map(z =>
        Math.sqrt(Math.pow((userGPS.lat - z.lat) * 111, 2) + Math.pow((userGPS.lon - z.lon) * 85, 2))
      ));
      setForwardDangerSummary(`${label} — ${Math.round(nearestDist)} ק״מ`);
    }
  }, [userGPS, orefAlerts, countdownTick]);

  const handleSelectDestination = useCallback((dest: typeof DESTINATIONS[0]) => {
    setRouteDestination(dest.label);
    fetchRoute(dest.lat, dest.lon);
    setShowRoutePanel(false);
  }, [fetchRoute]);

  const clearRoute = useCallback(() => {
    setRoutePoints(null);
    setRouteDangerSegments([]);
    setRouteDangerSummary('');
    setRouteDestination('');
    setFreeDestInput('');
  }, []);

  // ── Free text geocoding via Nominatim ──
  const searchFreeDestination = useCallback(async (query?: string) => {
    const q = (query || freeDestInput).trim();
    if (!q) return;
    setFreeDestSearching(true);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=il&limit=1&accept-language=${locale}`);
      const data = await res.json();
      if (data?.[0]) {
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        setRouteDestination(data[0].display_name?.split(',')[0] || q);
        fetchRoute(lat, lon);
        setShowRoutePanel(false);
      } else {
        // Fallback: global search
        const res2 = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=1&accept-language=${locale}`);
        const data2 = await res2.json();
        if (data2?.[0]) {
          const lat = parseFloat(data2[0].lat);
          const lon = parseFloat(data2[0].lon);
          setRouteDestination(data2[0].display_name?.split(',')[0] || q);
          fetchRoute(lat, lon);
          setShowRoutePanel(false);
        }
      }
    } catch (e) {
      console.error('Geocoding error:', e);
    }
    setFreeDestSearching(false);
  }, [freeDestInput, fetchRoute, locale]);

  // ── Voice commands ──
  const voiceCommands = useMemo((): VoiceCommand[] => [
    { pattern: /מרכז.*מפה|center.*map|centreer/i, action: () => { if (userGPS) setFlyTo({ center: [userGPS.lat, userGPS.lon], zoom: 12 }); }, description: t('voice.cmdCenterMap') },
    { pattern: /הרחב.*מפה|expand.*map|full.*map/i, action: () => setViewMode('full'), description: t('voice.cmdExpandMap') },
    { pattern: /מזער|minimize|compact/i, action: () => setViewMode('compact'), description: t('voice.cmdMinimize') },
    { pattern: /נווט ל(.+)|navigate to (.+)|go to (.+)/i, action: () => {}, description: t('voice.cmdNavigateTo') },
    { pattern: /חזור.*הביתה|go.*home|naar.*huis/i, action: () => { window.location.href = '/'; }, description: t('voice.cmdGoHome') },
  ], [userGPS, t]);

  // Special handler for "navigate to X" voice command
  const handleVoiceTranscript = useCallback((transcript: string) => {
    const navMatch = transcript.match(/נווט ל(.+)|navigate to (.+)|go to (.+)|rij naar (.+)/i);
    if (navMatch) {
      const dest = (navMatch[1] || navMatch[2] || navMatch[3] || navMatch[4] || '').trim();
      if (dest) {
        setFreeDestInput(dest);
        searchFreeDestination(dest);
      }
    }
  }, [searchFreeDestination]);

  const voice = useVoiceControl({
    lang: speechLang,
    commands: voiceCommands,
    onTranscript: handleVoiceTranscript,
  });

  const israelTime = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });

  // Alert markers
  const alertMarkers = useMemo(() => {
    const markers: { lat: number; lon: number; name: string; ageMs: number }[] = [];
    const now = Date.now();
    for (const a of orefAlerts) {
      const at = (a.title || '');
      if (at.includes('שחרור') || at.includes('הותר')) continue;
      const ageMs = now - new Date(a.alert_date).getTime();
      if (ageMs > 600000) continue;
      for (const loc of (a.locations || [])) {
        const trimmed = loc.trim();
        let gps: { lat: number; lon: number } | null = null;
        if (CITY_GPS[trimmed]) gps = CITY_GPS[trimmed];
        else {
          for (const [name, coords] of Object.entries(CITY_GPS)) {
            if (trimmed.includes(name) || name.includes(trimmed)) { gps = coords; break; }
          }
        }
        if (gps && !markers.some(m => Math.abs(m.lat - gps!.lat) < 0.02 && Math.abs(m.lon - gps!.lon) < 0.02)) {
          markers.push({ ...gps, name: trimmed, ageMs });
        }
      }
    }
    return markers;
  }, [orefAlerts]);

  const mapCenter: [number, number] = userGPS ? [userGPS.lat, userGPS.lon] : [31.5, 34.9];
  const mapZoom = userGPS ? 10 : 8;

  // ══════════════════════════════════════════════════════
  // COMPACT MODE — thin floating HUD strip, doesn't cover screen
  // Designed to sit on top of Google Maps / Waze / any other app
  // ══════════════════════════════════════════════════════
  if (viewMode === 'compact') {
    return (
      <div
        dir={dir}
        role="main"
        aria-label={t('drive.compact')}
        className="fixed inset-0 z-[9999] pointer-events-none"
        style={{ fontFamily: "'Heebo', sans-serif" }}
      >
        {/* ═══ Top HUD Strip ═══ */}
        <div
          className="pointer-events-auto absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-2"
          style={{
            background: isEmergency
              ? 'linear-gradient(to bottom, rgba(180,0,0,0.92) 0%, rgba(100,0,0,0.85) 100%)'
              : 'linear-gradient(to bottom, rgba(0,0,0,0.75) 0%, rgba(0,0,0,0.4) 80%, transparent 100%)',
            backdropFilter: 'blur(8px)',
            minHeight: isEmergency ? '80px' : '52px',
            transition: 'all 0.4s ease',
            borderBottom: isEmergency ? '2px solid rgba(255,23,68,0.7)' : '1px solid rgba(255,255,255,0.08)',
          }}
        >
          {/* Status dot + label */}
          <div className="flex items-center gap-2 min-w-0 shrink-0">
            <div
              className={`w-3 h-3 rounded-full ${isEmergency ? 'animate-pulse' : ''}`}
              style={{
                background: isEmergency ? '#ff1744' : '#00e676',
                boxShadow: isEmergency ? '0 0 16px #ff1744' : '0 0 8px #00e676',
              }}
            />
            <span className="font-bold text-sm truncate" style={{ color: isEmergency ? '#fff' : '#00e676cc' }}>
              {isEmergency ? t('drive.alertActive') : t('drive.monitoring')}
            </span>
          </div>

          {/* Emergency info */}
          {isEmergency && regionAlerts.length > 0 ? (
            <div className="flex items-center gap-3 flex-1 justify-center min-w-0 overflow-x-auto">
              {regionAlerts.map((ra, i) => (
                <div key={ra.regionName} className="flex items-center gap-1.5 shrink-0">
                  {i > 0 && <span className="text-white/20 mx-1">│</span>}
                  <span className="font-bold text-xs truncate max-w-[100px]" style={{ color: '#fff', textShadow: '0 0 8px rgba(255,23,68,0.4)' }}>
                    {ra.regionName}
                  </span>
                  <span className="font-mono font-black text-lg" style={{ color: ra.shelterExpired ? '#ff1744' : '#ff9100', animation: ra.shelterExpired ? 'blink-warning 0.5s infinite' : 'none' }}>
                    {ra.countdown || '⚠'}
                  </span>
                </div>
              ))}
              {distanceToAlert !== null && (
                <span className="font-mono text-sm font-bold shrink-0" style={{ color: '#ffab00' }}>
                  {distanceToAlert} {t('status.km')}
                </span>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-4 flex-1 justify-center">
              {userGPS?.speed !== null && userGPS?.speed !== undefined && userGPS.speed > 0 && (
                <span className="font-mono text-sm font-bold" style={{ color: '#42a5f5' }}>
                  {Math.round(userGPS.speed * 3.6)} {t('status.kmh')}
                </span>
              )}
            </div>
          )}

          {/* Right: voice + time + expand */}
          <div className="flex items-center gap-3 shrink-0">
            {voice.supported && (
              <button
                onClick={voice.toggleListening}
                className="text-lg px-1 transition-all"
                style={{
                  color: voice.isListening ? '#00e676' : 'rgba(255,255,255,0.5)',
                  textShadow: voice.isListening ? '0 0 12px #00e676' : 'none',
                  animation: voice.isListening ? 'pulse 1.5s infinite' : 'none',
                }}
                title={t('voice.tooltip')}
              >
                🎤
              </button>
            )}
            <span className="font-mono text-sm font-bold" style={{ color: '#42a5f5' }}>{israelTime}</span>
            <button onClick={() => setViewMode('full')} className="text-white/50 hover:text-white text-lg px-1 transition-colors" title={t('drive.expand')}>⛶</button>
            <a href="/" className="text-white/40 hover:text-white text-sm transition-colors" style={{ textDecoration: 'none' }}>✕</a>
          </div>
        </div>

        {/* Voice listening indicator */}
        {voice.isListening && (
          <div className="pointer-events-auto absolute top-14 left-1/2 -translate-x-1/2 z-[10000] rounded-full px-4 py-1.5" style={{ background: 'rgba(0,230,118,0.2)', border: '1px solid rgba(0,230,118,0.4)', backdropFilter: 'blur(8px)' }}>
            <span className="font-mono text-xs font-bold" style={{ color: '#00e676' }}>{t('voice.listening')}</span>
          </div>
        )}

        {/* Emergency flash border */}
        {isEmergency && (
          <div className="absolute inset-0 pointer-events-none" role="alert" aria-live="assertive" style={{ border: '3px solid rgba(255,23,68,0.5)', animation: 'critical-glow 2s ease-in-out infinite' }} />
        )}
      </div>
    );
  }

  // ══════════════════════════════════════════════════════
  // FULL MODE — fullscreen map with all details
  // ══════════════════════════════════════════════════════
  return (
    <div dir={dir} role="main" aria-label={t('drive.full')} className="relative w-full h-screen overflow-hidden" style={{ background: '#000', fontFamily: "'Heebo', sans-serif" }}>
      {/* ═══ MAP ═══ */}
      <MapContainer
        center={mapCenter}
        zoom={mapZoom}
        minZoom={driveTheaterView ? 4 : 7}
        maxZoom={16}
        className="absolute inset-0 z-0"
        style={{ background: '#000' }}
        zoomControl={false}
        attributionControl={false}
      >
        {!driveTheaterView && <FitIsraelBounds />}
        {driveMapStyle === 'google' ? (
          <TileLayer url="https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&scale=2" subdomains={['mt0','mt1','mt2','mt3']} />
        ) : driveMapStyle === 'google_satellite' ? (
          <TileLayer url="https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}&scale=2" subdomains={['mt0','mt1','mt2','mt3']} />
        ) : (
          <>
            <TileLayer url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png" opacity={0.8} />
          </>
        )}
        <MapController center={flyTo?.center || null} zoom={flyTo?.zoom || null} />

        {/* User location + 25km scan radius */}
        {userGPS && (
          <>
            <Circle center={[userGPS.lat, userGPS.lon]} radius={25000} pathOptions={{ color: '#42a5f5', fillColor: '#42a5f5', fillOpacity: 0.03, weight: 1, opacity: 0.3, dashArray: '12 8' }} />
            <Circle center={[userGPS.lat, userGPS.lon]} radius={200} pathOptions={{ color: '#2196f3', fillColor: '#2196f3', fillOpacity: 0.15, weight: 2 }} />
            <CircleMarker center={[userGPS.lat, userGPS.lon]} radius={12} pathOptions={{ color: '#fff', fillColor: '#2196f3', fillOpacity: 1, weight: 3 }} />
          </>
        )}

        {/* Forward danger zones (25km auto-scan) */}
        {forwardDangerZones.map((z, i) => (
          <React.Fragment key={`fwd-danger-${i}`}>
            <Circle center={[z.lat, z.lon]} radius={z.radius} pathOptions={{ color: z.color, fillColor: z.color, fillOpacity: z.level >= 2 ? 0.2 : 0.1, weight: 2, opacity: 0.7 }} />
            <Circle center={[z.lat, z.lon]} radius={z.radius * 1.8} pathOptions={{ color: z.color, fillColor: z.color, fillOpacity: 0.05, weight: 1, opacity: 0.3, dashArray: '8 4' }} />
            <Marker
              position={[z.lat, z.lon]}
              icon={L.divIcon({
                className: '',
                html: `<div style="font-family:'Heebo',sans-serif;font-size:12px;color:${z.color};font-weight:900;text-shadow:0 0 8px ${z.color},0 0 16px rgba(0,0,0,0.9);white-space:nowrap;transform:translate(-50%,-50%);">⚠ ${z.city} (${z.ageMin}ד׳)</div>`,
                iconSize: [0, 0], iconAnchor: [0, 0],
              })}
            />
          </React.Fragment>
        ))}

        {/* Alert markers */}
        {alertMarkers.map((m, i) => {
          const isCritical = m.ageMs < 120000;
          const color = isCritical ? '#ff1744' : '#ff6d00';
          return (
            <React.Fragment key={`alert-${i}`}>
              <Circle center={[m.lat, m.lon]} radius={5000} pathOptions={{ color, fillColor: color, fillOpacity: 0.08, weight: 2, opacity: 0.5, dashArray: '8 4' }} />
              <Circle center={[m.lat, m.lon]} radius={2500} pathOptions={{ color, fillColor: color, fillOpacity: 0.15, weight: 3, opacity: 0.8 }} />
              <Marker
                position={[m.lat, m.lon]}
                icon={L.divIcon({
                  className: '',
                  html: `<div style="font-family:'Heebo',sans-serif;font-size:18px;color:${color};font-weight:900;text-shadow:0 0 10px ${color},0 0 20px rgba(0,0,0,0.9);white-space:nowrap;transform:translate(-50%,-50%);">🚨 ${m.name}</div>`,
                  iconSize: [0, 0], iconAnchor: [0, 0],
                })}
              />
            </React.Fragment>
          );
        })}

        {/* Route with danger coloring */}
        {routeDangerSegments.map((seg, i) => (
          <Polyline
            key={`route-seg-${i}`}
            positions={seg.points}
            pathOptions={{
              color: seg.color,
              weight: 5,
              opacity: 0.85,
              dashArray: seg.danger === 'safe' ? undefined : '10 6',
            }}
          />
        ))}
        {/* Route outline for visibility */}
        {routePoints && (
          <Polyline positions={routePoints} pathOptions={{ color: '#000', weight: 8, opacity: 0.3 }} />
        )}
      </MapContainer>

      {/* ═══ TOP BAR ═══ */}
      <div
        className="fixed top-0 left-0 right-0 z-[1000] flex items-center justify-between px-6 py-3"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.4) 80%, transparent 100%)' }}
      >
        <div className="flex items-center gap-3">
          <div className={`w-4 h-4 rounded-full ${isEmergency ? 'animate-pulse' : ''}`} style={{ background: isEmergency ? '#ff1744' : '#00e676', boxShadow: isEmergency ? '0 0 20px #ff1744' : '0 0 10px #00e676' }} />
          <span className="font-mono text-lg font-bold" style={{ color: isEmergency ? '#ff1744' : '#00e676' }}>
            {isEmergency ? t('status.activeAlert') : t('status.noAlerts')}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {/* Map style & theater buttons removed per user request */}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-2xl">🔵</span>
          <span className="font-mono text-3xl font-black tracking-wider" style={{ color: '#42a5f5', textShadow: '0 0 15px rgba(66,165,245,0.5)' }}>
            {israelTime}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {userGPS && (
            <span className="font-mono text-sm" style={{ color: '#42a5f5' }}>
              {userGPS.speed !== null && userGPS.speed > 0 ? `${Math.round(userGPS.speed * 3.6)} ${t('status.kmh')}` : t('status.gps')}
            </span>
          )}
          {/* Voice button */}
          {voice.supported && (
            <button
              onClick={voice.toggleListening}
              className="font-mono text-lg px-2 py-1 rounded-lg border transition-all"
              style={{
                borderColor: voice.isListening ? '#00e676' : 'rgba(255,255,255,0.2)',
                background: voice.isListening ? 'rgba(0,230,118,0.2)' : 'transparent',
                color: voice.isListening ? '#00e676' : 'rgba(255,255,255,0.6)',
                animation: voice.isListening ? 'pulse 1.5s infinite' : 'none',
              }}
              title={t('voice.tooltip')}
            >
              🎤
            </button>
          )}
          {/* Route button */}
          <button
            onClick={() => setShowRoutePanel(!showRoutePanel)}
            className="font-mono text-sm px-3 py-1.5 rounded-lg border text-white/80 hover:text-white transition-all"
            style={{
              borderColor: routePoints ? '#00e676' : 'rgba(255,255,255,0.2)',
              background: routePoints ? 'rgba(0,230,118,0.15)' : 'transparent',
            }}
            title={t('drive.planRoute')}
          >
            {t('drive.route')}
          </button>
          {routePoints && (
            <button onClick={clearRoute} className="text-white/40 hover:text-white text-sm" title={t('drive.clearRoute')}>✕</button>
          )}
          <button
            onClick={() => setViewMode('compact')}
            className="font-mono text-sm px-3 py-1.5 rounded-lg border border-white/20 text-white/60 hover:text-white hover:border-white/40 transition-all"
            title={t('drive.minimize')}
          >
            ▬
          </button>
          <a href="/" className="font-mono text-sm px-3 py-1.5 rounded-lg border border-white/20 text-white/60 hover:text-white hover:border-white/40 transition-all" style={{ textDecoration: 'none' }}>
            ✕
          </a>
        </div>
      </div>

      {/* Voice listening indicator (full mode) */}
      {voice.isListening && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-[1002] rounded-full px-5 py-2" style={{ background: 'rgba(0,230,118,0.15)', border: '1px solid rgba(0,230,118,0.4)', backdropFilter: 'blur(8px)' }}>
          <span className="font-mono text-sm font-bold" style={{ color: '#00e676' }}>{t('voice.listening')}</span>
          {voice.lastTranscript && <span className="font-mono text-xs text-white/40 block text-center mt-0.5">"{voice.lastTranscript}"</span>}
        </div>
      )}

      {/* ═══ ROUTE PLANNING PANEL ═══ */}
      {showRoutePanel && (
        <div className="absolute top-16 z-[1001] rounded-xl overflow-hidden" style={{
          background: 'rgba(0,0,0,0.92)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.1)',
          padding: '16px',
          minWidth: '280px',
          ...(dir === 'rtl' ? { right: '16px' } : { left: '16px' }),
        }}>
          <div className="font-bold text-white text-sm mb-3">{t('drive.planRoute')}</div>
          
          {/* Free text input */}
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={freeDestInput}
              onChange={(e) => setFreeDestInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') searchFreeDestination(); }}
              placeholder={t('drive.freeInput')}
              className="flex-1 px-3 py-2 rounded-lg text-sm font-bold outline-none"
              style={{
                background: 'rgba(255,255,255,0.08)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.15)',
              }}
            />
            <button
              onClick={() => searchFreeDestination()}
              disabled={freeDestSearching || !freeDestInput.trim()}
              className="px-3 py-2 rounded-lg text-sm font-bold transition-all"
              style={{
                background: 'rgba(66,165,245,0.2)',
                color: '#42a5f5',
                border: '1px solid rgba(66,165,245,0.3)',
                opacity: freeDestSearching || !freeDestInput.trim() ? 0.5 : 1,
              }}
            >
              {freeDestSearching ? t('drive.searching') : t('drive.search')}
            </button>
          </div>

          <div className="text-white/40 text-xs mb-2">{t('drive.selectDest')}</div>
          <div className="flex flex-col gap-1.5">
            {DESTINATIONS.map(dest => (
              <button
                key={dest.label}
                onClick={() => handleSelectDestination(dest)}
                className="text-right px-3 py-2 rounded-lg text-sm font-bold transition-all"
                style={{
                  background: routeDestination === dest.label ? 'rgba(66,165,245,0.2)' : 'rgba(255,255,255,0.05)',
                  color: routeDestination === dest.label ? '#42a5f5' : '#fff',
                  border: routeDestination === dest.label ? '1px solid #42a5f5' : '1px solid transparent',
                }}
              >
                📍 {dest.label}
              </button>
            ))}
          </div>
          {routeLoading && (
            <div className="text-center text-white/50 text-xs mt-3 animate-pulse">{t('drive.calcRoute')}</div>
          )}
        </div>
      )}

      {/* ═══ ROUTE DANGER SUMMARY ═══ */}
      {routeDangerSummary && !isEmergency && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-[1000] rounded-xl px-5 py-2.5" style={{
          background: 'rgba(0,0,0,0.9)',
          backdropFilter: 'blur(8px)',
          border: '1px solid rgba(255,255,255,0.15)',
        }}>
          <div className="font-bold text-white text-sm text-center">{routeDangerSummary}</div>
          {routeDestination && (
            <div className="font-mono text-xs text-white/50 text-center mt-0.5">יעד: {routeDestination}</div>
          )}
        </div>
      )}

      {/* ═══ ALERT PANEL — per-region countdowns ═══ */}
      {isEmergency && regionAlerts.length > 0 && (
        <div className="absolute bottom-0 left-0 right-0 z-[1000] p-4" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.7) 70%, transparent 100%)' }}>
          {/* Region countdowns */}
          <div className="flex items-center justify-center gap-6 flex-wrap">
            {regionAlerts.map((ra) => (
              <div key={ra.regionName} className="flex flex-col items-center min-w-[120px]">
                {/* Region name */}
                <span className="font-bold text-sm mb-1" style={{
                  color: ra.shelterExpired ? '#ff174499' : '#ff9100',
                  animation: !ra.shelterExpired ? 'blink-warning 1s infinite' : 'none',
                }}>
                  🚨 {ra.regionName}
                </span>
                {/* Orange countdown */}
                <span className="font-mono font-black tracking-wider" style={{
                  fontSize: '40px', lineHeight: 1,
                  color: ra.shelterExpired ? '#ff1744' : '#ff9100',
                  textShadow: `0 0 20px ${ra.shelterExpired ? 'rgba(255,23,68,0.6)' : 'rgba(255,145,0,0.5)'}`,
                  animation: ra.shelterExpired ? 'blink-warning 0.5s infinite' : 'none',
                }}>
                  {ra.countdown || t('time.expiredShort')}
                </span>
                <span className="font-mono text-[10px] mt-0.5" style={{ color: '#ff910088' }}>
                  {ra.shelterExpired ? t('time.expired') : t('time.shelter')}
                </span>
                {/* Red elapsed */}
                <span className="font-mono text-sm font-bold mt-1" style={{ color: '#ff174499' }}>
                  {ra.elapsed}
                </span>
              </div>
            ))}

            {/* Distance */}
            {distanceToAlert !== null && (
              <div className="flex flex-col items-center">
                <span className="text-lg">📏</span>
                <span className="font-mono text-3xl font-black" style={{ color: '#ffab00', textShadow: '0 0 12px rgba(255,171,0,0.4)' }}>
                  {distanceToAlert} {t('status.km')}
                </span>
                <span className="font-mono text-xs mt-1" style={{ color: '#ffab0099' }}>
                  {t('distance.fromAlert')}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Forward danger banner (auto-scan, no route needed) */}
      {forwardDangerSummary && !isEmergency && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-[1000] rounded-xl px-5 py-3" style={{
          background: 'rgba(0,0,0,0.92)',
          backdropFilter: 'blur(10px)',
          border: `2px solid ${forwardDangerZones[0]?.color || '#ffab00'}44`,
          boxShadow: `0 0 20px ${forwardDangerZones[0]?.color || '#ffab00'}22`,
        }}>
          <div className="font-bold text-white text-base text-center" style={{ textShadow: '0 0 8px rgba(0,0,0,0.5)' }}>
            {forwardDangerSummary}
          </div>
          <div className="font-mono text-[10px] text-white/40 text-center mt-0.5">{t('drive.scan25km')}</div>
        </div>
      )}

      {/* Calm bottom bar */}
      {!isEmergency && (
        <div className="absolute bottom-0 left-0 right-0 z-[1000] h-16 flex items-center justify-center" style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, transparent 100%)' }}>
          <div className="flex items-center gap-4">
            <div className="w-3 h-3 rounded-full" style={{ background: '#00e676', boxShadow: '0 0 12px #00e676' }} />
            <span className="font-mono text-xl font-bold" style={{ color: '#00e67699' }}>
              {t('drive.monitoringRealtime')} — {israelTime}
            </span>
            {userGPS?.speed !== null && userGPS?.speed !== undefined && userGPS.speed > 0 && (
              <span className="font-mono text-lg font-bold" style={{ color: '#42a5f5' }}>
                {Math.round(userGPS.speed * 3.6)} {t('status.kmh')}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Emergency border */}
      {isEmergency && (
        <div className="absolute inset-0 z-[999] pointer-events-none" style={{
          border: '4px solid rgba(255,23,68,0.6)',
          boxShadow: 'inset 0 0 60px rgba(255,23,68,0.15)',
          animation: 'critical-glow 2s ease-in-out infinite',
        }} />
      )}
    </div>
  );
};

export default DriveMode;

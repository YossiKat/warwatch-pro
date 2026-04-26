import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, CircleMarker, Circle, Marker, useMap } from 'react-leaflet';
import L from 'leaflet';
import { supabase } from '@/integrations/supabase/client';
import { useLocale } from '@/hooks/useLocale';
import { useVoiceControl, type VoiceCommand } from '@/hooks/useVoiceControl';
import 'leaflet/dist/leaflet.css';
import FitIsraelBounds from '@/components/war-room/FitIsraelBounds';

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
  'שלומי': { lat: 33.08, lon: 35.15 }, 'מעלות תרשיחא': { lat: 33.02, lon: 35.27 },
};

const SHELTER_TIMES: Record<string, number> = {
  'מטולה': 0, 'קריית שמונה': 0, 'שדרות': 15, 'נתיבות': 15, 'צפת': 15,
  'נהריה': 15, 'אשקלון': 30, 'עכו': 30, 'כרמיאל': 30, 'טבריה': 30,
  'באר שבע': 60, 'חיפה': 60, 'תל אביב': 90, 'ירושלים': 90, 'אשדוד': 45,
};

const CITY_TO_REGION: Record<string, string> = {
  'מטולה': 'גליל עליון', 'קריית שמונה': 'גליל עליון',
  'צפת': 'גליל עליון', 'שלומי': 'גליל מערבי',
  'נהריה': 'גליל מערבי', 'מעלות תרשיחא': 'גליל מערבי', 'עכו': 'גליל מערבי',
  'כרמיאל': 'גליל מרכזי', 'טבריה': 'גליל מרכזי',
  'חיפה': 'חיפה', 'נתניה': 'שרון', 'הרצליה': 'גוש דן',
  'תל אביב': 'גוש דן', 'רמת גן': 'גוש דן', 'פתח תקווה': 'גוש דן', 'ראשון לציון': 'גוש דן',
  'ירושלים': 'ירושלים', 'אשדוד': 'שפלה', 'אשקלון': 'שפלה',
  'שדרות': 'עוטף עזה', 'נתיבות': 'עוטף עזה', 'אופקים': 'עוטף עזה',
  'באר שבע': 'נגב', 'אילת': 'אילת',
};

function getRegionForCity(city: string): string {
  if (CITY_TO_REGION[city]) return CITY_TO_REGION[city];
  for (const [name, region] of Object.entries(CITY_TO_REGION)) {
    if (city.includes(name) || name.includes(city)) return region;
  }
  return city;
}

function getShelterSecForCity(city: string): number {
  if (SHELTER_TIMES[city] !== undefined) return SHELTER_TIMES[city];
  for (const [name, sec] of Object.entries(SHELTER_TIMES)) {
    if (city.includes(name) || name.includes(city)) return sec;
  }
  return 90;
}

type ViewState = 'standby' | 'alert' | 'map';

// Auto-follow vehicle location
const FollowVehicle = ({ gps, enabled }: { gps: { lat: number; lon: number; speed: number | null; heading?: number | null } | null; enabled: boolean }) => {
  const map = useMap();
  const prevPos = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (!enabled || !gps) return;
    const pos: [number, number] = [gps.lat, gps.lon];
    // Only pan if moved > ~50m
    if (prevPos.current) {
      const dLat = Math.abs(pos[0] - prevPos.current[0]);
      const dLon = Math.abs(pos[1] - prevPos.current[1]);
      if (dLat < 0.0005 && dLon < 0.0005) return;
    }
    prevPos.current = pos;
    map.panTo(pos, { animate: true, duration: 1 });
  }, [gps, enabled, map]);

  return null;
};

const MapController = ({ center, zoom }: { center: [number, number] | null; zoom: number | null }) => {
  const map = useMap();
  useEffect(() => {
    if (center && zoom) map.flyTo(center, zoom, { duration: 1.5 });
  }, [center, zoom, map]);
  return null;
};

const CarPlayMode = () => {
  const navigate = useNavigate();
  const { t, dir, speechLang } = useLocale();
  const [orefAlerts, setOrefAlerts] = useState<any[]>([]);
  const [countdownTick, setCountdownTick] = useState(0);
  const [viewState, setViewState] = useState<ViewState>('standby');
  const [userGPS, setUserGPS] = useState<{ lat: number; lon: number; speed: number | null; heading: number | null } | null>(null);
  const prevAlertRef = useRef(false);
  const [followVehicle, setFollowVehicle] = useState(true);
  const stoppedSinceRef = useRef<number | null>(null);


  // Voice commands for CarPlay
  const voiceCommands = useMemo((): VoiceCommand[] => [
    { pattern: /צפה.*מפה|view.*map|show.*map|bekijk.*kaart/i, action: () => setViewState('map'), description: t('carplay.viewMap') },
    { pattern: /חזור|back|terug|standby/i, action: () => setViewState('standby'), description: t('carplay.returnStandby') },
    { pattern: /נהיגה|drive.*mode|rijmodus/i, action: () => { window.location.href = '/drive'; }, description: t('carplay.driveMode') },
    { pattern: /חזור.*הביתה|go.*home|naar.*huis/i, action: () => { window.location.href = '/'; }, description: 'Home' },
  ], [t]);

  const voice = useVoiceControl({ lang: speechLang, commands: voiceCommands });

  // Tick every second
  useEffect(() => {
    const t = setInterval(() => setCountdownTick(v => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Simulated GPS route along Tel Aviv streets
  const SIM_ROUTE: [number, number][] = useMemo(() => [
    [32.0644, 34.7781], // Rothschild & Allenby
    [32.0655, 34.7775],
    [32.0668, 34.7768],
    [32.0680, 34.7760], // Rothschild & Herzl
    [32.0695, 34.7752],
    [32.0710, 34.7744],
    [32.0725, 34.7736], // Rothschild & Habima
    [32.0738, 34.7728],
    [32.0750, 34.7720],
    [32.0758, 34.7730], // Turn towards Dizengoff
    [32.0768, 34.7742],
    [32.0780, 34.7755],
    [32.0792, 34.7768], // Dizengoff Square area
    [32.0805, 34.7780],
    [32.0820, 34.7790],
    [32.0835, 34.7798],
    [32.0850, 34.7805], // Dizengoff north
    [32.0865, 34.7812],
    [32.0878, 34.7818],
    [32.0890, 34.7825],
    [32.0900, 34.7835], // Turn towards port
    [32.0908, 34.7828],
    [32.0918, 34.7818],
    [32.0928, 34.7808],
    [32.0935, 34.7795], // Near Tel Aviv Port
    [32.0940, 34.7780],
    [32.0938, 34.7765],
    [32.0930, 34.7750], // Along the coast south
    [32.0918, 34.7742],
    [32.0905, 34.7738],
    [32.0890, 34.7735],
    [32.0875, 34.7732],
    [32.0858, 34.7730], // Back towards Dizengoff
    [32.0840, 34.7735],
    [32.0822, 34.7742],
    [32.0805, 34.7750],
    [32.0788, 34.7758],
    [32.0770, 34.7765],
    [32.0752, 34.7772],
    [32.0735, 34.7778],
    [32.0718, 34.7782],
    [32.0700, 34.7785],
    [32.0682, 34.7783],
    [32.0665, 34.7780],
    [32.0650, 34.7778], // Back to start area
  ], []);

  const [simIndex, setSimIndex] = useState(0);
  const [isSimulating, setIsSimulating] = useState(false);

  // Real GPS attempt
  useEffect(() => {
    if (!navigator.geolocation) {
      setIsSimulating(true);
      return;
    }
    let gotPosition = false;
    const timeout = setTimeout(() => {
      if (!gotPosition) setIsSimulating(true);
    }, 3000);
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        gotPosition = true;
        setIsSimulating(false);
        setUserGPS({ lat: pos.coords.latitude, lon: pos.coords.longitude, speed: pos.coords.speed, heading: pos.coords.heading });
      },
      () => { setIsSimulating(true); },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 5000 }
    );
    return () => { clearTimeout(timeout); navigator.geolocation.clearWatch(watchId); };
  }, []);

  // Auto-exit CarPlay when driving stops (real GPS speed < 5 km/h sustained for 30s)
  useEffect(() => {
    if (isSimulating || !userGPS) return;
    const kmh = (userGPS.speed ?? 0) * 3.6;
    if (kmh < 5) {
      if (stoppedSinceRef.current === null) {
        stoppedSinceRef.current = Date.now();
      } else if (Date.now() - stoppedSinceRef.current > 30_000) {
        sessionStorage.setItem('drive-detect-dismissed', String(Date.now() + 60_000));
        const returnTo = sessionStorage.getItem('carplay-return-to') || '/';
        sessionStorage.removeItem('carplay-return-to');
        navigate(returnTo, { replace: true });
      }
    } else {
      stoppedSinceRef.current = null;
    }
  }, [userGPS, isSimulating, navigate]);

  // Simulated GPS movement
  useEffect(() => {
    if (!isSimulating) return;
    const interval = setInterval(() => {
      setSimIndex(prev => {
        const next = (prev + 1) % SIM_ROUTE.length;
        const curr = SIM_ROUTE[prev];
        const nextPt = SIM_ROUTE[next];
        // Calculate heading
        const dLon = nextPt[1] - curr[1];
        const dLat = nextPt[0] - curr[0];
        const heading = (Math.atan2(dLon, dLat) * 180 / Math.PI + 360) % 360;
        // Simulate ~40 km/h
        const speed = 10 + Math.random() * 4; // m/s (~36-50 km/h)
        setUserGPS({ lat: curr[0], lon: curr[1], speed, heading });
        return next;
      });
    }, 1200);
    return () => clearInterval(interval);
  }, [isSimulating, SIM_ROUTE]);

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
      .channel('carplay-oref')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'oref_alerts' }, () => fetchAlerts())
      .subscribe();
    return () => { clearInterval(interval); supabase.removeChannel(channel); };
  }, []);

  // ── Auto-redirect to war room on critical alert ──
  const redirectedRef = useRef(false);
  useEffect(() => {
    if (redirectedRef.current) return;
    const now = Date.now();
    const freshSiren = orefAlerts.some(a => {
      const alertTime = new Date(a.alert_date).getTime();
      return (now - alertTime) < 60_000;
    });
    if (freshSiren) {
      redirectedRef.current = true;
      navigate('/', { replace: true });
    }
  }, [orefAlerts, navigate]);

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
    const zones: { id: string; title: string; locations: string[]; alertDate: number }[] = [];
    for (const a of orefAlerts) {
      const t = (a.title || '');
      if (t.includes('שחרור') || t.includes('הותר')) continue;
      const alertTime = new Date(a.alert_date).getTime();
      if (now - alertTime > 600000) continue;
      const locs = (a.locations || []) as string[];
      const activeLocs = locs.filter(loc => {
        const relTime = releaseMap.get(loc) || 0;
        return relTime < alertTime;
      });
      if (activeLocs.length === 0) continue;
      zones.push({ id: a.id, title: t, locations: activeLocs, alertDate: alertTime });
    }
    return zones;
  }, [orefAlerts]);

  const isEmergency = emergencyZones.length > 0;

  // Auto-switch to alert when emergency detected
  useEffect(() => {
    if (isEmergency && !prevAlertRef.current) {
      setViewState('alert');
    }
    if (!isEmergency && prevAlertRef.current) {
      const timer = setTimeout(() => setViewState('standby'), 10000);
      return () => clearTimeout(timer);
    }
    prevAlertRef.current = isEmergency;
  }, [isEmergency]);

  // Region alerts with countdowns
  const regionAlerts = useMemo(() => {
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
          if (zone.alertDate < existing.alertDate) existing.alertDate = zone.alertDate;
          if (shelterSec < existing.shelterSec) existing.shelterSec = shelterSec;
        }
      }
    }
    const results: { regionName: string; countdown: string | null; shelterExpired: boolean; elapsed: string }[] = [];
    for (const [regionName, data] of regionMap) {
      const ageMs = now - data.alertDate;
      const elapsedMins = Math.floor(ageMs / 60000);
      const elapsedSecs = Math.floor((ageMs % 60000) / 1000);
      const remainingMs = Math.max(0, data.shelterSec * 1000 - ageMs);
      const remainMins = Math.floor(remainingMs / 60000);
      const remainSecs = Math.floor((remainingMs % 60000) / 1000);
      results.push({
        regionName,
        countdown: remainingMs > 0 ? `${String(remainMins).padStart(2, '0')}:${String(remainSecs).padStart(2, '0')}` : null,
        shelterExpired: remainingMs <= 0,
        elapsed: `+${String(elapsedMins).padStart(2, '0')}:${String(elapsedSecs).padStart(2, '0')}`,
      });
    }
    results.sort((a, b) => (a.shelterExpired !== b.shelterExpired ? (a.shelterExpired ? 1 : -1) : 0));
    return results;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emergencyZones, countdownTick]);

  const israelTime = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Jerusalem' });

  // Alert markers for map
  const alertMarkers = useMemo(() => {
    const markers: { lat: number; lon: number; name: string; ageMs: number }[] = [];
    const now = Date.now();
    for (const a of orefAlerts) {
      const t = (a.title || '');
      if (t.includes('שחרור') || t.includes('הותר')) continue;
      if (now - new Date(a.alert_date).getTime() > 600000) continue;
      for (const loc of (a.locations || [])) {
        const trimmed = loc.trim();
        let gps = CITY_GPS[trimmed] || null;
        if (!gps) {
          for (const [name, coords] of Object.entries(CITY_GPS)) {
            if (trimmed.includes(name) || name.includes(trimmed)) { gps = coords; break; }
          }
        }
        if (gps && !markers.some(m => Math.abs(m.lat - gps!.lat) < 0.02 && Math.abs(m.lon - gps!.lon) < 0.02)) {
          markers.push({ ...gps, name: trimmed, ageMs: now - new Date(a.alert_date).getTime() });
        }
      }
    }
    return markers;
  }, [orefAlerts]);

  const mapCenter: [number, number] = userGPS ? [userGPS.lat, userGPS.lon] : [31.5, 34.9];

  // ════════════════════════════════════════════
  // STANDBY — minimal background display for CarPlay
  // Large status indicator, time, "view system" button
  // ════════════════════════════════════════════
  if (viewState === 'standby') {
    return (
      <div
        dir={dir}
        role="main"
        aria-label={t('carplay.standby')}
        className="fixed inset-0 flex flex-col items-center justify-center"
        style={{
          background: 'linear-gradient(180deg, #0a0a0a 0%, #111 50%, #0a0a0a 100%)',
          fontFamily: "'Heebo', sans-serif",
        }}
      >
        <div className="flex flex-col items-center gap-6">
          <div
            className="w-24 h-24 rounded-full flex items-center justify-center"
            style={{
              background: 'radial-gradient(circle, rgba(0,230,118,0.15) 0%, transparent 70%)',
              border: '3px solid rgba(0,230,118,0.4)',
              boxShadow: '0 0 40px rgba(0,230,118,0.2)',
            }}
          >
            <div className="w-8 h-8 rounded-full bg-[#00e676]" style={{ boxShadow: '0 0 20px #00e676, 0 0 40px rgba(0,230,118,0.3)' }} />
          </div>
          <div className="text-center">
            <div className="text-[#00e676] text-2xl font-bold tracking-wide">{t('status.noAlerts')}</div>
            <div className="text-white/40 text-sm font-mono mt-1">{t('status.systemMonitoring')}</div>
          </div>
        </div>

        <div className="mt-10 font-mono text-6xl font-black tracking-wider" style={{ color: '#42a5f5', textShadow: '0 0 20px rgba(66,165,245,0.3)' }}>
          {israelTime}
        </div>

        {userGPS?.speed !== null && userGPS?.speed !== undefined && userGPS.speed > 1 && (
          <div className="mt-4 font-mono text-xl" style={{ color: '#42a5f5' }}>
            {Math.round(userGPS.speed * 3.6)} {t('status.kmh')}
          </div>
        )}

        <div className="mt-12 flex gap-6">
          <button
            onClick={() => setViewState('map')}
            className="px-8 py-5 rounded-2xl text-lg font-bold transition-all active:scale-95"
            style={{
              background: 'linear-gradient(135deg, rgba(66,165,245,0.2) 0%, rgba(66,165,245,0.1) 100%)',
              border: '2px solid rgba(66,165,245,0.4)',
              color: '#42a5f5',
              minWidth: '160px',
            }}
          >
            {t('carplay.viewMap')}
          </button>
          {voice.supported && (
            <button
              onClick={voice.toggleListening}
              className="px-8 py-5 rounded-2xl text-lg font-bold transition-all active:scale-95"
              style={{
                background: voice.isListening ? 'rgba(0,230,118,0.2)' : 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)',
                border: `2px solid ${voice.isListening ? 'rgba(0,230,118,0.5)' : 'rgba(255,255,255,0.15)'}`,
                color: voice.isListening ? '#00e676' : 'rgba(255,255,255,0.6)',
                minWidth: '160px',
                animation: voice.isListening ? 'pulse 1.5s infinite' : 'none',
              }}
            >
              {voice.isListening ? t('voice.listening') : t('voice.activate')}
            </button>
          )}
          <a
            href="/drive"
            className="px-8 py-5 rounded-2xl text-lg font-bold transition-all active:scale-95 no-underline"
            style={{
              background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.03) 100%)',
              border: '2px solid rgba(255,255,255,0.15)',
              color: 'rgba(255,255,255,0.6)',
              minWidth: '160px',
              textAlign: 'center',
              textDecoration: 'none',
            }}
          >
            {t('carplay.driveMode')}
          </a>
        </div>

        {voice.isListening && voice.lastTranscript && (
          <div className="mt-4 font-mono text-sm text-white/40">"{voice.lastTranscript}"</div>
        )}

        <div className="absolute bottom-6 left-0 right-0 flex items-center justify-center gap-4">
          <div className="w-2 h-2 rounded-full bg-[#00e676]" style={{ animation: 'pulse 2s ease-in-out infinite', boxShadow: '0 0 8px #00e676' }} />
          <span className="font-mono text-xs" style={{ color: '#00e67666' }}>{t('carplay.footer')}</span>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════
  // ALERT — full takeover emergency display
  // Maximum visibility, huge countdown, red flash
  // ════════════════════════════════════════════
  if (viewState === 'alert') {
    return (
      <div
        dir={dir}
        role="main"
        aria-label={t('carplay.alertMode')}
        className="fixed inset-0 flex flex-col"
        style={{
          background: isEmergency
            ? 'linear-gradient(180deg, #1a0000 0%, #2d0000 30%, #1a0000 100%)'
            : 'linear-gradient(180deg, #0a0a0a 0%, #111 50%, #0a0a0a 100%)',
          fontFamily: "'Heebo', sans-serif",
          animation: isEmergency ? 'carplay-flash 1s ease-in-out infinite' : 'none',
        }}
      >
        {/* Top banner */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{
            background: isEmergency ? 'rgba(255,23,68,0.15)' : 'rgba(0,0,0,0.5)',
            borderBottom: isEmergency ? '3px solid rgba(255,23,68,0.6)' : '1px solid rgba(255,255,255,0.1)',
          }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-5 h-5 rounded-full"
              style={{
                background: isEmergency ? '#ff1744' : '#00e676',
                boxShadow: isEmergency ? '0 0 20px #ff1744' : '0 0 10px #00e676',
                animation: isEmergency ? 'blink-warning 0.5s infinite' : 'none',
              }}
            />
            <span className="text-xl font-black" style={{ color: isEmergency ? '#ff1744' : '#00e676' }}>
              {isEmergency ? t('status.alert') : t('status.noAlerts')}
            </span>
          </div>
          <span className="font-mono text-3xl font-black" style={{ color: '#42a5f5', textShadow: '0 0 10px rgba(66,165,245,0.4)' }}>
            {israelTime}
          </span>
        </div>

        {/* Main content — region countdowns */}
        <div className="flex-1 flex flex-col items-center justify-center gap-6 px-6">
          {regionAlerts.length > 0 ? (
            regionAlerts.slice(0, 4).map((ra) => (
              <div
                key={ra.regionName}
                className="w-full max-w-md flex items-center justify-between px-6 py-5 rounded-2xl"
                style={{
                  background: ra.shelterExpired
                    ? 'linear-gradient(135deg, rgba(255,23,68,0.2) 0%, rgba(255,23,68,0.08) 100%)'
                    : 'linear-gradient(135deg, rgba(255,145,0,0.2) 0%, rgba(255,145,0,0.08) 100%)',
                  border: `2px solid ${ra.shelterExpired ? 'rgba(255,23,68,0.5)' : 'rgba(255,145,0,0.5)'}`,
                }}
              >
                <div>
                  <div className="text-xl font-black" style={{ color: ra.shelterExpired ? '#ff1744' : '#ff9100' }}>
                    🚨 {ra.regionName}
                  </div>
                  <div className="font-mono text-sm mt-1" style={{ color: 'rgba(255,255,255,0.4)' }}>
                    {ra.shelterExpired ? t('time.expired') : t('time.shelter')}
                  </div>
                </div>
                <div className="text-center">
                  <div
                    className="font-mono font-black"
                    style={{
                      fontSize: '52px', lineHeight: 1,
                      color: ra.shelterExpired ? '#ff1744' : '#ff9100',
                      textShadow: `0 0 30px ${ra.shelterExpired ? 'rgba(255,23,68,0.5)' : 'rgba(255,145,0,0.4)'}`,
                      animation: ra.shelterExpired ? 'blink-warning 0.5s infinite' : 'none',
                    }}
                  >
                    {ra.countdown || '⚠'}
                  </div>
                  <div className="font-mono text-sm" style={{ color: '#ff174488' }}>
                    {ra.elapsed}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="text-center">
              <div className="text-[#00e676] text-2xl font-bold">{t('carplay.noActiveAlerts')}</div>
              <div className="text-white/30 text-sm mt-2">{t('carplay.returnStandby')}...</div>
            </div>
          )}
        </div>

        {/* Bottom buttons */}
        <div className="flex items-center justify-center gap-4 px-6 py-5" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <button
            onClick={() => setViewState('map')}
            className="px-6 py-4 rounded-xl text-base font-bold active:scale-95"
            style={{ background: 'rgba(66,165,245,0.15)', border: '2px solid rgba(66,165,245,0.4)', color: '#42a5f5' }}
          >
            {t('carplay.viewMap')}
          </button>
          {voice.supported && (
            <button
              onClick={voice.toggleListening}
              className="px-6 py-4 rounded-xl text-base font-bold active:scale-95"
              style={{
                background: voice.isListening ? 'rgba(0,230,118,0.2)' : 'rgba(255,255,255,0.05)',
                border: `2px solid ${voice.isListening ? 'rgba(0,230,118,0.5)' : 'rgba(255,255,255,0.15)'}`,
                color: voice.isListening ? '#00e676' : 'rgba(255,255,255,0.5)',
              }}
            >
              {voice.isListening ? t('voice.listening') : '🎤'}
            </button>
          )}
          <button
            onClick={() => setViewState('standby')}
            className="px-6 py-4 rounded-xl text-base font-bold active:scale-95"
            style={{ background: 'rgba(255,255,255,0.05)', border: '2px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.5)' }}
          >
            {t('carplay.returnStandby')}
          </button>
        </div>

        {/* Emergency border */}
        {isEmergency && (
          <div className="absolute inset-0 pointer-events-none" style={{
            border: '4px solid rgba(255,23,68,0.5)',
            animation: 'critical-glow 1.5s ease-in-out infinite',
          }} />
        )}
      </div>
    );
  }

  // ════════════════════════════════════════════
  // MAP — manual full map view from CarPlay
  // Simplified map with large back button
  // ════════════════════════════════════════════
  return (
    <div dir={dir} className="fixed inset-0" style={{ background: '#000', fontFamily: "'Heebo', sans-serif" }}>
      <MapContainer
        center={mapCenter}
        zoom={userGPS ? 15 : 9}
        minZoom={4}
        maxZoom={18}
        className="absolute inset-0 z-0"
        style={{ background: '#000' }}
        zoomControl={false}
        attributionControl={false}
      >
        {!userGPS && <FitIsraelBounds />}
        <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
        <FollowVehicle gps={userGPS} enabled={followVehicle} />

        {/* Vehicle marker with heading arrow */}
        {userGPS && (
          <>
            <Circle center={[userGPS.lat, userGPS.lon]} radius={80} pathOptions={{ color: '#2196f3', fillColor: '#2196f3', fillOpacity: 0.1, weight: 1 }} />
            <Marker
              position={[userGPS.lat, userGPS.lon]}
              icon={L.divIcon({
                className: '',
                html: `<div style="
                  width:32px;height:32px;
                  transform: translate(-50%,-50%) rotate(${userGPS.heading || 0}deg);
                  display:flex;align-items:center;justify-content:center;
                ">
                  <div style="
                    width:0;height:0;
                    border-left:10px solid transparent;
                    border-right:10px solid transparent;
                    border-bottom:24px solid #2196f3;
                    filter: drop-shadow(0 0 8px rgba(33,150,243,0.8));
                  "></div>
                </div>`,
                iconSize: [0, 0],
                iconAnchor: [0, 0],
              })}
            />
          </>
        )}

        {/* Alert markers */}
        {alertMarkers.map((m, i) => {
          const color = m.ageMs < 120000 ? '#ff1744' : '#ff6d00';
          return (
            <React.Fragment key={`a-${i}`}>
              <Circle center={[m.lat, m.lon]} radius={5000} pathOptions={{ color, fillColor: color, fillOpacity: 0.08, weight: 2, opacity: 0.5, dashArray: '8 4' }} />
              <Circle center={[m.lat, m.lon]} radius={2500} pathOptions={{ color, fillColor: color, fillOpacity: 0.15, weight: 3, opacity: 0.8 }} />
              <Marker
                position={[m.lat, m.lon]}
                icon={L.divIcon({
                  className: '',
                  html: `<div style="font-size:18px;color:${color};font-weight:900;text-shadow:0 0 10px ${color};white-space:nowrap;transform:translate(-50%,-50%);">🚨 ${m.name}</div>`,
                  iconSize: [0, 0], iconAnchor: [0, 0],
                })}
              />
            </React.Fragment>
          );
        })}
      </MapContainer>

      {/* Top bar */}
      <div
        className="absolute top-0 left-0 right-0 z-[1000] flex items-center justify-between px-6 py-4"
        style={{ background: 'linear-gradient(to bottom, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.4) 80%, transparent 100%)' }}
      >
        <div className="flex items-center gap-3">
          <div
            className={`w-4 h-4 rounded-full ${isEmergency ? 'animate-pulse' : ''}`}
            style={{ background: isEmergency ? '#ff1744' : '#00e676', boxShadow: isEmergency ? '0 0 15px #ff1744' : '0 0 10px #00e676' }}
          />
          <span className="text-lg font-bold" style={{ color: isEmergency ? '#ff1744' : '#00e676' }}>
            {isEmergency ? t('status.activeAlert') : t('status.noAlerts')}
          </span>
        </div>
        <span className="font-mono text-2xl font-black" style={{ color: '#42a5f5' }}>{israelTime}</span>
      </div>

      {/* Speed display — bottom left, shows during simulation too */}
      {(userGPS?.speed !== null && userGPS?.speed !== undefined && userGPS.speed > 0.5) || isSimulating && (
        <div
          className="absolute bottom-28 left-6 z-[1000] flex flex-col items-center px-5 py-3 rounded-2xl"
          style={{ background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(10px)', border: '2px solid rgba(66,165,245,0.3)' }}
        >
          <span className="font-mono text-4xl font-black" style={{ color: '#42a5f5', textShadow: '0 0 15px rgba(66,165,245,0.4)' }}>
            {userGPS?.speed ? Math.round(userGPS.speed * 3.6) : '—'}
          </span>
          <span className="font-mono text-xs" style={{ color: 'rgba(66,165,245,0.5)' }}>km/h</span>
          {isSimulating && (
            <span className="font-mono text-[10px] mt-1 px-2 py-0.5 rounded" style={{ background: 'rgba(255,145,0,0.2)', color: '#ff9100', border: '1px solid rgba(255,145,0,0.3)' }}>SIM</span>
          )}
        </div>
      )}

      {/* Recenter button — bottom right */}
      <button
        onClick={() => setFollowVehicle(true)}
        className="absolute bottom-28 right-6 z-[1000] w-14 h-14 rounded-full flex items-center justify-center active:scale-95"
        style={{
          background: followVehicle ? 'rgba(33,150,243,0.2)' : 'rgba(0,0,0,0.85)',
          border: `2px solid ${followVehicle ? 'rgba(33,150,243,0.5)' : 'rgba(255,255,255,0.2)'}`,
          backdropFilter: 'blur(10px)',
        }}
      >
        <span style={{ fontSize: 24 }}>📍</span>
      </button>

      {/* Bottom buttons bar */}
      <div className="absolute bottom-0 left-0 right-0 z-[1000] flex items-center justify-center gap-4 px-6 py-4"
        style={{ background: 'linear-gradient(to top, rgba(0,0,0,0.95) 0%, rgba(0,0,0,0.6) 80%, transparent 100%)' }}
      >
        <button
          onClick={() => setViewState(isEmergency ? 'alert' : 'standby')}
          className="px-8 py-4 rounded-2xl text-lg font-bold active:scale-95"
          style={{
            background: 'rgba(255,255,255,0.08)',
            border: '2px solid rgba(255,255,255,0.2)',
            color: 'rgba(255,255,255,0.7)',
          }}
        >
          {t('carplay.returnStandby')}
        </button>
      </div>

      {/* Emergency banner overlay on map */}
      {isEmergency && regionAlerts.length > 0 && (
        <div
          className="absolute top-20 left-4 right-4 z-[1000] flex items-center justify-center gap-6 px-4 py-4 rounded-2xl"
          style={{
            background: 'rgba(180,0,0,0.9)',
            border: '3px solid rgba(255,23,68,0.7)',
            backdropFilter: 'blur(10px)',
            animation: 'carplay-flash 1s ease-in-out infinite',
          }}
        >
          {regionAlerts.slice(0, 3).map((ra) => (
            <div key={ra.regionName} className="text-center">
              <div className="font-bold text-base" style={{ color: '#ff9100' }}>🚨 {ra.regionName}</div>
              <div
                className="font-mono font-black text-4xl"
                style={{
                  color: ra.shelterExpired ? '#ff1744' : '#ff9100',
                  textShadow: `0 0 20px ${ra.shelterExpired ? '#ff1744' : '#ff9100'}`,
                  animation: ra.shelterExpired ? 'blink-warning 0.5s infinite' : 'none',
                }}
              >
                {ra.countdown || '⚠'}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Emergency red border */}
      {isEmergency && (
        <div className="absolute inset-0 pointer-events-none z-[999]" style={{
          border: '4px solid rgba(255,23,68,0.6)',
          animation: 'critical-glow 1.5s ease-in-out infinite',
        }} />
      )}
    </div>
  );
};

export default CarPlayMode;

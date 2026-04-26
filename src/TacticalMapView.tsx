import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useTheme, type ThemeMode } from '@/hooks/useTheme';
import { useOSRMRoutes, isWithinIsraelRenderBounds } from '@/hooks/useOSRMRoutes';
import { MapContainer, TileLayer, CircleMarker, Circle, Popup, Polyline, Polygon, useMap, Marker } from 'react-leaflet';
import L from 'leaflet';
import { useWarRoom, type Alert } from '@/hooks/useWarRoom';
import { useTelegram } from '@/hooks/useTelegram';
import { supabase } from '@/integrations/supabase/client';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';
import FitIsraelBounds from './FitIsraelBounds';
import GlobeView from './GlobeView';
import SentimentTrend from './SentimentTrend';
import { classifyMdaEvent } from '@/lib/mda-event-types';
import EmergencyTakeover from './EmergencyTakeover';
import DailyIntelReport from './DailyIntelReport';
import AnalysisStatusPanel from './AnalysisStatusPanel';
import TzofarDisplay from './TzofarDisplay';
import TgSeveritySummary from './TgSeveritySummary';
import { useUavWatch, type UavRiskLevel } from '@/hooks/useUavWatch';
import { useGlobalEvents, type GlobalCategory, type GlobalSeverity } from '@/hooks/useGlobalEvents';
import { useFlightsBoard, type FlightPhase } from '@/hooks/useFlightsBoard';
import FlightMonitorLazy from '@/components/FlightMonitor';
import GlobalDataMonitor from '@/components/GlobalDataMonitor';
import DisasterMonitor from '@/components/DisasterMonitor';
import { DATA_CENTERS, GROUND_STATIONS, SATELLITES, PROVIDER_COLOR, OPERATOR_COLOR } from '@/lib/infra-data';
import { SUBMARINE_CABLES, BACKBONE_LINKS } from '@/lib/data-routes';
import DataFlowParticles, { type FlowPath, type LoadStatus } from './DataFlowParticles';
import AuroraCableLayer, { type CableLoad } from './AuroraCableLayer';
import MetroDataTrafficLayer from './MetroDataTrafficLayer';
import { CELL_TOWERS, CARRIER_META, aggregateByCity, type Carrier } from '@/lib/cell-towers-il';
import CellComparisonPanel from './CellComparisonPanel';
import { TRAIN_STATIONS, BUS_TERMINALS, LIGHT_RAIL_STOPS, MALLS, TRANSIT_COLOR, TRANSIT_ICON, type TransitNode } from '@/lib/israel-transit';
import { useCloudStatus, type CloudLoadStatus } from '@/hooks/useCloudStatus';
import { useTransitStatus } from '@/hooks/useTransitStatus';
import { GLOBAL_ZONES, RISK_LABEL } from '@/lib/global-zones';
import WorldPopTileLayer from './WorldPopTileLayer';
import { useCellTowerStatus, cityToRegion, type CellTier } from '@/hooks/useCellTowerStatus';
import InfraStatusPanel from './InfraStatusPanel';
import TransitPanel from './TransitPanel';
import WeatherEmergency from './WeatherEmergency';
import EmergencyMonitor from './EmergencyMonitor';

const UAV_RISK_COLOR: Record<UavRiskLevel, string> = {
  critical: '#ff1744',
  high: '#ff6d00',
  medium: '#ffd600',
  low: '#00e5ff',
};

const GLOBAL_SEVERITY_COLOR: Record<GlobalSeverity, string> = {
  red: '#ff1744',
  orange: '#ff6d00',
  green: '#66bb6a',
};

const GLOBAL_CATEGORY_ICON: Record<GlobalCategory, string> = {
  earthquake: '🌍',
  cyclone: '🌀',
  flood: '🌊',
  volcano: '🌋',
  drought: '☀️',
  wildfire: '🔥',
  other: '⚠️',
};

const PHASE_COLOR: Record<FlightPhase, string> = {
  departing: '#00e676',
  arriving: '#00b0ff',
  approach: '#ffab00',
  taxi: '#9e9e9e',
  enroute: '#7c4dff',
};

const PHASE_LABEL_HE: Record<FlightPhase, string> = {
  departing: 'ממריא',
  arriving: 'נוחת',
  approach: 'מתקרב',
  taxi: 'בקרקע',
  enroute: 'בדרך',
};

// ── Heatmap Layer (imperative, uses leaflet.heat) ──
const HeatmapLayer = ({ points, visible }: { points: [number, number, number][]; visible: boolean }) => {
  const map = useMap();
  const layerRef = useRef<any>(null);

  useEffect(() => {
    if (!visible) {
      if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }
      return;
    }
    if (typeof (L as any).heatLayer !== 'function') {
      console.warn('leaflet.heat not available');
      return;
    }
    // Filter out any invalid points
    const validPoints = points.filter(p => typeof p[0] === 'number' && typeof p[1] === 'number' && !isNaN(p[0]) && !isNaN(p[1]));
    if (validPoints.length === 0) return;
    try {
      if (layerRef.current) {
        layerRef.current.setLatLngs(validPoints);
      } else {
        layerRef.current = (L as any).heatLayer(validPoints, {
          radius: 35,
          blur: 25,
          maxZoom: 14,
          max: 1.0,
          gradient: { 0.2: '#00e676', 0.4: '#ffab00', 0.6: '#ff6d00', 0.8: '#ff3d00', 1.0: '#ff1744' },
        }).addTo(map);
      }
    } catch (e) {
      console.warn('Heatmap error:', e);
    }
    return () => {
      if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }
    };
  }, [map, points, visible]);

  return null;
};

// ── Thermal FIRMS Heatmap — infrared-style continuous gradient over hotspots ──
const ThermalFirmsHeatmap = ({ hotspots, visible }: { hotspots: any[]; visible: boolean }) => {
  const map = useMap();
  const layerRef = useRef<any>(null);

  useEffect(() => {
    if (!visible || hotspots.length === 0) {
      if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }
      return;
    }
    if (typeof (L as any).heatLayer !== 'function') return;

    const points: [number, number, number][] = hotspots
      .filter((h: any) => typeof h.latitude === 'number' && typeof h.longitude === 'number')
      .map((h: any) => {
        const intensity = h.intensity === 'extreme' ? 1.0 : h.intensity === 'high' ? 0.75 : 0.45;
        const frpBoost = Math.min((h.frp || 0) / 150, 1);
        return [h.latitude, h.longitude, Math.max(0.3, intensity * 0.6 + frpBoost * 0.4)] as [number, number, number];
      });

    if (points.length === 0) return;

    try {
      if (layerRef.current) {
        layerRef.current.setLatLngs(points);
      } else {
        layerRef.current = (L as any).heatLayer(points, {
          radius: 45,
          blur: 30,
          maxZoom: 12,
          max: 1.0,
          minOpacity: 0.25,
          gradient: {
            0.0: '#1a0a00',
            0.15: '#4a1000',
            0.3: '#8b2500',
            0.45: '#cc3700',
            0.55: '#e65100',
            0.65: '#ff6d00',
            0.75: '#ff9100',
            0.85: '#ffab00',
            0.92: '#ffd600',
            1.0: '#ffff8d',
          },
        }).addTo(map);
      }
    } catch (e) {
      console.warn('Thermal heatmap error:', e);
    }

    return () => {
      if (layerRef.current) { map.removeLayer(layerRef.current); layerRef.current = null; }
    };
  }, [map, hotspots, visible]);

  return null;
}
// ── Defense System Classification ──
type DefenseLayer = 'arrow3' | 'arrow2' | 'patriot' | 'davids_sling' | 'iron_dome' | 'iron_beam' | 'unknown';

interface DefenseSystemInfo {
  id: DefenseLayer;
  name: string;
  nameHe: string;
  color: string;
  altitudeRange: string; // e.g., "exo-atmospheric" or "endo-atmospheric"
  icon: string;
  maxAltKm: number;
  description: string;
}

const DEFENSE_LAYER_INFO: Record<DefenseLayer, DefenseSystemInfo> = {
  arrow3: { id: 'arrow3', name: 'Arrow 3', nameHe: 'חץ 3', color: '#7c4dff', altitudeRange: 'אקסו-אטמוספירי', icon: '🏹', maxAltKm: 100, description: 'יירוט מחוץ לאטמוספירה — טילים בליסטיים בינ"ל' },
  arrow2: { id: 'arrow2', name: 'Arrow 2', nameHe: 'חץ 2', color: '#448aff', altitudeRange: 'אקסו-אטמוספירי', icon: '🎯', maxAltKm: 50, description: 'יירוט בשכבה העליונה — טילים בליסטיים' },
  patriot: { id: 'patriot', name: 'Patriot PAC-3', nameHe: 'פטריוט', color: '#00b0ff', altitudeRange: 'אקסו/אנדו', icon: '🛡️', maxAltKm: 35, description: 'יירוט גבוה — טילים בליסטיים וטילי שיוט' },
  davids_sling: { id: 'davids_sling', name: "David's Sling", nameHe: 'קלע דוד', color: '#00e5ff', altitudeRange: 'אנדו-אטמוספירי', icon: '⚔️', maxAltKm: 15, description: 'יירוט בינוני — רקטות כבדות וטילי שיוט' },
  iron_dome: { id: 'iron_dome', name: 'Iron Dome', nameHe: 'כיפת ברזל', color: '#00e676', altitudeRange: 'אנדו-אטמוספירי', icon: '🟢', maxAltKm: 10, description: 'יירוט נמוך — רקטות קצרות טווח' },
  iron_beam: { id: 'iron_beam', name: 'Iron Beam', nameHe: 'קרן ברזל', color: '#76ff03', altitudeRange: 'אנדו-אטמוספירי', icon: '⚡', maxAltKm: 7, description: 'יירוט לייזר — רקטות ומרגמות קצרות טווח' },
  unknown: { id: 'unknown', name: 'Unknown', nameHe: 'לא מזוהה', color: '#ff9100', altitudeRange: '?', icon: '❓', maxAltKm: 0, description: '' },
};

// Classify which defense system engages based on threat type and origin
const classifyDefenseSystem = (threatCategory: string, originName: string, maxAltKm: number): DefenseLayer[] => {
  // Exo-atmospheric: ballistic from Iran/Iraq → Arrow 3 + Arrow 2 + Patriot
  if (originName.includes('איראן') || originName.includes('Iran')) {
    return ['arrow3', 'arrow2', 'patriot'];
  }
  if (originName.includes('עיראק') || originName.includes('Iraq')) {
    return ['arrow2', 'patriot', 'davids_sling'];
  }
  // Yemen — ballistic + cruise → Arrow + David's Sling
  if (originName.includes('תימן') || originName.includes('Yemen') || originName.includes("חות'י")) {
    if (threatCategory === 'cruise_missile') return ['davids_sling', 'patriot'];
    if (threatCategory === 'uav') return ['iron_dome', 'davids_sling'];
    return ['arrow2', 'patriot', 'davids_sling'];
  }
  // Lebanon — rockets → Iron Dome / David's Sling, UAV → Iron Dome
  if (originName.includes('לבנון') || originName.includes('חיזבאללה') || originName.includes('Hezbollah')) {
    if (threatCategory === 'uav') return ['iron_dome', 'iron_beam'];
    if (maxAltKm > 30) return ['davids_sling', 'iron_dome'];
    return ['iron_dome'];
  }
  // Gaza — rockets → Iron Dome / Iron Beam
  if (originName.includes('עזה') || originName.includes('חמאס') || originName.includes('Hamas') || originName.includes('Gaza')) {
    if (maxAltKm < 10) return ['iron_beam', 'iron_dome'];
    return ['iron_dome'];
  }
  // Default
  if (maxAltKm > 50) return ['arrow3', 'arrow2'];
  if (maxAltKm > 15) return ['davids_sling', 'patriot'];
  return ['iron_dome'];
};

function parseHotspotTimestamp(acqDate?: string | null, acqTime?: string | null): number | null {
  const normalizedTime = String(acqTime || '').trim();
  if (!normalizedTime) return null;

  if (normalizedTime.includes('T')) {
    const ts = new Date(normalizedTime).getTime();
    return Number.isFinite(ts) && ts > 0 ? ts : null;
  }

  const normalizedDate = String(acqDate || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate) && /^\d{1,4}$/.test(normalizedTime)) {
    const paddedTime = normalizedTime.padStart(4, '0');
    const hours = Number(paddedTime.slice(0, 2));
    const minutes = Number(paddedTime.slice(2, 4));

    if (hours < 24 && minutes < 60) {
      const ts = new Date(`${normalizedDate}T${paddedTime.slice(0, 2)}:${paddedTime.slice(2, 4)}:00Z`).getTime();
      return Number.isFinite(ts) && ts > 0 ? ts : null;
    }
  }

  const fallbackTs = new Date(normalizedTime).getTime();
  return Number.isFinite(fallbackTs) && fallbackTs > 0 ? fallbackTs : null;
}

function formatElapsedMinutes(minutes: number): string {
  const safeMinutes = Math.max(0, minutes);
  return safeMinutes >= 60
    ? `${Math.floor(safeMinutes / 60)}ש' ${safeMinutes % 60}ד'`
    : `${safeMinutes}ד'`;
}

// ── Shockwave Layer — expanding rings from alert impact points ──
interface ShockwavePoint {
  lat: number;
  lon: number;
  startTime: number;
  color: string;
  id: string;
  defenseLayer?: DefenseLayer; // which system is engaging
}

const ShockwaveLayer = ({ points }: { points: ShockwavePoint[] }) => {
  const map = useMap();
  const layersRef = useRef<Map<string, L.Circle[]>>(new Map());
  const animFrameRef = useRef<number>(0);

  useEffect(() => {
    const DURATION = 4000;
    const MAX_RADIUS = 8000;
    const RING_COUNT = 3;

    const animate = () => {
      const now = Date.now();
      let hasActive = false;
      
      for (const point of points) {
        const elapsed = now - point.startTime;
        if (elapsed > DURATION) {
          const existing = layersRef.current.get(point.id);
          if (existing) {
            existing.forEach(c => map.removeLayer(c));
            layersRef.current.delete(point.id);
          }
          continue;
        }
        hasActive = true;

        const progress = elapsed / DURATION;
        const eased = 1 - Math.pow(1 - progress, 3);
        const opacity = Math.max(0, 1 - progress);

        if (!layersRef.current.has(point.id)) {
          const rings: L.Circle[] = [];
          for (let i = 0; i < RING_COUNT; i++) {
            const circle = L.circle([point.lat, point.lon], {
              radius: 100,
              color: point.color,
              fillColor: point.color,
              fillOpacity: 0,
              weight: 2.5 - i * 0.5,
              opacity: 0.8,
              interactive: false,
            }).addTo(map);
            rings.push(circle);
          }
          layersRef.current.set(point.id, rings);
        }

        const rings = layersRef.current.get(point.id)!;
        rings.forEach((ring, i) => {
          const ringDelay = i * 0.15;
          const ringProgress = Math.max(0, eased - ringDelay);
          const radius = ringProgress * MAX_RADIUS * (1 - i * 0.25);
          ring.setRadius(Math.max(1, radius));
          ring.setStyle({
            opacity: opacity * (1 - i * 0.2) * (0.3 + 0.7 * Math.sin(progress * Math.PI)),
            weight: Math.max(0.5, (2.5 - i * 0.5) * opacity),
            fillOpacity: Math.max(0, 0.06 * opacity * (1 - ringProgress)),
          });
        });
      }

      if (hasActive) {
        animFrameRef.current = requestAnimationFrame(animate);
      }
    };

    if (points.length > 0) {
      animFrameRef.current = requestAnimationFrame(animate);
    }

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      layersRef.current.forEach(rings => rings.forEach(c => map.removeLayer(c)));
      layersRef.current.clear();
    };
  }, [map, points]);

  return null;
};

// ── Types ──
type DemoScenario = 'calm' | 'escalation' | 'war' | 'multi_front' | 'lebanon_op';
type DataMode = 'demo' | 'live';
type TileTheme = 'dark' | 'light' | 'satellite' | 'thermal' | 'google' | 'google_satellite';

interface MapRegion {
  id: string;
  name: string;
  nameEn: string;
  lat: number;
  lon: number;
  severity: 'early_warning' | 'critical' | 'high' | 'warning' | 'medium' | 'low' | 'safe';
  shelterSec?: number;
  alertCount?: number;
  lastAlert?: string;
  population?: number;
  isCity?: boolean;
}

// ── Real GPS coordinates for Israeli cities & zones ──
const REGIONS: MapRegion[] = [
  // Northern border
  { id: 'lebanon', name: 'דרום לבנון', nameEn: 'S. Lebanon', lat: 33.35, lon: 35.30, severity: 'high' },
  // North
  { id: 'metula', name: 'מטולה', nameEn: 'Metula', lat: 33.28, lon: 35.58, severity: 'high', shelterSec: 0, alertCount: 12, lastAlert: '12:34', population: 2, isCity: true },
  { id: 'kiryat_shmona', name: 'קריית שמונה', nameEn: 'Kiryat Shmona', lat: 33.21, lon: 35.57, severity: 'high', shelterSec: 0, alertCount: 18, lastAlert: '12:31', population: 24, isCity: true },
  { id: 'safed', name: 'צפת', nameEn: 'Safed', lat: 32.97, lon: 35.50, severity: 'warning', shelterSec: 15, alertCount: 5, lastAlert: '11:45', population: 37, isCity: true },
  { id: 'nahariya', name: 'נהריה', nameEn: 'Nahariya', lat: 33.00, lon: 35.10, severity: 'warning', shelterSec: 15, alertCount: 7, lastAlert: '12:20', population: 60, isCity: true },
  { id: 'acre', name: 'עכו', nameEn: 'Acre', lat: 32.93, lon: 35.08, severity: 'medium', shelterSec: 30, alertCount: 3, lastAlert: '10:15', population: 50, isCity: true },
  { id: 'karmiel', name: 'כרמיאל', nameEn: 'Karmiel', lat: 32.92, lon: 35.30, severity: 'medium', shelterSec: 30, alertCount: 2, lastAlert: '09:50', population: 48, isCity: true },
  { id: 'tiberias', name: 'טבריה', nameEn: 'Tiberias', lat: 32.79, lon: 35.53, severity: 'medium', shelterSec: 30, alertCount: 3, lastAlert: '11:00', population: 46, isCity: true },
  { id: 'golan', name: 'רמת הגולן', nameEn: 'Golan Heights', lat: 32.95, lon: 35.78, severity: 'warning', shelterSec: 0, alertCount: 8 },
  // Haifa
  { id: 'haifa', name: 'חיפה', nameEn: 'Haifa', lat: 32.79, lon: 34.99, severity: 'medium', shelterSec: 60, alertCount: 2, lastAlert: '08:30', population: 285, isCity: true },
  { id: 'haifa_bay', name: 'מפרץ חיפה', nameEn: 'Haifa Bay', lat: 32.82, lon: 35.04, severity: 'medium' },
  { id: 'yokneam', name: 'יקנעם', nameEn: 'Yokneam', lat: 32.66, lon: 35.11, severity: 'low', shelterSec: 60, alertCount: 1, population: 22, isCity: true },
  { id: 'afula', name: 'עפולה', nameEn: 'Afula', lat: 32.61, lon: 35.29, severity: 'low', shelterSec: 60, alertCount: 1, population: 56, isCity: true },
  // Center
  { id: 'hadera', name: 'חדרה', nameEn: 'Hadera', lat: 32.44, lon: 34.92, severity: 'low', shelterSec: 90, population: 96, isCity: true },
  { id: 'netanya', name: 'נתניה', nameEn: 'Netanya', lat: 32.33, lon: 34.86, severity: 'low', shelterSec: 90, population: 230, isCity: true },
  { id: 'herzliya', name: 'הרצליה', nameEn: 'Herzliya', lat: 32.16, lon: 34.79, severity: 'safe', shelterSec: 90, population: 100, isCity: true },
  { id: 'tlv', name: 'תל אביב', nameEn: 'Tel Aviv', lat: 32.08, lon: 34.78, severity: 'medium', shelterSec: 90, alertCount: 4, lastAlert: '10:00', population: 460, isCity: true },
  { id: 'ramat_gan', name: 'רמת גן', nameEn: 'Ramat Gan', lat: 32.07, lon: 34.81, severity: 'medium', shelterSec: 90, population: 160, isCity: true },
  { id: 'petah_tikva', name: 'פתח תקווה', nameEn: 'Petah Tikva', lat: 32.09, lon: 34.88, severity: 'low', shelterSec: 90, population: 250, isCity: true },
  { id: 'rishon', name: 'ראשון לציון', nameEn: 'Rishon LeZion', lat: 31.97, lon: 34.80, severity: 'safe', shelterSec: 90, population: 255, isCity: true },
  { id: 'rehovot', name: 'רחובות', nameEn: 'Rehovot', lat: 31.89, lon: 34.81, severity: 'safe', shelterSec: 90, population: 145, isCity: true },
  { id: 'modiin', name: 'מודיעין', nameEn: 'Modiin', lat: 31.90, lon: 34.96, severity: 'safe', shelterSec: 90, population: 95, isCity: true },
  { id: 'bet_shemesh', name: 'בית שמש', nameEn: 'Bet Shemesh', lat: 31.73, lon: 34.99, severity: 'safe', shelterSec: 90, population: 130, isCity: true },
  { id: 'jerusalem', name: 'ירושלים', nameEn: 'Jerusalem', lat: 31.77, lon: 35.21, severity: 'warning', shelterSec: 90, alertCount: 2, lastAlert: '09:00', population: 950, isCity: true },
  // South
  { id: 'ashdod', name: 'אשדוד', nameEn: 'Ashdod', lat: 31.80, lon: 34.65, severity: 'low', shelterSec: 45, alertCount: 1, population: 225, isCity: true },
  { id: 'ashkelon', name: 'אשקלון', nameEn: 'Ashkelon', lat: 31.67, lon: 34.57, severity: 'warning', shelterSec: 30, alertCount: 5, lastAlert: '11:30', population: 145, isCity: true },
  { id: 'sderot', name: 'שדרות', nameEn: 'Sderot', lat: 31.52, lon: 34.60, severity: 'high', shelterSec: 15, alertCount: 22, lastAlert: '12:45', population: 27, isCity: true },
  { id: 'netivot', name: 'נתיבות', nameEn: 'Netivot', lat: 31.42, lon: 34.59, severity: 'high', shelterSec: 15, alertCount: 12, population: 37, isCity: true },
  { id: 'ofakim', name: 'אופקים', nameEn: 'Ofakim', lat: 31.32, lon: 34.62, severity: 'medium', shelterSec: 30, alertCount: 4, population: 27, isCity: true },
  { id: 'beer_sheva', name: 'באר שבע', nameEn: 'Beer Sheva', lat: 31.25, lon: 34.79, severity: 'medium', shelterSec: 60, alertCount: 3, lastAlert: '10:30', population: 210, isCity: true },
  { id: 'arad', name: 'ערד', nameEn: 'Arad', lat: 31.26, lon: 35.21, severity: 'safe', shelterSec: 90, population: 26, isCity: true },
  { id: 'dimona', name: 'דימונה', nameEn: 'Dimona', lat: 31.07, lon: 35.03, severity: 'safe', shelterSec: 90, population: 34, isCity: true },
  { id: 'mitzpe_ramon', name: 'מצפה רמון', nameEn: 'Mitzpe Ramon', lat: 30.61, lon: 34.80, severity: 'safe', shelterSec: 120, population: 5, isCity: true },
  { id: 'eilat', name: 'אילת', nameEn: 'Eilat', lat: 29.56, lon: 34.95, severity: 'safe', shelterSec: 90, alertCount: 1, population: 52, isCity: true },
  // Zones
  { id: 'gaza', name: 'רצועת עזה', nameEn: 'Gaza Strip', lat: 31.45, lon: 34.40, severity: 'high' },
  { id: 'gaza_north', name: 'צפון עזה', nameEn: 'N. Gaza', lat: 31.55, lon: 34.50, severity: 'high' },
  { id: 'gaza_south', name: 'דרום עזה', nameEn: 'S. Gaza', lat: 31.30, lon: 34.35, severity: 'medium' },
  { id: 'west_bank', name: 'יהודה ושומרון', nameEn: 'West Bank', lat: 32.00, lon: 35.20, severity: 'medium' },
  { id: 'syria', name: 'סוריה', nameEn: 'Syria', lat: 33.20, lon: 36.00, severity: 'low' },
];

// ── Missile sources with real lat/lon ──
interface MissileSource {
  id: string;
  name: string;
  nameEn: string;
  lat: number;
  lon: number;
  color: string;
  missileType: string;
  threatCategory: 'missile' | 'rocket' | 'uav' | 'cruise_missile';
  flightTimeSec: number;
  icon: string;
  maxAltKm: number;
  defenseSystem: string; // which defense layer intercepts
  targets: { lat: number; lon: number; name: string; distKm: number }[];
}

const MISSILE_SOURCES: MissileSource[] = [
  {
    id: 'lebanon_hzb', name: 'חיזבאללה', nameEn: 'Hezbollah',
    lat: 33.30, lon: 35.48, color: '#ab47bc',
    missileType: 'Burkan / Fateh-110', threatCategory: 'rocket', flightTimeSec: 45, icon: '🚀', maxAltKm: 50,
    defenseSystem: 'כיפת ברזל / קלע דוד',
    targets: [
      { lat: 32.79, lon: 34.99, name: 'חיפה', distKm: 130 },
      { lat: 33.21, lon: 35.57, name: 'קריית שמונה', distKm: 75 },
      { lat: 32.08, lon: 34.78, name: 'תל אביב', distKm: 210 },
    ],
  },
  {
    id: 'lebanon_uav', name: 'חיזבאללה - כטב"מ', nameEn: 'Hezbollah UAV',
    lat: 33.35, lon: 35.42, color: '#ce93d8',
    missileType: 'Ababil / Mirsad', threatCategory: 'uav', flightTimeSec: 600, icon: '🛸', maxAltKm: 5,
    defenseSystem: 'כיפת ברזל / קרן ברזל',
    targets: [
      { lat: 32.79, lon: 34.99, name: 'חיפה', distKm: 110 },
      { lat: 33.21, lon: 35.57, name: 'קריית שמונה', distKm: 55 },
    ],
  },
  {
    id: 'gaza_hamas', name: 'חמאס', nameEn: 'Hamas',
    lat: 31.52, lon: 34.45, color: '#ff6d00',
    missileType: 'M-302 / J-80', threatCategory: 'rocket', flightTimeSec: 30, icon: '🚀', maxAltKm: 25,
    defenseSystem: 'כיפת ברזל',
    targets: [
      { lat: 31.52, lon: 34.60, name: 'שדרות', distKm: 12 },
      { lat: 31.25, lon: 34.79, name: 'באר שבע', distKm: 45 },
      { lat: 32.08, lon: 34.78, name: 'תל אביב', distKm: 80 },
    ],
  },
  {
    id: 'gaza_qassam', name: 'חמאס — קסאם', nameEn: 'Hamas Qassam',
    lat: 31.50, lon: 34.47, color: '#ff9100',
    missileType: 'Qassam-3', threatCategory: 'rocket', flightTimeSec: 15, icon: '🚀', maxAltKm: 8,
    defenseSystem: 'קרן ברזל',
    targets: [
      { lat: 31.52, lon: 34.60, name: 'שדרות', distKm: 10 },
    ],
  },
  {
    id: 'iran', name: 'איראן', nameEn: 'IRAN',
    lat: 32.65, lon: 51.68, color: '#ff6d00',
    missileType: 'Shahab-3 / Emad', threatCategory: 'missile', flightTimeSec: 720, icon: '☄️', maxAltKm: 500,
    defenseSystem: 'חץ 2 / חץ 3',
    targets: [
      { lat: 32.08, lon: 34.78, name: 'תל אביב', distKm: 1600 },
      { lat: 31.77, lon: 35.21, name: 'ירושלים', distKm: 1550 },
      { lat: 31.07, lon: 35.03, name: 'דימונה', distKm: 1500 },
    ],
  },
  {
    id: 'houthis', name: "חות'ים", nameEn: 'Houthis',
    lat: 15.35, lon: 44.21, color: '#ff6d00',
    missileType: 'Toufan / Samad-3 UAV', threatCategory: 'uav', flightTimeSec: 1800, icon: '🛸', maxAltKm: 12,
    defenseSystem: 'חץ / קלע דוד',
    targets: [
      { lat: 29.56, lon: 34.95, name: 'אילת', distKm: 1800 },
      { lat: 32.08, lon: 34.78, name: 'תל אביב', distKm: 2400 },
    ],
  },
  {
    id: 'houthis_cruise', name: "חות'ים - טיל שיוט", nameEn: 'Houthis Cruise',
    lat: 15.50, lon: 44.00, color: '#e65100',
    missileType: 'Quds-2 / Cruise', threatCategory: 'cruise_missile', flightTimeSec: 2400, icon: '🎯', maxAltKm: 8,
    defenseSystem: 'קלע דוד / חץ',
    targets: [
      { lat: 32.08, lon: 34.78, name: 'תל אביב', distKm: 2400 },
    ],
  },
  {
    id: 'iraq_militia', name: 'מיליציות עיראק', nameEn: 'Iraq Militia',
    lat: 33.30, lon: 44.37, color: '#ff6d00',
    missileType: 'Fateh-313 / UAV', threatCategory: 'uav', flightTimeSec: 900, icon: '🛸', maxAltKm: 80,
    defenseSystem: 'חץ / קלע דוד',
    targets: [
      { lat: 32.08, lon: 34.78, name: 'תל אביב', distKm: 950 },
      { lat: 31.77, lon: 35.21, name: 'ירושלים', distKm: 900 },
    ],
  },
];

// ── UAV Intrusion Routes — waypoints over Israeli territory ──
interface UAVRoute {
  sourceId: string; // matches MissileSource id
  waypoints: { lat: number; lon: number; name: string }[];
  speedFactor: number; // relative to missileProgress cycle
}

const UAV_INTRUSION_ROUTES: UAVRoute[] = [
  {
    sourceId: 'lebanon_uav',
    waypoints: [
      { lat: 33.28, lon: 35.58, name: 'מטולה' },
      { lat: 33.21, lon: 35.57, name: 'קריית שמונה' },
      { lat: 32.97, lon: 35.50, name: 'צפת' },
      { lat: 32.79, lon: 35.53, name: 'טבריה' },
      { lat: 32.79, lon: 34.99, name: 'חיפה' },
      { lat: 32.44, lon: 34.92, name: 'חדרה' },
      { lat: 32.33, lon: 34.86, name: 'נתניה' },
    ],
    speedFactor: 0.4,
  },
  {
    sourceId: 'houthis',
    waypoints: [
      { lat: 29.56, lon: 34.95, name: 'אילת' },
      { lat: 30.61, lon: 34.80, name: 'מצפה רמון' },
      { lat: 31.07, lon: 35.03, name: 'דימונה' },
      { lat: 31.25, lon: 34.79, name: 'באר שבע' },
      { lat: 31.80, lon: 34.65, name: 'אשדוד' },
      { lat: 32.08, lon: 34.78, name: 'תל אביב' },
    ],
    speedFactor: 0.25,
  },
  {
    sourceId: 'iraq_militia',
    waypoints: [
      { lat: 32.50, lon: 35.50, name: 'בית שאן' },
      { lat: 32.61, lon: 35.29, name: 'עפולה' },
      { lat: 32.09, lon: 34.88, name: 'פתח תקווה' },
      { lat: 32.08, lon: 34.78, name: 'תל אביב' },
      { lat: 31.77, lon: 35.21, name: 'ירושלים' },
    ],
    speedFactor: 0.3,
  },
];

// ── Interceptor pursuit bases — IAF bases that launch interceptors against UAVs ──
const UAV_INTERCEPTOR_BASES: Record<string, { lat: number; lon: number; name: string; aircraft: string }> = {
  'lebanon_uav': { lat: 32.61, lon: 35.23, name: 'בסיס רמת דוד', aircraft: 'F-16I' },
  'houthis': { lat: 31.21, lon: 34.93, name: 'בסיס נבטים', aircraft: 'F-35I' },
  'iraq_militia': { lat: 32.44, lon: 34.92, name: 'בסיס חצרים', aircraft: 'F-15I' },
};

// ── Defense Systems ──
interface DefenseSystem {
  id: string;
  name: string;
  nameEn: string;
  type: 'iron_dome' | 'davids_sling' | 'arrow' | 'patriot' | 'iron_beam';
  lat: number;
  lon: number;
  rangeKm: number;
  icon: string;
  color: string;
}

const DEFENSE_SYSTEMS: DefenseSystem[] = [
  // Iron Dome batteries — green
  { id: 'id_sderot', name: 'כיפת ברזל - שדרות', nameEn: 'Iron Dome Sderot', type: 'iron_dome', lat: 31.55, lon: 34.65, rangeKm: 70, icon: '🟢', color: '#00e676' },
  { id: 'id_ashkelon', name: 'כיפת ברזל - אשקלון', nameEn: 'Iron Dome Ashkelon', type: 'iron_dome', lat: 31.70, lon: 34.60, rangeKm: 70, icon: '🟢', color: '#00e676' },
  { id: 'id_beer_sheva', name: 'כיפת ברזל - ב״ש', nameEn: 'Iron Dome Beer Sheva', type: 'iron_dome', lat: 31.30, lon: 34.82, rangeKm: 70, icon: '🟢', color: '#00e676' },
  { id: 'id_tlv', name: 'כיפת ברזל - גוש דן', nameEn: 'Iron Dome Tel Aviv', type: 'iron_dome', lat: 32.02, lon: 34.82, rangeKm: 70, icon: '🟢', color: '#00e676' },
  { id: 'id_haifa', name: 'כיפת ברזל - חיפה', nameEn: 'Iron Dome Haifa', type: 'iron_dome', lat: 32.82, lon: 35.02, rangeKm: 70, icon: '🟢', color: '#00e676' },
  { id: 'id_north', name: 'כיפת ברזל - צפון', nameEn: 'Iron Dome North', type: 'iron_dome', lat: 33.10, lon: 35.50, rangeKm: 70, icon: '🟢', color: '#00e676' },
  // David's Sling — cyan
  { id: 'ds_center', name: 'קלע דוד - מרכז', nameEn: "David's Sling Center", type: 'davids_sling', lat: 31.90, lon: 34.90, rangeKm: 200, icon: '⚔️', color: '#00e5ff' },
  { id: 'ds_north', name: 'קלע דוד - צפון', nameEn: "David's Sling North", type: 'davids_sling', lat: 32.70, lon: 35.10, rangeKm: 200, icon: '⚔️', color: '#00e5ff' },
  // Arrow — purple (exo-atmospheric)
  { id: 'arrow_palmachim', name: 'חץ 2/3 - פלמחים', nameEn: 'Arrow Palmachim', type: 'arrow', lat: 31.88, lon: 34.70, rangeKm: 2400, icon: '🏹', color: '#7c4dff' },
  { id: 'arrow_nevatim', name: 'חץ 2/3 - נבטים', nameEn: 'Arrow Nevatim', type: 'arrow', lat: 31.21, lon: 34.93, rangeKm: 2400, icon: '🏹', color: '#448aff' },
  // Iron Beam (laser) — lime
  { id: 'beam_south', name: 'קרן ברזל - דרום', nameEn: 'Iron Beam South', type: 'iron_beam', lat: 31.48, lon: 34.58, rangeKm: 7, icon: '⚡', color: '#76ff03' },
  { id: 'beam_north', name: 'קרן ברזל - צפון', nameEn: 'Iron Beam North', type: 'iron_beam', lat: 32.85, lon: 35.08, rangeKm: 7, icon: '⚡', color: '#76ff03' },
  // US Naval Aegis (Patriot-class) — dark blue
  { id: 'aegis_ddg1', name: 'USS Carney (DDG-64)', nameEn: 'USS Carney Aegis', type: 'patriot', lat: 33.80, lon: 34.10, rangeKm: 500, icon: '🇺🇸', color: '#00b0ff' },
  { id: 'aegis_ddg2', name: 'USS Laboon (DDG-58)', nameEn: 'USS Laboon Aegis', type: 'patriot', lat: 32.60, lon: 33.50, rangeKm: 500, icon: '🇺🇸', color: '#00b0ff' },
  { id: 'aegis_cvn', name: 'USS Ford (CVN-78)', nameEn: 'USS Ford Carrier', type: 'patriot', lat: 33.20, lon: 33.00, rangeKm: 700, icon: '🇺🇸', color: '#0d47a1' },
  // Additional Iron Dome
  { id: 'id_jerusalem', name: 'כיפת ברזל - ירושלים', nameEn: 'Iron Dome Jerusalem', type: 'iron_dome', lat: 31.78, lon: 35.18, rangeKm: 70, icon: '🟢', color: '#00e676' },
  { id: 'id_ashdod', name: 'כיפת ברזל - אשדוד', nameEn: 'Iron Dome Ashdod', type: 'iron_dome', lat: 31.82, lon: 34.66, rangeKm: 70, icon: '🟢', color: '#00e676' },
  // Additional David's Sling
  { id: 'ds_south', name: 'קלע דוד - דרום', nameEn: "David's Sling South", type: 'davids_sling', lat: 31.30, lon: 34.78, rangeKm: 200, icon: '⚔️', color: '#00e5ff' },
];

// ── Naval Patrol Routes ──
interface PatrolShip {
  id: string;
  name: string;
  icon: string;
  color: string;
  route: [number, number][];
  speed: number; // 0-1 progress per second
}

const PATROL_SHIPS: PatrolShip[] = [
  {
    id: 'saar6_north', name: 'סער 6 - צפון', icon: '🚢', color: '#42a5f5',
    route: [[33.05, 34.60], [33.15, 34.30], [33.20, 34.00], [33.10, 33.70], [33.00, 34.10], [33.05, 34.60]],
    speed: 0.015,
  },
  {
    id: 'saar6_center', name: 'סער 6 - מרכז', icon: '🚢', color: '#26c6da',
    route: [[32.30, 34.50], [32.10, 34.30], [31.90, 34.20], [31.70, 34.30], [31.90, 34.50], [32.30, 34.50]],
    speed: 0.012,
  },
  {
    id: 'patrol_south', name: 'דבורה - דרום', icon: '⛵', color: '#66bb6a',
    route: [[31.50, 34.30], [31.30, 34.15], [31.10, 34.10], [30.80, 34.20], [31.10, 34.35], [31.50, 34.30]],
    speed: 0.018,
  },
  {
    id: 'submarine', name: 'דולפין', icon: '🔱', color: '#ab47bc',
    route: [[32.50, 34.20], [32.20, 33.80], [31.80, 33.50], [31.50, 33.80], [31.80, 34.10], [32.50, 34.20]],
    speed: 0.008,
  },
];

// ── Aircraft routes (simulated Flightradar24-style) ──
interface AircraftRoute {
  id: string;
  callsign: string;
  type: string;
  icon: string;
  color: string;
  route: [number, number][];
  speed: number;
  altitude: number; // feet
  category: 'commercial' | 'military' | 'cargo' | 'helicopter' | 'uav';
}

// Aircraft detail info for double-click popup
const AIRCRAFT_DETAILS: Record<string, { image: string; mission: string; branch: string; branchIcon: string }> = {
  'ELY001': { image: '🛫', mission: 'טיסה מסחרית TLV→LHR', branch: 'אזרחי — אל על', branchIcon: '✈️' },
  'ELY018': { image: '🛫', mission: 'טיסה מסחרית JFK→TLV', branch: 'אזרחי — אל על', branchIcon: '✈️' },
  'THY674': { image: '🛫', mission: 'טיסה מסחרית IST→TLV', branch: 'אזרחי — Turkish Airlines', branchIcon: '✈️' },
  'UAE965': { image: '🛫', mission: 'טיסה מסחרית DXB→CAI', branch: 'אזרחי — Emirates', branchIcon: '✈️' },
  'RYR2215': { image: '🛫', mission: 'טיסה מסחרית ATH→TLV', branch: 'אזרחי — Ryanair', branchIcon: '✈️' },
  'SWA442': { image: '🛫', mission: 'טיסה מסחרית AMM→CAI', branch: 'אזרחי — Saudia', branchIcon: '✈️' },
  'AFR112': { image: '🛫', mission: 'טיסה מסחרית CDG→TLV', branch: 'אזרחי — Air France', branchIcon: '✈️' },
  'IAF-F35': { image: '🦅', mission: 'סיור קרבי — גבול צפון', branch: 'חיל האוויר — טייסת 140 "גולדן איגל"', branchIcon: '⭐' },
  'IAF-F16': { image: '🦅', mission: 'סיור הגנה אווירית — מרכז', branch: 'חיל האוויר — טייסת 253 "נגב"', branchIcon: '⭐' },
  'IAF-F15': { image: '🦅', mission: 'סיור עומק — חזית צפון', branch: 'חיל האוויר — טייסת 133 "אבירי הזנב הכפול"', branchIcon: '⭐' },
  'RCH401': { image: '📦', mission: 'אספקה אמריקנית — בסיס נבטים', branch: 'USAF — Air Mobility Command', branchIcon: '🇺🇸' },
  'RCH502': { image: '📦', mission: 'אספקה אמריקנית — חיזוק לוגיסטי', branch: 'USAF — 317th Airlift Wing', branchIcon: '🇺🇸' },
  'AWACS': { image: '📡', mission: 'בקרה אווירית ואיתור — כל המרחב', branch: 'חיל האוויר — טייסת 122', branchIcon: '📡' },
  'RESCUE1': { image: '🚁', mission: 'פינוי רפואי — מרכז', branch: 'חיל האוויר — טייסת 124 "דבורן הכסף"', branchIcon: '⭐' },
  'YASUR': { image: '🚁', mission: 'הובלה כבדה — דרום', branch: 'חיל האוויר — טייסת 118 "הגנה הראשונה"', branchIcon: '⭐' },
  'MDA-AIR': { image: '🚁', mission: 'חילוץ רפואי דחוף', branch: 'מד"א — מסוק חילוץ', branchIcon: '🏥' },
  'COBRA': { image: '🚁', mission: 'תקיפה וסיוע קרקעי — גבול צפון', branch: 'חיל האוויר — טייסת 190 "מקפצת הנחש"', branchIcon: '⭐' },
  'YANSHUF': { image: '🚁', mission: 'סיור וחילוץ — ירושלים', branch: 'חיל האוויר — טייסת 124', branchIcon: '⭐' },
  'HERMES': { image: '🛸', mission: 'סיור ומודיעין — גבול צפון', branch: 'חיל האוויר — טייסת 166 "מעוף הדרקון"', branchIcon: '⭐' },
  'HERON': { image: '🛸', mission: 'סיור עומק אסטרטגי', branch: 'חיל האוויר — טייסת 210', branchIcon: '⭐' },
  'SKYLARK': { image: '🛸', mission: 'סיור טקטי שטח — שרון', branch: 'זרוע היבשה — יחידת מל"טים', branchIcon: '🎖️' },
  'ORBITER': { image: '🛸', mission: 'סיור חזית דרום — גבול עזה', branch: 'זרוע היבשה — יחידת סיגינט', branchIcon: '🎖️' },
  'HAROP': { image: '🛸', mission: 'יירוט אקטיבי — גבול צפון', branch: 'חיל האוויר — מל"ט תקיפה', branchIcon: '⭐' },
  // CENTCOM/NATO
  'NAVY-P8': { image: '✈️', mission: 'סיור ימי נגד צוללות — מפרץ פרסי', branch: 'USN — VP-5 "Mad Foxes"', branchIcon: '🇺🇸' },
  'TEXAN61': { image: '✈️', mission: 'תדלוק אווירי — מסדרון CENTCOM', branch: 'USAF — 340th EARS', branchIcon: '🇺🇸' },
  'BONE21': { image: '⚡', mission: 'הרתעה אסטרטגית — עיראק/סוריה', branch: 'USAF — 9th EBS "Bats"', branchIcon: '🇺🇸' },
  'RAPTOR1': { image: '⚡', mission: 'עליונות אווירית — מפרץ', branch: 'USAF — 94th FS "Hat in the Ring"', branchIcon: '🇺🇸' },
  'GLOBAL1': { image: '🛸', mission: 'סיור אסטרטגי SIGINT/IMINT', branch: 'USAF — 380th AEW', branchIcon: '🇺🇸' },
  'REAPER1': { image: '🛸', mission: 'ISR/Strike — סוריה/עיראק', branch: 'USAF — 432nd Wing', branchIcon: '🇺🇸' },
  'SENTRY1': { image: '📡', mission: 'בקרה אווירית — אל-עודיד', branch: 'USAF — 965th AACS', branchIcon: '🇺🇸' },
  'RCH780': { image: '📦', mission: 'אספקה אסטרטגית קטאר→ישראל', branch: 'USAF — 816th EAS', branchIcon: '🇺🇸' },
  'HORNET1': { image: '⚡', mission: 'CAP — נ.מ אייזנהאואר', branch: 'USN — VFA-32 "Swordsmen"', branchIcon: '🇺🇸' },
  'HORNET2': { image: '⚡', mission: 'Strike — נ.מ אייזנהאואר', branch: 'USN — VFA-105 "Gunslingers"', branchIcon: '🇺🇸' },
  'HAWKEYE': { image: '📡', mission: 'AEW — נ.מ אייזנהאואר', branch: 'USN — VAW-123 "Screwtops"', branchIcon: '🇺🇸' },
  'TYPHON1': { image: '⚡', mission: 'סיור קרבי — Operation Shader', branch: 'RAF — 1(F) Squadron', branchIcon: '🇬🇧' },
  'TARTAN1': { image: '✈️', mission: 'תדלוק אווירי — RAF Akrotiri', branch: 'RAF — 10 Squadron', branchIcon: '🇬🇧' },
  'RAFALE1': { image: '⚡', mission: 'CAP — CDG CSG', branch: 'Marine Nationale — 12F', branchIcon: '🇫🇷' },
  'RSAF15': { image: '⚡', mission: 'סיור הגנה — גבול תימן', branch: 'RSAF — 13th Squadron', branchIcon: '🇸🇦' },
  'FALCON1': { image: '⚡', mission: 'CAP — גבול דרום', branch: 'UAEAF — Al Ain Wing', branchIcon: '🇦🇪' },
};

// SVG aircraft silhouettes for ATC-style display
function getAircraftSVG(category: string, color: string, size: number): string {
  if (category === 'helicopter') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 10h16M12 3v7m0 0l-3 8h6l-3-8zm-5 8h10m-8 3l-2 4m8-4l2 4" stroke="${color}" stroke-width="1.5" stroke-linecap="round" fill="none"/>
    </svg>`;
  }
  if (category === 'uav') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 4l-8 6 8 2 8-2-8-6zm0 8v8m-4-4h8" stroke="${color}" stroke-width="1.5" stroke-linecap="round" fill="none"/>
    </svg>`;
  }
  if (category === 'military') {
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2L8 10l-6 2 6 2 4 8 4-8 6-2-6-2L12 2z" stroke="${color}" stroke-width="1.2" fill="${color}" fill-opacity="0.3"/>
    </svg>`;
  }
  // Commercial / cargo — classic airliner
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2c-.5 0-1 .5-1 1v6L3 13v2l8-2v5l-2 2v1l3-1 3 1v-1l-2-2v-5l8 2v-2l-8-4V3c0-.5-.5-1-1-1z" fill="${color}" fill-opacity="0.85" stroke="${color}" stroke-width="0.5"/>
  </svg>`;
}

const AIRCRAFT_ROUTES: AircraftRoute[] = [
  // Commercial flights over Israel — SLOWER speeds
  { id: 'ely001', callsign: 'ELY001', type: 'B738', icon: '✈', color: '#4fc3f7', route: [[33.5, 34.0], [33.0, 34.5], [32.5, 34.8], [32.0, 34.9], [31.5, 35.0], [31.0, 34.8], [30.5, 34.6]], speed: 0.002, altitude: 36000, category: 'commercial' },
  { id: 'ely018', callsign: 'ELY018', type: 'B789', icon: '✈', color: '#4fc3f7', route: [[29.8, 35.0], [30.5, 34.9], [31.2, 34.8], [31.9, 34.7], [32.5, 34.5], [33.2, 34.3], [33.8, 34.0]], speed: 0.0018, altitude: 38000, category: 'commercial' },
  { id: 'thy674', callsign: 'THY674', type: 'A321', icon: '✈', color: '#ffab40', route: [[33.8, 35.5], [33.3, 35.2], [32.8, 35.0], [32.3, 34.8], [31.8, 34.6], [31.3, 34.4], [30.8, 34.2]], speed: 0.0022, altitude: 34000, category: 'commercial' },
  { id: 'uae965', callsign: 'UAE965', type: 'A380', icon: '✈', color: '#ce93d8', route: [[31.0, 36.0], [31.2, 35.5], [31.5, 35.0], [31.8, 34.5], [32.0, 34.2], [32.3, 33.8]], speed: 0.0015, altitude: 40000, category: 'commercial' },
  { id: 'ryr2215', callsign: 'RYR2215', type: 'B738', icon: '✈', color: '#ffd740', route: [[33.2, 33.5], [32.8, 34.0], [32.4, 34.5], [32.0, 34.8], [31.6, 35.0], [31.2, 35.3]], speed: 0.0025, altitude: 32000, category: 'commercial' },
  { id: 'swa442', callsign: 'SWA442', type: 'B737', icon: '✈', color: '#80deea', route: [[30.2, 34.2], [30.8, 34.5], [31.4, 34.8], [32.0, 35.0], [32.6, 35.2], [33.2, 35.0]], speed: 0.002, altitude: 33000, category: 'commercial' },
  { id: 'afr112', callsign: 'AFR112', type: 'A320', icon: '✈', color: '#90caf9', route: [[33.6, 33.2], [33.1, 33.8], [32.6, 34.4], [32.1, 34.8], [31.6, 35.1]], speed: 0.002, altitude: 37000, category: 'commercial' },
  // Military jets — slightly faster but still slower
  { id: 'iaf01', callsign: 'IAF-F35', type: 'F-35I', icon: '⚡', color: '#ff1744', route: [[31.9, 34.7], [32.2, 34.9], [32.8, 35.2], [33.2, 35.5], [33.0, 35.0], [32.5, 34.7], [31.9, 34.7]], speed: 0.006, altitude: 25000, category: 'military' },
  { id: 'iaf02', callsign: 'IAF-F16', type: 'F-16I', icon: '⚡', color: '#ff6d00', route: [[31.2, 34.9], [31.5, 34.6], [31.8, 34.4], [32.0, 34.6], [31.7, 34.9], [31.4, 35.0], [31.2, 34.9]], speed: 0.005, altitude: 20000, category: 'military' },
  { id: 'iaf03', callsign: 'IAF-F15', type: 'F-15I', icon: '⚡', color: '#ff3d00', route: [[32.6, 34.5], [32.9, 34.8], [33.2, 35.1], [33.0, 35.4], [32.7, 35.1], [32.4, 34.8], [32.6, 34.5]], speed: 0.006, altitude: 30000, category: 'military' },
  { id: 'usaf01', callsign: 'RCH401', type: 'C-17', icon: '✈', color: '#42a5f5', route: [[33.5, 33.0], [33.0, 34.0], [32.5, 34.5], [32.0, 34.8], [31.5, 34.7]], speed: 0.0012, altitude: 28000, category: 'cargo' },
  { id: 'usaf02', callsign: 'RCH502', type: 'C-130J', icon: '✈', color: '#64b5f6', route: [[29.5, 34.9], [30.2, 34.8], [31.0, 34.7], [31.8, 34.8], [32.5, 34.9]], speed: 0.001, altitude: 22000, category: 'cargo' },
  // AWACS / Patrol
  { id: 'awacs', callsign: 'AWACS', type: 'G550', icon: '📡', color: '#76ff03', route: [[32.5, 34.0], [32.8, 34.5], [32.5, 35.0], [32.2, 34.5], [32.5, 34.0]], speed: 0.0015, altitude: 42000, category: 'military' },
  // ── Helicopters — slow
  { id: 'heli01', callsign: 'RESCUE1', type: 'UH-60', icon: '🚁', color: '#ff9100', route: [[32.08, 34.78], [32.10, 34.82], [32.12, 34.86], [32.10, 34.90], [32.06, 34.88], [32.04, 34.83], [32.08, 34.78]], speed: 0.003, altitude: 3000, category: 'helicopter' },
  { id: 'heli02', callsign: 'YASUR', type: 'CH-53', icon: '🚁', color: '#ffab40', route: [[31.25, 34.78], [31.40, 34.85], [31.60, 34.90], [31.80, 34.85], [31.95, 34.80], [32.05, 34.78]], speed: 0.002, altitude: 5000, category: 'helicopter' },
  { id: 'heli03', callsign: 'MDA-AIR', type: 'EC135', icon: '🚁', color: '#f44336', route: [[32.79, 34.99], [32.75, 35.05], [32.70, 35.10], [32.65, 35.05], [32.70, 34.98], [32.79, 34.99]], speed: 0.004, altitude: 2000, category: 'helicopter' },
  { id: 'heli04', callsign: 'COBRA', type: 'AH-64', icon: '🚁', color: '#e53935', route: [[33.10, 35.50], [33.05, 35.45], [33.00, 35.40], [33.05, 35.35], [33.10, 35.40], [33.10, 35.50]], speed: 0.004, altitude: 1500, category: 'helicopter' },
  { id: 'heli05', callsign: 'YANSHUF', type: 'S-70', icon: '🚁', color: '#ff7043', route: [[31.77, 35.21], [31.80, 35.25], [31.83, 35.28], [31.80, 35.32], [31.76, 35.28], [31.77, 35.21]], speed: 0.003, altitude: 4000, category: 'helicopter' },
  // ── UAVs / Drones — slow
  { id: 'uav01', callsign: 'HERMES', type: 'Hermes 900', icon: '🛸', color: '#00e5ff', route: [[33.20, 35.40], [33.15, 35.30], [33.10, 35.20], [33.15, 35.10], [33.20, 35.20], [33.25, 35.30], [33.20, 35.40]], speed: 0.0012, altitude: 30000, category: 'uav' },
  { id: 'uav02', callsign: 'HERON', type: 'Heron TP', icon: '🛸', color: '#18ffff', route: [[31.50, 34.50], [31.60, 34.60], [31.70, 34.70], [31.80, 34.60], [31.70, 34.50], [31.60, 34.40], [31.50, 34.50]], speed: 0.001, altitude: 35000, category: 'uav' },
  { id: 'uav03', callsign: 'SKYLARK', type: 'Skylark 3', icon: '🛸', color: '#84ffff', route: [[32.30, 34.85], [32.35, 34.90], [32.40, 34.95], [32.35, 35.00], [32.30, 34.95], [32.25, 34.90], [32.30, 34.85]], speed: 0.0018, altitude: 15000, category: 'uav' },
  { id: 'uav04', callsign: 'ORBITER', type: 'Orbiter 4', icon: '🛸', color: '#b2ebf2', route: [[31.00, 34.40], [31.05, 34.50], [31.10, 34.60], [31.05, 34.70], [31.00, 34.60], [30.95, 34.50], [31.00, 34.40]], speed: 0.0015, altitude: 18000, category: 'uav' },
  { id: 'uav05', callsign: 'HAROP', type: 'Harop', icon: '🛸', color: '#00bcd4', route: [[33.30, 35.55], [33.25, 35.50], [33.20, 35.45], [33.25, 35.40], [33.30, 35.45], [33.35, 35.50], [33.30, 35.55]], speed: 0.002, altitude: 12000, category: 'uav' },
  // ── CENTCOM / NATO assets — Middle East theater ──
  // CENTCOM — US 5th Fleet (Bahrain)
  { id: 'usn_p8', callsign: 'NAVY-P8', type: 'P-8A Poseidon', icon: '✈', color: '#42a5f5', route: [[26.0, 50.5], [25.5, 49.5], [25.0, 48.0], [24.5, 46.5], [24.0, 45.0], [23.5, 43.5]], speed: 0.0015, altitude: 28000, category: 'military' },
  { id: 'usaf_kc135', callsign: 'TEXAN61', type: 'KC-135R', icon: '✈', color: '#90caf9', route: [[28.5, 47.0], [29.0, 45.0], [29.5, 43.0], [30.0, 41.0], [30.5, 39.0], [31.0, 37.0]], speed: 0.001, altitude: 32000, category: 'military' },
  { id: 'usaf_b1b', callsign: 'BONE21', type: 'B-1B Lancer', icon: '⚡', color: '#ff1744', route: [[32.0, 44.0], [31.5, 43.0], [31.0, 42.0], [30.5, 41.0], [30.0, 40.0], [29.5, 39.0]], speed: 0.005, altitude: 35000, category: 'military' },
  { id: 'usaf_f22', callsign: 'RAPTOR1', type: 'F-22A Raptor', icon: '⚡', color: '#ff3d00', route: [[29.0, 48.0], [29.5, 47.0], [30.0, 46.0], [30.5, 45.5], [31.0, 45.0], [30.5, 45.5], [30.0, 46.0]], speed: 0.007, altitude: 42000, category: 'military' },
  { id: 'usaf_rq4', callsign: 'GLOBAL1', type: 'RQ-4 Global Hawk', icon: '🛸', color: '#b388ff', route: [[28.0, 50.0], [29.0, 48.0], [30.0, 46.0], [31.0, 44.0], [32.0, 42.0], [33.0, 40.0], [34.0, 38.0]], speed: 0.0008, altitude: 55000, category: 'uav' },
  { id: 'usaf_mq9', callsign: 'REAPER1', type: 'MQ-9 Reaper', icon: '🛸', color: '#ea80fc', route: [[33.5, 43.0], [33.0, 42.5], [32.5, 42.0], [33.0, 41.5], [33.5, 42.0], [33.5, 43.0]], speed: 0.001, altitude: 25000, category: 'uav' },
  // CENTCOM — CAOC Al Udeid (Qatar)
  { id: 'usaf_e3', callsign: 'SENTRY1', type: 'E-3 Sentry AWACS', icon: '📡', color: '#76ff03', route: [[25.5, 51.0], [26.0, 49.5], [26.5, 48.0], [27.0, 46.5], [27.5, 45.0], [27.0, 46.5], [26.5, 48.0]], speed: 0.001, altitude: 30000, category: 'military' },
  { id: 'usaf_c17_qt', callsign: 'RCH780', type: 'C-17 Globemaster', icon: '✈', color: '#64b5f6', route: [[25.3, 51.3], [26.0, 49.0], [27.0, 46.5], [28.0, 44.0], [29.5, 41.0], [31.0, 38.0], [32.0, 35.0]], speed: 0.0012, altitude: 30000, category: 'cargo' },
  // USS Carrier Strike Group
  { id: 'usn_f18_1', callsign: 'HORNET1', type: 'F/A-18E Super Hornet', icon: '⚡', color: '#ff6d00', route: [[27.0, 36.5], [27.5, 37.0], [28.0, 37.5], [28.5, 37.0], [28.0, 36.5], [27.5, 36.0], [27.0, 36.5]], speed: 0.006, altitude: 22000, category: 'military' },
  { id: 'usn_f18_2', callsign: 'HORNET2', type: 'F/A-18F Super Hornet', icon: '⚡', color: '#ff9100', route: [[26.5, 37.0], [27.0, 37.5], [27.5, 38.0], [27.0, 38.5], [26.5, 38.0], [26.0, 37.5], [26.5, 37.0]], speed: 0.006, altitude: 24000, category: 'military' },
  { id: 'usn_e2d', callsign: 'HAWKEYE', type: 'E-2D Hawkeye', icon: '📡', color: '#69f0ae', route: [[27.0, 37.0], [27.3, 37.5], [27.0, 38.0], [26.7, 37.5], [27.0, 37.0]], speed: 0.0015, altitude: 25000, category: 'military' },
  // RAF (UK/NATO)
  { id: 'raf_typhoon', callsign: 'TYPHON1', type: 'Eurofighter Typhoon', icon: '⚡', color: '#e040fb', route: [[29.0, 47.5], [29.5, 46.5], [30.0, 45.5], [29.5, 44.5], [29.0, 45.5], [29.0, 47.5]], speed: 0.006, altitude: 36000, category: 'military' },
  { id: 'raf_voyager', callsign: 'TARTAN1', type: 'Voyager KC3', icon: '✈', color: '#ce93d8', route: [[30.0, 47.0], [30.5, 45.0], [31.0, 43.0], [31.5, 41.0], [32.0, 39.0]], speed: 0.001, altitude: 34000, category: 'military' },
  // French Navy (NATO)
  { id: 'faf_rafale', callsign: 'RAFALE1', type: 'Rafale M', icon: '⚡', color: '#7c4dff', route: [[28.0, 34.0], [28.5, 34.5], [29.0, 35.0], [28.5, 35.5], [28.0, 35.0], [27.5, 34.5], [28.0, 34.0]], speed: 0.006, altitude: 28000, category: 'military' },
  // Saudi Air Force (coalition)
  { id: 'rsaf_f15', callsign: 'RSAF15', type: 'F-15SA Eagle', icon: '⚡', color: '#ffd740', route: [[26.0, 44.0], [26.5, 44.5], [27.0, 45.0], [26.5, 45.5], [26.0, 45.0], [25.5, 44.5], [26.0, 44.0]], speed: 0.005, altitude: 32000, category: 'military' },
  // UAE Air Force
  { id: 'uaeaf_f16', callsign: 'FALCON1', type: 'F-16E Block 60', icon: '⚡', color: '#ffab40', route: [[24.5, 54.5], [25.0, 53.5], [25.5, 52.5], [25.0, 51.5], [24.5, 52.5], [24.5, 54.5]], speed: 0.005, altitude: 30000, category: 'military' },
];

// CENTCOM / NATO Order of Battle data
const CENTCOM_NATO_OOB = {
  centcom: {
    label: 'CENTCOM',
    icon: '🇺🇸',
    forces: [
      { unit: '5th Fleet', location: 'בחריין', type: 'naval', assets: 'נ.מ, 2 משחתות, 3 פריגטות', icon: '⚓' },
      { unit: 'CSG-2 (USS Eisenhower)', location: 'ים סוף / מפרץ', type: 'naval', assets: 'נ.מ + 65 כ"ט', icon: '🚢' },
      { unit: '379th AEW', location: 'אל-עודיד, קטאר', type: 'air', assets: 'F-22, KC-135, E-3, RQ-4', icon: '✈️' },
      { unit: '332nd AEW', location: 'בסיס ג׳ורדן, ירדן', type: 'air', assets: 'F-15E, MQ-9', icon: '✈️' },
      { unit: '386th AEW', location: 'כוויית', type: 'air', assets: 'C-17, C-130J, KC-135', icon: '📦' },
      { unit: 'TF Spartan', location: 'כוויית', type: 'ground', assets: '~8,000 חיילים', icon: '🎖️' },
      { unit: 'THAAD Battery', location: 'סעודיה / UAE', type: 'air_defense', assets: 'THAAD + Patriot', icon: '🛡️' },
    ],
  },
  nato: {
    label: 'NATO',
    icon: '🏛️',
    forces: [
      { unit: 'RAF Akrotiri', location: 'קפריסין', type: 'air', assets: 'Typhoon, Voyager', icon: '🇬🇧' },
      { unit: 'CDG CSG (צרפת)', location: 'מזרח הים התיכון', type: 'naval', assets: 'נ.מ Charles de Gaulle + Rafale M', icon: '🇫🇷' },
      { unit: 'SNMG2', location: 'מזרח הים התיכון', type: 'naval', assets: '4-6 ספינות NATO', icon: '⚓' },
      { unit: 'Incirlik AB', location: 'טורקיה', type: 'air', assets: 'F-16, KC-135', icon: '🇹🇷' },
    ],
  },
  regional: {
    label: 'אזורי',
    icon: '🌍',
    forces: [
      { unit: 'RSAF', location: 'סעודיה', type: 'air', assets: 'F-15SA, Typhoon, E-3', icon: '🇸🇦' },
      { unit: 'UAEAF', location: 'UAE', type: 'air', assets: 'F-16E, Mirage 2000', icon: '🇦🇪' },
      { unit: 'EAF', location: 'מצרים', type: 'air', assets: 'F-16, Rafale, MiG-29', icon: '🇪🇬' },
      { unit: 'RJAF', location: 'ירדן', type: 'air', assets: 'F-16, AH-1 Cobra', icon: '🇯🇴' },
    ],
  },
};

// Altitude to color gradient (low=green, mid=yellow, high=blue, very high=purple)
function altitudeColor(altFeet: number): string {
  if (altFeet <= 15000) return '#00e676';
  if (altFeet <= 25000) return '#ffeb3b';
  if (altFeet <= 35000) return '#29b6f6';
  if (altFeet <= 40000) return '#7c4dff';
  return '#e040fb';
}

// Interpolate position along a polyline route given progress 0-1
function interpolateRoute(route: [number, number][], progress: number): { lat: number; lon: number; bearing: number } {
  const totalSegments = route.length - 1;
  const segFloat = progress * totalSegments;
  const segIndex = Math.min(Math.floor(segFloat), totalSegments - 1);
  const segProgress = segFloat - segIndex;
  const from = route[segIndex];
  const to = route[Math.min(segIndex + 1, route.length - 1)];
  const lat = from[0] + (to[0] - from[0]) * segProgress;
  const lon = from[1] + (to[1] - from[1]) * segProgress;
  const bearing = Math.atan2(to[1] - from[1], to[0] - from[0]) * (180 / Math.PI);
  return { lat, lon, bearing };
}

// Create a rotated ship icon
function createShipIcon(bearing: number, color: string, icon: string) {
  return L.divIcon({
    className: '',
    html: `<div style="transform:rotate(${90 - bearing}deg);font-size:18px;filter:drop-shadow(0 0 4px ${color});text-shadow:0 0 6px ${color};">${icon}</div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  });
}

// Create a region icon with severity color
const REGION_ICONS: Record<string, string> = {
  lebanon: '⚔️', gaza: '💥', gaza_north: '💥', gaza_south: '💥',
  west_bank: '⚠️', syria: '🎯', golan: '🛡️',
  haifa: '🏙️', tlv: '🏙️', jerusalem: '🏛️', beer_sheva: '🏙️',
  eilat: '🏖️', dimona: '☢️', haifa_bay: '⚓',
};

// ── Approximate real city/zone boundary polygons (lat,lon) ──
const CITY_BOUNDARIES: Record<string, [number, number][]> = {
  // Tel Aviv municipal area
  tlv: [[32.120,34.745],[32.125,34.760],[32.115,34.790],[32.095,34.800],[32.070,34.805],[32.050,34.795],[32.045,34.775],[32.050,34.760],[32.060,34.755],[32.075,34.750],[32.095,34.745],[32.110,34.742],[32.120,34.745]],
  // Jerusalem
  jerusalem: [[31.810,35.170],[31.815,35.195],[31.805,35.230],[31.790,35.250],[31.770,35.255],[31.745,35.245],[31.730,35.225],[31.730,35.200],[31.740,35.175],[31.755,35.165],[31.775,35.160],[31.795,35.162],[31.810,35.170]],
  // Haifa
  haifa: [[32.830,34.960],[32.835,34.980],[32.825,35.005],[32.810,35.020],[32.790,35.015],[32.775,35.000],[32.770,34.975],[32.775,34.960],[32.785,34.950],[32.800,34.945],[32.815,34.948],[32.830,34.960]],
  // Beer Sheva
  beer_sheva: [[31.290,34.755],[31.295,34.775],[31.285,34.810],[31.265,34.830],[31.240,34.825],[31.220,34.805],[31.215,34.780],[31.225,34.755],[31.240,34.740],[31.260,34.735],[31.280,34.742],[31.290,34.755]],
  // Ashdod
  ashdod: [[31.830,34.625],[31.835,34.645],[31.825,34.670],[31.810,34.680],[31.790,34.675],[31.780,34.655],[31.782,34.635],[31.795,34.620],[31.810,34.615],[31.825,34.620],[31.830,34.625]],
  // Ashkelon
  ashkelon: [[31.700,34.540],[31.705,34.555],[31.695,34.580],[31.680,34.595],[31.660,34.590],[31.650,34.570],[31.652,34.550],[31.665,34.535],[31.680,34.530],[31.695,34.535],[31.700,34.540]],
  // Netanya
  netanya: [[32.360,34.835],[32.365,34.855],[32.355,34.880],[32.340,34.890],[32.320,34.885],[32.310,34.865],[32.312,34.845],[32.325,34.830],[32.340,34.825],[32.355,34.830],[32.360,34.835]],
  // Rishon LeZion
  rishon: [[32.000,34.770],[32.005,34.790],[31.995,34.815],[31.975,34.825],[31.955,34.820],[31.945,34.800],[31.948,34.780],[31.960,34.765],[31.975,34.760],[31.990,34.762],[32.000,34.770]],
  // Petah Tikva
  petah_tikva: [[32.115,34.850],[32.120,34.870],[32.110,34.900],[32.090,34.910],[32.070,34.905],[32.062,34.885],[32.065,34.865],[32.075,34.850],[32.090,34.845],[32.105,34.845],[32.115,34.850]],
  // Ramat Gan
  ramat_gan: [[32.095,34.790],[32.098,34.805],[32.090,34.825],[32.075,34.835],[32.060,34.830],[32.052,34.815],[32.055,34.795],[32.065,34.785],[32.078,34.782],[32.090,34.785],[32.095,34.790]],
  // Sderot
  sderot: [[31.535,34.585],[31.540,34.600],[31.530,34.615],[31.520,34.620],[31.510,34.612],[31.508,34.598],[31.512,34.585],[31.522,34.578],[31.530,34.578],[31.535,34.585]],
  // Kiryat Shmona
  kiryat_shmona: [[33.225,35.555],[33.230,35.570],[33.220,35.590],[33.208,35.595],[33.198,35.585],[33.195,35.570],[33.200,35.555],[33.210,35.548],[33.220,35.550],[33.225,35.555]],
  // Nahariya
  nahariya: [[33.015,35.085],[33.020,35.100],[33.010,35.118],[32.998,35.120],[32.988,35.112],[32.985,35.095],[32.990,35.082],[33.000,35.075],[33.010,35.078],[33.015,35.085]],
  // Eilat
  eilat: [[29.580,34.930],[29.585,34.950],[29.575,34.970],[29.560,34.975],[29.545,34.968],[29.540,34.950],[29.545,34.932],[29.555,34.925],[29.570,34.925],[29.580,34.930]],
  // Rehovot
  rehovot: [[31.910,34.790],[31.915,34.810],[31.905,34.830],[31.890,34.835],[31.875,34.828],[31.870,34.810],[31.875,34.790],[31.885,34.782],[31.898,34.780],[31.910,34.790]],
  // Herzliya
  herzliya: [[32.180,34.770],[32.185,34.790],[32.175,34.810],[32.162,34.815],[32.148,34.808],[32.145,34.790],[32.150,34.775],[32.160,34.765],[32.172,34.764],[32.180,34.770]],
  // Hadera
  hadera: [[32.465,34.895],[32.470,34.915],[32.460,34.940],[32.445,34.948],[32.430,34.940],[32.425,34.920],[32.430,34.900],[32.442,34.890],[32.455,34.888],[32.465,34.895]],
  // Safed
  safed: [[32.985,35.480],[32.990,35.500],[32.980,35.520],[32.968,35.525],[32.955,35.518],[32.952,35.498],[32.958,35.480],[32.968,35.472],[32.980,35.475],[32.985,35.480]],
  // Metula
  metula: [[33.290,35.568],[33.295,35.580],[33.288,35.595],[33.278,35.598],[33.270,35.590],[33.268,35.578],[33.272,35.568],[33.280,35.562],[33.288,35.563],[33.290,35.568]],
  // Modiin
  modiin: [[31.920,34.935],[31.925,34.955],[31.915,34.978],[31.900,34.985],[31.885,34.975],[31.880,34.955],[31.886,34.938],[31.898,34.928],[31.912,34.928],[31.920,34.935]],
  // Bet Shemesh
  bet_shemesh: [[31.750,34.970],[31.755,34.990],[31.745,35.010],[31.732,35.015],[31.720,35.008],[31.715,34.988],[31.720,34.970],[31.732,34.962],[31.745,34.962],[31.750,34.970]],
  // Karmiel
  karmiel: [[32.935,35.280],[32.940,35.300],[32.930,35.320],[32.918,35.325],[32.908,35.315],[32.905,35.298],[32.910,35.280],[32.920,35.272],[32.930,35.275],[32.935,35.280]],
  // Tiberias
  tiberias: [[32.810,35.510],[32.815,35.530],[32.805,35.550],[32.790,35.555],[32.778,35.545],[32.775,35.528],[32.780,35.510],[32.792,35.502],[32.805,35.505],[32.810,35.510]],
  // Acre
  acre: [[32.945,35.065],[32.950,35.080],[32.940,35.098],[32.928,35.102],[32.918,35.095],[32.915,35.078],[32.920,35.063],[32.930,35.055],[32.940,35.058],[32.945,35.065]],
  // Yokneam
  yokneam: [[32.675,35.095],[32.680,35.112],[32.670,35.128],[32.658,35.130],[32.648,35.122],[32.646,35.108],[32.650,35.095],[32.660,35.088],[32.670,35.090],[32.675,35.095]],
  // Afula
  afula: [[32.625,35.275],[32.630,35.295],[32.620,35.312],[32.608,35.315],[32.598,35.305],[32.595,35.288],[32.600,35.272],[32.610,35.265],[32.620,35.268],[32.625,35.275]],
  // Netivot
  netivot: [[31.435,34.575],[31.440,34.592],[31.430,34.608],[31.418,34.610],[31.408,34.602],[31.406,34.588],[31.410,34.575],[31.420,34.568],[31.430,34.570],[31.435,34.575]],
  // Ofakim
  ofakim: [[31.335,34.605],[31.340,34.622],[31.330,34.638],[31.318,34.640],[31.308,34.632],[31.306,34.618],[31.310,34.605],[31.320,34.598],[31.330,34.600],[31.335,34.605]],
  // Arad
  arad: [[31.275,35.195],[31.280,35.212],[31.270,35.228],[31.258,35.230],[31.248,35.222],[31.246,35.208],[31.250,35.195],[31.260,35.188],[31.270,35.190],[31.275,35.195]],
  // Dimona
  dimona: [[31.085,35.015],[31.090,35.035],[31.080,35.052],[31.068,35.055],[31.058,35.045],[31.055,35.028],[31.060,35.012],[31.070,35.005],[31.080,35.008],[31.085,35.015]],
  // Mitzpe Ramon
  mitzpe_ramon: [[30.625,34.785],[30.630,34.802],[30.620,34.818],[30.608,34.820],[30.598,34.812],[30.596,34.798],[30.600,34.785],[30.610,34.778],[30.620,34.780],[30.625,34.785]],
  // Zones — larger boundaries
  gaza: [[31.590,34.380],[31.580,34.430],[31.520,34.470],[31.450,34.480],[31.380,34.460],[31.320,34.400],[31.310,34.350],[31.340,34.310],[31.400,34.280],[31.470,34.290],[31.540,34.320],[31.580,34.350],[31.590,34.380]],
  gaza_north: [[31.590,34.380],[31.580,34.430],[31.550,34.460],[31.520,34.470],[31.500,34.450],[31.490,34.410],[31.500,34.380],[31.530,34.350],[31.560,34.350],[31.580,34.360],[31.590,34.380]],
  gaza_south: [[31.380,34.380],[31.370,34.420],[31.340,34.440],[31.310,34.430],[31.290,34.400],[31.300,34.360],[31.320,34.330],[31.350,34.320],[31.370,34.340],[31.380,34.380]],
  west_bank: [[32.200,35.050],[32.250,35.150],[32.200,35.300],[32.100,35.400],[31.950,35.450],[31.800,35.400],[31.700,35.300],[31.650,35.200],[31.600,35.100],[31.650,35.000],[31.750,34.950],[31.850,34.950],[31.950,34.980],[32.050,35.000],[32.150,35.020],[32.200,35.050]],
  lebanon: [[33.450,35.100],[33.500,35.200],[33.500,35.400],[33.400,35.500],[33.300,35.550],[33.250,35.500],[33.200,35.400],[33.200,35.250],[33.250,35.150],[33.350,35.100],[33.450,35.100]],
  syria: [[33.350,35.800],[33.400,36.000],[33.350,36.200],[33.200,36.300],[33.050,36.250],[33.000,36.050],[33.050,35.850],[33.150,35.750],[33.280,35.750],[33.350,35.800]],
  golan: [[33.050,35.700],[33.100,35.750],[33.100,35.850],[33.000,35.900],[32.900,35.870],[32.850,35.800],[32.850,35.730],[32.900,35.680],[32.970,35.670],[33.050,35.700]],
  haifa_bay: [[32.850,35.000],[32.860,35.040],[32.840,35.070],[32.815,35.080],[32.800,35.060],[32.800,35.025],[32.810,35.000],[32.830,34.990],[32.850,35.000]],
};

// ── GPS lookup for cities/settlements that may appear in oref alerts but aren't in REGIONS ──
const CITY_GPS_LOOKUP: Record<string, { lat: number; lon: number }> = {
  // ═══ North — Upper Galilee & Golan border ═══
  'חוף אכזיב': { lat: 33.05, lon: 35.10 }, 'חוף בצת': { lat: 33.06, lon: 35.13 },
  'איזור תעשייה מילואות צפון': { lat: 33.07, lon: 35.14 },
  'כפר גלעדי': { lat: 33.24, lon: 35.57 }, 'כפר יובל': { lat: 33.23, lon: 35.59 },
  'משגב עם': { lat: 33.26, lon: 35.56 }, 'גשר הזיו': { lat: 33.03, lon: 35.10 },
  'לימן': { lat: 33.04, lon: 35.12 }, 'שלומי': { lat: 33.08, lon: 35.15 },
  'דובב': { lat: 33.09, lon: 35.36 }, 'יפתח': { lat: 33.16, lon: 35.52 },
  'אביבים': { lat: 33.16, lon: 35.48 }, 'מנרה': { lat: 33.25, lon: 35.53 },
  'מרגליות': { lat: 33.22, lon: 35.58 }, 'יראון': { lat: 33.09, lon: 35.40 },
  'מלכיה': { lat: 33.27, lon: 35.55 }, 'דן': { lat: 33.23, lon: 35.65 },
  'שניר': { lat: 33.27, lon: 35.62 }, 'בית הלל': { lat: 33.20, lon: 35.61 },
  'הגושרים': { lat: 33.22, lon: 35.62 }, 'כפר בלום': { lat: 33.17, lon: 35.62 },
  'שדה אליעזר': { lat: 33.11, lon: 35.56 }, 'חצור הגלילית': { lat: 32.98, lon: 35.54 },
  'ראש פינה': { lat: 32.97, lon: 35.55 }, 'עין יעקב': { lat: 33.01, lon: 35.22 },
  'מעלות תרשיחא': { lat: 33.02, lon: 35.27 }, 'חניתה': { lat: 33.09, lon: 35.15 },
  'זרעית': { lat: 33.10, lon: 35.32 }, 'יערה': { lat: 33.05, lon: 35.28 },
  'שתולה': { lat: 33.10, lon: 35.29 }, 'ברעם': { lat: 33.05, lon: 35.44 },
  'דישון': { lat: 33.07, lon: 35.47 },
  // North — additional settlements
  'נטועה': { lat: 33.07, lon: 35.31 }, 'אילון': { lat: 33.06, lon: 35.34 },
  'גורנות הגליל': { lat: 33.05, lon: 35.32 }, 'מצובה': { lat: 33.08, lon: 35.17 },
  'בצת': { lat: 33.06, lon: 35.15 }, 'סאסא': { lat: 33.02, lon: 35.38 },
  'פקיעין': { lat: 32.97, lon: 35.35 }, 'מגדל העמק': { lat: 32.68, lon: 35.24 },
  'בית שאן': { lat: 32.50, lon: 35.50 }, 'עמיעד': { lat: 32.93, lon: 35.56 },
  'ראש הנקרה': { lat: 33.09, lon: 35.10 }, 'אדמית': { lat: 33.08, lon: 35.22 },
  'גורן': { lat: 33.03, lon: 35.30 }, 'אלקוש': { lat: 33.04, lon: 35.33 },
  'הילה': { lat: 33.11, lon: 35.45 },
  'רמות נפתלי': { lat: 33.12, lon: 35.50 }, 'בר יוחאי': { lat: 32.99, lon: 35.44 },
  'עלמה': { lat: 33.01, lon: 35.51 }, 'עמוקה': { lat: 32.99, lon: 35.50 },
  'חורפיש': { lat: 33.02, lon: 35.34 }, 'ג\'ת': { lat: 33.02, lon: 35.36 },
  'פסוטה': { lat: 33.05, lon: 35.24 }, 'מעיליא': { lat: 33.03, lon: 35.26 },
  'כישור': { lat: 32.99, lon: 35.26 }, 'מכמנים': { lat: 32.96, lon: 35.36 },
  'צוריאל': { lat: 33.00, lon: 35.28 }, 'כמון': { lat: 32.95, lon: 35.30 },
  'לפידות': { lat: 32.93, lon: 35.32 }, 'שגב שלום': { lat: 31.25, lon: 34.85 },
  'תל חי': { lat: 33.23, lon: 35.57 }, 'נאות מרדכי': { lat: 33.16, lon: 35.60 },
  'עמיר': { lat: 33.13, lon: 35.59 }, 'שאר ישוב': { lat: 33.22, lon: 35.64 },
  'גונן': { lat: 33.15, lon: 35.61 }, 'דפנה': { lat: 33.22, lon: 35.64 },
  'חגור': { lat: 32.15, lon: 34.93 },
  // North — Golan
  'קצרין': { lat: 32.99, lon: 35.69 }, 'אל-רום': { lat: 33.17, lon: 35.77 },
  'מג\'דל שמס': { lat: 33.27, lon: 35.77 }, 'מסעדה': { lat: 33.24, lon: 35.75 },
  'בוקעאתא': { lat: 33.21, lon: 35.77 }, 'עין קנייא': { lat: 33.25, lon: 35.76 },
  'נווה אטי"ב': { lat: 33.15, lon: 35.82 }, 'חד נס': { lat: 32.80, lon: 35.69 },
  'אורטל': { lat: 33.16, lon: 35.79 }, 'מרום גולן': { lat: 33.13, lon: 35.77 },
  'אודם': { lat: 33.18, lon: 35.76 }, 'נמרוד': { lat: 33.25, lon: 35.71 },
  'סנאים': { lat: 33.22, lon: 35.81 }, 'שעל': { lat: 33.08, lon: 35.74 },
  // ═══ Haifa area ═══
  'טירת כרמל': { lat: 32.76, lon: 34.97 }, 'נשר': { lat: 32.77, lon: 35.04 },
  'קריית אתא': { lat: 32.81, lon: 35.11 }, 'קריית ביאליק': { lat: 32.83, lon: 35.09 },
  'קריית ים': { lat: 32.84, lon: 35.07 }, 'קריית מוצקין': { lat: 32.84, lon: 35.08 },
  'רכסים': { lat: 32.76, lon: 35.08 }, 'דלית אל כרמל': { lat: 32.69, lon: 35.05 },
  'עוספיא': { lat: 32.72, lon: 35.07 }, 'עתלית': { lat: 32.69, lon: 34.94 },
  'זכרון יעקב': { lat: 32.57, lon: 34.95 }, 'פרדס חנה כרכור': { lat: 32.47, lon: 34.97 },
  'אור עקיבא': { lat: 32.51, lon: 34.92 }, 'קיסריה': { lat: 32.51, lon: 34.89 },
  'ג\'סר א-זרקא': { lat: 32.54, lon: 34.90 }, 'פוריידיס': { lat: 32.59, lon: 34.94 },
  // ═══ Western Galilee ═══
  'כברי': { lat: 33.02, lon: 35.14 }, 'בן עמי': { lat: 33.03, lon: 35.12 },
  'סער': { lat: 33.01, lon: 35.09 }, 'נתיב השיירה': { lat: 33.02, lon: 35.08 },
  'בוסתן הגליל': { lat: 33.02, lon: 35.10 }, 'עברון': { lat: 33.01, lon: 35.11 },
  'שבי ציון': { lat: 32.99, lon: 35.08 }, 'לוחמי הגטאות': { lat: 32.96, lon: 35.09 },
  'מזרעה': { lat: 32.98, lon: 35.10 }, 'רגבה': { lat: 33.00, lon: 35.12 },
  'ביריה': { lat: 32.99, lon: 35.49 }, 'עין זיתים': { lat: 32.98, lon: 35.48 },
  'חזון': { lat: 32.95, lon: 35.48 }, 'דלתון': { lat: 33.00, lon: 35.51 },
  // ═══ Jezreel Valley ═══
  'נצרת': { lat: 32.70, lon: 35.30 }, 'נצרת עילית': { lat: 32.72, lon: 35.33 },
  'נוף הגליל': { lat: 32.72, lon: 35.33 }, 'מגדל': { lat: 32.84, lon: 35.52 },
  'כפר תבור': { lat: 32.69, lon: 35.42 }, 'שבלי אום אל-גנם': { lat: 32.67, lon: 35.36 },
  'עין דור': { lat: 32.63, lon: 35.39 }, 'רמת ישי': { lat: 32.70, lon: 35.17 },
  // ═══ Gaza envelope — all communities ═══
  'כיסופים': { lat: 31.38, lon: 34.40 }, 'נירים': { lat: 31.36, lon: 34.40 },
  'עין השלושה': { lat: 31.35, lon: 34.41 }, 'ניר עוז': { lat: 31.34, lon: 34.40 },
  'בארי': { lat: 31.43, lon: 34.49 }, 'רעים': { lat: 31.41, lon: 34.47 },
  'נחל עוז': { lat: 31.48, lon: 34.49 }, 'כרם אבו סאלם': { lat: 31.22, lon: 34.27 },
  'זיקים': { lat: 31.62, lon: 34.52 }, 'ארז': { lat: 31.55, lon: 34.50 },
  'יד מרדכי': { lat: 31.59, lon: 34.55 }, 'קיבוץ עד הלום': { lat: 31.61, lon: 34.58 },
  'כפר עזה': { lat: 31.48, lon: 34.47 }, 'סופה': { lat: 31.23, lon: 34.28 },
  'חוליות': { lat: 31.27, lon: 34.34 }, 'תקומה': { lat: 31.44, lon: 34.53 },
  'אשכול': { lat: 31.35, lon: 34.45 }, 'עלומים': { lat: 31.41, lon: 34.56 },
  'אורים': { lat: 31.31, lon: 34.49 }, 'מפלסים': { lat: 31.47, lon: 34.53 },
  'יכיני': { lat: 31.39, lon: 34.52 }, 'נורית': { lat: 31.37, lon: 34.50 },
  'נתיב העשרה': { lat: 31.56, lon: 34.51 },
  'שובה': { lat: 31.30, lon: 34.40 },
  'גבולות': { lat: 31.24, lon: 34.38 }, 'צאלים': { lat: 31.28, lon: 34.56 },
  'מבטחים': { lat: 31.33, lon: 34.53 }, 'פטיש': { lat: 31.33, lon: 34.61 },
  'עין הבשור': { lat: 31.26, lon: 34.42 }, 'רוחמה': { lat: 31.49, lon: 34.63 },
  'דורות': { lat: 31.51, lon: 34.62 }, 'גבעולים': { lat: 31.42, lon: 34.59 },
  'ברור חיל': { lat: 31.46, lon: 34.61 }, 'ניר יצחק': { lat: 31.25, lon: 34.36 },
  'אבן שמואל': { lat: 31.53, lon: 34.65 }, 'שורש': { lat: 31.78, lon: 35.02 },
  // ═══ Shfela & South ═══
  'קריית מלאכי': { lat: 31.73, lon: 34.75 }, 'גדרה': { lat: 31.81, lon: 34.78 },
  'יבנה': { lat: 31.88, lon: 34.74 }, 'ראשון לציון': { lat: 31.97, lon: 34.80 },
  'בת ים': { lat: 32.02, lon: 34.75 }, 'חולון': { lat: 32.02, lon: 34.78 },
  'לוד': { lat: 31.95, lon: 34.90 }, 'רמלה': { lat: 31.93, lon: 34.87 },
  'קריית גת': { lat: 31.61, lon: 34.76 }, 'לכיש': { lat: 31.57, lon: 34.78 },
  'גן יבנה': { lat: 31.79, lon: 34.71 }, 'נס ציונה': { lat: 31.93, lon: 34.80 },
  // ═══ Center / Gush Dan ═══
  'כפר סבא': { lat: 32.18, lon: 34.91 }, 'רעננה': { lat: 32.19, lon: 34.87 },
  'הוד השרון': { lat: 32.15, lon: 34.89 }, 'רמת השרון': { lat: 32.14, lon: 34.84 },
  'בני ברק': { lat: 32.08, lon: 34.83 }, 'גבעתיים': { lat: 32.07, lon: 34.81 },
  'אור יהודה': { lat: 32.03, lon: 34.86 }, 'אזור': { lat: 32.03, lon: 34.79 },
  'יהוד מונוסון': { lat: 32.03, lon: 34.88 }, 'קרית אונו': { lat: 32.06, lon: 34.86 },
  'גבעת שמואל': { lat: 32.08, lon: 34.85 }, 'אלעד': { lat: 32.05, lon: 34.95 },
  'שוהם': { lat: 31.99, lon: 34.95 }, 'כפר קאסם': { lat: 32.11, lon: 34.98 },
  'טירה': { lat: 32.23, lon: 34.95 }, 'טייבה': { lat: 32.26, lon: 35.01 },
  'קלנסווה': { lat: 32.28, lon: 34.98 }, 'כפר יונה': { lat: 32.32, lon: 34.93 },
  'אבן יהודה': { lat: 32.27, lon: 34.89 }, 'נתן': { lat: 32.14, lon: 34.96 },
  'צורן': { lat: 32.20, lon: 34.94 },
  // ═══ Sharon ═══
  'חדרה': { lat: 32.44, lon: 34.92 }, 'בנימינה גבעת עדה': { lat: 32.52, lon: 34.95 },
  'עמק חפר': { lat: 32.33, lon: 34.93 }, 'מעבר': { lat: 32.18, lon: 34.89 },
  // ═══ Jerusalem corridor ═══
  'מבשרת ציון': { lat: 31.80, lon: 35.15 }, 'מעלה אדומים': { lat: 31.78, lon: 35.30 },
  'אבו גוש': { lat: 31.80, lon: 35.11 }, 'בית זית': { lat: 31.80, lon: 35.17 },
  'גבעת זאב': { lat: 31.86, lon: 35.17 }, 'קריית יערים': { lat: 31.81, lon: 35.10 },
  'מוצא': { lat: 31.80, lon: 35.16 }, 'עין כרם': { lat: 31.77, lon: 35.16 },
  'ביתר עילית': { lat: 31.70, lon: 35.12 }, 'אפרת': { lat: 31.66, lon: 35.16 },
  'גוש עציון': { lat: 31.66, lon: 35.12 }, 'צור הדסה': { lat: 31.72, lon: 35.10 },
  // ═══ Negev ═══
  'ערערה בנגב': { lat: 31.15, lon: 34.79 }, 'כסיפה': { lat: 31.24, lon: 34.98 },
  'חורה': { lat: 31.30, lon: 34.93 }, 'תל ערד': { lat: 31.28, lon: 35.14 },
  'ירוחם': { lat: 30.99, lon: 34.93 }, 'רהט': { lat: 31.39, lon: 34.74 },
  'להבים': { lat: 31.37, lon: 34.81 }, 'עומר': { lat: 31.27, lon: 34.84 },
  'מיתר': { lat: 31.33, lon: 34.93 }, 'לקייה': { lat: 31.33, lon: 34.87 },
  'כרמים': { lat: 31.36, lon: 34.83 }, 'תל שבע': { lat: 31.26, lon: 34.82 },
  'נאות חובב': { lat: 31.15, lon: 34.80 },
  // ═══ Arava & Eilat ═══
  'יטבתה': { lat: 29.88, lon: 35.06 }, 'חבל אילות': { lat: 29.65, lon: 34.98 },
  'באר אורה': { lat: 29.73, lon: 35.01 }, 'ספיר': { lat: 30.25, lon: 35.18 },
  'פארן': { lat: 30.12, lon: 35.12 }, 'ערבה': { lat: 30.55, lon: 35.17 },
  'עין יהב': { lat: 30.78, lon: 35.24 }, 'חצבה': { lat: 30.75, lon: 35.23 },
  'עין גדי': { lat: 31.46, lon: 35.39 }, 'נווה זוהר': { lat: 31.14, lon: 35.37 },
  // ═══ Jordan Valley ═══
  'בקעת הירדן': { lat: 32.22, lon: 35.52 }, 'מחולה': { lat: 32.38, lon: 35.54 },
  'חמרה': { lat: 32.30, lon: 35.55 }, 'שדמות מחולה': { lat: 32.38, lon: 35.54 },
  'מעלה גלבוע': { lat: 32.48, lon: 35.42 }, 'בית אלפא': { lat: 32.52, lon: 35.44 },
  'גלגל': { lat: 31.97, lon: 35.44 }, 'יריחו': { lat: 31.86, lon: 35.45 },
  // ═══ West Bank settlements ═══
  'אריאל': { lat: 32.10, lon: 35.17 }, 'קרני שומרון': { lat: 32.17, lon: 35.10 },
  'עמנואל': { lat: 32.16, lon: 35.16 }, 'קדומים': { lat: 32.18, lon: 35.17 },
  'אלפי מנשה': { lat: 32.17, lon: 34.98 }, 'ברקן': { lat: 32.10, lon: 35.11 },
  'רבבה': { lat: 32.12, lon: 35.15 }, 'עלי': { lat: 32.08, lon: 35.27 },
  'שילה': { lat: 32.05, lon: 35.29 }, 'בית אל': { lat: 31.94, lon: 35.22 },
  'עפרה': { lat: 31.96, lon: 35.27 }, 'חברון': { lat: 31.53, lon: 35.10 },
  'קריית ארבע': { lat: 31.53, lon: 35.12 }, 'בית לחם': { lat: 31.71, lon: 35.21 },
  // ═══ Additional nationwide coverage ═══
  // Northern towns & moshavim
  'יסוד המעלה': { lat: 33.07, lon: 35.58 }, 'מישמר הירדן': { lat: 32.90, lon: 35.58 },
  'כורזים': { lat: 32.91, lon: 35.56 }, 'הושעיה': { lat: 32.73, lon: 35.28 },
  'עילבון': { lat: 32.83, lon: 35.41 }, 'טורען': { lat: 32.78, lon: 35.33 },
  'דבוריה': { lat: 32.69, lon: 35.38 }, 'אכסאל': { lat: 32.66, lon: 35.33 },
  'ריינה': { lat: 32.72, lon: 35.31 }, 'כפר כנא': { lat: 32.75, lon: 35.34 },
  'כפר מנדא': { lat: 32.78, lon: 35.26 }, 'עראבה': { lat: 32.85, lon: 35.33 },
  'סח\'נין': { lat: 32.86, lon: 35.30 }, 'דיר חנא': { lat: 32.87, lon: 35.37 },
  'מג\'ד אל-כרום': { lat: 32.92, lon: 35.24 }, 'ג\'דיידה מכר': { lat: 32.93, lon: 35.14 },
  'טמרה': { lat: 32.85, lon: 35.20 }, 'שפרעם': { lat: 32.81, lon: 35.17 },
  'כאוכב אבו אל-היג\'א': { lat: 32.85, lon: 35.27 }, 'אום אל פחם': { lat: 32.52, lon: 35.15 },
  'באקה אל-גרבייה': { lat: 32.42, lon: 35.04 },
  // Sharon & Center — additional
  'יהוד': { lat: 32.03, lon: 34.88 },
  // Dead Sea & southern Arava
  'עין בוקק': { lat: 31.20, lon: 35.36 }, 'סדום': { lat: 31.03, lon: 35.39 },
  'ים המלח': { lat: 31.50, lon: 35.48 }, 'מצדה': { lat: 31.32, lon: 35.35 },
  'תמר': { lat: 31.10, lon: 35.33 },
  'צופר': { lat: 30.62, lon: 35.19 }, 'קטורה': { lat: 29.96, lon: 35.07 },
  'לוטן': { lat: 29.98, lon: 35.08 }, 'גרופית': { lat: 30.05, lon: 35.09 },
  'נאות סמדר': { lat: 30.03, lon: 35.10 }, 'עידן': { lat: 30.83, lon: 35.25 },
  'צוקים': { lat: 30.72, lon: 35.22 },
  // Coastal cities — additional
  'גת': { lat: 31.61, lon: 34.76 }, 'עד הלום': { lat: 31.61, lon: 34.58 },
  // Lachish region
  'נחלה': { lat: 31.60, lon: 34.82 }, 'אמציה': { lat: 31.58, lon: 34.90 },
  // Judean Hills
  'קריית ענבים': { lat: 31.80, lon: 35.09 }, 'נחם': { lat: 31.73, lon: 35.04 },
  'צרעה': { lat: 31.77, lon: 34.99 }, 'אשתאול': { lat: 31.78, lon: 35.00 },
  // Mateh Yehuda
  'בר גיורא': { lat: 31.72, lon: 35.07 }, 'נחשון': { lat: 31.82, lon: 35.00 },
  // Upper Negev — sub-areas
  'באר שבע - מזרח': { lat: 31.25, lon: 34.82 }, 'באר שבע - צפון': { lat: 31.27, lon: 34.79 },
  'באר שבע - דרום': { lat: 31.23, lon: 34.79 }, 'באר שבע - מערב': { lat: 31.25, lon: 34.76 },
  'נבטים': { lat: 31.21, lon: 34.93 }, 'אל פורעה': { lat: 31.22, lon: 34.89 },
  // Eilat region
  'אילת - מרכז': { lat: 29.56, lon: 34.95 }, 'אילת - צפון': { lat: 29.59, lon: 34.95 },
  'טאבה': { lat: 29.49, lon: 34.90 }, 'תמנע': { lat: 29.78, lon: 34.99 },
  // Haifa sub-areas
  'חיפה - כרמל': { lat: 32.77, lon: 34.97 }, 'חיפה - נמל': { lat: 32.82, lon: 35.00 },
  'חיפה - מפרץ': { lat: 32.84, lon: 35.05 },
  // Tel Aviv sub-areas
  'תל אביב - יפו': { lat: 32.05, lon: 34.76 }, 'תל אביב - צפון': { lat: 32.11, lon: 34.79 },
  // Additional Gaza envelope
  'עוטף עזה': { lat: 31.45, lon: 34.45 }, 'שער הנגב': { lat: 31.50, lon: 34.55 },
  'חוף אשקלון': { lat: 31.63, lon: 34.54 }, 'מרחבים': { lat: 31.40, lon: 34.60 },
  // Judea & Samaria regional
  'בנימין': { lat: 31.95, lon: 35.25 }, 'שומרון': { lat: 32.15, lon: 35.15 },
  'דרום הר חברון': { lat: 31.40, lon: 35.05 },
  'יתיר': { lat: 31.35, lon: 35.08 }, 'סוסיא': { lat: 31.40, lon: 35.11 },
  'מעון': { lat: 31.41, lon: 35.09 }, 'כרמל': { lat: 31.43, lon: 35.12 },
  // Additional Western Galilee
  'בית ג\'ן': { lat: 32.90, lon: 35.40 }, 'ירכא': { lat: 32.96, lon: 35.19 },
  'כפר יאסיף': { lat: 32.95, lon: 35.16 }, 'אבו סנאן': { lat: 32.95, lon: 35.17 },
  'ג\'ולס': { lat: 32.93, lon: 35.17 }, 'כפר ראמה': { lat: 32.92, lon: 35.37 },
  'עין מאהל': { lat: 32.75, lon: 35.30 },
  // Druze villages
  'ראמה': { lat: 32.92, lon: 35.37 }, 'ינוח-ג\'ת': { lat: 32.95, lon: 35.32 },
  'בית ג\'אן': { lat: 32.90, lon: 35.40 }, 'חוראפיש': { lat: 33.02, lon: 35.34 },
};


function createRegionIcon(region: MapRegion) {
  const sc = SEVERITY_COLORS[region.severity] || SEVERITY_COLORS.safe;
  const icon = REGION_ICONS[region.id] || (region.isCity ? '🏘️' : '📍');
  return L.divIcon({
    className: '',
    html: `<div style="display:flex;align-items:center;justify-content:center;width:22px;height:22px;font-size:12px;filter:drop-shadow(0 0 3px ${sc.color});cursor:pointer;">${icon}</div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
  });
}

const SEVERITY_COLORS: Record<string, { color: string; radius: number }> = {
  early_warning: { color: '#ff9100', radius: 12 },
  critical: { color: '#ff1744', radius: 10 },
  high: { color: '#ff3d00', radius: 8 },
  warning: { color: '#ff6d00', radius: 7 },
  medium: { color: '#ffab00', radius: 6 },
  low: { color: '#4caf50', radius: 5 },
  safe: { color: '#00e676', radius: 4 },
};

const SEVERITY_LABELS: Record<string, string> = {
  early_warning: 'התרעה מוקדמת', critical: 'קריטי', high: 'גבוה', warning: 'אזהרה', medium: 'בינוני', low: 'נמוך', safe: 'תקין',
};

const DEMO_SCENARIOS: { key: DemoScenario; label: string; icon: string }[] = [
  { key: 'calm', label: 'שגרה', icon: '🟢' },
  { key: 'escalation', label: 'הסלמה', icon: '🟡' },
  { key: 'war', label: 'מלחמה', icon: '🔴' },
  { key: 'multi_front', label: 'רב-חזיתי', icon: '⚫' },
  { key: 'lebanon_op', label: 'לבנון', icon: '🇱🇧' },
];

// ── IDF Strike Targets in Lebanon (for lebanon_op scenario) ──
interface IDFStrikeTarget {
  id: string;
  name: string;
  nameEn: string;
  lat: number;
  lon: number;
  type: 'airstrike' | 'artillery' | 'drone' | 'naval';
  description: string;
  icon: string;
  color: string;
  timeOffsetMin: number; // minutes ago this strike happened
}

const LEBANON_STRIKE_TARGETS: IDFStrikeTarget[] = [
  { id: 'dahieh', name: 'דאחיה — ביירות', nameEn: 'Dahieh, Beirut', lat: 33.85, lon: 35.50, type: 'airstrike', description: 'תקיפת מפקדת חיזבאללה — IAF F-35', icon: '✈️', color: '#ff1744', timeOffsetMin: 3 },
  { id: 'baalbek', name: 'בעלבכ', nameEn: 'Baalbek', lat: 34.00, lon: 36.21, type: 'airstrike', description: 'חיסול מחסן טילים — IAF F-16I', icon: '✈️', color: '#ff1744', timeOffsetMin: 8 },
  { id: 'nabatieh', name: 'נבטייה', nameEn: 'Nabatieh', lat: 33.38, lon: 35.48, type: 'airstrike', description: 'תקיפת משגר אנטי-טנק — IAF', icon: '✈️', color: '#ff3d00', timeOffsetMin: 5 },
  { id: 'tyre', name: 'צור', nameEn: 'Tyre', lat: 33.27, lon: 35.20, type: 'airstrike', description: 'השמדת מנהרת חיזבאללה', icon: '✈️', color: '#ff3d00', timeOffsetMin: 12 },
  { id: 'marjayoun', name: 'מרג\'עיון', nameEn: 'Marjayoun', lat: 33.36, lon: 35.59, type: 'artillery', description: 'הפגזת ארטילריה — תותחנים 155mm', icon: '💣', color: '#ff6d00', timeOffsetMin: 2 },
  { id: 'bint_jbeil', name: 'בינת ג\'ביל', nameEn: 'Bint Jbeil', lat: 33.12, lon: 35.43, type: 'artillery', description: 'הפגזת מוצבי חיזבאללה — חטיבה 300', icon: '💣', color: '#ff6d00', timeOffsetMin: 7 },
  { id: 'aitaroun', name: 'עיתרון', nameEn: 'Aitaroun', lat: 33.13, lon: 35.40, type: 'drone', description: 'כטב"מ — חיסול ממוקד תא טרור', icon: '🛩️', color: '#ab47bc', timeOffsetMin: 15 },
  { id: 'khiam', name: 'חיאם', nameEn: 'Khiam', lat: 33.34, lon: 35.65, type: 'drone', description: 'כטב"מ הרמס — סריקת שטח', icon: '🛩️', color: '#ab47bc', timeOffsetMin: 10 },
  { id: 'sidon', name: 'צידון', nameEn: 'Sidon', lat: 33.56, lon: 35.38, type: 'airstrike', description: 'תקיפת מחסן נשק', icon: '✈️', color: '#ff1744', timeOffsetMin: 20 },
  { id: 'litani_bridge', name: 'גשר הליטאני', nameEn: 'Litani Bridge', lat: 33.35, lon: 35.30, type: 'airstrike', description: 'השמדת צומת לוגיסטי', icon: '💥', color: '#ff3d00', timeOffsetMin: 25 },
  { id: 'jounieh_coast', name: 'חוף ג\'וניה', nameEn: 'Jounieh Coast', lat: 33.98, lon: 35.62, type: 'naval', description: 'חסימה ימית — סער 6', icon: '🚢', color: '#42a5f5', timeOffsetMin: 0 },
];

const SCENARIO_SEVERITY: Record<DemoScenario, Partial<Record<string, MapRegion['severity']>>> = {
  calm: {},
  escalation: {
    gaza: 'critical', gaza_north: 'critical', gaza_south: 'critical',
    sderot: 'critical', ashkelon: 'high', netivot: 'high', ofakim: 'high',
    beer_sheva: 'medium', kiryat_shmona: 'warning', metula: 'warning', lebanon: 'warning',
  },
  war: {
    lebanon: 'critical', golan: 'high', haifa: 'high', tlv: 'high', jerusalem: 'warning',
    gaza: 'critical', gaza_north: 'critical', gaza_south: 'critical', west_bank: 'high',
    sderot: 'critical', ashkelon: 'critical', netivot: 'critical', ofakim: 'critical',
    metula: 'critical', kiryat_shmona: 'critical', safed: 'high', nahariya: 'high',
    beer_sheva: 'high', ramat_gan: 'high', ashdod: 'high',
  },
  multi_front: {
    lebanon: 'critical', golan: 'critical', syria: 'high', haifa: 'critical',
    tlv: 'critical', jerusalem: 'high', gaza: 'critical', west_bank: 'critical',
    sderot: 'critical', ashkelon: 'critical', netivot: 'critical', beer_sheva: 'high',
    metula: 'critical', kiryat_shmona: 'critical', safed: 'critical', nahariya: 'critical',
    eilat: 'high', dimona: 'high', ramat_gan: 'critical',
  },
  lebanon_op: {
    lebanon: 'critical', golan: 'warning', syria: 'medium',
    metula: 'high', kiryat_shmona: 'high', safed: 'warning', nahariya: 'warning',
    haifa: 'medium', acre: 'medium', karmiel: 'warning', tiberias: 'medium',
  },
};

const SCENARIO_MISSILES: Record<DemoScenario, string[]> = {
  calm: [],
  escalation: ['gaza_hamas'],
  war: ['gaza_hamas', 'lebanon_hzb', 'lebanon_uav'],
  multi_front: ['gaza_hamas', 'lebanon_hzb', 'lebanon_uav', 'iran', 'houthis', 'iraq_militia', 'houthis_cruise'],
  lebanon_op: ['lebanon_hzb', 'lebanon_uav'], // Hezbollah retaliates
};

const severityRank = (s: MapRegion['severity']) => ({ early_warning: -1, critical: 0, high: 1, warning: 2, medium: 3, low: 4, safe: 5 }[s] ?? 5);

const formatFlightTime = (sec: number) => {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
};

// No API token needed — using free retina-quality providers
// CartoDB for dark/light (@2x retina), Esri World Imagery for satellite (best free aerial)
const TILE_URLS: Record<TileTheme, string> = {
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png',
  light: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  thermal: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png',
  // Google retina tiles (@2x via scale=2)
  google: 'https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}&scale=2',
  google_satellite: 'https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}&scale=2',
};

// No-labels base for thermal — avoids duplicate city names
const THERMAL_BASE_URL = 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}@2x.png';

// High-quality overlays — retina
const BORDERS_OVERLAY = 'https://stamen-tiles-{s}.a.ssl.fastly.net/toner-lines/{z}/{x}/{y}@2x.png';
const LABELS_OVERLAY = 'https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}@2x.png';
// TomTom Traffic Flow via secure edge proxy (key stays server-side)
const TRAFFIC_LAYER = `https://${import.meta.env.VITE_SUPABASE_PROJECT_ID}.supabase.co/functions/v1/tomtom-traffic-tile/relative0/{z}/{x}/{y}.png`;

// ── Zoom tracker component ──
const ZoomTracker = ({ onZoomChange }: { onZoomChange: (z: number) => void }) => {
  const map = useMap();
  useEffect(() => {
    const handler = () => onZoomChange(map.getZoom());
    map.on('zoomend', handler);
    onZoomChange(map.getZoom());
    return () => { map.off('zoomend', handler); };
  }, [map, onZoomChange]);
  return null;
};

const MapCenterTracker = ({ onCenterChange }: { onCenterChange: (center: [number, number]) => void }) => {
  const map = useMap();
  useEffect(() => {
    const handler = () => {
      const center = map.getCenter();
      onCenterChange([center.lat, center.lng]);
    };
    map.on('moveend', handler);
    handler();
    return () => { map.off('moveend', handler); };
  }, [map, onCenterChange]);
  return null;
};

// ── Viewport bounds tracker — for lazy-loading markers outside view ──
interface ViewBounds { south: number; west: number; north: number; east: number; }
const BoundsTracker = ({ onBoundsChange }: { onBoundsChange: (b: ViewBounds) => void }) => {
  const map = useMap();
  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const DEBOUNCE_MS = 300;
    const handler = () => {
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        const b = map.getBounds().pad(0.25); // 25% padding to avoid pop-in on pan
        onBoundsChange({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
      }, DEBOUNCE_MS);
    };
    map.on('moveend', handler);
    map.on('zoomend', handler);
    // initial bounds — immediate, no debounce
    const b0 = map.getBounds().pad(0.25);
    onBoundsChange({ south: b0.getSouth(), west: b0.getWest(), north: b0.getNorth(), east: b0.getEast() });
    return () => { map.off('moveend', handler); map.off('zoomend', handler); if (timeoutId) clearTimeout(timeoutId); };
  }, [map, onBoundsChange]);
  return null;
};

const isInBounds = (lat: number, lon: number, b: ViewBounds | null): boolean => {
  if (!b) return true;
  return lat >= b.south && lat <= b.north && lon >= b.west && lon <= b.east;
};
const MapController = ({
  center,
  zoom,
  bounds,
  minZoom = 7,
  boundsPadding = 60,
}: {
  center: [number, number] | null;
  zoom: number | null;
  bounds?: L.LatLngBoundsExpression | null;
  minZoom?: number;
  boundsPadding?: number;
}) => {
  const map = useMap();

  useEffect(() => {
    map.setMinZoom(minZoom);
    map.invalidateSize();

    if (bounds) {
      map.flyToBounds(bounds as L.LatLngBoundsExpression, {
        duration: 1.2,
        padding: [boundsPadding, boundsPadding],
        maxZoom: 12,
      });
    } else if (center && zoom) {
      map.flyTo(center, zoom, { duration: 1.0 });
    }
  }, [center, zoom, bounds, map, minZoom, boundsPadding]);

  return null;
};

// Auto-close popups when mouse moves away from them
const AutoClosePopups = () => {
  const map = useMap();
  useEffect(() => {
    const handleMouseMove = (e: L.LeafletMouseEvent) => {
      // Check if mouse is over a popup element
      const target = e.originalEvent.target as HTMLElement;
      if (target && target.closest('.leaflet-popup')) return;
      // Close any open popup
      map.closePopup();
    };
    map.on('mousemove', handleMouseMove);
    return () => { map.off('mousemove', handleMouseMove); };
  }, [map]);
  return null;
};

// Double-click on map zooms 50% closer to that point
const MapDoubleClickZoom = ({ onDblClick }: { onDblClick: (lat: number, lon: number, currentZoom: number) => void }) => {
  const map = useMap();
  useEffect(() => {
    const handler = (e: L.LeafletMouseEvent) => {
      e.originalEvent.preventDefault();
      onDblClick(e.latlng.lat, e.latlng.lng, map.getZoom());
    };
    map.doubleClickZoom.disable(); // disable default dblclick zoom
    map.on('dblclick', handler);
    return () => { map.off('dblclick', handler); };
  }, [map, onDblClick]);
  return null;
};

const FULL_THEATER_BOUNDS: [[number, number], [number, number]] = [
  [24.4, 33.8],
  [40.6, 63.9],
];

const FULL_THEATER_MIN_ZOOM = 5;
const FULL_THEATER_PADDING = 16;

// ═══════════════════════════════════════════
// ── Main Component ──
// ═══════════════════════════════════════════
const TacticalMapView = () => {
  const telegram = useTelegram();
  const { getRoute } = useOSRMRoutes();
  const { theme, setTheme, cycleTheme } = useTheme();

  const [demoScenario, setDemoScenario] = useState<DemoScenario>('war');
  const [dataMode, setDataMode] = useState<DataMode>('live');
  const war = useWarRoom(dataMode);

  const [tileTheme, setTileTheme] = usePersistedState<TileTheme>('map.tileTheme', 'google_satellite');
  const [showTrajectories, setShowTrajectories] = usePersistedState('map.showTrajectories', false);
  const [showHeatmap, setShowHeatmap] = usePersistedState('map.showHeatmap', false);
  const [showForces, setShowForces] = usePersistedState('map.showForces', false);
  const [showRescue, setShowRescue] = usePersistedState('map.showRescue', false);
  const [selectedTgMessage, setSelectedTgMessage] = useState<any | null>(null);
  const [flyTo, setFlyTo] = useState<{ center: [number, number]; zoom: number } | null>(null);
  const [flyBounds, setFlyBounds] = useState<L.LatLngBoundsExpression | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<MapRegion | null>(null);
  const [expandedIntelId, setExpandedIntelId] = useState<string | null>(null);
  const [selectedIntelCategory, setSelectedIntelCategory] = useState<string | null>(null);
  const [intelFilterCategory, setIntelFilterCategory] = useState<string>('all');
  const isMobileInit = typeof window !== 'undefined' && window.innerWidth < 768;
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const CLOCK_COLORS = ['#39ff14', '#ffff00', '#ff1744'] as const; // green, yellow, red
  const CLOCK_LABELS = ['שגרה', 'כוננות', 'חירום'] as const;
  const [clockColorIdxManual, setClockColorIdxManual] = useState<number | null>(null);
  const [tzofarPhase, setTzofarPhase] = useState<0 | 1 | 2>(0);
  const [rightTab, setRightTab] = useState<'intel' | 'ai' | 'stocks' | 'report' | 'events'>('intel');
  const [situationSummary, setSituationSummary] = useState<string | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryTime, setSummaryTime] = useState<string | null>(null);
  const [aiAssessment, setAiAssessment] = useState<any>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiLastUpdate, setAiLastUpdate] = useState<string | null>(null);
  const [showTraffic, setShowTraffic] = usePersistedState('map.showTraffic', false);
  const [showFlights, setShowFlights] = usePersistedState('map.showFlights', false);
  const [showAircraftRoutes, setShowAircraftRoutes] = usePersistedState('map.showAircraftRoutes', false);
  const [mapZoom, setMapZoom] = useState(8);
  const [viewBounds, setViewBounds] = useState<ViewBounds | null>(null);
  // Scale factor for all map banners/labels — syncs with zoom level
  const zoomScale = Math.max(0.4, Math.min(1.6, mapZoom / 10));
  const [showVehicles, setShowVehicles] = usePersistedState('map.showVehicles', false);
  const [showMda, setShowMda] = usePersistedState('map.showMda', false);
  const [showFireDept, setShowFireDept] = usePersistedState('map.showFireDept', false);
  const [showPoliceDept, setShowPoliceDept] = usePersistedState('map.showPoliceDept', false);
  const [showEvents, setShowEvents] = usePersistedState('map.showEvents', false);
  const [showMaritime, setShowMaritime] = usePersistedState('map.showMaritime', false);
  const [showUav, setShowUav] = usePersistedState('map.showUav', false);
  const [uavRadiusKm, setUavRadiusKm] = usePersistedState('map.uavRadiusKm', 15);
  const [showFlightsBoard, setShowFlightsBoard] = usePersistedState('map.showFlightsBoard', false);
  const [showPopulationDensity, setShowPopulationDensity] = usePersistedState('map.showPopulationDensity', false);
  const [popDensityZoomThreshold, setPopDensityZoomThreshold] = usePersistedState<11 | 12 | 13 | 14>('map.popDensityZoomThreshold', 13);
  const [showGlobalEvents, setShowGlobalEvents] = usePersistedState('map.showGlobalEvents', false);
  const [globalSeverityFilter, setGlobalSeverityFilter] = usePersistedState<'all' | 'red' | 'orange'>('map.globalSeverityFilter', 'all');
  const [flightMonitorOpen, setFlightMonitorOpen] = useState(false);
  const [globalMonitorOpen, setGlobalMonitorOpen] = useState(false);
  const [disasterMonitorOpen, setDisasterMonitorOpen] = useState(false);

  // ── Maritime simulation data — Hormuz strait traffic + Israel coastal threats ──
  const maritimeVessels = useMemo(() => {
    // Seed-based pseudo-random for consistent positions that drift slightly
    const now = Date.now();
    const hourSeed = Math.floor(now / 3600000); // changes every hour
    const minuteSeed = Math.floor(now / 60000) % 60;
    const drift = (minuteSeed / 60) * 0.02; // small drift per minute

    // Hormuz strait commercial traffic (26.0-27.0 N, 56.0-57.0 E)
    const hormuzShips = [
      { id: 'HMZ-001', name: 'VLCC ARABIAN STAR', type: 'tanker', flag: '🇸🇦', lat: 26.56 + drift, lon: 56.25 - drift * 0.5, heading: 315, speed: 12, tonnage: '320K DWT', status: 'laden' },
      { id: 'HMZ-002', name: 'COSCO SHANGHAI', type: 'cargo', flag: '🇨🇳', lat: 26.48 - drift * 0.3, lon: 56.38 + drift, heading: 135, speed: 14, tonnage: '85K DWT', status: 'transit' },
      { id: 'HMZ-003', name: 'MT PACIFIC VOYAGER', type: 'tanker', flag: '🇱🇷', lat: 26.62 + drift * 0.7, lon: 56.10 - drift * 0.8, heading: 290, speed: 11, tonnage: '280K DWT', status: 'ballast' },
      { id: 'HMZ-004', name: 'EVERGREEN HARMONY', type: 'container', flag: '🇵🇦', lat: 26.35 - drift, lon: 56.52 + drift * 0.6, heading: 310, speed: 16, tonnage: '120K DWT', status: 'transit' },
      { id: 'HMZ-005', name: 'LNG DOHA SPIRIT', type: 'lng', flag: '🇶🇦', lat: 26.72 + drift * 0.4, lon: 56.18 - drift, heading: 270, speed: 15, tonnage: '170K CBM', status: 'laden' },
      { id: 'HMZ-006', name: 'STENA IMPERO II', type: 'tanker', flag: '🇬🇧', lat: 26.42 + drift * 0.2, lon: 56.45 + drift * 0.3, heading: 120, speed: 10, tonnage: '49K DWT', status: 'transit' },
      // IRGCN fast boats — threat
      { id: 'IRGCN-1', name: 'IRGCN PATROL 1', type: 'military_hostile', flag: '🇮🇷', lat: 26.55 - drift * 0.6, lon: 56.30 + drift * 0.4, heading: 45, speed: 28, tonnage: 'FAC', status: 'patrol' },
      { id: 'IRGCN-2', name: 'IRGCN PATROL 2', type: 'military_hostile', flag: '🇮🇷', lat: 26.60 + drift * 0.3, lon: 56.22 - drift * 0.5, heading: 180, speed: 32, tonnage: 'FAC', status: 'intercept' },
      // US Navy
      { id: 'USN-CVN', name: 'USS EISENHOWER (CVN-69)', type: 'military_us', flag: '🇺🇸', lat: 25.80 + drift * 0.1, lon: 56.90 + drift * 0.2, heading: 350, speed: 18, tonnage: 'CVN', status: 'carrier_ops' },
      { id: 'USN-DDG1', name: 'USS MASON (DDG-87)', type: 'military_us', flag: '🇺🇸', lat: 25.95 - drift * 0.2, lon: 56.75 - drift * 0.1, heading: 10, speed: 22, tonnage: 'DDG', status: 'escort' },
      { id: 'USN-CG1', name: 'USS PHILIPPINE SEA (CG-58)', type: 'military_us', flag: '🇺🇸', lat: 25.70 + drift * 0.15, lon: 57.05 + drift * 0.15, heading: 340, speed: 20, tonnage: 'CG', status: 'air_defense' },
    ];

    // Red Sea / Bab el-Mandeb — Houthi threat zone
    const redSeaShips = [
      { id: 'RS-THR-1', name: 'HOUTHI FIAC-1', type: 'military_hostile', flag: '🇾🇪', lat: 12.65 + drift * 0.4, lon: 43.30 - drift * 0.3, heading: 350, speed: 30, tonnage: 'FIAC', status: 'attack_run' },
      { id: 'RS-THR-2', name: 'HOUTHI USV BOMB', type: 'threat', flag: '🔴', lat: 13.10 - drift * 0.2, lon: 43.15 + drift * 0.5, heading: 10, speed: 25, tonnage: 'USV', status: 'explosive_drone' },
      { id: 'RS-THR-3', name: 'SUSPECT DHOW RED SEA', type: 'threat', flag: '⚠️', lat: 14.20 + drift * 0.3, lon: 42.50 - drift * 0.2, heading: 190, speed: 5, tonnage: '80T', status: 'weapons_smuggling' },
      { id: 'RS-COM-1', name: 'MSC MEDITERRANEAN VII', type: 'container', flag: '🇨🇭', lat: 13.50 + drift * 0.6, lon: 42.80 - drift * 0.4, heading: 340, speed: 12, tonnage: '150K DWT', status: 'diverted_route' },
      { id: 'RS-COM-2', name: 'VLCC DESERT ROSE', type: 'tanker', flag: '🇬🇷', lat: 14.80 - drift * 0.3, lon: 42.20 + drift * 0.1, heading: 350, speed: 10, tonnage: '300K DWT', status: 'laden' },
      // US Navy Red Sea
      { id: 'USN-DDG-RS', name: 'USS CARNEY (DDG-64)', type: 'military_us', flag: '🇺🇸', lat: 14.50 + drift * 0.1, lon: 42.40 - drift * 0.15, heading: 180, speed: 20, tonnage: 'DDG', status: 'houthi_intercept' },
      { id: 'USN-LHD-RS', name: 'USS BATAAN (LHD-5)', type: 'military_us', flag: '🇺🇸', lat: 15.20 - drift * 0.1, lon: 42.10 + drift * 0.1, heading: 160, speed: 15, tonnage: 'LHD', status: 'amphibious_ready' },
    ];

    // 6th Fleet / NATO Mediterranean
    const natoShips = [
      { id: 'NATO-CVN', name: 'USS GERALD R. FORD (CVN-78)', type: 'military_us', flag: '🇺🇸', lat: 34.50 + drift * 0.1, lon: 30.00 - drift * 0.2, heading: 90, speed: 16, tonnage: 'CVN', status: '6th_fleet_ops' },
      { id: 'NATO-DDG', name: 'USS GRAVELY (DDG-107)', type: 'military_us', flag: '🇺🇸', lat: 34.30 - drift * 0.15, lon: 30.40 + drift * 0.1, heading: 120, speed: 22, tonnage: 'DDG', status: 'escort' },
      { id: 'NATO-FFG', name: 'FS ALSACE (D656)', type: 'military_nato', flag: '🇫🇷', lat: 35.00 + drift * 0.2, lon: 28.50 - drift * 0.1, heading: 80, speed: 18, tonnage: 'FREMM', status: 'nato_patrol' },
      { id: 'NATO-ITA', name: 'ITS CAVOUR (C550)', type: 'military_nato', flag: '🇮🇹', lat: 34.80 - drift * 0.1, lon: 29.20 + drift * 0.2, heading: 100, speed: 14, tonnage: 'CVH', status: 'carrier_ops' },
      { id: 'NATO-GR', name: 'HS HYDRA (F452)', type: 'military_nato', flag: '🇬🇷', lat: 35.20 + drift * 0.15, lon: 27.80 - drift * 0.15, heading: 110, speed: 16, tonnage: 'FFG', status: 'aegean_patrol' },
      { id: 'NATO-UK', name: 'HMS DIAMOND (D34)', type: 'military_nato', flag: '🇬🇧', lat: 33.80 + drift * 0.1, lon: 31.50 - drift * 0.1, heading: 270, speed: 20, tonnage: 'T45', status: 'air_defense' },
    ];

    // Israel coastal maritime threats
    const israelThreats = [
      // Hostile — smuggling / drone boats
      { id: 'IL-THR-1', name: 'SUSPICIOUS DHOW', type: 'threat', flag: '⚠️', lat: 32.65 + drift * 0.3, lon: 33.90 - drift, heading: 90, speed: 6, tonnage: '50T', status: 'suspect_smuggling' },
      { id: 'IL-THR-2', name: 'UNIDENTIFIED USV', type: 'threat', flag: '🔴', lat: 33.10 - drift * 0.5, lon: 34.80 + drift * 0.2, heading: 170, speed: 35, tonnage: 'USV', status: 'hostile_drone_boat' },
      { id: 'IL-THR-3', name: 'FISHING ANOMALY', type: 'threat', flag: '⚠️', lat: 31.80 + drift * 0.2, lon: 34.20 - drift * 0.3, heading: 45, speed: 3, tonnage: '20T', status: 'loitering' },
      // Israeli Navy
      { id: 'ILN-SAAR6-1', name: 'INS MAGEN (SAAR 6)', type: 'military_il', flag: '🇮🇱', lat: 32.80 - drift * 0.1, lon: 34.50 + drift * 0.1, heading: 330, speed: 24, tonnage: 'Corvette', status: 'patrol' },
      { id: 'ILN-SAAR5-1', name: 'INS LAHAV (SAAR 5)', type: 'military_il', flag: '🇮🇱', lat: 33.05 + drift * 0.15, lon: 34.30 - drift * 0.2, heading: 280, speed: 20, tonnage: 'Corvette', status: 'gas_platform_defense' },
      { id: 'ILN-SUB', name: 'INS DOLPHIN (SUB)', type: 'military_il', flag: '🇮🇱', lat: 32.20 + drift * 0.05, lon: 33.70 - drift * 0.1, heading: 250, speed: 8, tonnage: 'SSK', status: 'submerged_patrol' },
      // Commercial — gas platform area
      { id: 'IL-COM-1', name: 'LEVIATHAN SUPPLY', type: 'supply', flag: '🇮🇱', lat: 32.60 - drift * 0.1, lon: 34.10 + drift * 0.05, heading: 180, speed: 8, tonnage: '5K DWT', status: 'platform_supply' },
      { id: 'IL-COM-2', name: 'TAMAR GAS SHUTTLE', type: 'lng', flag: '🇳🇴', lat: 32.45 + drift * 0.2, lon: 34.25 - drift * 0.1, heading: 200, speed: 10, tonnage: '80K CBM', status: 'laden' },
      // Hezbollah maritime threat from Lebanon
      { id: 'LB-THR-1', name: 'SUSPECT VESSEL LB', type: 'threat', flag: '🔴', lat: 33.55 - drift * 0.4, lon: 35.20 + drift * 0.3, heading: 210, speed: 18, tonnage: 'FIAC', status: 'hostile_approach' },
    ];

    return [...hormuzShips, ...redSeaShips, ...natoShips, ...israelThreats];
  }, [Math.floor(Date.now() / 60000)]); // refresh every minute

  const getVesselIcon = useCallback((type: string) => {
    switch (type) {
      case 'tanker': return '🛢️';
      case 'cargo': case 'container': return '🚢';
      case 'lng': return '⛽';
      case 'supply': return '🚤';
      case 'military_us': return '⚓';
      case 'military_il': return '🔱';
      case 'military_nato': return '🛡️';
      case 'military_hostile': return '☠️';
      case 'threat': return '💀';
      default: return '🚢';
    }
  }, []);

  const getVesselColor = useCallback((type: string) => {
    switch (type) {
      case 'tanker': return '#4fc3f7';
      case 'cargo': case 'container': return '#81c784';
      case 'lng': return '#fff176';
      case 'supply': return '#90a4ae';
      case 'military_us': return '#42a5f5';
      case 'military_il': return '#66bb6a';
      case 'military_nato': return '#5c6bc0';
      case 'military_hostile': return '#ef5350';
      case 'threat': return '#ff1744';
      default: return '#78909c';
    }
  }, []);

  // ── SVG ship icons for maritime layer ──
  const getVesselSVG = useCallback((type: string, color: string) => {
    // All icons are small SVGs that look like actual vessels
    const svgShip = `<svg viewBox="0 0 24 24" fill="${color}" xmlns="http://www.w3.org/2000/svg"><path d="M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.65 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.9-6.68c.11-.37.04-.78-.18-1.1l-.13-.15-1.15-1.34c-.3-.35-.74-.55-1.2-.55H18V6h-4V2H10v4H6v3.18H4.71c-.46 0-.9.2-1.2.55L2.36 11.07c-.22.32-.29.73-.18 1.1L3.95 19zM6 9h12v1.5H6V9z"/></svg>`;
    const svgMilitary = `<svg viewBox="0 0 24 24" fill="${color}" xmlns="http://www.w3.org/2000/svg"><path d="M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.65 2.62.99 4 .99h2v-2h-2zM3.95 19H4c1.6 0 3.02-.88 4-2 .98 1.12 2.4 2 4 2s3.02-.88 4-2c.98 1.12 2.4 2 4 2h.05l1.9-6.68c.11-.37.04-.78-.18-1.1l-.13-.15-1.15-1.34c-.3-.35-.74-.55-1.2-.55H18V6h-4V2H10v4H6v3.18H4.71c-.46 0-.9.2-1.2.55L2.36 11.07c-.22.32-.29.73-.18 1.1L3.95 19zM6 9h12v1.5H6V9z"/><line x1="12" y1="2" x2="12" y2="6" stroke="${color}" stroke-width="1.5"/></svg>`;
    const svgThreat = `<svg viewBox="0 0 24 24" fill="${color}" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L1 21h22L12 2zm0 3.83L19.53 19H4.47L12 5.83zM11 16h2v2h-2zm0-6h2v5h-2z"/></svg>`;
    const svgSpeedboat = `<svg viewBox="0 0 24 24" fill="${color}" xmlns="http://www.w3.org/2000/svg"><path d="M20 21c-1.39 0-2.78-.47-4-1.32-2.44 1.71-5.56 1.71-8 0C6.78 20.53 5.39 21 4 21H2v2h2c1.38 0 2.74-.35 4-.99 2.52 1.29 5.48 1.29 8 0 1.26.65 2.62.99 4 .99h2v-2h-2z"/><path d="M9.96 18.22C10.64 18.72 11.32 19 12 19s1.36-.28 2.04-.78c.97-.71 2.15-1.22 3.46-1.22.39 0 .78.05 1.15.14L21 11H3l2.35 6.14c.37-.09.76-.14 1.15-.14 1.31 0 2.49.51 3.46 1.22z"/><polygon points="6,9 18,9 15,3 9,3" fill="${color}"/></svg>`;
    const svgSub = `<svg viewBox="0 0 24 24" fill="${color}" xmlns="http://www.w3.org/2000/svg"><ellipse cx="12" cy="14" rx="10" ry="5" fill="${color}" opacity="0.7"/><rect x="10" y="7" width="4" height="7" rx="1" fill="${color}"/><line x1="12" y1="3" x2="12" y2="7" stroke="${color}" stroke-width="1.5"/><circle cx="12" cy="3" r="1" fill="${color}"/></svg>`;

    switch (type) {
      case 'tanker': return svgShip;
      case 'cargo': case 'container': return svgShip;
      case 'lng': return svgShip;
      case 'supply': return svgSpeedboat;
      case 'military_us': return svgMilitary;
      case 'military_il': return svgMilitary;
      case 'military_nato': return svgMilitary;
      case 'military_hostile': return svgSpeedboat;
      case 'threat': return svgThreat;
      default: return svgShip;
    }
  }, []);

  // ── Create divIcon for maritime vessels with SVG ──
  const createMaritimeIcon = useCallback((vessel: { type: string; heading: number; name: string }, vColor: string, vIcon: string, isThreat: boolean) => {
    const size = isThreat ? 18 : 14;
    const glow = isThreat ? 6 : 2;
    const pulse = isThreat ? 'animation:maritime-pulse 1.5s ease-in-out infinite;' : '';
    const svg = getVesselSVG(vessel.type, vColor);
    const isSub = vessel.type === 'military_il' && vessel.name.includes('DOLPHIN');
    const actualSvg = isSub ? getVesselSVG('supply', vColor).replace('supply', 'sub') : svg;
    return L.divIcon({
      className: '',
      html: `<div style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;transform:rotate(${vessel.heading}deg);filter:drop-shadow(0 0 ${glow}px ${vColor});cursor:pointer;opacity:0.85;${pulse}">${actualSvg}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }, [getVesselSVG]);

  // ── Gas platform proximity alert ──
  const GAS_PLATFORMS = useMemo(() => [
    { name: 'לווייתן', lat: 32.60, lon: 34.10 },
    { name: 'תמר', lat: 32.45, lon: 34.25 },
    { name: 'כריש', lat: 32.55, lon: 34.05 },
  ], []);

  const [gasProximityAlerts, setGasProximityAlerts] = useState<{ vesselName: string; platformName: string; distKm: number; time: string }[]>([]);
  const prevGasAlertIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!showMaritime) return;
    const threats = maritimeVessels.filter(v => v.type === 'threat' || v.type === 'military_hostile');
    const ALERT_RADIUS_KM = 50;
    const newAlerts: typeof gasProximityAlerts = [];
    const newIds = new Set<string>();

    for (const vessel of threats) {
      for (const platform of GAS_PLATFORMS) {
        const dLat = (vessel.lat - platform.lat) * 111;
        const dLon = (vessel.lon - platform.lon) * 111 * Math.cos(platform.lat * Math.PI / 180);
        const distKm = Math.sqrt(dLat * dLat + dLon * dLon);
        if (distKm < ALERT_RADIUS_KM) {
          const alertId = `${vessel.id}-${platform.name}`;
          newIds.add(alertId);
          if (!prevGasAlertIdsRef.current.has(alertId)) {
            newAlerts.push({
              vesselName: vessel.name,
              platformName: platform.name,
              distKm: Math.round(distKm * 10) / 10,
              time: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
            });
          }
        }
      }
    }

    if (newAlerts.length > 0) {
      setGasProximityAlerts(prev => [...newAlerts, ...prev].slice(0, 10));
    }
    prevGasAlertIdsRef.current = newIds;
  }, [maritimeVessels, showMaritime, GAS_PLATFORMS]);

  // ── Mine Danger Zones & Naval Activity Areas ──
  const maritimeZones = useMemo(() => [
    // Mine danger zones
    { id: 'mine-hormuz', type: 'mine' as const, name: '⚠️ אזור מוקשים — מצר הורמוז', nameEn: 'Mine Danger — Strait of Hormuz', color: '#ff1744', positions: [[26.40, 55.90], [26.70, 56.00], [26.80, 56.40], [26.55, 56.55], [26.30, 56.20]] as [number, number][], info: 'מוקשים ימיים איראניים — סיכון גבוה לספינות מסחריות' },
    { id: 'mine-bab', type: 'mine' as const, name: '⚠️ אזור מוקשים — באב אל-מנדב', nameEn: 'Mine Danger — Bab el-Mandeb', color: '#ff6d00', positions: [[12.40, 43.10], [12.70, 43.40], [12.85, 43.25], [12.60, 42.95]] as [number, number][], info: 'מוקשים חות\'ים — איום על נתיב הספנות העולמי' },
    { id: 'mine-redsea', type: 'mine' as const, name: '⚠️ שדה מוקשים — ים סוף צפוני', nameEn: 'Mine Field — N. Red Sea', color: '#ff9100', positions: [[15.50, 41.80], [15.80, 42.20], [15.95, 42.00], [15.65, 41.65]] as [number, number][], info: 'מוקשים צפים שזוהו ע"י UKMTO — סכנה לשיט' },
    // 6th Fleet / NATO activity zones
    { id: 'nato-eastmed', type: 'nato' as const, name: '🛡️ אזור פעילות הצי ה-6 (CTF)', nameEn: '6th Fleet — E. Mediterranean', color: '#1e88e5', positions: [[33.50, 28.00], [35.50, 28.00], [35.50, 32.50], [33.50, 32.50]] as [number, number][], info: 'Task Force 60/64 — סיור, הגנת אוויר, ותמיכה' },
    { id: 'nato-snmg2', type: 'nato' as const, name: '🛡️ NATO SNMG2 — אגאי / מזרח הים התיכון', nameEn: 'NATO SNMG2 Patrol', color: '#5c6bc0', positions: [[34.00, 26.00], [36.00, 26.00], [36.00, 30.00], [34.00, 30.00]] as [number, number][], info: 'Standing NATO Maritime Group 2 — סיור שוטף' },
    { id: 'us-5thfleet', type: 'nato' as const, name: '⚓ הצי ה-5 — מפרץ פרסי', nameEn: '5th Fleet — Persian Gulf', color: '#0288d1', positions: [[24.50, 55.50], [27.00, 55.50], [27.00, 58.00], [24.50, 58.00]] as [number, number][], info: 'CTF 150/152/153 — מבצעי שיטור ימי ולחימה בסמים' },
    // Israeli naval exclusion zone
    { id: 'il-gas-exclusion', type: 'exclusion' as const, name: '🔒 אזור הגנה — אסדות גז', nameEn: 'Gas Platform Defense Zone', color: '#66bb6a', positions: [[32.30, 33.80], [32.80, 33.80], [32.80, 34.50], [32.30, 34.50]] as [number, number][], info: 'אזור אסור לכניסה — הגנת חיל הים על אסדות לווייתן ותמר' },
  ], []);
  const [showPolygons, setShowPolygons] = usePersistedState('map.showPolygons', true);
  const [showShelters, setShowShelters] = usePersistedState('map.showShelters', false);
  const [credibilityFilter, setCredibilityFilter] = usePersistedState<'all' | 'single_source' | 'verified'>('map.credibilityFilter', 'all');
  const [showTelegramLayer, setShowTelegramLayer] = usePersistedState('map.showTelegramLayer', false);
  const [showGlobe, setShowGlobe] = usePersistedState('map.showGlobe', false);
  const [showLayerMenu, setShowLayerMenu] = useState(false);
  const [liveAircraft, setLiveAircraft] = useState<any[]>([]);
  const [liveAircraftLoading, setLiveAircraftLoading] = useState(false);
  const [selectedAircraftPopup, setSelectedAircraftPopup] = useState<any | null>(null);
  const [selectedVehicle, setSelectedVehicle] = useState<{
    vehicleIcon: string; vehicleLabel: string; vehicleColor: string;
    stationLabel: string; etaStr: string; arrived: boolean; treatmentTimeMins: number;
    evt: { title: string; description?: string | null; location?: string | null; score: number; source: string; event_time?: string | null };
    vLat: number; vLon: number; driveProgress: number;
  } | null>(null);
  const panelAutoOpenedRef = useRef(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const lastActivityRef = useRef(Date.now());
  const [shockwavePoints, setShockwavePoints] = useState<ShockwavePoint[]>([]);
  const prevAlertIdsRef = useRef<Set<string>>(new Set());
  const [showInfiltration, setShowInfiltration] = usePersistedState('map.showInfiltration', false);
  const [showSatellite, setShowSatellite] = usePersistedState('map.showSatellite', false);
  const [showDataCenters, setShowDataCenters] = usePersistedState('map.showDataCenters', false);
  const [showGroundStations, setShowGroundStations] = usePersistedState('map.showGroundStations', false);
  const [showSatLinks, setShowSatLinks] = usePersistedState('map.showSatLinks', false);
  const [showSubCables, setShowSubCables] = usePersistedState('map.showSubCables', false);
  const [showBackbone, setShowBackbone] = usePersistedState('map.showBackbone', false);
  const [showDataFlow, setShowDataFlow] = usePersistedState('map.showDataFlow', false);
  const [showCellTowers, setShowCellTowers] = usePersistedState('map.showCellTowers', false);
  const [showCellCompare, setShowCellCompare] = usePersistedState('map.showCellCompare', false);
  const [showTransitNodes, setShowTransitNodes] = usePersistedState('map.showTransitNodes', false);
  const [showInfraStatus, setShowInfraStatus] = usePersistedState('map.showInfraStatus', false);
  const [showWeatherPanel, setShowWeatherPanel] = usePersistedState('map.showWeatherPanel', false);
  const [showEmergencyMonitor, setShowEmergencyMonitor] = usePersistedState('map.showEmergencyMonitor', false);
  const [selectedGlobalZones, setSelectedGlobalZones] = usePersistedState<string[]>('map.selectedGlobalZones', []);
  const showGlobalZonesLayer = selectedGlobalZones.length > 0;
  const toggleGlobalZone = useCallback((id: string) => {
    setSelectedGlobalZones(prev => prev.includes(id) ? prev.filter(z => z !== id) : [...prev, id]);
  }, [setSelectedGlobalZones]);
  const { data: cloudStatus, loading: cloudLoading } = useCloudStatus(showInfraStatus || showDataFlow, 120_000);
  const { data: transitStatus, loading: transitLoading } = useTransitStatus(showInfraStatus || showTransitNodes, 120_000);
  const { data: cellStatus } = useCellTowerStatus(showCellTowers || showInfraStatus, 60_000);
  const [showTransitPanel, setShowTransitPanel] = useState(false);
  const [showIranThreatRadius, setShowIranThreatRadius] = useState(false);
  const [iranBannerDismissed, setIranBannerDismissed] = useState(false);
  const iranBannerTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iranBannerKeyRef = useRef<string | null>(null);
  const [satelliteHotspots, setSatelliteHotspots] = useState<any[]>([]);
  const [satelliteEarthquakes, setSatelliteEarthquakes] = useState<any[]>([]);
  const [satelliteEonet, setSatelliteEonet] = useState<any[]>([]);
  const [lastSatelliteCheckAt, setLastSatelliteCheckAt] = useState<number | null>(null);
  const [satAlert, setSatAlert] = useState<{ region: string; type: string; count: number; details: string; latestEvidenceAt: number | null } | null>(null);
  const satAlertTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSatSignatureRef = useRef<string>('');
  
  // ── Telegram toast notification ──
  const [tgToast, setTgToast] = useState<{ text: string; severity: string; time: string } | null>(null);
  const tgToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevTgCountRef = useRef<number>(telegram.messages.length);


  // ── System Health Check state ──
  const [healthData, setHealthData] = useState<any>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [lastHealthCheck, setLastHealthCheck] = useState<string | null>(null);
  
  const runHealthCheck = useCallback(async () => {
    setHealthLoading(true);
    try {
      const { data } = await supabase.functions.invoke('system-health-check');
      if (data) {
        setHealthData(data);
        setLastHealthCheck(new Date().toLocaleString('he-IL'));
      }
    } catch (e) {
      console.error('Health check failed:', e);
    } finally {
      setHealthLoading(false);
    }
  }, []);
  
  // Auto-run health check on mount + every 6 hours
  useEffect(() => {
    runHealthCheck();
    const interval = setInterval(runHealthCheck, 6 * 3600000);
    return () => clearInterval(interval);
  }, [runHealthCheck]);

  // ── Telegram toast: show when new emergency message arrives ──
  useEffect(() => {
    const msgs = telegram.messages;
    if (msgs.length > prevTgCountRef.current && prevTgCountRef.current > 0) {
      const newest = msgs[0];
      if (newest && (newest.severity === 'critical' || newest.severity === 'high' || newest.severity === 'warning')) {
        setTgToast({
          text: (newest.text || '').slice(0, 100),
          severity: newest.severity || 'warning',
          time: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        });
        if (tgToastTimerRef.current) clearTimeout(tgToastTimerRef.current);
        tgToastTimerRef.current = setTimeout(() => setTgToast(null), 8000);
      }
    }
    prevTgCountRef.current = msgs.length;
  }, [telegram.messages]);

  // ── DEMO MODE: Iran missile launch scenario for presentations ──

  const [demoLaunchActive, setDemoLaunchActive] = useState(false);
  const demoLaunchStartRef = useRef<number>(0);
  const startDemoLaunch = useCallback(() => {
    demoLaunchStartRef.current = Date.now();
    setDemoLaunchActive(true);
    // Inject demo satellite data for Iran anomaly
    const demoIranHotspots = Array.from({ length: 18 }, (_, i) => ({
      latitude: 32.4 + (Math.sin(i * 2.5) * 0.8), longitude: 51.5 + (Math.cos(i * 1.7) * 1.2),
      region: 'איראן — אספהאן', intensity: i < 5 ? 'extreme' : i < 10 ? 'high' : 'nominal',
      frp: 80 + i * 15, acq_time: new Date(Date.now() - (30 - i) * 60000).toISOString(),
    }));
    setSatelliteHotspots(prev => [...prev, ...demoIranHotspots]);
    setSatelliteEarthquakes(prev => [...prev,
      { region: 'איראן', magnitude: 3.2, possible_explosion: true, latitude: 32.65, longitude: 51.68 },
      { region: 'איראן', magnitude: 2.8, possible_explosion: true, latitude: 32.60, longitude: 51.72 },
    ]);
    // Auto-stop after 5 minutes
    setTimeout(() => setDemoLaunchActive(false), 5 * 60 * 1000);
    // Zoom out to show Iran → Israel
    setFlyTo({ center: [31.5, 43.0], zoom: 5 });
    // After 4 seconds, zoom to northern sector (Haifa to Kiryat Shmona)
    setTimeout(() => {
      setFlyTo(null);
      setFlyBounds(null);
      setTimeout(() => setFlyBounds([[32.65, 34.85], [33.35, 35.70]]), 50);
      setZoomLevel('regional');
    }, 4000);
  }, []);
  const stopDemoLaunch = useCallback(() => {
    setDemoLaunchActive(false);
  }, []);

  // ── Initial zoom sequence: center → north after 10s ──
  const initialSequenceDoneRef = useRef(false);
  useEffect(() => {
    if (initialSequenceDoneRef.current) return;
    initialSequenceDoneRef.current = true;
    // Start with center of Israel (Gush Dan / Sharon area)
    setFlyTo({ center: [32.07, 34.78], zoom: 11 });
    // After 10s, check for active alerts; if none, zoom to north
    const timer = setTimeout(() => {
      const hasActive = activeAlertPointsRef.current.length > 0;
      if (hasActive) {
        // Zoom to active alert area
        const pts = activeAlertPointsRef.current;
        const avgLat = pts.reduce((s, p) => s + p[0], 0) / pts.length;
        const avgLon = pts.reduce((s, p) => s + p[1], 0) / pts.length;
        setFlyTo({ center: [avgLat, avgLon], zoom: 11 });
      } else {
        // No active alerts — zoom to northern border
        setFlyTo({ center: [33.05, 35.3], zoom: 10 });
      }
      setZoomLevel('regional');
    }, 10000);
    return () => clearTimeout(timer);
  }, []);

  // ── Animated counter state for interception stats ──
  const [displayedStats, setDisplayedStats] = useState({ launched: 0, intercepted: 0, inFlight: 0 });
  const [interceptFlash, setInterceptFlash] = useState(false);
  const prevInterceptedRef = useRef(0);

  // ── Alert countdown timer (tick) ──
  const [countdownTick, setCountdownTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setCountdownTick(v => v + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const getEmergencyEventService = useCallback((evt: { title?: string | null; description?: string | null; source?: string | null }) => {
    const source = (evt.source || '').toLowerCase();
    const text = `${evt.title || ''} ${evt.description || ''} ${source}`;
    const mdaType = classifyMdaEvent(text);

    const isFire = /שריפ(?:ה|ות)|דליק(?:ה|ות)|כיבוי|לכוד(?:ים|ות)?|עשן|בערה|כבאית|כבאים|fire/i.test(text);
    if (isFire) return 'fire';

    const isPolice = /משטרה|ירי|קטטה|פיגוע|שוד|חשוד|פלילי|דקירה|פריצה|פגע וברח|נעצר|נעצרו|מרדף/i.test(text);
    if (isPolice) return 'police';

    const isTraffic = /תאונת?\s*דרכים|רב-רכבית|רב רכבית|כביש|מחלף|עומס(?:י)?\s*תנועה|פקק|חסימת כביש|התנגש|התהפך/i.test(text);
    if (isTraffic) return 'traffic';

    const hasMedicalDispatch = /מד["״']?א|אמבולנס|אט״ן|נט"ן|ניידת טיפול נמרץ|פראמדיק|חובש(?:ים)?|טיפול רפואי|העניקו טיפול|פונ(?:ה|ו)|פינוי|פינו(?:י)?|לבי.?ח|מיון|החייאה|דום לב|התקף לב|קוצר נשימה|נפגע(?:ים)?|פצוע(?:ים)?|חבלה|חבלות|דימום|חרדה|יולדת|לידה|חסר הכרה|איבד הכרה/i.test(text);
    const hasHospitalName = /איכילוב|שיבא|בלינסון|הדסה|רמב"ם|סורוקה|זיו|ברזילי|העמק|פוריה|נהריה/i.test(text);
    const hasActionableMdaCategory = Boolean(mdaType && ['medical', 'trauma', 'obgyn', 'maritime', 'aviation', 'collapse', 'hazmat', 'crowd', 'units'].includes(mdaType.category));

    if (source.includes('mda') || hasMedicalDispatch || hasHospitalName || hasActionableMdaCategory) {
      return 'mda';
    }

    return 'other';
  }, []);

  const [shipPositions, setShipPositions] = useState<Record<string, { lat: number; lon: number; bearing: number; progress: number }>>({});

  useEffect(() => {
    const initial: typeof shipPositions = {};
    PATROL_SHIPS.forEach((ship, i) => {
      initial[ship.id] = { ...interpolateRoute(ship.route, i * 0.2), progress: i * 0.2 };
    });
    setShipPositions(initial);

    const interval = setInterval(() => {
      setShipPositions(prev => {
        const next = { ...prev };
        PATROL_SHIPS.forEach(ship => {
          const old = next[ship.id];
          if (!old) return;
          let newProgress = old.progress + ship.speed;
          if (newProgress >= 1) newProgress -= 1;
          next[ship.id] = { ...interpolateRoute(ship.route, newProgress), progress: newProgress };
        });
        return next;
      });
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // ── Aircraft positions animation ──
  const [aircraftPositions, setAircraftPositions] = useState<Record<string, { lat: number; lon: number; bearing: number; progress: number }>>({});

  useEffect(() => {
    const initial: typeof aircraftPositions = {};
    AIRCRAFT_ROUTES.forEach((ac, i) => {
      initial[ac.id] = { ...interpolateRoute(ac.route, (i * 0.15) % 1), progress: (i * 0.15) % 1 };
    });
    setAircraftPositions(initial);

    const interval = setInterval(() => {
      setAircraftPositions(prev => {
        const next = { ...prev };
        AIRCRAFT_ROUTES.forEach(ac => {
          const old = next[ac.id];
          if (!old) return;
          let newProgress = old.progress + ac.speed;
          if (newProgress >= 1) newProgress -= 1;
          next[ac.id] = { ...interpolateRoute(ac.route, newProgress), progress: newProgress };
        });
        return next;
      });
    }, 800);
    return () => clearInterval(interval);
  }, []);

  // ── OpenSky Network live aircraft fetch ──
  useEffect(() => {
    const fetchOpenSky = async () => {
      try {
        setLiveAircraftLoading(true);
        // Tight Israel-only bbox: only flights to/from Israel airspace
        const { data, error } = await supabase.functions.invoke('opensky-flights', {
          body: { lamin: 29.4, lomin: 34.2, lamax: 33.4, lomax: 35.9 },
        });
        if (error) { console.warn('OpenSky fetch error:', error); return; }
        if (data?.aircraft) {
          // Cap at 60 aircraft to prevent map slowdown
          const capped = (data.aircraft as any[]).slice(0, 60);
          setLiveAircraft(capped);
          console.log(`OpenSky: ${capped.length} aircraft loaded (Israel bbox)`);
        }
      } catch (e) {
        console.warn('OpenSky error:', e);
      } finally {
        setLiveAircraftLoading(false);
      }
    };
    fetchOpenSky();
    const interval = setInterval(fetchOpenSky, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, []);

  const [missileProgress, setMissileProgress] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setMissileProgress(prev => (prev + 0.002) % 1);
    }, 80);
    return () => clearInterval(interval);
  }, []);

  // Fullscreen toggle
  const containerRef = useRef<HTMLDivElement>(null);
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // ── AI situation analysis — LIVE ──
  const fetchSituationSummary = useCallback(async () => {
    setSummaryLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('situation-analysis');
      if (error) throw error;
      if (data?.assessment) {
        setAiAssessment(data.assessment);
        setSituationSummary(data.assessment.summary || null);
        setSummaryTime(new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }));
      }
    } catch (e) {
      console.error('[situation-analysis] error:', e);
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  // Auto-fetch situation analysis every 5 minutes
  useEffect(() => {
    fetchSituationSummary();
    const interval = setInterval(fetchSituationSummary, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchSituationSummary]);

  // Auto-fullscreen + notifications on first user interaction
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleFirstInteraction = () => {
      containerRef.current?.requestFullscreen?.().catch(() => {});
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
    };
    // Fullscreen/notification permission require user gesture — trigger on first click or touch
    document.addEventListener('click', handleFirstInteraction, { once: true });
    document.addEventListener('touchstart', handleFirstInteraction, { once: true });
    return () => {
      document.removeEventListener('click', handleFirstInteraction);
      document.removeEventListener('touchstart', handleFirstInteraction);
    };
  }, []);

  // Live Oref alerts
  const [orefAlerts, setOrefAlerts] = useState<any[]>([]);
  const [liveRegionSeverities, setLiveRegionSeverities] = useState<Record<string, MapRegion['severity']>>({});
  const [intelReports, setIntelReports] = useState<any[]>([]);
  const [emergencyEvents, setEmergencyEvents] = useState<any[]>([]);
  const lastSeenAlertIdRef = useRef<string | null>(null);
  const lastSeenReleaseIdRef = useRef<string | null>(null);
  const [isCompactAlertDevice, setIsCompactAlertDevice] = useState(false);
  const [showMobileEmergencyTakeover, setShowMobileEmergencyTakeover] = useState(false);
  const mobileTakeoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeLockRef = useRef<any>(null);

  const resetMobileEmergencyTakeoverTimer = useCallback(() => {
    if (mobileTakeoverTimerRef.current) clearTimeout(mobileTakeoverTimerRef.current);
    mobileTakeoverTimerRef.current = setTimeout(() => setShowMobileEmergencyTakeover(false), 45000);
  }, []);

  const requestScreenWakeLock = useCallback(async () => {
    if (typeof window === 'undefined' || document.visibilityState !== 'visible' || !(navigator as any)?.wakeLock) return;

    try {
      if (wakeLockRef.current) return;
      wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
      wakeLockRef.current?.addEventListener?.('release', () => {
        wakeLockRef.current = null;
      });
    } catch {}
  }, []);

  const releaseScreenWakeLock = useCallback(async () => {
    try {
      await wakeLockRef.current?.release?.();
    } catch {
    } finally {
      wakeLockRef.current = null;
    }
  }, []);

  const triggerSystemAlert = useCallback((alert: { id: string; title?: string; locations?: string[] }) => {
    if (typeof window === 'undefined') return;

    try {
      navigator.vibrate?.([300, 120, 300, 120, 600]);
    } catch {}

    if ('Notification' in window && Notification.permission === 'granted') {
      const locationText = Array.isArray(alert.locations) ? alert.locations.filter(Boolean).slice(0, 4).join(', ') : '';
      const notificationBody = [alert.title, locationText].filter(Boolean).join(' — ');

      try {
        new Notification('🚨 התרעת חירום חדשה', {
          body: notificationBody.slice(0, 180),
          tag: `oref-${alert.id}`,
          requireInteraction: true,
          dir: 'rtl',
        });
      } catch {}
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateViewportClass = () => {
      const coarsePointer = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
      const isTouchDevice = coarsePointer || navigator.maxTouchPoints > 1;
      setIsCompactAlertDevice(isTouchDevice || window.innerWidth <= 1180);
    };

    updateViewportClass();
    window.addEventListener('resize', updateViewportClass);
    window.addEventListener('orientationchange', updateViewportClass);

    return () => {
      window.removeEventListener('resize', updateViewportClass);
      window.removeEventListener('orientationchange', updateViewportClass);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (mobileTakeoverTimerRef.current) clearTimeout(mobileTakeoverTimerRef.current);
      void releaseScreenWakeLock();
    };
  }, [releaseScreenWakeLock]);

  // Zoom level cycling: full → regional → close-up
  const [zoomLevel, setZoomLevel] = useState<'full' | 'regional' | 'close'>('full');
  const lastAlertCenterRef = useRef<[number, number]>([31.4, 34.9]);
  const currentMapCenterRef = useRef<[number, number]>([31.5, 34.9]);
  // Track whether first alert anchor has been set — prevents re-centering on each new alert
  const firstAlertAnchorRef = useRef<[number, number] | null>(null);
  const alertSessionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset zoom to see all of Israel
  const resetZoomToIsrael = useCallback(() => {
    setTheaterView(false);
    setShowIranThreatRadius(false);
    setFlyBounds(null);
    setFlyTo({ center: [31.5, 34.9], zoom: 8 });
    setSelectedRegion(null);
    setZoomLevel('full');
  }, []);

  // Ref to hold active alert points (updated after scenarioRegions is computed)
  const activeAlertPointsRef = useRef<[number, number][]>([]);

  // Focus on all recent alert locations, then zoom out 30%
  const focusOnAlerts = useCallback(() => {
    const activePoints = activeAlertPointsRef.current;
    if (activePoints.length === 0) {
      resetZoomToIsrael();
      return;
    }
    const lats = activePoints.map(p => p[0]);
    const lons = activePoints.map(p => p[1]);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLon = Math.min(...lons);
    const maxLon = Math.max(...lons);
    // 30% padding for zoom-out effect
    const latPad = (maxLat - minLat) * 0.15 || 0.05;
    const lonPad = (maxLon - minLon) * 0.15 || 0.05;
    const bounds: L.LatLngBoundsExpression = [
      [minLat - latPad, minLon - lonPad],
      [maxLat + latPad, maxLon + lonPad],
    ];
    setFlyTo(null);
    setFlyBounds(bounds);
    setZoomLevel('regional');
  }, [resetZoomToIsrael]);

  // Zoom to regional view of alert area
  const zoomToRegional = useCallback(() => {
    focusOnAlerts();
  }, [focusOnAlerts]);

  // 🎯 button: Jump to active attack area — fits bounds of all active alerts with padding
  const zoomInOnCurrentArea = useCallback(() => {
    const alertPts = activeAlertPointsRef.current;
    if (alertPts.length > 0) {
      // Compute bounding box of all active alert points
      let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
      for (const [lat, lon] of alertPts) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
      }
      // Add ~15% padding so edges aren't clipped
      const latPad = Math.max((maxLat - minLat) * 0.15, 0.05);
      const lonPad = Math.max((maxLon - minLon) * 0.15, 0.05);
      setFlyTo(null);
      setFlyBounds(null);
      setTimeout(() => {
        setFlyBounds([[minLat - latPad, minLon - lonPad], [maxLat + latPad, maxLon + lonPad]]);
      }, 50);
      setZoomLevel('regional');
    } else {
      // No alerts — just zoom in on current area
      const center = currentMapCenterRef.current;
      const nextZoom = Math.min(mapZoom + 2, 12);
      setFlyBounds(null);
      setFlyTo(null);
      setTimeout(() => setFlyTo({ center, zoom: nextZoom }), 50);
      setZoomLevel(nextZoom >= 12 ? 'close' : 'regional');
    }
  }, [mapZoom]);

  // ── Zone patrol: cycle through 5 regions ──
  const ZONE_PATROL = useMemo(() => [
    { label: 'נצרת–קר. שמונה', emoji: '🏔️', bounds: [[32.6, 35.0], [33.4, 35.65]] as [[number,number],[number,number]] },
    { label: 'נצרת–ראשל"צ', emoji: '🏙️', bounds: [[31.9, 34.5], [32.75, 35.4]] as [[number,number],[number,number]] },
    { label: 'אשדוד–ים המלח', emoji: '🏘️', bounds: [[31.0, 34.3], [31.9, 35.55]] as [[number,number],[number,number]] },
    { label: 'באר שבע–אילת', emoji: '🏜️', bounds: [[29.4, 34.2], [31.3, 35.3]] as [[number,number],[number,number]] },
    { label: 'מרכז ישראל', emoji: '🇮🇱', bounds: [[31.2, 34.4], [32.9, 35.5]] as [[number,number],[number,number]] },
  ], []);
  const [zonePatrolIdx, setZonePatrolIdx] = useState(-1);

  const cycleZonePatrol = useCallback(() => {
    const nextIdx = zonePatrolIdx + 1;
    if (nextIdx >= ZONE_PATROL.length) {
      setZonePatrolIdx(-1);
      zoomInOnCurrentArea();
    } else {
      setZonePatrolIdx(nextIdx);
      const zone = ZONE_PATROL[nextIdx];
      setFlyTo(null);
      setFlyBounds(null);
      setTimeout(() => setFlyBounds(zone.bounds), 50);
    }
  }, [zonePatrolIdx, ZONE_PATROL, zoomInOnCurrentArea]);

  // ── Full theater view: Israel + Iran + Yemen ──
  const [theaterView, setTheaterView] = useState(false);
  const showFullTheater = useCallback(() => {
    if (theaterView) {
      resetZoomToIsrael();
      return;
    }

    setTheaterView(true);
    setFlyBounds(null);
    setFlyTo(null);
    setTimeout(() => {
      setFlyBounds(FULL_THEATER_BOUNDS);
      setZoomLevel('full');
      setSelectedRegion(null);
    }, 50);
  }, [theaterView, resetZoomToIsrael]);


  const zoomToCloseUp = useCallback(() => {
    const center = lastAlertCenterRef.current;
    setFlyBounds(null);
    setFlyTo({ center, zoom: 12 });
    setZoomLevel('close');
  }, []);

  // Track activity — reset timer on any alert change
  useEffect(() => {
    lastActivityRef.current = Date.now();
  }, [war.alerts, war.filteredAlerts.length, demoScenario, dataMode]);

  // Auto-reset to initial state after 5 minutes of inactivity
  useEffect(() => {
    const checkIdle = setInterval(() => {
      const idleMs = Date.now() - lastActivityRef.current;
      if (idleMs >= 300000) {
        setFlyTo({ center: [31.5, 34.9], zoom: 8 });
        setLeftOpen(false);
        setRightOpen(false);
        setSelectedRegion(null);
        setZoomLevel('full');
        lastActivityRef.current = Date.now();
      }
    }, 30000);
    return () => clearInterval(checkIdle);
  }, []);

  // Cycle through zoom levels
  const cycleZoom = useCallback(() => {
    if (zoomLevel === 'full') {
      zoomToRegional();
    } else if (zoomLevel === 'regional') {
      zoomToCloseUp();
    } else {
      resetZoomToIsrael();
    }
  }, [zoomLevel, zoomToRegional, zoomToCloseUp, resetZoomToIsrael]);

  // GPS
  const [userGPS, setUserGPS] = useState<{ lat: number; lon: number } | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Start GPS tracking — auto-dismiss error after 3 seconds
  useEffect(() => {
    if (!navigator.geolocation) { setGpsError('GPS לא נתמך'); return; }
    const watchId = navigator.geolocation.watchPosition(
      (pos) => { setUserGPS({ lat: pos.coords.latitude, lon: pos.coords.longitude }); setGpsError(null); },
      (err) => {
        setGpsError(err.message);
        // Auto-dismiss GPS error after 3 seconds
        setTimeout(() => setGpsError(null), 3000);
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // ── UAV Watch — OpenSky + simulated local drones around user GPS ──
  const uavCenter = useMemo(
    () => (userGPS ? { lat: userGPS.lat, lon: userGPS.lon } : { lat: 32.08, lon: 34.78 }),
    [userGPS]
  );
  const { tracks: uavTracks, lastUpdate: uavLastUpdate } = useUavWatch({
    enabled: showUav,
    center: uavCenter,
    radiusKm: uavRadiusKm,
    simulateLocal: true,
    refreshMs: 30000,
  });

  // ── Flights Board (TLV/HFA/ETM via OpenSky) ──
  const { airports: flightAirports, lastUpdate: flightsLastUpdate } = useFlightsBoard(showFlightsBoard, 60000);

  // ── Global Events (GDACS + USGS) ──
  const { events: globalEvents, lastUpdate: globalLastUpdate } = useGlobalEvents(showGlobalEvents, 120000);
  const filteredGlobalEvents = useMemo(() => {
    if (globalSeverityFilter === 'all') return globalEvents;
    return globalEvents.filter((e) => e.severity === globalSeverityFilter);
  }, [globalEvents, globalSeverityFilter]);

  // ── Translation cache for intel texts (titles + summaries) ──
  const [translatedTitles, setTranslatedTitles] = useState<Map<string, string>>(new Map());
  const translationPendingRef = useRef(new Set<string>());

  const translateHeadlines = useCallback(async (texts: string[]) => {
    const hebrewRegex = /[\u0590-\u05FF]/;
    const toTranslate = texts
      .map(text => (text || '').trim())
      .filter(text => text.length > 0 && !hebrewRegex.test(text) && !translatedTitles.has(text) && !translationPendingRef.current.has(text));
    if (toTranslate.length === 0) return;
    
    toTranslate.forEach(text => translationPendingRef.current.add(text));
    
    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/translate-headlines`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: toTranslate }),
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.translations) {
          setTranslatedTitles(prev => {
            const next = new Map(prev);
            toTranslate.forEach((orig, i) => {
              if (data.translations[i]) next.set(orig, data.translations[i]);
            });
            return next;
          });
        }
      }
    } catch (e) {
      console.warn('Translation failed:', e);
    } finally {
      toTranslate.forEach(text => translationPendingRef.current.delete(text));
    }
  }, [translatedTitles]);

  // Helper: get translated text or original
  const getHebrewTitle = useCallback((title: string) => {
    const normalized = (title || '').trim();
    const hebrewRegex = /[\u0590-\u05FF]/;
    if (!normalized || hebrewRegex.test(normalized)) return normalized;
    return translatedTitles.get(normalized) || normalized;
  }, [translatedTitles]);

  // Fetch Oref alerts for live mode
  useEffect(() => {
    if (dataMode !== 'live') {
      setOrefAlerts([]);
      setLiveRegionSeverities({});
      return;
    }

    let isDisposed = false;

    const applyOrefAlerts = (data: any[]) => {
      if (isDisposed || !data) return;

      setOrefAlerts(data);
      const sevMap: Record<string, MapRegion['severity']> = {};
      const now = Date.now();
      const locLatestRelease = new Map<string, number>();

      const extractCityNames = (locStr: string): string[] => {
        const results: string[] = [locStr];
        for (const r of REGIONS) {
          if (locStr.includes(r.name)) results.push(r.name);
        }
        for (const cityName of Object.keys(CITY_GPS_LOOKUP)) {
          if (locStr.includes(cityName)) results.push(cityName);
        }
        return results;
      };

      for (const alert of data) {
        const alertTime = new Date(alert.alert_date).getTime();
        const title = alert.title || '';
        const desc = alert.description || '';
        const rawThreat = (alert.raw_data as any)?.threat;
        const isRelease = title.includes('שחרור') || desc.includes('שחרור') || title.includes('הותר') || desc.includes('הותר');

        if (!isRelease) continue;

        for (const loc of alert.locations || []) {
          const cities = extractCityNames(loc.trim());
          for (const city of cities) {
            const prev = locLatestRelease.get(city) || 0;
            if (alertTime > prev) locLatestRelease.set(city, alertTime);
          }
        }
      }

      for (const alert of data) {
        const locs: string[] = alert.locations || [];
        const alertTime = new Date(alert.alert_date).getTime();
        const ageMs = now - alertTime;
        const rawThreat = (alert.raw_data as any)?.threat;
        const title = alert.title || '';
        const desc = alert.description || '';
        const isRelease = title.includes('שחרור') || desc.includes('שחרור') || title.includes('הותר') || desc.includes('הותר');

        if (isRelease) continue;

        const sev: MapRegion['severity'] = ageMs < 30000 ? 'early_warning' : ageMs < 120000 ? 'critical' : ageMs < 600000 ? 'high' : ageMs < 1800000 ? 'warning' : 'medium';

        for (const loc of locs) {
          const cities = extractCityNames(loc.trim());
          for (const city of cities) {
            const releaseTime = locLatestRelease.get(city) || 0;
            if (releaseTime > alertTime) continue;

            for (const region of REGIONS) {
              if (city.includes(region.name) || region.name.includes(city)) {
                if (!sevMap[region.id] || severityRank(sev) < severityRank(sevMap[region.id])) {
                  sevMap[region.id] = sev;
                }
              }
            }
          }
        }
      }

      setLiveRegionSeverities(sevMap);
    };

    const fetchOrefAlertsFromDb = async () => {
      const { data } = await supabase
        .from('oref_alerts')
        .select('*')
        .gte('alert_date', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order('alert_date', { ascending: false })
        .limit(200);

      if (data) applyOrefAlerts(data);
    };

    const syncOrefAlerts = async () => {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      try {
        const res = await fetch(`https://${projectId}.supabase.co/functions/v1/oref-alerts`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
        });

        const payload = await res.json().catch(() => null);
        if (Array.isArray(payload?.alerts)) {
          applyOrefAlerts(payload.alerts);
          return;
        }
      } catch {
        // Fallback to cached DB state below
      }

      await fetchOrefAlertsFromDb();
    };

    void fetchOrefAlertsFromDb();
    void syncOrefAlerts();

    const orefInterval = setInterval(() => {
      void syncOrefAlerts();
    }, 4000);

    // Intel + News flash
    const fetchIntel = async () => {
      const { data } = await supabase
        .from('intel_reports')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (data && !isDisposed) setIntelReports(data);
    };
    void fetchIntel();
    // Also trigger news-flash edge function periodically
    const triggerNewsFlash = async () => {
      try {
        const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        await fetch(`https://${projectId}.supabase.co/functions/v1/news-flash`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(12000),
        }).catch(() => {});
        // Refresh intel after news flash
        setTimeout(fetchIntel, 3000);
      } catch {}
    };
    const triggerTelegramPublicScrape = async () => {
      try {
        const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        await fetch(`https://${projectId}.supabase.co/functions/v1/telegram-public-scrape`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(12000),
        }).catch(() => {});
        setTimeout(fetchIntel, 3000);
      } catch {}
    };
    void triggerNewsFlash();
    void triggerTelegramPublicScrape();
    const intelInterval = setInterval(fetchIntel, 30000);
    const newsFlashInterval = setInterval(triggerNewsFlash, 120000); // every 2 min
    const telegramPublicInterval = setInterval(triggerTelegramPublicScrape, 180000); // every 3 min

    // Emergency events — fetch from DB + trigger edge function to pull fresh data
    const fetchEmergencyEvents = async () => {
      const { data } = await supabase
        .from('emergency_events')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (data && !isDisposed) setEmergencyEvents(data);
    };
    const triggerEmergencyFeed = async () => {
      try { await supabase.functions.invoke('emergency-feed'); } catch {}
      setTimeout(fetchEmergencyEvents, 2000);
    };
    const triggerXFeed = async () => {
      try { await supabase.functions.invoke('x-feed-scrape'); } catch {}
    };
    void fetchEmergencyEvents();
    void triggerEmergencyFeed(); // Pull fresh data on mount
    void triggerXFeed(); // Pull X/Twitter feed on mount
    const eeInterval = setInterval(fetchEmergencyEvents, 30000);
    const eeFeedInterval = setInterval(triggerEmergencyFeed, 300000);
    const xFeedInterval = setInterval(triggerXFeed, 600000);

    // ── Auto-trigger intel-gather & sentiment-analysis so all sources flow in ──
    const triggerIntelGather = async () => {
      try { await supabase.functions.invoke('intel-gather'); } catch {}
      setTimeout(fetchIntel, 3000);
    };
    const triggerSentiment = async () => {
      try { await supabase.functions.invoke('sentiment-analysis'); } catch {}
    };
    void triggerIntelGather();
    void triggerSentiment();
    const intelGatherInterval = setInterval(triggerIntelGather, 180000); // every 3 min
    const sentimentInterval = setInterval(triggerSentiment, 300000); // every 5 min

    // ── Satellite data: NASA FIRMS, USGS Earthquakes, NASA EONET ──
    const fetchSatelliteData = async () => {
      try {
        const [firmsRes, usgsRes, eonetRes] = await Promise.all([
          supabase.functions.invoke('nasa-firms').catch(() => ({ data: null })),
          supabase.functions.invoke('usgs-earthquakes').catch(() => ({ data: null })),
          supabase.functions.invoke('nasa-eonet').catch(() => ({ data: null })),
        ]);
        if (!isDisposed) {
          const hotspots = firmsRes.data?.hotspots?.filter((h: any) => h.intensity !== 'low').slice(0, 200) || [];
          const quakes = usgsRes.data?.earthquakes || [];
          const events = eonetRes.data?.events || [];
          if (hotspots.length) setSatelliteHotspots(hotspots);
          if (quakes.length) setSatelliteEarthquakes(quakes);
          if (events.length) setSatelliteEonet(events);
          setLastSatelliteCheckAt(Date.now());

          // ── Anomaly detection for Iran & Yemen ──
          // Quality filter: only count hotspots that indicate possible military activity
          // - FRP > 50 = very high energy (potential launch/explosion)
          // - "extreme" intensity = FRP>100 or brightness>400
          // - Nighttime high-FRP clusters near known sites are more suspicious
          const assessRegion = (regionName: string) => {
            const rHots = hotspots.filter((h: any) => (h.region || '').includes(regionName));
            // Tier 1: Extreme hotspots (FRP>100) — very likely military/industrial explosion
            const extremeHots = rHots.filter((h: any) => h.intensity === 'extreme');
            // Tier 2: High FRP (>50) with high/nominal confidence
            const highFrpHots = rHots.filter((h: any) => h.frp > 50 && h.confidence !== 'low');
            // Tier 3: Nighttime clusters with FRP>20 (more suspicious than daytime agriculture)
            const nightHighHots = rHots.filter((h: any) => h.daynight === 'N' && h.frp > 20 && h.confidence !== 'low');
            // Check for spatial clustering (3+ hotspots within 0.3° = ~30km)
            let hasCluster = false;
            for (const h of nightHighHots) {
              const nearby = nightHighHots.filter((h2: any) =>
                Math.abs(h2.latitude - h.latitude) < 0.3 && Math.abs(h2.longitude - h.longitude) < 0.3
              );
              if (nearby.length >= 3) { hasCluster = true; break; }
            }
            // Earthquake with possible_explosion flag
            const rQuakes = quakes.filter((q: any) => (q.region || '').includes(regionName) && q.possible_explosion);
            
            // Decision: only alert if strong evidence
            const isConfirmed = extremeHots.length >= 1 || highFrpHots.length >= 2 || rQuakes.length >= 1;
            const isMonitoring = hasCluster || highFrpHots.length >= 1 || nightHighHots.length >= 3;
            
            return { extremeHots, highFrpHots, nightHighHots, rQuakes, isConfirmed, isMonitoring, total: rHots.length };
          };
          
          const iranData = assessRegion('איראן');
          const yemenData = assessRegion('תימן');
          
          const sig = `iran:${iranData.isConfirmed}:${iranData.isMonitoring}:${iranData.extremeHots.length}|yemen:${yemenData.isConfirmed}:${yemenData.isMonitoring}`;
          if (sig !== prevSatSignatureRef.current) {
            prevSatSignatureRef.current = sig;
            const buildAlert = (data: ReturnType<typeof assessRegion>, region: string) => {
              if (data.isConfirmed) {
                return {
                  region,
                  type: data.rQuakes.length > 0 ? 'זוהה פיצוץ/רעידה חשודה' : 'ריכוז חום חריג — חשד לשיגור',
                  count: data.extremeHots.length + data.highFrpHots.length + data.rQuakes.length,
                  latestEvidenceAt: null as number | null,
                  details: `🔥 ${data.extremeHots.length} extreme + ${data.highFrpHots.length} high-FRP${data.rQuakes.length > 0 ? ` | 💥 ${data.rQuakes.length} פיצוצים` : ''} | סה״כ ${data.total} נקודות`,
                };
              }
              return null; // Don't show dramatic alert for monitoring-only
            };
            
            const iranAlert = buildAlert(iranData, 'איראן');
            const yemenAlert = buildAlert(yemenData, 'תימן');
            const newSatAlert = iranAlert || yemenAlert;
            setSatAlert(newSatAlert);
            // Auto-dismiss satellite banner after 3 minutes
            if (newSatAlert) {
              setTimeout(() => setSatAlert(null), 180000);
            }
            
            // Log monitoring-level for debugging
            if (!iranAlert && iranData.isMonitoring) {
              console.log(`[SAT-MONITOR] איראן: ${iranData.total} hotspots, ${iranData.nightHighHots.length} night-high — monitoring only`);
            }
            if (!yemenAlert && yemenData.isMonitoring) {
              console.log(`[SAT-MONITOR] תימן: ${yemenData.total} hotspots, ${yemenData.nightHighHots.length} night-high — monitoring only`);
            }
          }
        }
      } catch (e) { console.warn('Satellite fetch error:', e); }
    };
    void fetchSatelliteData();
    const satInterval = setInterval(fetchSatelliteData, 60000); // every 1 min

    // Realtime
    const channel = supabase
      .channel('oref-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'oref_alerts' }, () => {
        void fetchOrefAlertsFromDb();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'intel_reports' }, () => {
        void fetchIntel();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'emergency_events' }, () => {
        void fetchEmergencyEvents();
      })
      .subscribe();

    return () => {
      isDisposed = true;
      clearInterval(orefInterval);
      clearInterval(intelInterval);
      clearInterval(newsFlashInterval);
      clearInterval(telegramPublicInterval);
      clearInterval(eeInterval);
      clearInterval(eeFeedInterval);
      clearInterval(xFeedInterval);
      clearInterval(intelGatherInterval);
      clearInterval(sentimentInterval);
      clearInterval(satInterval);
      supabase.removeChannel(channel);
    };
  }, [dataMode]);

  // ── AI Situation Analysis Engine — LIVE ──
  const fetchAiAssessment = useCallback(async () => {
    setAiLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('situation-analysis');
      if (error) throw error;
      if (data?.assessment) {
        setAiAssessment(data.assessment);
        setSituationSummary(data.assessment.summary || null);
        setSummaryTime(new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }));
      }
    } catch (e) {
      console.error('[AI assessment] error:', e);
    } finally {
      setAiLoading(false);
    }
  }, []);

  // ── Simulated Emergency Events: Always-on routine events for realistic feel ──
  // Use a stable reference time so events don't reset every tick
  const demoBaseTimeRef = useRef(Date.now());
  useEffect(() => {
    // Reset base time only when scenario changes, not every tick
    demoBaseTimeRef.current = Date.now();
  }, [demoScenario, dataMode]);

  const demoEmergencyEvents = useMemo(() => {
    const base = demoBaseTimeRef.current;
    // Routine events — always shown (calm, escalation, war, multi_front)
    const routineEvents: any[] = [];
    // Escalation events
    const escalationEvents = demoScenario !== 'calm' ? [
      { id: 'demo-esc-1', title: 'חפץ חשוד — סריקה', description: 'משטרה — פינוי 200 מטר', location: 'תל אביב', lat: 32.08, lon: 34.78, source: 'police', color: 'orange', score: 5, event_time: new Date(base - 240000).toISOString(), created_at: new Date(base - 240000).toISOString() },
      { id: 'demo-esc-2', title: 'פציעה מאבנים — הר הבית', description: 'מד"א — פצוע קל פונה', location: 'ירושלים', lat: 31.78, lon: 35.23, source: 'mda', color: 'orange', score: 5, event_time: new Date(base - 150000).toISOString(), created_at: new Date(base - 150000).toISOString() },
    ] : [];
    // War events
    const warEvents = (demoScenario === 'war' || demoScenario === 'multi_front') ? [
      { id: 'demo-mda-1', title: 'פגיעת רקטה — נפגעים', description: 'מד"א — 3 פצועים בינוניים', location: 'שדרות', lat: 31.52, lon: 34.60, source: 'mda', color: 'red', score: 8, event_time: new Date(base - 180000).toISOString(), created_at: new Date(base - 180000).toISOString() },
      { id: 'demo-fire-1', title: 'שריפה כתוצאה מפגיעה', description: 'כיבוי אש — לכודים בקומה 3', location: 'אשקלון', lat: 31.67, lon: 34.57, source: 'fire', color: 'orange', score: 7, event_time: new Date(base - 120000).toISOString(), created_at: new Date(base - 120000).toISOString() },
      { id: 'demo-mda-2', title: 'נפילת רקטה — פצועים', description: 'מד"א — פונו 5 פצועים לסורוקה', location: 'באר שבע', lat: 31.25, lon: 34.79, source: 'mda', color: 'red', score: 9, event_time: new Date(base - 240000).toISOString(), created_at: new Date(base - 240000).toISOString() },
      { id: 'demo-fire-2', title: 'שריפה במבנה מגורים', description: 'כיבוי — 4 צוותים במקום', location: 'חיפה', lat: 32.79, lon: 34.99, source: 'fire', color: 'orange', score: 6, event_time: new Date(base - 90000).toISOString(), created_at: new Date(base - 90000).toISOString() },
      { id: 'demo-mda-3', title: 'פגיעה ישירה — נפגעים רבים', description: 'מד"א — אירוע רב-נפגעים', location: 'תל אביב', lat: 32.08, lon: 34.78, source: 'mda', color: 'red', score: 10, event_time: new Date(base - 60000).toISOString(), created_at: new Date(base - 60000).toISOString() },
      { id: 'demo-police-1', title: 'חשד לפיגוע ירי', description: 'משטרה — כוחות חוסמים את האזור', location: 'ירושלים', lat: 31.77, lon: 35.21, source: 'police', color: 'red', score: 8, event_time: new Date(base - 150000).toISOString(), created_at: new Date(base - 150000).toISOString() },
      { id: 'demo-mda-4', title: 'פצוע בינוני מרסיסים', description: 'מד"א — פינוי לרמב"ם', location: 'קריית שמונה', lat: 33.21, lon: 35.57, source: 'mda', color: 'red', score: 7, event_time: new Date(base - 200000).toISOString(), created_at: new Date(base - 200000).toISOString() },
    ] : [];
    // Lebanon operation events — IDF strikes + Hezbollah retaliation on northern border
    const lebanonOpEvents = demoScenario === 'lebanon_op' ? [
      { id: 'demo-leb-mda-1', title: 'פגיעת נ"ט — פצוע בינוני', description: 'מד"א — פינוי לרמב"ם', location: 'קריית שמונה', lat: 33.21, lon: 35.57, source: 'mda', color: 'red', score: 7, event_time: new Date(base - 120000).toISOString(), created_at: new Date(base - 120000).toISOString() },
      { id: 'demo-leb-fire-1', title: 'שריפה מרקטה — מטולה', description: 'כיבוי — 2 צוותים', location: 'מטולה', lat: 33.28, lon: 35.58, source: 'fire', color: 'orange', score: 6, event_time: new Date(base - 200000).toISOString(), created_at: new Date(base - 200000).toISOString() },
      { id: 'demo-leb-mda-2', title: 'רסיסים — 2 פצועים קל', description: 'מד"א — טיפול במקום', location: 'נהריה', lat: 33.00, lon: 35.10, source: 'mda', color: 'orange', score: 5, event_time: new Date(base - 350000).toISOString(), created_at: new Date(base - 350000).toISOString() },
      { id: 'demo-leb-mda-3', title: 'חרדה — פינוי מבנים', description: 'מד"א — 8 חולי חרדה', location: 'צפת', lat: 32.97, lon: 35.50, source: 'mda', color: 'yellow', score: 3, event_time: new Date(base - 500000).toISOString(), created_at: new Date(base - 500000).toISOString() },
      { id: 'demo-leb-police-1', title: 'חסימת כביש 90 — פיקוח', description: 'משטרה — סגירת ציר', location: 'קריית שמונה', lat: 33.20, lon: 35.56, source: 'police', color: 'yellow', score: 4, event_time: new Date(base - 180000).toISOString(), created_at: new Date(base - 180000).toISOString() },
    ] : [];
    return [...routineEvents, ...escalationEvents, ...warEvents, ...lebanonOpEvents] as any[];
  }, [dataMode, demoScenario]);

  // Merge real + simulated emergency events
  // In live mode: real events take priority, but keep demo events with coordinates
  // for vehicle display when real events lack geo data
  const mergedEmergencyEvents = useMemo(() => {
    // In live mode: only real events. Demo events only in demo mode.
    const rawEvents = dataMode === 'demo' ? [...demoEmergencyEvents, ...(emergencyEvents || [])] : [...(emergencyEvents || [])];
    const isRenderableEventPoint = (lat?: number | null, lon?: number | null) =>
      typeof lat === 'number' && typeof lon === 'number' && isWithinIsraelRenderBounds(lat, lon);

    // Short city names that cause false geocoding in compound names like "אזור תעשייה"
    const AMBIGUOUS = new Set(['אזור', 'דן', 'לוד', 'ערד', 'גן']);
    const isExactCityMatch = (location: string, city: string) => {
      if (!AMBIGUOUS.has(city)) return true;
      const re = new RegExp(`(?:^|[\\s,:\\-])${city}(?:$|[\\s,:\\-])`);
      return re.test(location);
    };

    return rawEvents
      .map(evt => {
        if (isRenderableEventPoint(evt.lat, evt.lon)) {
          // Check if the stored coords are from a false "אזור" match
          if (evt.location && AMBIGUOUS.has(evt.location) && evt.location !== evt.title?.replace(/^[📰🚨📺]+ /, '').trim()) {
            // Location is exactly "אזור" but title suggests it's a compound — skip bad coords
          } else {
            return evt;
          }
        }
        if (!evt.location) return evt;
        const gps = CITY_GPS_LOOKUP[evt.location];
        if (gps && isRenderableEventPoint(gps.lat, gps.lon) && isExactCityMatch(evt.location, evt.location)) return { ...evt, lat: gps.lat, lon: gps.lon };
        for (const [city, coords] of Object.entries(CITY_GPS_LOOKUP)) {
          if ((evt.location.includes(city) || city.includes(evt.location)) && isRenderableEventPoint(coords.lat, coords.lon) && isExactCityMatch(evt.location, city)) {
            return { ...evt, lat: coords.lat, lon: coords.lon };
          }
        }
        return { ...evt, lat: null, lon: null };
      })
      .filter(evt => isRenderableEventPoint(evt.lat, evt.lon));
  }, [demoEmergencyEvents, emergencyEvents, dataMode]);

  const vehicleDispatchEvents = useMemo(() => {
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    const now = Date.now();
    return mergedEmergencyEvents.filter(evt => {
      if (getEmergencyEventService(evt) === 'other') return false;
      const evtTime = evt.event_time ? new Date(evt.event_time).getTime() : new Date(evt.created_at).getTime();
      return (now - evtTime) < TWO_HOURS;
    });
  }, [mergedEmergencyEvents, getEmergencyEventService]);

  const mdaDispatchEvents = useMemo(
    () => vehicleDispatchEvents.filter(evt => getEmergencyEventService(evt) === 'mda'),
    [vehicleDispatchEvents, getEmergencyEventService]
  );

  // ── Demo Intel / News Reports for demo mode ──
  const demoIntelReports = useMemo(() => {
    if (dataMode !== 'demo') return [];
    const now = Date.now();
    return [
      { id: 'demo-n12-1', title: '[ערוץ 12] מבזק: פיצוץ חריג נשמע באזור חיפה', summary: 'תושבים דיווחו על פיצוץ חזק. כוחות ביטחון פרושים בשטח. מד"א טרם דיווח על נפגעים.', source: 'news_ch12', severity: 'high', category: 'ביטחוני', region: 'חיפה', tags: ['פיצוץ', 'ביטחוני'], raw_data: { situation: 'ביטחוני' }, created_at: new Date(now - 120000).toISOString() },
      { id: 'demo-n13-1', title: '[ערוץ 13] דובר צה"ל: כוננות מוגברת בגבול הצפון', summary: 'חטיבות שוריון הוזנקו לגבול לבנון. אוגדה 91 בכוננות גבוהה.', source: 'news_ch13', severity: 'critical', category: 'צבאי', region: 'צפון', tags: ['צה"ל', 'כוננות'], raw_data: { situation: 'ביטחוני' }, created_at: new Date(now - 180000).toISOString() },
      { id: 'demo-kan-1', title: '[כאן 11] קבינט מלחמה התכנס לישיבת חירום', summary: 'ראש הממשלה כינס את קבינט המלחמה. על סדר היום: הסלמה מול חיזבאללה.', source: 'news_ch11', severity: 'high', category: 'מדיני', region: 'ירושלים', tags: ['קבינט', 'מדיני'], raw_data: { situation: 'מדיני' }, created_at: new Date(now - 300000).toISOString() },
      { id: 'demo-cnn-1', title: '[CNN] Breaking: IDF launches major operation in southern Lebanon', summary: 'Israeli warplanes struck multiple targets in south Lebanon. Pentagon monitoring the situation.', source: 'news_cnn', severity: 'critical', category: 'ביטחוני', region: 'לבנון', tags: ['IDF', 'Lebanon'], raw_data: { situation: 'ביטחוני' }, created_at: new Date(now - 240000).toISOString() },
      { id: 'demo-fox-1', title: '[Fox News] White House: US stands with Israel\'s right to self-defense', summary: 'The Biden administration reaffirmed support for Israel amid northern border escalation.', source: 'news_foxnews', severity: 'medium', category: 'מדיני', region: null, tags: ['US', 'diplomacy'], raw_data: { situation: 'מדיני' }, created_at: new Date(now - 360000).toISOString() },
      { id: 'demo-aj-1', title: '[Al Jazeera] Hezbollah fires barrage at northern Israel', summary: 'اطلقت حزب الله وابلا من الصواريخ على شمال اسرائيل. تقارير عن اصابات في كريات شمونة.', source: 'news_aljazeera', severity: 'critical', category: 'ביטחוני', region: 'צפון', tags: ['Hezbollah', 'rockets'], raw_data: { situation: 'ביטחוני' }, created_at: new Date(now - 150000).toISOString() },
      { id: 'demo-reuters-1', title: '[Reuters] Exclusive: Iran moves ballistic missiles closer to Israel border', summary: 'Intelligence sources say Iran has repositioned medium-range ballistic missiles in western Iraq, within striking range of Israel.', source: 'news_reuters', severity: 'critical', category: 'ביטחוני', region: 'איראן', tags: ['Iran', 'missiles', 'Reuters'], raw_data: { situation: 'ביטחוני', source_name: 'Reuters', icon: '📰', color: '#ff8800' }, created_at: new Date(now - 180000).toISOString() },
      { id: 'demo-reuters-2', title: '[Reuters] UN Security Council emergency session on Middle East escalation', summary: 'The UNSC convened an emergency meeting following overnight strikes. Russia and China called for restraint.', source: 'news_reuters', severity: 'high', category: 'מדיני', region: null, tags: ['UN', 'diplomacy', 'Reuters'], raw_data: { situation: 'מדיני', source_name: 'Reuters', icon: '📰', color: '#ff8800' }, created_at: new Date(now - 380000).toISOString() },
      { id: 'demo-bbc-1', title: '[BBC] Thousands evacuated from northern Israeli towns amid rocket threat', summary: 'IDF orders evacuation of border communities as Hezbollah threat level rises to maximum.', source: 'news_bbc', severity: 'high', category: 'הומניטרי', region: 'צפון', tags: ['evacuation', 'BBC'], raw_data: { situation: 'הומניטרי', source_name: 'BBC', icon: '🇬🇧', color: '#bb1919' }, created_at: new Date(now - 270000).toISOString() },
      { id: 'demo-irna-1', title: '[IRNA] איראן: תגובה מוחצת לכל תוקפנות ישראלית', summary: 'סוכנות הידיעות האיראנית IRNA מדווחת כי משמרות המהפכה הכריזו על כוננות מלאה. דובר צבאי: "התגובה תהיה מיידית."', source: 'news_irna', severity: 'critical', category: 'ביטחוני', region: 'איראן', tags: ['Iran', 'IRGC', 'IRNA'], raw_data: { situation: 'ביטחוני', source_name: 'IRNA', icon: '🇮🇷', color: '#4caf50' }, created_at: new Date(now - 200000).toISOString() },
      { id: 'demo-tasnim-1', title: '[Tasnim] חיזבאללה: חשפנו מערכות נשק חדשות', summary: 'סוכנות תסנים מצטטת גורם בכיר בחיזבאללה: "יש לנו יכולות שישראל לא מודעת להן."', source: 'news_tasnim', severity: 'high', category: 'ביטחוני', region: 'לבנון', tags: ['Hezbollah', 'weapons', 'Tasnim'], raw_data: { situation: 'ביטחוני', source_name: 'Tasnim', icon: '🇮🇷', color: '#388e3c' }, created_at: new Date(now - 320000).toISOString() },
      { id: 'demo-fars-1', title: '[Fars] חמינאי: ציר ההתנגדות חזק מתמיד', summary: 'סוכנות פארס מדווחת על נאום המנהיג העליון: "ישראל תיכשל כמו בעבר."', source: 'news_fars', severity: 'medium', category: 'מדיני', region: 'איראן', tags: ['Khamenei', 'Fars'], raw_data: { situation: 'מדיני', source_name: 'Fars', icon: '🇮🇷', color: '#2e7d32' }, created_at: new Date(now - 400000).toISOString() },
      { id: 'demo-nato-1', title: 'NATO: Monitoring situation in Eastern Mediterranean', summary: 'NATO Secretary General expresses concern over escalation. Alliance on standby.', source: 'nato', severity: 'medium', category: 'מדיני', region: null, tags: ['NATO'], raw_data: {}, created_at: new Date(now - 500000).toISOString() },
      { id: 'demo-n12-2', title: '[ערוץ 12] יירוט מוצלח מעל תל אביב — כיפת ברזל', summary: 'כיפת ברזל יירטה רקטה שנורתה מרצועת עזה לעבר גוש דן. אין נפגעים.', source: 'news_ch12', severity: 'critical', category: 'ביטחוני', region: 'תל אביב', tags: ['יירוט', 'כיפת ברזל'], raw_data: { situation: 'ביטחוני' }, created_at: new Date(now - 60000).toISOString() },
      { id: 'demo-analysis-1', title: '🧠 הערכת מצב: סיכון לפתיחת חזית צפונית', summary: 'ניתוח AI: מגמת הסלמה צפונית. 73% סיכוי לתגובת חיזבאללה תוך 48 שעות. מומלץ: כוננות מוגברת בצפון.', source: 'news_analysis', severity: 'high', category: 'הערכת מצב', region: 'צפון', tags: ['AI', 'הערכה'], raw_data: {}, created_at: new Date(now - 30000).toISOString() },
    ] as any[];
  }, [dataMode, countdownTick]);

  // Merged intel = real + demo
  const mergedIntelReports = useMemo(() => {
    if (dataMode === 'demo') return [...demoIntelReports, ...intelReports];
    return intelReports;
  }, [dataMode, demoIntelReports, intelReports]);

  // ── Auto-translate non-Hebrew intel titles + summaries ──
  useEffect(() => {
    const texts = mergedIntelReports.flatMap(r => [
      r.title.replace(/^\[.*?\]\s*/, ''),
      r.summary || '',
    ]).filter(Boolean);
    if (texts.length > 0) translateHeadlines(texts);
  }, [mergedIntelReports, translateHeadlines]);

  // ── Emergency zones: active non-released oref alerts < 10 min ──
  const emergencyZones = useMemo(() => {
    if (dataMode !== 'live' || orefAlerts.length === 0) return [];
    const now = Date.now();
    // Build release map
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
    // Active alerts
    const zones: { id: string; title: string; locations: string[]; alertDate: number; ageMs: number }[] = [];
    for (const a of orefAlerts) {
      const t = (a.title || '');
      if (t.includes('שחרור') || t.includes('הותר')) continue;
      const alertTime = new Date(a.alert_date).getTime();
      const ageMs = now - alertTime;
      if (ageMs > 600000) continue; // only < 10 min
      // Check if released
      const locs = (a.locations || []) as string[];
      const activeLocs = locs.filter(loc => {
        const relTime = releaseMap.get(loc) || 0;
        return relTime < alertTime;
      });
      if (activeLocs.length === 0) continue;
      zones.push({ id: a.id, title: t, locations: activeLocs, alertDate: alertTime, ageMs });
    }
    return zones;
  }, [dataMode, orefAlerts]);

  // ── Shockwave trigger: fire shockwave for new alerts ──
  useEffect(() => {
    if (emergencyZones.length === 0) return;
    const currentIds = new Set(emergencyZones.map(z => z.id));
    const newZones = emergencyZones.filter(z => !prevAlertIdsRef.current.has(z.id));
    prevAlertIdsRef.current = currentIds;

    if (newZones.length === 0) return;

    const newPoints: ShockwavePoint[] = [];
    for (const zone of newZones) {
      // Determine defense layer based on location (north = rockets/Iron Dome, south = rockets, center = could be ballistic)
      const isNorth = zone.locations.some(l => {
        const gps = CITY_GPS_LOOKUP[l];
        return gps && gps.lat > 32.5; // Northern Israel
      });
      const isSouth = zone.locations.some(l => {
        const gps = CITY_GPS_LOOKUP[l];
        return gps && gps.lat < 31.5;
      });
      // Northern alerts = likely rockets from Lebanon → Iron Dome (green)
      // Southern alerts = likely rockets from Gaza → Iron Dome (green)  
      // Central alerts during ballistic → Arrow/Patriot (purple/blue)
      const defLayer: DefenseLayer = isNorth ? 'iron_dome' : isSouth ? 'iron_dome' : 'davids_sling';
      const layerColor = DEFENSE_LAYER_INFO[defLayer].color;

      for (const locName of zone.locations.slice(0, 3)) {
        const gps = CITY_GPS_LOOKUP[locName];
        const region = REGIONS.find(r => r.name === locName);
        const lat = gps ? gps.lat : region?.lat;
        const lon = gps ? gps.lon : region?.lon;
        if (lat && lon) {
          newPoints.push({
            lat, lon,
            startTime: Date.now(),
            color: layerColor,
            id: `shock-${zone.id}-${locName}`,
            defenseLayer: defLayer,
          });
        }
      }
    }

    if (newPoints.length > 0) {
      setShockwavePoints(prev => [...prev, ...newPoints]);
      // Clean up after animation duration
      setTimeout(() => {
        const ids = new Set(newPoints.map(p => p.id));
        setShockwavePoints(prev => prev.filter(p => !ids.has(p.id)));
      }, 5000);
    }
  }, [emergencyZones]);

  // ═══════════════════════════════════════════════════════
  // ── ZONAL MANAGEMENT: Cross-referencing engine ──
  // Aggregates reports by city from multiple sources (MDA, Fire, Police, Oref, Telegram).
  // When 3+ distinct sources report on the SAME city within 15 min → MCI event.
  // ═══════════════════════════════════════════════════════
  interface MCIEvent {
    city: string;
    lat: number;
    lon: number;
    sources: { type: string; icon: string; title: string; time: number }[];
    newestTime: number;
    severity: 'mci' | 'combined' | 'verified';
  }

  const [activeMCI, setActiveMCI] = useState<MCIEvent | null>(null);
  const prevMCICitiesRef = useRef<Set<string>>(new Set());
  const [verifiedNavIdx, setVerifiedNavIdx] = useState(0);
  const [activeNavEvent, setActiveNavEvent] = useState<{ id: string; label: string; lat: number; lon: number; icon: string; color: string; status: string; reports: string[]; timestamp: number; zoom: number } | null>(null);

  const mciEvents = useMemo(() => {
    const now = Date.now();
    const WINDOW_MS = 15 * 60 * 1000; // 15 min window
    // cityReports: { [city]: { sources: Set<type>, entries: [] } }
    const cityReports = new Map<string, { lat: number; lon: number; sources: Map<string, { icon: string; title: string; time: number }> }>();

    const addReport = (city: string, sourceType: string, icon: string, title: string, time: number) => {
      if (now - time > WINDOW_MS) return;
      let gps: { lat: number; lon: number } | null = null;
      if (CITY_GPS_LOOKUP[city]) gps = CITY_GPS_LOOKUP[city];
      else {
        // Substring match: "צפת - עיר" → "צפת"
        for (const [cn, coords] of Object.entries(CITY_GPS_LOOKUP)) {
          if (city.includes(cn) || cn.includes(city)) { gps = coords; break; }
        }
      }
      if (!gps) {
        const region = REGIONS.find(r => r.name === city || city.includes(r.name) || r.name.includes(city));
        if (region) gps = { lat: region.lat, lon: region.lon };
      }
      if (!gps) return;
      if (!cityReports.has(city)) cityReports.set(city, { lat: gps.lat, lon: gps.lon, sources: new Map() });
      const entry = cityReports.get(city)!;
      const existing = entry.sources.get(sourceType);
      if (!existing || time > existing.time) {
        entry.sources.set(sourceType, { icon, title: title.slice(0, 80), time });
      }
    };

    // 1. Oref alerts → source "oref"
    for (const a of orefAlerts) {
      const t = (a.title || '');
      if (t.includes('שחרור') || t.includes('הותר')) continue;
      const time = new Date(a.alert_date).getTime();
      for (const loc of (a.locations || []) as string[]) {
        const trimmed = loc.trim();
        addReport(trimmed, 'oref', '🚨', t, time);
        // Also try substring match
        for (const [cityName] of Object.entries(CITY_GPS_LOOKUP)) {
          if (trimmed.includes(cityName) && cityName !== trimmed) {
            addReport(cityName, 'oref', '🚨', t, time);
          }
        }
      }
    }

    // 2. Emergency events → source "mda" or "fire"
    for (const evt of mergedEmergencyEvents) {
      const time = evt.event_time ? new Date(evt.event_time).getTime() : new Date(evt.created_at).getTime();
      const isFire = evt.source?.includes('fire');
      const sourceType = isFire ? 'fire' : 'mda';
      const icon = isFire ? '🔥' : '🚑';
      const title = evt.title || '';
      const location = evt.location || '';
      // Match city names in title/location
      for (const [cityName] of Object.entries(CITY_GPS_LOOKUP)) {
        if (title.includes(cityName) || location.includes(cityName)) {
          addReport(cityName, sourceType, icon, title, time);
        }
      }
      for (const r of REGIONS) {
        if (title.includes(r.name) || location.includes(r.name)) {
          addReport(r.name, sourceType, icon, title, time);
        }
      }
    }

    // 3. Telegram → source "telegram" + keyword-based sub-sources
    const MCI_TEST_KW = ['בדיקה', 'מבחן', 'טסט', 'test', 'בדיקת', 'תרגול', 'תרגיל', 'הודעת מבחן'];
    for (const msg of telegram.messages) {
      if (!msg.text || msg.is_duplicate) continue;
      // Skip test messages
      if (MCI_TEST_KW.some(kw => msg.text!.toLowerCase().includes(kw))) continue;
      const time = msg.message_date ? new Date(msg.message_date).getTime() : new Date(msg.created_at).getTime();
      const text = msg.text;
      // Detect sub-type from keywords
      let sourceType = 'telegram';
      let icon = '📨';
      if (/משטרה|ירי|קטטה|פיגוע|שוד|חדירה|מחבל|דקירה|تسلل|Infiltration/.test(text)) { sourceType = 'police'; icon = '💥'; }
      else if (/שריפה|אש|דליקה|כיבוי|לכודים/.test(text)) { sourceType = 'fire_tg'; icon = '🔥'; }
      else if (/מד.א|אמבולנס|פצוע|נפגע|חלל|הרוגים/.test(text)) { sourceType = 'mda_tg'; icon = '🚑'; }
      else if (/אזעקה|צבע אדום|רקטה|טיל|יירוט|שיגור|נפילה|פיצוץ|חילופי אש|انفجار|إطلاق|صواريخ|غارة|Explosion|Missile|Launch|Air strike/.test(text)) { sourceType = 'oref_tg'; icon = '🚨'; }
      else if (/גרעין|בליסטי|כטב"ם|מל"ט|צנטריפוגות|نووي|صواريخ باليستية|Nuclear|Ballistic|UAV|Drone|S-400|Hypersonic/.test(text)) { sourceType = 'strategic'; icon = '☢️'; }
      else if (/סייבר|לוחמת סייבר|הפסקת חשמל|קריסת רשת|GPS|Cyber|Blackout|هجوم سيبراني/.test(text)) { sourceType = 'cyber'; icon = '💻'; }
      else if (/הורמוז|מנדב|סואץ|טאיוואן|חסימה|תפיסת ספינה|Hormuz|Suez|Blockade|هرمز|المندب/.test(text)) { sourceType = 'chokepoint'; icon = '⚓'; }
      else if (/ריכוז כוחות|גיוס מילואים|כוננות שיא|שיירה|تحركات عسكرية|استنفار|Mobilization|Convoy|Deployment/.test(text)) { sourceType = 'military_mov'; icon = '🪖'; }

      for (const [cityName] of Object.entries(CITY_GPS_LOOKUP)) {
        if (text.includes(cityName)) {
          addReport(cityName, sourceType, icon, text.slice(0, 80), time);
        }
      }
      for (const r of REGIONS) {
        if (text.includes(r.name)) {
          addReport(r.name, sourceType, icon, text.slice(0, 80), time);
        }
      }
    }

    // Build MCI events: 3+ distinct source types = MCI, 2+ = verified
    // Verified events expire after 10 minutes
    const TEN_MINUTES = 10 * 60 * 1000;
    const events: MCIEvent[] = [];
    cityReports.forEach((data, city) => {
      if (data.sources.size >= 2) {
        const sources = Array.from(data.sources.entries()).map(([type, info]) => ({ type, ...info }));
        sources.sort((a, b) => b.time - a.time);
        const severity: MCIEvent['severity'] = data.sources.size >= 4 ? 'mci' : data.sources.size >= 3 ? 'combined' : 'verified';
        const newestTime = sources[0].time;
        // Skip verified-only events older than 10 minutes
        if (severity === 'verified' && (now - newestTime > TEN_MINUTES)) return;
        events.push({
          city,
          lat: data.lat,
          lon: data.lon,
          sources,
          newestTime,
          severity,
        });
      }
    });

    events.sort((a, b) => b.newestTime - a.newestTime);
    return events;
  }, [orefAlerts, emergencyEvents, telegram.messages]);

  // Auto-fly to NEW MCI events (no popup — just fly to location)
  useEffect(() => {
    if (mciEvents.length === 0) return;
    const currentCities = new Set(mciEvents.map(e => e.city));
    // Find cities that are new (not in previous set)
    for (const evt of mciEvents) {
      if (!prevMCICitiesRef.current.has(evt.city)) {
        // New MCI — fly to location only, NO auto-popup
        setFlyTo({ center: [evt.lat, evt.lon], zoom: 13 });
        // Zoom back after 10s
        const zoomBack = setTimeout(() => setFlyTo({ center: [31.5, 34.9], zoom: 8 }), 10000);
        break;
      }
    }
    prevMCICitiesRef.current = currentCities;
    // Keep nav index in bounds
    setVerifiedNavIdx(prev => prev >= mciEvents.length ? 0 : prev);
  }, [mciEvents]);

  // ═══ Auto-fly for keyword detection (WhatsApp-style) ═══
  const lastAutoFlyMsgRef = useRef<string | null>(null);
  useEffect(() => {
    if (telegram.messages.length === 0) return;
    const latest = telegram.messages[0];
    if (!latest?.text || latest.id === lastAutoFlyMsgRef.current) return;
    const age = Date.now() - new Date(latest.created_at).getTime();
    if (age > 120000) return; // Only auto-fly for messages < 2min old

    lastAutoFlyMsgRef.current = latest.id;
    const text = latest.text;

    // Skip test messages — don't auto-fly for them
    const AUTO_FLY_TEST_KW = ['בדיקה', 'מבחן', 'טסט', 'test', 'תרגול', 'תרגיל'];
    if (AUTO_FLY_TEST_KW.some(kw => text.toLowerCase().includes(kw))) return;

    // Find city in message
    let foundCity: { name: string; lat: number; lon: number } | null = null;
    for (const [cityName, coords] of Object.entries(CITY_GPS_LOOKUP)) {
      if (text.includes(cityName)) { foundCity = { name: cityName, ...coords }; break; }
    }
    if (!foundCity) {
      for (const r of REGIONS) {
        if (text.includes(r.name)) { foundCity = { name: r.name, lat: r.lat, lon: r.lon }; break; }
      }
    }
    if (foundCity) {
      setFlyTo({ center: [foundCity.lat, foundCity.lon], zoom: 13 });
      // Zoom back after 8s
      setTimeout(() => setFlyTo({ center: [31.5, 34.9], zoom: 8 }), 8000);
    }
  }, [telegram.messages]);

  const isEmergencyActive = emergencyZones.length > 0;
  const hasActiveAlerts = isEmergencyActive || (dataMode === 'demo' && demoScenario !== 'calm' && war.filteredAlerts.length > 0);
  const isDemoWarActive = dataMode === 'demo' && (demoScenario === 'war' || demoScenario === 'multi_front' || demoScenario === 'lebanon_op');

  // ── Inject demo satellite hotspots for Iran anomaly indicator in toolbar ──
  useEffect(() => {
    if (!isDemoWarActive) return;
    // Only inject if no real hotspots exist
    if (satelliteHotspots.some((h: any) => (h.region || '').includes('איראן'))) return;
    const demoHotspots: any[] = [
      // Iran hotspots
      ...Array.from({ length: 12 }, (_, i) => ({
        latitude: 32.3 + Math.sin(i * 2) * 0.6, longitude: 51.4 + Math.cos(i * 1.5) * 1.0,
        region: 'איראן — אספהאן', intensity: i < 3 ? 'extreme' : i < 7 ? 'high' : 'nominal',
        frp: 60 + i * 12, acq_time: new Date(Date.now() - (25 - i) * 60000).toISOString(),
      })),
      // Yemen hotspots
      ...Array.from({ length: 8 }, (_, i) => ({
        latitude: 15.3 + Math.sin(i * 1.8) * 0.5, longitude: 48.2 + Math.cos(i * 1.3) * 0.8,
        region: 'תימן — סנעא', intensity: i < 2 ? 'extreme' : i < 5 ? 'high' : 'nominal',
        frp: 50 + i * 10, acq_time: new Date(Date.now() - (20 - i) * 60000).toISOString(),
      })),
      // Syria hotspots
      ...Array.from({ length: 6 }, (_, i) => ({
        latitude: 34.5 + Math.sin(i * 2.2) * 0.4, longitude: 38.8 + Math.cos(i * 1.6) * 0.6,
        region: 'סוריה — דמשק', intensity: i < 2 ? 'extreme' : i < 4 ? 'high' : 'nominal',
        frp: 40 + i * 8, acq_time: new Date(Date.now() - (15 - i) * 60000).toISOString(),
      })),
    ];
    setSatelliteHotspots(prev => [...prev, ...demoHotspots]);
    setSatelliteEarthquakes(prev => [...prev,
      { region: 'איראן', magnitude: 2.9, possible_explosion: true, latitude: 32.65, longitude: 51.68 },
      { region: 'תימן', magnitude: 2.1, possible_explosion: false, latitude: 15.45, longitude: 48.35 },
    ]);
  }, [isDemoWarActive]);

  useEffect(() => {
    if (isEmergencyActive || orefAlerts.length > 0) {
      setShowShelters(true);
    }
  }, [orefAlerts, isEmergencyActive]);

  const [preWarScenario, setPreWarScenario] = useState<DemoScenario | null>(null);
  const hasLiveMissileAlert = useMemo(() => {
    if (dataMode !== 'live') return false;
    const now = Date.now();
    return orefAlerts.some(a => {
      const t = (a.title || '');
      if (t.includes('שחרור') || t.includes('הותר')) return false;
      const isMissile = t.includes('ירי') || t.includes('טיל') || t.includes('רקט') || t.includes('צבע אדום') || t.includes('חדירת') || (a.raw_data as any)?.threat === 1;
      return isMissile && (now - new Date(a.alert_date).getTime()) < 600000;
    });
  }, [dataMode, orefAlerts]);

  const shouldWarMode = isEmergencyActive || hasLiveMissileAlert;

  useEffect(() => {
    if (shouldWarMode) {
      void requestScreenWakeLock();
    } else {
      setShowMobileEmergencyTakeover(false);
      void releaseScreenWakeLock();
    }
  }, [shouldWarMode, requestScreenWakeLock, releaseScreenWakeLock]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && shouldWarMode) {
        void requestScreenWakeLock();
      } else if (document.visibilityState !== 'visible') {
        void releaseScreenWakeLock();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [shouldWarMode, requestScreenWakeLock, releaseScreenWakeLock]);

  // ── Auto clock color: red on active attack (live or demo), yellow on alerts, green otherwise ──
  const clockColorIdx = clockColorIdxManual !== null ? clockColorIdxManual : (isEmergencyActive || hasLiveMissileAlert || isDemoWarActive ? 2 : hasActiveAlerts ? 1 : 0);
  const setClockColorIdx = (fn: (i: number) => number) => setClockColorIdxManual(fn(clockColorIdx));

  // Reset manual clock override when attack state changes
  useEffect(() => {
    if (isEmergencyActive || hasLiveMissileAlert || isDemoWarActive) setClockColorIdxManual(null);
  }, [isEmergencyActive, hasLiveMissileAlert, isDemoWarActive]);

  useEffect(() => {
    if (shouldWarMode && dataMode === 'live') {
      if (demoScenario !== 'war' && demoScenario !== 'multi_front') {
        setPreWarScenario(demoScenario);
        setDemoScenario('war');
        // Keep heavy layers opt-in only on initial load
        setShowTrajectories(false);
        setShowForces(false);
        setShowFlights(false);
      }
    } else if (!shouldWarMode && preWarScenario !== null) {
      setDemoScenario(preWarScenario);
      setPreWarScenario(null);
    }
  }, [shouldWarMode, dataMode]);

  // ── "Event ended" auto-dismiss after 60 seconds ──
  const [eventEndedAt, setEventEndedAt] = useState<number | null>(null);
  const [showEventEnded, setShowEventEnded] = useState(false);

  // (allCountdownsCleared logic moved after regionCountdowns declaration)

  // Auto-open panels only when a NEW alert arrives (not on initial load)
  // No longer auto-zooms here — zoom logic is handled in the per-alert effect below
  const prevHasActiveRef = useRef(false);
  const initialZoomDoneRef = useRef(false);
  useEffect(() => {
    if (hasActiveAlerts && !prevHasActiveRef.current) {
      panelAutoOpenedRef.current = true;
      // Don't call zoomInOnCurrentArea — the per-alert effect handles zoom
    }
    if (!hasActiveAlerts && prevHasActiveRef.current) {
      // All alerts cleared — reset anchor so next event session starts fresh
      firstAlertAnchorRef.current = null;
      if (alertSessionTimerRef.current) { clearTimeout(alertSessionTimerRef.current); alertSessionTimerRef.current = null; }
    }
    prevHasActiveRef.current = hasActiveAlerts;
  }, [hasActiveAlerts]);

  // On first load, if there are oref alerts with coordinates, auto-zoom to most recent one
  useEffect(() => {
    if (initialZoomDoneRef.current) return;
    if (!orefAlerts || orefAlerts.length === 0) return;
    const now = Date.now();
    for (const a of orefAlerts) {
      const t = (a.title || '');
      if (t.includes('שחרור') || t.includes('הותר')) continue;
      const alertTime = new Date(a.alert_date).getTime();
      if (now - alertTime > 6 * 60 * 60 * 1000) continue;
      for (const loc of (a.locations || []) as string[]) {
        const trimmed = loc.trim();
        let gps: { lat: number; lon: number } | null = null;
        if (CITY_GPS_LOOKUP[trimmed]) gps = CITY_GPS_LOOKUP[trimmed];
        else {
          for (const [cn, coords] of Object.entries(CITY_GPS_LOOKUP)) {
            if (trimmed.includes(cn) || cn.includes(trimmed)) { gps = coords; break; }
          }
        }
        if (!gps) {
          const region = REGIONS.find(r => r.name === trimmed || trimmed.includes(r.name) || r.name.includes(trimmed));
          if (region) gps = { lat: region.lat, lon: region.lon };
        }
        if (gps) {
          initialZoomDoneRef.current = true;
          setTimeout(() => setFlyTo({ center: [gps!.lat, gps!.lon], zoom: 12 }), 800);
          return;
        }
      }
    }
  }, [orefAlerts]);

  // ── High-threat screen flash (>85) ──
  const [threatFlash, setThreatFlash] = useState(false);
  const threatFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Critical AI anomaly banner ──
  const [criticalBanner, setCriticalBanner] = useState<{ text: string; details: string; time: string } | null>(null);
  const prevAiThreatRef = useRef<string | null>(null);
  useEffect(() => {
    if (!aiAssessment) return;
    const threat = aiAssessment.overall_threat;
    const wasNotCritical = prevAiThreatRef.current !== 'critical' && prevAiThreatRef.current !== 'high';
    const isNowCritical = threat === 'critical' || threat === 'high';

    // Check if any front exceeds 85
    const maxFrontThreat = Math.max(0, ...(aiAssessment.fronts || []).map((f: any) => f.threat_level || 0));
    const shouldFlash = isNowCritical || maxFrontThreat > 85;

    if (shouldFlash) {
      // Trigger repeating flash: 3 pulses
      let pulseCount = 0;
      const doPulse = () => {
        setThreatFlash(true);
        setTimeout(() => setThreatFlash(false), 600);
        pulseCount++;
        if (pulseCount < 3) {
          threatFlashTimerRef.current = setTimeout(doPulse, 1200);
        }
      };
      doPulse();
    }

    if (isNowCritical && wasNotCritical) {
      const summary = aiAssessment.bottom_line || aiAssessment.summary || 'זוהתה חריגה קריטית במצב הביטחוני';
      const details = aiAssessment.key_developments?.[0] || '';
      setCriticalBanner({
        text: summary,
        details: typeof details === 'string' ? details : '',
        time: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
      });
      setTimeout(() => setCriticalBanner(null), 20000);
    }
    prevAiThreatRef.current = threat;
  }, [aiAssessment]);

  // ── Telegram impact alert banners state ──
  const [impactBanners, setImpactBanners] = useState<{ id: string; label: string; icon: string; color: string; location: string; time: string; fullText: string; expanded: boolean; eventTime: number }[]>([]);
  const prevImpactCountRef = useRef(0);

  // ── Message flow trend detection — extreme spike triggers popup + banner ──
  const [trendPopup, setTrendPopup] = useState<{ text: string; time: string } | null>(null);
  const prevMsgCountRef = useRef<{ count: number; ts: number }[]>([]);

  useEffect(() => {
    const now = Date.now();
    // Count messages from last 2 min vs previous 2 min
    const countInWindow = (msgs: any[], fromMs: number, toMs: number) =>
      msgs.filter(m => {
        const t = new Date(m.created_at || m.alert_date || '').getTime();
        return t >= fromMs && t < toMs;
      }).length;

    const allMsgs = [
      ...telegram.messages.map(m => ({ created_at: m.created_at })),
      ...orefAlerts.map(a => ({ created_at: a.alert_date })),
    ];

    const recent = countInWindow(allMsgs, now - 120000, now);
    const previous = countInWindow(allMsgs, now - 240000, now - 120000);

    // Track rolling counts
    prevMsgCountRef.current.push({ count: recent, ts: now });
    if (prevMsgCountRef.current.length > 10) prevMsgCountRef.current.shift();

    // Extreme spike: recent >= 5 messages AND 3x+ the previous window
    if (recent >= 5 && previous > 0 && recent / previous >= 3) {
      const trendText = `זוהה זינוק קיצוני: ${recent} הודעות ב-2 דקות (×${Math.round(recent / previous)} מהרגיל)`;
      const timeStr = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
      setCriticalBanner({ text: trendText, details: '', time: timeStr });
      setTrendPopup({ text: trendText, time: timeStr });
      setTimeout(() => setCriticalBanner(null), 20000);
      setTimeout(() => setTrendPopup(null), 15000);
    } else if (recent >= 8) {
      // Absolute spike even without comparison
      const trendText = `זרימת הודעות חריגה: ${recent} הודעות ב-2 דקות`;
      const timeStr = new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
      setCriticalBanner({ text: trendText, details: '', time: timeStr });
      setTrendPopup({ text: trendText, time: timeStr });
      setTimeout(() => setCriticalBanner(null), 20000);
      setTimeout(() => setTrendPopup(null), 15000);
    }
  }, [telegram.messages.length, orefAlerts.length]);

  const getShelterSecForLocations = useCallback((locations: string[]): number => {
    for (const loc of locations) {
      const region = REGIONS.find(r => loc.includes(r.name) || r.name.includes(loc));
      if (region?.shelterSec !== undefined) return region.shelterSec;
    }
    return 90; // default
  }, []);

  // ── Per-region countdowns for all active emergency zones ──
  const regionCountdowns = useMemo(() => {
    if (emergencyZones.length === 0) return [];
    const now = Date.now();
    const regionMap = new Map<string, { regionName: string; alertDate: number; locations: string[]; shelterSec: number }>();

    for (const zone of emergencyZones) {
      let regionKey = '';
      let regionName = '';
      // Deduplicate: use unique locations per zone
      const uniqueZoneLocs = [...new Set(zone.locations)];
      const locText = uniqueZoneLocs.join(' ');

      if (/צפון|לבנון|קריית שמונה|נהריה|גליל|מטולה|שלומי|מעלות|סער|עברון|מרגליות|כפר גלעדי|דן|שניר|משגב עם|מנרה|מלכיה|יראון/.test(locText)) { regionKey = 'north'; regionName = 'צפון'; }
      else if (/חיפה|קריות|עכו/.test(locText)) { regionKey = 'haifa'; regionName = 'חיפה'; }
      else if (/גולן|טבריה|קצרין/.test(locText)) { regionKey = 'golan'; regionName = 'גולן'; }
      else if (/תל אביב|גוש דן|רמת גן|בני ברק/.test(locText)) { regionKey = 'tlv'; regionName = 'תל אביב'; }
      else if (/מרכז|פתח תקווה|נתניה|הרצליה|כפר סבא|רעננה/.test(locText)) { regionKey = 'center'; regionName = 'מרכז'; }
      else if (/ירושלים/.test(locText)) { regionKey = 'jerusalem'; regionName = 'ירושלים'; }
      else if (/עוטף|שדרות|נתיבות|כיסופים|בארי/.test(locText)) { regionKey = 'gaza_envelope'; regionName = 'עוטף עזה'; }
      else if (/אשקלון|אשדוד/.test(locText)) { regionKey = 'shfela'; regionName = 'שפלה'; }
      else if (/דרום|באר שבע|ערד|דימונה|אופקים/.test(locText)) { regionKey = 'south'; regionName = 'דרום'; }
      else if (/אילת/.test(locText)) { regionKey = 'eilat'; regionName = 'אילת'; }
      else { regionKey = `zone-${zone.id}`; regionName = uniqueZoneLocs[0] || 'אזור'; }

      const existing = regionMap.get(regionKey);
      if (!existing || zone.alertDate > existing.alertDate) {
        const shelterSec = getShelterSecForLocations(uniqueZoneLocs);
        const mergedLocations = existing ? [...new Set([...existing.locations, ...uniqueZoneLocs])] : uniqueZoneLocs;
        regionMap.set(regionKey, { regionName, alertDate: zone.alertDate, locations: mergedLocations, shelterSec });
      } else if (existing) {
        existing.locations = [...new Set([...existing.locations, ...uniqueZoneLocs])];
      }
    }

    return Array.from(regionMap.entries()).map(([key, data]) => {
      const ageMs = now - data.alertDate;
      const remainingMs = Math.max(0, data.shelterSec * 1000 - ageMs);
      const remainMins = Math.floor(remainingMs / 60000);
      const remainSecs = Math.floor((remainingMs % 60000) / 1000);
      const countdownStr = `${String(remainMins).padStart(2, '0')}:${String(remainSecs).padStart(2, '0')}`;
      const shelterExpired = remainingMs <= 0;
      const elapsedMins = Math.floor(ageMs / 60000);
      const elapsedSecs = Math.floor((ageMs % 60000) / 1000);
      const elapsedStr = `${String(elapsedMins).padStart(2, '0')}:${String(elapsedSecs).padStart(2, '0')}`;

      const severity: MapRegion['severity'] = ageMs < 30000 ? 'early_warning' : ageMs < 120000 ? 'critical' : ageMs < 600000 ? 'high' : ageMs < 1800000 ? 'warning' : 'medium';
      return { key, regionName: data.regionName, countdownStr, elapsedStr, shelterExpired, shelterSec: data.shelterSec, locations: data.locations, severity };
    });
  }, [emergencyZones, countdownTick, getShelterSecForLocations]);

  // ── Demo mode countdowns: simulate alert banners for war/multi_front ──
  const demoRegionCountdowns = useMemo(() => {
    if (!isDemoWarActive) return [];
    const now = Date.now();
    const demoRegions: { key: string; regionName: string; shelterSec: number; severity: MapRegion['severity'] }[] = [];
    if (demoScenario === 'war' || demoScenario === 'multi_front') {
      demoRegions.push({ key: 'demo-north', regionName: 'צפון', shelterSec: 0, severity: 'critical' });
      demoRegions.push({ key: 'demo-gaza', regionName: 'עוטף עזה', shelterSec: 15, severity: 'critical' });
      demoRegions.push({ key: 'demo-tlv', regionName: 'תל אביב', shelterSec: 90, severity: 'high' });
    }
    if (demoScenario === 'multi_front') {
      demoRegions.push({ key: 'demo-haifa', regionName: 'חיפה', shelterSec: 60, severity: 'critical' });
      demoRegions.push({ key: 'demo-jerusalem', regionName: 'ירושלים', shelterSec: 90, severity: 'warning' });
    }
    if (demoScenario === 'lebanon_op') {
      demoRegions.push({ key: 'demo-leb-north', regionName: 'צפון — תגובת חיזבאללה', shelterSec: 0, severity: 'critical' });
      demoRegions.push({ key: 'demo-leb-haifa', regionName: 'חיפה', shelterSec: 60, severity: 'warning' });
    }
    return demoRegions.map((dr, i) => {
      const cycleLen = (dr.shelterSec + 60) * 1000;
      const ageMs = ((now + i * 15000) % cycleLen);
      const remainingMs = Math.max(0, dr.shelterSec * 1000 - ageMs);
      const remainMins = Math.floor(remainingMs / 60000);
      const remainSecs = Math.floor((remainingMs % 60000) / 1000);
      const countdownStr = `${String(remainMins).padStart(2, '0')}:${String(remainSecs).padStart(2, '0')}`;
      const shelterExpired = remainingMs <= 0;
      const elapsedMins = Math.floor(ageMs / 60000);
      const elapsedSecs = Math.floor((ageMs % 60000) / 1000);
      const elapsedStr = `${String(elapsedMins).padStart(2, '0')}:${String(elapsedSecs).padStart(2, '0')}`;
      return { ...dr, countdownStr, elapsedStr, shelterExpired, locations: [dr.regionName] };
    });
  }, [isDemoWarActive, demoScenario, countdownTick]);

  const allCountdownBanners = useMemo(() => {
    if (isEmergencyActive && regionCountdowns.length > 0) return regionCountdowns;
    if (isDemoWarActive) return demoRegionCountdowns;
    return [];
  }, [isEmergencyActive, regionCountdowns, isDemoWarActive, demoRegionCountdowns]);
  const showAlertBanners = isEmergencyActive || isDemoWarActive;

  const allCountdownsCleared = useMemo(() => {
    if (!isEmergencyActive) return false;
    if (regionCountdowns.length === 0) return true;
    return regionCountdowns.every(rc => {
      const parts = rc.elapsedStr.split(':').map(Number);
      const totalSec = (parts[0] || 0) * 60 + (parts[1] || 0);
      return rc.shelterExpired && totalSec > 240;
    });
  }, [isEmergencyActive, regionCountdowns]);

  useEffect(() => {
    if (allCountdownsCleared && !eventEndedAt) {
      setEventEndedAt(Date.now());
      setShowEventEnded(true);
    } else if (!allCountdownsCleared) {
      setEventEndedAt(null);
      setShowEventEnded(false);
    }
  }, [allCountdownsCleared]);

  useEffect(() => {
    if (eventEndedAt) {
      const timer = setTimeout(() => setShowEventEnded(false), 60000);
      return () => clearTimeout(timer);
    }
  }, [eventEndedAt]);

  // ── Auto-reset on "שחרור" (clearance) alert from Oref ──
  const lastClearanceRef = useRef<string | null>(null);
  useEffect(() => {
    if (dataMode !== 'live' || orefAlerts.length === 0) return;
    const clearanceAlert = orefAlerts.find(a => {
      const t = (a.title || '');
      return t.includes('שחרור') || t.includes('הותר');
    });
    if (!clearanceAlert) return;
    if (lastClearanceRef.current === clearanceAlert.id) return;
    const ageMs = Date.now() - new Date(clearanceAlert.alert_date).getTime();
    if (ageMs > 300000) return;
    lastClearanceRef.current = clearanceAlert.id;
    setShowTrajectories(false);
    firstAlertAnchorRef.current = null;
    resetZoomToIsrael();
    const timer = setTimeout(() => setShowTrajectories(true), 30000);
    return () => clearTimeout(timer);
  }, [dataMode, orefAlerts, resetZoomToIsrael]);

  const activeAlertCountdown = useMemo(() => {
    if (emergencyZones.length > 0) {
      const newest = emergencyZones[0];
      const now = Date.now();
      const ageMs = now - newest.alertDate;
      const elapsedMins = Math.floor(ageMs / 60000);
      const elapsedSecs = Math.floor((ageMs % 60000) / 1000);
      const elapsedStr = `${String(elapsedMins).padStart(2, '0')}:${String(elapsedSecs).padStart(2, '0')}`;
      const shelterSec = getShelterSecForLocations(newest.locations);
      const remainingMs = Math.max(0, shelterSec * 1000 - ageMs);
      const remainMins = Math.floor(remainingMs / 60000);
      const remainSecs = Math.floor((remainingMs % 60000) / 1000);
      const countdownStr = `${String(remainMins).padStart(2, '0')}:${String(remainSecs).padStart(2, '0')}`;
      const shelterExpired = remainingMs <= 0;
      return { elapsedStr, countdownStr, shelterExpired, shelterSec, locations: [...new Set(newest.locations)].slice(0, 3).join(', '), title: newest.title, isRecent: true, ageMs, timeStr: elapsedStr };
    }
    if (dataMode !== 'live' || orefAlerts.length === 0) return null;
    const now = Date.now();
    const active = orefAlerts.find(a => {
      const title = (a.title || '');
      if (title.includes('שחרור') || title.includes('הותר')) return false;
      const age = now - new Date(a.alert_date).getTime();
      return age < 600000;
    });
    if (!active) return null;
    const ageMs = now - new Date(active.alert_date).getTime();
    const elapsedMins = Math.floor(ageMs / 60000);
    const elapsedSecs = Math.floor((ageMs % 60000) / 1000);
    const elapsedStr = `${String(elapsedMins).padStart(2, '0')}:${String(elapsedSecs).padStart(2, '0')}`;
    const locations = [...new Set((active.locations || []) as string[])].slice(0, 3);
    const shelterSec = getShelterSecForLocations(locations);
    const remainingMs = Math.max(0, shelterSec * 1000 - ageMs);
    const remainMins = Math.floor(remainingMs / 60000);
    const remainSecs = Math.floor((remainingMs % 60000) / 1000);
    const countdownStr = `${String(remainMins).padStart(2, '0')}:${String(remainSecs).padStart(2, '0')}`;
    const shelterExpired = remainingMs <= 0;
    return { elapsedStr, countdownStr, shelterExpired, shelterSec, locations: locations.join(', '), title: active.title, isRecent: ageMs < 120000, ageMs, timeStr: elapsedStr };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataMode, orefAlerts, emergencyZones, countdownTick, getShelterSecForLocations]);

  useEffect(() => {
    if (!activeAlertCountdown) setShowMobileEmergencyTakeover(false);
  }, [activeAlertCountdown]);


  useEffect(() => {
    if (dataMode !== 'live' || orefAlerts.length === 0) return;
    // Find newest non-release alert
    const newestActive = orefAlerts.find(a => {
      const title = (a.title || '');
      return !title.includes('שחרור') && !title.includes('הותר');
    });
    if (!newestActive) return;
    if (newestActive.id === lastSeenAlertIdRef.current) return;
    // Only auto-zoom for alerts less than 5 minutes old
    const ageMs = Date.now() - new Date(newestActive.alert_date).getTime();
    if (ageMs > 300000) {
      lastSeenAlertIdRef.current = newestActive.id;
      return;
    }
    lastSeenAlertIdRef.current = newestActive.id;

    triggerSystemAlert(newestActive);
    void requestScreenWakeLock();

    // Find GPS center for the alert locations
    const locs: string[] = newestActive.locations || [];
    const points: [number, number][] = [];
    for (const loc of locs) {
      const trimmed = loc.trim();
      if (CITY_GPS_LOOKUP[trimmed]) {
        points.push([CITY_GPS_LOOKUP[trimmed].lat, CITY_GPS_LOOKUP[trimmed].lon]);
      }
      const region = REGIONS.find(r => r.name === trimmed || trimmed.includes(r.name) || r.name.includes(trimmed));
      if (region) {
        points.push([region.lat, region.lon]);
      }
    }
    if (points.length === 0) return;
    const avgLat = points.reduce((s, p) => s + p[0], 0) / points.length;
    const avgLon = points.reduce((s, p) => s + p[1], 0) / points.length;
    lastAlertCenterRef.current = [avgLat, avgLon];

    // Determine sector for the alert
    const getSector = (lat: number): 'north' | 'center' | 'south' => {
      if (lat >= 32.5) return 'north';
      if (lat >= 31.2) return 'center';
      return 'south';
    };
    const SECTOR_BOUNDS: Record<string, [[number, number], [number, number]]> = {
      north: [[32.65, 34.85], [33.35, 35.70]],  // Haifa suburbs to Lebanon border — tighter, more detail
      center: [[31.5, 34.4], [32.5, 35.4]],
      south: [[29.5, 34.2], [31.5, 35.3]],
    };

    const isFirstAlert = firstAlertAnchorRef.current === null;
    const alertSector = getSector(avgLat);

    if (isFirstAlert) {
      // ── FIRST ALERT: zoom to the sector, then stay ──
      firstAlertAnchorRef.current = [avgLat, avgLon];
      (firstAlertAnchorRef as any).__sector = alertSector;
      setFlyBounds(null);
      setFlyTo(null);
      // Brief close-up then pull back to sector
      setTimeout(() => {
        setFlyTo({ center: [avgLat, avgLon], zoom: 12 });
        setZoomLevel('close');
      }, 50);
      if (alertSessionTimerRef.current) clearTimeout(alertSessionTimerRef.current);
      alertSessionTimerRef.current = setTimeout(() => {
        setFlyTo(null);
        setFlyBounds(null);
        setTimeout(() => {
          setFlyBounds(SECTOR_BOUNDS[alertSector]);
          setZoomLevel('regional');
        }, 50);
      }, 5000);
    } else {
      // ── SUBSEQUENT ALERTS ──
      const currentSector = (firstAlertAnchorRef as any).__sector || 'north';
      if (alertSector !== currentSector) {
        // NEW SECTOR — jump to it
        (firstAlertAnchorRef as any).__sector = alertSector;
        setFlyTo(null);
        setFlyBounds(null);
        setTimeout(() => {
          setFlyBounds(SECTOR_BOUNDS[alertSector]);
          setZoomLevel('regional');
        }, 100);
      }
      // Same sector — do nothing, events just appear on the current view
    }

    // No full-zoom-out timer — stay on the event area until alerts clear
    return () => {
      // cleanup handled by the session timer ref
    };
  }, [dataMode, orefAlerts, isCompactAlertDevice, resetMobileEmergencyTakeoverTimer, requestScreenWakeLock, triggerSystemAlert]);

  // ── Auto-reset zoom only when NO active events in the last hour ──
  // Stay in sector view as long as there are open events; only return to Israel view when clear
  useEffect(() => {
    if (dataMode !== 'live') return;
    const oneHourAgo = Date.now() - 3600000;
    // Check if any active (non-release) alerts exist within the last hour
    const hasRecentActiveAlerts = orefAlerts.some(a => {
      const title = (a.title || '');
      if (title.includes('שחרור') || title.includes('הותר')) return false;
      return new Date(a.alert_date).getTime() > oneHourAgo;
    });
    
    if (hasRecentActiveAlerts || demoLaunchActive || isDemoWarActive) {
      // Events still active — stay in current sector view, don't jump
      return;
    }
    
    // No active events in last hour — reset to Israel view after a short delay
    // But only if we're not in theater, zone patrol, or full view
    if (zoomLevel === 'full' || theaterView || zonePatrolIdx >= 0) return;
    const timer = setTimeout(() => {
      firstAlertAnchorRef.current = null;
      resetZoomToIsrael();
    }, 8000); // 8 second grace period
    return () => clearTimeout(timer);
  }, [dataMode, orefAlerts, demoLaunchActive, isDemoWarActive, zoomLevel, theaterView, zonePatrolIdx, resetZoomToIsrael]);

  // Apply scenario to regions
  const scenarioRegions = useMemo(() => {
    if (dataMode === 'live') {
      // LIVE: all regions default to 'safe' unless real alerts say otherwise
      return REGIONS.map(r => {
        const liveSeverity = liveRegionSeverities[r.id] || 'safe';
        const alertCount = orefAlerts.filter(a =>
          (a.locations || []).some((l: string) => l.includes(r.name) || r.name.includes(l))
        ).length;
        return {
          ...r,
          severity: liveSeverity as MapRegion['severity'],
          alertCount,
        };
      });
    }
    const overrides = SCENARIO_SEVERITY[demoScenario];
    return REGIONS.map(r => ({
      ...r,
      severity: (overrides[r.id] || (demoScenario === 'calm' ? 'safe' : r.severity)) as MapRegion['severity'],
    }));
  }, [demoScenario, dataMode, liveRegionSeverities, orefAlerts]);

  // Dynamic alert markers for oref locations NOT in predefined REGIONS
  // Handles compound location strings like "בצת שלומי" by matching substrings against GPS lookup
  const dynamicAlertLocations = useMemo(() => {
    if (dataMode !== 'live' || orefAlerts.length === 0) return [];
    const knownNames = new Set(REGIONS.map(r => r.name));
    const lookupKeys = Object.keys(CITY_GPS_LOOKUP);
    const now = Date.now();

    // Step 1: Build per-city release & alert timeline (same logic as liveRegionSeverities)
    const cityLatestRelease = new Map<string, number>();
    const cityLatestAlert = new Map<string, number>();

    const resolveCities = (loc: string): string[] => {
      const out: string[] = [];
      for (const cityName of lookupKeys) {
        if (loc.includes(cityName)) out.push(cityName);
      }
      if (out.length === 0) out.push(loc); // fallback to raw string
      return out;
    };

    for (const alert of orefAlerts) {
      const alertTime = new Date(alert.alert_date).getTime();
      const title = (alert.title || '');
      const isRelease = title.includes('שחרור') || title.includes('הותר');

      for (const loc of (alert.locations || [])) {
        const cities = resolveCities(loc.trim());
        for (const city of cities) {
          if (isRelease) {
            const prev = cityLatestRelease.get(city) || 0;
            if (alertTime > prev) cityLatestRelease.set(city, alertTime);
          } else {
            const prev = cityLatestAlert.get(city) || 0;
            if (alertTime > prev) cityLatestAlert.set(city, alertTime);
          }
        }
      }
    }

    // Step 2: Build markers only for cities whose latest alert is AFTER latest release
    const locMap = new Map<string, { name: string; count: number; severity: MapRegion['severity']; latestDate: string }>();

    for (const alert of orefAlerts) {
      const alertTime = new Date(alert.alert_date).getTime();
      const ageMs = now - alertTime;
      if (ageMs > 7200000) continue; // Show for 2 hours
      const title = (alert.title || '');
      const isRelease = title.includes('שחרור') || title.includes('הותר');
      if (isRelease) continue;

      const sev: MapRegion['severity'] = ageMs < 30000 ? 'early_warning' : ageMs < 120000 ? 'critical' : ageMs < 600000 ? 'high' : ageMs < 1800000 ? 'warning' : 'medium';

      for (const loc of (alert.locations || [])) {
        const trimmed = loc.trim();
        const matchedCities = resolveCities(trimmed);
        let hasRegionMatch = false;

        for (const r of REGIONS) {
          if (trimmed.includes(r.name) || r.name.includes(trimmed)) {
            hasRegionMatch = true;
          }
        }

        for (const city of matchedCities) {
          // Skip if handled by liveRegionSeverities (known REGIONS)
          const isKnown = [...knownNames].some(n => n.includes(city) || city.includes(n));
          if (isKnown) continue;
          // Skip if no GPS
          if (!CITY_GPS_LOOKUP[city]) continue;
          // Skip if there's a release AFTER this alert for this city
          const releaseTime = cityLatestRelease.get(city) || 0;
          if (releaseTime > alertTime) continue;

          const existing = locMap.get(city);
          if (!existing || severityRank(sev) < severityRank(existing.severity)) {
            locMap.set(city, { name: city, count: (existing?.count || 0) + 1, severity: sev, latestDate: alert.alert_date });
          } else {
            existing.count++;
          }
        }
      }
    }
    return Array.from(locMap.values());
  }, [dataMode, orefAlerts]);

  // Update active alert points ref for focusOnAlerts
  useEffect(() => {
    const pts: [number, number][] = [];
    scenarioRegions.forEach(r => {
      if (r.isCity && r.severity !== 'safe' && r.severity !== 'low') {
        pts.push([r.lat, r.lon]);
      }
    });
    dynamicAlertLocations.forEach(loc => {
      const coords = CITY_GPS_LOOKUP[loc.name];
      if (coords) pts.push([coords.lat, coords.lon]);
    });
    activeAlertPointsRef.current = pts;
  }, [scenarioRegions, dynamicAlertLocations]);

  // ── Impact classification: 3 levels ──
  type ImpactLevel = 'direct_hit' | 'shrapnel' | 'intercept_debris';
  interface ClassifiedImpact {
    text: string; lat: number; lon: number; time: string; severity: string;
    level: ImpactLevel; label: string; icon: string; color: string; radiusM: number;
    ageMs: number;
    credibility: 'verified' | 'single_source' | 'unverified'; // ירוק/צהוב/אפור
  }

  const DIRECT_HIT_KW = ['פגיעה ישירה', 'פגיעה במבנה', 'קריסה', 'נזק כבד', 'הרוגים', 'פצועים קשה'];
  const SHRAPNEL_KW = ['רסיסים', 'שברי', 'שברים', 'נפילת פריט', 'פריט בשטח', 'נפל פריט'];
  const INTERCEPT_KW = ['יירוט', 'שרידי יירוט', 'מתפצל', 'התפצלות', 'חלקי טיל'];

  const classifyImpact = (text: string): { level: ImpactLevel; label: string; icon: string; color: string; radiusM: number } => {
    if (DIRECT_HIT_KW.some(kw => text.includes(kw))) {
      return { level: 'direct_hit', label: '💥 פגיעה ישירה', icon: '💥', color: '#ff1744', radiusM: 300 };
    }
    if (INTERCEPT_KW.some(kw => text.includes(kw))) {
      return { level: 'intercept_debris', label: '🛡️ שרידי יירוט', icon: '🛡️', color: '#ff9100', radiusM: 250 };
    }
    if (SHRAPNEL_KW.some(kw => text.includes(kw))) {
      return { level: 'shrapnel', label: '⚠ רסיסים/נפילת פריט', icon: '⚠️', color: '#ffab00', radiusM: 200 };
    }
    // Default — generic fall/impact — bold red icon
    return { level: 'shrapnel', label: '🏚️ נפילה', icon: '🏚️', color: '#ff1744', radiusM: 250 };
  };

  const telegramImpacts = useMemo(() => {
    if (dataMode !== 'live') return [];
    const impacts: ClassifiedImpact[] = [];
    const now = Date.now();
    const seenIds = new Set<string>(); // deduplicate by message id
    const seenHashes = new Set<string>(); // deduplicate by content_hash

    // ── Filter: skip test/drill messages ──
    const TEST_KEYWORDS = ['בדיקה', 'מבחן', 'טסט', 'test', 'בדיקת', 'תרגול', 'תרגיל', 'דיווח אסטרטגי ראשון', 'הודעת מבחן'];
    const isTestMessage = (text: string): boolean => {
      const lower = text.toLowerCase();
      return TEST_KEYWORDS.some(kw => lower.includes(kw));
    };

    // ── Cross-validate: build set of cities with recent oref alerts (last 30 min) ──
    const recentOrefCities = new Set<string>();
    for (const a of orefAlerts) {
      const t = (a.title || '');
      if (t.includes('שחרור') || t.includes('הותר')) continue;
      const alertAge = now - new Date(a.alert_date).getTime();
      if (alertAge > 1800000) continue; // 30 min window
      for (const loc of (a.locations || []) as string[]) {
        recentOrefCities.add(loc.trim());
      }
    }

    // Impact keywords that require oref corroboration to be shown on map
    const MILITARY_IMPACT_KW = ['נפילה', 'פגיעה ישירה', 'נפל טיל', 'פגיעת רקטה', 'יירוט', 'שברים', 'רסיסים', 'קריסה'];
    const GENERAL_IMPACT_KEYWORDS = ['נפילה', 'פגיעה', 'נפל', 'פגע', 'יירוט', 'שברים', 'רסיסים', 'פיצוץ', 'קריסה', 'מתפצל', 'פריט'];
    const allLocs = [...REGIONS, ...Object.entries(CITY_GPS_LOOKUP).map(([name, coords]) => ({ name, ...coords }))];

    for (const msg of telegram.messages) {
      if (!msg.text) continue;
      if (msg.is_duplicate) continue; // skip duplicates
      // ── Skip test messages ──
      if (isTestMessage(msg.text)) continue;
      // Deduplicate by id
      if (seenIds.has(msg.id)) continue;
      seenIds.add(msg.id);
      // Deduplicate by content_hash
      if (msg.content_hash) {
        if (seenHashes.has(msg.content_hash)) continue;
        seenHashes.add(msg.content_hash);
      }

      const ageMs = now - new Date(msg.created_at).getTime();
      if (ageMs > 7200000) continue; // 2 hours

      // Find location in text
      let foundLoc: { name: string; lat: number; lon: number } | null = null;
      for (const loc of allLocs) {
        if (msg.text!.includes(loc.name)) {
          foundLoc = { name: loc.name, lat: 'lat' in loc ? loc.lat : 0, lon: 'lon' in loc ? loc.lon : 0 };
          break;
        }
      }

      // Classify with MDA catalog or impact keywords
      const mdaType = classifyMdaEvent(msg.text!);
      const hasImpactKeyword = GENERAL_IMPACT_KEYWORDS.some(kw => msg.text!.includes(kw));

      // Place on map if has location
      if (!foundLoc) continue;

      // ── Cross-validate military impact claims against oref data ──
      // If message claims a missile fall/direct hit, require oref corroboration
      const isMilitaryImpact = MILITARY_IMPACT_KW.some(kw => msg.text!.includes(kw));
      if (isMilitaryImpact) {
        // Check if there's a recent oref alert for this location or nearby
        const hasOrefCorroboration = recentOrefCities.has(foundLoc.name) ||
          Array.from(recentOrefCities).some(city => {
            const cityCoords = CITY_GPS_LOOKUP[city];
            if (!cityCoords) return false;
            const dist = Math.sqrt(Math.pow(cityCoords.lat - foundLoc!.lat, 2) + Math.pow(cityCoords.lon - foundLoc!.lon, 2));
            return dist < 0.15; // ~15km radius
          });
        if (!hasOrefCorroboration) {
          // No oref corroboration — skip this military impact claim (likely test/fake)
          continue;
        }
      }

      // ── Compute credibility level ──
      const hasOrefNearby = recentOrefCities.has(foundLoc.name) ||
        Array.from(recentOrefCities).some(city => {
          const cc = CITY_GPS_LOOKUP[city];
          if (!cc) return false;
          return Math.sqrt(Math.pow(cc.lat - foundLoc!.lat, 2) + Math.pow(cc.lon - foundLoc!.lon, 2)) < 0.15;
        });
      // Check if multiple sources mention this location (emergency_events, oref, telegram)
      const hasEmergencyEvent = emergencyEvents.some(e => {
        if (!e.location) return false;
        return e.location.includes(foundLoc!.name) || foundLoc!.name.includes(e.location);
      });
      const credibility: 'verified' | 'single_source' | 'unverified' =
        hasOrefNearby ? 'verified' :
        (hasEmergencyEvent || (mdaType && hasImpactKeyword)) ? 'single_source' :
        'unverified';
      
      // If no MDA type and no impact keyword, show as general intel marker
      if (!mdaType && !hasImpactKeyword) {
        impacts.push({
          text: msg.text!.slice(0, 120),
          lat: foundLoc.lat,
          lon: foundLoc.lon,
          time: msg.created_at,
          severity: msg.severity || 'low',
          ageMs,
          level: 'intercept_debris' as const,
          label: '📡 מודיעין טלגרם',
          icon: '📡',
          color: '#00bcd4',
          radiusM: 120,
          credibility,
        });
        continue;
      }

      if (mdaType) {
        const severityToRadius: Record<string, number> = { critical: 350, high: 280, medium: 200, low: 150 };
        impacts.push({
          text: msg.text!.slice(0, 120),
          lat: foundLoc.lat,
          lon: foundLoc.lon,
          time: msg.created_at,
          severity: mdaType.defaultSeverity,
          ageMs,
          level: mdaType.defaultSeverity === 'critical' ? 'direct_hit' : mdaType.defaultSeverity === 'high' ? 'shrapnel' : 'intercept_debris',
          label: `${mdaType.emoji} ${mdaType.labelHe}`,
          icon: mdaType.emoji,
          color: mdaType.color,
          radiusM: severityToRadius[mdaType.defaultSeverity] || 200,
          credibility,
        });
      } else {
        const classification = classifyImpact(msg.text!);
        impacts.push({
          text: msg.text!.slice(0, 120),
          lat: foundLoc.lat,
          lon: foundLoc.lon,
          time: msg.created_at,
          severity: msg.severity || 'high',
          ageMs,
          ...classification,
          credibility,
          ...classification,
        });
      }
    }
    return impacts;
  }, [dataMode, telegram.messages, orefAlerts, emergencyEvents]);

  // ── Telegram impact alert banners — fire when new impacts arrive ──
  useEffect(() => {
    if (telegramImpacts.length <= prevImpactCountRef.current) {
      prevImpactCountRef.current = telegramImpacts.length;
      return;
    }
    const newImpacts = telegramImpacts.slice(prevImpactCountRef.current);
    prevImpactCountRef.current = telegramImpacts.length;
    const newBanners = newImpacts.map((imp, idx) => ({
      id: `imp-${Date.now()}-${idx}`,
      label: imp.label,
      icon: imp.icon,
      color: imp.color,
      location: imp.text.slice(0, 60),
      fullText: imp.text,
      expanded: false,
      time: new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      eventTime: new Date(imp.time).getTime(),
    }));
    setImpactBanners(prev => [...newBanners, ...prev].slice(0, 20));
    const ids = newBanners.map(b => b.id);
    setTimeout(() => {
      setImpactBanners(prev => prev.filter(b => !ids.includes(b.id)));
    }, 1800000); // 30 minutes
  }, [telegramImpacts]);

  // ── All telegram messages as map markers (deduplicated, no verification required) ──
  const allTelegramMarkers = useMemo(() => {
    if (!showTelegramLayer || dataMode !== 'live') return [];
    const now = Date.now();
    const seenIds = new Set<string>();
    const seenHashes = new Set<string>();
    const TEST_KW = ['בדיקה', 'מבחן', 'טסט', 'test', 'תרגול', 'תרגיל', 'הודעת מבחן'];
    const allLocs = [...REGIONS, ...Object.entries(CITY_GPS_LOOKUP).map(([name, coords]) => ({ name, ...coords }))];
    const IMPACT_KW = ['נפילה', 'פגיעה', 'רסיסים', 'פיצוץ', 'פיגוע', 'ירי', 'דקירה', 'דריסה', 'חדירה', 'יירוט', 'שברים', 'קריסה', 'נפל', 'פגע'];
    const recentOrefCities = new Set<string>();
    for (const a of orefAlerts) {
      if ((a.title || '').includes('שחרור')) continue;
      if (now - new Date(a.alert_date).getTime() > 1800000) continue;
      for (const loc of (a.locations || []) as string[]) recentOrefCities.add(loc.trim());
    }
    // Helper to classify event type from text
    const classifyEventIcon = (text: string): { icon: string; type: string } => {
      // Home Front Command — critical
      if (/צבע אדום|חדירת כטב"ם|פגיעה ישירה|התרעה|כניסה למרחב מוגן|מסר אישי/.test(text)) return { icon: '🚨', type: 'home_front' };
      // Field updates
      if (/שחרור|חזרה לשגרה|הנחיות|סיום אירוע|דיווח ראשוני/.test(text)) return { icon: '🟠', type: 'update' };
      // Police / Terror
      if (/משטרה|ירי|קטטה|פיגוע|שוד|חדירה|מחבל|דקירה|تسلل|Infiltration/.test(text)) return { icon: '💥', type: 'police' };
      if (/שריפה|אש|דליקה|כיבוי|לכודים/.test(text)) return { icon: '🔥', type: 'fire' };
      if (/מד.א|אמבולנס|פצוע|נפגע|חלל|הרוגים/.test(text)) return { icon: '🚑', type: 'mda' };
      if (/אזעקה|רקטה|טיל|יירוט|שיגור|נפילה|פיצוץ|חילופי אש|انفجار|إطلاق|صواريخ|غارة|Explosion|Missile|Launch|Air strike/.test(text)) return { icon: '💥', type: 'explosion' };
      if (/גרעין|בליסטי|כטב"ם|מל"ט|צנטריפוגות|نووي|Nuclear|Ballistic|UAV|Drone/.test(text)) return { icon: '☢️', type: 'strategic' };
      if (/סייבר|הפסקת חשמל|קריסת רשת|Cyber|Blackout/.test(text)) return { icon: '💻', type: 'cyber' };
      if (/ריכוז כוחות|גיוס מילואים|כוננות|Mobilization|Convoy/.test(text)) return { icon: '🪖', type: 'military' };
      // Geopolitics
      if (/איראן|הבית הלבן|טראמפ|ביידן|סנקציות|הסכם|מודיעין/.test(text)) return { icon: '🔵', type: 'geo' };
      // Finance
      if (/נפט|דולר|ריבית|אינפלציה|בורסה|נאסד"ק/.test(text)) return { icon: '💰', type: 'finance' };
      return { icon: '📨', type: 'telegram' };
    };
    const markers: { id: string; text: string; lat: number; lon: number; time: string; verificationSources: number; verified: boolean; inProgress: boolean; locationName: string; isImpact: boolean; eventIcon: string; eventType: string }[] = [];
    const markerLocKeys = new Set<string>(); // track lat/lon to avoid dupes

    // ── Auto-create impact markers from recent Oref alerts with known GPS ──
    const orefImpactWindow = 2 * 60 * 60 * 1000; // 2 hours
    for (const a of orefAlerts) {
      const t = (a.title || '');
      if (t.includes('שחרור') || t.includes('הותר')) continue;
      const alertTime = new Date(a.alert_date).getTime();
      if (now - alertTime > orefImpactWindow) continue;
      for (const loc of (a.locations || []) as string[]) {
        const trimmed = loc.trim();
        let gps: { lat: number; lon: number } | null = null;
        let baseName = trimmed;
        // Direct lookup
        if (CITY_GPS_LOOKUP[trimmed]) { gps = CITY_GPS_LOOKUP[trimmed]; baseName = trimmed; }
        else {
          // Fuzzy match: "צפת - עיר" → "צפת"
          for (const [cityName, coords] of Object.entries(CITY_GPS_LOOKUP)) {
            if (trimmed.includes(cityName) || cityName.includes(trimmed)) { gps = coords; baseName = cityName; break; }
          }
        }
        if (!gps) {
          const region = REGIONS.find(r => trimmed.includes(r.name) || r.name.includes(trimmed));
          if (region) { gps = { lat: region.lat, lon: region.lon }; baseName = region.name; }
        }
        if (!gps) continue;
        const locKey = `${gps.lat.toFixed(2)},${gps.lon.toFixed(2)}`;
        if (markerLocKeys.has(locKey)) continue;
        markerLocKeys.add(locKey);
        // Count verification: Oref = 1 source, check telegram for additional
        let sources = 1;
        const tgMentions = telegram.messages.filter(m => m.text && !m.is_duplicate && m.text.includes(baseName) && IMPACT_KW.some(kw => m.text!.includes(kw)));
        if (tgMentions.length > 0) sources++;
        const hasEmergency = emergencyEvents.some(e => e.location && (e.location.includes(baseName) || baseName.includes(e.location)));
        if (hasEmergency) sources++;
        // Different telegram senders
        const uniqueSenders = new Set(tgMentions.map(m => m.sender_name).filter(Boolean));
        if (uniqueSenders.size > 1) sources++;
        const orefClassified = classifyEventIcon(t);
        markers.push({
          id: `oref-impact-${a.id}-${baseName}`, text: `🚨 ${t}`, lat: gps.lat, lon: gps.lon,
          time: a.alert_date, verificationSources: sources, verified: sources >= 2,
          inProgress: sources >= 3, locationName: baseName, isImpact: true,
          eventIcon: orefClassified.icon === '📨' ? '💥' : orefClassified.icon, eventType: orefClassified.type === 'telegram' ? 'explosion' : orefClassified.type,
        });
      }
    }

    // ── Telegram-based markers ──
    for (const msg of telegram.messages) {
      if (!msg.text || msg.is_duplicate) continue;
      if (TEST_KW.some(kw => msg.text!.toLowerCase().includes(kw))) continue;
      if (seenIds.has(msg.id)) continue;
      seenIds.add(msg.id);
      if (msg.content_hash) { if (seenHashes.has(msg.content_hash)) continue; seenHashes.add(msg.content_hash); }
      const ageMs = now - new Date(msg.created_at).getTime();
      if (ageMs > 3600000) continue; // 1 hour — after that stays only in telegram intel sidebar
      let foundLoc: { name: string; lat: number; lon: number } | null = null;
      for (const loc of allLocs) {
        if (msg.text!.includes(loc.name)) { foundLoc = { name: loc.name, lat: 'lat' in loc ? loc.lat : 0, lon: 'lon' in loc ? loc.lon : 0 }; break; }
      }
      if (!foundLoc) continue;
      const locKey = `${foundLoc.lat.toFixed(2)},${foundLoc.lon.toFixed(2)}`;
      if (markerLocKeys.has(locKey)) continue; // skip if Oref already placed one here
      markerLocKeys.add(locKey);
      // Count verification sources
      let sources = 1; // telegram itself
      const hasOref = recentOrefCities.has(foundLoc.name) || Array.from(recentOrefCities).some(city => {
        const cc = CITY_GPS_LOOKUP[city];
        return cc ? Math.sqrt(Math.pow(cc.lat - foundLoc!.lat, 2) + Math.pow(cc.lon - foundLoc!.lon, 2)) < 0.15 : false;
      });
      if (hasOref) sources++;
      const hasEmergency = emergencyEvents.some(e => e.location && (e.location.includes(foundLoc!.name) || foundLoc!.name.includes(e.location)));
      if (hasEmergency) sources++;
      const otherTgSameLocation = telegram.messages.filter(m2 => m2.id !== msg.id && !m2.is_duplicate && m2.text && m2.text.includes(foundLoc!.name) && m2.sender_name !== msg.sender_name);
      if (otherTgSameLocation.length > 0) sources++;
      const isImpact = IMPACT_KW.some(kw => msg.text!.includes(kw));
      const inProgress = sources >= 3;
      const tgClassified = classifyEventIcon(msg.text!);
      markers.push({ id: msg.id, text: msg.text!.slice(0, 100), lat: foundLoc.lat, lon: foundLoc.lon, time: msg.created_at, verificationSources: sources, verified: sources >= 2, inProgress, locationName: foundLoc.name, isImpact, eventIcon: tgClassified.icon, eventType: tgClassified.type });
    }
    return markers;
  }, [showTelegramLayer, dataMode, telegram.messages, orefAlerts, emergencyEvents]);

  // ── Foreign strike locations (Lebanon, Iran, Syria, Yemen, Iraq) ──
  const FOREIGN_STRIKE_LOCATIONS: Record<string, { lat: number; lon: number }> = {
    // Lebanon
    'ביירות': { lat: 33.89, lon: 35.50 }, 'בירות': { lat: 33.89, lon: 35.50 },
    'דהייה': { lat: 33.85, lon: 35.50 }, 'הדחייה': { lat: 33.85, lon: 35.50 },
    'בעלבכ': { lat: 34.01, lon: 36.21 }, 'צידון': { lat: 33.56, lon: 35.38 },
    'צור': { lat: 33.27, lon: 35.20 }, 'טריפולי': { lat: 34.44, lon: 35.83 },
    'נבטייה': { lat: 33.38, lon: 35.48 }, 'בנת ג\'ביל': { lat: 33.12, lon: 35.43 },
    'לבנון': { lat: 33.85, lon: 35.86 }, 'דרום לבנון': { lat: 33.30, lon: 35.30 },
    'עמק הבקעה': { lat: 33.85, lon: 36.08 }, 'בקעת לבנון': { lat: 33.85, lon: 36.08 },
    // Iran
    'טהרן': { lat: 35.69, lon: 51.39 }, 'תהרן': { lat: 35.69, lon: 51.39 },
    'איספהאן': { lat: 32.65, lon: 51.68 }, 'אספהאן': { lat: 32.65, lon: 51.68 },
    'שיראז': { lat: 29.59, lon: 52.58 }, 'טבריז': { lat: 38.08, lon: 46.29 },
    'בנדר עבאס': { lat: 27.19, lon: 56.27 }, 'נתנז': { lat: 33.51, lon: 51.73 },
    'פורדו': { lat: 34.38, lon: 51.58 }, 'בושהר': { lat: 28.97, lon: 50.84 },
    'איראן': { lat: 32.43, lon: 53.69 }, 'אירן': { lat: 32.43, lon: 53.69 },
    // Syria
    'דמשק': { lat: 33.51, lon: 36.28 }, 'חלב': { lat: 36.20, lon: 37.16 },
    'חומס': { lat: 34.73, lon: 36.72 }, 'לטקיה': { lat: 35.52, lon: 35.78 },
    'סוריה': { lat: 34.80, lon: 38.99 }, 'דרעא': { lat: 32.62, lon: 36.10 },
    'קוניטרה': { lat: 33.13, lon: 35.82 }, 'דיר א-זור': { lat: 35.33, lon: 40.14 },
    // Yemen
    'תימן': { lat: 15.37, lon: 44.19 }, 'צנעא': { lat: 15.37, lon: 44.19 },
    'חודיידה': { lat: 14.80, lon: 42.95 }, 'חות\'ים': { lat: 15.37, lon: 44.19 },
    // Iraq
    'עיראק': { lat: 33.31, lon: 44.37 }, 'בגדד': { lat: 33.31, lon: 44.37 },
  };
  const STRIKE_KW = ['תקיפה', 'הפצצה', 'פיצוץ', 'תקף', 'הופצץ', 'פגיעה', 'תקיפת', 'הפגזה', 'תקיפו', 'הפציצו', 'חיל האוויר', 'צה"ל תקף', 'מטוסי קרב', 'F-35', 'F-16', 'מבצע', 'strike', 'airstrike'];

  // ── Known recent strikes (Israel & US) — verified GPS + event type icons ──
  const KNOWN_STRIKES: { id: string; locationName: string; lat: number; lon: number; country: string; attacker: string; description: string; date: string; verified: boolean; type: string; icon: string }[] = [
    // Lebanon strikes removed — user requested no persistent Lebanon dots
    // Iran — Israel & US strikes (verified facility coordinates)
    // Iran — Israel & US strikes (verified facility coordinates)
    { id: 'ks-tehran', locationName: 'טהרן — פרצ\'ין', lat: 35.5245, lon: 51.7625, country: 'איראן', attacker: '🇮🇱🇺🇸', description: 'תקיפת מתחם פרצ\'ין הצבאי — ח\'ראזי נהרג', date: '2026-04-01', verified: true, type: 'military', icon: '🎖️' },
    { id: 'ks-isfahan', locationName: 'איספהאן — UCF', lat: 32.6539, lon: 51.6821, country: 'איראן', attacker: '🇮🇱🇺🇸', description: 'תקיפת מתקן המרת אורניום (UCF)', date: '2026-04-01', verified: true, type: 'nuclear', icon: '☢️' },
    { id: 'ks-natanz', locationName: 'נתנז — FEP', lat: 33.7244, lon: 51.7271, country: 'איראן', attacker: '🇮🇱', description: 'תקיפת מתקן העשרת אורניום מרכזי', date: '2026-04-01', verified: true, type: 'nuclear', icon: '☢️' },
    { id: 'ks-fordo', locationName: 'פורדו — FFEP', lat: 34.8857, lon: 51.9843, country: 'איראן', attacker: '🇮🇱🇺🇸', description: 'תקיפת מתקן העשרה תת-קרקעי — בונקר באסטרס', date: '2026-04-01', verified: true, type: 'nuclear', icon: '☢️' },
    { id: 'ks-bandar', locationName: 'בנדר עבאס', lat: 27.1486, lon: 56.2808, country: 'איראן', attacker: '🇺🇸', description: 'תקיפת בסיס חיל הים — צי ארה"ב', date: '2026-04-02', verified: true, type: 'naval', icon: '⚓' },
    { id: 'ks-bushehr', locationName: 'בושהר', lat: 28.8325, lon: 50.8916, country: 'איראן', attacker: '🇺🇸', description: 'תקיפת תשתיות אנרגיה ונמל', date: '2026-04-02', verified: true, type: 'energy', icon: '⚡' },
    { id: 'ks-tabriz', locationName: 'טבריז — בסיס טילים', lat: 38.0816, lon: 46.2919, country: 'איראן', attacker: '🇮🇱', description: 'תקיפת בסיס טילים בליסטיים', date: '2026-04-01', verified: true, type: 'missile', icon: '🚀' },
    { id: 'ks-shiraz', locationName: 'שיראז — בסיס אווירי', lat: 29.5392, lon: 52.5899, country: 'איראן', attacker: '🇮🇱🇺🇸', description: 'תקיפת בסיס חיל האוויר', date: '2026-04-01', verified: true, type: 'airbase', icon: '✈️' },
  ];

  // ── IAF/US foreign strikes — combine known + telegram-detected ──
  const foreignStrikeMarkers = useMemo(() => {
    const now = Date.now();
    const strikes: { id: string; text: string; lat: number; lon: number; time: string; locationName: string; verified: boolean; verificationSources: number; attacker: string; country: string; icon: string; type: string }[] = [];
    const seenLocs = new Set<string>();

    // 1. Add known strikes (always show)
    for (const ks of KNOWN_STRIKES) {
      const ageMs = now - new Date(ks.date).getTime();
      if (ageMs > 14 * 24 * 60 * 60 * 1000) continue;
      let tgSources = 0;
      if (dataMode === 'live') {
        const shortName = ks.locationName.split('—')[0].split(',')[0].trim();
        const tgMatches = telegram.messages.filter(m => m.text && !m.is_duplicate && (m.text.includes(shortName) || m.text.includes(ks.country)));
        if (tgMatches.length > 0) tgSources = tgMatches.length;
      }
      seenLocs.add(ks.locationName);
      strikes.push({
        id: ks.id, text: ks.description, lat: ks.lat, lon: ks.lon, time: ks.date,
        locationName: ks.locationName, verified: ks.verified, verificationSources: 2 + tgSources,
        attacker: ks.attacker, country: ks.country, icon: ks.icon, type: ks.type,
      });
    }

    // 2. Add telegram-detected strikes not in known list
    if (dataMode === 'live') {
      for (const msg of telegram.messages) {
        if (!msg.text || msg.is_duplicate) continue;
        const ageMs = now - new Date(msg.created_at).getTime();
        if (ageMs > 48 * 60 * 60 * 1000) continue; // 48h
        const hasStrikeKw = STRIKE_KW.some(kw => msg.text!.includes(kw));
        if (!hasStrikeKw) continue;
        let foundLoc: { name: string; lat: number; lon: number } | null = null;
        for (const [locName, coords] of Object.entries(FOREIGN_STRIKE_LOCATIONS)) {
          if (msg.text!.includes(locName)) { foundLoc = { name: locName, ...coords }; break; }
        }
        if (!foundLoc || seenLocs.has(foundLoc.name)) continue;
        seenLocs.add(foundLoc.name);
        let sources = 1;
        const otherMsgs = telegram.messages.filter(m2 => m2.id !== msg.id && !m2.is_duplicate && m2.text && m2.text.includes(foundLoc!.name) && STRIKE_KW.some(kw => m2.text!.includes(kw)));
        if (otherMsgs.length > 0) sources++;
        if (emergencyEvents.some(e => e.title && (e.title.includes(foundLoc!.name) || (e.description && e.description.includes(foundLoc!.name))))) sources++;
        const isIsrael = msg.text!.includes('ישראל') || msg.text!.includes('צה"ל') || msg.text!.includes('חיל האוויר');
        const isUS = msg.text!.includes('ארה"ב') || msg.text!.includes('אמריק') || msg.text!.includes('US ') || msg.text!.includes('USA');
        strikes.push({
          id: `strike-${msg.id}`, text: msg.text!.slice(0, 120), lat: foundLoc.lat, lon: foundLoc.lon,
          time: msg.created_at, locationName: foundLoc.name, verified: sources >= 2, verificationSources: sources,
          attacker: isUS && isIsrael ? '🇮🇱🇺🇸' : isUS ? '🇺🇸' : '🇮🇱', country: '', icon: '💥', type: 'unknown',
        });
      }
    }

    return strikes;
  }, [dataMode, telegram.messages, emergencyEvents]);


  const prevTgMarkerCountRef = useRef(0);
  useEffect(() => {
    const impactMarkers = allTelegramMarkers.filter(m => m.isImpact);
    if (impactMarkers.length > prevTgMarkerCountRef.current && impactMarkers.length > 0) {
      const newest = impactMarkers[0]; // sorted by recency from telegram.messages
      const zoomLevel = newest.inProgress ? 16 : newest.verified ? 15 : 14;
      setFlyTo({ center: [newest.lat, newest.lon], zoom: zoomLevel });
    }
    prevTgMarkerCountRef.current = impactMarkers.length;
  }, [allTelegramMarkers]);


  // ── Launch Detection Markers — identify launches from intel/telegram and estimate impact zones ──
  const launchDetectionMarkers = useMemo(() => {
    // ── DEMO MODE: inject fake Iran multi-wave launch ──
    if (demoLaunchActive) {
      const demoStart = demoLaunchStartRef.current;
      const elapsed = Date.now() - demoStart;
      const waves: { id: string; text: string; origin: { name: string; lat: number; lon: number }; targets: { name: string; lat: number; lon: number; radiusKm: number }[]; time: string; source: string; confidence: number }[] = [];
      // Wave 1: Iran ballistic (immediate)
      waves.push({
        id: 'demo-iran-wave1',
        text: '🚨 זיהוי שיגור מסיבי — 12 טילים בליסטיים Shahab-3 / Emad מאיספהאן, איראן',
        origin: { name: 'איראן — אספהאן', lat: 32.65, lon: 51.68 },
        targets: [
          { name: 'תל אביב', lat: 32.08, lon: 34.78, radiusKm: 15 },
          { name: 'ירושלים', lat: 31.77, lon: 35.21, radiusKm: 10 },
          { name: 'דימונה', lat: 31.07, lon: 35.03, radiusKm: 8 },
        ],
        time: new Date(demoStart).toISOString(),
        source: 'מודיעין לוויני',
        confidence: 98,
      });
      // Wave 2: Iran second salvo (after 30s)
      if (elapsed > 30000) {
        waves.push({
          id: 'demo-iran-wave2',
          text: '🚨 גל שני — 8 טילי Emad מטביז, איראן',
          origin: { name: 'איראן — טביז', lat: 38.07, lon: 46.29 },
          targets: [
            { name: 'חיפה', lat: 32.79, lon: 34.99, radiusKm: 10 },
            { name: 'נבטים', lat: 31.21, lon: 34.93, radiusKm: 8 },
          ],
          time: new Date(demoStart + 30000).toISOString(),
          source: 'CENTCOM Early Warning',
          confidence: 95,
        });
      }
      // Wave 3: Iraq militia (after 60s)
      if (elapsed > 60000) {
        waves.push({
          id: 'demo-iraq-wave3',
          text: '⚠️ שיגור משלים — 4 טילי Fateh-313 ממיליציות עיראק',
          origin: { name: 'מיליציות עיראק', lat: 33.30, lon: 44.37 },
          targets: [
            { name: 'מרכז ישראל', lat: 32.08, lon: 34.78, radiusKm: 12 },
          ],
          time: new Date(demoStart + 60000).toISOString(),
          source: 'SIGINT',
          confidence: 88,
        });
      }
      // Filter out waves that completed their lifecycle (flight + 5min buffer)
      const demoElapsed = Date.now() - demoStart;
      const activeWaves = waves.filter(w => {
        const waveStart = new Date(w.time).getTime() - demoStart;
        const flightSec = w.origin.name.includes('איראן') ? 720 : w.origin.name.includes('עיראק') ? 600 : 45;
        const totalLifecycleMs = (flightSec + 300) * 1000;
        const waveElapsed = demoElapsed - (new Date(w.time).getTime() - demoStart);
        return waveElapsed < totalLifecycleMs;
      });
      return activeWaves;
    }
    // Live mode: only process when live
    if (dataMode !== 'live') return [];
    const now = Date.now();
    const LAUNCH_KW = ['שיגור מאיראן', 'שיגור מתימן', 'שיגור מעיראק', 'שיגור מלבנון לעומק', 'שיגור בליסטי לעבר ישראל', 'מטח טילים בליסטיים', 'מטח מאיראן', 'טעינת משגרים', 'העמסת משגרים', 'שיגור טילים בליסטיים', 'שיגור טילי שיוט', 'إطلاق باليستي نحو إسرائيل', 'إطلاق صاروخي من إيران', 'Ballistic launch toward Israel', 'Launch detected from Iran', 'Launch detected from Yemen', 'ICBM launch', 'shahab', 'emad', 'שהאב'];
    const ORIGIN_PATTERNS: { keywords: string[]; origin: { name: string; lat: number; lon: number }; targets: { name: string; lat: number; lon: number; radiusKm: number }[] }[] = [
      {
        keywords: ['איראן', 'iran', 'إيران', 'טהרן', 'שהאב', 'shahab', 'emad', 'IRGC'],
        origin: { name: 'איראן', lat: 32.65, lon: 51.68 },
        targets: [
          { name: 'מרכז ישראל', lat: 32.08, lon: 34.78, radiusKm: 15 },
          { name: 'ירושלים', lat: 31.77, lon: 35.21, radiusKm: 10 },
          { name: 'דימונה', lat: 31.07, lon: 35.03, radiusKm: 8 },
        ],
      },
      {
        keywords: ['לבנון', 'חיזבאללה', 'hezbollah', 'حزب الله', 'נסראללה'],
        origin: { name: 'דרום לבנון', lat: 33.30, lon: 35.48 },
        targets: [
          { name: 'צפון ישראל', lat: 32.97, lon: 35.50, radiusKm: 5 },
          { name: 'חיפה', lat: 32.79, lon: 34.99, radiusKm: 8 },
        ],
      },
      {
        keywords: ['תימן', 'חות\'י', 'houthi', 'حوثي', 'yemen'],
        origin: { name: 'תימן', lat: 15.35, lon: 44.21 },
        targets: [
          { name: 'אילת', lat: 29.56, lon: 34.95, radiusKm: 10 },
          { name: 'מרכז', lat: 32.08, lon: 34.78, radiusKm: 15 },
        ],
      },
      {
        keywords: ['עיראק', 'iraq', 'عراق', 'מיליציות'],
        origin: { name: 'עיראק', lat: 33.30, lon: 44.37 },
        targets: [
          { name: 'מרכז ישראל', lat: 32.08, lon: 34.78, radiusKm: 12 },
        ],
      },
    ];

    const detections: { id: string; text: string; origin: { name: string; lat: number; lon: number }; targets: { name: string; lat: number; lon: number; radiusKm: number }[]; time: string; source: string; confidence: number }[] = [];
    const seenOrigins = new Set<string>();

    // Helper: get flight time for an origin to determine lifecycle
    const getFlightTimeForOrigin = (originName: string): number => {
      if (originName.includes('איראן')) return MISSILE_SOURCES.find(s => s.id === 'iran')?.flightTimeSec || 720;
      if (originName.includes('לבנון')) return MISSILE_SOURCES.find(s => s.id === 'lebanon_hzb')?.flightTimeSec || 45;
      if (originName.includes('תימן')) return MISSILE_SOURCES.find(s => s.id === 'houthis')?.flightTimeSec || 900;
      if (originName.includes('עיראק')) return MISSILE_SOURCES.find(s => s.id === 'iraq_militia')?.flightTimeSec || 600;
      return 720;
    };

    // Scan telegram
    for (const msg of telegram.messages) {
      if (!msg.text || msg.is_duplicate) continue;
      const age = now - new Date(msg.created_at).getTime();
      if (age > 6 * 60 * 60 * 1000) continue;
      const textLower = msg.text.toLowerCase();
      const hasLaunchKw = LAUNCH_KW.some(kw => textLower.includes(kw.toLowerCase()));
      if (!hasLaunchKw) continue;

      for (const pattern of ORIGIN_PATTERNS) {
        if (seenOrigins.has(pattern.origin.name)) continue;
        if (pattern.keywords.some(kw => textLower.includes(kw.toLowerCase()))) {
          seenOrigins.add(pattern.origin.name);
          const matchCount = LAUNCH_KW.filter(kw => textLower.includes(kw.toLowerCase())).length;
          detections.push({
            id: `launch-tg-${msg.id}`,
            text: msg.text.slice(0, 150),
            origin: pattern.origin,
            targets: pattern.targets,
            time: msg.created_at,
            source: 'טלגרם',
            confidence: Math.min(95, 50 + matchCount * 15),
          });
        }
      }
    }

    // Scan intel reports
    for (const report of (mergedIntelReports || [])) {
      const text = `${report.title} ${report.summary}`.toLowerCase();
      const hasLaunchKw = LAUNCH_KW.some(kw => text.includes(kw.toLowerCase()));
      if (!hasLaunchKw) continue;

      for (const pattern of ORIGIN_PATTERNS) {
        if (seenOrigins.has(pattern.origin.name)) continue;
        if (pattern.keywords.some(kw => text.includes(kw.toLowerCase()))) {
          seenOrigins.add(pattern.origin.name);
          detections.push({
            id: `launch-intel-${report.id}`,
            text: report.title.slice(0, 150),
            origin: pattern.origin,
            targets: pattern.targets,
            time: report.created_at,
            source: 'מודיעין',
            confidence: Math.min(90, 40 + 20),
          });
        }
      }
    }

    // Filter out detections that have completed their full lifecycle (flight + 5min buffer = CLEAR)
    const activeDetections = detections.filter(det => {
      const flightSec = getFlightTimeForOrigin(det.origin.name);
      const totalLifecycleSec = flightSec + 300; // flight + 5 min release/clear buffer
      const elapsedSec = (now - new Date(det.time).getTime()) / 1000;
      return elapsedSec < totalLifecycleSec;
    });

    return activeDetections;
  }, [dataMode, demoLaunchActive, telegram.messages, mergedIntelReports, countdownTick]);

  const _buildNavEvents = useCallback(() => {
    if (dataMode !== 'live') return []; // No fake events in demo mode
    const navEvents: { id: string; label: string; lat: number; lon: number; icon: string; color: string; type: 'mci' | 'impact' | 'emergency'; severity?: string; mci?: any; timestamp: number; status: string; reports: string[]; zoom: number }[] = [];
    const seenCoords = new Map<string, number>(); // key → index in navEvents
    const addOrMerge = (evt: typeof navEvents[0]) => {
      // Dedup by ~1km grid
      const key = `${evt.lat.toFixed(2)},${evt.lon.toFixed(2)}`;
      const existingIdx = seenCoords.get(key);
      if (existingIdx !== undefined) {
        // Merge reports into existing, keep higher-priority entry
        const existing = navEvents[existingIdx];
        for (const r of evt.reports) {
          if (!existing.reports.includes(r)) existing.reports.push(r);
        }
        if (evt.timestamp > existing.timestamp) existing.timestamp = evt.timestamp;
        return;
      }
      seenCoords.set(key, navEvents.length);
      navEvents.push(evt);
    };

    const now = Date.now();

    // 1. MCI events (correlated multi-source)
    for (const mci of mciEvents) {
      const isMCI = mci.severity === 'mci';
      const isVerified = mci.severity === 'verified';
      const statusLabel = isMCI ? 'רב-נפגעים' : isVerified ? 'מאומת' : 'אירוע משולב';
      const reports = mci.sources.map(s => `${s.icon} ${s.title}`);
      addOrMerge({
        id: `mci-${mci.city}`, label: `${isMCI ? '🚨' : isVerified ? '✅' : '⚠️'} ${mci.city}`,
        lat: mci.lat, lon: mci.lon, icon: isMCI ? '🚨' : isVerified ? '✅' : '⚠️',
        color: isMCI ? '#ff1744' : isVerified ? '#00e676' : '#ff6d00', type: 'mci', severity: mci.severity, mci,
        timestamp: mci.newestTime, status: statusLabel, reports, zoom: isMCI ? 15 : 14,
      });
    }

    // 2. Oref alerts — one entry per resolved base city, aggregate reports
    const orefWindow = 6 * 60 * 60 * 1000;
    const orefByCity = new Map<string, { gps: { lat: number; lon: number }; alertTime: number; reports: string[]; alertId: string; isAlarm: boolean }>();
    for (const a of orefAlerts) {
      const t = (a.title || '');
      if (t.includes('שחרור') || t.includes('הותר')) continue;
      const alertTime = new Date(a.alert_date).getTime();
      if (now - alertTime > orefWindow) continue;
      // Alarm = rockets/missiles/drones; Warning = everything else (earthquake, tsunami, hazmat etc.)
      const isAlarm = /רקטות|טילים|כלי טיס|חדירה|מחבלים|ירי/.test(t);
      for (const loc of (a.locations || []) as string[]) {
        const trimmed = loc.trim();
        let gps: { lat: number; lon: number } | null = null;
        let baseName = trimmed;
        if (CITY_GPS_LOOKUP[trimmed]) { gps = CITY_GPS_LOOKUP[trimmed]; baseName = trimmed; }
        else {
          for (const [cityName, coords] of Object.entries(CITY_GPS_LOOKUP)) {
            if (trimmed.includes(cityName) || cityName.includes(trimmed)) {
              gps = coords; baseName = cityName;
              break;
            }
          }
        }
        if (!gps) {
          const region = REGIONS.find(r => r.name === trimmed || trimmed.includes(r.name) || r.name.includes(trimmed));
          if (region) { gps = { lat: region.lat, lon: region.lon }; baseName = region.name; }
        }
        if (!gps) continue;
        const existing = orefByCity.get(baseName);
        if (existing) {
          if (alertTime > existing.alertTime) existing.alertTime = alertTime;
          if (isAlarm) existing.isAlarm = true; // escalate to alarm if any sub-alert is alarm
          if (!existing.reports.includes(`🚨 ${t}`)) existing.reports.push(`🚨 ${t}`);
        } else {
          orefByCity.set(baseName, { gps, alertTime, reports: [`🚨 ${t}`], alertId: a.id, isAlarm });
        }
      }
    }
    for (const [baseName, data] of orefByCity) {
      const alarmColor = '#ff1744'; // bright red
      const warnColor = '#ff9100';  // orange
      const color = data.isAlarm ? alarmColor : warnColor;
      const icon = data.isAlarm ? '🚨' : '⚠️';
      const status = data.isAlarm ? 'אזעקה' : 'התראה';
      addOrMerge({ id: `oref-${data.alertId}-${baseName}`, label: `${icon} ${baseName}`, lat: data.gps.lat, lon: data.gps.lon, icon, color, type: 'mci',
        timestamp: data.alertTime, status, reports: data.reports, zoom: data.isAlarm ? 15 : 14 });
    }

    // 3. Telegram impacts
    for (const imp of telegramImpacts) {
      if (!imp.lat || !imp.lon) continue;
      addOrMerge({ id: `imp-${imp.text.slice(0,10)}`, label: `${imp.icon} ${imp.label}`, lat: imp.lat, lon: imp.lon, icon: imp.icon, color: imp.color, type: 'impact',
        timestamp: typeof imp.time === 'number' ? imp.time : (imp.time ? new Date(imp.time).getTime() : now), status: imp.credibility === 'verified' ? 'מאומת' : 'דיווח ראשוני', reports: [`📨 ${imp.text.slice(0, 60)}`], zoom: imp.credibility === 'verified' ? 16 : 14 });
    }

    // 4. Emergency events — all recent ones with location (6h window)
    const sixHours = 6 * 60 * 60 * 1000;
    for (const evt of emergencyEvents) {
      if (!evt.lat || !evt.lon) continue;
      const evtTime = new Date(evt.event_time || evt.created_at).getTime();
      if (now - evtTime > sixHours) continue;
      // Determine event type icon
      const evtText = `${evt.title || ''} ${evt.description || ''} ${evt.source || ''}`;
      const isFire = /שריפ|דליק|כיבוי|לכוד|עשן|בערה|כבא/i.test(evtText);
      const isPolice = /משטרה|ירי|קטטה|פיגוע|שוד|חשוד|דקירה|פריצה|נורה|אלימות/i.test(evtText);
      const isTraffic = /תאונת?\s*דרכים|רב.רכבית|כביש|מחלף|התנגש|התהפך/i.test(evtText);
      const isMda = /מד["״']?א|אמבולנס|פצוע|נפגע|פונה|פינוי|החייאה/i.test(evtText);
      const isOref = evt.source === 'oref_realtime';
      const isNews = (evt.source || '').startsWith('news_');
      const typeIcon = isOref ? '🚨' : isFire ? '🚒' : isPolice ? '🚔' : isTraffic ? '🚗' : isMda ? '🚑' : isNews ? '📰' : '⚡';
      const typeLabel = isOref ? 'פיקוד העורף' : isFire ? 'כיבוי אש' : isPolice ? 'משטרה' : isTraffic ? 'תנועה' : isMda ? 'מד"א' : isNews ? 'חדשות' : 'אירוע';
      const evtColor = evt.color === 'red' ? '#ff1744' : evt.color === 'orange' ? '#ff6d00' : isPolice ? '#2196f3' : isFire ? '#ff6d00' : '#00e676';
      // Count verification sources
      const verifications = [
        isOref ? 'OREF' : null,
        isNews ? evt.source?.replace('news_', '').toUpperCase() : null,
        evt.score >= 5 ? 'HIGH_SCORE' : null,
      ].filter(Boolean).length;
      const verLabel = verifications >= 2 ? `✅ ${verifications} אימותים` : verifications === 1 ? '⚠️ מקור יחיד' : '❓ לא מאומת';
      addOrMerge({ id: evt.id, label: `${typeIcon} ${typeLabel}: ${evt.title.slice(0, 30)}`, lat: evt.lat, lon: evt.lon, icon: typeIcon, color: evtColor, type: 'emergency',
        timestamp: evtTime, status: `${typeLabel} | ${verLabel}`, reports: [`${typeIcon} ${evt.title}`, `🔎 ${verLabel}`], zoom: 13 });
    }

    // 5. Telegram markers (impact events)
    for (const m of allTelegramMarkers) {
      if (!m.isImpact) continue;
      const statusIcon = m.inProgress ? '🟢' : m.verified ? '🟡' : '⚪';
      const statusLabel = m.inProgress ? 'בטיפול' : m.verified ? 'מאומת' : 'טלגרם';
      addOrMerge({ id: `tg-nav-${m.id}`, label: `${statusIcon} ${m.locationName} — ${statusLabel}`, lat: m.lat, lon: m.lon, icon: statusIcon, color: m.inProgress ? '#00e676' : m.verified ? '#ffd740' : '#9e9e9e', type: 'impact',
        timestamp: typeof m.time === 'number' ? m.time : (m.time ? new Date(m.time).getTime() : now), status: statusLabel, reports: [`📨 ${(m.text || '').slice(0, 60)}`], zoom: m.inProgress ? 16 : 14 });
    }

    // Sort newest first — event #1 = most recent
    navEvents.sort((a, b) => b.timestamp - a.timestamp);
    return navEvents;
  }, [dataMode, mciEvents, orefAlerts, telegramImpacts, emergencyEvents, allTelegramMarkers]);

  // ── Dynamic missile targets from real Oref alert locations ──
  const orefDynamicTargets = useMemo(() => {
    if (dataMode !== 'live') return new Map<string, { lat: number; lon: number; name: string; distKm: number }[]>();
    const now = Date.now();
    // Collect all active alert locations (< 10 min, non-released)
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

    const activeLocations: { name: string; lat: number; lon: number }[] = [];
    const seenLocs = new Set<string>();

    for (const a of orefAlerts) {
      const t = (a.title || '');
      if (t.includes('שחרור') || t.includes('הותר')) continue;
      const alertTime = new Date(a.alert_date).getTime();
      if (now - alertTime > 600000) continue;

      for (const loc of (a.locations || []) as string[]) {
        const trimmed = loc.trim();
        const relTime = releaseMap.get(trimmed) || 0;
        if (relTime > alertTime) continue;
        if (seenLocs.has(trimmed)) continue;
        seenLocs.add(trimmed);

        // Resolve GPS
        let gps: { lat: number; lon: number } | null = null;
        if (CITY_GPS_LOOKUP[trimmed]) gps = CITY_GPS_LOOKUP[trimmed];
        else {
          const region = REGIONS.find(r => r.name === trimmed || trimmed.includes(r.name) || r.name.includes(trimmed));
          if (region) gps = { lat: region.lat, lon: region.lon };
          else {
            // Try substring match
            for (const [cityName, coords] of Object.entries(CITY_GPS_LOOKUP)) {
              if (trimmed.includes(cityName) || cityName.includes(trimmed)) {
                gps = coords;
                break;
              }
            }
          }
        }
        if (gps) activeLocations.push({ name: trimmed, ...gps });
      }
    }

    // Determine which missile source by geographic region of each target
    const sourceTargets = new Map<string, { lat: number; lon: number; name: string; distKm: number }[]>();

    for (const loc of activeLocations) {
      // Classify by latitude/longitude which source fires at this location
      let sourceId: string;
      if (loc.lat > 32.5) {
        sourceId = 'lebanon_hzb'; // North
      } else if (loc.lat < 31.6 && loc.lon < 34.7) {
        sourceId = 'gaza_hamas'; // Gaza envelope / south
      } else if (loc.lat < 30.0) {
        sourceId = 'houthis'; // Eilat / far south
      } else {
        // Center — could be Iran or Gaza long range
        sourceId = loc.lat < 31.6 ? 'gaza_hamas' : 'iran';
      }

      const src = MISSILE_SOURCES.find(s => s.id === sourceId);
      if (!src) continue;
      const distKm = Math.sqrt(Math.pow((loc.lat - src.lat) * 111, 2) + Math.pow((loc.lon - src.lon) * 85, 2));

      if (!sourceTargets.has(sourceId)) sourceTargets.set(sourceId, []);
      const existing = sourceTargets.get(sourceId)!;
      // Avoid duplicate nearby targets (within 5km)
      if (existing.some(e => Math.abs(e.lat - loc.lat) < 0.05 && Math.abs(e.lon - loc.lon) < 0.05)) continue;
      existing.push({ lat: loc.lat, lon: loc.lon, name: loc.name, distKm: Math.round(distKm) });
    }

    return sourceTargets;
  }, [dataMode, orefAlerts]);

  // ── Heatmap-based missile inference from alert density ──
  const heatmapMissiles = useMemo(() => {
    if (dataMode !== 'live') return [];
    const now = Date.now();
    const southAlerts = orefAlerts.filter(a => {
      const age = now - new Date(a.alert_date).getTime();
      if (age > 600000) return false;
      const locs: string[] = a.locations || [];
      return locs.some(l => ['שדרות', 'אשקלון', 'נתיבות', 'אופקים', 'באר שבע', 'אשדוד'].some(c => l.includes(c)));
    });
    const northAlerts = orefAlerts.filter(a => {
      const age = now - new Date(a.alert_date).getTime();
      if (age > 600000) return false;
      const locs: string[] = a.locations || [];
      return locs.some(l => ['מטולה', 'קריית שמונה', 'צפת', 'נהריה', 'חיפה', 'עכו', 'כרמיאל'].some(c => l.includes(c)));
    });
    const centerAlerts = orefAlerts.filter(a => {
      const age = now - new Date(a.alert_date).getTime();
      if (age > 600000) return false;
      const locs: string[] = a.locations || [];
      return locs.some(l => ['תל אביב', 'רמת גן', 'פתח תקווה', 'ראשון לציון', 'ירושלים'].some(c => l.includes(c)));
    });

    const inferred: string[] = [];
    if (southAlerts.length >= 2) inferred.push('gaza_hamas');
    if (northAlerts.length >= 2) inferred.push('lebanon_hzb');
    if (centerAlerts.length >= 3) { inferred.push('iran'); inferred.push('iraq_militia'); }
    if (southAlerts.length + northAlerts.length + centerAlerts.length >= 8) inferred.push('houthis');

    return inferred;
  }, [dataMode, orefAlerts]);


  const activeMissiles = useMemo(() => {
    if (dataMode === 'live') {
      const activeIds: string[] = [];
      const hasActiveAlert = (regionIds: string[]) => regionIds.some(id => {
        const sev = liveRegionSeverities[id];
        return sev && severityRank(sev) <= severityRank('warning');
      });

      if (hasActiveAlert(['sderot', 'ashkelon', 'netivot', 'ofakim', 'ashdod', 'beer_sheva'])) activeIds.push('gaza_hamas');
      if (hasActiveAlert(['metula', 'kiryat_shmona', 'safed', 'nahariya', 'haifa', 'acre', 'karmiel', 'tiberias'])) activeIds.push('lebanon_hzb');
      if (hasActiveAlert(['tlv', 'jerusalem', 'dimona', 'beer_sheva'])) activeIds.push('iran');
      if (hasActiveAlert(['eilat']) || activeIds.length >= 3) activeIds.push('houthis');
      if (activeIds.includes('iran')) activeIds.push('iraq_militia');

      for (const hm of heatmapMissiles) {
        if (!activeIds.includes(hm)) activeIds.push(hm);
      }

      // Also activate sources from dynamic Oref targets
      Array.from(orefDynamicTargets.keys()).forEach(srcId => {
        if (!activeIds.includes(srcId)) activeIds.push(srcId);
      });

      // Build missiles with REAL Oref targets replacing/extending predefined ones
      return MISSILE_SOURCES.filter(s => activeIds.includes(s.id)).map(s => {
        const dynamicTargets = orefDynamicTargets.get(s.id) || [];
        // Use dynamic targets if available, otherwise fall back to predefined filtered targets
        if (dynamicTargets.length > 0) {
          return { ...s, targets: dynamicTargets.slice(0, 5) }; // cap at 5 trajectories per source
        }
        // Fallback: filter predefined targets to only those with active alerts
        return {
          ...s,
          targets: s.targets.filter(t => {
            const matchRegion = REGIONS.find(r => r.name === t.name);
            if (!matchRegion) return true;
            const sev = liveRegionSeverities[matchRegion.id];
            return sev && severityRank(sev) <= severityRank('warning');
          }),
        };
      }).filter(s => s.targets.length > 0);
    }
    const active = SCENARIO_MISSILES[demoScenario];
    return MISSILE_SOURCES.filter(s => active.includes(s.id));
  }, [demoScenario, dataMode, liveRegionSeverities, orefAlerts, heatmapMissiles, orefDynamicTargets]);

  // Click region
  const handleRegionClick = useCallback((region: MapRegion) => {
    setSelectedRegion(prev => prev?.id === region.id ? null : region);
    setFlyTo({ center: [region.lat, region.lon], zoom: 10 });
  }, []);

  const handleMapDblClick = useCallback((lat: number, lon: number, currentZoom: number) => {
    const maxZoom = 18;
    const targetZoom = Math.min(maxZoom, currentZoom + (maxZoom - currentZoom) * 0.5);
    setFlyTo(null);
    setTimeout(() => setFlyTo({ center: [lat, lon], zoom: Math.round(targetZoom * 10) / 10 }), 50);
  }, []);

  return (
    <div ref={containerRef} id="main-content" role="main" aria-label="מפה טקטית - מערכת אזהרה מוקדמת" className={`relative w-full overflow-hidden hud-scanline hud-grid-bg ${(isEmergencyActive || isDemoWarActive) ? 'ring-4 ring-war-red/60 ring-inset' : ''}`} style={{ background: 'hsl(210,25%,3%)', height: '100dvh' }}>
      {/* ═══ FLIGHT MONITOR FLOATING BUTTON + OVERLAY ═══ */}
      <button
        onClick={() => setFlightMonitorOpen(true)}
        title="לוח טיסות חי"
        className="absolute z-[2400] pointer-events-auto"
        style={{
          bottom: 86, right: 16,
          width: 44, height: 44, borderRadius: '50%',
          background: 'rgba(0,229,255,0.12)',
          border: '1px solid rgba(0,229,255,0.45)',
          color: '#00e5ff', fontSize: 20, cursor: 'pointer',
          backdropFilter: 'blur(8px)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        }}
      >
        ✈️
      </button>
      {flightMonitorOpen && (
        <div
          className="absolute inset-0 z-[3000] pointer-events-auto"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
          onClick={() => setFlightMonitorOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', inset: '4vh 4vw', overflow: 'auto',
              borderRadius: 14, border: '1px solid #112233',
              boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
            }}
          >
            <button
              onClick={() => setFlightMonitorOpen(false)}
              style={{
                position: 'absolute', top: 12, left: 16, zIndex: 10,
                background: 'rgba(255,255,255,0.06)', border: '1px solid #112233',
                color: '#00e5ff', fontSize: 14, cursor: 'pointer',
                width: 32, height: 32, borderRadius: '50%',
              }}
            >
              ✕
            </button>
            <FlightMonitorLazy embedded />
          </div>
        </div>
      )}

      {/* ═══ GLOBAL DATA MONITOR FLOATING BUTTON + OVERLAY ═══ */}
      <button
        onClick={() => setGlobalMonitorOpen(true)}
        title="Global Monitor — אירועי עולם"
        className="absolute z-[2400] pointer-events-auto"
        style={{
          bottom: 138, right: 16,
          width: 44, height: 44, borderRadius: '50%',
          background: 'rgba(176,64,255,0.12)',
          border: '1px solid rgba(176,64,255,0.45)',
          color: '#b040ff', fontSize: 20, cursor: 'pointer',
          backdropFilter: 'blur(8px)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        }}
      >
        🌐
      </button>
      {globalMonitorOpen && (
        <div
          className="absolute inset-0 z-[3000] pointer-events-auto"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
          onClick={() => setGlobalMonitorOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', inset: '4vh 4vw', overflow: 'auto',
              borderRadius: 14, border: '1px solid #112233',
              boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
            }}
          >
            <button
              onClick={() => setGlobalMonitorOpen(false)}
              style={{
                position: 'absolute', top: 12, left: 16, zIndex: 10,
                background: 'rgba(255,255,255,0.06)', border: '1px solid #112233',
                color: '#b040ff', fontSize: 14, cursor: 'pointer',
                width: 32, height: 32, borderRadius: '50%',
              }}
            >
              ✕
            </button>
            <GlobalDataMonitor />
          </div>
        </div>
      )}

      {/* ═══ DISASTER MONITOR FLOATING BUTTON + OVERLAY ═══ */}
      <button
        onClick={() => setDisasterMonitorOpen(true)}
        title="Disaster Monitor — אסונות טבע"
        className="absolute z-[2400] pointer-events-auto"
        style={{
          bottom: 190, right: 16,
          width: 44, height: 44, borderRadius: '50%',
          background: 'rgba(255,136,0,0.12)',
          border: '1px solid rgba(255,136,0,0.45)',
          color: '#ff8800', fontSize: 20, cursor: 'pointer',
          backdropFilter: 'blur(8px)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        }}
      >
        🌍
      </button>
      {disasterMonitorOpen && (
        <div
          className="absolute inset-0 z-[3000] pointer-events-auto"
          style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
          onClick={() => setDisasterMonitorOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', inset: '4vh 4vw', overflow: 'auto',
              borderRadius: 14, border: '1px solid #112233',
              boxShadow: '0 20px 60px rgba(0,0,0,0.7)',
            }}
          >
            <button
              onClick={() => setDisasterMonitorOpen(false)}
              style={{
                position: 'absolute', top: 12, left: 16, zIndex: 10,
                background: 'rgba(255,255,255,0.06)', border: '1px solid #112233',
                color: '#ff8800', fontSize: 14, cursor: 'pointer',
                width: 32, height: 32, borderRadius: '50%',
              }}
            >
              ✕
            </button>
            <DisasterMonitor />
          </div>
        </div>
      )}

      {/* ═══ THREAT FLASH OVERLAY — screen border flash when threat > 85 ═══ */}
      {threatFlash && (
        <div className="absolute inset-0 z-[2600] pointer-events-none" style={{
          boxShadow: 'inset 0 0 80px 20px rgba(255,23,68,0.35), inset 0 0 200px 60px rgba(255,23,68,0.15)',
          animation: 'threatFlashAnim 0.6s ease-out forwards',
        }} />
      )}
      {/* ═══ TELEGRAM INTEL TOAST — semi-transparent compact notification ═══ */}
      {tgToast && (
        <div className="absolute z-[2500] pointer-events-auto" dir="rtl"
          style={{ top: 56, left: '50%', transform: 'translateX(-50%)', maxWidth: 'min(420px, 90vw)', animation: 'tgToastIn 0.35s ease-out' }}>
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg backdrop-blur-md"
            style={{
              background: tgToast.severity === 'critical' ? 'rgba(255,23,68,0.15)' : tgToast.severity === 'high' ? 'rgba(255,109,0,0.15)' : 'rgba(255,171,0,0.12)',
              border: `1px solid ${tgToast.severity === 'critical' ? 'rgba(255,23,68,0.35)' : tgToast.severity === 'high' ? 'rgba(255,109,0,0.3)' : 'rgba(255,171,0,0.25)'}`,
              boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
            }}>
            <span className="text-base shrink-0">📨</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span style={{ fontFamily: 'Orbitron', fontSize: 7, fontWeight: 700, letterSpacing: '1px',
                  color: tgToast.severity === 'critical' ? '#ff1744' : tgToast.severity === 'high' ? '#ff6d00' : '#ffab00' }}>
                  TELEGRAM INTEL
                </span>
                <span style={{ fontFamily: 'Share Tech Mono', fontSize: 7, color: 'rgba(255,255,255,0.35)' }}>{tgToast.time}</span>
              </div>
              <p style={{ fontFamily: 'Heebo, sans-serif', fontSize: 11, fontWeight: 500, color: 'rgba(255,255,255,0.85)', lineHeight: 1.4 }}
                className="truncate">{tgToast.text}</p>
            </div>
            <button onClick={() => setTgToast(null)} className="shrink-0 px-1 text-white/30 hover:text-white/60 transition-colors"
              style={{ fontFamily: 'Share Tech Mono', fontSize: 10 }}>✕</button>
          </div>
        </div>
      )}
      <style>{`
        @keyframes tgToastIn {
          0% { opacity: 0; transform: translateX(-50%) translateY(-12px); }
          100% { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
      `}</style>
      {/* ═══ CRITICAL AI ANOMALY BANNER — compact, below toolbar, matching other banner sizes ═══ */}
      {criticalBanner && (
        <div className="absolute inset-0 z-[2500] pointer-events-none">
          <div className="absolute top-14 left-2 sm:left-3 pointer-events-auto" dir="rtl" style={{ maxWidth: 'min(220px, 34vw)' }}>
            <div
              className="rounded-sm overflow-hidden backdrop-blur-sm border border-white/8"
              style={{
                background: 'linear-gradient(135deg, rgba(255,109,0,0.35), rgba(230,81,0,0.30))',
                boxShadow: '0 2px 10px rgba(255,109,0,0.15), inset 0 0 16px rgba(255,109,0,0.04)',
                borderColor: 'rgba(255,109,0,0.15)',
                padding: '2px 5px',
                animation: 'criticalBannerSlide 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              <style>{`
                @keyframes criticalBannerSlide {
                  0% { transform: translateY(-100%); opacity: 0; }
                  100% { transform: translateY(0); opacity: 1; }
                }
              `}</style>
              <div className="flex items-center justify-between">
                <div className="font-mono text-[6px] sm:text-[8px] font-bold text-white/80 text-right" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.3)' }}>🧠 המודיעין של שולה</div>
                <div className="flex items-center gap-1">
                  <div className="font-mono text-[4px] sm:text-[6px] font-bold px-1 py-0.5 rounded-sm" style={{ background: 'rgba(255,171,64,0.20)', color: 'rgba(255,255,255,0.7)' }}>
                    ⚡ AI · {criticalBanner.time}
                  </div>
                  <button onClick={() => setCriticalBanner(null)} className="text-white/40 hover:text-white/80 transition-colors text-[8px] p-0.5">✕</button>
                </div>
              </div>
              <div className="mt-0.5">
                <div className="font-mono text-[6px] sm:text-[8px] font-bold text-white/70 leading-tight">{criticalBanner.text}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ TELEGRAM IMPACT BANNERS — top-right compact alerts — sized to match launch banner ═══ */}
      {impactBanners.length > 0 && (
        <div className="absolute right-2 top-14 z-[3000] flex flex-col items-end gap-0.5 pointer-events-none sm:top-16" dir="rtl" style={{ maxWidth: 'min(140px, 26vw)' }}>
          {impactBanners.map(b => (
            <div key={b.id} className="relative cursor-pointer overflow-hidden rounded-sm border border-white/8 backdrop-blur-md pointer-events-auto"
              onClick={() => setImpactBanners(prev => prev.map(x => x.id === b.id ? { ...x, expanded: !x.expanded } : x))}
              onMouseLeave={() => setImpactBanners(prev => prev.map(x => x.id === b.id ? { ...x, expanded: false } : x))}
              onTouchEnd={(e) => {
                // On touch devices, toggle expanded; close when touching elsewhere
                e.stopPropagation();
                setImpactBanners(prev => prev.map(x => x.id === b.id ? { ...x, expanded: !x.expanded } : x));
              }}
              style={{
                background: `linear-gradient(135deg, ${b.color}66, ${b.color}44)`,
                boxShadow: `0 1px 4px ${b.color}20`,
                padding: '1px 3px',
                animation: 'impactBannerIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
              }}
            >
              <style>{`@keyframes impactBannerIn { 0% { transform: translateX(100%); opacity: 0; } 100% { transform: translateX(0); opacity: 1; } }`}</style>
              <div className="flex items-center justify-between gap-0.5">
                <div className="flex items-center gap-0.5">
                  <span style={{ fontSize: '7px' }}>{b.icon}</span>
                  <span className="font-mono text-[5px] font-bold text-white/90" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.4)' }}>{b.label.replace(/^[^\s]+ /, '').slice(0, 12)}</span>
                </div>
                <button onClick={(e) => { e.stopPropagation(); setImpactBanners(prev => prev.filter(x => x.id !== b.id)); }} className="text-white/40 hover:text-white/80 text-[6px]">✕</button>
              </div>
              <div className="font-mono text-[4px] text-white/50 truncate">{b.location}</div>
              {b.expanded && (
                <div className="font-mono text-[5px] text-white/70 mt-0.5 whitespace-pre-wrap leading-relaxed border-t border-white/10 pt-0.5" style={{ maxHeight: '100px', overflowY: 'auto' }}>
                  <div className="text-[6px] font-bold text-white/90 mb-0.5">המודיעין של שולה — {b.label}</div>
                  <div>{b.fullText}</div>
                  <div className="text-[4px] text-white/30 mt-0.5 border-t border-white/8 pt-0.5">
                    📍 {b.location} • ⏱ {b.time}
                  </div>
                </div>
              )}
              <div className="font-mono text-[3px] text-white/25 mt-0.5 flex items-center gap-1">
                <span>{b.time}</span>
                <span>•</span>
                <span>{(() => {
                  const elapsed = Math.max(0, Math.floor((Date.now() - b.eventTime) / 60000));
                  return elapsed < 1 ? 'עכשיו' : elapsed < 60 ? `${elapsed}ד'` : `${Math.floor(elapsed / 60)}ש' ${elapsed % 60}ד'`;
                })()}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ═══ TREND POPUP — compact bottom-left card ═══ */}
      {trendPopup && (
        <div className="absolute bottom-16 left-2 z-[4000] pointer-events-auto" dir="rtl" style={{ maxWidth: 'min(240px, 36vw)' }}>
          <div className="rounded-lg overflow-hidden backdrop-blur-md border border-white/15"
            style={{
              background: 'linear-gradient(135deg, rgba(255,109,0,0.75), rgba(230,81,0,0.70))',
              boxShadow: '0 4px 20px rgba(255,109,0,0.3)',
              animation: 'criticalBannerSlide 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
              padding: '6px 10px',
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1">
                <span className="text-sm animate-pulse">📊</span>
                <span className="font-mono text-[8px] font-black text-white tracking-wider">מגמה קיצונית</span>
              </div>
              <button onClick={() => setTrendPopup(null)} className="text-white/40 hover:text-white/80 text-xs transition-colors">✕</button>
            </div>
            <div className="font-mono text-[8px] font-bold text-white/90 leading-snug line-clamp-2">{trendPopup.text}</div>
            <div className="flex items-center justify-between mt-1">
              <span className="font-mono text-[6px] text-white/40">{trendPopup.time}</span>
              <span className="font-mono text-[6px] text-white/50 animate-pulse">⚠ נדרשת תשומת לב</span>
            </div>
          </div>
        </div>
      )}

      {/* Mobile emergency takeover removed — alert triggers zoom only */}

      {/* Emergency / Demo overlay — left-side compact banners */}
      {showAlertBanners && (
        <div className="absolute inset-0 z-[2000] pointer-events-none" role="alert" aria-live="assertive" aria-label="מצב חירום פעיל - היכנסו למרחב מוגן" style={{ background: isEmergencyActive ? 'radial-gradient(ellipse at center, transparent 60%, rgba(255,23,68,0.04) 100%)' : 'none' }}>
          {/* Left-side alert panel */}
          <div className="absolute top-16 left-2 sm:left-3 pointer-events-auto flex flex-col gap-0.5 sm:gap-1 max-h-[calc(100vh-80px)] overflow-y-auto" dir="rtl" style={{ maxWidth: 'min(160px, 24vw)', opacity: 0.65 }}>

            {/* "Event ended" banner — auto-dismisses after 60 seconds */}
            {showEventEnded && (
              <div className="rounded-md overflow-hidden backdrop-blur-md" style={{
                background: 'linear-gradient(135deg, rgba(76,175,80,0.35), rgba(56,142,60,0.35))',
                boxShadow: '0 1px 8px rgba(76,175,80,0.1)',
                padding: '2px 6px',
              }}>
                <div className="font-mono text-[7px] sm:text-[8px] font-bold text-white/75 text-center">✅ הארוע הסתיים</div>
                <div className="font-mono text-[5px] sm:text-[6px] text-white/40 text-center font-medium">אין ארועים פתוחים</div>
              </div>
            )}

            {/* Per-region countdown cards */}
            {allCountdownBanners.filter(rc => {
              const elapsedParts = rc.elapsedStr.split(':').map(Number);
              const elapsedTotalSec = (elapsedParts[0] || 0) * 60 + (elapsedParts[1] || 0);
              return !(rc.shelterExpired && elapsedTotalSec > 240);
            }).map(rc => {
              const phase1 = !rc.shelterExpired;
              const bannerColors: Record<string, { bg1: string; bg2: string; shadow: string; accent: string; text: string; label: string }> = {
                early_warning: { bg1: 'rgba(255,145,0,0.45)', bg2: 'rgba(230,81,0,0.45)', shadow: 'rgba(255,145,0,0.25)', accent: '#ffd180', text: '#fff3e0', label: '⏳ התראה מוקדמת' },
                critical:      { bg1: 'rgba(255,23,68,0.45)', bg2: 'rgba(183,28,28,0.45)', shadow: 'rgba(255,23,68,0.25)', accent: '#ff8a80', text: '#ffcdd2', label: '🚨 אזעקה פעילה' },
                high:          { bg1: 'rgba(255,61,0,0.45)', bg2: 'rgba(221,44,0,0.45)', shadow: 'rgba(255,61,0,0.25)', accent: '#ff9e80', text: '#ffccbc', label: '🔴 איום גבוה' },
                warning:       { bg1: 'rgba(255,109,0,0.40)', bg2: 'rgba(230,81,0,0.40)', shadow: 'rgba(255,109,0,0.2)', accent: '#ffab40', text: '#ffe0b2', label: '⚠ אזהרה' },
                medium:        { bg1: 'rgba(255,171,0,0.35)', bg2: 'rgba(255,143,0,0.35)', shadow: 'rgba(255,171,0,0.15)', accent: '#ffe57f', text: '#fff8e1', label: '📡 ניטור' },
              };
              const bc = bannerColors[rc.severity] || bannerColors.critical;

              return (
                <div key={rc.key} className="rounded-md overflow-hidden backdrop-blur-md border border-white/8" style={{
                  background: `linear-gradient(135deg, ${bc.bg1}, ${bc.bg2})`,
                  boxShadow: `0 1px 8px ${bc.shadow}`,
                  padding: '2px 5px',
                  borderColor: `${bc.accent}20`,
                }}>
                  <div className="flex items-center justify-between">
                    <div className="font-mono text-[6px] sm:text-[7px] font-extrabold text-white text-right" style={{ textShadow: '0 1px 3px rgba(0,0,0,0.4)' }}>
                      {[...new Set(rc.locations)].join(', ')}
                    </div>
                    <div className="font-mono text-[4px] sm:text-[5px] font-bold px-1 py-0.5 rounded-sm" style={{ background: `${bc.accent}25`, color: bc.text }}>
                      {bc.label}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-1 mt-0.5">
                    {phase1 ? (
                      <>
                        <div className="flex flex-col">
                          <div className="font-mono text-[4px] font-bold" style={{ color: `${bc.text}70` }}>⏱ זמן עד אזעקה</div>
                          <div className="font-mono text-[11px] sm:text-[14px] font-black text-white tabular-nums leading-none" style={{ textShadow: `0 0 10px ${bc.shadow}` }}>{rc.countdownStr}</div>
                        </div>
                        <div className="flex flex-col items-end">
                          <div className="font-mono text-[4px] font-bold" style={{ color: `${bc.text}50` }}>מיגון</div>
                          <div className="font-mono text-[7px] sm:text-[8px] font-bold" style={{ color: bc.accent }}>{rc.shelterSec}״</div>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="flex flex-col">
                          <div className="font-mono text-[4px] font-bold" style={{ color: `${bc.text}70` }}>זמן מאז האזעקה</div>
                          <div className="font-mono text-[11px] sm:text-[14px] font-black text-white tabular-nums leading-none animate-pulse" style={{ textShadow: `0 0 10px ${bc.shadow}` }}>+{rc.elapsedStr}</div>
                        </div>
                        <div className="flex flex-col items-end">
                          <div className="font-mono text-[4px] font-bold" style={{ color: `${bc.text}50` }}>⚠ חלף</div>
                          <div className="font-mono text-[6px] font-bold" style={{ color: bc.accent }}>היכנסו למיגון!</div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            {/* ── Threat Legend (moved here from bottom-left) ── */}
            {showTrajectories && activeMissiles.length > 0 && (
              <div
                className="backdrop-blur-xl border rounded-md max-w-[160px] pointer-events-auto"
                style={{
                  padding: '5px 7px',
                  background: 'linear-gradient(135deg, rgba(183,28,28,0.6), rgba(120,20,20,0.5))',
                  boxShadow: '0 2px 12px rgba(255,23,68,0.2), inset 0 1px 0 rgba(255,255,255,0.08)',
                  borderColor: 'rgba(255,23,68,0.35)',
                  animation: 'threat-breathe 2s ease-in-out infinite',
                }}
              >
                <style>{`
                  @keyframes threat-breathe {
                    0%, 100% { opacity: 1; border-color: rgba(255,23,68,0.5); box-shadow: 0 2px 12px rgba(255,23,68,0.3), inset 0 1px 0 rgba(255,255,255,0.1); }
                    50% { opacity: 0.5; border-color: rgba(255,23,68,0.12); box-shadow: 0 1px 4px rgba(255,23,68,0.08); }
                  }
                `}</style>
                <span className="font-mono text-[6px] font-bold text-white/85 tracking-widest block mb-0.5">🎯 ACTIVE THREATS</span>
                {activeMissiles.map(src => (
                  <div key={src.id} className="flex items-center gap-1 py-px">
                    <div className="w-1 h-1 rounded-full animate-pulse" style={{ backgroundColor: src.color, boxShadow: `0 0 3px ${src.color}` }} />
                    <span className="font-mono text-[6px] font-bold text-white/85">{src.name}</span>
                    <span className="font-mono text-[5px] font-semibold text-white/45">⏱{formatFlightTime(src.flightTimeSec)}</span>
                  </div>
                ))}
              </div>
            )}

            {/* ── Interception Stats (moved here from bottom-right) ── */}
            {showTrajectories && activeMissiles.length > 0 && (() => {
              let totalLaunched = 0;
              let totalIntercepted = 0;
              let totalInFlight = 0;
              activeMissiles.forEach(src => {
                src.targets.forEach((_, ti) => {
                  totalLaunched++;
                  const p = (missileProgress + ti * 0.15) % 1;
                  if (p >= 0.82) totalIntercepted++;
                  else totalInFlight++;
                });
              });

              // Animate counters — schedule updates
              if (totalIntercepted !== prevInterceptedRef.current) {
                if (totalIntercepted > prevInterceptedRef.current) {
                  setInterceptFlash(true);
                  setTimeout(() => setInterceptFlash(false), 800);
                }
                prevInterceptedRef.current = totalIntercepted;
              }

              // Smooth animated values (lerp toward target)
              const lerp = (current: number, target: number) => {
                if (current === target) return target;
                const diff = target - current;
                return diff > 0 ? Math.min(current + 1, target) : Math.max(current - 1, target);
              };

              // Update displayed stats with animation frame scheduling
              if (displayedStats.launched !== totalLaunched || displayedStats.intercepted !== totalIntercepted || displayedStats.inFlight !== totalInFlight) {
                requestAnimationFrame(() => {
                  setDisplayedStats(prev => ({
                    launched: lerp(prev.launched, totalLaunched),
                    intercepted: lerp(prev.intercepted, totalIntercepted),
                    inFlight: lerp(prev.inFlight, totalInFlight),
                  }));
                });
              }

              const displayPct = displayedStats.launched > 0 ? Math.round((displayedStats.intercepted / displayedStats.launched) * 100) : 0;
              const pctColor = displayPct >= 90 ? '#00e676' : displayPct >= 70 ? '#ffab00' : '#ff1744';
              const flashStyle = interceptFlash ? { transform: 'scale(1.15)', transition: 'transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)' } : { transform: 'scale(1)', transition: 'transform 0.3s ease-out' };

              const barMax = Math.max(displayedStats.launched, 1);
              const interceptedW = (displayedStats.intercepted / barMax) * 100;
              const inFlightW = (displayedStats.inFlight / barMax) * 100;

              return (
                <div className="backdrop-blur-xl border rounded-md pointer-events-auto" style={{
                  padding: '4px 7px',
                  minWidth: '110px',
                  ...flashStyle,
                  background: 'linear-gradient(135deg, rgba(13,71,161,0.6), rgba(21,101,192,0.45))',
                  boxShadow: interceptFlash
                    ? '0 0 16px rgba(79,195,247,0.4), inset 0 1px 0 rgba(255,255,255,0.08)'
                    : '0 2px 10px rgba(13,71,161,0.2), inset 0 1px 0 rgba(255,255,255,0.08)',
                  borderColor: interceptFlash ? '#4fc3f760' : 'rgba(255,255,255,0.12)',
                }}>
                  {/* Header */}
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-mono text-[6px] font-bold tracking-widest text-white/60">🛡️ INTERCEPT</span>
                    <div className="flex items-baseline gap-0.5" style={flashStyle}>
                      <span className="font-mono text-[12px] font-black tabular-nums leading-none" style={{ color: pctColor, textShadow: `0 0 8px ${pctColor}50` }}>{displayPct}</span>
                      <span className="font-mono text-[6px] font-bold text-white/40">%</span>
                    </div>
                  </div>

                  {/* Bar */}
                  <div className="flex h-[4px] rounded-full overflow-hidden mb-1" style={{ background: 'rgba(255,255,255,0.08)' }}>
                    <div style={{ width: `${interceptedW}%`, background: 'linear-gradient(90deg, #4fc3f7, #00e676)', transition: 'width 0.5s ease-out', borderRadius: '2px 0 0 2px' }} />
                    <div style={{ width: `${inFlightW}%`, background: 'linear-gradient(90deg, #ff9100, #ff6d00)', transition: 'width 0.5s ease-out', boxShadow: displayedStats.inFlight > 0 ? '0 0 4px rgba(255,109,0,0.5)' : 'none' }} />
                  </div>

                  {/* Prominent result summary */}
                  <div className="text-center mb-1 py-0.5 rounded" style={{ background: 'rgba(0,0,0,0.25)', border: `1px solid ${pctColor}25` }}>
                    <span className="font-mono text-[7px] font-black" style={{ color: pctColor }}>
                      {displayedStats.intercepted}/{displayedStats.launched} יורטו
                    </span>
                    {displayedStats.inFlight > 0 && (
                      <span className="font-mono text-[6px] font-bold mr-1" style={{ color: '#ff9100' }}>
                        • {displayedStats.inFlight} באוויר
                      </span>
                    )}
                  </div>

                  {/* Compact legend */}
                  <div className="flex items-center justify-between gap-1">
                    <div className="flex items-center gap-0.5">
                      <div className="w-1 h-1 rounded-full" style={{ background: '#4fc3f7' }} />
                      <span className="font-mono text-[5px] text-white/50">יורטו</span>
                      <span className="font-mono text-[7px] font-bold tabular-nums" style={{ color: '#4fc3f7' }}>{displayedStats.intercepted}</span>
                    </div>
                    <div className="flex items-center gap-0.5">
                      <div className="w-1 h-1 rounded-full" style={{ background: '#ff9100' }} />
                      <span className="font-mono text-[5px] text-white/50">באוויר</span>
                      <span className="font-mono text-[7px] font-bold tabular-nums" style={{ color: displayedStats.inFlight > 0 ? '#ff9100' : '#4caf50' }}>{displayedStats.inFlight}</span>
                    </div>
                    <div className="flex items-center gap-0.5">
                      <div className="w-1 h-1 rounded-full" style={{ background: 'rgba(255,255,255,0.35)' }} />
                      <span className="font-mono text-[5px] text-white/50">שוגרו</span>
                      <span className="font-mono text-[7px] font-bold tabular-nums text-white/70">{displayedStats.launched}</span>
                    </div>
                   </div>

                  {/* ── Defense Layer Breakdown ── */}
                  <div className="mt-1 pt-1" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                    <span className="font-mono text-[5px] font-bold tracking-widest text-white/40 block mb-0.5">שכבות הגנה</span>
                    <div className="grid grid-cols-2 gap-x-1.5 gap-y-0.5">
                      <div className="flex items-center gap-0.5">
                        <div className="w-1 h-1 rounded-sm" style={{ background: DEFENSE_LAYER_INFO.arrow3.color }} />
                        <span className="font-mono text-[5px] text-white/60">{DEFENSE_LAYER_INFO.arrow3.icon} חץ 3</span>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <div className="w-1 h-1 rounded-sm" style={{ background: DEFENSE_LAYER_INFO.arrow2.color }} />
                        <span className="font-mono text-[5px] text-white/60">{DEFENSE_LAYER_INFO.arrow2.icon} חץ 2</span>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <div className="w-1 h-1 rounded-sm" style={{ background: DEFENSE_LAYER_INFO.patriot.color }} />
                        <span className="font-mono text-[5px] text-white/60">{DEFENSE_LAYER_INFO.patriot.icon} פטריוט</span>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <div className="w-1 h-1 rounded-sm" style={{ background: DEFENSE_LAYER_INFO.davids_sling.color }} />
                        <span className="font-mono text-[5px] text-white/60">{DEFENSE_LAYER_INFO.davids_sling.icon} קלע דוד</span>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <div className="w-1 h-1 rounded-sm" style={{ background: DEFENSE_LAYER_INFO.iron_dome.color }} />
                        <span className="font-mono text-[5px] text-white/60">{DEFENSE_LAYER_INFO.iron_dome.icon} כיפת ברזל</span>
                      </div>
                      <div className="flex items-center gap-0.5">
                        <div className="w-1 h-1 rounded-sm" style={{ background: DEFENSE_LAYER_INFO.iron_beam.color }} />
                        <span className="font-mono text-[5px] text-white/60">{DEFENSE_LAYER_INFO.iron_beam.icon} קרן ברזל</span>
                      </div>
                    </div>
                    <div className="flex justify-between mt-0.5">
                      <span className="font-mono text-[4px] text-white/30 tracking-wide">🌌 אקסו</span>
                      <span className="font-mono text-[4px] text-white/30 tracking-wide">🌍 אנדו</span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ═══ LEAFLET MAP ═══ */}
      <MapContainer
        center={[31.5, 34.9]}
        zoom={8}
        minZoom={2}
        maxZoom={19}
        className={`absolute inset-0 z-0 ${tileTheme === 'thermal' ? 'thermal-map' : ''}`}
        style={{ background: 'hsl(var(--background))' }}
        zoomControl={false}
        attributionControl={false}
        worldCopyJump={true}
      >
        {!theaterView && <FitIsraelBounds />}
        {/* Thermal: use no-labels base to avoid duplicate city names */}
        {(tileTheme === 'google' || tileTheme === 'google_satellite') ? (
          <TileLayer url={TILE_URLS[tileTheme]} subdomains={['mt0','mt1','mt2','mt3']} />
        ) : tileTheme === 'thermal' ? (
          <TileLayer url={THERMAL_BASE_URL} subdomains={['a','b','c','d']} />
        ) : tileTheme === 'satellite' ? (
          <TileLayer url={TILE_URLS.satellite} attribution='&copy; Esri' maxZoom={19} />
        ) : (
          <TileLayer url={TILE_URLS[tileTheme]} subdomains={['a','b','c','d']} />
        )}
        {tileTheme === 'satellite' && (
          <>
            <TileLayer url={BORDERS_OVERLAY} opacity={0.4} />
            <TileLayer url={LABELS_OVERLAY} opacity={0.8} />
          </>
        )}
        {tileTheme === 'thermal' && (
          <TileLayer url={BORDERS_OVERLAY} opacity={0.3} />
        )}
        <ZoomTracker onZoomChange={setMapZoom} />
        <MapCenterTracker onCenterChange={(center) => { currentMapCenterRef.current = center; }} />
        <BoundsTracker onBoundsChange={setViewBounds} />
        {showTraffic && <TileLayer url={TRAFFIC_LAYER} opacity={0.7} maxZoom={22} />}
        <MapController
          center={flyTo?.center || null}
          zoom={flyTo?.zoom || null}
          bounds={flyBounds}
          minZoom={theaterView ? FULL_THEATER_MIN_ZOOM : 2}
          boundsPadding={theaterView ? FULL_THEATER_PADDING : 60}
        />
        <MapDoubleClickZoom onDblClick={handleMapDblClick} />
        <AutoClosePopups />

        {/* ═══ Global War Zones — selectable overlay ═══ */}
        {showGlobalZonesLayer && GLOBAL_ZONES.filter(z => selectedGlobalZones.includes(z.id)).map(zone => (
          <React.Fragment key={`gz-${zone.id}`}>
            <Circle
              center={zone.center}
              radius={zone.radiusKm * 1000}
              pathOptions={{
                color: zone.color,
                fillColor: zone.color,
                fillOpacity: 0.08,
                weight: 1.5,
                dashArray: '6 6',
              }}
              interactive={false}
            />
            <Marker
              position={zone.center}
              icon={L.divIcon({
                className: '',
                html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%);pointer-events:auto;">
                  <div style="background:${zone.color};border:2px solid rgba(0,0,0,0.6);border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 0 12px ${zone.color}88;">${zone.flag}</div>
                  <div style="margin-top:4px;background:rgba(0,12,22,0.85);border:1px solid ${zone.color};border-radius:4px;padding:2px 6px;font-family:monospace;font-size:10px;font-weight:bold;color:#fff;white-space:nowrap;">${zone.name}</div>
                </div>`,
                iconSize: [0, 0],
                iconAnchor: [0, 0],
              })}
            >
              <Popup>
                <div dir="rtl" style={{ minWidth: 200, fontFamily: 'monospace' }}>
                  <div style={{ fontSize: 14, fontWeight: 'bold', color: zone.color, marginBottom: 4 }}>
                    {zone.flag} {zone.name}
                  </div>
                  <div style={{ fontSize: 11, color: '#333', marginBottom: 4 }}>{zone.desc}</div>
                  <div style={{ fontSize: 10, color: '#666' }}>
                    <strong>סטטוס:</strong> {RISK_LABEL[zone.risk]} (רמה {zone.risk}/5)
                  </div>
                  <div style={{ fontSize: 10, color: '#666' }}>
                    <strong>צדדים:</strong> {zone.parties.join(', ')}
                  </div>
                  <div style={{ fontSize: 10, color: '#666' }}>
                    <strong>רדיוס:</strong> {zone.radiusKm.toLocaleString()} ק״מ
                  </div>
                </div>
              </Popup>
            </Marker>
          </React.Fragment>
        ))}


        {/* ═══ Heatmap Layer ═══ */}
        <HeatmapLayer
          visible={showHeatmap}
          points={(() => {
            // Region-based points
            const pts: [number, number, number][] = scenarioRegions.map(r => {
              const base = ({ critical: 1, high: 0.8, warning: 0.6, medium: 0.4, low: 0.2, safe: 0.12 }[r.severity] ?? 0.1);
              const scale = r.alertCount ? Math.min(r.alertCount / 3, 2.5) : 0.6;
              return [r.lat, r.lon, Math.max(base * scale, 0.1)] as [number, number, number];
            });
            // Add dynamic alert locations (real oref alerts with GPS)
            for (const dal of dynamicAlertLocations) {
              const gps = CITY_GPS_LOOKUP[dal.name];
              if (gps) pts.push([gps.lat, gps.lon, 0.9]);
            }
            return pts;
          })()}
        />

        {/* ═══ Thermal FIRMS Heatmap — infrared gradient over satellite hotspots ═══ */}
        <ThermalFirmsHeatmap
          visible={tileTheme === 'thermal' && satelliteHotspots.length > 0}
          hotspots={satelliteHotspots}
        />

        {/* ═══ Shockwave rings on new alerts ═══ */}
        <ShockwaveLayer points={shockwavePoints} />

        {/* ═══ City polygons — Premium multi-layer EWS style ═══ */}
        {showPolygons && scenarioRegions.filter(r => r.isCity).filter(region => {
          const isCalm = region.severity === 'safe' || region.severity === 'low';
          // Zoom-dependent: calm polygons only at zoom >= 10, all active always visible
          if (isCalm && mapZoom < 10) return false;
          return true;
        }).map(region => {
          const isCalm = region.severity === 'safe' || region.severity === 'low';
          
          const isSouthRegion = region.lat < 31.25;
          const southScale = isSouthRegion ? 0.5 : 1;
          const boundary = CITY_BOUNDARIES[region.id];
          const poly: [number, number][] = boundary ? (isSouthRegion ? (() => {
            const cLat = boundary.reduce((s, p) => s + p[0], 0) / boundary.length;
            const cLon = boundary.reduce((s, p) => s + p[1], 0) / boundary.length;
            return boundary.map(([lat, lon]) => [cLat + (lat - cLat) * southScale, cLon + (lon - cLon) * southScale] as [number, number]);
          })() : boundary) : (() => {
            const kmR = Math.max(1, Math.min(4, (region.population || 20) * 0.012)) * southScale;
            const dLat = kmR / 111;
            const dLon = kmR / (111 * Math.cos(region.lat * Math.PI / 180));
            const pts = 8;
            return Array.from({ length: pts + 1 }, (_, i) => {
              const angle = (2 * Math.PI / pts) * i;
              const jitter = 0.8 + Math.sin(region.lat * 100 + i * 7) * 0.2;
              return [region.lat + dLat * jitter * Math.cos(angle), region.lon + dLon * jitter * Math.sin(angle)] as [number, number];
            });
          })();

          const sevPalette: Record<string, { primary: string; glow: string; fill: string; accent: string }> = {
            early_warning: { primary: '#ff9100', glow: '#ffab40', fill: '#e65100', accent: '#ffd180' },
            critical: { primary: '#ff1744', glow: '#ff5252', fill: '#d50000', accent: '#ff8a80' },
            high:     { primary: '#ff3d00', glow: '#ff6e40', fill: '#dd2c00', accent: '#ff9e80' },
            warning:  { primary: '#ff6d00', glow: '#ff9100', fill: '#e65100', accent: '#ffab40' },
            medium:   { primary: '#ffab00', glow: '#ffd740', fill: '#ff8f00', accent: '#ffe57f' },
            low:      { primary: '#4caf50', glow: '#66bb6a', fill: '#388e3c', accent: '#a5d6a7' },
            safe:     { primary: '#00e676', glow: '#69f0ae', fill: '#00c853', accent: '#b9f6ca' },
          };
          const pal = sevPalette[region.severity] || sevPalette.safe;
          const isEarlyWarning = region.severity === 'early_warning';
          const isCrit = region.severity === 'critical' || region.severity === 'high' || isEarlyWarning;
          const blinkSpeed = isEarlyWarning ? 6 : 2;
          const pulse = isCalm ? 0 : Math.abs(Math.sin(missileProgress * Math.PI * blinkSpeed + region.lat * 10));
          const pulse2 = isCalm ? 0 : Math.abs(Math.sin(missileProgress * Math.PI * (blinkSpeed * 1.5) + region.lon * 8));

          const expandPoly = (positions: [number, number][], factor: number): [number, number][] => {
            const cLat = positions.reduce((s, p) => s + p[0], 0) / positions.length;
            const cLon = positions.reduce((s, p) => s + p[1], 0) / positions.length;
            return positions.map(([lat, lon]) => [
              cLat + (lat - cLat) * factor,
              cLon + (lon - cLon) * factor,
            ]);
          };

          // ── CALM / ended event: subtle polygon, NO glow rings ──
          if (isCalm) {
            return (
              <React.Fragment key={`poly-${region.id}`}>
                <Polygon
                  positions={poly}
                  pathOptions={{
                    color: pal.primary,
                    fillColor: pal.fill,
                    fillOpacity: 0.08,
                    weight: 1,
                    opacity: 0.4,
                  }}
                  eventHandlers={{ click: () => handleRegionClick(region) }}
                />
              </React.Fragment>
            );
          }

          // ── ACTIVE event: full multi-layer rendering ──
          return (
            <React.Fragment key={`poly-${region.id}`}>
              {/* Layer 1-3: Glow rings */}
              <Circle
                center={[region.lat, region.lon]}
                radius={(region.population || 20) * 50 + 3500}
                pathOptions={{
                  color: pal.glow, fillColor: pal.glow,
                  fillOpacity: 0.02 + pulse * 0.03, weight: 0.5,
                  opacity: 0.15 + pulse * 0.15, dashArray: '1 8',
                }}
                interactive={false}
              />
              <Circle
                center={[region.lat, region.lon]}
                radius={((region.population || 20) * 35 + 2000) * (0.6 + pulse2 * 0.5)}
                pathOptions={{
                  color: pal.accent, fillColor: 'transparent', fillOpacity: 0,
                  weight: isCrit ? 1.5 : 0.8, opacity: 0.2 + pulse2 * 0.5, dashArray: '3 6',
                }}
                interactive={false}
              />
              <Circle
                center={[region.lat, region.lon]}
                radius={(region.population || 20) * 40 + 2500}
                pathOptions={{
                  color: pal.primary, fillColor: pal.fill,
                  fillOpacity: 0.04 + pulse * 0.06, weight: 1 + pulse * 0.8,
                  opacity: 0.3 + pulse * 0.35, dashArray: isCrit ? '4 2' : '6 4',
                }}
                interactive={false}
              />
              {/* Layer 4-5: Expanded polygon glows */}
              <Polygon
                positions={expandPoly(poly, 1.25)}
                pathOptions={{
                  color: pal.glow, fillColor: pal.glow,
                  fillOpacity: 0.03 + pulse * 0.04, weight: 0.5, opacity: 0.2 + pulse * 0.2,
                }}
                interactive={false}
              />
              <Polygon
                positions={expandPoly(poly, 1.12)}
                pathOptions={{
                  color: pal.primary, fillColor: pal.primary,
                  fillOpacity: 0.06 + pulse * 0.06, weight: 1, opacity: 0.3 + pulse * 0.25, dashArray: '2 3',
                }}
                interactive={false}
              />
              {/* Layer 6: Core polygon */}
              <Polygon
                positions={poly}
                pathOptions={{
                  color: pal.primary, fillColor: pal.fill,
                  fillOpacity: isEarlyWarning ? (0.10 + pulse * 0.35) : (isCrit ? 0.20 + pulse * 0.15 : 0.12 + pulse * 0.08),
                  weight: isEarlyWarning ? (1.5 + pulse * 2.5) : (isCrit ? 2.5 : 1.8),
                  opacity: isEarlyWarning ? (0.3 + pulse * 0.7) : (0.85 + pulse * 0.15),
                }}
                eventHandlers={{ click: () => handleRegionClick(region) }}
              >
                <Popup closeButton={false}>
                  <div className="font-mono p-2" style={{ minWidth: '180px', background: 'rgba(0,0,0,0.85)', borderRadius: '4px', border: `1px solid ${pal.primary}44` }}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ backgroundColor: pal.primary, boxShadow: `0 0 8px ${pal.glow}` }} />
                      <span className="text-sm font-bold" style={{ color: pal.primary }}>🚨 {region.name}</span>
                    </div>
                    <div className="text-[10px] mb-1.5" style={{ color: 'rgba(255,255,255,0.5)' }}>{region.nameEn} {region.population ? `• ${region.population}K pop` : ''}</div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-[9px] px-2 py-0.5 rounded-sm font-bold" style={{ background: `${pal.primary}25`, color: pal.accent, border: `1px solid ${pal.primary}40` }}>
                        {SEVERITY_LABELS[region.severity]}
                      </span>
                      {region.alertCount && region.alertCount > 0 && (
                        <span className="text-[8px] px-1.5 py-0.5 rounded-sm" style={{ background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.4)' }}>
                          {region.alertCount} alerts
                        </span>
                      )}
                    </div>
                    {region.shelterSec !== undefined && (
                      <div className="text-[9px] mt-1 flex items-center gap-1" style={{ color: region.shelterSec === 0 ? pal.primary : 'rgba(255,255,255,0.45)' }}>
                        🛡️ מיגון: <strong>{region.shelterSec === 0 ? 'מיידי!' : `${region.shelterSec} שניות`}</strong>
                      </div>
                    )}
                  </div>
                </Popup>
              </Polygon>
              {/* Layer 7: Inner highlight — center dot */}
              {isCrit && (
                <Circle
                  center={[region.lat, region.lon]}
                  radius={600 + pulse * 400}
                  pathOptions={{
                    color: pal.accent, fillColor: pal.primary,
                    fillOpacity: 0.25 + pulse * 0.2, weight: 1.5, opacity: 0.6 + pulse * 0.4,
                  }}
                  interactive={false}
                />
              )}
            </React.Fragment>
          );
        })}

        {/* ═══ Dynamic alert zones — polygon-based, zoom-aware ═══ */}
        {showPolygons && dynamicAlertLocations.map(loc => {
          const coords = CITY_GPS_LOOKUP[loc.name];
          if (!coords) return null;
          // Generate polygon boundary from GPS center — size varies by zoom
          // Settlements south of Beer Sheva (lat < 31.25) render 50% smaller
          const isSmallSettlement = !CITY_BOUNDARIES[loc.name];
          const isSouthOfBeerSheva = coords.lat < 31.25;
          const baseKmR = isSmallSettlement ? Math.max(0.3, Math.min(1.2, 0.5 + (mapZoom - 8) * 0.08)) : 2;
          const kmR = isSouthOfBeerSheva ? baseKmR * 0.5 : baseKmR;
          const dLat = kmR / 111;
          const dLon = kmR / (111 * Math.cos(coords.lat * Math.PI / 180));
          const pts = 7;
          const poly: [number, number][] = Array.from({ length: pts + 1 }, (_, i) => {
            const angle = (2 * Math.PI / pts) * i;
            const jitter = 0.85 + Math.sin(coords.lat * 137 + i * 11) * 0.15;
            return [coords.lat + dLat * jitter * Math.cos(angle), coords.lon + dLon * jitter * Math.sin(angle)] as [number, number];
          });
          // Only show small settlements at higher zoom levels
          if (isSmallSettlement && mapZoom < 10) return null;

          const isActive = loc.severity === 'early_warning' || loc.severity === 'critical' || loc.severity === 'high';
          const pulse = Math.abs(Math.sin(missileProgress * Math.PI * (loc.severity === 'early_warning' ? 6 : 2)));

          // Orange palette for active alerts
          const activePal = { fill: '#ff6d00', stroke: '#ff9100', glow: '#ffab40' };
          const calmPal = { fill: '#ff9100', stroke: '#ffab00', glow: '#ffd740' };
          const pal = isActive ? activePal : calmPal;

          const expandPoly = (positions: [number, number][], factor: number): [number, number][] => {
            const cLat = positions.reduce((s, p) => s + p[0], 0) / positions.length;
            const cLon = positions.reduce((s, p) => s + p[1], 0) / positions.length;
            return positions.map(([lat, lon]) => [cLat + (lat - cLat) * factor, cLon + (lon - cLon) * factor]);
          };

          return (
            <React.Fragment key={`dyn-poly-${loc.name}`}>
              {/* Outer glow polygon */}
              {isActive && (
                <Polygon
                  positions={expandPoly(poly, 1.4)}
                  pathOptions={{
                    color: pal.glow, fillColor: pal.glow,
                    fillOpacity: 0.03 + pulse * 0.04, weight: 0.5,
                    opacity: 0.15 + pulse * 0.2,
                  }}
                  interactive={false}
                />
              )}
              {/* Mid glow polygon */}
              {isActive && (
                <Polygon
                  positions={expandPoly(poly, 1.18)}
                  pathOptions={{
                    color: pal.stroke, fillColor: pal.stroke,
                    fillOpacity: 0.05 + pulse * 0.06, weight: 0.8,
                    opacity: 0.25 + pulse * 0.25, dashArray: '2 3',
                  }}
                  interactive={false}
                />
              )}
              {/* Core polygon — orange fill for active alerts */}
              <Polygon
                positions={poly}
                pathOptions={{
                  color: pal.stroke,
                  fillColor: pal.fill,
                  fillOpacity: isActive ? (0.15 + pulse * 0.2) : 0.06,
                  weight: isActive ? (2 + pulse * 1.5) : 1,
                  opacity: isActive ? (0.6 + pulse * 0.4) : 0.35,
                  dashArray: isActive ? undefined : '4 3',
                }}
              >
                <Popup closeButton={false}>
                  <div className="font-mono p-2" style={{ minWidth: '160px', background: 'rgba(0,0,0,0.85)', borderRadius: '4px', border: `1px solid ${pal.stroke}44` }}>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: pal.stroke, boxShadow: `0 0 6px ${pal.glow}`, animation: isActive ? 'pulse 1s infinite' : 'none' }} />
                      <span className="text-sm font-bold" style={{ color: pal.stroke }}>🚨 {loc.name}</span>
                    </div>
                    <div className="text-[9px]" style={{ color: 'rgba(255,255,255,0.5)' }}>
                      {loc.count} התראות • {loc.severity === 'early_warning' ? 'אזהרה מוקדמת' : loc.severity === 'critical' ? 'קריטי' : loc.severity === 'high' ? 'גבוה' : 'בינוני'}
                    </div>
                  </div>
                </Popup>
              </Polygon>
              {/* Label */}
              <Marker
                position={[coords.lat, coords.lon]}
                icon={L.divIcon({
                  className: '',
                  html: `<div style="font-family:'Heebo',sans-serif;font-size:${(mapZoom >= 12 ? 7.5 : 6) * (isSouthOfBeerSheva ? 0.5 : 1)}px;color:${pal.stroke};text-shadow:0 0 6px rgba(0,0,0,0.95),0 0 12px ${pal.glow}40;white-space:nowrap;transform:translate(-50%,-50%) scale(${zoomScale * (isSouthOfBeerSheva ? 0.5 : 1)});font-weight:700;letter-spacing:0.3px;">🚨 ${loc.name}</div>`,
                  iconSize: [0, 0],
                  iconAnchor: [0, 0],
                })}
              />
            </React.Fragment>
          );
        })}

        {/* ═══ Classified Impact markers — 3 levels, 2h retention, always-visible labels ═══ */}
        {telegramImpacts.filter(imp => {
          if (credibilityFilter === 'verified') return imp.credibility === 'verified';
          if (credibilityFilter === 'single_source') return imp.credibility !== 'unverified';
          return true;
        }).map((impact, i) => {
          if (!impact.lat || !impact.lon) return null;
          const pulse = Math.abs(Math.sin(missileProgress * Math.PI * 3 + i));
          // ── Time-decay: icons shrink & fade over 60 min then vanish ──
          const DECAY_DURATION = 3600000; // 60 min in ms
          const ageRatio = Math.min(impact.ageMs / DECAY_DURATION, 1); // 0→1 over 60min
          const decayScale = Math.max(0.3, 1 - ageRatio * 0.7); // 1.0 → 0.3
          const fadeOpacity = Math.max(0.15, 1 - ageRatio * 0.85); // 1.0 → 0.15
          // After 60 min — skip rendering entirely
          if (impact.ageMs > DECAY_DURATION) return null;
          const ageMins = Math.max(0, Math.floor(impact.ageMs / 60000));
          const ageLabel = ageMins < 1 ? 'עכשיו' : ageMins < 60 ? `${ageMins}ד'` : `${Math.floor(ageMins / 60)}ש' ${ageMins % 60}ד'`;
          const borderDash = impact.level === 'direct_hit' ? undefined : impact.level === 'shrapnel' ? '4 2' : '6 4';
          const weight = (impact.level === 'direct_hit' ? 2.5 : 1.5) * decayScale;

          // Credibility badge
          const credColor = impact.credibility === 'verified' ? '#00e676' : impact.credibility === 'single_source' ? '#ffd740' : '#9e9e9e';
          const credLabel = impact.credibility === 'verified' ? '✓ מאומת' : impact.credibility === 'single_source' ? '⚠ מקור יחיד' : '? לא מאומת';
          const credIcon = impact.credibility === 'verified' ? '🟢' : impact.credibility === 'single_source' ? '🟡' : '⚪';

          return (
            <React.Fragment key={`impact-${i}`}>
              {/* Radius circle — visual only */}
              <Circle
                center={[impact.lat, impact.lon]}
                radius={impact.radiusM * decayScale}
                pathOptions={{
                  color: impact.color,
                  fillColor: impact.color,
                  fillOpacity: ((impact.level === 'direct_hit' ? 0.25 : 0.15) + pulse * 0.1) * fadeOpacity,
                  weight,
                  opacity: (0.7 + pulse * 0.3) * fadeOpacity,
                  dashArray: borderDash,
                  interactive: false,
                }}
              />

              {/* Clickable marker with popup */}
              <Marker
                position={[impact.lat, impact.lon]}
                zIndexOffset={1000}
                icon={L.divIcon({
                  className: '',
                  html: `<div style="display:flex;align-items:center;gap:2px;transform:translate(-50%,-50%) scale(${decayScale});cursor:pointer;transition:transform 2s ease-out,opacity 2s ease-out;opacity:${fadeOpacity};">
                    <div style="width:${impact.level === 'direct_hit' ? 14 : 10}px;height:${impact.level === 'direct_hit' ? 14 : 10}px;border-radius:50%;background:${impact.color};border:2px solid ${impact.color}cc;box-shadow:0 0 ${impact.level === 'direct_hit' ? 12 : 6}px ${impact.color}88,0 0 ${impact.level === 'direct_hit' ? 24 : 12}px ${impact.color}44;${impact.level === 'direct_hit' && ageRatio < 0.3 ? 'animation:pulse 0.7s infinite;' : ''}flex-shrink:0;"></div>
                    <span style="font-size:${impact.level === 'direct_hit' ? 14 : 11}px;filter:drop-shadow(0 0 4px ${impact.color});line-height:1;">${impact.icon}</span>
                  </div>`,
                  iconSize: [36, 20],
                  iconAnchor: [18, 10],
                })}
              >
                <Popup closeButton={false} className="hud-popup-custom" offset={[0, -10]}>
                  <div style={{
                    fontFamily: "'Share Tech Mono', 'Orbitron', monospace",
                    background: 'linear-gradient(135deg, rgba(0,15,25,0.96), rgba(0,25,40,0.98))',
                    border: `1px solid ${impact.color}66`,
                    borderRadius: '6px',
                    padding: '10px 12px',
                    minWidth: '220px',
                    maxWidth: '280px',
                    boxShadow: `0 4px 20px rgba(0,0,0,0.6), inset 0 1px 0 ${impact.color}22, 0 0 15px ${impact.color}15`,
                    color: '#e0e0e0',
                    direction: 'rtl',
                  }}>
                    {/* Header with icon and credibility */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '16px', filter: `drop-shadow(0 0 6px ${impact.color})` }}>{impact.icon}</span>
                        <span style={{ fontSize: '12px', fontWeight: 800, color: impact.color, textShadow: `0 0 8px ${impact.color}44`, letterSpacing: '0.5px' }}>{impact.label}</span>
                      </div>
                      <span style={{
                        fontSize: '8px',
                        fontWeight: 700,
                        color: credColor,
                        background: `${credColor}18`,
                        border: `1px solid ${credColor}44`,
                        padding: '1px 5px',
                        borderRadius: '3px',
                        whiteSpace: 'nowrap',
                      }}>{credLabel}</span>
                    </div>

                    {/* Divider */}
                    <div style={{ height: '1px', background: `linear-gradient(90deg, transparent, ${impact.color}44, transparent)`, margin: '4px 0 6px' }} />

                    {/* Content */}
                    <div style={{ fontSize: '10px', color: '#b0bec5', lineHeight: '1.5', marginBottom: '6px', whiteSpace: 'pre-wrap' }}>{impact.text}</div>

                    {/* Footer */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${impact.color}22`, paddingTop: '5px' }}>
                      <span style={{ fontSize: '9px', color: '#78909c' }}>⏱ {ageLabel}</span>
                      <span style={{ fontSize: '8px', color: '#546e7a', letterSpacing: '1px' }}>📡 TELEGRAM SRC</span>
                    </div>
                  </div>
                </Popup>
              </Marker>
            </React.Fragment>
          );
        })}

        {/* ═══ Telegram All Messages Layer — gray→green markers with verification ═══ */}
        {showTelegramLayer && allTelegramMarkers.map(m => {
          const ageMs = Math.max(0, Date.now() - new Date(m.time).getTime());
          const ageMins = Math.floor(ageMs / 60000);
          const ageLabel = ageMins < 1 ? 'עכשיו' : ageMins < 60 ? `${ageMins}ד'` : `${Math.floor(ageMins / 60)}ש' ${ageMins % 60}ד'`;
          // Color & label based on verification level — amber for verified (warning), red for in-progress
          const markerColor = m.inProgress ? '#ff1744' : m.verified ? '#ffab00' : '#9e9e9e';
          const borderColor = m.inProgress ? '#d50000' : m.verified ? '#ff8f00' : '#757575';
          const statusLabel = m.inProgress ? '🔴 בטיפול' : m.verified ? '🟠 מאומת' : '⚪ טלגרם';
          const statusBadge = m.inProgress ? `${m.verificationSources} מקורות ✓` : m.verified ? `${m.verificationSources} מקורות` : 'מקור יחיד';
          const dotSize = m.inProgress ? 14 : m.verified ? 12 : 10;
          const fadeOpacity = ageMs > 14400000 ? 0.4 : m.inProgress ? 1 : 0.85;
          const pulseAnim = m.inProgress ? 'animation:pulse 1.5s infinite;' : '';
          // Skip if already shown as a telegramImpact (avoid duplicates)
          if (telegramImpacts.some(imp => Math.abs(imp.lat - m.lat) < 0.001 && Math.abs(imp.lon - m.lon) < 0.001)) return null;
          return (
            <React.Fragment key={`tg-all-${m.id}`}>
              {/* Radius circle for verified/in-progress events */}
              {m.inProgress && (
                <Circle
                  center={[m.lat, m.lon]}
                  radius={120}
                  pathOptions={{ color: '#ff1744', fillColor: '#ff1744', fillOpacity: 0.12, weight: 1.5, opacity: 0.6, interactive: false }}
                />
              )}
              {m.verified && !m.inProgress && (
                <Circle
                  center={[m.lat, m.lon]}
                  radius={80}
                  pathOptions={{ color: '#ffab00', fillColor: '#ffab00', fillOpacity: 0.06, weight: 1, opacity: 0.4, interactive: false }}
                />
              )}
              <Marker
                position={[m.lat, m.lon]}
                zIndexOffset={m.inProgress ? 800 : 500}
                icon={L.divIcon({
                  className: '',
                  html: `<div style="display:flex;align-items:center;gap:2px;transform:translate(-50%,-50%);cursor:pointer;">
                    <div style="width:${dotSize}px;height:${dotSize}px;border-radius:50%;background:${markerColor};border:2px solid ${borderColor};box-shadow:0 0 8px ${markerColor}66,0 0 16px ${markerColor}33;opacity:${fadeOpacity};${pulseAnim}flex-shrink:0;"></div>
                    <span style="font-size:${dotSize + 2}px;filter:drop-shadow(0 0 4px ${markerColor}88);line-height:1;">${m.eventIcon}</span>
                  </div>`,
                  iconSize: [36, 20],
                  iconAnchor: [18, 10],
                })}
              >
                <Popup closeButton={false} className="hud-popup-custom" offset={[0, -10]}>
                  <div style={{
                    fontFamily: "'Share Tech Mono', monospace",
                    background: 'linear-gradient(135deg, rgba(0,15,25,0.96), rgba(0,25,40,0.98))',
                    border: `1px solid ${markerColor}44`,
                    borderRadius: '6px', padding: '8px 10px', minWidth: '200px', maxWidth: '260px',
                    boxShadow: `0 2px 12px rgba(0,0,0,0.5), 0 0 10px ${markerColor}15`,
                    color: '#e0e0e0', direction: 'rtl',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '14px' }}>📨</span>
                        <span style={{ fontSize: '10px', fontWeight: 700, color: markerColor }}>{statusLabel}</span>
                      </div>
                      <span style={{ fontSize: '7px', color: markerColor, background: `${markerColor}18`, border: `1px solid ${markerColor}33`, padding: '1px 4px', borderRadius: '3px' }}>{statusBadge}</span>
                    </div>
                    <div style={{ height: '1px', background: `linear-gradient(90deg, transparent, ${markerColor}44, transparent)`, margin: '3px 0 5px' }} />
                    <div style={{ fontSize: '9px', color: '#b0bec5', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>{m.text}</div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${markerColor}22`, paddingTop: '4px', marginTop: '4px' }}>
                      <span style={{ fontSize: '8px', color: '#78909c' }}>⏱ {ageLabel}</span>
                      <span style={{ fontSize: '7px', color: '#546e7a' }}>📍 {m.locationName}</span>
                    </div>
                  </div>
                </Popup>
              </Marker>
            </React.Fragment>
          );
        })}

        {/* ═══ IRAN THREAT RADIUS — shown when zoomed to Iran ═══ */}
        {showIranThreatRadius && (() => {
          const iranSrc = MISSILE_SOURCES.find(s => s.id === 'iran');
          if (!iranSrc) return null;
          return (
            <>
              {/* Missile range ring — 1600km */}
              <Circle center={[iranSrc.lat, iranSrc.lon]} radius={1600000}
                pathOptions={{ color: '#ff1744', fillColor: '#ff1744', fillOpacity: 0.06, weight: 2, dashArray: '12,6', opacity: 0.7, interactive: false }} />
              {/* Inner engagement zone — 800km */}
              <Circle center={[iranSrc.lat, iranSrc.lon]} radius={800000}
                pathOptions={{ color: '#ff6d00', fillColor: '#ff6d00', fillOpacity: 0.04, weight: 1.5, dashArray: '8,4', opacity: 0.5, interactive: false }} />
              {/* Source marker */}
              <CircleMarker center={[iranSrc.lat, iranSrc.lon]} radius={10}
                pathOptions={{ color: '#ff1744', fillColor: '#ff1744', fillOpacity: 0.8, weight: 3 }}>
                <Popup>
                  <div style={{ fontFamily: 'Share Tech Mono', direction: 'rtl', textAlign: 'right' }}>
                    <div style={{ fontWeight: 900, fontSize: 14, color: '#ff1744' }}>☄️ {iranSrc.name}</div>
                    <div style={{ fontSize: 11, color: '#666' }}>{iranSrc.missileType}</div>
                    <div style={{ fontSize: 11, color: '#666' }}>טווח: 1,600 ק"מ | זמן טיסה: {Math.floor(iranSrc.flightTimeSec / 60)} דקות</div>
                    <div style={{ fontSize: 11, color: '#ff6d00' }}>הגנה: {iranSrc.defenseSystem}</div>
                  </div>
                </Popup>
              </CircleMarker>
              {/* Target lines to Israel */}
              {iranSrc.targets.map((t, ti) => (
                <Polyline key={`iran-target-${ti}`} positions={[[iranSrc.lat, iranSrc.lon], [t.lat, t.lon]]}
                  pathOptions={{ color: '#ff174466', weight: 1.5, dashArray: '6,4', interactive: false }} />
              ))}
            </>
          );
        })()}

        {/* ═══ SATELLITE DATA LAYER — FIRMS Hotspots with category icons ═══ */}
        {showSatellite && satelliteHotspots.filter(h => Number.isFinite(h?.latitude) && Number.isFinite(h?.longitude)).map((h, i) => {
          const isThermal = tileTheme === 'thermal';
          
          // ── Classify hotspot category ──
          const classifyHotspot = () => {
            const r = (h.region || '').toLowerCase();
            const frp = h.frp || 0;
            const brightness = h.brightness || 0;
            
            // Oil platform / refinery fire — Persian Gulf region (24-30°N, 47-57°E)
            const lat = h.latitude || 0;
            const lon = h.longitude || 0;
            const isPersianGulf = lat >= 24 && lat <= 30 && lon >= 47 && lon <= 57;
            if (isPersianGulf && frp > 15)
              return { category: 'oil_fire', icon: '🛢️', label: 'שריפת אסדת נפט / בית זיקוק', color: '#ff6d00', bgColor: 'rgba(255,109,0,0.3)' };
            
            // Military / Launch preparation — Iran/Yemen high FRP
            if ((r.includes('iran') || r.includes('איראן')) && frp > 50) 
              return { category: 'launch', icon: '🚀', label: 'חשד להכנה לשיגור', color: '#ff1744', bgColor: 'rgba(255,23,68,0.25)' };
            if ((r.includes('iran') || r.includes('איראן')) && frp > 20) 
              return { category: 'military', icon: '⚔️', label: 'מתקן צבאי / תעשייתי', color: '#ff6d00', bgColor: 'rgba(255,109,0,0.25)' };
            if ((r.includes('yemen') || r.includes('תימן')) && frp > 30) 
              return { category: 'launch', icon: '🚀', label: 'פעילות חות\'ית — חשד שיגור', color: '#ff1744', bgColor: 'rgba(255,23,68,0.25)' };
            
            // War / Bombing — Syria, Lebanon, Iraq active zones
            if ((r.includes('syria') || r.includes('סוריה')) && frp > 15) 
              return { category: 'bombing', icon: '💥', label: 'הפצצה / תקיפה', color: '#ff3d00', bgColor: 'rgba(255,61,0,0.25)' };
            if ((r.includes('lebanon') || r.includes('לבנון')) && frp > 15) 
              return { category: 'bombing', icon: '💥', label: 'פעילות לחימה', color: '#ff3d00', bgColor: 'rgba(255,61,0,0.25)' };
            if ((r.includes('iraq') || r.includes('עיראק')) && frp > 20) 
              return { category: 'bombing', icon: '💥', label: 'פעילות מיליציות', color: '#ff3d00', bgColor: 'rgba(255,61,0,0.25)' };
            if ((r.includes('israel') || r.includes('ישראל')) && frp > 10)
              return { category: 'bombing', icon: '💥', label: 'אירוע חשוד בישראל', color: '#ff1744', bgColor: 'rgba(255,23,68,0.25)' };
            
            // Extreme FRP anywhere — suspicious
            if (frp > 100) 
              return { category: 'bombing', icon: '💥', label: 'עוצמה חריגה — חשד לפיצוץ', color: '#ff1744', bgColor: 'rgba(255,23,68,0.25)' };
            
            // Fire — medium FRP, natural/wildfire regions
            if (frp > 10 || brightness > 340) 
              return { category: 'fire', icon: '🔥', label: 'שריפה', color: '#ff9100', bgColor: 'rgba(255,145,0,0.2)' };
            
            // Industrial / Agricultural — low FRP
            if (frp > 3) 
              return { category: 'industrial', icon: '🏭', label: 'תעשייתי / חקלאי', color: '#ffc107', bgColor: 'rgba(255,193,7,0.15)' };
            
            return { category: 'agricultural', icon: '🌾', label: 'חקלאי / טבעי', color: '#8bc34a', bgColor: 'rgba(139,195,74,0.15)' };
          };
          
          const hotspotClass = classifyHotspot();
          const markerColor = hotspotClass.color;
          const iconSize = h.intensity === 'extreme' ? 28 : h.intensity === 'high' ? 24 : 20;
          const pulseClass = (hotspotClass.category === 'launch' || hotspotClass.category === 'bombing') ? 'firms-pulse' : '';
          
          return (
            <React.Fragment key={`firms-${i}`}>
              {/* 5km radius circle */}
              <Circle
                center={[h.latitude, h.longitude]}
                radius={5000}
                pathOptions={{
                  color: markerColor,
                  fillColor: markerColor,
                  fillOpacity: isThermal ? 0.15 : 0.08,
                  weight: isThermal ? 1.5 : 1,
                  opacity: isThermal ? 0.6 : 0.3,
                  dashArray: (hotspotClass.category === 'launch' || hotspotClass.category === 'bombing') ? undefined : '6 3',
                }}
              />
              {/* Category icon marker */}
              <Marker
                position={[h.latitude, h.longitude]}
                zIndexOffset={hotspotClass.category === 'launch' ? 600 : hotspotClass.category === 'bombing' ? 500 : 300}
                icon={L.divIcon({
                  className: '',
                  html: `<div class="${pulseClass}" style="
                    display:flex;align-items:center;justify-content:center;
                    width:${iconSize}px;height:${iconSize}px;
                    background:${hotspotClass.bgColor};
                    border:1.5px solid ${markerColor}88;
                    border-radius:50%;
                    box-shadow:0 0 ${hotspotClass.category === 'launch' ? '12' : '6'}px ${markerColor}66;
                    font-size:${Math.round(iconSize * 0.55)}px;
                    line-height:1;
                    cursor:pointer;
                  ">${hotspotClass.icon}</div>`,
                  iconSize: [iconSize, iconSize],
                  iconAnchor: [iconSize / 2, iconSize / 2],
                })}
              >
                <Popup closeButton={false} className={isThermal ? 'thermal-popup' : 'hud-popup-custom'}>
                  <div style={{
                    background: isThermal
                      ? 'linear-gradient(135deg, rgba(60,8,0,0.97), rgba(25,3,0,0.98))'
                      : 'rgba(10,10,20,0.95)',
                    border: `1px solid ${markerColor}66`,
                    borderRadius: '8px',
                    padding: '10px 12px',
                    minWidth: '220px',
                    color: '#fff',
                    fontFamily: "'Share Tech Mono', monospace",
                  }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: markerColor, marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '16px' }}>{hotspotClass.icon}</span>
                      {hotspotClass.label}
                    </div>
                    <div style={{ fontSize: '9px', color: '#e0e0e0', background: `${markerColor}15`, borderRadius: '4px', padding: '4px 6px', marginBottom: '6px', borderRight: `2px solid ${markerColor}` }}>
                      קטגוריה: <span style={{ color: markerColor, fontWeight: 700 }}>{
                        hotspotClass.category === 'launch' ? 'הכנה לשיגור' :
                        hotspotClass.category === 'bombing' ? 'הפצצה / מלחמה' :
                        hotspotClass.category === 'military' ? 'צבאי / תעשייתי' :
                        hotspotClass.category === 'fire' ? 'שריפה' :
                        hotspotClass.category === 'industrial' ? 'תעשייתי' : 'חקלאי / טבעי'
                      }</span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 12px', fontSize: '9px' }}>
                      <span style={{ color: '#78909c' }}>אזור:</span>
                      <span style={{ color: '#b0bec5' }}>{h.region}</span>
                      <span style={{ color: '#78909c' }}>עוצמה:</span>
                      <span style={{ color: markerColor, fontWeight: 700 }}>{h.intensity}</span>
                      <span style={{ color: '#78909c' }}>FRP:</span>
                      <span style={{ color: '#e0e0e0' }}>{h.frp} MW</span>
                      <span style={{ color: '#78909c' }}>Brightness:</span>
                      <span style={{ color: '#e0e0e0' }}>{h.brightness} K</span>
                      <span style={{ color: '#78909c' }}>קואורדינטות:</span>
                      <span style={{ color: '#80cbc4', direction: 'ltr' }}>{h.latitude.toFixed(4)}, {h.longitude.toFixed(4)}</span>
                      <span style={{ color: '#78909c' }}>רדיוס ניטור:</span>
                      <span style={{ color: '#ffab00' }}>5 ק"מ</span>
                    </div>
                    <div style={{ fontSize: '8px', color: '#546e7a', marginTop: '6px', borderTop: '1px solid rgba(255,100,0,0.15)', paddingTop: '4px' }}>
                      לוויין: {h.satellite} | {h.acq_date} {h.acq_time}
                    </div>
                  </div>
                </Popup>
              </Marker>
            </React.Fragment>
          );
        })}
        {showSatellite && satelliteEarthquakes.filter(q => Number.isFinite(q?.lat) && Number.isFinite(q?.lon)).map((q, i) => (
          <React.Fragment key={`usgs-${q.id || i}`}>
            <CircleMarker center={[q.lat, q.lon]} radius={Math.max(6, q.magnitude * 3)}
              pathOptions={{ color: q.possible_explosion ? '#ff1744' : '#ffeb3b', fillColor: q.possible_explosion ? '#ff1744' : '#ffc107', fillOpacity: 0.6, weight: 2, dashArray: q.possible_explosion ? '4 2' : undefined }}>
              <Popup closeButton={false} className="hud-popup-custom">
                <div style={{ background: 'rgba(10,10,20,0.95)', border: `1px solid ${q.possible_explosion ? '#ff174466' : '#ffeb3b66'}`, borderRadius: '8px', padding: '8px 10px', minWidth: '180px', color: '#fff', fontFamily: "'Share Tech Mono', monospace" }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: q.possible_explosion ? '#ff1744' : '#ffeb3b' }}>{q.possible_explosion ? '💥 חשד לפיצוץ' : '🌍 רעידת אדמה'} M{q.magnitude}</div>
                  <div style={{ fontSize: '9px', color: '#b0bec5', marginTop: '4px' }}>{q.place}</div>
                  <div style={{ fontSize: '9px', color: '#78909c' }}>עומק: {q.depth_km?.toFixed(1)} ק"מ | אזור: {q.region}</div>
                  {q.possible_explosion && <div style={{ fontSize: '9px', color: '#ff1744', marginTop: '2px', fontWeight: 700 }}>⚠️ עומק רדוד חשוד — ייתכן פיצוץ תת-קרקעי</div>}
                </div>
              </Popup>
            </CircleMarker>
            {q.possible_explosion && <Circle center={[q.lat, q.lon]} radius={q.magnitude * 5000}
              pathOptions={{ color: '#ff1744', fillColor: '#ff1744', fillOpacity: 0.08, weight: 1.5, dashArray: '6 3', opacity: 0.5 }} />}
          </React.Fragment>
        ))}

        {/* ═══ DATA CENTERS — חוות שרתים גלובליות ═══ */}
        {showDataCenters && DATA_CENTERS.filter(d => Number.isFinite(d.lat) && Number.isFinite(d.lon) && isInBounds(d.lat, d.lon, viewBounds)).map((dc) => {
          const color = PROVIDER_COLOR[dc.provider] || '#9e9e9e';
          const radius = dc.tier === 'hyperscale' ? 5 : dc.tier === 'regional' ? 4 : 3;
          return (
            <CircleMarker key={`dc-${dc.id}`} center={[dc.lat, dc.lon]} radius={radius}
              pathOptions={{ color, fillColor: color, fillOpacity: 0.5, weight: 1 }}>
              <Popup closeButton={false} className="hud-popup-custom">
                <div style={{ background: 'rgba(10,10,20,0.95)', border: `1px solid ${color}66`, borderRadius: '8px', padding: '8px 10px', minWidth: '200px', color: '#fff', fontFamily: "'Share Tech Mono', monospace" }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color }}>🏢 {dc.provider} · {dc.tier.toUpperCase()}</div>
                  <div style={{ fontSize: '10px', color: '#e0e0e0', marginTop: '3px' }}>{dc.nameHe || dc.name}</div>
                  <div style={{ fontSize: '9px', color: '#78909c', marginTop: '2px' }}>{dc.city}, {dc.country} ({dc.iso})</div>
                  {dc.capacityMW && <div style={{ fontSize: '9px', color: '#90caf9' }}>הספק: {dc.capacityMW} MW</div>}
                  <div style={{ fontSize: '9px', color: dc.status === 'online' ? '#66bb6a' : dc.status === 'degraded' ? '#ffd600' : '#ff1744' }}>סטטוס: {dc.status}</div>
                </div>
              </Popup>
            </CircleMarker>
          );
        })}

        {/* ═══ GROUND STATIONS — תחנות קרקע ללווינים ═══ */}
        {showGroundStations && GROUND_STATIONS.filter(g => Number.isFinite(g.lat) && Number.isFinite(g.lon) && isInBounds(g.lat, g.lon, viewBounds)).map((gs) => {
          const color = OPERATOR_COLOR[gs.operator] || '#9e9e9e';
          return (
            <Marker key={`gs-${gs.id}`} position={[gs.lat, gs.lon]} zIndexOffset={500}
              icon={L.divIcon({
                className: '',
                html: `<div style="transform:translate(-50%,-50%);display:flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:${color}11;border:1px solid ${color}88;box-shadow:0 0 6px ${color}44;font-size:9px;">📡</div>`,
                iconSize: [16, 16], iconAnchor: [8, 8],
              })}>
              <Popup closeButton={false} className="hud-popup-custom">
                <div style={{ background: 'rgba(10,10,20,0.95)', border: `1px solid ${color}66`, borderRadius: '8px', padding: '8px 10px', minWidth: '200px', color: '#fff', fontFamily: "'Share Tech Mono', monospace" }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color }}>📡 {gs.operator} Ground Station</div>
                  <div style={{ fontSize: '10px', color: '#e0e0e0', marginTop: '3px' }}>{gs.nameHe || gs.name}</div>
                  <div style={{ fontSize: '9px', color: '#78909c', marginTop: '2px' }}>{gs.city}, {gs.country}</div>
                  <div style={{ fontSize: '9px', color: '#90caf9', marginTop: '2px' }}>לוויינים: {gs.satellites.join(', ')}</div>
                  <div style={{ fontSize: '9px', color: gs.status === 'online' ? '#66bb6a' : '#ffd600' }}>סטטוס: {gs.status}</div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* ═══ SATELLITES (sub-satellite points) ═══ */}
        {showGroundStations && SATELLITES.filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lon) && isInBounds(s.lat, s.lon, viewBounds)).map((sat) => {
          const color = OPERATOR_COLOR[sat.operator] || '#fff';
          return (
            <Marker key={`sat-${sat.id}`} position={[sat.lat, sat.lon]} zIndexOffset={600}
              icon={L.divIcon({
                className: '',
                html: `<div style="transform:translate(-50%,-50%);font-size:12px;filter:drop-shadow(0 0 4px ${color}88);opacity:0.7;">🛰️</div>`,
                iconSize: [16, 16], iconAnchor: [8, 8],
              })}>
              <Popup closeButton={false} className="hud-popup-custom">
                <div style={{ background: 'rgba(10,10,20,0.95)', border: `1px solid ${color}66`, borderRadius: '8px', padding: '8px 10px', minWidth: '180px', color: '#fff', fontFamily: "'Share Tech Mono', monospace" }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color }}>🛰️ {sat.name}</div>
                  <div style={{ fontSize: '9px', color: '#78909c' }}>{sat.operator} · {sat.type} · {sat.altKm.toLocaleString()} km</div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* ═══ SAT LINKS — קווי חיבור תחנות-קרקע ↔ לווינים ═══ */}
        {showSatLinks && GROUND_STATIONS.flatMap((gs) =>
          SATELLITES
            .filter(sat => gs.satellites.some(name => sat.name.toLowerCase().includes(sat.operator.toLowerCase()) || name.toLowerCase().includes(sat.operator.toLowerCase())))
            .filter(sat => Number.isFinite(sat.lat) && Number.isFinite(sat.lon) && Number.isFinite(gs.lat) && Number.isFinite(gs.lon))
            .map((sat) => {
              const color = OPERATOR_COLOR[sat.operator] || '#00e5ff';
              return (
                <Polyline key={`link-${gs.id}-${sat.id}`}
                  positions={[[gs.lat, gs.lon], [sat.lat, sat.lon]]}
                  pathOptions={{ color, weight: 0.7, opacity: 0.35, dashArray: '2 6' }} />
              );
            })
        )}

        {/* ═══ AURORA CABLE LAYER — תצוגה חדשנית של מסלולי דאטה (סאב + backbone + פולסים) ═══ */}
        {(showSubCables || showBackbone) && (() => {
          const liveOverall: LoadStatus = cloudStatus?.overall ?? 'normal';
          const hashLoad = (id: string): CableLoad => {
            let h = 0;
            for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
            const slot = h % 100;
            if (liveOverall === 'fault') return slot < 45 ? 'fault' : slot < 80 ? 'congested' : 'normal';
            if (liveOverall === 'congested') return slot < 55 ? 'congested' : slot < 90 ? 'normal' : 'fault';
            return slot < 82 ? 'normal' : slot < 96 ? 'congested' : 'fault';
          };
          return (
            <AuroraCableLayer
              cables={showSubCables ? SUBMARINE_CABLES : []}
              backbone={showBackbone ? BACKBONE_LINKS : []}
              loadFor={hashLoad}
              enabled
            />
          );
        })()}

        {/* ═══ METRO DATA TRAFFIC — תעבורת דאטה Waze-style ברמת ערים/שכונות/רחובות ═══ */}
        {showBackbone && (
          <MetroDataTrafficLayer
            enabled
            globalLoad={(cloudStatus?.overall ?? 'normal') as 'normal' | 'congested' | 'fault'}
          />
        )}

        {/* ═══ Invisible interactive overlays — popups for cables ═══ */}
        {showSubCables && SUBMARINE_CABLES.map((cable) => {
          const validPoints = cable.waypoints.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]));
          if (validPoints.length < 2) return null;
          return (
            <React.Fragment key={`cable-hit-${cable.id}`}>
              <Polyline positions={validPoints} pathOptions={{ color: cable.color, weight: 14, opacity: 0.001 }}>
                <Popup closeButton={false} className="hud-popup-custom">
                  <div style={{ background: 'rgba(10,10,20,0.95)', border: `1px solid ${cable.color}66`, borderRadius: '8px', padding: '8px 10px', minWidth: '220px', color: '#fff', fontFamily: "'Share Tech Mono', monospace" }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: cable.color }}>🌊 {cable.name}</div>
                    <div style={{ fontSize: '10px', color: '#e0e0e0', marginTop: '3px' }}>{cable.nameHe || cable.name}</div>
                    {cable.capacityTbps && <div style={{ fontSize: '9px', color: '#90caf9' }}>קיבולת: {cable.capacityTbps} Tbps</div>}
                    {cable.rfs && <div style={{ fontSize: '9px', color: '#78909c' }}>בשירות מ: {cable.rfs}</div>}
                    {cable.owner && <div style={{ fontSize: '9px', color: '#78909c' }}>מפעיל: {cable.owner}</div>}
                    <div style={{ fontSize: '9px', color: '#78909c', marginTop: '3px' }}>נחיתה: {cable.landingPoints.map(lp => lp.name).join(' ↔ ')}</div>
                  </div>
                </Popup>
              </Polyline>
              {cable.landingPoints.filter(lp => Number.isFinite(lp.lat) && Number.isFinite(lp.lon)).map((lp, idx) => (
                <CircleMarker key={`landing-${cable.id}-${idx}`} center={[lp.lat, lp.lon]} radius={8}
                  pathOptions={{ color: 'transparent', fillColor: 'transparent', fillOpacity: 0, weight: 0, opacity: 0 }}>
                  <Popup closeButton={false}><div style={{ fontSize: 11, fontFamily: "'Share Tech Mono'" }}>📍 {lp.name} ({lp.country})<br/>{cable.name}</div></Popup>
                </CircleMarker>
              ))}
            </React.Fragment>
          );
        })}

        {/* ═══ Invisible interactive overlays — popups for backbone ═══ */}
        {showBackbone && BACKBONE_LINKS.filter(b => Number.isFinite(b.from?.lat) && Number.isFinite(b.from?.lon) && Number.isFinite(b.to?.lat) && Number.isFinite(b.to?.lon)).map((link) => (
          <Polyline key={`bb-hit-${link.id}`} positions={[[link.from.lat, link.from.lon], [link.to.lat, link.to.lon]]}
            pathOptions={{ color: link.color, weight: 14, opacity: 0.001 }}>
            <Popup closeButton={false} className="hud-popup-custom">
              <div style={{ background: 'rgba(10,10,20,0.95)', border: `1px solid ${link.color}66`, borderRadius: '8px', padding: '8px 10px', minWidth: '180px', color: '#fff', fontFamily: "'Share Tech Mono', monospace" }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: link.color }}>🔌 {link.nameHe || link.name}</div>
                <div style={{ fontSize: '9px', color: '#78909c', marginTop: '3px' }}>{link.from.name} ↔ {link.to.name}</div>
                {link.capacityGbps && <div style={{ fontSize: '9px', color: '#90caf9' }}>קיבולת: {link.capacityGbps} Gbps</div>}
                <div style={{ fontSize: '9px', color: '#78909c' }}>סוג: {link.type === 'peering' ? 'Peering / IXP' : 'Terrestrial Backbone'}</div>
              </div>
            </Popup>
          </Polyline>
        ))}

        {/* DataFlowParticles is now superseded by AuroraCableLayer — keep disabled to avoid duplicate animation */}
        {showDataFlow && false && (() => null)()}

        {/* ═══ TRANSIT NODES — תחנות רכבת/אוטובוס/קניונים ═══ */}
        {showTransitNodes && [...TRAIN_STATIONS, ...BUS_TERMINALS, ...LIGHT_RAIL_STOPS, ...MALLS]
          .filter(n => Number.isFinite(n.lat) && Number.isFinite(n.lon) && isInBounds(n.lat, n.lon, viewBounds))
          .map((n) => {
            const color = TRANSIT_COLOR[n.type];
            const radius = n.capacity === 'major' ? 8 : n.capacity === 'medium' ? 6 : 4;
            // Match transit line status if available
            const matchingLine = transitStatus?.lines.find(l =>
              (n.type === 'train' && l.type === 'train' && (n.city.includes(l.name.split(' ')[0]) || l.name.toLowerCase().includes(n.city.toLowerCase().split(' ')[0]))) ||
              (n.type === 'bus_terminal' && l.type === 'bus' && n.city.toLowerCase().includes(l.name.toLowerCase().split(' ')[0])) ||
              (n.type === 'light_rail' && l.type === 'light_rail' && n.city.toLowerCase().includes(l.name.toLowerCase().split(' ')[0]))
            );
            const ringColor = matchingLine?.status === 'disrupted' ? '#ff1744'
              : matchingLine?.status === 'delayed' ? '#ff9100'
              : color;
            return (
              <CircleMarker
                key={`transit-${n.id}`}
                center={[n.lat, n.lon]}
                radius={radius}
                pathOptions={{ color: ringColor, fillColor: color, fillOpacity: 0.7, weight: 2, opacity: 0.9 }}
              >
                <Popup>
                  <div className="font-mono text-[10px]" dir="rtl" style={{ minWidth: 160 }}>
                    <div style={{ fontWeight: 700, color: ringColor, marginBottom: 4 }}>
                      {TRANSIT_ICON[n.type]} {n.nameHe}
                    </div>
                    <div style={{ color: '#888', fontSize: 9 }}>{n.city} · {n.type}</div>
                    {matchingLine && (
                      <div style={{ marginTop: 4, padding: 4, background: 'rgba(0,0,0,0.05)', borderRadius: 4 }}>
                        <div>סטטוס: <span style={{ color: ringColor, fontWeight: 700 }}>{matchingLine.status === 'normal' ? 'תקין' : matchingLine.status === 'delayed' ? `עיכוב ${matchingLine.delayMin}׳` : 'שיבוש'}</span></div>
                      </div>
                    )}
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}

        {/* ═══ CELL TOWERS — אנטנות סלולר עם uptime חי לפי אזור (cell-tower-status edge fn) ═══ */}
        {showCellTowers && CELL_TOWERS.filter(t => isInBounds(t.lat, t.lon, viewBounds)).map((t) => {
          const meta = CARRIER_META[t.carrier];
          const radius = t.capacity === 'macro' ? 1800 : 600;
          const regionId = cityToRegion(t.city);
          const regionStatus = cellStatus?.regions.find(r => r.region === regionId);
          const carrierStatus = regionStatus?.carriers.find(c => c.carrier === t.carrier);
          const tier: CellTier = (carrierStatus?.tier ?? 'green') as CellTier;
          const uptime = carrierStatus?.uptime ?? 100;
          const tierColor = tier === 'green' ? '#00e676' : tier === 'orange' ? '#ffab00' : '#ff1744';
          const ringColor = tier === 'green' ? meta.color : tierColor;
          const fillOpacity = tier === 'red' ? 0.22 : tier === 'orange' ? 0.14 : 0.08;
          return (
            <Circle key={`cell-${t.id}`} center={[t.lat, t.lon]} radius={radius}
              pathOptions={{ color: ringColor, fillColor: tierColor, fillOpacity, weight: tier === 'red' ? 1.4 : 0.6, opacity: tier === 'red' ? 0.9 : 0.5 }}>
              <Popup closeButton={false} className="hud-popup-custom">
                <div style={{ background: 'rgba(10,10,20,0.95)', border: `1px solid ${ringColor}66`, borderRadius: '8px', padding: '8px 10px', minWidth: '200px', color: '#fff', fontFamily: "'Share Tech Mono', monospace" }}>
                  <div style={{ fontSize: '11px', fontWeight: 700, color: meta.color }}>📶 {meta.labelHe}</div>
                  <div style={{ fontSize: '10px', color: '#e0e0e0', marginTop: '3px' }}>{t.city}</div>
                  <div style={{ fontSize: '9px', color: '#90caf9', marginTop: '2px' }}>טכנולוגיה: {t.tech.join(' / ')} • {t.capacity === 'macro' ? 'Macro' : 'Small'}</div>
                  <div style={{ marginTop: 6, padding: '4px 6px', background: `${tierColor}22`, borderRight: `2px solid ${tierColor}`, borderRadius: 4 }}>
                    <div style={{ fontSize: 9, color: tierColor, fontWeight: 700 }}>● Uptime חי: {uptime}%</div>
                    <div style={{ fontSize: 9, color: '#78909c' }}>אזור: {regionStatus?.nameHe || '—'}</div>
                  </div>
                </div>
              </Popup>
            </Circle>
          );
        })}

        {showSatellite && satelliteEonet.filter(e => Number.isFinite(e?.lat) && Number.isFinite(e?.lon)).map((e, i) => (
          <Marker key={`eonet-${e.id || i}`} position={[e.lat, e.lon]} zIndexOffset={400}
            icon={L.divIcon({
              className: '',
              html: `<div style="display:flex;align-items:center;gap:3px;transform:translate(-50%,-50%);cursor:pointer;">
                <span style="font-size:18px;filter:drop-shadow(0 0 6px rgba(255,255,255,0.5));">${e.icon || '🛰️'}</span>
              </div>`,
              iconSize: [24, 24], iconAnchor: [12, 12],
            })}>
            <Popup closeButton={false} className="hud-popup-custom">
              <div style={{ background: 'rgba(10,10,20,0.95)', border: '1px solid #ce93d866', borderRadius: '8px', padding: '8px 10px', minWidth: '180px', color: '#fff', fontFamily: "'Share Tech Mono', monospace" }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#ce93d8' }}>{e.icon} NASA EONET — {e.categoryName}</div>
                <div style={{ fontSize: '10px', color: '#e0e0e0', marginTop: '3px' }}>{e.title}</div>
                <div style={{ fontSize: '9px', color: '#78909c', marginTop: '2px' }}>אזור: {e.region} | {e.date?.slice(0, 10)}</div>
              </div>
            </Popup>
          </Marker>
        ))}


        {/* ═══ MULTI-THEATER INTERCEPT ARCS — All defense layers including Arrow ═══ */}
        {showTrajectories && (() => {
          const interceptArcs: { battery: DefenseSystem; target: { lat: number; lon: number; name: string }; color: string; defenseType: string }[] = [];
          
          // For each active OREF alert, draw intercept arcs from nearest batteries
          const activeOrefAlerts = orefAlerts.filter(a => {
            const alertTime = new Date(a.alert_date).getTime();
            return Date.now() - alertTime < 600000;
          });
          
          const alertRegionCoords: Record<string, { lat: number; lon: number }> = {
            'שדרות': { lat: 31.52, lon: 34.60 }, 'אשקלון': { lat: 31.67, lon: 34.57 },
            'באר שבע': { lat: 31.25, lon: 34.79 }, 'תל אביב': { lat: 32.08, lon: 34.78 },
            'חיפה': { lat: 32.79, lon: 34.99 }, 'ירושלים': { lat: 31.77, lon: 35.21 },
            'קריית שמונה': { lat: 33.21, lon: 35.57 }, 'נהריה': { lat: 33.00, lon: 35.10 },
            'עכו': { lat: 32.93, lon: 35.08 }, 'צפת': { lat: 32.97, lon: 35.50 },
            'אשדוד': { lat: 31.80, lon: 34.65 }, 'נתיבות': { lat: 31.42, lon: 34.59 },
            'אילת': { lat: 29.56, lon: 34.95 },
          };
          
          for (const alert of activeOrefAlerts) {
            for (const loc of (alert.locations || [])) {
              const coords = alertRegionCoords[loc] || Object.entries(alertRegionCoords).find(([k]) => loc.includes(k))?.[1];
              if (!coords) continue;
              const sortedBatteries = DEFENSE_SYSTEMS
                .filter(ds => ds.type === 'iron_dome' || ds.type === 'davids_sling')
                .map(ds => ({ ...ds, dist: Math.sqrt(Math.pow(ds.lat - coords.lat, 2) + Math.pow(ds.lon - coords.lon, 2)) }))
                .sort((a, b) => a.dist - b.dist)
                .slice(0, 2);
              for (const bat of sortedBatteries) {
                interceptArcs.push({ battery: bat, target: { ...coords, name: loc }, color: bat.color, defenseType: bat.type === 'iron_dome' ? 'כיפת ברזל' : 'קלע דוד' });
              }
            }
          }

          // ═══ ARROW INTERCEPT — auto-activate when ballistic launch detected (live OR demo) ═══
          const arrowInterceptArcs: { battery: DefenseSystem; interceptPt: { lat: number; lon: number }; origin: { lat: number; lon: number; name: string }; color: string; progress: number; label: string }[] = [];
          const hasBallisticLaunch = demoLaunchActive || launchDetectionMarkers.some(d =>
            d.origin.name.includes('איראן') || d.origin.name.includes('עיראק') || d.origin.name.includes('תימן')
          );

          if (hasBallisticLaunch) {
            const arrowBatteries = DEFENSE_SYSTEMS.filter(d => d.type === 'arrow');
            const ballisticTargets = demoLaunchActive
              ? [{ lat: 32.08, lon: 34.78, name: 'תל אביב' }, { lat: 31.77, lon: 35.21, name: 'ירושלים' }, { lat: 31.07, lon: 35.03, name: 'דימונה' }]
              : launchDetectionMarkers.flatMap(d => d.targets);
            
            const elapsed = demoLaunchActive ? Date.now() - demoLaunchStartRef.current : 0;
            
            for (const bat of arrowBatteries) {
              for (const tgt of ballisticTargets) {
                // Intercept point: ~60% of the way from origin to target (exo-atmospheric)
                const originLat = demoLaunchActive ? 32.65 : (launchDetectionMarkers[0]?.origin.lat || 32.65);
                const originLon = demoLaunchActive ? 51.68 : (launchDetectionMarkers[0]?.origin.lon || 51.68);
                const interceptLat = originLat + (tgt.lat - originLat) * 0.6;
                const interceptLon = originLon + (tgt.lon - originLon) * 0.6;
                const progress = demoLaunchActive ? Math.min(1, elapsed / 180000) : 0.5; // 3 min to intercept in demo

                arrowInterceptArcs.push({
                  battery: bat,
                  interceptPt: { lat: interceptLat, lon: interceptLon },
                  origin: { lat: originLat, lon: originLon, name: demoLaunchActive ? 'איראן' : (launchDetectionMarkers[0]?.origin.name || 'איראן') },
                  color: bat.color,
                  progress,
                  label: bat.name.includes('פלמחים') ? 'חץ 3' : 'חץ 2',
                });
              }
            }
          }
          
          // Persistent theater coverage arcs
          const theaterArcs = [
            { from: DEFENSE_SYSTEMS.find(d => d.id === 'id_north')!, to: { lat: 33.30, lon: 35.48, name: 'לבנון' }, color: '#00e676' },
            { from: DEFENSE_SYSTEMS.find(d => d.id === 'ds_north')!, to: { lat: 33.30, lon: 35.48, name: 'לבנון' }, color: '#00e5ff' },
            { from: DEFENSE_SYSTEMS.find(d => d.id === 'id_sderot')!, to: { lat: 31.52, lon: 34.45, name: 'עזה' }, color: '#00e676' },
            { from: DEFENSE_SYSTEMS.find(d => d.id === 'id_ashkelon')!, to: { lat: 31.52, lon: 34.45, name: 'עזה' }, color: '#00e676' },
            { from: DEFENSE_SYSTEMS.find(d => d.id === 'arrow_palmachim')!, to: { lat: 32.65, lon: 51.68, name: 'איראן' }, color: '#7c4dff' },
            { from: DEFENSE_SYSTEMS.find(d => d.id === 'arrow_nevatim')!, to: { lat: 32.65, lon: 51.68, name: 'איראן' }, color: '#448aff' },
            { from: DEFENSE_SYSTEMS.find(d => d.id === 'ds_south')!, to: { lat: 15.35, lon: 44.21, name: 'תימן' }, color: '#00e5ff' },
          ].filter(a => a.from);
          
          const now = Date.now();
          const pulse = Math.sin(now / 600) * 0.3 + 0.5;
          const arrowPulse = Math.sin(now / 300) * 0.4 + 0.6;
          
          return (
            <>
              {/* Active intercept arcs from OREF alerts */}
              {interceptArcs.map((arc, i) => {
                const midLat = (arc.battery.lat + arc.target.lat) / 2 + 0.15;
                const midLon = (arc.battery.lon + arc.target.lon) / 2;
                const points: [number, number][] = [];
                for (let t = 0; t <= 1; t += 0.05) {
                  const lat = (1 - t) * (1 - t) * arc.battery.lat + 2 * (1 - t) * t * midLat + t * t * arc.target.lat;
                  const lon = (1 - t) * (1 - t) * arc.battery.lon + 2 * (1 - t) * t * midLon + t * t * arc.target.lon;
                  points.push([lat, lon]);
                }
                return (
                  <Polyline key={`intercept-arc-${i}`} positions={points}
                    pathOptions={{ color: arc.color, weight: 2.5, opacity: pulse, dashArray: '6 4', dashOffset: String(Math.floor(now / 80) % 20) }} />
                );
              })}

              {/* ═══ ARROW INTERCEPT ARCS — exo-atmospheric intercept trajectories ═══ */}
              {arrowInterceptArcs.map((arc, i) => {
                // Arrow trajectory: battery → intercept point (high parabolic arc)
                const dist = Math.sqrt(Math.pow(arc.battery.lat - arc.interceptPt.lat, 2) + Math.pow(arc.battery.lon - arc.interceptPt.lon, 2));
                const arcHeight = Math.min(dist * 0.35, 8); // Higher arc for exo-atmospheric
                const midLat = (arc.battery.lat + arc.interceptPt.lat) / 2 + arcHeight;
                const midLon = (arc.battery.lon + arc.interceptPt.lon) / 2;
                const points: [number, number][] = [];
                const traveledPoints: [number, number][] = [];
                const remainingPoints: [number, number][] = [];
                for (let t = 0; t <= 1; t += 0.02) {
                  const lat = (1 - t) * (1 - t) * arc.battery.lat + 2 * (1 - t) * t * midLat + t * t * arc.interceptPt.lat;
                  const lon = (1 - t) * (1 - t) * arc.battery.lon + 2 * (1 - t) * t * midLon + t * t * arc.interceptPt.lon;
                  points.push([lat, lon]);
                  if (t <= arc.progress) traveledPoints.push([lat, lon]);
                  else remainingPoints.push([lat, lon]);
                }

                // Interceptor position
                const pIdx = Math.floor(arc.progress * (points.length - 1));
                const interceptorPos = points[Math.min(pIdx, points.length - 1)];

                // ── Incoming missile trajectory: origin → intercept point ──
                const incomingPoints: [number, number][] = [];
                const incomingArcHeight = Math.min(dist * 0.5, 12); // Higher arc for ballistic
                const inMidLat = (arc.origin.lat + arc.interceptPt.lat) / 2 + incomingArcHeight;
                const inMidLon = (arc.origin.lon + arc.interceptPt.lon) / 2;
                for (let t = 0; t <= 1; t += 0.02) {
                  const lat = (1 - t) * (1 - t) * arc.origin.lat + 2 * (1 - t) * t * inMidLat + t * t * arc.interceptPt.lat;
                  const lon = (1 - t) * (1 - t) * arc.origin.lon + 2 * (1 - t) * t * inMidLon + t * t * arc.interceptPt.lon;
                  incomingPoints.push([lat, lon]);
                }
                // Missile progress along incoming trajectory (slightly faster than interceptor)
                const missileIncomingProgress = Math.min(1, arc.progress * 1.15);
                const mIdx = Math.floor(missileIncomingProgress * (incomingPoints.length - 1));
                const missilePos = incomingPoints[Math.min(mIdx, incomingPoints.length - 1)];
                const incomingTraveled = incomingPoints.slice(0, mIdx + 1);
                const incomingRemaining = incomingPoints.slice(mIdx);
                
                // Has the intercept happened?
                const interceptHappened = arc.progress >= 0.85;
                // Spark/explosion animation phase (0-1 over 2 seconds after intercept)
                const sparkPhase = interceptHappened ? Math.min(1, (arc.progress - 0.85) / 0.15) : 0;

                return (
                  <React.Fragment key={`arrow-intercept-${i}`}>
                    {/* ── INCOMING MISSILE TRAIL — red trajectory from origin ── */}
                    {incomingTraveled.length > 1 && !interceptHappened && (
                      <Polyline positions={incomingTraveled}
                        pathOptions={{ color: '#ff1744', weight: 3.5, opacity: 0.8, dashArray: '6 3', dashOffset: String(Math.floor(now / 40) % 18) }} />
                    )}
                    {incomingRemaining.length > 1 && !interceptHappened && (
                      <Polyline positions={incomingRemaining}
                        pathOptions={{ color: '#ff1744', weight: 1, opacity: 0.2, dashArray: '10 8' }} />
                    )}
                    {/* ── INCOMING MISSILE MARKER — moving toward intercept ── */}
                    {!interceptHappened && missileIncomingProgress < 1 && (
                      <Marker position={missilePos as [number, number]} zIndexOffset={960}
                        icon={L.divIcon({
                          className: '',
                          html: `<div style="transform:translate(-50%,-50%);pointer-events:auto;text-align:center;">
                            <div style="font-size:20px;filter:drop-shadow(0 0 12px #ff1744) drop-shadow(0 0 24px #ff6d00);animation:pulse 0.3s infinite;">☄️</div>
                            <div style="font-family:'Share Tech Mono',monospace;font-size:7px;color:#ff1744;text-shadow:0 0 8px #ff1744;white-space:nowrap;font-weight:900;">טיל בליסטי</div>
                          </div>`,
                          iconSize: [60, 40], iconAnchor: [30, 20],
                        })} />
                    )}

                    {/* Interceptor traveled path — solid bright */}
                    {traveledPoints.length > 1 && (
                      <Polyline positions={traveledPoints}
                        pathOptions={{ color: arc.color, weight: 3, opacity: arrowPulse * 0.9, dashArray: '4 2', dashOffset: String(Math.floor(now / 50) % 12) }} />
                    )}
                    {/* Interceptor remaining path — dashed dim */}
                    {remainingPoints.length > 1 && (
                      <Polyline positions={remainingPoints}
                        pathOptions={{ color: arc.color, weight: 1.5, opacity: 0.3, dashArray: '8 6' }} />
                    )}
                    {/* Interceptor marker — animated */}
                    {arc.progress < 0.85 && (
                      <Marker position={interceptorPos as [number, number]} zIndexOffset={950}
                        icon={L.divIcon({
                          className: '',
                          html: `<div style="transform:translate(-50%,-50%);pointer-events:auto;text-align:center;">
                            <div style="font-size:18px;filter:drop-shadow(0 0 10px ${arc.color}) drop-shadow(0 0 20px ${arc.color});animation:pulse 0.4s infinite;">🏹</div>
                            <div style="font-family:'Share Tech Mono',monospace;font-size:8px;color:${arc.color};text-shadow:0 0 6px ${arc.color};white-space:nowrap;font-weight:900;">${arc.label}</div>
                          </div>`,
                          iconSize: [60, 40], iconAnchor: [30, 20],
                        })} />
                    )}

                    {/* ═══ SPARK / EXPLOSION EFFECT at intercept point ═══ */}
                    {interceptHappened && (
                      <>
                        {/* Central explosion burst */}
                        <CircleMarker center={[arc.interceptPt.lat, arc.interceptPt.lon]}
                          radius={6 + sparkPhase * 18}
                          pathOptions={{
                            color: '#ffab00',
                            fillColor: sparkPhase < 0.5 ? '#ffffff' : '#ff6d00',
                            fillOpacity: Math.max(0, (1 - sparkPhase) * 0.8),
                            weight: Math.max(0.5, (1 - sparkPhase) * 4),
                            opacity: Math.max(0, (1 - sparkPhase)),
                          }} />
                        {/* Outer shockwave ring */}
                        <CircleMarker center={[arc.interceptPt.lat, arc.interceptPt.lon]}
                          radius={sparkPhase * 30}
                          pathOptions={{
                            color: '#ff1744',
                            fillColor: 'transparent',
                            fillOpacity: 0,
                            weight: Math.max(0.3, (1 - sparkPhase) * 3),
                            opacity: Math.max(0, (1 - sparkPhase) * 0.7),
                          }} />
                        {/* Spark debris markers */}
                        {[0, 60, 120, 180, 240, 300].map((angle, si) => {
                          const rad = (angle * Math.PI) / 180;
                          const sparkDist = sparkPhase * 3; // degrees spread
                          const sLat = arc.interceptPt.lat + Math.sin(rad) * sparkDist;
                          const sLon = arc.interceptPt.lon + Math.cos(rad) * sparkDist;
                          return (
                            <CircleMarker key={`spark-${i}-${si}`}
                              center={[sLat, sLon]} radius={Math.max(1, (1 - sparkPhase) * 4)}
                              pathOptions={{
                                color: si % 2 === 0 ? '#ffab00' : '#ff6d00',
                                fillColor: si % 2 === 0 ? '#ffab00' : '#ff6d00',
                                fillOpacity: Math.max(0, (1 - sparkPhase) * 0.9),
                                weight: 1,
                                opacity: Math.max(0, (1 - sparkPhase)),
                              }} />
                          );
                        })}
                        {/* Intercept success label */}
                        <Marker position={[arc.interceptPt.lat, arc.interceptPt.lon]} zIndexOffset={999}
                          icon={L.divIcon({
                            className: '',
                            html: `<div style="transform:translate(-50%,-50%);text-align:center;pointer-events:none;">
                              <div style="font-size:${14 + sparkPhase * 10}px;filter:drop-shadow(0 0 15px #ffab00) drop-shadow(0 0 30px #ff6d00);animation:pulse 0.3s infinite;">💥</div>
                              <div style="font-family:'Share Tech Mono',monospace;font-size:9px;color:#00e676;text-shadow:0 0 8px #00e676;white-space:nowrap;font-weight:900;background:rgba(0,0,0,0.7);padding:1px 6px;border-radius:4px;border:1px solid #00e676;">יירוט מוצלח ✓</div>
                            </div>`,
                            iconSize: [80, 50], iconAnchor: [40, 25],
                          })} />
                      </>
                    )}

                    {/* Intercept point marker (pre-intercept) */}
                    {!interceptHappened && (
                      <CircleMarker center={[arc.interceptPt.lat, arc.interceptPt.lon]} radius={4}
                        pathOptions={{ color: arc.color, fillColor: arc.color, fillOpacity: 0.2, weight: 1, opacity: arrowPulse }} />
                    )}
                  </React.Fragment>
                );
              })}

              {/* Persistent theater coverage arcs — subtle dashed lines */}
              {theaterArcs.map((arc, i) => {
                const dist = Math.sqrt(Math.pow(arc.from.lat - arc.to.lat, 2) + Math.pow(arc.from.lon - arc.to.lon, 2));
                const arcHeight = Math.min(dist * 0.2, 5);
                const midLat = (arc.from.lat + arc.to.lat) / 2 + arcHeight;
                const midLon = (arc.from.lon + arc.to.lon) / 2;
                const points: [number, number][] = [];
                for (let t = 0; t <= 1; t += 0.03) {
                  const lat = (1 - t) * (1 - t) * arc.from.lat + 2 * (1 - t) * t * midLat + t * t * arc.to.lat;
                  const lon = (1 - t) * (1 - t) * arc.from.lon + 2 * (1 - t) * t * midLon + t * t * arc.to.lon;
                  points.push([lat, lon]);
                }
                return (
                  <Polyline key={`theater-arc-${i}`} positions={points}
                    pathOptions={{ color: arc.color, weight: 1.5, opacity: 0.25, dashArray: '8 6' }} />
                );
              })}
            </>
          );
        })()}

        {/* ═══ EXTREME SATELLITE CHANGES — War front hotspot clusters ═══ */}
        {showSatellite && (() => {
          // Group FIRMS hotspots by war front and highlight extreme clusters
          const fronts: { name: string; nameEn: string; lat: number; lon: number; color: string; hotspots: any[]; quakes: any[] }[] = [
            { name: 'לבנון', nameEn: 'Lebanon', lat: 33.85, lon: 35.86, color: '#ab47bc', hotspots: [], quakes: [] },
            { name: 'סוריה', nameEn: 'Syria', lat: 34.80, lon: 38.99, color: '#ff6d00', hotspots: [], quakes: [] },
            { name: 'איראן', nameEn: 'Iran', lat: 32.43, lon: 53.69, color: '#ff1744', hotspots: [], quakes: [] },
            { name: 'תימן', nameEn: 'Yemen', lat: 15.55, lon: 48.52, color: '#e65100', hotspots: [], quakes: [] },
            { name: 'עיראק', nameEn: 'Iraq', lat: 33.31, lon: 44.37, color: '#ff9100', hotspots: [], quakes: [] },
            { name: 'עזה', nameEn: 'Gaza', lat: 31.45, lon: 34.40, color: '#ff3d00', hotspots: [], quakes: [] },
          ];
          
          for (const h of satelliteHotspots) {
            const region = h.region || '';
            const front = fronts.find(f => region.includes(f.name));
            if (front) front.hotspots.push(h);
          }
          for (const q of satelliteEarthquakes) {
            const region = q.region || '';
            const front = fronts.find(f => region.includes(f.name));
            if (front) front.quakes.push(q);
          }
          
          const activeFronts = fronts.filter(f => f.hotspots.length > 0 || f.quakes.length > 0);
          if (activeFronts.length === 0) return null;
          
          const now = Date.now();
          const pulse = Math.sin(now / 500) * 0.4 + 0.6;
          
          return activeFronts.map(front => {
            const extreme = front.hotspots.filter(h => h.intensity === 'extreme' || h.intensity === 'high');
            const suspiciousQuakes = front.quakes.filter(q => q.possible_explosion);
            const totalSeverity = extreme.length + suspiciousQuakes.length * 3;
            if (totalSeverity === 0 && front.hotspots.length < 5) return null;
            
            const baseRingRadius = Math.min(80000, 25000 + totalSeverity * 8000);
            // Iran front gets 70% larger circle for visibility
            const ringRadius = front.nameEn === 'Iran' ? baseRingRadius * 1.7 : baseRingRadius;
            const label = `${front.name}: ${front.hotspots.length} 🔥${front.quakes.length > 0 ? ` ${front.quakes.length} 🌍` : ''}${suspiciousQuakes.length > 0 ? ` ${suspiciousQuakes.length} 💥` : ''}`;
            
            // Position label at top edge of the danger circle (offset north by ~ringRadius in degrees)
            const labelOffsetLat = ringRadius / 111320;
            const labelLat = front.lat + labelOffsetLat;
            
            // Front-specific alert banner (Iran, Yemen, Syria etc.)
            const isIran = front.nameEn === 'Iran';
            const isYemen = front.nameEn === 'Yemen';
            const isSyria = front.nameEn === 'Syria';
            const showBanner = isIran || isYemen || isSyria;
            const bannerLat = front.lat + labelOffsetLat + (isIran ? 0.8 : 0.4);
            
            // Threat classification per front
            const threatType = (() => {
              if (suspiciousQuakes.length > 0) return `🚨 זיהוי הכנה לשיגור — פיצוצים תת-קרקעיים`;
              if (extreme.length > 3) return `⚠️ פעילות חריגה — נקודות חום קיצוניות`;
              if (front.hotspots.length > 5) return `🔶 מעקב מוגבר — ריכוז נקודות חום`;
              if (isYemen) {
                if (extreme.length > 1) return `⚠️ חשד לשיגור טילים בליסטיים`;
                return `🔶 ניטור — פעילות חות'ית`;
              }
              if (isSyria) {
                if (extreme.length > 1) return `⚠️ תנועת כוחות חריגה`;
                return `🔶 ניטור — הגבול הסורי`;
              }
              return '🟡 ניטור שגרתי';
            })();
            
            // Timer: time since the last satellite review, not the oldest hotspot age
            const detectionMins = lastSatelliteCheckAt ? Math.max(0, Math.floor((Date.now() - lastSatelliteCheckAt) / 60000)) : 0;
            const detectionLabel = formatElapsedMinutes(detectionMins);
            
            return (
              <React.Fragment key={`front-${front.nameEn}`}>
                {/* Pulsing danger zone */}
                {totalSeverity > 2 && Number.isFinite(front?.lat) && Number.isFinite(front?.lon) && (
                  <Circle center={[front.lat, front.lon]} radius={ringRadius}
                    pathOptions={{ color: front.color, fillColor: front.color, fillOpacity: pulse * 0.12, weight: 2.5, opacity: pulse * 0.7, dashArray: '10 5' }} />
                )}
                
                {/* ── Front alert banner (Iran/Yemen/Syria) ── */}
                {showBanner && totalSeverity > 2 && (
                  <Marker position={[bannerLat, front.lon]} zIndexOffset={800}
                    eventHandlers={{ click: (e) => { e.target.openPopup(); } }}
                    icon={L.divIcon({
                      className: '',
                      html: `<div style="text-align:center;pointer-events:auto;cursor:pointer;transform:scale(0.4);transform-origin:center bottom;">
                        <div style="background:rgba(${isIran ? '180,0,0' : isYemen ? '160,80,0' : '180,100,0'},0.85);border:2px solid ${front.color};border-radius:6px;padding:4px 10px;white-space:nowrap;backdrop-filter:blur(6px);display:inline-block;box-shadow:0 0 20px ${front.color}66,0 0 40px ${front.color}22;animation:pulse 1.2s ease-in-out infinite;">
                          <div style="font-family:'Share Tech Mono',monospace;font-size:11px;color:#fff;font-weight:900;text-shadow:0 0 8px ${front.color},0 0 16px rgba(255,0,0,0.5);letter-spacing:1px;">
                            ${threatType}
                          </div>
                          <div style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:2px;">
                            <span style="font-family:'Share Tech Mono',monospace;font-size:9px;color:#ff8a80;">🛰️ ${front.hotspots.length} נק' חום${extreme.length > 0 ? ` · ${extreme.length} חריגות` : ''}${suspiciousQuakes.length > 0 ? ` · ${suspiciousQuakes.length} 💥` : ''}</span>
                            <span style="font-family:'Share Tech Mono',monospace;font-size:9px;color:#ffd600;font-weight:bold;">⏱ ${detectionLabel}</span>
                          </div>
                        </div>
                        <div style="width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:6px solid #ff1744;margin:0 auto;"></div>
                      </div>`,
                      iconSize: [300, 50], iconAnchor: [150, 50],
                    })}>
                    <Popup closeButton={false} className="hud-popup-custom" maxWidth={360}>
                      <div style={{ background: 'linear-gradient(135deg, rgba(30,0,0,0.97), rgba(50,5,5,0.98))', border: '2px solid #ff174466', borderRadius: '10px', padding: '14px', minWidth: '300px', maxWidth: '360px', color: '#fff', fontFamily: "'Share Tech Mono', monospace", boxShadow: '0 4px 30px rgba(255,23,68,0.3)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                          <span style={{ fontSize: '20px' }}>🛰️</span>
                          <div>
                            <div style={{ fontSize: '14px', fontWeight: 900, color: front.color }}>ניתוח לוויני — {front.name}</div>
                            <div style={{ fontSize: '9px', color: '#ff8a80' }}>{threatType}</div>
                          </div>
                        </div>
                        <div style={{ height: '1px', background: 'linear-gradient(90deg, transparent, #ff174444, transparent)', margin: '6px 0' }}></div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', marginBottom: '8px' }}>
                          <div style={{ background: 'rgba(255,23,68,0.1)', borderRadius: '4px', padding: '6px', border: '1px solid #ff174422' }}>
                            <div style={{ fontSize: '16px', fontWeight: 900, color: '#ff1744' }}>{front.hotspots.length}</div>
                            <div style={{ fontSize: '8px', color: '#b0bec5' }}>🔥 נקודות חום</div>
                          </div>
                          <div style={{ background: 'rgba(255,235,59,0.08)', borderRadius: '4px', padding: '6px', border: '1px solid #ffeb3b22' }}>
                            <div style={{ fontSize: '16px', fontWeight: 900, color: '#ffd600' }}>{detectionLabel}</div>
                            <div style={{ fontSize: '8px', color: '#b0bec5' }}>🕒 בדיקה אחרונה</div>
                          </div>
                          <div style={{ background: 'rgba(255,23,68,0.1)', borderRadius: '4px', padding: '6px', border: '1px solid #ff174422' }}>
                            <div style={{ fontSize: '16px', fontWeight: 900, color: '#ff6d00' }}>{extreme.length}</div>
                            <div style={{ fontSize: '8px', color: '#b0bec5' }}>⚡ חריגות קיצוניות</div>
                          </div>
                          <div style={{ background: 'rgba(255,23,68,0.15)', borderRadius: '4px', padding: '6px', border: '1px solid #ff174433' }}>
                            <div style={{ fontSize: '16px', fontWeight: 900, color: '#ff1744' }}>{suspiciousQuakes.length}</div>
                            <div style={{ fontSize: '8px', color: '#b0bec5' }}>💥 חשד פיצוצים</div>
                          </div>
                        </div>
                        {front.quakes.length > 0 && (
                          <div style={{ background: 'rgba(255,235,59,0.08)', borderRadius: '4px', padding: '4px 6px', marginBottom: '6px', border: '1px solid #ffeb3b22' }}>
                            <div style={{ fontSize: '9px', color: '#ffeb3b', fontWeight: 700 }}>🌍 רעידות אדמה: {front.quakes.length}</div>
                            <div style={{ fontSize: '8px', color: '#b0bec5' }}>{front.quakes.slice(0, 3).map((q: any) => 'M' + (q.magnitude || '?')).join(' · ')}</div>
                          </div>
                        )}
                        <div style={{ fontSize: '8px', color: '#546e7a', borderTop: '1px solid #333', paddingTop: '6px', marginTop: '4px' }}>
                          מקורות: NASA FIRMS · USGS · EONET | עדכון אוטומטי כל 5 דקות<br/>
                          קואורדינטות: {front.lat.toFixed(2)}°N {front.lon.toFixed(2)}°E
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                )}
                
                {/* Non-banner front label — small, semi-transparent */}
                {!showBanner && (
                  <Marker position={[front.lat, front.lon + (ringRadius / 111320) * 0.6]} zIndexOffset={400}
                    icon={L.divIcon({
                      className: '',
                      html: `<div style="transform:translate(-50%,-100%) scale(0.15);pointer-events:none;text-align:center;opacity:0.5;">
                        <div style="background:rgba(255,120,60,0.1);border:1px solid ${front.color}22;border-radius:2px;padding:1px 4px;white-space:nowrap;backdrop-filter:blur(2px);display:inline-block;">
                          <div style="font-family:'Share Tech Mono',monospace;font-size:7px;color:#fff;font-weight:900;text-shadow:0 0 4px ${front.color}, 0 0 8px rgba(0,0,0,0.9);opacity:0.95;">${label}</div>
                          ${totalSeverity > 5 ? `<div style="font-size:5px;color:#ffe0e0;font-weight:700;text-shadow:0 0 3px ${front.color};opacity:0.9;">⚠️ פעילות</div>` : ''}
                        </div>
                      </div>`,
                      iconSize: [0, 0], iconAnchor: [0, 0],
                    })}>
                    <Popup closeButton={false} className="hud-popup-custom">
                      <div style={{ background: 'rgba(10,10,20,0.95)', border: `1px solid ${front.color}66`, borderRadius: '8px', padding: '10px', minWidth: '200px', color: '#fff', fontFamily: "'Share Tech Mono', monospace" }}>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: front.color, marginBottom: '6px' }}>🛰️ ניתוח לווייני — {front.name}</div>
                        <div style={{ fontSize: '9px', color: '#b0bec5' }}>🔥 נקודות חום: {front.hotspots.length} ({extreme.length} חריגות)</div>
                        {front.quakes.length > 0 && <div style={{ fontSize: '9px', color: '#ffeb3b' }}>🌍 רעידות: {front.quakes.length}</div>}
                        {suspiciousQuakes.length > 0 && <div style={{ fontSize: '9px', color: '#ff1744', fontWeight: 700 }}>💥 חשד לפיצוצים: {suspiciousQuakes.length}</div>}
                        <div style={{ fontSize: '8px', color: '#546e7a', marginTop: '4px', borderTop: '1px solid #333', paddingTop: '4px' }}>
                          מקורות: NASA FIRMS, USGS, EONET | עדכון כל 5 דקות
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                )}
              </React.Fragment>
            );
          });
        })()}

        {/* ═══ LAUNCH DETECTION — REAL-TIME MISSILE ANIMATION ═══ */}
        {launchDetectionMarkers.map(det => {
          const launchTimeMs = new Date(det.time).getTime();
          const nowMs = Date.now();
          const ageMs = Math.max(0, nowMs - launchTimeMs);
          const ageMins = Math.floor(ageMs / 60000);
          const ageLabel = ageMins < 1 ? 'עכשיו' : ageMins < 60 ? `${ageMins}ד'` : `${Math.floor(ageMins / 60)}ש'`;

          // Match to MISSILE_SOURCES for flight params
          const matchedSource = MISSILE_SOURCES.find(ms =>
            det.origin.name.includes('איראן') && ms.id === 'iran' ||
            det.origin.name.includes('לבנון') && ms.id === 'lebanon_hzb' ||
            det.origin.name.includes('תימן') && ms.id === 'houthis' ||
            det.origin.name.includes('עיראק') && ms.id === 'iraq_militia'
          );
          const flightTimeSec = matchedSource?.flightTimeSec || 720;
          const maxAltKm = matchedSource?.maxAltKm || 300;
          const missileType = matchedSource?.missileType || 'Unknown';
          const defenseSystem = matchedSource?.defenseSystem || 'חץ';
          const threatCategory = matchedSource?.threatCategory || 'missile';

          // Color scheme: missiles = red, UAVs/drones = purple, cruise = orange
          const threatColors = {
            missile: { primary: '#ff1744', glow: '#ff0000', icon: '☄️' },
            rocket: { primary: '#ff6d00', glow: '#ff4400', icon: '🚀' },
            uav: { primary: '#ab47bc', glow: '#9c27b0', icon: '🛸' },
            cruise_missile: { primary: '#e65100', glow: '#bf360c', icon: '🎯' },
          };
          const tc = threatColors[threatCategory] || threatColors.missile;

          // Impact radius multiplier by threat type — ballistic = larger CEP, rockets = tighter
          const impactRadiusFactor = threatCategory === 'missile' ? 350 : threatCategory === 'cruise_missile' ? 250 : threatCategory === 'uav' ? 150 : 120; // rocket = smallest
          const impactInnerFactor = threatCategory === 'missile' ? 140 : threatCategory === 'cruise_missile' ? 100 : threatCategory === 'uav' ? 60 : 40;

          return (
            <React.Fragment key={det.id}>
              {/* Flashing rings around origin */}
              <Circle center={[det.origin.lat, det.origin.lon]} radius={80000}
                pathOptions={{ color: tc.primary, fillColor: tc.primary, fillOpacity: Math.abs(Math.sin(missileProgress * Math.PI * 6)) * 0.08, weight: 2, opacity: Math.abs(Math.sin(missileProgress * Math.PI * 6)) * 0.6, dashArray: '8 4' }} />
              <Circle center={[det.origin.lat, det.origin.lon]} radius={40000}
                pathOptions={{ color: tc.primary, fillColor: tc.primary, fillOpacity: Math.abs(Math.sin(missileProgress * Math.PI * 8 + 1)) * 0.12, weight: 2, opacity: Math.abs(Math.sin(missileProgress * Math.PI * 8 + 1)) * 0.8 }} />
              {/* Origin marker — click for popup details */}
              {/* Origin marker with strong pulse */}
              <Marker
                position={[det.origin.lat, det.origin.lon]}
                zIndexOffset={900}
                icon={L.divIcon({
                  className: '',
                  html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%) scale(${zoomScale});pointer-events:auto;">
                    <div style="font-size:28px;filter:drop-shadow(0 0 12px ${tc.primary}) drop-shadow(0 0 24px ${tc.glow});animation:pulse 0.5s infinite;">${tc.icon}</div>
                    <div style="font-family:'Share Tech Mono',monospace;font-size:10px;color:${tc.primary};text-shadow:0 0 8px ${tc.glow},0 1px 4px rgba(0,0,0,1);white-space:nowrap;font-weight:900;margin-top:2px;letter-spacing:1px;animation:pulse 0.7s infinite;">${det.origin.name} — ${threatCategory === 'uav' ? 'כטב"מ!' : threatCategory === 'cruise_missile' ? 'טיל שיוט!' : 'שיגור!'}</div>
                  </div>`,
                  iconSize: [100, 60],
                  iconAnchor: [50, 60],
                })}
              >
                <Popup closeButton={false} className="hud-popup-custom" offset={[0, -15]}>
                  <div style={{
                    fontFamily: "'Share Tech Mono', monospace",
                    background: 'linear-gradient(135deg, rgba(30,0,0,0.96), rgba(50,5,5,0.98))',
                    border: '1px solid #ff174444',
                    borderRadius: '6px', padding: '10px 12px', minWidth: '240px', maxWidth: '300px',
                    boxShadow: '0 2px 16px rgba(0,0,0,0.6), 0 0 20px #ff174420',
                    color: '#e0e0e0', direction: 'rtl',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
                      <span style={{ fontSize: '14px' }}>🚀</span>
                      <span style={{ fontSize: '11px', fontWeight: 700, color: '#ff1744' }}>זיהוי שיגור — {det.origin.name}</span>
                    </div>
                    <div style={{ height: '1px', background: 'linear-gradient(90deg, transparent, #ff174444, transparent)', margin: '4px 0 6px' }} />
                    <div style={{ fontSize: '9px', color: '#b0bec5', lineHeight: '1.5', marginBottom: '6px' }}>{det.text}</div>
                    <div style={{ display: 'flex', gap: '6px', fontSize: '8px', flexWrap: 'wrap' }}>
                      <span style={{ color: '#ff6d00', background: '#ff6d0015', padding: '1px 4px', borderRadius: 3 }}>מקור: {det.source}</span>
                      <span style={{ color: '#ffd600', background: '#ffd60015', padding: '1px 4px', borderRadius: 3 }}>ביטחון: {det.confidence}%</span>
                      <span style={{ color: '#78909c' }}>⏱ {ageLabel}</span>
                      <span style={{ color: '#ff80ab', background: '#ff80ab15', padding: '1px 4px', borderRadius: 3 }}>🎯 {missileType}</span>
                    </div>
                    <div style={{ marginTop: '6px', fontSize: '8px', color: '#ff174499' }}>
                      יעדים משוערים: {det.targets.map(t => t.name).join(', ')}
                    </div>
                    <div style={{ marginTop: '4px', fontSize: '8px', color: '#4fc3f7' }}>
                      🛡 הגנה: {defenseSystem} | זמן מעוף: {Math.floor(flightTimeSec / 60)} דקות
                    </div>
                  </div>
                </Popup>
              </Marker>

              {/* ═══ Animated trajectories to each target ═══ */}
              {det.targets.map((target, ti) => {
                // Real-time progress based on launch time
                const totalFlightMs = flightTimeSec * 1000;
                const elapsedSinceLaunch = ageMs - ti * 30000; // stagger 30s between targets
                // If not launched yet for this target, use demo animation
                const useRealTime = elapsedSinceLaunch > 0 && elapsedSinceLaunch < totalFlightMs;
                const realProgress = useRealTime ? elapsedSinceLaunch / totalFlightMs : null;
                // Fallback: looping demo animation
                const p = realProgress !== null ? Math.min(realProgress, 0.99) : (missileProgress + ti * 0.15) % 1;
                const isComplete = realProgress !== null && realProgress >= 1;

                // Distance calculation
                const dLat = target.lat - det.origin.lat;
                const dLon = target.lon - det.origin.lon;
                const distKm = Math.sqrt(dLat * dLat + dLon * dLon) * 111;

                // ETA
                const etaMs = useRealTime ? Math.max(0, totalFlightMs - elapsedSinceLaunch) : flightTimeSec * 1000 * (1 - p);
                const etaSec = Math.floor(etaMs / 1000);
                const etaMin = Math.floor(etaSec / 60);
                const etaSecRem = etaSec % 60;
                const etaLabel = etaMin > 0 ? `${etaMin}:${String(etaSecRem).padStart(2, '0')}` : `${etaSec}s`;
                const speedKmH = distKm / flightTimeSec * 3600;

                // Arc geometry
                const arcSteps = 40;
                const arcPoints: [number, number][] = [];
                const traveledArc: [number, number][] = [];
                const remainingArc: [number, number][] = [];
                const perpX = -dLat;
                const perpY = dLon;
                const perpLen = Math.sqrt(perpX * perpX + perpY * perpY);
                const normPX = perpLen > 0 ? perpX / perpLen : 0;
                const normPY = perpLen > 0 ? perpY / perpLen : 0;
                const bulgeFactor = Math.min(0.15, maxAltKm * 0.0003);

                for (let i = 0; i <= arcSteps; i++) {
                  const t = i / arcSteps;
                  const baseLat = det.origin.lat + dLat * t;
                  const baseLon = det.origin.lon + dLon * t;
                  const arcHeight = 4 * t * (1 - t) * bulgeFactor;
                  const ptLat = baseLat + normPY * arcHeight;
                  const ptLon = baseLon + normPX * arcHeight;
                  arcPoints.push([ptLat, ptLon]);
                  if (t <= p) traveledArc.push([ptLat, ptLon]);
                  if (t >= p) remainingArc.push([ptLat, ptLon]);
                }

                // Missile position on arc
                const pIdx = p * arcSteps;
                const idx0 = Math.min(Math.floor(pIdx), arcSteps - 1);
                const idx1 = Math.min(idx0 + 1, arcSteps);
                const frac = pIdx - idx0;
                const pt0 = arcPoints[idx0];
                const pt1 = arcPoints[idx1];
                let missileLat = pt0[0] + (pt1[0] - pt0[0]) * frac;
                let missileLon = pt0[1] + (pt1[1] - pt0[1]) * frac;
                let bearing = Math.atan2(pt1[1] - pt0[1], pt1[0] - pt0[0]) * (180 / Math.PI);
                const altKm = maxAltKm * 4 * p * (1 - p);
                const flash = Math.abs(Math.sin(missileProgress * Math.PI * 4));

                // Flight phase
                const phase = p < 0.1 ? 'BOOST' : p < 0.25 ? 'ASCENT' : p < 0.55 ? 'MIDCOURSE' : p < 0.85 ? 'TERMINAL' : 'IMPACT';
                const phaseColor = phase === 'BOOST' ? '#ff6d00' : phase === 'ASCENT' ? '#ffd600' : phase === 'MIDCOURSE' ? '#ff9100' : phase === 'TERMINAL' ? '#ff1744' : '#ff0000';

                const phaseLabels = [
                  { t: 0.05, label: '🔥 BOOST', color: '#ff6d00' },
                  { t: 0.20, label: `↗ ${Math.round(maxAltKm * 0.3)}km`, color: '#ffd600' },
                  { t: 0.50, label: `APOGEE ${maxAltKm}km`, color: '#ff9100' },
                  { t: 0.75, label: '↘ RE-ENTRY', color: '#ff3d00' },
                  { t: 0.92, label: '💥 TERMINAL', color: '#ff1744' },
                ];

                if (isComplete) {
                  // Show impact marker
                  return (
                    <React.Fragment key={`${det.id}-traj-${ti}`}>
                      <Circle
                        center={[target.lat, target.lon]}
                        radius={target.radiusKm * impactRadiusFactor}
                        pathOptions={{ color: tc.primary, fillColor: tc.primary, fillOpacity: 0.15, weight: 2, opacity: 0.8 }}
                      />
                      <Marker position={[target.lat, target.lon]} interactive={false} icon={L.divIcon({
                        className: '',
                        html: `<div style="font-family:'Share Tech Mono',monospace;font-size:10px;color:#ff1744;text-shadow:0 0 8px #ff0000;white-space:nowrap;transform:translate(-50%,-50%) scale(${zoomScale});font-weight:bold;animation:pulse 0.5s infinite;">💥 IMPACT — ${target.name}</div>`,
                        iconSize: [0, 0], iconAnchor: [0, 0],
                      })} />
                    </React.Fragment>
                  );
                }

                return (
                  <React.Fragment key={`${det.id}-traj-${ti}`}>
                    {/* Full arc — faint base */}
                    <Polyline positions={arcPoints} pathOptions={{ color: tc.primary, weight: 3, opacity: 0.08, dashArray: '2 4' }} />
                    {/* Traveled arc — bright neon */}
                    {traveledArc.length >= 2 && (
                      <>
                        <Polyline positions={traveledArc} pathOptions={{ color: tc.primary, weight: threatCategory === 'uav' ? 3 : 5, opacity: 0.4 }} />
                        <Polyline positions={traveledArc} pathOptions={{ color: '#fff', weight: 1.5, opacity: 0.85 }} />
                      </>
                    )}
                    {/* Remaining arc — dashed prediction (UAVs get dotted path to show flight route) */}
                    {remainingArc.length >= 2 && (
                      <Polyline positions={remainingArc} pathOptions={{ color: tc.primary, weight: threatCategory === 'uav' ? 2 : 2.5, opacity: 0.5, dashArray: threatCategory === 'uav' ? '4 8' : '8 4' }} />
                    )}
                    {/* Smoke trail */}
                    {[0.02, 0.06, 0.1, 0.15, 0.2, 0.26, 0.32, 0.38, 0.44, 0.5, 0.56, 0.62, 0.68].filter(t => t < p).map((t, i) => {
                      const idx = Math.round(t * arcSteps);
                      const pt = arcPoints[idx];
                      if (!pt) return null;
                      const age = (p - t) / Math.max(p, 0.01);
                      return (
                        <CircleMarker key={`smoke-det-${det.id}-${ti}-${i}`} center={pt} radius={1 + age * 2.5}
                          pathOptions={{ color: '#fff', fillColor: '#fff', fillOpacity: Math.max(0, 0.5 - age * 0.45), weight: 0 }} interactive={false} />
                      );
                    })}
                    {/* Phase labels */}
                    {phaseLabels.map(ph => {
                      const idx = Math.round(ph.t * arcSteps);
                      const pt = arcPoints[idx];
                      if (!pt) return null;
                      const isPast = ph.t <= p;
                      return (
                        <Marker key={`phase-det-${det.id}-${ti}-${ph.t}`} position={pt} interactive={false}
                          icon={L.divIcon({
                            className: '',
                            html: `<div style="font-family:'Share Tech Mono',monospace;font-size:6px;color:${isPast ? ph.color : ph.color + '55'};text-shadow:0 0 3px rgba(0,0,0,0.9);white-space:nowrap;transform:translate(-50%,-120%);pointer-events:none;">${ph.label}</div>`,
                            iconSize: [0, 0], iconAnchor: [0, 0],
                          })} />
                      );
                    })}
                    {/* ═══ ANIMATED MISSILE HEAD ═══ */}
                    <Marker
                      position={[missileLat, missileLon]}
                      zIndexOffset={1000}
                      interactive={false}
                      icon={L.divIcon({
                        className: '',
                        html: `<div style="transform:translate(-50%,-50%) rotate(${90 - bearing}deg);font-size:16px;filter:drop-shadow(0 0 10px ${flash > 0.5 ? '#ff1744' : '#ff6d00'});pointer-events:none;transition:transform 0.08s linear;">🚀</div>`,
                        iconSize: [24, 24],
                        iconAnchor: [12, 12],
                      })}
                    />
                    {/* HUD info at missile position */}
                    <Marker
                      position={[missileLat, missileLon]}
                      zIndexOffset={1001}
                      interactive={false}
                      icon={L.divIcon({
                        className: '',
                        html: `<div style="font-family:'Share Tech Mono',monospace;transform:translate(14px,-24px);pointer-events:none;white-space:nowrap;">
                          <div style="font-size:7px;color:${phaseColor};font-weight:bold;text-shadow:0 0 4px rgba(0,0,0,1);letter-spacing:0.5px;">${phase}</div>
                          <div style="font-size:6px;color:#ffd600;text-shadow:0 0 3px rgba(0,0,0,0.9);">ALT: ${Math.round(altKm)}km | ${Math.round(speedKmH)}km/h</div>
                          <div style="font-size:7px;color:#ff1744;font-weight:bold;text-shadow:0 0 4px rgba(0,0,0,1);">⏱ ETA: ${etaLabel} → ${target.name}</div>
                        </div>`,
                        iconSize: [0, 0], iconAnchor: [0, 0],
                      })}
                    />
                    {/* Impact zone at target — sized by threat type */}
                    <Circle center={[target.lat, target.lon]} radius={target.radiusKm * impactRadiusFactor}
                      pathOptions={{ color: tc.primary, fillColor: tc.primary, fillOpacity: 0.05 + flash * 0.08, weight: 1.5, opacity: 0.3 + flash * 0.4, dashArray: '6 4' }} />
                    <Circle center={[target.lat, target.lon]} radius={target.radiusKm * impactInnerFactor}
                      pathOptions={{ color: tc.primary, fillColor: tc.primary, fillOpacity: 0.1 + flash * 0.15, weight: 2, opacity: 0.6 + flash * 0.3 }} />
                    <Marker position={[target.lat, target.lon]} interactive={false} icon={L.divIcon({
                      className: '',
                      html: `<div style="font-family:'Share Tech Mono',monospace;font-size:8px;color:#ff1744;text-shadow:0 1px 3px rgba(0,0,0,1);white-space:nowrap;transform:translate(-50%,-120%);pointer-events:none;font-weight:bold;">⊕ ${target.name} · ETA ${etaLabel}</div>`,
                      iconSize: [0, 0], iconAnchor: [0, 0],
                    })} />

                    {/* ═══ INTERCEPTOR SYSTEM — Arrow/David's Sling ═══ */}
                    {(() => {
                      const interceptLaunchAt = 0.50;
                      if (p < interceptLaunchAt) return null;

                      const defenseType = defenseSystem.includes('חץ') ? 'arrow' 
                        : defenseSystem.includes('קלע') ? 'davids_sling' 
                        : defenseSystem.includes('קרן') ? 'iron_beam' : 'iron_dome';
                      const isHighValue = threatCategory === 'missile' || threatCategory === 'cruise_missile';
                      const allTypes = new Set([defenseType]);
                      if (isHighValue) { allTypes.add('davids_sling'); allTypes.add('patriot'); }
                      else allTypes.add('iron_dome');

                      const matchingBatteries = DEFENSE_SYSTEMS.filter(d => allTypes.has(d.type))
                        .map(b => ({ ...b, dist: Math.sqrt((b.lat - target.lat) ** 2 + (b.lon - target.lon) ** 2) }))
                        .sort((a, b) => a.dist - b.dist)
                        .slice(0, isHighValue ? 4 : 2);

                      if (matchingBatteries.length === 0) return null;

                      const interceptPointT = 0.80;
                      const interceptorProgress = Math.min(1, (p - interceptLaunchAt) / (interceptPointT - interceptLaunchAt));
                      const hasIntercepted = p >= interceptPointT;
                      const explosionFade = hasIntercepted ? Math.max(0, 1 - (p - interceptPointT) / 0.15) : 0;
                      const interceptIdx = Math.round(interceptPointT * arcSteps);
                      const interceptPt = arcPoints[interceptIdx];
                      if (!interceptPt) return null;

                      const sysColor: Record<string, string> = { iron_dome: '#4fc3f7', davids_sling: '#ce93d8', arrow: '#ffb74d', patriot: '#42a5f5', iron_beam: '#76ff03' };
                      const sysIcon: Record<string, string> = { iron_dome: '🛡️', davids_sling: '⚔️', arrow: '🏹', patriot: '🇺🇸', iron_beam: '✴️' };
                      const sysLabel: Record<string, string> = { iron_dome: 'כיפת ברזל', davids_sling: 'קלע דוד', arrow: 'חץ', patriot: 'AEGIS SM-3', iron_beam: 'קרן ברזל' };

                      return (
                        <>
                          {matchingBatteries.map((battery, bi) => {
                            const color = sysColor[battery.type] || '#4fc3f7';
                            const icon = sysIcon[battery.type] || '🛡️';
                            const label = sysLabel[battery.type] || battery.name;

                            // Interceptor arc from battery to intercept point
                            const intArcSteps = 20;
                            const intArcPts: [number, number][] = [];
                            const iDLat = interceptPt[0] - battery.lat;
                            const iDLon = interceptPt[1] - battery.lon;
                            const iPerpX = -iDLat;
                            const iPerpY = iDLon;
                            const iPerpLen = Math.sqrt(iPerpX * iPerpX + iPerpY * iPerpY);
                            const iNPX = iPerpLen > 0 ? iPerpX / iPerpLen : 0;
                            const iNPY = iPerpLen > 0 ? iPerpY / iPerpLen : 0;
                            const iBulge = 0.08;
                            for (let j = 0; j <= intArcSteps; j++) {
                              const t = j / intArcSteps;
                              const bLat = battery.lat + iDLat * t;
                              const bLon = battery.lon + iDLon * t;
                              const ah = 4 * t * (1 - t) * iBulge;
                              intArcPts.push([bLat + iNPY * ah, bLon + iNPX * ah]);
                            }
                            const intTraveled = intArcPts.filter((_, j) => j / intArcSteps <= interceptorProgress);
                            // Interceptor missile position
                            const iIdx = Math.min(Math.floor(interceptorProgress * intArcSteps), intArcSteps - 1);
                            const iIdx1 = Math.min(iIdx + 1, intArcSteps);
                            const iFrac = interceptorProgress * intArcSteps - iIdx;
                            const intMissileLat = intArcPts[iIdx][0] + (intArcPts[iIdx1][0] - intArcPts[iIdx][0]) * iFrac;
                            const intMissileLon = intArcPts[iIdx][1] + (intArcPts[iIdx1][1] - intArcPts[iIdx][1]) * iFrac;
                            const intBearing = Math.atan2(intArcPts[iIdx1][1] - intArcPts[iIdx][1], intArcPts[iIdx1][0] - intArcPts[iIdx][0]) * (180 / Math.PI);

                            return (
                              <React.Fragment key={`int-det-${det.id}-${ti}-${bi}`}>
                                {/* Battery marker — prominent */}
                                <Marker position={[battery.lat, battery.lon]} interactive={false} icon={L.divIcon({
                                  className: '',
                                  html: `<div style="font-size:20px;transform:translate(-50%,-50%);filter:drop-shadow(0 0 10px ${color}) drop-shadow(0 0 20px ${color}88);pointer-events:none;animation:pulse 1s infinite;">${icon}</div>`,
                                  iconSize: [28, 28], iconAnchor: [14, 14],
                                })} />
                                {/* Battery label */}
                                <Marker position={[battery.lat, battery.lon]} interactive={false} icon={L.divIcon({
                                  className: '',
                                  html: `<div style="font-family:'Share Tech Mono',monospace;font-size:7px;color:${color};text-shadow:0 0 6px rgba(0,0,0,1),0 0 12px ${color}44;white-space:nowrap;transform:translate(-50%,14px);pointer-events:none;font-weight:bold;letter-spacing:0.5px;">${label} — LAUNCH</div>`,
                                  iconSize: [0, 0], iconAnchor: [0, 0],
                                })} />
                                {/* Interceptor arc trail — thick glowing line */}
                                {intTraveled.length >= 2 && (
                                  <>
                                    {/* Outer glow */}
                                    <Polyline positions={intTraveled} pathOptions={{ color, weight: 10, opacity: 0.12 }} />
                                    {/* Main trail — same thickness as threat */}
                                    <Polyline positions={intTraveled} pathOptions={{ color, weight: 5, opacity: 0.7 }} />
                                    {/* Inner bright core */}
                                    <Polyline positions={intTraveled} pathOptions={{ color: '#fff', weight: 2, opacity: 0.9 }} />
                                    {/* Iron Beam special: phosphorescent white-green laser — thin, no background */}
                                    {battery.type === 'iron_beam' && (
                                      <>
                                        <Polyline positions={intTraveled} pathOptions={{ color: '#b9f6ca', weight: 2.5, opacity: 0.5 + Math.abs(Math.sin(missileProgress * Math.PI * 14)) * 0.4 }} />
                                        <Polyline positions={intTraveled} pathOptions={{ color: '#e0ffe0', weight: 1, opacity: 0.9 }} />
                                      </>
                                    )}
                                    {/* David's Sling special: bright cyan beam */}
                                    {battery.type === 'davids_sling' && (
                                      <>
                                        <Polyline positions={intTraveled} pathOptions={{ color: '#00e5ff', weight: 8, opacity: 0.2 + Math.abs(Math.sin(missileProgress * Math.PI * 8)) * 0.25 }} />
                                        <Polyline positions={intTraveled} pathOptions={{ color: '#b2ebf2', weight: 2, opacity: 0.85 }} />
                                      </>
                                    )}
                                  </>
                                )}
                                {/* Interceptor dashed prediction — visible */}
                                <Polyline positions={intArcPts} pathOptions={{ color, weight: 2.5, opacity: 0.25, dashArray: '6 4' }} />
                                {/* Interceptor missile head — large, matching threat icon size */}
                                {!hasIntercepted && (
                                  <Marker position={[intMissileLat, intMissileLon]} zIndexOffset={999} interactive={false} icon={L.divIcon({
                                    className: '',
                                    html: `<div style="transform:translate(-50%,-50%) rotate(${90 - intBearing}deg);font-size:20px;filter:drop-shadow(0 0 12px ${color}) drop-shadow(0 0 24px ${color}88);pointer-events:none;animation:pulse 0.6s infinite;">${icon}</div>`,
                                    iconSize: [28, 28], iconAnchor: [14, 14],
                                  })} />
                                )}
                              </React.Fragment>
                            );
                          })}
                          {/* Explosion at intercept point */}
                          {hasIntercepted && explosionFade > 0 && (
                            <>
                              <Circle center={interceptPt} radius={4000 * (1 + (1 - explosionFade) * 2)}
                                pathOptions={{ color: '#ffd600', fillColor: '#ffd600', fillOpacity: explosionFade * 0.3, weight: 2, opacity: explosionFade * 0.8 }} />
                              <Circle center={interceptPt} radius={1500 * (1 + (1 - explosionFade))}
                                pathOptions={{ color: '#fff', fillColor: '#fff', fillOpacity: explosionFade * 0.5, weight: 1, opacity: explosionFade }} />
                              <Marker position={interceptPt} interactive={false} icon={L.divIcon({
                                className: '',
                                html: `<div style="font-family:'Share Tech Mono',monospace;font-size:9px;color:#4fc3f7;text-shadow:0 0 6px rgba(0,0,0,1);white-space:nowrap;transform:translate(-50%,-50%);font-weight:bold;opacity:${explosionFade};">✅ INTERCEPTED</div>`,
                                iconSize: [0, 0], iconAnchor: [0, 0],
                              })} />
                            </>
                          )}
                        </>
                      );
                    })()}
                  </React.Fragment>
                );
              })}
            </React.Fragment>
          );
        })}

        {/* ═══ IAF Foreign Strike Markers — explosions on Lebanon/Iran/Syria ═══ */}
        {foreignStrikeMarkers.map(s => {
          const ageMs = Math.max(0, Date.now() - new Date(s.time).getTime());
          const ageMins = Math.floor(ageMs / 60000);
          const ageLabel = ageMins < 60 ? `${ageMins}ד'` : ageMins < 1440 ? `${Math.floor(ageMins / 60)}ש'` : `${Math.floor(ageMins / 1440)} ימים`;
          const attackerLabel = s.attacker.includes('🇺🇸') && s.attacker.includes('🇮🇱') ? 'ישראל + ארה"ב' : s.attacker.includes('🇺🇸') ? 'ארה"ב' : 'ישראל';
          const TYPE_LABELS: Record<string, string> = { nuclear: '☢️ גרעיני', missile: '🚀 טילים', naval: '⚓ ימי', airbase: '✈️ בסיס אווירי', hq: '🏢 מפקדה', weapons: '💣 נשק', targeted: '🎯 חיסול', launcher: '🚀 משגרים', convoy: '🚛 שיירה', tunnel: '🕳️ מנהרה', ground: '⚔️ קרקעי', energy: '⚡ אנרגיה', military: '🎖️ צבאי', unknown: '💥 תקיפה' };
          const typeLabel = TYPE_LABELS[s.type] || '💥 תקיפה';
          const statusText = s.verified ? '✅ מאומת' : '⏳ ממתין לאימות';
          return (
            <React.Fragment key={s.id}>
              <CircleMarker
                center={[s.lat, s.lon]}
                radius={7}
                pathOptions={{ color: '#ffd600', fillColor: '#ffd600', fillOpacity: 0.9, weight: 2, opacity: 1 }}
              >
                <Popup closeButton={false} className="hud-popup-custom" offset={[0, -8]}>
                  <div style={{
                    fontFamily: "'Share Tech Mono', monospace",
                    background: 'linear-gradient(135deg, rgba(20,5,0,0.96), rgba(40,15,0,0.98))',
                    border: '1px solid #ffd60044',
                    borderRadius: '6px', padding: '10px 12px', minWidth: '200px', maxWidth: '260px',
                    boxShadow: '0 2px 16px rgba(0,0,0,0.6), 0 0 12px #ffd60020',
                    color: '#e0e0e0', direction: 'rtl',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '16px' }}>{s.icon}</span>
                        <div>
                          <div style={{ fontSize: '11px', fontWeight: 700, color: '#ffd600' }}>{s.attacker} {attackerLabel}</div>
                          <div style={{ fontSize: '8px', color: '#ffd600aa' }}>{typeLabel}</div>
                        </div>
                      </div>
                    </div>
                    <div style={{ height: '1px', background: 'linear-gradient(90deg, transparent, #ffd60044, transparent)', margin: '4px 0 6px' }} />
                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#fff', marginBottom: '4px' }}>
                      📍 {s.locationName} {s.country ? `(${s.country})` : ''}
                    </div>
                    <div style={{ fontSize: '9px', color: '#b0bec5', lineHeight: '1.6', whiteSpace: 'pre-wrap', marginBottom: '6px' }}>{s.text}</div>
                    <div style={{ background: '#ffd60010', border: '1px solid #ffd60022', borderRadius: '4px', padding: '4px 6px', marginBottom: '4px' }}>
                      <div style={{ fontSize: '7px', fontWeight: 700, color: '#ffd600cc', marginBottom: '2px' }}>אימות מיקום:</div>
                      <div style={{ fontSize: '7px', color: '#90a4ae', lineHeight: '1.5' }}>
                        ✓ קואורדינטות: {s.lat.toFixed(4)}°N, {s.lon.toFixed(4)}°E<br/>
                        ✓ מקורות: {s.verificationSources}<br/>
                        ✓ סטטוס: {statusText}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: '1px solid #ffd60022', paddingTop: '4px' }}>
                      <span style={{ fontSize: '8px', color: '#ffd600' }}>{statusText}</span>
                      <span style={{ fontSize: '8px', color: '#78909c' }}>⏱ {ageLabel}</span>
                    </div>
                  </div>
                </Popup>
              </CircleMarker>
            </React.Fragment>
          );
        })}

        {/* ═══ Maritime Layer — ships & threats (divIcon like defense layer) ═══ */}
        {showMaritime && maritimeVessels.map(vessel => {
          const vColor = getVesselColor(vessel.type);
          const vIcon = getVesselIcon(vessel.type);
          const isThreat = vessel.type === 'threat' || vessel.type === 'military_hostile';
          return (
            <Marker
              key={vessel.id}
              position={[vessel.lat, vessel.lon]}
              zIndexOffset={isThreat ? 700 : 400}
              icon={createMaritimeIcon(vessel, vColor, vIcon, isThreat)}
            >
              <Popup>
                <div style={{ fontFamily: 'Share Tech Mono, monospace', fontSize: 11, minWidth: 200, background: '#0a1628', color: '#e0f7fa', padding: 8, borderRadius: 4, border: `1px solid ${vColor}44` }} dir="ltr">
                  <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6, color: vColor }}>
                    {vIcon} {vessel.name}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 12px', fontSize: 10 }}>
                    <span style={{ color: '#78909c' }}>FLAG:</span><span>{vessel.flag}</span>
                    <span style={{ color: '#78909c' }}>TYPE:</span><span style={{ color: vColor }}>{vessel.type.replace('_', ' ').toUpperCase()}</span>
                    <span style={{ color: '#78909c' }}>HEADING:</span><span>{vessel.heading}°</span>
                    <span style={{ color: '#78909c' }}>SPEED:</span><span>{vessel.speed} kn</span>
                    <span style={{ color: '#78909c' }}>SIZE:</span><span>{vessel.tonnage}</span>
                    <span style={{ color: '#78909c' }}>STATUS:</span><span style={{ color: isThreat ? '#ff1744' : '#4fc3f7' }}>{vessel.status.replace(/_/g, ' ').toUpperCase()}</span>
                  </div>
                  <div style={{ marginTop: 6, fontSize: 9, color: '#546e7a', borderTop: '1px solid #ffffff10', paddingTop: 4 }}>
                    📍 {vessel.lat.toFixed(4)}°N, {vessel.lon.toFixed(4)}°E
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* ═══ Maritime Zones — Mine fields, NATO areas, Exclusion zones ═══ */}
        {showMaritime && maritimeZones.map(zone => {
          const isMine = zone.type === 'mine';
          const isExclusion = zone.type === 'exclusion';
          return (
            <Polygon
              key={zone.id}
              positions={zone.positions}
              pathOptions={{
                color: zone.color,
                fillColor: zone.color,
                fillOpacity: isMine ? 0.25 : isExclusion ? 0.15 : 0.08,
                weight: isMine ? 2.5 : 1.5,
                dashArray: isMine ? '8,6' : isExclusion ? '12,4' : '5,10',
              }}
            >
              <Popup>
                <div style={{ fontFamily: 'Share Tech Mono, monospace', fontSize: 11, minWidth: 220, background: '#0a1628', color: '#e0f7fa', padding: 10, borderRadius: 4, border: `1px solid ${zone.color}55` }} dir="rtl">
                  <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: zone.color }}>
                    {zone.name}
                  </div>
                  <div style={{ fontSize: 10, color: '#b0bec5', marginBottom: 4 }}>{zone.nameEn}</div>
                  <div style={{ fontSize: 10, color: isMine ? '#ff8a80' : '#80cbc4', lineHeight: 1.5 }}>{zone.info}</div>
                  <div style={{ marginTop: 6, fontSize: 9, color: '#546e7a', borderTop: '1px solid #ffffff10', paddingTop: 4 }}>
                    {isMine ? '💣 MINE DANGER AREA' : isExclusion ? '🔒 RESTRICTED ZONE' : '🛡️ MILITARY ACTIVITY AREA'}
                  </div>
                </div>
              </Popup>
            </Polygon>
          );
        })}


        {showVehicles && vehicleDispatchEvents.filter(evt => {
          const service = getEmergencyEventService(evt);
          if (service === 'fire') return showFireDept;
          if (service === 'police') return showPoliceDept;
          if (service === 'mda' || service === 'traffic') return showMda;
          return false;
        }).map((evt, i) => {
          const evtColor = evt.color === 'red' ? '#ff1744' : evt.color === 'orange' ? '#ff6d00' : '#ffab00';
          const text = (evt.title || '') + ' ' + (evt.description || '') + ' ' + (evt.source || '');
          const service = getEmergencyEventService(evt);
          const isFire = service === 'fire';
          const isPolice = service === 'police';
          const isTraffic = service === 'traffic';
          const vehicleIcon = isFire ? '🚒' : isPolice ? '🚔' : isTraffic ? '🚗' : '🚑';
          const vehicleLabel = isFire ? 'כיבוי אש' : isPolice ? 'משטרה' : isTraffic ? 'תנועה' : 'מד"א';
          const vehicleColor = isFire ? '#ff6d00' : isPolice ? '#2196f3' : isTraffic ? '#ffffff' : '#ff1744';
          const isMda = !isFire && !isPolice && !isTraffic;
          // MDA event type classification
          const mdaType = classifyMdaEvent(text);
          const pulse = Math.abs(Math.sin(missileProgress * Math.PI * 2 + i * 0.5));
          const fastFlash = Math.abs(Math.sin(missileProgress * Math.PI * 8 + i * 1.3));
          
          // ETA calculation — prefer real OSRM duration when available
          const evtAge = Date.now() - (evt.event_time ? new Date(evt.event_time).getTime() : new Date(evt.created_at).getTime());
          const fallbackEtaSec = isFire ? 420 : isPolice ? 300 : 360;
          // Try to get OSRM route for the primary vehicle to use real travel time
          const stationType0 = isFire ? 'fire' : isPolice ? 'police' : 'mda';
          const STATIONS_PRE = [
            { lat: 32.06, lon: 34.79, type: 'mda' }, { lat: 31.78, lon: 35.20, type: 'mda' },
            { lat: 32.80, lon: 35.00, type: 'mda' }, { lat: 31.26, lon: 34.80, type: 'mda' },
            { lat: 32.10, lon: 34.89, type: 'mda' }, { lat: 32.34, lon: 34.87, type: 'mda' },
            { lat: 31.81, lon: 34.66, type: 'mda' }, { lat: 33.21, lon: 35.57, type: 'mda' },
            { lat: 32.09, lon: 34.78, type: 'fire' }, { lat: 31.76, lon: 35.22, type: 'fire' },
            { lat: 32.78, lon: 34.98, type: 'fire' }, { lat: 31.98, lon: 34.81, type: 'fire' },
            { lat: 31.24, lon: 34.78, type: 'fire' },
            { lat: 32.07, lon: 34.80, type: 'police' }, { lat: 31.79, lon: 35.22, type: 'police' },
            { lat: 32.81, lon: 35.01, type: 'police' },
          ];
          const nearestSt = STATIONS_PRE.filter(s => s.type === stationType0)
            .sort((a, b) => Math.hypot(a.lat - evt.lat!, a.lon - evt.lon!) - Math.hypot(b.lat - evt.lat!, b.lon - evt.lon!))[0];
          const osrmForEta = nearestSt ? getRoute({ fromLat: nearestSt.lat, fromLon: nearestSt.lon, toLat: evt.lat!, toLon: evt.lon! }) : null;
          // Emergency vehicles with sirens travel ~1.6x faster than normal traffic; cap at 15 min max
          const EMERGENCY_SPEED_FACTOR = 0.6; // 60% of normal travel time
          const MAX_ETA_SEC = 900; // 15 min cap
          const rawEtaSec = (osrmForEta && osrmForEta.duration > 0) ? osrmForEta.duration * EMERGENCY_SPEED_FACTOR : fallbackEtaSec;
          const etaBaseSec = Math.min(rawEtaSec, MAX_ETA_SEC);
          const routeDistKm = (osrmForEta && osrmForEta.distance > 0) ? (osrmForEta.distance / 1000) : 0;
          const etaRemainingMs = Math.max(0, etaBaseSec * 1000 - evtAge);
          const etaMins = Math.floor(etaRemainingMs / 60000);
          const etaSecs = Math.floor((etaRemainingMs % 60000) / 1000);
          const etaStr = etaRemainingMs > 0 ? `${String(etaMins).padStart(2,'0')}:${String(etaSecs).padStart(2,'0')}` : '';
          const arrived = etaRemainingMs <= 0;
          const treatmentTimeMins = arrived ? Math.floor((evtAge - etaBaseSec * 1000) / 60000) : 0;

          // MDA lifecycle: drive→treat(5min)→hospital(10min)→hide | Others: 10min→hide
          const hospitalBound = isMda && arrived && treatmentTimeMins >= 5;
          if (treatmentTimeMins >= (isMda ? 15 : 10)) return null;

          // Vehicle drive simulation — dispatched from nearest real stations
          const STATIONS = [
            { lat: 32.06, lon: 34.79, icon: '🚑', label: 'מד"א ת"א', color: '#ff1744', type: 'mda' },
            { lat: 31.78, lon: 35.20, icon: '🚑', label: 'מד"א י-ם', color: '#ff1744', type: 'mda' },
            { lat: 32.80, lon: 35.00, icon: '🚑', label: 'מד"א חיפה', color: '#ff1744', type: 'mda' },
            { lat: 31.26, lon: 34.80, icon: '🚑', label: 'מד"א ב"ש', color: '#ff1744', type: 'mda' },
            { lat: 32.10, lon: 34.89, icon: '🚑', label: 'מד"א פ"ת', color: '#ff1744', type: 'mda' },
            { lat: 32.34, lon: 34.87, icon: '🚑', label: 'מד"א נתניה', color: '#ff1744', type: 'mda' },
            { lat: 31.81, lon: 34.66, icon: '🚑', label: 'מד"א אשדוד', color: '#ff1744', type: 'mda' },
            { lat: 33.21, lon: 35.57, icon: '🚑', label: 'מד"א ק"ש', color: '#ff1744', type: 'mda' },
            { lat: 32.09, lon: 34.78, icon: '🚒', label: 'כיבוי ת"א', color: '#ff6d00', type: 'fire' },
            { lat: 31.76, lon: 35.22, icon: '🚒', label: 'כיבוי י-ם', color: '#ff6d00', type: 'fire' },
            { lat: 32.78, lon: 34.98, icon: '🚒', label: 'כיבוי חיפה', color: '#ff6d00', type: 'fire' },
            { lat: 31.98, lon: 34.81, icon: '🚒', label: 'כיבוי ראשל"צ', color: '#ff6d00', type: 'fire' },
            { lat: 31.24, lon: 34.78, icon: '🚒', label: 'כיבוי ב"ש', color: '#ff6d00', type: 'fire' },
            { lat: 32.07, lon: 34.80, icon: '🚔', label: 'משטרה ת"א', color: '#2196f3', type: 'police' },
            { lat: 31.79, lon: 35.22, icon: '🚔', label: 'משטרה י-ם', color: '#2196f3', type: 'police' },
            { lat: 32.81, lon: 35.01, icon: '🚔', label: 'משטרה חיפה', color: '#2196f3', type: 'police' },
          ];
          // Find 2 closest stations matching event type
          const stationType = isFire ? 'fire' : isPolice ? 'police' : 'mda';
          const stationType2 = isFire ? 'mda' : 'fire';
          const distTo = (s: typeof STATIONS[0]) => Math.sqrt((s.lat - evt.lat!) ** 2 + (s.lon - evt.lon) ** 2);
          const primary = [...STATIONS].filter(s => s.type === stationType).sort((a, b) => distTo(a) - distTo(b))[0];
          const secondary = [...STATIONS].filter(s => s.type === stationType2).sort((a, b) => distTo(a) - distTo(b))[0];
          const vehicles = [
            primary ? { stationLat: primary.lat, stationLon: primary.lon, icon: primary.icon, label: primary.label, color: primary.color } : { stationLat: evt.lat! + 0.05, stationLon: evt.lon + 0.05, icon: vehicleIcon, label: vehicleLabel, color: vehicleColor },
            secondary ? { stationLat: secondary.lat, stationLon: secondary.lon, icon: secondary.icon, label: secondary.label, color: secondary.color } : { stationLat: evt.lat! - 0.04, stationLon: evt.lon - 0.04, icon: isFire ? '🚑' : '🚒', label: isFire ? 'מד"א' : 'כיבוי', color: isFire ? '#ff1744' : '#ff6d00' },
          ];

          // ── Hospitals for MDA evacuation routing ──
          const HOSPITALS_LIST = [
            { name: 'איכילוב', lat: 32.0804, lon: 34.7818 },
            { name: 'שיבא', lat: 32.0449, lon: 34.8427 },
            { name: 'בלינסון', lat: 32.0867, lon: 34.8670 },
            { name: 'הדסה', lat: 31.7646, lon: 35.1474 },
            { name: 'רמב"ם', lat: 32.8343, lon: 34.9863 },
            { name: 'סורוקה', lat: 31.2586, lon: 34.7916 },
            { name: 'זיו', lat: 32.9676, lon: 35.4952 },
            { name: 'ברזילי', lat: 31.6652, lon: 34.5704 },
            { name: 'העמק', lat: 32.6108, lon: 35.2888 },
            { name: 'פוריה', lat: 32.7750, lon: 35.5300 },
            { name: 'נהריה', lat: 33.0080, lon: 35.0940 },
          ];
          const nearestHospital = isMda && evt.lat && evt.lon
            ? [...HOSPITALS_LIST].sort((a, b) => Math.hypot(a.lat - evt.lat!, a.lon - evt.lon!) - Math.hypot(b.lat - evt.lat!, b.lon - evt.lon!))[0]
            : null;

          // Hospital-bound: override to single ambulance heading to hospital
          if (hospitalBound && nearestHospital) {
            vehicles.length = 0;
            vehicles.push({ stationLat: evt.lat!, stationLon: evt.lon!, icon: '🚑', label: '→ ' + nearestHospital.name, color: '#ffffff' });
          }

          // Pre-compute banner labels — MDA shows diagnosis, not city name
          const mdaDiagnosis = mdaType ? mdaType.labelHe.slice(0, 15) : 'אירוע רפואי';
          const bannerLine1 = isMda
            ? (hospitalBound ? `🏥 → ${nearestHospital?.name || 'בי״ח'}` : `${mdaType ? mdaType.emoji : '🚑'} ${mdaDiagnosis}`)
            : (treatmentTimeMins >= 8 ? '🏥 לבי״ח' : (mdaType ? mdaType.emoji + ' ' + mdaType.labelHe.slice(0, 15) : vehicleIcon + ' ' + (evt.location && evt.location.length > 8 ? evt.location.slice(0,8) + '…' : (evt.location || vehicleLabel))));
          const bannerLine2 = isMda
            ? (hospitalBound ? `🩺 ${mdaDiagnosis.slice(0,12)}` : (arrived ? `✅ בזירה ${treatmentTimeMins}ד׳` : `🚑 בדרך! ⏱${etaStr}`))
            : ((arrived ? (treatmentTimeMins >= 8 ? '🚑 פינוי' : '✅ ' + treatmentTimeMins + 'ד׳') : '⏱ ' + etaStr) + (routeDistKm > 0 ? ` · ${routeDistKm.toFixed(1)}km` : ''));
          const bannerBg = isMda
            ? (hospitalBound ? 'rgba(255,255,255,0.25)' : (arrived ? 'rgba(0,200,83,0.55)' : 'rgba(255,106,0,0.7)'))
            : (treatmentTimeMins >= 8 ? 'rgba(255,255,255,0.15)' : arrived ? 'rgba(0,200,83,0.55)' : (mdaType ? mdaType.color + '88' : vehicleColor + '88'));

          return (
            <React.Fragment key={`ee-${evt.id}`}>
              {/* Alert-style circles only for fire/police — MDA shows only routes */}
              {!isMda && (
                <>
                  <Circle
                    center={[evt.lat, evt.lon]}
                    radius={800 + pulse * 400}
                    pathOptions={{
                      color: evtColor, fillColor: evtColor,
                      fillOpacity: 0.04 + pulse * 0.06,
                      weight: 1, opacity: 0.2 + pulse * 0.2, dashArray: '4 6',
                    }}
                    interactive={false}
                  />
                  <Circle
                    center={[evt.lat, evt.lon]}
                    radius={350}
                    pathOptions={{
                      color: evtColor, fillColor: evtColor,
                      fillOpacity: 0.2 + pulse * 0.15,
                      weight: 2.5, opacity: 0.7 + pulse * 0.3,
                    }}
                  >
                    <Popup closeButton={false} className="hud-popup-custom" offset={[0, -5]}>
                      <div style={{
                        fontFamily: "'Share Tech Mono', monospace",
                        background: 'linear-gradient(135deg, rgba(0,15,25,0.96), rgba(0,25,40,0.98))',
                        border: `1px solid ${vehicleColor}55`,
                        borderRadius: '6px',
                        padding: '10px 12px',
                        minWidth: '230px',
                        maxWidth: '300px',
                        boxShadow: `0 4px 20px rgba(0,0,0,0.6), 0 0 15px ${vehicleColor}15`,
                        color: '#e0e0e0',
                        direction: 'rtl',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                          <span style={{ fontSize: '18px', filter: `drop-shadow(0 0 6px ${vehicleColor})` }}>{vehicleIcon}</span>
                          <div>
                            <div style={{ fontSize: '12px', fontWeight: 800, color: vehicleColor, textShadow: `0 0 8px ${vehicleColor}44` }}>{evt.title}</div>
                            <div style={{ fontSize: '8px', color: '#78909c', letterSpacing: '1px', marginTop: '1px' }}>{vehicleLabel.toUpperCase()}</div>
                          </div>
                        </div>
                        <div style={{ height: '1px', background: `linear-gradient(90deg, transparent, ${vehicleColor}44, transparent)`, margin: '0 0 6px' }} />
                        {evt.description && <div style={{ fontSize: '10px', color: '#b0bec5', lineHeight: '1.5', marginBottom: '4px' }}>🩺 {evt.description}</div>}
                        {evt.location && <div style={{ fontSize: '9px', color: '#90a4ae', marginBottom: '4px' }}>📍 {evt.location}</div>}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${vehicleColor}22`, paddingTop: '5px', marginTop: '4px' }}>
                          <span style={{ fontSize: '10px', fontWeight: 800, color: arrived ? '#00e676' : '#ffd740' }}>{arrived ? `✅ בזירה ${treatmentTimeMins}ד׳` : `⏱ ETA ${etaStr}`}</span>
                          {routeDistKm > 0 && <span style={{ fontSize: '8px', color: '#546e7a' }}>📏 {routeDistKm.toFixed(1)} ק"מ</span>}
                        </div>
                      </div>
                    </Popup>
                  </Circle>
                </>
              )}
              {/* MDA: event type emoji icon */}
              {isMda && !hospitalBound && (
                <Marker
                  position={[evt.lat, evt.lon]}
                  zIndexOffset={600}
                  icon={L.divIcon({
                    className: '',
                    html: `<div style="display:flex;align-items:center;justify-content:center;font-size:18px;filter:drop-shadow(0 0 6px ${mdaType?.color || '#ff1744'});transform:translate(-50%,-50%);cursor:pointer;">${mdaType?.emoji || '🚑'}</div>`,
                    iconSize: [24, 24],
                    iconAnchor: [12, 12],
                  })}
                >
                  <Popup closeButton={false} className="hud-popup-custom" offset={[0, -5]}>
                    <div style={{
                      fontFamily: "'Share Tech Mono', monospace",
                      background: 'linear-gradient(135deg, rgba(0,15,25,0.96), rgba(0,25,40,0.98))',
                      border: `1px solid ${mdaType?.color || '#ff1744'}55`,
                      borderRadius: '6px',
                      padding: '10px 12px',
                      minWidth: '230px',
                      maxWidth: '300px',
                      boxShadow: `0 4px 20px rgba(0,0,0,0.6), 0 0 15px ${mdaType?.color || '#ff1744'}15`,
                      color: '#e0e0e0',
                      direction: 'rtl',
                    }}>
                      {mdaType && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                          <span style={{ fontSize: '20px', filter: `drop-shadow(0 0 6px ${mdaType.color})` }}>{mdaType.emoji}</span>
                          <div>
                            <div style={{ fontSize: '12px', fontWeight: 800, color: mdaType.color, textShadow: `0 0 8px ${mdaType.color}44` }}>{mdaType.labelHe}</div>
                            <span style={{ fontSize: '7px', fontWeight: 700, padding: '1px 5px', borderRadius: '3px', background: `${mdaType.color}22`, color: mdaType.color, letterSpacing: '0.5px' }}>{mdaType.defaultSeverity.toUpperCase()}</span>
                          </div>
                        </div>
                      )}
                      <div style={{ height: '1px', background: `linear-gradient(90deg, transparent, ${mdaType?.color || '#ff1744'}44, transparent)`, margin: '0 0 6px' }} />
                      <div style={{ fontSize: '11px', fontWeight: 700, color: '#ff1744', marginBottom: '3px' }}>🚑 {evt.title}</div>
                      {evt.description && <div style={{ fontSize: '9px', color: '#b0bec5', lineHeight: '1.4', marginBottom: '3px' }}>🩺 {evt.description}</div>}
                      {evt.location && <div style={{ fontSize: '9px', color: '#90a4ae', marginBottom: '4px' }}>📍 {evt.location}</div>}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${mdaType?.color || '#ff1744'}22`, paddingTop: '5px' }}>
                        <span style={{ fontSize: '10px', fontWeight: 800, color: arrived ? '#00e676' : '#ffd740' }}>{arrived ? `✅ בזירה ${treatmentTimeMins}ד׳` : `⏱ ETA ${etaStr}`}</span>
                        <span style={{ fontSize: '8px', color: '#546e7a', letterSpacing: '1px' }}>MDA SRC</span>
                      </div>
                    </div>
                  </Popup>
                </Marker>
              )}

              {/* ═══ Compact semi-transparent Event Banner — zoom-aware ═══ */}
              {(() => {
                const iconPx = mapZoom >= 14 ? 20 : mapZoom >= 11 ? 16 : 12;
                const fontPx = mapZoom >= 14 ? 8 : mapZoom >= 11 ? 6 : 5;
                const etaFontPx = mapZoom >= 14 ? 10 : mapZoom >= 11 ? 8 : 6;
                const showLabel = mapZoom >= 10;
                return (
                  <Marker
                    position={[evt.lat, evt.lon]}
                    zIndexOffset={1000}
                    icon={L.divIcon({
                      className: '',
                      html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);pointer-events:auto;opacity:0.8;cursor:pointer;">
                        <div style="font-size:${iconPx}px;filter:drop-shadow(0 0 4px ${hospitalBound ? 'rgba(255,255,255,0.6)' : (mdaType ? mdaType.color : vehicleColor)});">${hospitalBound ? '🏥' : (mdaType ? mdaType.emoji : (isFire ? '🔥' : isPolice ? '🚨' : isTraffic ? '⚠️' : '🏥'))}</div>
                        ${showLabel ? `<div style="font-family:'Heebo',sans-serif;margin-top:1px;background:${bannerBg};padding:1px 4px;border-radius:3px;white-space:nowrap;text-align:center;border:1px solid rgba(255,255,255,0.12);backdrop-filter:blur(4px);">
                          <div style="font-size:${fontPx}px;font-weight:700;color:rgba(255,255,255,0.9);">${bannerLine1}</div>
                          <div style="font-family:'Share Tech Mono',monospace;font-size:${etaFontPx}px;font-weight:800;color:#fff;line-height:1.1;">${bannerLine2}</div>
                        </div>` : ''}
                      </div>`,
                      iconSize: [40, 40],
                      iconAnchor: [20, 40],
                    })}
                    eventHandlers={{
                      dblclick: (e) => {
                        L.DomEvent.stopPropagation(e as any);
                        setSelectedVehicle({
                          vehicleIcon, vehicleLabel, vehicleColor,
                          stationLabel: vehicleLabel, etaStr, arrived, treatmentTimeMins,
                          evt: { title: evt.title, description: evt.description, location: evt.location, score: evt.score, source: evt.source, event_time: evt.event_time },
                          vLat: evt.lat!, vLon: evt.lon!, driveProgress: arrived ? 1 : 0,
                        });
                      },
                    }}
                  >
                    <Popup closeButton={false} className="hud-popup-custom" offset={[0, -10]}>
                      <div style={{
                        fontFamily: "'Share Tech Mono', monospace",
                        background: 'linear-gradient(135deg, rgba(0,15,25,0.96), rgba(0,25,40,0.98))',
                        border: `1px solid ${mdaType?.color || vehicleColor}55`,
                        borderRadius: '6px',
                        padding: '10px 12px',
                        minWidth: '230px',
                        maxWidth: '300px',
                        boxShadow: `0 4px 20px rgba(0,0,0,0.6), 0 0 15px ${mdaType?.color || vehicleColor}15`,
                        color: '#e0e0e0',
                        direction: 'rtl',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                          <span style={{ fontSize: '20px', filter: `drop-shadow(0 0 6px ${vehicleColor})` }}>{hospitalBound ? '🏥' : (mdaType ? mdaType.emoji : vehicleIcon)}</span>
                          <div>
                            <div style={{ fontSize: '12px', fontWeight: 800, color: mdaType?.color || vehicleColor, textShadow: `0 0 8px ${mdaType?.color || vehicleColor}44` }}>{evt.title}</div>
                            <div style={{ fontSize: '8px', color: '#78909c', letterSpacing: '1px', marginTop: '1px' }}>{vehicleLabel.toUpperCase()}</div>
                          </div>
                        </div>
                        <div style={{ height: '1px', background: `linear-gradient(90deg, transparent, ${mdaType?.color || vehicleColor}44, transparent)`, margin: '0 0 6px' }} />
                        {evt.description && <div style={{ fontSize: '10px', color: '#b0bec5', lineHeight: '1.5', marginBottom: '4px' }}>🩺 {evt.description}</div>}
                        {evt.location && <div style={{ fontSize: '9px', color: '#90a4ae', marginBottom: '4px' }}>📍 {evt.location}</div>}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderTop: `1px solid ${mdaType?.color || vehicleColor}22`, paddingTop: '5px', marginTop: '4px' }}>
                          <span style={{ fontSize: '10px', fontWeight: 800, color: arrived ? '#00e676' : '#ffd740' }}>
                            {hospitalBound ? `🏥 → ${nearestHospital?.name || 'בי״ח'}` : (arrived ? `✅ בזירה ${treatmentTimeMins}ד׳` : `⏱ ETA ${etaStr}`)}
                          </span>
                          {routeDistKm > 0 && <span style={{ fontSize: '8px', color: '#546e7a' }}>📏 {routeDistKm.toFixed(1)} ק"מ</span>}
                        </div>
                      </div>
                    </Popup>
                  </Marker>
                );
              })()}

              {/* ═══ Multiple vehicles driving toward event — road-like routing ═══ */}
              {vehicles.map((v, vi) => {
                // Hospital-bound: progress along event→hospital route
                const hospitalStartMs = etaBaseSec * 1000 + 5 * 60000;
                const driveProgress = hospitalBound
                  ? Math.min(1, Math.max(0, (evtAge - hospitalStartMs) / (10 * 60000)))
                  : (arrived ? 1 : Math.min(1, evtAge / (etaBaseSec * 1000)));
                // Show vehicle at scene even after arrival
                if (evt.lat == null || evt.lon == null || isNaN(evt.lat) || isNaN(evt.lon)) return null;

                // Validate station is on land (rough Israel bounding box: lat 29-34, lon 34.2-36)
                const stationOnLand = isWithinIsraelRenderBounds(v.stationLat, v.stationLon);
                const eventOnLand = isWithinIsraelRenderBounds(evt.lat!, evt.lon!);
                if (!stationOnLand || !eventOnLand) return null;

                // Fetch real road route from OSRM
                const routeDestLat = hospitalBound && nearestHospital ? nearestHospital.lat : evt.lat!;
                const routeDestLon = hospitalBound && nearestHospital ? nearestHospital.lon : evt.lon!;
                const osrmRoute = getRoute({
                  fromLat: v.stationLat, fromLon: v.stationLon,
                  toLat: routeDestLat, toLon: routeDestLon,
                });
                const routeColor = hospitalBound ? '#ffffff' : (isMda ? '#ff6d00' : v.color);
                
                // Only show route when we have real road data — NO straight-line fallback
                const _iconPx = mapZoom >= 14 ? 24 : mapZoom >= 11 ? 18 : 14;
                const _labelPx = mapZoom >= 14 ? 8 : 6;
                const routeWaypoints = osrmRoute?.waypoints ?? [];
                const routeHasLargeJump = routeWaypoints.some((point, index) => {
                  if (index === 0) return false;
                  const prev = routeWaypoints[index - 1];
                  return Math.hypot(point[0] - prev[0], point[1] - prev[1]) > 0.15;
                });
                const hasRealRoute = Boolean(
                  osrmRoute &&
                  osrmRoute.distance > 0 &&
                  routeWaypoints.length > 2 &&
                  !osrmRoute.clipped &&
                  routeWaypoints.every(([lat, lon]) => isWithinIsraelRenderBounds(lat, lon)) &&
                  !routeHasLargeJump
                );
                if (!hasRealRoute) {
                  // No OSRM data yet — show only the vehicle icon at event location (no missile-like line)
                  return (
                    <Marker
                      key={`veh-${evt.id}-${vi}`}
                      position={[evt.lat!, evt.lon!]}
                      zIndexOffset={1200}
                      icon={L.divIcon({
                        className: '',
                        html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%);pointer-events:auto;cursor:pointer;">
                          <div style="width:${_iconPx + 12}px;height:${_iconPx + 12}px;background:${v.color};border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 14px ${v.color},0 0 28px ${v.color}66;border:2px solid rgba(255,255,255,0.5);animation:pulse 1.5s ease-in-out infinite;">
                            <span style="font-size:${_iconPx}px;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));">${v.icon}</span>
                          </div>
                        ${mapZoom >= 10 ? `<div style="font-family:'Heebo',sans-serif;font-size:${_labelPx}px;color:#fff;background:${v.color}dd;padding:2px 6px;border-radius:4px;white-space:nowrap;font-weight:700;margin-top:2px;backdrop-filter:blur(3px);border:1px solid rgba(255,255,255,0.2);box-shadow:0 2px 8px ${v.color}66;">
                          <div style="font-family:'Share Tech Mono',monospace;font-size:${Math.max(_labelPx, 7)}px;">⏱ ${etaStr || 'בדרך'}</div>
                          <div style="font-size:${Math.max(_labelPx - 1, 5)}px;opacity:0.9;line-height:1.2;">${v.label}</div>
                        </div>` : ''}
                        </div>`,
                        iconSize: [50, 50],
                        iconAnchor: [25, 25],
                      })}
                    />
                  );
                }
                const roadWaypoints: [number, number][] = routeWaypoints as [number, number][];
                const showRouteLine = true;

                if (roadWaypoints.length < 2) return null;
                let totalLen = 0;
                const segLens: number[] = [];
                for (let s = 1; s < roadWaypoints.length; s++) {
                  const segLen = Math.sqrt((roadWaypoints[s][0] - roadWaypoints[s-1][0])**2 + (roadWaypoints[s][1] - roadWaypoints[s-1][1])**2);
                  segLens.push(segLen);
                  totalLen += segLen;
                }
                if (totalLen === 0) return null;
                // Find vehicle position along path
                const targetDist = driveProgress * totalLen;
                let accum = 0;
                let vLat = roadWaypoints[0][0], vLon = roadWaypoints[0][1];
                for (let s = 0; s < segLens.length; s++) {
                  if (accum + segLens[s] >= targetDist) {
                    const segT = segLens[s] > 0 ? (targetDist - accum) / segLens[s] : 0;
                    vLat = roadWaypoints[s][0] + (roadWaypoints[s+1][0] - roadWaypoints[s][0]) * segT;
                    vLon = roadWaypoints[s][1] + (roadWaypoints[s+1][1] - roadWaypoints[s][1]) * segT;
                    break;
                  }
                  accum += segLens[s];
                }

                // Route line style: solid for real roads, dashed-thin for straight fallback

                // Only show path up to vehicle position
                const traveledWaypoints: [number, number][] = [roadWaypoints[0]];
                let acc2 = 0;
                for (let s = 0; s < segLens.length; s++) {
                  if (acc2 + segLens[s] >= targetDist) {
                    traveledWaypoints.push([vLat, vLon]);
                    break;
                  }
                  traveledWaypoints.push(roadWaypoints[s+1]);
                  acc2 += segLens[s];
                }

                const vIconPx = mapZoom >= 14 ? 16 : mapZoom >= 11 ? 12 : 9;
                const vLabelPx = mapZoom >= 14 ? 8 : 6;
                const remainDistKm = routeDistKm > 0 ? (routeDistKm * (1 - driveProgress)).toFixed(1) : '';
                const vehStatusLabel = isMda
                  ? (hospitalBound ? `🏥 ${nearestHospital?.name?.slice(0,5) || ''}` : (arrived ? '✅ בזירה' : `⏱${etaStr}`))
                  : (arrived ? '✅' : `⏱${etaStr}`);
                return (
                  <React.Fragment key={`veh-${evt.id}-${vi}`}>
                    {/* ═══ Route line — to event (green-orange pulse) / to hospital (white) ═══ */}
                    {showRouteLine && (() => {
                      // Clip all route points to Israel bounds — prevent stray lines
                      const inBounds = (pt: [number, number]) => pt[0] >= 29 && pt[0] <= 34 && pt[1] >= 34 && pt[1] <= 36;
                      // Also reject segments where consecutive points jump > 0.1 degrees (~10km)
                      const filterJumps = (pts: [number, number][]) => {
                        const result: [number, number][] = [];
                        for (let i = 0; i < pts.length; i++) {
                          if (i > 0 && Math.hypot(pts[i][0] - pts[i-1][0], pts[i][1] - pts[i-1][1]) > 0.1) {
                            break; // Stop at first large jump
                          }
                          result.push(pts[i]);
                        }
                        return result;
                      };
                      const clippedTraveled = filterJumps(traveledWaypoints.filter(inBounds));
                      const remainingRoute = filterJumps(roadWaypoints.slice(Math.max(0, traveledWaypoints.length - 1)).filter(inBounds));
                      if (clippedTraveled.length < 2 && remainingRoute.length < 2) return null;
                      const pulseOpacity = 0.45 + Math.sin(Date.now() / 800) * 0.2;
                      
                      if (hospitalBound) {
                        return (
                          <>
                            {clippedTraveled.length >= 2 && <Polyline positions={clippedTraveled} pathOptions={{ color: '#ffffff', weight: 3, opacity: 0.7 }} />}
                            {remainingRoute.length >= 2 && <Polyline positions={remainingRoute} pathOptions={{ color: '#ffffff', weight: 2, opacity: 0.35, dashArray: '6 8' }} />}
                          </>
                        );
                      }
                      return (
                        <>
                          {clippedTraveled.length >= 2 && <>
                            <Polyline positions={clippedTraveled} pathOptions={{ color: '#ff6d00', weight: 6, opacity: pulseOpacity * 0.25 }} />
                            <Polyline positions={clippedTraveled} pathOptions={{ color: '#00e676', weight: 2.5, opacity: pulseOpacity * 0.9 }} />
                          </>}
                          {remainingRoute.length >= 2 && <>
                            <Polyline positions={remainingRoute} pathOptions={{ color: '#ff6d00', weight: 2, opacity: 0.25, dashArray: '5 7' }} />
                            <Polyline positions={remainingRoute} pathOptions={{ color: '#00e676', weight: 1, opacity: 0.35, dashArray: '5 7' }} />
                          </>}
                        </>
                      );
                    })()}
                    <Marker
                      position={(arrived && !hospitalBound) ? [evt.lat!, evt.lon!] : [vLat, vLon]}
                      zIndexOffset={1200}
                      icon={L.divIcon({
                        className: '',
                        html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%);pointer-events:auto;cursor:pointer;">
                          <div style="width:${vIconPx + 6}px;height:${vIconPx + 6}px;background:${routeColor}cc;border-radius:50%;display:flex;align-items:center;justify-content:center;box-shadow:0 0 6px ${routeColor}88;border:1.5px solid rgba(255,255,255,0.4);">
                            <span style="font-size:${vIconPx}px;filter:drop-shadow(0 1px 1px rgba(0,0,0,0.4));">${v.icon}</span>
                          </div>
                        ${mapZoom >= 11 ? `<div style="font-family:'Heebo',sans-serif;font-size:${vLabelPx}px;color:#fff;background:${hospitalBound ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.7)'};padding:1px 4px;border-radius:3px;white-space:nowrap;font-weight:600;margin-top:1px;">
                          <span style="font-family:'Share Tech Mono',monospace;font-size:${Math.max(vLabelPx, 6)}px;">${vehStatusLabel}</span>
                        </div>` : ''}
                        </div>`,
                        iconSize: [32, 32],
                        iconAnchor: [16, 16],
                      })}
                      eventHandlers={{
                        dblclick: (e) => {
                          L.DomEvent.stopPropagation(e as any);
                          setSelectedVehicle({
                            vehicleIcon, vehicleLabel, vehicleColor,
                            stationLabel: v.label, etaStr, arrived, treatmentTimeMins,
                            evt: { title: evt.title, description: evt.description, location: evt.location, score: evt.score, source: evt.source, event_time: evt.event_time },
                            vLat, vLon, driveProgress,
                          });
                        },
                      }}
                    />
                  </React.Fragment>
                );
              })}
            </React.Fragment>
          );
        })}

        {/* ═══ MCI / Combined Event markers on map ═══ */}
        {mciEvents.map((mci, mi) => {
          const pulse = Math.abs(Math.sin(missileProgress * Math.PI * 3 + mi));
          const isMCI = mci.severity === 'mci';
          const isVerified = mci.severity === 'verified';
          const mciColor = isMCI ? '#ff1744' : isVerified ? '#2196f3' : '#ff6d00';
          return (
            <React.Fragment key={`mci-${mci.city}`}>
              <Circle
                center={[mci.lat, mci.lon]}
                radius={isVerified ? (1000 + pulse * 500) : (3000 + pulse * 2000)}
                pathOptions={{
                  color: mciColor,
                  fillColor: mciColor,
                  fillOpacity: 0.08 + pulse * 0.06,
                  weight: 3 + pulse * 2,
                  opacity: 0.6 + pulse * 0.4,
                  dashArray: '8 4',
                }}
              >
                <Popup closeButton={false}>
                  <div className="font-mono p-2" style={{ minWidth: '220px' }}>
                    <div className="text-sm font-bold mb-2" style={{ color: mciColor }}>
                      {isMCI ? '🚨 אירוע רב-נפגעים' : isVerified ? '✅ מאומת' : '⚠️ אירוע משולב'} — {mci.city}
                    </div>
                    <div className="text-[9px] text-foreground/70 mb-2">{mci.sources.length} מקורות שונים דיווחו על אותו מיקום</div>
                    {mci.sources.map((s, si) => (
                      <div key={si} className="text-[8px] text-foreground/60 border-t border-foreground/10 py-0.5 flex items-center gap-1">
                        <span>{s.icon}</span>
                        <span className="font-bold">{s.type}</span>
                        <span className="truncate flex-1">{s.title}</span>
                      </div>
                    ))}
                  </div>
                </Popup>
              </Circle>
              <Marker
                position={[mci.lat, mci.lon]}
                icon={L.divIcon({
                  className: '',
                  html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%);cursor:pointer;opacity:${isVerified ? '0.5' : '0.85'};" onclick="document.dispatchEvent(new CustomEvent('mci-click',{detail:'${mci.city}'}))">
                    <div style="font-size:${isVerified ? '11px' : isMCI ? '28px' : '20px'};filter:drop-shadow(0 0 ${isVerified ? '4' : '14'}px ${mciColor});animation:pulse ${isVerified ? '2' : '0.8'}s infinite;">${isMCI ? '🚨' : isVerified ? '✅' : '⚠️'}</div>
                    <div style="font-family:'Heebo',sans-serif;font-size:${isVerified ? '8' : '10'}px;color:#fff;background:${mciColor}${isVerified ? '88' : 'ee'};padding:${isVerified ? '1px 5px' : '2px 8px'};border-radius:4px;border:${isVerified ? '1' : '2'}px solid ${mciColor}${isVerified ? '44' : '88'};font-weight:${isVerified ? '600' : '900'};white-space:nowrap;text-shadow:0 0 6px rgba(0,0,0,0.8);margin-top:1px;letter-spacing:0.5px;">
                      ${isMCI ? '⚡ רב-נפגעים' : isVerified ? '✓ מאומת' : '⚠ משולב'} · ${mci.city}
                    </div>
                    <div style="font-family:monospace;font-size:${isVerified ? '6' : '7'}px;color:#fff;background:rgba(0,0,0,${isVerified ? '0.4' : '0.6'});padding:1px 5px;border-radius:2px;margin-top:1px;">
                      ${mci.sources.map(s => s.icon).join(' ')} · ${mci.sources.length} מקורות
                    </div>
                  </div>`,
                  iconSize: [0, 0],
                  iconAnchor: [0, 0],
                })}
                eventHandlers={{ click: () => setActiveMCI(mci) }}
              />
            </React.Fragment>
          );
        })}

        {/* Ambulance cluster removed */}

        {/* City name labels — density-aware sizing, standby for calm */}
        {(() => {
          const cities = scenarioRegions.filter(r => r.isCity);
          // Pre-compute density: count neighbors within ~0.15° (~15km)
          const densityMap = new Map<string, number>();
          for (const c of cities) {
            let neighbors = 0;
            for (const other of cities) {
              if (other.id === c.id) continue;
              const d = Math.sqrt((c.lat - other.lat) ** 2 + (c.lon - other.lon) ** 2);
              if (d < 0.15) neighbors++;
            }
            densityMap.set(c.id, neighbors);
          }
          return cities.map((region, idx) => {
            const isCalm = region.severity === 'safe' || region.severity === 'low';
            const colorMap: Record<string, { text: string; glow: string }> = {
              safe: { text: '#00e676', glow: '#00e67640' },
              low: { text: '#4caf50', glow: '#4caf5040' },
              medium: { text: '#ffab00', glow: '#ffab0050' },
              warning: { text: '#ff6d00', glow: '#ff6d0060' },
              high: { text: '#ff3d00', glow: '#ff3d0070' },
              critical: { text: '#ff1744', glow: '#ff174480' },
              early_warning: { text: '#ff9100', glow: '#ff910090' },
            };
            const cm = colorMap[region.severity] || colorMap.safe;
            const isThreat = !isCalm;
            const density = densityMap.get(region.id) || 0;
            // Scale down font in dense areas; big cities stay larger
            const isLargeCity = (region.population || 0) > 100;
            const baseFontSize = isThreat ? (isLargeCity ? 8 : 6) : (isLargeCity ? 7 : 5);
            const fontSize = density > 3 ? Math.max(baseFontSize - 1, 5) : baseFontSize;
            // Offset label slightly in dense clusters to reduce overlap
            const offsetY = density > 2 ? (idx % 2 === 0 ? -8 : 8) : 0;
            const standbyDot = isCalm ? `<span style="color:#4caf50;font-size:5px;vertical-align:middle;margin-left:2px;">●</span>` : '';
            return (
              <Marker
                key={`lbl-${region.id}`}
                position={[region.lat, region.lon]}
                icon={L.divIcon({
                  className: '',
                  html: `<div style="font-family:'Heebo',sans-serif;font-size:${fontSize}px;color:${isCalm ? '#a5d6a7' : cm.text};text-shadow:0 0 5px rgba(0,0,0,0.95),0 0 12px ${isCalm ? 'rgba(0,200,83,0.25)' : cm.glow};white-space:nowrap;transform:translate(-50%,calc(-50% + ${offsetY}px));pointer-events:auto;cursor:pointer;font-weight:${isThreat ? '800' : '600'};letter-spacing:${isThreat ? '0.5px' : '0.2px'};opacity:${isCalm ? '0.85' : '1'};">${region.name}${standbyDot}${isThreat && region.alertCount ? ` <span style="font-size:${Math.max(fontSize - 2, 6)}px;opacity:0.7;">(${region.alertCount})</span>` : ''}</div>`,
                  iconSize: [0, 0],
                  iconAnchor: [0, 0],
                })}
                eventHandlers={{ click: () => handleRegionClick(region) }}
              />
            );
          });
        })()}

        {/* ═══ Missile trajectories — radar/flight-tracker style ═══ */}
        {showTrajectories && activeMissiles.map(src =>
          src.targets.map((target, ti) => {
            const p = (missileProgress + ti * 0.15) % 1;
            // These will be recalculated below from the arc — placeholder for now
            let missileLat = src.lat + (target.lat - src.lat) * p;
            let missileLon = src.lon + (target.lon - src.lon) * p;
            const altKm = src.maxAltKm * 4 * p * (1 - p);
            const speedKmH = (target.distKm / src.flightTimeSec) * 3600;
            let bearing = Math.atan2(target.lon - src.lon, target.lat - src.lat) * (180 / Math.PI);
            const flash = Math.abs(Math.sin(missileProgress * Math.PI * 4));
            const missileColor = flash > 0.5 ? '#ff1744' : src.color;

            // Generate arc trajectory points (parabolic ballistic curve visualized as lateral offset)
            const arcSteps = 30;
            const arcPoints: [number, number][] = [];
            const traveledArc: [number, number][] = [];
            const remainingArc: [number, number][] = [];
            // Perpendicular direction for arc lateral bulge
            const dx = target.lon - src.lon;
            const dy = target.lat - src.lat;
            const perpX = -dy; // perpendicular
            const perpY = dx;
            const perpLen = Math.sqrt(perpX * perpX + perpY * perpY);
            const normPX = perpLen > 0 ? perpX / perpLen : 0;
            const normPY = perpLen > 0 ? perpY / perpLen : 0;
            // Arc bulge proportional to max altitude
            const bulgeFactor = Math.min(0.15, src.maxAltKm * 0.0003);

            for (let i = 0; i <= arcSteps; i++) {
              const t = i / arcSteps;
              const baseLat = src.lat + (target.lat - src.lat) * t;
              const baseLon = src.lon + (target.lon - src.lon) * t;
              // Parabolic offset: max at t=0.5
              const arcHeight = 4 * t * (1 - t) * bulgeFactor;
              const ptLat = baseLat + normPY * arcHeight;
              const ptLon = baseLon + normPX * arcHeight;
              arcPoints.push([ptLat, ptLon]);
              if (t <= p) traveledArc.push([ptLat, ptLon]);
              if (t >= p) remainingArc.push([ptLat, ptLon]);
            }

            // ── Place missile ON the arc and compute tangent bearing ──
            {
              const pIdx = p * arcSteps;
              const idx0 = Math.min(Math.floor(pIdx), arcSteps - 1);
              const idx1 = Math.min(idx0 + 1, arcSteps);
              const frac = pIdx - idx0;
              const pt0 = arcPoints[idx0];
              const pt1 = arcPoints[idx1];
              if (pt0 && pt1) {
                missileLat = pt0[0] + (pt1[0] - pt0[0]) * frac;
                missileLon = pt0[1] + (pt1[1] - pt0[1]) * frac;
                // Tangent bearing from arc segment
                const dLat = pt1[0] - pt0[0];
                const dLon = pt1[1] - pt0[1];
                if (Math.abs(dLat) > 1e-9 || Math.abs(dLon) > 1e-9) {
                  bearing = Math.atan2(dLon, dLat) * (180 / Math.PI);
                }
              }
            }

            const phasePoints = [
              { t: 0.05, label: 'LAUNCH', phase: 'boost' },
              { t: 0.20, label: `↗ EXIT ATM ${src.maxAltKm > 100 ? '100km' : `${Math.round(src.maxAltKm * 0.4)}km`}`, phase: 'ascent' },
              { t: 0.50, label: `APOGEE ${src.maxAltKm}km`, phase: 'apex' },
              { t: 0.80, label: `↘ RE-ENTRY`, phase: 'descent' },
              { t: 0.95, label: `TERMINAL`, phase: 'terminal' },
            ];

            return (
              <React.Fragment key={`traj-${src.id}-${ti}`}>
                {/* Full arc — neon glow base */}
                <Polyline
                  positions={arcPoints}
                  pathOptions={{ color: src.color, weight: 4, opacity: 0.12, dashArray: '2 4' }}
                />
                {/* Traveled arc — bright neon glow (outer) */}
                {traveledArc.length >= 2 && (
                  <>
                    <Polyline
                      positions={traveledArc}
                      pathOptions={{ color: src.color, weight: 6, opacity: 0.35 }}
                    />
                    <Polyline
                      positions={traveledArc}
                      pathOptions={{ color: '#fff', weight: 2, opacity: 0.9 }}
                    />
                  </>
                )}
                {/* Remaining arc — neon dashed */}
                {remainingArc.length >= 2 && (
                  <Polyline
                    positions={remainingArc}
                    pathOptions={{ color: src.color, weight: 3, opacity: 0.5, dashArray: '8 4' }}
                  />
                )}
                {/* Phase labels along arc */}
                {phasePoints.map(ph => {
                  const idx = Math.round(ph.t * arcSteps);
                  const pt = arcPoints[idx];
                  if (!pt) return null;
                  const isPast = ph.t <= p;
                  return (
                    <Marker
                      key={`phase-${src.id}-${ti}-${ph.phase}`}
                      position={pt}
                      icon={L.divIcon({
                        className: '',
                        html: `<div style="font-family:'Share Tech Mono',monospace;font-size:6px;color:${isPast ? src.color : `${src.color}66`};text-shadow:0 0 3px rgba(0,0,0,0.9);white-space:nowrap;transform:translate(-50%,-120%);pointer-events:none;">${ph.label}</div>`,
                        iconSize: [0, 0],
                        iconAnchor: [0, 0],
                      })}
                      interactive={false}
                    />
                  );
                })}
                {/* ── White smoke / exhaust trail along traveled path ── */}
                {(() => {
                  const trailSteps = [0.02, 0.06, 0.1, 0.15, 0.2, 0.26, 0.32, 0.38, 0.44, 0.5, 0.56, 0.62, 0.68, 0.74, 0.8, 0.86, 0.92].filter(t => t < p);
                  return trailSteps.map((t, i) => {
                    const idx = Math.round(t * arcSteps);
                    const pt = arcPoints[idx];
                    if (!pt) return null;
                    const age = (p - t) / Math.max(p, 0.01); // 0=newest, 1=oldest
                    const opacity = Math.max(0, 0.5 - age * 0.45);
                    const radius = 1.2 + age * 2.5; // smoke expands as it ages
                    const isUav = src.threatCategory === 'uav';
                    const smokeColor = isUav ? '#cceeff' : '#ffffff';
                    return (
                      <CircleMarker
                        key={`smoke-${src.id}-${ti}-${i}`}
                        center={pt}
                        radius={radius}
                        pathOptions={{ color: smokeColor, fillColor: smokeColor, fillOpacity: opacity, weight: 0 }}
                        interactive={false}
                      />
                    );
                  });
                })()}
                {/* Impact zone — red pulsing circle at target */}
                <Circle
                  center={[target.lat, target.lon]}
                  radius={3000}
                  pathOptions={{
                    color: '#ff1744',
                    fillColor: '#ff1744',
                    fillOpacity: 0.1 + flash * 0.1,
                    weight: 1,
                    opacity: 0.4 + flash * 0.3,
                    dashArray: '3 3',
                  }}
                />
                {/* ═══ Estimated impact zone marker ═══ */}
                <Marker
                  position={[target.lat, target.lon]}
                  icon={L.divIcon({
                    className: '',
                    html: `<div style="font-family:'Share Tech Mono',monospace;font-size:7px;color:#ff1744;text-shadow:0 1px 3px rgba(0,0,0,1);white-space:nowrap;transform:translate(-50%,-120%);pointer-events:none;font-weight:bold;letter-spacing:0.3px;">⊕ ${target.name}</div>`,
                    iconSize: [0, 0],
                    iconAnchor: [0, 0],
                  })}
                  interactive={false}
                />

                {/* ═══ INTERCEPTOR — Multi-battery defense with naval support ═══ */}
                {(() => {
                  // Determine primary defense type for this missile
                  const defenseType = src.defenseSystem.includes('חץ') ? 'arrow' 
                    : src.defenseSystem.includes('קלע') ? 'davids_sling' 
                    : src.defenseSystem.includes('קרן') ? 'iron_beam' 
                    : 'iron_dome';
                  
                  // Multi-layer engagement: primary + support systems
                  // High-value threats (missiles, cruise) get multi-system response
                  const isHighValue = src.threatCategory === 'missile' || src.threatCategory === 'cruise_missile';
                  const supportTypes: string[] = [];
                  if (defenseType === 'iron_dome') supportTypes.push('iron_dome');
                  if (isHighValue) {
                    supportTypes.push('davids_sling', 'patriot'); // Aegis naval support
                  } else if (defenseType === 'davids_sling') {
                    supportTypes.push('iron_dome', 'patriot');
                  } else {
                    supportTypes.push(defenseType);
                  }

                  // Find all eligible batteries (primary type + support types)
                  const allTypes = new Set([defenseType, ...supportTypes]);
                  const matchingBatteries = DEFENSE_SYSTEMS.filter(d => allTypes.has(d.type));
                  if (matchingBatteries.length === 0) return null;
                  
                  // Sort by distance to target
                  const sorted = matchingBatteries.map(b => ({
                    ...b,
                    dist: Math.sqrt((b.lat - target.lat) ** 2 + (b.lon - target.lon) ** 2),
                  })).sort((a, b) => a.dist - b.dist);
                  
                  // Select batteries: 1-4 based on threat level
                  const numBatteries = isHighValue ? Math.min(4, sorted.length) 
                    : src.threatCategory === 'rocket' ? Math.min(2, sorted.length) 
                    : Math.min(3, sorted.length);
                  const activeBatteries = sorted.slice(0, numBatteries);
                  
                  // Interceptor timing
                  const interceptLaunchAt = 0.55;
                  const interceptPointT = 0.82;
                  if (p < interceptLaunchAt) return null;
                  
                  const interceptIdx = Math.round(interceptPointT * arcSteps);
                  const interceptPt = arcPoints[interceptIdx];
                  if (!interceptPt) return null;
                  
                  const interceptorProgress = Math.min(1, (p - interceptLaunchAt) / (interceptPointT - interceptLaunchAt));
                  const hasIntercepted = p >= interceptPointT;
                  const explosionFade = hasIntercepted ? Math.max(0, 1 - (p - interceptPointT) / 0.14) : 0;
                  
                  // Colors per system type
                  const sysColor: Record<string, string> = {
                    iron_dome: '#4fc3f7', davids_sling: '#ce93d8', arrow: '#ffb74d',
                    patriot: '#42a5f5', iron_beam: '#76ff03',
                  };
                  const sysIcon: Record<string, string> = {
                    iron_dome: '🛡️', davids_sling: '⚔️', arrow: '🏹',
                    patriot: '🇺🇸', iron_beam: '✴️',
                  };
                  const sysLabel: Record<string, string> = {
                    iron_dome: 'כיפת ברזל', davids_sling: 'קלע דוד', arrow: 'חץ',
                    patriot: 'AEGIS SM-3', iron_beam: 'קרן ברזל',
                  };

                  // ═══ IRON BEAM LASER — sustained green beam that burns the missile ═══
                  const hasIronBeam = activeBatteries.some(b => b.type === 'iron_beam');
                  if (hasIronBeam) {
                    const beamBattery = activeBatteries.find(b => b.type === 'iron_beam')!;
                    // Laser engages earlier and burns continuously
                    const laserEngageAt = 0.45;
                    const laserBurnDuration = 0.35; // burns for 35% of flight
                    const laserEndAt = laserEngageAt + laserBurnDuration;
                    const laserKillAt = laserEndAt - 0.03;
                    
                    if (p < laserEngageAt) return null;
                    
                    const laserProgress = Math.min(1, (p - laserEngageAt) / laserBurnDuration);
                    const isLaserBurning = p >= laserEngageAt && p < laserEndAt;
                    const laserKilled = p >= laserKillAt;
                    const burnFade = laserKilled ? Math.max(0, 1 - (p - laserKillAt) / 0.12) : 1;
                    
                    // Current missile position (target of laser)
                    const currentMissileIdx = Math.round(p * arcSteps);
                    const currentMissilePt = arcPoints[Math.min(currentMissileIdx, arcPoints.length - 1)];
                    if (!currentMissilePt) return null;
                    
                    // Laser beam flicker
                    const flickerPhase = Math.sin(Date.now() / 40) * 0.15 + 0.85;
                    const pulsePhase = Math.sin(Date.now() / 120) * 0.1 + 0.9;
                    
                    return (
                      <>
                        {/* ── Laser beam — phosphorescent white-green, thin, no bg ── */}
                        {isLaserBurning && (
                          <>
                            {/* Core beam — thin phosphorescent white-green */}
                            <Polyline
                              positions={[[beamBattery.lat, beamBattery.lon], currentMissilePt]}
                              pathOptions={{
                                color: '#b9f6ca',
                                weight: 2.5,
                                opacity: 0.7 * pulsePhase * burnFade,
                              }}
                            />
                            {/* Inner core — white hot center */}
                            <Polyline
                              positions={[[beamBattery.lat, beamBattery.lon], currentMissilePt]}
                              pathOptions={{
                                color: '#e0ffe0',
                                weight: 1,
                                opacity: 0.9 * flickerPhase * burnFade,
                              }}
                            />
                          </>
                        )}
                        
                        {/* ── Burn point on missile — glowing heat spot ── */}
                        {isLaserBurning && (
                          <>
                            <Circle
                              center={currentMissilePt}
                              radius={200 + Math.sin(Date.now() / 80) * 80}
                              pathOptions={{
                                color: '#ffea00', fillColor: '#ff6d00',
                                fillOpacity: 0.4 * flickerPhase * burnFade,
                                weight: 1.5, opacity: 0.6 * burnFade,
                              }}
                              interactive={false}
                            />
                            <Circle
                              center={currentMissilePt}
                              radius={80 + Math.sin(Date.now() / 50) * 30}
                              pathOptions={{
                                color: '#fff', fillColor: '#ffea00',
                                fillOpacity: 0.7 * pulsePhase * burnFade,
                                weight: 1, opacity: 0.8 * burnFade,
                              }}
                              interactive={false}
                            />
                          </>
                        )}
                        
                        {/* ── Battery emitter glow ── */}
                        {isLaserBurning && (
                          <Circle
                            center={[beamBattery.lat, beamBattery.lon]}
                            radius={300 + Math.sin(Date.now() / 60) * 100}
                            pathOptions={{
                              color: '#76ff03', fillColor: '#76ff03',
                              fillOpacity: 0.25 * flickerPhase * burnFade,
                              weight: 1, opacity: 0.5 * burnFade,
                            }}
                            interactive={false}
                          />
                        )}
                        
                        {/* ── Laser engagement label ── */}
                        {isLaserBurning && (
                          <Marker
                            position={[
                              (beamBattery.lat + currentMissilePt[0]) / 2,
                              (beamBattery.lon + currentMissilePt[1]) / 2,
                            ]}
                            icon={L.divIcon({
                              className: '',
                              html: `<div style="font-family:'Share Tech Mono',monospace;font-size:7px;color:#76ff03;text-shadow:0 0 8px rgba(118,255,3,0.6),0 0 4px rgba(0,0,0,0.95);white-space:nowrap;transform:translate(-50%,-50%);opacity:${0.7 * burnFade};font-weight:bold;text-align:center;line-height:1.4;">
                                ✴️ IRON BEAM — LASER LOCK<br/>
                                <span style="font-size:6px;color:#b9f6ca;">צורב ${(laserProgress * 100).toFixed(0)}% · ${beamBattery.name}</span>
                              </div>`,
                              iconSize: [0, 0],
                              iconAnchor: [0, 0],
                            })}
                            interactive={false}
                          />
                        )}
                        
                        {/* ── Missile destroyed — soft green dissolve instead of explosion ── */}
                        {laserKilled && burnFade > 0 && (
                          <>
                            {/* Disintegration rings — green themed */}
                            <Circle
                              center={currentMissilePt}
                              radius={400 + (1 - burnFade) * 2000}
                              pathOptions={{
                                color: '#76ff03', fillColor: '#69f0ae',
                                fillOpacity: burnFade * 0.12,
                                weight: 0.8, opacity: burnFade * 0.25,
                              }}
                              interactive={false}
                            />
                            <Circle
                              center={currentMissilePt}
                              radius={200 + (1 - burnFade) * 800}
                              pathOptions={{
                                color: '#b9f6ca', fillColor: '#76ff03',
                                fillOpacity: burnFade * 0.25,
                                weight: 1, opacity: burnFade * 0.4,
                              }}
                              interactive={false}
                            />
                            {/* Destroyed label */}
                            <Marker
                              position={currentMissilePt}
                              icon={L.divIcon({
                                className: '',
                                html: `<div style="font-family:'Share Tech Mono',monospace;font-size:8px;color:#76ff03;text-shadow:0 0 8px rgba(118,255,3,0.6),0 0 4px rgba(0,0,0,0.95);white-space:nowrap;transform:translate(-50%,-200%);opacity:${burnFade};font-weight:bold;text-align:center;line-height:1.4;">
                                  ✴️ LASER KILL<br/>
                                  <span style="font-size:6px;color:#69f0ae;">קרן ברזל — יעד נשרף</span>
                                </div>`,
                                iconSize: [0, 0],
                                iconAnchor: [0, 0],
                              })}
                              interactive={false}
                            />
                          </>
                        )}
                        
                        {/* ── Also render other non-beam interceptors if multi-battery ── */}
                        {activeBatteries.filter(b => b.type !== 'iron_beam').map((bat, bi) => {
                          const delay = (bi + 1) * 0.08;
                          const batProgress = Math.max(0, Math.min(1, (interceptorProgress - delay) / (1 - delay)));
                          if (batProgress <= 0) return null;
                          const col = sysColor[bat.type] || '#4fc3f7';
                          const icon = sysIcon[bat.type] || '🛡️';
                          const intTrailSteps = 18;
                          const trail: [number, number][] = [];
                          const arcMult = 0.02 + bi * 0.005;
                          for (let i = 0; i <= intTrailSteps; i++) {
                            const t = (i / intTrailSteps) * batProgress;
                            const lat = bat.lat + (interceptPt[0] - bat.lat) * t;
                            const lon = bat.lon + (interceptPt[1] - bat.lon) * t;
                            const arc = arcMult * 4 * t * (1 - t);
                            trail.push([lat + arc, lon]);
                          }
                          const headLat = bat.lat + (interceptPt[0] - bat.lat) * batProgress;
                          const headLon = bat.lon + (interceptPt[1] - bat.lon) * batProgress;
                          const headArc = arcMult * 4 * batProgress * (1 - batProgress);
                          return (
                            <React.Fragment key={`int-beam-support-${src.id}-${ti}-${bi}`}>
                              {!hasIntercepted && trail.length >= 2 && (
                                <Polyline positions={trail} pathOptions={{ color: col, weight: 1.2, opacity: 0.35, dashArray: '5 6' }} />
                              )}
                              {!hasIntercepted && batProgress > 0.05 && (
                                <Marker position={[headLat + headArc, headLon]}
                                  icon={L.divIcon({ className: '', html: `<div style="font-size:9px;filter:drop-shadow(0 0 3px ${col}80);transform:translate(-50%,-50%);opacity:0.7;">${icon}</div>`, iconSize: [0, 0], iconAnchor: [0, 0] })}
                                  interactive={false} />
                              )}
                            </React.Fragment>
                          );
                        })}
                      </>
                    );
                  }
                  
                  // ═══ STANDARD INTERCEPTORS — missiles (non-laser) ═══
                  // Generate trails for each battery
                  const intTrailSteps = 18;
                  const batteryTrails = activeBatteries.map((bat, bi) => {
                    const delay = bi * 0.08; // stagger launches
                    const batProgress = Math.max(0, Math.min(1, (interceptorProgress - delay) / (1 - delay)));
                    const trail: [number, number][] = [];
                    const arcMult = 0.02 + bi * 0.005; // slightly different arc per battery
                    for (let i = 0; i <= intTrailSteps; i++) {
                      const t = (i / intTrailSteps) * batProgress;
                      const lat = bat.lat + (interceptPt[0] - bat.lat) * t;
                      const lon = bat.lon + (interceptPt[1] - bat.lon) * t;
                      const arc = arcMult * 4 * t * (1 - t);
                      trail.push([lat + arc, lon]);
                    }
                    const headLat = bat.lat + (interceptPt[0] - bat.lat) * batProgress;
                    const headLon = bat.lon + (interceptPt[1] - bat.lon) * batProgress;
                    const headArc = arcMult * 4 * batProgress * (1 - batProgress);
                    return { ...bat, trail, batProgress, headLat: headLat + headArc, headLon, delay };
                  });
                  
                  return (
                    <>
                      {/* ── Multi-battery interceptor trails ── */}
                      {batteryTrails.map((bat, bi) => {
                        if (bat.batProgress <= 0) return null;
                        const col = sysColor[bat.type] || '#4fc3f7';
                        const icon = sysIcon[bat.type] || '🛡️';
                        const isNaval = bat.type === 'patriot';
                        const isIronBeam = bat.type === 'iron_beam';
                        const isDavidsSling = bat.type === 'davids_sling';
                        // All interceptors use same thick weight for equal visual presence
                        const weight = 5;
                        const opacity = bi === 0 ? 0.7 : 0.5;
                        
                        return (
                          <React.Fragment key={`int-${src.id}-${ti}-bat-${bi}`}>
                            {/* Trail outer glow */}
                            {!hasIntercepted && bat.trail.length >= 2 && (
                              <Polyline
                                positions={bat.trail}
                                pathOptions={{ color: col, weight: 12, opacity: 0.08 }}
                              />
                            )}
                            {/* Trail line — thick, uniform */}
                            {!hasIntercepted && bat.trail.length >= 2 && (
                              <Polyline
                                positions={bat.trail}
                                pathOptions={{
                                  color: col,
                                  weight,
                                  opacity,
                                  dashArray: isNaval ? '12 6' : undefined,
                                }}
                              />
                            )}
                            {/* Inner bright core */}
                            {!hasIntercepted && bat.trail.length >= 2 && (
                              <Polyline
                                positions={bat.trail}
                                pathOptions={{ color: '#fff', weight: 2, opacity: 0.85 }}
                              />
                            )}
                            {/* Iron Beam — pulsing laser beam */}
                            {!hasIntercepted && isIronBeam && bat.trail.length >= 2 && (
                              <>
                                <Polyline positions={bat.trail} pathOptions={{ color: '#76ff03', weight: 10, opacity: 0.25 + Math.abs(Math.sin(Date.now() / 60 * Math.PI * 12)) * 0.35 }} />
                                <Polyline positions={bat.trail} pathOptions={{ color: '#c6ff00', weight: 4, opacity: 0.6 + Math.abs(Math.sin(Date.now() / 60 * Math.PI * 16)) * 0.4 }} />
                                <Polyline positions={bat.trail} pathOptions={{ color: '#fff', weight: 1.5, opacity: 0.95 }} />
                              </>
                            )}
                            {/* David's Sling — bright cyan beam */}
                            {!hasIntercepted && isDavidsSling && bat.trail.length >= 2 && (
                              <>
                                <Polyline positions={bat.trail} pathOptions={{ color: '#00e5ff', weight: 10, opacity: 0.2 + Math.abs(Math.sin(Date.now() / 60 * Math.PI * 8)) * 0.25 }} />
                                <Polyline positions={bat.trail} pathOptions={{ color: '#b2ebf2', weight: 2, opacity: 0.85 }} />
                              </>
                            )}
                            {/* Interceptor head marker — large, matching threat size */}
                            {!hasIntercepted && bat.batProgress > 0.05 && (
                              <Marker
                                position={[bat.headLat, bat.headLon]}
                                icon={L.divIcon({
                                  className: '',
                                  html: `<div style="font-size:20px;filter:drop-shadow(0 0 12px ${col}) drop-shadow(0 0 24px ${col}88);transform:translate(-50%,-50%);animation:pulse 0.6s infinite;">${icon}</div>`,
                                  iconSize: [0, 0],
                                  iconAnchor: [0, 0],
                                })}
                                interactive={false}
                              />
                            )}
                            {/* Launch label — subtle, fades quickly */}
                            {!hasIntercepted && bat.batProgress < 0.25 && (
                              <Marker
                                position={[bat.lat, bat.lon]}
                                icon={L.divIcon({
                                  className: '',
                                  html: `<div style="font-family:'Share Tech Mono',monospace;font-size:${isNaval ? 8 : 7}px;color:${col};text-shadow:0 0 6px rgba(0,0,0,1),0 0 12px ${col}44;white-space:nowrap;transform:translate(-50%,14px);opacity:${Math.max(0, 0.8 - bat.batProgress * 3)};text-align:center;line-height:1.3;font-weight:bold;">
                                    ${isNaval ? '🚀 NAVAL LAUNCH' : '🚀 LAUNCH'}<br/>
                                    <span style="font-size:6px;color:${col};">${sysLabel[bat.type] || bat.name}</span>
                                  </div>`,
                                  iconSize: [0, 0],
                                  iconAnchor: [0, 0],
                                })}
                                interactive={false}
                              />
                            )}
                          </React.Fragment>
                        );
                      })}
                      
                      {/* ═══ ENHANCED EXPLOSION — multi-ring cinematic blast ═══ */}
                      {hasIntercepted && explosionFade > 0 && (() => {
                        const interceptAltKm = src.maxAltKm * 4 * interceptPointT * (1 - interceptPointT);
                        const massFactorKm = src.threatCategory === 'missile' ? 8 : src.threatCategory === 'cruise_missile' ? 5 : src.threatCategory === 'rocket' ? 3 : 2;
                        const debrisRadiusKm = Math.max(1.5, interceptAltKm * 0.08 + massFactorKm);
                        const debrisRadiusM = debrisRadiusKm * 1000;
                        const debrisRadiusDeg = debrisRadiusKm / 111;
                        
                        const seed = src.lat * 1000 + target.lon * 100 + ti;
                        const numDebris = src.threatCategory === 'missile' ? 5 : src.threatCategory === 'cruise_missile' ? 4 : 3;
                        const debrisPoints: { lat: number; lon: number; size: 'large' | 'medium' | 'small' }[] = [];
                        for (let d = 0; d < numDebris; d++) {
                          const angle = ((seed * 137.5 + d * 72) % 360) * (Math.PI / 180);
                          const dist = debrisRadiusDeg * (0.3 + ((seed * 17 + d * 31) % 70) / 100);
                          const downrangeBias = 0.2;
                          const biasLat = (target.lat - interceptPt[0]) * downrangeBias;
                          const biasLon = (target.lon - interceptPt[1]) * downrangeBias;
                          debrisPoints.push({
                            lat: interceptPt[0] + Math.cos(angle) * dist + biasLat * (0.5 + d * 0.15),
                            lon: interceptPt[1] + Math.sin(angle) * dist + biasLon * (0.5 + d * 0.15),
                            size: d === 0 ? 'large' : d < 2 ? 'medium' : 'small',
                          });
                        }
                        const debrisFallProgress = Math.min(1, (1 - explosionFade) * 3);

                        // Which systems participated in the kill
                        const killSystems = activeBatteries.slice(0, numBatteries).map(b => sysLabel[b.type] || b.name);
                        const hasNaval = activeBatteries.some(b => b.type === 'patriot');

                        const t = 1 - explosionFade; // 0=just happened, 1=fully faded
                        const flashPhase = Math.max(0, 1 - t * 8); // bright initial flash
                        const firePhase = Math.max(0, 1 - t * 3); // fireball
                        const smokePhase = Math.min(1, t * 2); // smoke appears after flash
                        const shockwavePhase = Math.min(1, t * 5);
                        const sparkSeed = src.lat * 10000 + ti * 137;
                        const numSparks = 12;
                        const sparks: { angle: number; dist: number; size: number }[] = [];
                        for (let s = 0; s < numSparks; s++) {
                          sparks.push({
                            angle: ((sparkSeed + s * 30.5) % 360) * (Math.PI / 180),
                            dist: 800 + ((sparkSeed * 7 + s * 43) % 2000),
                            size: 1 + ((sparkSeed + s * 19) % 3),
                          });
                        }

                        // Dynamic SVG fireball
                        const fireballSize = 80 + t * 40; // grows then dissipates
                        const fireballSvg = `<svg width="${fireballSize}" height="${fireballSize}" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
                          <defs>
                            <radialGradient id="fb-${src.id}-${ti}" cx="50%" cy="50%">
                              <stop offset="0%" stop-color="#fff" stop-opacity="${flashPhase * 0.9}"/>
                              <stop offset="15%" stop-color="#ffea00" stop-opacity="${firePhase * 0.85}"/>
                              <stop offset="35%" stop-color="#ff6d00" stop-opacity="${firePhase * 0.7}"/>
                              <stop offset="60%" stop-color="#ff3d00" stop-opacity="${firePhase * 0.5}"/>
                              <stop offset="80%" stop-color="#bf360c" stop-opacity="${firePhase * 0.3}"/>
                              <stop offset="100%" stop-color="#000" stop-opacity="0"/>
                            </radialGradient>
                            <radialGradient id="smoke-${src.id}-${ti}" cx="50%" cy="50%">
                              <stop offset="0%" stop-color="#555" stop-opacity="${smokePhase * 0.4}"/>
                              <stop offset="50%" stop-color="#333" stop-opacity="${smokePhase * 0.25}"/>
                              <stop offset="100%" stop-color="#111" stop-opacity="0"/>
                            </radialGradient>
                            <filter id="fbglow-${src.id}-${ti}" x="-50%" y="-50%" width="200%" height="200%">
                              <feGaussianBlur stdDeviation="${3 + flashPhase * 5}" result="g"/>
                              <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
                            </filter>
                          </defs>
                          <!-- Smoke cloud (appears after initial flash) -->
                          <circle cx="50" cy="50" r="${35 + smokePhase * 15}" fill="url(#smoke-${src.id}-${ti})" opacity="${smokePhase * explosionFade * 0.6}"/>
                          <!-- Main fireball -->
                          <g filter="url(#fbglow-${src.id}-${ti})">
                            <circle cx="50" cy="50" r="${20 + t * 18}" fill="url(#fb-${src.id}-${ti})">
                              <animate attributeName="r" values="${20+t*18};${22+t*18};${20+t*18}" dur="0.08s" repeatCount="indefinite"/>
                            </circle>
                          </g>
                          <!-- Secondary fire bursts -->
                          ${firePhase > 0.2 ? `
                            <circle cx="${35 + Math.sin(sparkSeed) * 8}" cy="${38 + Math.cos(sparkSeed) * 6}" r="${8 * firePhase}" fill="#ff8f00" opacity="${firePhase * 0.6}">
                              <animate attributeName="r" values="${8*firePhase};${10*firePhase};${8*firePhase}" dur="0.1s" repeatCount="indefinite"/>
                            </circle>
                            <circle cx="${62 + Math.sin(sparkSeed+2) * 7}" cy="${58 + Math.cos(sparkSeed+1) * 8}" r="${6 * firePhase}" fill="#ff6d00" opacity="${firePhase * 0.5}">
                              <animate attributeName="r" values="${6*firePhase};${8*firePhase};${6*firePhase}" dur="0.12s" repeatCount="indefinite"/>
                            </circle>
                            <circle cx="${45 + Math.sin(sparkSeed+3) * 10}" cy="${30 + Math.cos(sparkSeed+2) * 5}" r="${5 * firePhase}" fill="#ffab00" opacity="${firePhase * 0.4}"/>
                          ` : ''}
                          <!-- Hot white core flash -->
                          ${flashPhase > 0 ? `<circle cx="50" cy="50" r="${12 - t * 30}" fill="#fff" opacity="${flashPhase}"/>` : ''}
                        </svg>`;

                        return (
                          <>
                            {/* ── Shockwave rings — expanding outward ── */}
                            <Circle
                              center={interceptPt}
                              radius={500 + shockwavePhase * 12000}
                              pathOptions={{
                                color: '#ffab40', fillColor: 'transparent',
                                fillOpacity: 0, weight: 2.5,
                                opacity: explosionFade * 0.4 * (1 - shockwavePhase),
                              }}
                              interactive={false}
                            />
                            <Circle
                              center={interceptPt}
                              radius={300 + shockwavePhase * 7000}
                              pathOptions={{
                                color: '#ff6d00', fillColor: 'transparent',
                                fillOpacity: 0, weight: 1.5,
                                opacity: explosionFade * 0.3 * (1 - shockwavePhase * 0.8),
                              }}
                              interactive={false}
                            />

                            {/* ── Heat glow area ── */}
                            <Circle
                              center={interceptPt}
                              radius={1000 + t * 3000}
                              pathOptions={{
                                color: '#ff6d00', fillColor: '#ff3d00',
                                fillOpacity: explosionFade * 0.15 * firePhase,
                                weight: 0, opacity: 0,
                              }}
                              interactive={false}
                            />

                            {/* ── SVG Fireball marker ── */}
                            <Marker
                              position={interceptPt}
                              icon={L.divIcon({
                                className: '',
                                html: `<div style="transform:translate(-50%,-50%);pointer-events:none;">
                                  ${fireballSvg}
                                </div>`,
                                iconSize: [0, 0],
                                iconAnchor: [0, 0],
                              })}
                              interactive={false}
                            />

                            {/* ── Flying sparks / embers ── */}
                            {sparks.map((sp, si) => {
                              const spDist = sp.dist * t * 1.5;
                              const spLat = interceptPt[0] + Math.cos(sp.angle) * (spDist / 111000);
                              const spLon = interceptPt[1] + Math.sin(sp.angle) * (spDist / 111000);
                              const spOpacity = Math.max(0, explosionFade * (1 - t * 1.5));
                              if (spOpacity <= 0) return null;
                              return (
                                <CircleMarker
                                  key={`spark-${src.id}-${ti}-${si}`}
                                  center={[spLat, spLon]}
                                  radius={sp.size * (1 - t * 0.5)}
                                  pathOptions={{
                                    color: si % 3 === 0 ? '#ffea00' : si % 3 === 1 ? '#ff6d00' : '#ff3d00',
                                    fillColor: si % 2 === 0 ? '#ffea00' : '#ff8f00',
                                    fillOpacity: spOpacity,
                                    weight: 0.5,
                                    opacity: spOpacity,
                                  }}
                                  interactive={false}
                                />
                              );
                            })}

                            {/* ── Smoke trail wisps ── */}
                            {smokePhase > 0.1 && [0, 1, 2, 3].map(si => {
                              const sAngle = ((sparkSeed + si * 90) % 360) * (Math.PI / 180);
                              const sDist = (600 + si * 400) * smokePhase;
                              const sLat = interceptPt[0] + Math.cos(sAngle) * (sDist / 111000);
                              const sLon = interceptPt[1] + Math.sin(sAngle) * (sDist / 111000);
                              return (
                                <CircleMarker
                                  key={`smoke-wisp-${src.id}-${ti}-${si}`}
                                  center={[sLat, sLon]}
                                  radius={3 + smokePhase * 4}
                                  pathOptions={{
                                    color: '#555', fillColor: '#444',
                                    fillOpacity: smokePhase * explosionFade * 0.25,
                                    weight: 0, opacity: 0,
                                  }}
                                  interactive={false}
                                />
                              );
                            })}

                            {/* ── Intercept info label ── */}
                            <Marker
                              position={interceptPt}
                              icon={L.divIcon({
                                className: '',
                                html: `<div style="font-family:'Share Tech Mono',monospace;font-size:8px;color:#4fc3f7;text-shadow:0 0 8px rgba(0,0,0,0.95),0 0 12px rgba(79,195,247,0.5);white-space:nowrap;transform:translate(-50%,-${60 + t * 30}px);opacity:${explosionFade};font-weight:bold;text-align:center;line-height:1.5;">
                                  ✓ INTERCEPTED${numBatteries > 1 ? ` (×${numBatteries})` : ''}<br/>
                                  <span style="color:#ffab40;font-size:6px;">ALT ${interceptAltKm.toFixed(0)}km · ${killSystems.join(' + ')}</span>
                                  ${hasNaval ? '<br/><span style="color:#42a5f5;font-size:5px;">🇺🇸 US NAVY ASSIST</span>' : ''}
                                </div>`,
                                iconSize: [0, 0],
                                iconAnchor: [0, 0],
                              })}
                              interactive={false}
                            />

                            {/* Debris danger zone */}
                            <Circle
                              center={interceptPt}
                              radius={debrisRadiusM}
                              pathOptions={{
                                color: '#ff6d00', fillColor: '#ff6d00',
                                fillOpacity: 0.06 * (0.5 + debrisFallProgress * 0.5),
                                weight: 1, opacity: 0.3 + debrisFallProgress * 0.2,
                                dashArray: '6 3',
                              }}
                              interactive={false}
                            />
                            <Marker
                              position={[interceptPt[0] + debrisRadiusDeg * 0.8, interceptPt[1]]}
                              icon={L.divIcon({
                                className: '',
                                html: `<div style="font-family:'Share Tech Mono',monospace;font-size:6px;color:#ff6d00;text-shadow:0 0 4px rgba(0,0,0,0.9);white-space:nowrap;transform:translate(-50%,-50%);opacity:${0.3 + debrisFallProgress * 0.5};">⚠ DEBRIS ZONE ${debrisRadiusKm.toFixed(1)}km</div>`,
                                iconSize: [0, 0],
                                iconAnchor: [0, 0],
                              })}
                              interactive={false}
                            />

                            {/* Debris fall points */}
                            {debrisPoints.map((dp, di) => {
                              const dpAppearAt = di / numDebris;
                              if (debrisFallProgress < dpAppearAt) return null;
                              const dpFade = Math.min(1, (debrisFallProgress - dpAppearAt) * 3);
                              const sizeMap = { large: { r: 600, icon: '🔥', fontSize: 14, label: 'שבר גדול' }, medium: { r: 400, icon: '⚠️', fontSize: 11, label: 'שבר' }, small: { r: 250, icon: '▼', fontSize: 8, label: 'רסיס' } };
                              const s = sizeMap[dp.size];
                              return (
                                <React.Fragment key={`debris-${src.id}-${ti}-${di}`}>
                                  <Circle
                                    center={[dp.lat, dp.lon]}
                                    radius={s.r}
                                    pathOptions={{
                                      color: dp.size === 'large' ? '#ff3d00' : '#ff6d00',
                                      fillColor: dp.size === 'large' ? '#ff3d00' : '#ff9100',
                                      fillOpacity: dpFade * 0.2,
                                      weight: 1.5, opacity: dpFade * 0.6,
                                    }}
                                    interactive={false}
                                  />
                                  <Marker
                                    position={[dp.lat, dp.lon]}
                                    icon={L.divIcon({
                                      className: '',
                                      html: `<div style="font-size:${s.fontSize}px;transform:translate(-50%,-50%);opacity:${dpFade};filter:drop-shadow(0 0 6px ${dp.size === 'large' ? '#ff3d00' : '#ff6d00'});${dp.size !== 'small' ? `animation:pulse 1.5s infinite;` : ''}">${s.icon}</div>`,
                                      iconSize: [0, 0],
                                      iconAnchor: [0, 0],
                                    })}
                                    interactive={false}
                                  />
                                  <Marker
                                    position={[dp.lat, dp.lon]}
                                    icon={L.divIcon({
                                      className: '',
                                      html: `<div style="font-family:'Heebo',sans-serif;font-size:6px;color:${dp.size === 'large' ? '#ff3d00' : '#ff9100'};text-shadow:0 0 4px rgba(0,0,0,0.95);white-space:nowrap;transform:translate(-50%,10px);opacity:${dpFade * 0.8};font-weight:700;">${s.label}</div>`,
                                      iconSize: [0, 0],
                                      iconAnchor: [0, 0],
                                    })}
                                    interactive={false}
                                  />
                                </React.Fragment>
                              );
                            })}
                          </>
                        );
                      })()}
                    </>
                  );
                })()}

                {/* ═══ Threat icon + data — hidden after interception ═══ */}
                {p < 0.82 && (
                <Marker
                  position={[missileLat, missileLon]}
                  icon={L.divIcon({
                    className: '',
                    html: (() => {
                      const threatLabel = src.threatCategory === 'uav' ? 'UAV' : src.threatCategory === 'cruise_missile' ? 'CRUISE' : src.threatCategory === 'rocket' ? 'ROCKET' : 'MISSILE';
                      const phaseLabel = src.threatCategory === 'uav'
                        ? (p < 0.3 ? '✈ LAUNCH' : p < 0.7 ? '✈ CRUISE' : '✈ APPROACH')
                        : (p < 0.2 ? '🔥 BOOST' : p < 0.45 ? '↗ ASCENT' : p < 0.55 ? '🛰 APOGEE' : p < 0.85 ? '↘ RE-ENTRY' : '💀 TERMINAL');
                      const isBoost = p < 0.25;
                      const flameLen = isBoost ? 18 : 10;
                      const flameOp = isBoost ? 1 : 0.7;
                      const uniqueId = `m${src.id}-${ti}`.replace(/[^a-zA-Z0-9]/g,'');

                      // SVG icons per threat category
                      const missileSvg = src.threatCategory === 'uav'
                        // ── UAV / Drone ──
                        ? `<svg width="38" height="38" viewBox="0 0 38 38" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <defs>
                              <filter id="glow-${uniqueId}" x="-50%" y="-50%" width="200%" height="200%">
                                <feGaussianBlur stdDeviation="2" result="g"/>
                                <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
                              </filter>
                            </defs>
                            <g filter="url(#glow-${uniqueId})">
                              <!-- fuselage -->
                              <ellipse cx="19" cy="19" rx="10" ry="3.5" fill="${missileColor}" opacity="0.9"/>
                              <!-- wings -->
                              <path d="M10 19 L4 12 L16 17 Z" fill="${missileColor}" opacity="0.7"/>
                              <path d="M10 19 L4 26 L16 21 Z" fill="${missileColor}" opacity="0.7"/>
                              <!-- tail -->
                              <path d="M28 19 L34 14 L30 19 L34 24 Z" fill="${missileColor}" opacity="0.6"/>
                              <!-- cockpit -->
                              <ellipse cx="12" cy="19" rx="3" ry="2" fill="#fff" opacity="0.3"/>
                              <!-- propeller blur -->
                              <circle cx="7" cy="19" r="2.5" fill="#fff" opacity="0.15">
                                <animate attributeName="opacity" values="0.15;0.05;0.15" dur="0.15s" repeatCount="indefinite"/>
                              </circle>
                            </g>
                          </svg>`
                        : src.threatCategory === 'cruise_missile'
                        // ── Cruise Missile ──
                        ? `<svg width="42" height="24" viewBox="0 0 42 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <defs>
                              <linearGradient id="body-${uniqueId}" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stop-color="#ddd"/>
                                <stop offset="50%" stop-color="${missileColor}"/>
                                <stop offset="100%" stop-color="#888"/>
                              </linearGradient>
                              <linearGradient id="flame-${uniqueId}" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stop-color="#ff6600" stop-opacity="${flameOp}"/>
                                <stop offset="40%" stop-color="#ffcc00" stop-opacity="0.8"/>
                                <stop offset="100%" stop-color="#ff330033" stop-opacity="0"/>
                              </linearGradient>
                              <filter id="glow-${uniqueId}" x="-50%" y="-50%" width="200%" height="200%">
                                <feGaussianBlur stdDeviation="1.5" result="g"/>
                                <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
                              </filter>
                            </defs>
                            <g filter="url(#glow-${uniqueId})">
                              <!-- exhaust flame -->
                              <ellipse cx="${36 + flameLen/2}" cy="12" rx="${flameLen/2}" ry="3" fill="url(#flame-${uniqueId})">
                                <animate attributeName="rx" values="${flameLen/2};${flameLen/2+2};${flameLen/2}" dur="0.12s" repeatCount="indefinite"/>
                                <animate attributeName="ry" values="3;4;3" dur="0.15s" repeatCount="indefinite"/>
                              </ellipse>
                              <!-- body -->
                              <rect x="8" y="9" width="28" height="6" rx="3" fill="url(#body-${uniqueId})"/>
                              <!-- nosecone -->
                              <path d="M8 12 L2 12 L8 9 Z" fill="#ccc"/>
                              <path d="M8 12 L2 12 L8 15 Z" fill="#aaa"/>
                              <!-- wings -->
                              <path d="M20 9 L16 2 L24 9 Z" fill="${missileColor}" opacity="0.8"/>
                              <path d="M20 15 L16 22 L24 15 Z" fill="${missileColor}" opacity="0.8"/>
                              <!-- tail fins -->
                              <path d="M34 9 L37 4 L36 9 Z" fill="#999"/>
                              <path d="M34 15 L37 20 L36 15 Z" fill="#999"/>
                            </g>
                          </svg>`
                        : src.threatCategory === 'rocket'
                        // ── Rocket (Qassam, Grad, etc.) ──
                        ? `<svg width="36" height="20" viewBox="0 0 36 20" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <defs>
                              <linearGradient id="rbody-${uniqueId}" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stop-color="#bbb"/>
                                <stop offset="100%" stop-color="${missileColor}"/>
                              </linearGradient>
                              <linearGradient id="rflame-${uniqueId}" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stop-color="#ff4400" stop-opacity="${flameOp}"/>
                                <stop offset="50%" stop-color="#ffaa00" stop-opacity="0.7"/>
                                <stop offset="100%" stop-color="#ff220000" stop-opacity="0"/>
                              </linearGradient>
                              <filter id="glow-${uniqueId}" x="-50%" y="-50%" width="200%" height="200%">
                                <feGaussianBlur stdDeviation="1.2" result="g"/>
                                <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
                              </filter>
                            </defs>
                            <g filter="url(#glow-${uniqueId})">
                              <!-- flame -->
                              <ellipse cx="${30 + flameLen/2}" cy="10" rx="${flameLen/2}" ry="2.5" fill="url(#rflame-${uniqueId})">
                                <animate attributeName="rx" values="${flameLen/2};${flameLen/2+3};${flameLen/2}" dur="0.1s" repeatCount="indefinite"/>
                              </ellipse>
                              <!-- body tube -->
                              <rect x="8" y="7" width="22" height="6" rx="2" fill="url(#rbody-${uniqueId})"/>
                              <!-- warhead -->
                              <path d="M8 10 L2 10 L8 7 Z" fill="#ddd"/>
                              <path d="M8 10 L2 10 L8 13 Z" fill="#bbb"/>
                              <!-- tail fins -->
                              <path d="M28 7 L32 3 L30 7 Z" fill="${missileColor}" opacity="0.7"/>
                              <path d="M28 13 L32 17 L30 13 Z" fill="${missileColor}" opacity="0.7"/>
                            </g>
                          </svg>`
                        // ── Ballistic Missile (Shahab, SCUD, etc.) ──
                        : `<svg width="44" height="22" viewBox="0 0 44 22" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <defs>
                              <linearGradient id="bbody-${uniqueId}" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stop-color="#eee"/>
                                <stop offset="50%" stop-color="${missileColor}"/>
                                <stop offset="100%" stop-color="#666"/>
                              </linearGradient>
                              <linearGradient id="bflame-${uniqueId}" x1="0" y1="0" x2="1" y2="0">
                                <stop offset="0%" stop-color="#ff2200" stop-opacity="${flameOp}"/>
                                <stop offset="30%" stop-color="#ff8800" stop-opacity="0.9"/>
                                <stop offset="60%" stop-color="#ffcc00" stop-opacity="0.5"/>
                                <stop offset="100%" stop-color="#ff440000" stop-opacity="0"/>
                              </linearGradient>
                              <filter id="glow-${uniqueId}" x="-50%" y="-50%" width="200%" height="200%">
                                <feGaussianBlur stdDeviation="2" result="g"/>
                                <feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
                              </filter>
                            </defs>
                            <g filter="url(#glow-${uniqueId})">
                              <!-- big exhaust plume -->
                              <ellipse cx="${38 + flameLen/1.5}" cy="11" rx="${flameLen/1.2}" ry="4" fill="url(#bflame-${uniqueId})">
                                <animate attributeName="rx" values="${flameLen/1.2};${flameLen/1.2+3};${flameLen/1.2}" dur="0.08s" repeatCount="indefinite"/>
                                <animate attributeName="ry" values="4;5.5;4" dur="0.12s" repeatCount="indefinite"/>
                              </ellipse>
                              <!-- smoke puffs -->
                              <circle cx="${42 + flameLen}" cy="9" r="3" fill="#fff" opacity="0.15">
                                <animate attributeName="cx" values="${42+flameLen};${48+flameLen}" dur="0.6s" repeatCount="indefinite"/>
                                <animate attributeName="opacity" values="0.15;0" dur="0.6s" repeatCount="indefinite"/>
                              </circle>
                              <circle cx="${42 + flameLen}" cy="13" r="2.5" fill="#fff" opacity="0.1">
                                <animate attributeName="cx" values="${42+flameLen};${50+flameLen}" dur="0.8s" repeatCount="indefinite"/>
                                <animate attributeName="opacity" values="0.1;0" dur="0.8s" repeatCount="indefinite"/>
                              </circle>
                              <!-- body -->
                              <rect x="6" y="7" width="32" height="8" rx="4" fill="url(#bbody-${uniqueId})"/>
                              <!-- nosecone -->
                              <path d="M6 11 L0 11 L6 7 Z" fill="#ddd"/>
                              <path d="M6 11 L0 11 L6 15 Z" fill="#aaa"/>
                              <!-- stage separation line -->
                              <line x1="22" y1="7" x2="22" y2="15" stroke="#444" stroke-width="0.5" opacity="0.5"/>
                              <!-- tail fins -->
                              <path d="M36 7 L40 2 L38 7 Z" fill="${missileColor}" opacity="0.8"/>
                              <path d="M36 15 L40 20 L38 15 Z" fill="${missileColor}" opacity="0.8"/>
                              <path d="M34 7 L36 4 L36 7 Z" fill="${missileColor}" opacity="0.5"/>
                              <path d="M34 15 L36 18 L36 15 Z" fill="${missileColor}" opacity="0.5"/>
                            </g>
                          </svg>`;

                      return `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);pointer-events:auto;">
                        <div style="transform:rotate(${bearing + 90}deg);filter:drop-shadow(0 0 6px ${missileColor}) drop-shadow(0 0 14px ${missileColor});animation:missilePulse 0.8s ease-in-out infinite alternate;">
                          ${missileSvg}
                        </div>
                        <div style="font-family:'Share Tech Mono',monospace;font-size:4px;color:#fff;text-shadow:0 0 3px ${missileColor},0 0 5px ${missileColor},0 1px 2px rgba(0,0,0,1);white-space:nowrap;line-height:1.2;background:rgba(0,0,0,0.75);padding:1px 3px;border-left:2px solid ${missileColor};border-radius:2px;margin-top:1px;text-align:left;box-shadow:0 0 6px ${missileColor}44;">
                          <b style="color:${missileColor};letter-spacing:0.3px;text-shadow:0 0 4px ${missileColor};">${src.nameEn}</b> <span style="color:#fff;font-size:3px;font-weight:bold;">${threatLabel}</span><br/>
                          <span style="font-size:3px;color:#fffc;text-shadow:0 0 2px ${missileColor};">↕${altKm.toFixed(0)}km · ${Math.round(speedKmH)}km/h · ${phaseLabel}</span><br/>
                          <span style="font-size:3px;color:#fffa;">→ ${target.name} ${(target.distKm * (1-p)).toFixed(0)}km</span>
                        </div>
                      </div>`;
                    })(),
                    iconSize: [0, 0],
                    iconAnchor: [0, 0],
                  })}
                >
                  <Popup closeButton={false}>
                    <div className="font-mono text-[9px] p-1" style={{ color: src.color }}>
                      <div className="font-bold mb-1">{src.icon} {src.name} → {target.name}</div>
                      <div>סוג: {src.missileType} ({src.threatCategory === 'uav' ? 'כטב"מ' : src.threatCategory === 'rocket' ? 'רקטה' : src.threatCategory === 'cruise_missile' ? 'טיל שיוט' : 'טיל בליסטי'})</div>
                      <div>גובה: {altKm.toFixed(0)} ק״מ</div>
                      <div>מהירות: {Math.round(speedKmH)} קמ״ש</div>
                      <div>שלב: {p < 0.2 ? 'שיגור/עלייה' : p < 0.45 ? 'יציאה מהאטמוספרה' : p < 0.55 ? 'נקודת שיא' : p < 0.85 ? 'כניסה חזרה לאטמוספרה' : 'שלב סופי'}</div>
                      <div>מרחק ליעד: {(target.distKm * (1-p)).toFixed(0)} ק״מ</div>
                      <div>זמן פגיעה: {formatFlightTime(Math.round(src.flightTimeSec * (1-p)))}</div>
                      <div className="mt-1" style={{ color: '#4fc3f7' }}>🛡️ הגנה: {src.defenseSystem}</div>
                      <div className="mt-0.5 text-[8px] text-war-red">⚠️ הערכת סיכון: {target.name}</div>
                    </div>
                  </Popup>
                </Marker>
                )}
              </React.Fragment>
            );
          })
        )}



        {/* ═══ UAV INTRUSION — enemy drones flying over Israeli territory ═══ */}
        {showTrajectories && activeMissiles.filter(src => src.threatCategory === 'uav').map(src => {
          const route = UAV_INTRUSION_ROUTES.find(r => r.sourceId === src.id);
          if (!route) return null;

          const uavProgress = (missileProgress * route.speedFactor) % 1;
          const totalWaypoints = route.waypoints.length;
          const segFloat = uavProgress * (totalWaypoints - 1);
          const segIdx = Math.min(Math.floor(segFloat), totalWaypoints - 2);
          const segT = segFloat - segIdx;
          const wpFrom = route.waypoints[segIdx];
          const wpTo = route.waypoints[Math.min(segIdx + 1, totalWaypoints - 1)];
          const uavLat = wpFrom.lat + (wpTo.lat - wpFrom.lat) * segT;
          const uavLon = wpFrom.lon + (wpTo.lon - wpFrom.lon) * segT;

          // Bearing for rotation
          const uavBearing = Math.atan2(wpTo.lon - wpFrom.lon, wpTo.lat - wpFrom.lat) * (180 / Math.PI);

          // Which waypoints have been passed
          const passedCount = segIdx + 1;

          // Shootdown at ~85% of route
          const shootdownT = 0.85;
          const isShootingDown = uavProgress >= shootdownT;
          const shootdownFade = isShootingDown ? Math.max(0, 1 - (uavProgress - shootdownT) / 0.12) : 0;

          // Shootdown point
          const sdSegFloat = shootdownT * (totalWaypoints - 1);
          const sdSegIdx = Math.min(Math.floor(sdSegFloat), totalWaypoints - 2);
          const sdSegT = sdSegFloat - sdSegIdx;
          const sdWpFrom = route.waypoints[sdSegIdx];
          const sdWpTo = route.waypoints[Math.min(sdSegIdx + 1, totalWaypoints - 1)];
          const sdLat = sdWpFrom.lat + (sdWpTo.lat - sdWpFrom.lat) * sdSegT;
          const sdLon = sdWpFrom.lon + (sdWpTo.lon - sdWpFrom.lon) * sdSegT;

          // Full route polyline
          const routePoints: [number, number][] = route.waypoints.map(wp => [wp.lat, wp.lon]);
          // Traveled portion
          const traveledPoints: [number, number][] = route.waypoints.slice(0, passedCount).map(wp => [wp.lat, wp.lon]);
          traveledPoints.push([uavLat, uavLon]);

          const flash = Math.abs(Math.sin(missileProgress * Math.PI * 3));

          return (
            <React.Fragment key={`uav-intrusion-${src.id}`}>
              {/* Full planned route — faint dotted */}
              <Polyline
                positions={routePoints}
                pathOptions={{ color: '#ce93d8', weight: 1, opacity: 0.12, dashArray: '4 6' }}
              />

              {/* Traveled route — solid warning color */}
              {traveledPoints.length >= 2 && !isShootingDown && (
                <Polyline
                  positions={traveledPoints}
                  pathOptions={{ color: '#ff1744', weight: 2.5, opacity: 0.6 }}
                />
              )}

              {/* Waypoint markers — light up as UAV passes */}
              {route.waypoints.map((wp, wi) => {
                const isPassed = wi < passedCount;
                const isCurrent = wi === segIdx || wi === segIdx + 1;
                const alertColor = isPassed ? '#ff1744' : '#ce93d880';
                const pulseAnim = isCurrent && !isShootingDown ? `animation:pulse 0.8s infinite;` : '';

                return (
                  <React.Fragment key={`uav-wp-${src.id}-${wi}`}>
                    {/* Danger zone circle around passed cities */}
                    {isPassed && !isShootingDown && (
                      <Circle
                        center={[wp.lat, wp.lon]}
                        radius={4000 + flash * 2000}
                        pathOptions={{
                          color: '#ff1744',
                          fillColor: '#ff1744',
                          fillOpacity: 0.06 + flash * 0.04,
                          weight: 1,
                          opacity: 0.3 + flash * 0.2,
                          dashArray: '4 4',
                        }}
                        interactive={false}
                      />
                    )}
                    {/* Waypoint label */}
                    <Marker
                      position={[wp.lat, wp.lon]}
                      icon={L.divIcon({
                        className: '',
                        html: `<div style="font-family:'Heebo',sans-serif;font-size:7px;color:${alertColor};text-shadow:0 0 4px rgba(0,0,0,0.95);white-space:nowrap;transform:translate(-50%,-20px);font-weight:800;${pulseAnim}">
                          ${isPassed ? '⚠️' : '○'} ${wp.name}
                          ${isPassed && !isShootingDown ? '<span style="font-size:5px;color:#ff8a80;"> כטב״מ עבר</span>' : ''}
                        </div>`,
                        iconSize: [0, 0],
                        iconAnchor: [0, 0],
                      })}
                      interactive={false}
                    />
                  </React.Fragment>
                );
              })}

              {/* UAV icon — compact enemy drone marker */}
              {!isShootingDown && (
                <Marker
                  position={[uavLat, uavLon]}
                  icon={L.divIcon({
                    className: '',
                    html: `<div style="display:flex;align-items:center;gap:3px;transform:translate(-50%,-50%);pointer-events:auto;">
                      <div style="font-size:16px;transform:rotate(${uavBearing + 90}deg);filter:drop-shadow(0 0 6px #ff1744);animation:pulse 0.6s infinite;">🛩️</div>
                      <div style="font-family:'Share Tech Mono',monospace;font-size:6px;color:#ff1744;text-shadow:0 0 4px rgba(0,0,0,0.95);white-space:nowrap;background:rgba(183,28,28,0.55);padding:1px 4px;border:1px solid #ff174455;border-radius:2px;font-weight:bold;line-height:1.2;">
                        ⚠ UAV אויב · ${src.nameEn}<br/>
                        <span style="color:#ff8a80;font-size:5px;">ALT ${(src.maxAltKm * 4 * uavProgress * (1 - uavProgress)).toFixed(1)}km → ${wpTo.name}</span>
                      </div>
                    </div>`,
                    iconSize: [0, 0],
                    iconAnchor: [0, 0],
                  })}
                  interactive={false}
                />
              )}

              {/* ── IAF Interceptor pursuit ── */}
              {(() => {
                const base = UAV_INTERCEPTOR_BASES[src.id];
                if (!base) return null;

                const interceptLaunchT = 0.2;
                const interceptCatchT = shootdownT;
                if (uavProgress < interceptLaunchT) return null;

                const interceptProgress = Math.min(1, (uavProgress - interceptLaunchT) / (interceptCatchT - interceptLaunchT));
                const eased = 1 - Math.pow(1 - interceptProgress, 2);

                const intLat = base.lat + (uavLat - base.lat) * eased;
                const intLon = base.lon + (uavLon - base.lon) * eased;
                const intBearing = Math.atan2(uavLon - intLon, uavLat - intLat) * (180 / Math.PI);

                const trailSteps = 12;
                const pursuitTrail: [number, number][] = [[base.lat, base.lon]];
                for (let i = 1; i <= trailSteps; i++) {
                  const t = (i / trailSteps) * eased;
                  const arcOffset = Math.sin(t * Math.PI) * 0.08;
                  pursuitTrail.push([
                    base.lat + (uavLat - base.lat) * t + arcOffset,
                    base.lon + (uavLon - base.lon) * t,
                  ]);
                }

                return (
                  <>
                    {/* Pursuit trail — blue dashed */}
                    {!isShootingDown && pursuitTrail.length >= 2 && (
                      <Polyline
                        positions={pursuitTrail}
                        pathOptions={{ color: '#4fc3f7', weight: 2, opacity: 0.5, dashArray: '6 4' }}
                      />
                    )}

                    {/* Base marker */}
                    <Marker
                      position={[base.lat, base.lon]}
                      icon={L.divIcon({
                        className: '',
                        html: `<div style="font-family:'Share Tech Mono',monospace;font-size:6px;color:#4fc3f7;text-shadow:0 0 4px rgba(0,0,0,0.95);white-space:nowrap;transform:translate(-50%,8px);opacity:0.7;">
                          ⚡ ${base.aircraft} · ${base.name}
                        </div>`,
                        iconSize: [0, 0],
                        iconAnchor: [0, 0],
                      })}
                      interactive={false}
                    />

                    {/* Interceptor aircraft icon */}
                    {!isShootingDown && (
                      <Marker
                        position={[intLat, intLon]}
                        icon={L.divIcon({
                          className: '',
                          html: `<div style="display:flex;align-items:center;gap:3px;transform:translate(-50%,-50%);">
                            <div style="font-size:14px;transform:rotate(${intBearing + 90}deg);filter:drop-shadow(0 0 6px #4fc3f7);">⚡</div>
                            <div style="font-family:'Share Tech Mono',monospace;font-size:5px;color:#4fc3f7;text-shadow:0 0 3px rgba(0,0,0,0.95);white-space:nowrap;background:rgba(13,71,161,0.6);padding:1px 3px;border:1px solid #4fc3f744;border-radius:2px;font-weight:bold;">
                              🛡️ ${base.aircraft} · מרדף
                            </div>
                          </div>`,
                          iconSize: [0, 0],
                          iconAnchor: [0, 0],
                        })}
                        interactive={false}
                      />
                    )}

                    {/* Distance closing line between interceptor and UAV */}
                    {!isShootingDown && interceptProgress < 0.95 && (
                      <Polyline
                        positions={[[intLat, intLon], [uavLat, uavLon]]}
                        pathOptions={{ color: '#76ff03', weight: 1, opacity: 0.35 + flash * 0.25, dashArray: '2 4' }}
                      />
                    )}
                  </>
                );
        })()}


              {isShootingDown && shootdownFade > 0 && (
                <>
                  {/* Explosion flash */}
                  <Circle
                    center={[sdLat, sdLon]}
                    radius={3000 * (1 + (1 - shootdownFade) * 3)}
                    pathOptions={{
                      color: '#ff6d00',
                      fillColor: '#ffab00',
                      fillOpacity: shootdownFade * 0.3,
                      weight: 2,
                      opacity: shootdownFade * 0.7,
                    }}
                    interactive={false}
                  />
                  <Marker
                    position={[sdLat, sdLon]}
                    icon={L.divIcon({
                      className: '',
                      html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%);opacity:${shootdownFade};">
                        <div style="font-size:${28 + (1 - shootdownFade) * 12}px;filter:drop-shadow(0 0 12px #ff6d00) drop-shadow(0 0 24px #ff1744);">💥</div>
                        <div style="font-family:'Share Tech Mono',monospace;font-size:8px;color:#4fc3f7;text-shadow:0 0 6px rgba(0,0,0,0.95);white-space:nowrap;font-weight:bold;background:rgba(0,0,0,0.6);padding:2px 6px;border-radius:3px;border:1px solid #4fc3f766;margin-top:3px;">
                          🛡️ כטב״מ הופל!
                        </div>
                      </div>`,
                      iconSize: [0, 0],
                      iconAnchor: [0, 0],
                    })}
                    interactive={false}
                  />
                </>
              )}

              {/* Route info label at start */}
              <Marker
                position={[route.waypoints[0].lat, route.waypoints[0].lon]}
                icon={L.divIcon({
                  className: '',
                  html: `<div style="font-family:'Share Tech Mono',monospace;font-size:6px;color:#ce93d8;text-shadow:0 0 4px rgba(0,0,0,0.95);white-space:nowrap;transform:translate(-50%,12px);opacity:0.6;">
                    ✈ UAV INTRUSION — ${src.nameEn}
                  </div>`,
                  iconSize: [0, 0],
                  iconAnchor: [0, 0],
                })}
                interactive={false}
              />
            </React.Fragment>
          );
        })}

        {/* Missile source icons */}
        {showTrajectories && activeMissiles.map(src => (
          <Marker
            key={`src-${src.id}`}
            position={[src.lat, src.lon]}
            icon={L.divIcon({
              className: '',
              html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%) scale(0.75);opacity:0.55;">
                <div style="font-size:16px;filter:drop-shadow(0 0 4px ${src.color});animation:pulse 2s infinite;">${src.icon}</div>
                <div style="font-family:'Share Tech Mono',monospace;font-size:7px;color:${src.color};text-shadow:0 1px 3px rgba(0,0,0,1);white-space:nowrap;margin-top:1px;font-weight:bold;">${src.nameEn}</div>
              </div>`,
              iconSize: [50, 32],
              iconAnchor: [25, 16],
            })}
          >
            <Popup>
              <div className="font-mono">
                <div className="text-sm font-bold" style={{ color: src.color }}>{src.icon} {src.name}</div>
                <div className="text-[10px] text-foreground/60">{src.nameEn} — {src.threatCategory === 'uav' ? 'כטב"מ' : src.threatCategory === 'rocket' ? 'רקטה' : src.threatCategory === 'cruise_missile' ? 'טיל שיוט' : 'טיל בליסטי'}</div>
                <div className="text-[10px] text-foreground/60">{src.missileType}</div>
                <div className="text-[10px] text-foreground/60">זמן טיסה: {formatFlightTime(src.flightTimeSec)} • גובה מקס: {src.maxAltKm} ק״מ</div>
                <div className="text-[10px]" style={{ color: '#4fc3f7' }}>🛡️ הגנה: {src.defenseSystem}</div>
                <div className="text-[10px] text-foreground/60">יעדים: {src.targets.map(t => t.name).join(', ')}</div>
              </div>
            </Popup>
          </Marker>
        ))}

        {/* ═══ Defense Systems — REMOVED (visual clutter) ═══ */}

        {/* Defense Range Circles — REMOVED to reduce visual clutter */}

        {/* ═══ Interception Lines — REMOVED (visual clutter) ═══ */}

        {userGPS && (
          <>
            {/* Soft radial pulse ring */}
            <Circle
              center={[userGPS.lat, userGPS.lon]}
              radius={55}
              pathOptions={{ color: '#00e5ff', fillColor: '#00e5ff', fillOpacity: 0.08, weight: 0.8, opacity: 0.2 }}
            />
            {/* Cute compact marker — no dark background */}
            <Marker
              position={[userGPS.lat, userGPS.lon]}
              icon={L.divIcon({
                className: '',
                html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);filter:drop-shadow(0 2px 6px rgba(0,229,255,0.35));animation:userBounce 2.5s ease-in-out infinite;">
                  <span style="font-size:22px;line-height:1;">📍</span>
                  <span style="font-family:'Heebo',sans-serif;font-size:8px;line-height:1;font-weight:700;color:#00e5ff;text-shadow:0 0 6px rgba(0,0,0,0.9),0 1px 2px rgba(0,0,0,0.8);letter-spacing:0.5px;margin-top:-2px;">אני כאן</span>
                </div>
                <style>@keyframes userBounce{0%,100%{transform:translate(-50%,-100%) translateY(0)}50%{transform:translate(-50%,-100%) translateY(-3px)}} @keyframes missilePulse{0%{opacity:0.7;transform:scale(1)}100%{opacity:1;transform:scale(1.15)}}</style>`,
                iconSize: [30, 34],
                iconAnchor: [15, 34],
              })}
              zIndexOffset={2000}
            >
              <Popup><div className="font-mono text-[10px] p-1">📍 <b>המיקום שלך</b></div></Popup>
            </Marker>
          </>
        )}

        {/* ═══ INFILTRATION LAYER — Terrorist breach + IDF/Police lockdown ═══ */}
        {showInfiltration && (() => {
          // Detect infiltration from oref alerts or telegram
          const terrorKeywords = ['חדירת מחבלים', 'חדירה', 'פיגוע ירי', 'פיגוע דקירה', 'פיגוע דריסה', 'חשד לחדירה', 'סכנת חדירה', 'אירוע חבלני', 'פיגוע'];
          const droneKeywords = ['חדירת כלי טיס', 'כטב"מ', 'מל"ט', 'רחפן', 'כלי טיס עוין', 'כלי טיס חשוד', 'drone', 'UAV'];
          const missileKeywords = ['טיל', 'טילים', 'שיגור', 'רקטה', 'רקטות', 'ירי רקטות', 'בליסטי', 'טיל שיוט', 'missile'];
          const allInfiltrationKeywords = [...terrorKeywords, ...droneKeywords, ...missileKeywords];
          
          const classifyThreat = (text: string, lat?: number): 'drone' | 'missile' | 'terror' => {
            if (droneKeywords.some(kw => text.includes(kw))) return 'drone';
            if (missileKeywords.some(kw => text.includes(kw))) {
              // South (below Be'er Sheva) and central inland (Beit Shemesh area) — 
              // less likely to be direct missile fire; reclassify as terror/infiltration
              // unless the text explicitly says "רקטה" or "טיל"
              if (lat && lat < 31.0 && !text.includes('רקטה') && !text.includes('טיל')) return 'terror';
              return 'missile';
            }
            return 'terror';
          };
          
          const telegramInfiltration = telegram.messages.filter(m => !m.is_duplicate && m.text && allInfiltrationKeywords.some(kw => m.text!.includes(kw)));
          const orefInfiltration = orefAlerts.filter(a => {
            const t = (a.title || '') + (a.description || '');
            return allInfiltrationKeywords.some(kw => t.includes(kw));
          });
          
          // Build infiltration zones — from real alerts or demo
          type InfiltrationZone = { id: string; lat: number; lon: number; name: string; status: 'active' | 'contained' | 'cleared'; radiusM: number; time: string; source: string; threatType: 'drone' | 'missile' | 'terror'; };
          const zones: InfiltrationZone[] = [];
          
          // From oref alerts
          for (const alert of orefInfiltration) {
            const loc = alert.locations?.[0];
            const gps = loc ? (CITY_GPS_LOOKUP as Record<string, { lat: number; lon: number }>)[loc] : null;
            if (gps) {
              const ageMins = Math.max(0, Math.floor((Date.now() - new Date(alert.alert_date).getTime()) / 60000));
              zones.push({
                id: `oref-inf-${alert.id}`,
                lat: gps.lat, lon: gps.lon,
                name: loc || 'לא ידוע',
                status: ageMins > 60 ? 'cleared' : ageMins > 30 ? 'contained' : 'active',
                radiusM: ageMins > 30 ? 800 : 1500,
                time: new Date(alert.alert_date).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
                source: 'פיקוד העורף',
                threatType: classifyThreat((alert.title || '') + (alert.description || ''), gps.lat),
              });
            }
          }
          
          // From telegram 
          for (const msg of telegramInfiltration.slice(0, 5)) {
            // Try matching city names from message text
            const matchedCity = Object.keys(CITY_GPS_LOOKUP).find(city => msg.text?.includes(city));
            if (matchedCity) {
              const gps = (CITY_GPS_LOOKUP as Record<string, { lat: number; lon: number }>)[matchedCity];
              const ageMins = Math.floor((Date.now() - new Date(msg.message_date || msg.created_at).getTime()) / 60000);
              if (!zones.some(z => Math.abs(z.lat - gps.lat) < 0.01 && Math.abs(z.lon - gps.lon) < 0.01)) {
                zones.push({
                  id: `tg-inf-${msg.id}`,
                  lat: gps.lat, lon: gps.lon,
                  name: matchedCity,
                  status: ageMins > 45 ? 'contained' : 'active',
                  radiusM: 1200,
                  time: new Date(msg.message_date || msg.created_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
                  source: 'טלגרם',
                  threatType: classifyThreat(msg.text || ''),
                });
              }
            }
          }
          
          // No demo infiltration zones — only show verified real events
          // Demo zones removed per user request
          
          if (zones.length === 0) return null;
          
          const now = Date.now();
          const pulse = Math.sin(now / 500) * 0.15 + 0.35;
          
          return (
            <>
              {zones.map(zone => {
                const threatIcons = { drone: '🛸', missile: '🚀', terror: '⚠️' };
                const threatLabels = { 
                  drone: { active: '🔴 חדירת כלי טיס — רחפן באזור', contained: '🟠 רחפן — כוחות בזירה', cleared: '🟢 רחפן — אזור נוקה' },
                  missile: { active: '🔴 שיגור טילים — הישארו במרחב מוגן', contained: '🟠 טילים — כוחות בזירה', cleared: '🟢 טילים — אזור נוקה' },
                  terror: { active: '🔴 חדירה פעילה — סגר אזור', contained: '🟠 מכותר — כוחות בזירה', cleared: '🟢 אזור נוקה' },
                };
                const threatIcon = threatIcons[zone.threatType];
                const threatLabel = threatLabels[zone.threatType][zone.status];
                
                // Animated offset for drone/missile flying over the zone
                const flyOffset = zone.threatType !== 'terror' ? {
                  dLat: Math.sin(now / 2000 + zone.lat * 100) * (zone.radiusM / 111320) * 0.6,
                  dLon: Math.cos(now / 3000 + zone.lon * 100) * (zone.radiusM / (111320 * Math.cos(zone.lat * Math.PI / 180))) * 0.6,
                  rotation: zone.threatType === 'missile' ? (Math.atan2(Math.cos(now / 3000), Math.sin(now / 2000)) * 180 / Math.PI) : 0,
                } : null;
                const colors = {
                  active: { fill: '#ff1744', stroke: '#ff1744' },
                  contained: { fill: '#ff6d00', stroke: '#ff6d00' },
                  cleared: { fill: '#00e676', stroke: '#00e67644' },
                };
                const c = colors[zone.status];
                const instruction = zone.threatType === 'missile' 
                  ? 'הנחיה: היכנסו למרחב מוגן · סגרו חלונות'
                  : zone.threatType === 'drone'
                  ? 'הנחיה: היכנסו למבנה · התרחקו מחלונות'
                  : 'הנחיה: הישארו בבתים · נעלו דלתות ותריסים';
                
                return (
                  <React.Fragment key={zone.id}>
                    {/* Outer danger zone */}
                    <Circle
                      center={[zone.lat, zone.lon]}
                      radius={zone.radiusM}
                      pathOptions={{
                        color: c.stroke,
                        weight: 2,
                        opacity: zone.status === 'active' ? pulse : 0.4,
                        fillColor: c.fill,
                        fillOpacity: zone.status === 'active' ? pulse * 0.15 : 0.06,
                        dashArray: zone.status === 'active' ? '10 5' : '5 10',
                      }}
                    />
                    {/* Inner perimeter — IDF cordon */}
                    <Circle
                      center={[zone.lat, zone.lon]}
                      radius={zone.radiusM * 0.4}
                      pathOptions={{
                        color: '#ffab00',
                        weight: 2,
                        opacity: 0.6,
                        fillColor: '#ffab00',
                        fillOpacity: 0.08,
                        dashArray: '4 4',
                      }}
                    />
                    
                    {/* Roadblock markers — 4 cardinal points on perimeter */}
                    {[0, 90, 180, 270].map(angle => {
                      const rad = (angle * Math.PI) / 180;
                      const dLat = (zone.radiusM / 111320) * Math.cos(rad);
                      const dLon = (zone.radiusM / (111320 * Math.cos(zone.lat * Math.PI / 180))) * Math.sin(rad);
                      return (
                        <Marker
                          key={`block-${zone.id}-${angle}`}
                          position={[zone.lat + dLat, zone.lon + dLon]}
                          icon={L.divIcon({
                            className: '',
                            html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%) scale(${zoomScale});">
                              <div style="font-size:12px;filter:drop-shadow(0 0 4px rgba(255,171,0,0.6));">🚧</div>
                              <div style="font-family:monospace;font-size:5px;color:#ffab00;text-shadow:0 0 3px rgba(0,0,0,0.9);white-space:nowrap;font-weight:bold;">מחסום</div>
                            </div>`,
                            iconSize: [20, 20],
                            iconAnchor: [10, 10],
                          })}
                        />
                      );
                    })}
                    
                    {/* IDF/Police force positions — around the inner perimeter */}
                    {[45, 135, 225, 315].map((angle, i) => {
                      const rad = (angle * Math.PI) / 180;
                      const r = zone.radiusM * 0.55;
                      const dLat = (r / 111320) * Math.cos(rad);
                      const dLon = (r / (111320 * Math.cos(zone.lat * Math.PI / 180))) * Math.sin(rad);
                      const forceTypes = [
                        { icon: '🪖', label: 'צה"ל — יחידת סריקה' },
                        { icon: '🚔', label: 'משטרה — יס"מ' },
                        { icon: '🪖', label: 'צה"ל — מגלן' },
                        { icon: '🚁', label: 'חיל האוויר — ישעור' },
                      ];
                      const force = forceTypes[i];
                      return (
                        <Marker
                          key={`force-${zone.id}-${angle}`}
                          position={[zone.lat + dLat, zone.lon + dLon]}
                          icon={L.divIcon({
                            className: '',
                            html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%) scale(${zoomScale});">
                              <div style="font-size:13px;filter:drop-shadow(0 0 1px rgba(0,230,118,0.2));${zone.status === 'active' ? 'animation:pulse 1.5s ease-in-out infinite;' : ''}">${force.icon}</div>
                              <div style="font-family:monospace;font-size:5px;color:rgba(0,230,118,0.6);text-shadow:0 0 1px rgba(0,0,0,0.95);white-space:nowrap;font-weight:bold;">${force.label}</div>
                            </div>`,
                            iconSize: [30, 25],
                            iconAnchor: [15, 12],
                          })}
                        />
                      );
                    })}
                    
                    {/* Flying drone/missile trail + marker — animated over the zone */}
                    {flyOffset && zone.status === 'active' && (() => {
                      // Generate trail points from past positions
                      const trailCount = 12;
                      const trailPoints: [number, number][] = [];
                      for (let ti = trailCount; ti >= 0; ti--) {
                        const pastTime = now - ti * 400;
                        const tLat = zone.lat + Math.sin(pastTime / 2000 + zone.lat * 100) * (zone.radiusM / 111320) * 0.6;
                        const tLon = zone.lon + Math.cos(pastTime / 3000 + zone.lon * 100) * (zone.radiusM / (111320 * Math.cos(zone.lat * Math.PI / 180))) * 0.6;
                        trailPoints.push([tLat, tLon]);
                      }
                      const trailColor = zone.threatType === 'drone' ? '#00e5ff' : '#ff1744';
                      return (
                        <>
                          {/* Fading trail segments */}
                          {trailPoints.slice(0, -1).map((pt, idx) => (
                            <Polyline
                              key={`trail-${zone.id}-${idx}`}
                              positions={[pt, trailPoints[idx + 1]]}
                              pathOptions={{
                                color: trailColor,
                                weight: Math.max(1, (idx / trailCount) * 3),
                                opacity: (idx / trailCount) * 0.7,
                                dashArray: zone.threatType === 'missile' ? '4 3' : undefined,
                              }}
                            />
                          ))}
                          {/* Glow dot at current position */}
                          <Circle
                            center={[zone.lat + flyOffset.dLat, zone.lon + flyOffset.dLon]}
                            radius={zone.threatType === 'drone' ? 80 : 50}
                            pathOptions={{
                              color: trailColor,
                              weight: 0,
                              fillColor: trailColor,
                              fillOpacity: 0.5,
                            }}
                          />
                          <Marker
                            position={[zone.lat + flyOffset.dLat, zone.lon + flyOffset.dLon]}
                            icon={L.divIcon({
                              className: '',
                              html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%) scale(${zoomScale}) rotate(${flyOffset.rotation}deg);">
                                <div style="font-size:28px;filter:drop-shadow(0 0 12px ${c.fill}) drop-shadow(0 0 20px ${c.fill}88);animation:pulse 0.8s ease-in-out infinite;">${threatIcon}</div>
                                <div style="font-family:monospace;font-size:6px;color:${c.fill};text-shadow:0 0 6px rgba(0,0,0,0.95);font-weight:bold;white-space:nowrap;margin-top:2px;">
                                  ${zone.threatType === 'drone' ? 'כלי טיס עוין' : 'טיל נכנס'}
                                </div>
                              </div>`,
                              iconSize: [50, 50],
                              iconAnchor: [25, 25],
                            })}
                          />
                        </>
                      );
                    })()}
                    
                    {/* Zone label marker */}
                    <Marker
                      position={[zone.lat, zone.lon]}
                      icon={L.divIcon({
                        className: '',
                        html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%) scale(${zoomScale * 0.15});min-width:80px;opacity:0.5;pointer-events:none;">
                          <div style="font-size:14px;filter:drop-shadow(0 0 4px ${c.fill}44);${zone.status === 'active' ? 'animation:pulse 1s ease-in-out infinite;' : ''}">${zone.threatType === 'terror' ? '⚠️' : threatIcon}</div>
                          <div style="background:${c.fill}33;padding:1px 4px;border-radius:3px;border:1px solid ${c.fill}22;backdrop-filter:blur(2px);margin-top:1px;">
                            <div style="font-family:'Share Tech Mono',monospace;font-size:6px;font-weight:900;color:#fff;text-align:center;text-shadow:0 1px 3px rgba(0,0,0,0.7);">${threatLabel}</div>
                            <div style="font-family:monospace;font-size:5px;color:rgba(255,255,255,0.6);text-align:center;">${zone.name}</div>
                          </div>
                        </div>`,
                        iconSize: [80, 40],
                        iconAnchor: [40, 20],
                      })}
                    />
                  </React.Fragment>
                );
              })}
            </>
          );
        })()}

        {/* ═══ Defense Layer: Naval + Air Defense + US/IDF ═══ */}
        {showForces && (
          <>
            {/* Naval Patrol Ships */}
            {PATROL_SHIPS.map(ship => {
              const pos = shipPositions[ship.id];
              if (!pos) return null;
              const isSubmarine = ship.id === 'submarine';
              const shipSymbol = isSubmarine ? '▼' : '▲';
              return (
                <Marker
                  key={ship.id}
                  position={[pos.lat, pos.lon]}
                  icon={L.divIcon({
                    className: '',
                    html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%);">
                      <div style="font-size:${isSubmarine ? '10px' : '12px'};color:${ship.color};transform:rotate(${90 - pos.bearing}deg);filter:drop-shadow(0 0 4px ${ship.color});text-shadow:0 0 6px ${ship.color};font-weight:bold;">${shipSymbol}</div>
                      <div style="font-family:monospace;font-size:6px;color:${ship.color};text-shadow:0 0 3px rgba(0,0,0,0.9);white-space:nowrap;margin-top:1px;opacity:0.7;">${ship.name.split(' - ')[0]}</div>
                    </div>`,
                    iconSize: [40, 28],
                    iconAnchor: [20, 14],
                  })}
                >
                  <Popup>
                    <div className="font-mono text-[10px]">
                      <div className="font-bold" style={{ color: ship.color }}>{ship.icon} {ship.name}</div>
                      <div className="text-foreground/50">פטרול • {pos.lat.toFixed(3)}°N {pos.lon.toFixed(3)}°E</div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}

            {/* Patrol route lines */}
            {PATROL_SHIPS.map(ship => (
              <Polyline
                key={`route-${ship.id}`}
                positions={ship.route}
                pathOptions={{ color: ship.color, weight: 1, opacity: 0.15, dashArray: '4 4' }}
              />
            ))}

            {/* Defense Systems — Iron Dome, David's Sling, Arrow, Iron Beam */}
            {DEFENSE_SYSTEMS.map(def => (
              <React.Fragment key={`def-${def.id}`}>
                <Marker
                  position={[def.lat, def.lon]}
                  icon={L.divIcon({
                    className: '',
                    html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%);">
                      <div style="font-size:6px;filter:drop-shadow(0 0 2px ${def.color});line-height:1;">${def.icon}</div>
                    </div>`,
                    iconSize: [8, 8],
                    iconAnchor: [4, 4],
                  })}
                >
                  <Popup>
                    <div className="font-mono text-[10px]">
                      <div className="font-bold" style={{ color: def.color }}>{def.icon} {def.name}</div>
                      <div className="text-foreground/50">טווח: {def.rangeKm} ק״מ</div>
                    </div>
                  </Popup>
                </Marker>
              </React.Fragment>
            ))}

            {/* US Forces — CENTCOM / NATO positions */}
            {[
              { id: 'uss_carrier', name: 'USS Gerald Ford', nameEn: 'CVN-78', lat: 33.80, lon: 33.50, icon: '🇺🇸', color: '#1976d2', type: 'נושאת מטוסים' },
              { id: 'uss_destroyer1', name: 'USS Carney', nameEn: 'DDG-64', lat: 33.20, lon: 33.80, icon: '🇺🇸', color: '#1565c0', type: 'משחתת' },
              { id: 'uss_destroyer2', name: 'USS Laboon', nameEn: 'DDG-58', lat: 31.50, lon: 33.20, icon: '🇺🇸', color: '#1565c0', type: 'משחתת' },
              { id: 'thaad', name: 'THAAD Battery', nameEn: 'THAAD', lat: 30.80, lon: 34.75, icon: '🇺🇸', color: '#2196f3', type: 'סוללת THAAD' },
              { id: 'patriot_us', name: 'Patriot Battery', nameEn: 'MIM-104', lat: 31.90, lon: 34.85, icon: '🇺🇸', color: '#42a5f5', type: 'סוללת פטריוט' },
              { id: 'idf_northern', name: 'אוגדה 91', nameEn: 'IDF 91st Div', lat: 33.05, lon: 35.30, icon: '🇮🇱', color: '#00e676', type: 'חטיבה צפון' },
              { id: 'idf_gaza', name: 'אוגדת עזה', nameEn: 'IDF Gaza Div', lat: 31.50, lon: 34.55, icon: '🇮🇱', color: '#00e676', type: 'חטיבה דרום' },
            ].map(force => (
              <Marker
                key={force.id}
                position={[force.lat, force.lon]}
                icon={L.divIcon({
                  className: '',
                  html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%);">
                    <div style="font-size:14px;filter:drop-shadow(0 0 6px ${force.color});">${force.icon}</div>
                    <div style="font-family:monospace;font-size:6px;color:${force.color};text-shadow:0 0 4px rgba(0,0,0,0.95);white-space:nowrap;font-weight:bold;">${force.nameEn}</div>
                  </div>`,
                  iconSize: [40, 30],
                  iconAnchor: [20, 15],
                })}
              >
                <Popup>
                  <div className="font-mono text-[10px]">
                    <div className="font-bold" style={{ color: force.color }}>{force.icon} {force.name}</div>
                    <div className="text-foreground/50">{force.type} • {force.nameEn}</div>
                  </div>
                </Popup>
              </Marker>
            ))}

          </>
        )}

        {/* ═══ Aircraft Layer (ATC Tower Style) ═══ */}
        {showFlights && AIRCRAFT_ROUTES.map(ac => {
          const pos = aircraftPositions[ac.id];
          if (!pos) return null;
          const altColor = altitudeColor(ac.altitude);
          const altBarH = Math.max(4, Math.round(ac.altitude / 1500)); // altitude bar height in px
          const svgSize = ac.category === 'military' ? 22 : ac.category === 'helicopter' ? 20 : ac.category === 'uav' ? 18 : 20;

          const trailPositions: [number, number][] = [];
          const totalSegs = ac.route.length - 1;
          const currentSeg = Math.min(Math.floor(pos.progress * totalSegs), totalSegs - 1);
          for (let i = 0; i <= currentSeg; i++) {
            trailPositions.push(ac.route[i]);
          }
          trailPositions.push([pos.lat, pos.lon]);

           return (
            <React.Fragment key={`ac-${ac.id}`}>
              {showAircraftRoutes && (
                <>
                  <Polyline
                    positions={ac.route}
                    pathOptions={{ color: altColor, weight: 1, opacity: 0.1, dashArray: '4 8' }}
                  />
                  <Polyline
                    positions={trailPositions}
                    pathOptions={{ color: altColor, weight: 2, opacity: 0.45 }}
                  />
                </>
              )}
              <Marker
                position={[pos.lat, pos.lon]}
                icon={L.divIcon({
                  className: '',
                  html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%);cursor:pointer;">
                    <div style="transform:rotate(${90 - pos.bearing}deg);filter:drop-shadow(0 0 4px ${altColor});">${getAircraftSVG(ac.category, altColor, svgSize)}</div>
                    <div style="width:1px;height:${altBarH}px;background:linear-gradient(to bottom,${altColor},transparent);opacity:0.4;"></div>
                    <div style="font-family:'Share Tech Mono',monospace;font-size:7px;color:${altColor};text-shadow:0 0 4px rgba(0,0,0,0.95);white-space:nowrap;opacity:0.8;letter-spacing:0.5px;">${ac.callsign} FL${Math.round(ac.altitude / 100)}</div>
                  </div>`,
                  iconSize: [60, altBarH + svgSize + 16],
                  iconAnchor: [30, altBarH + svgSize + 16],
                })}
                eventHandlers={{
                  dblclick: () => {
                    const details = AIRCRAFT_DETAILS[ac.callsign];
                    setSelectedAircraftPopup({
                      callsign: ac.callsign,
                      type: ac.type,
                      category: ac.category,
                      altitude: ac.altitude,
                      color: altColor,
                      ...(details || { image: '✈️', mission: 'טיסה פעילה', branch: ac.category, branchIcon: '✈️' }),
                    });
                  },
                }}
              >
                <Popup>
                  <div className="font-mono text-[10px]" dir="ltr">
                    <div className="font-bold" style={{ color: altColor }}>{ac.callsign} · {ac.type}</div>
                    <div style={{color: altColor, opacity: 0.8}}>⬆ {ac.altitude.toLocaleString()} ft · FL{Math.round(ac.altitude / 100)}</div>
                    <div className="text-foreground/50">{pos.lat.toFixed(3)}°N {pos.lon.toFixed(3)}°E</div>
                    <div className="text-foreground/40 text-[8px]">דאבל-קליק למידע מפורט</div>
                  </div>
                </Popup>
              </Marker>
            </React.Fragment>
          );
        })}

        {/* ═══ OpenSky Live Aircraft ═══ */}
        {showFlights && liveAircraft.map(ac => {
          if (!ac.lat || !ac.lon) return null;
          const altFt = ac.altitude || 0;
          const aColor = altitudeColor(altFt);
          const heading = ac.heading || 0;
          return (
            <Marker
              key={`live-${ac.icao24}`}
              position={[ac.lat, ac.lon]}
              icon={L.divIcon({
                className: '',
                html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%);">
                  <div style="font-size:12px;color:${aColor};transform:rotate(${heading}deg);filter:drop-shadow(0 0 3px ${aColor});opacity:0.8;">✈</div>
                  <div style="font-family:monospace;font-size:6px;color:${aColor};text-shadow:0 0 3px rgba(0,0,0,0.95);white-space:nowrap;opacity:0.6;">${ac.callsign || ac.icao24}</div>
                </div>`,
                iconSize: [40, 28],
                iconAnchor: [20, 14],
              })}
            >
              <Popup>
                <div className="font-mono text-[10px]" dir="ltr">
                  <div className="font-bold" style={{ color: aColor }}>✈ {ac.callsign || '???'} · {ac.icao24}</div>
                  <div style={{color: aColor, opacity: 0.8}}>⬆ {altFt.toLocaleString()} ft · {ac.velocity || '?'} kts</div>
                  <div className="text-foreground/50">{ac.lat.toFixed(3)}°N {ac.lon.toFixed(3)}°E</div>
                  <div className="text-foreground/40">🌍 {ac.country} · LIVE</div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* ═══ Population Density Layer ═══
            • Zoom < 13 → simple city circles (overview)
            • Zoom ≥ 13 → high-res WorldPop 100m raster (street/neighborhood level)
        */}
        {showPopulationDensity && mapZoom < popDensityZoomThreshold && REGIONS.filter((r) => r.isCity && r.population).map((r) => {
          const pop = r.population || 0;
          const radiusM = Math.min(15000, 1500 + pop * 30);
          const color = pop > 200 ? '#ff1744' : pop > 80 ? '#ff6d00' : pop > 30 ? '#ffd600' : '#66bb6a';
          return (
            <Circle
              key={`pop-${r.id}`}
              center={[r.lat, r.lon]}
              radius={radiusM}
              pathOptions={{
                color,
                fillColor: color,
                fillOpacity: 0.18,
                weight: 1,
                opacity: 0.5,
              }}
            >
              <Popup>
                <div className="font-mono text-[10px]" dir="rtl">
                  <div className="font-bold" style={{ color }}>🏙️ {r.name}</div>
                  <div>אוכלוסייה: {pop.toLocaleString('he-IL')}K</div>
                  {r.alertCount && <div>התרעות 24ש': {r.alertCount}</div>}
                  {r.shelterSec !== undefined && <div>זמן למקלט: {r.shelterSec === 0 ? 'מיידי' : `${r.shelterSec}ש'`}</div>}
                  <div className="text-foreground/40 mt-1">דירוג סיכון: {r.severity}</div>
                </div>
              </Popup>
            </Circle>
          );
        })}
        {showPopulationDensity && mapZoom >= popDensityZoomThreshold && (
          <WorldPopTileLayer opacity={0.65} />
        )}


        {/* ═══ Flights Board — TLV/HFA/ETM live aircraft ═══ */}
        {showFlightsBoard && flightAirports.map((ap) => (
          <React.Fragment key={`apb-${ap.iata}`}>
            <Circle
              center={[ap.lat, ap.lon]}
              radius={8000}
              pathOptions={{ color: '#00b0ff', fillColor: '#00b0ff', fillOpacity: 0.05, weight: 1, opacity: 0.5, dashArray: '4 4' }}
            />
            <Marker
              position={[ap.lat, ap.lon]}
              icon={L.divIcon({
                className: '',
                html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%);">
                  <div style="font-size:16px;filter:drop-shadow(0 0 4px #00b0ff);">🛬</div>
                  <div style="font-family:monospace;font-size:9px;color:#00b0ff;text-shadow:0 0 3px rgba(0,0,0,0.95);font-weight:bold;">${ap.iata} · ${ap.flights.length}</div>
                </div>`,
                iconSize: [60, 32], iconAnchor: [30, 16],
              })}
            >
              <Popup>
                <div className="font-mono text-[10px] min-w-[200px]" dir="rtl">
                  <div className="font-bold text-sky-400 mb-1">🛫 {ap.nameHe} ({ap.iata})</div>
                  <div className="text-foreground/60 mb-1">{ap.flights.length} כלי טיס באזור</div>
                  {ap.flights.slice(0, 8).map((f) => (
                    <div key={f.icao24} className="text-[9px] flex justify-between gap-2 border-t border-foreground/10 py-0.5">
                      <span style={{ color: PHASE_COLOR[f.phase] }}>{PHASE_LABEL_HE[f.phase]}</span>
                      <span className="text-foreground/70">{f.callsign}</span>
                      <span className="text-foreground/40">{f.altFt.toLocaleString()}ft</span>
                    </div>
                  ))}
                </div>
              </Popup>
            </Marker>
            {ap.flights.map((f) => (
              <CircleMarker
                key={`fb-${f.icao24}`}
                center={[f.lat, f.lon]}
                radius={3}
                pathOptions={{ color: PHASE_COLOR[f.phase], fillColor: PHASE_COLOR[f.phase], fillOpacity: 0.8, weight: 1 }}
              >
                <Popup>
                  <div className="font-mono text-[10px]" dir="ltr">
                    <div className="font-bold" style={{ color: PHASE_COLOR[f.phase] }}>✈ {f.callsign}</div>
                    <div>{PHASE_LABEL_HE[f.phase]} · {f.altFt.toLocaleString()} ft · {f.ktVel} kt</div>
                    <div className="text-foreground/40">{f.distanceKm} km from {ap.iata}</div>
                  </div>
                </Popup>
              </CircleMarker>
            ))}
          </React.Fragment>
        ))}

        {/* ═══ Global Events — GDACS + USGS worldwide ═══ */}
        {showGlobalEvents && filteredGlobalEvents.map((ev) => {
          const color = GLOBAL_SEVERITY_COLOR[ev.severity];
          const icon = GLOBAL_CATEGORY_ICON[ev.category];
          return (
            <Marker
              key={`ge-${ev.id}`}
              position={[ev.lat, ev.lon]}
              icon={L.divIcon({
                className: '',
                html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%);">
                  <div style="font-size:14px;filter:drop-shadow(0 0 5px ${color});">${icon}</div>
                </div>`,
                iconSize: [22, 22], iconAnchor: [11, 11],
              })}
            >
              <Popup>
                <div className="font-mono text-[10px] max-w-[260px]" dir="ltr">
                  <div className="font-bold mb-0.5" style={{ color }}>
                    {icon} {ev.title}
                  </div>
                  {ev.country && <div className="text-foreground/60">🌍 {ev.country}</div>}
                  {ev.magnitude !== undefined && <div className="text-foreground/70">M{ev.magnitude.toFixed(1)}</div>}
                  {ev.description && <div className="text-foreground/60 text-[9px] mt-1">{ev.description}</div>}
                  <div className="text-foreground/40 text-[9px] mt-1">
                    {ev.source.toUpperCase()} · {ev.pubDate ? new Date(ev.pubDate).toLocaleString('he-IL') : ''}
                  </div>
                </div>
              </Popup>
            </Marker>
          );
        })}

        {/* ═══ UAV Watch Layer — drones around user (OpenSky + simulated) ═══ */}
        {showUav && (
          <>
            {/* Scan radius circle */}
            <Circle
              center={[uavCenter.lat, uavCenter.lon]}
              radius={uavRadiusKm * 1000}
              pathOptions={{
                color: '#ff6d00',
                fillColor: '#ff6d00',
                fillOpacity: 0.04,
                weight: 1,
                opacity: 0.5,
                dashArray: '6 6',
              }}
            />
            {uavTracks.map((t) => {
              const color = UAV_RISK_COLOR[t.risk];
              const isSim = t.source === 'simulated';
              return (
                <Marker
                  key={`uav-${t.id}`}
                  position={[t.lat, t.lon]}
                  icon={L.divIcon({
                    className: '',
                    html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%);">
                      <div style="font-size:14px;color:${color};transform:rotate(${t.heading || 0}deg);filter:drop-shadow(0 0 4px ${color});">${isSim ? '◆' : '▲'}</div>
                      <div style="font-family:monospace;font-size:7px;color:${color};text-shadow:0 0 3px rgba(0,0,0,0.95);white-space:nowrap;font-weight:bold;">${t.callsign}</div>
                    </div>`,
                    iconSize: [50, 30],
                    iconAnchor: [25, 15],
                  })}
                >
                  <Popup>
                    <div className="font-mono text-[10px] min-w-[180px]" dir="ltr">
                      <div className="font-bold mb-1" style={{ color }}>
                        {t.risk === 'critical' ? '🔴' : t.risk === 'high' ? '🟠' : t.risk === 'medium' ? '🟡' : '🔵'} {t.callsign}
                      </div>
                      <div style={{ color, opacity: 0.9 }}>{t.manufacturer} · {isSim ? 'SIM' : 'LIVE'}</div>
                      <div className="text-foreground/70 text-[9px]">{t.protocol}</div>
                      <div className="text-foreground/60 mt-1">
                        ⬆ {t.altitudeFt?.toLocaleString() ?? '?'} ft · {t.velocityKt ?? '?'} kts
                      </div>
                      <div className="text-foreground/40 text-[9px]">
                        {t.lat.toFixed(3)}°N {t.lon.toFixed(3)}°E
                      </div>
                      <div className="text-foreground/40 text-[9px]">
                        Remote ID: {t.hasRemoteId ? '✓' : '✗'}
                      </div>
                    </div>
                  </Popup>
                </Marker>
              );
            })}
          </>
        )}

        {/* ═══ Public Shelters Layer — only nearby shelters during alerts ═══ */}
        {showShelters && (() => {
          const allShelters = [
          { id: 'sh-tlv1', name: 'מקלט דיזנגוף', lat: 32.077, lon: 34.775, walkMin: 2 },
          { id: 'sh-tlv2', name: 'מקלט רוטשילד', lat: 32.063, lon: 34.774, walkMin: 3 },
          { id: 'sh-tlv3', name: 'מקלט אלנבי', lat: 32.068, lon: 34.770, walkMin: 2 },
          { id: 'sh-tlv4', name: 'מקלט בן יהודה', lat: 32.082, lon: 34.771, walkMin: 4 },
          { id: 'sh-tlv5', name: 'מקלט נחלת בנימין', lat: 32.060, lon: 34.773, walkMin: 3 },
          { id: 'sh-rg1', name: 'מקלט רמת גן מרכז', lat: 32.073, lon: 34.812, walkMin: 3 },
          { id: 'sh-pt1', name: 'מקלט פתח תקווה', lat: 32.092, lon: 34.883, walkMin: 5 },
          { id: 'sh-jer1', name: 'מקלט ממילא', lat: 31.778, lon: 35.220, walkMin: 4 },
          { id: 'sh-jer2', name: 'מקלט מחנה יהודה', lat: 31.785, lon: 35.212, walkMin: 3 },
          { id: 'sh-haifa1', name: 'מקלט הדר הכרמל', lat: 32.805, lon: 34.989, walkMin: 2 },
          { id: 'sh-haifa2', name: 'מקלט חוף הכרמל', lat: 32.790, lon: 34.962, walkMin: 4 },
          { id: 'sh-bs1', name: 'מקלט באר שבע מרכז', lat: 31.252, lon: 34.793, walkMin: 3 },
          { id: 'sh-bs2', name: 'מקלט רמות', lat: 31.265, lon: 34.812, walkMin: 5 },
          { id: 'sh-ash1', name: 'מקלט אשדוד סיטי', lat: 31.804, lon: 34.650, walkMin: 3 },
          { id: 'sh-ashk1', name: 'מקלט אשקלון', lat: 31.668, lon: 34.571, walkMin: 4 },
          { id: 'sh-net1', name: 'מקלט נתניה מרכז', lat: 32.330, lon: 34.857, walkMin: 3 },
          { id: 'sh-rish1', name: 'מקלט ראשון לציון', lat: 31.971, lon: 34.792, walkMin: 4 },
          { id: 'sh-mod1', name: 'מקלט מודיעין', lat: 31.899, lon: 34.958, walkMin: 5 },
          { id: 'sh-ks1', name: 'מקלט קריית שמונה', lat: 33.207, lon: 35.573, walkMin: 1 },
          { id: 'sh-nahariya1', name: 'מקלט נהריה', lat: 33.005, lon: 35.098, walkMin: 2 },
          { id: 'sh-safed1', name: 'מקלט צפת', lat: 32.965, lon: 35.497, walkMin: 3 },
          { id: 'sh-sderot1', name: 'מקלט שדרות', lat: 31.525, lon: 34.596, walkMin: 1 },
          ];
          
          // Filter: if user GPS available, show only shelters within ~3km radius
          const RADIUS_KM = 3;
          const haversineKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
            const R = 6371;
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLon = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
          };
          
          const filtered = userGPS
            ? allShelters.filter(sh => haversineKm(userGPS.lat, userGPS.lon, sh.lat, sh.lon) <= RADIUS_KM)
                .sort((a, b) => haversineKm(userGPS.lat, userGPS.lon, a.lat, a.lon) - haversineKm(userGPS.lat, userGPS.lon, b.lat, b.lon))
            : allShelters;
          
          return filtered.map(sh => (
          <Marker
            key={sh.id}
            position={[sh.lat, sh.lon]}
            icon={L.divIcon({
              className: '',
              html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%);">
                <div style="width:18px;height:18px;border-radius:3px;background:rgba(76,175,80,0.15);border:1.5px solid #4caf50;display:flex;align-items:center;justify-content:center;font-size:10px;">🏠</div>
                <div style="font-family:monospace;font-size:6px;color:#81c784;text-shadow:0 0 3px rgba(0,0,0,0.95);white-space:nowrap;margin-top:1px;">${sh.walkMin}′🚶</div>
              </div>`,
              iconSize: [40, 30],
              iconAnchor: [20, 15],
            })}
          >
            <Popup>
              <div className="font-mono text-[11px]" dir="rtl">
                <div className="font-bold text-green-400">🛡️ {sh.name}</div>
                <div className="text-foreground/70">🚶 {sh.walkMin} דקות הליכה</div>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${sh.lat},${sh.lon}&travelmode=walking`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 underline text-[10px] mt-1 block"
                  onClick={e => e.stopPropagation()}
                >
                  🗺️ ניווט למקלט (Google Maps)
                </a>
              </div>
            </Popup>
          </Marker>
        ));
        })()}

        {showRescue && (
          <>
            {[
              // MDA Stations
              { id: 'mda-tlv', name: 'מד"א תל אביב', icon: '🚑', color: '#ff1744', lat: 32.06, lon: 34.79, type: 'תחנת מד"א' },
              { id: 'mda-jer', name: 'מד"א ירושלים', icon: '🚑', color: '#ff1744', lat: 31.78, lon: 35.20, type: 'תחנת מד"א' },
              { id: 'mda-haifa', name: 'מד"א חיפה', icon: '🚑', color: '#ff1744', lat: 32.80, lon: 35.00, type: 'תחנת מד"א' },
              { id: 'mda-bs', name: 'מד"א באר שבע', icon: '🚑', color: '#ff1744', lat: 31.26, lon: 34.80, type: 'תחנת מד"א' },
              { id: 'mda-pt', name: 'מד"א פתח תקווה', icon: '🚑', color: '#ff1744', lat: 32.10, lon: 34.89, type: 'תחנת מד"א' },
              { id: 'mda-rg', name: 'מד"א רמת גן', icon: '🚑', color: '#ff1744', lat: 32.08, lon: 34.82, type: 'תחנת מד"א' },
              { id: 'mda-ash', name: 'מד"א אשדוד', icon: '🚑', color: '#ff1744', lat: 31.81, lon: 34.66, type: 'תחנת מד"א' },
              { id: 'mda-net', name: 'מד"א נתניה', icon: '🚑', color: '#ff1744', lat: 32.34, lon: 34.87, type: 'תחנת מד"א' },
              // Fire Stations
              { id: 'fire-tlv', name: 'כיבוי תל אביב', icon: '🚒', color: '#ff6d00', lat: 32.09, lon: 34.78, type: 'תחנת כיבוי' },
              { id: 'fire-jer', name: 'כיבוי ירושלים', icon: '🚒', color: '#ff6d00', lat: 31.76, lon: 35.22, type: 'תחנת כיבוי' },
              { id: 'fire-haifa', name: 'כיבוי חיפה', icon: '🚒', color: '#ff6d00', lat: 32.78, lon: 34.98, type: 'תחנת כיבוי' },
              { id: 'fire-rh', name: 'כיבוי ראשון לציון', icon: '🚒', color: '#ff6d00', lat: 31.98, lon: 34.81, type: 'תחנת כיבוי' },
              { id: 'fire-bs', name: 'כיבוי באר שבע', icon: '🚒', color: '#ff6d00', lat: 31.24, lon: 34.78, type: 'תחנת כיבוי' },
              // Police Stations
              { id: 'pol-tlv', name: 'משטרה תל אביב', icon: '🚔', color: '#2196f3', lat: 32.07, lon: 34.80, type: 'תחנת משטרה' },
              { id: 'pol-jer', name: 'משטרה ירושלים', icon: '🚔', color: '#2196f3', lat: 31.79, lon: 35.22, type: 'מפקדת ירושלים' },
              { id: 'pol-haifa', name: 'משטרה חיפה', icon: '🚔', color: '#2196f3', lat: 32.81, lon: 35.01, type: 'תחנת משטרה' },
              { id: 'pol-mod', name: 'משטרה מודיעין', icon: '🚔', color: '#2196f3', lat: 31.91, lon: 34.97, type: 'תחנת משטרה' },
              // Hospitals
              { id: 'hosp-ichilov', name: 'ביה"ח איכילוב', icon: '🏥', color: '#4caf50', lat: 32.08, lon: 34.79, type: 'בית חולים' },
              { id: 'hosp-sheba', name: 'ביה"ח שיבא', icon: '🏥', color: '#4caf50', lat: 32.05, lon: 34.84, type: 'בית חולים' },
              { id: 'hosp-rambam', name: 'ביה"ח רמב"ם', icon: '🏥', color: '#4caf50', lat: 32.79, lon: 34.99, type: 'בית חולים' },
              { id: 'hosp-hadassah', name: 'ביה"ח הדסה', icon: '🏥', color: '#4caf50', lat: 31.77, lon: 35.19, type: 'בית חולים' },
              { id: 'hosp-soroka', name: 'ביה"ח סורוקה', icon: '🏥', color: '#4caf50', lat: 31.26, lon: 34.80, type: 'בית חולים' },
              { id: 'hosp-meir', name: 'ביה"ח מאיר', icon: '🏥', color: '#4caf50', lat: 32.18, lon: 34.89, type: 'בית חולים' },
            ].map(station => (
              <Marker
                key={station.id}
                position={[station.lat, station.lon]}
                icon={L.divIcon({
                  className: '',
                  html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%);">
                    <div style="font-size:16px;filter:drop-shadow(0 0 6px ${station.color});">${station.icon}</div>
                    <div style="font-family:'Heebo',sans-serif;font-size:6px;color:${station.color};text-shadow:0 0 4px rgba(0,0,0,0.95);white-space:nowrap;font-weight:bold;background:rgba(0,0,0,0.6);padding:0 3px;border-radius:2px;">${station.name.split(' ').slice(0,2).join(' ')}</div>
                  </div>`,
                  iconSize: [40, 30],
                  iconAnchor: [20, 15],
                })}
              >
                <Popup>
                  <div className="font-mono text-[10px]">
                    <div className="font-bold" style={{ color: station.color }}>{station.icon} {station.name}</div>
                    <div className="text-foreground/50">{station.type} • פעיל</div>
                  </div>
                </Popup>
              </Marker>
            ))}
          </>
        )}

        {/* ═══ LEBANON OPERATION — IDF Strike Targets & Reconstruction Timeline ═══ */}
        {dataMode === 'demo' && demoScenario === 'lebanon_op' && (() => {
          const now = Date.now();
          return (
            <>
              {LEBANON_STRIKE_TARGETS.map((target, ti) => {
                const strikeAge = target.timeOffsetMin * 60 * 1000;
                const pulse = Math.abs(Math.sin(missileProgress * Math.PI * 3 + ti * 0.7));
                const isRecent = target.timeOffsetMin < 10;
                const ageMins = target.timeOffsetMin;
                const timeLabel = ageMins < 1 ? 'עכשיו' : `לפני ${ageMins}ד'`;

                // Strike trajectory from IAF base / artillery position in Israel
                const originLat = target.type === 'airstrike' ? 31.90 : target.type === 'naval' ? 33.05 : target.type === 'drone' ? 32.79 : 33.10;
                const originLon = target.type === 'airstrike' ? 34.88 : target.type === 'naval' ? 34.60 : target.type === 'drone' ? 34.99 : 35.50;

                // Animated strike line progress
                const strikeProgress = Math.min(1, ((missileProgress * 3 + ti * 0.1) % 1));

                // Arc points for airstrike trajectory
                const arcSteps = 30;
                const arcPoints: [number, number][] = [];
                for (let s = 0; s <= arcSteps; s++) {
                  const t = s / arcSteps;
                  const lat = originLat + (target.lat - originLat) * t;
                  const lon = originLon + (target.lon - originLon) * t;
                  const altBump = target.type === 'airstrike' ? 0.15 * 4 * t * (1 - t) : 0.05 * 4 * t * (1 - t);
                  arcPoints.push([lat + altBump, lon]);
                }

                const traveledArc = arcPoints.filter((_, i) => i / arcSteps <= strikeProgress);
                const explosionPhase = strikeProgress > 0.9 ? (strikeProgress - 0.9) / 0.1 : 0;

                return (
                  <React.Fragment key={`leb-strike-${target.id}`}>
                    {/* Strike trajectory line */}
                    {target.type !== 'naval' && (
                      <>
                        <Polyline
                          positions={arcPoints}
                          pathOptions={{ color: target.color, weight: 1, opacity: 0.15, dashArray: '3 6' }}
                        />
                        {traveledArc.length >= 2 && (
                          <Polyline
                            positions={traveledArc}
                            pathOptions={{ color: target.color, weight: 2.5, opacity: 0.7 }}
                          />
                        )}
                        {/* Moving projectile */}
                        {strikeProgress < 0.9 && (() => {
                          const idx = Math.round(strikeProgress * arcSteps);
                          const pt = arcPoints[idx];
                          if (!pt) return null;
                          return (
                            <Marker
                              position={pt}
                              icon={L.divIcon({
                                className: '',
                                html: `<div style="font-size:14px;filter:drop-shadow(0 0 8px ${target.color});transform:translate(-50%,-50%);animation:pulse 0.5s infinite;">${target.icon}</div>`,
                                iconSize: [0, 0],
                                iconAnchor: [0, 0],
                              })}
                              interactive={false}
                            />
                          );
                        })()}
                      </>
                    )}

                    {/* Impact / target zone */}
                    <Circle
                      center={[target.lat, target.lon]}
                      radius={target.type === 'airstrike' ? 2000 + pulse * 1500 : target.type === 'naval' ? 3000 : 1500 + pulse * 1000}
                      pathOptions={{
                        color: target.color,
                        fillColor: target.color,
                        fillOpacity: (isRecent ? 0.12 : 0.06) + pulse * 0.08,
                        weight: isRecent ? 2.5 : 1.5,
                        opacity: 0.5 + pulse * 0.4,
                        dashArray: target.type === 'airstrike' ? undefined : '6 4',
                      }}
                    >
                      <Popup closeButton={false}>
                        <div className="font-mono p-2" style={{ minWidth: '220px', background: 'rgba(0,0,0,0.9)', borderRadius: '4px', border: `1px solid ${target.color}44` }}>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-lg">{target.icon}</span>
                            <span className="text-sm font-bold" style={{ color: target.color }}>🇮🇱 {target.name}</span>
                          </div>
                          <div className="text-[10px] text-white/70 mb-1">{target.description}</div>
                          <div className="text-[9px] text-white/50">{target.nameEn} • {timeLabel}</div>
                          <div className="text-[8px] mt-1 px-2 py-0.5 rounded-sm inline-block font-bold" style={{ background: `${target.color}20`, color: target.color }}>
                            {target.type === 'airstrike' ? '✈️ תקיפה אווירית' : target.type === 'artillery' ? '💣 ארטילריה' : target.type === 'drone' ? '🛩️ כטב"מ' : '🚢 חסימה ימית'}
                          </div>
                        </div>
                      </Popup>
                    </Circle>

                    {/* Explosion effect at target */}
                    {explosionPhase > 0 && target.type !== 'naval' && (
                      <>
                        <Circle
                          center={[target.lat, target.lon]}
                          radius={800 + explosionPhase * 2000}
                          pathOptions={{
                            color: '#ffea00', fillColor: '#ff6d00',
                            fillOpacity: (1 - explosionPhase) * 0.4,
                            weight: 2, opacity: (1 - explosionPhase) * 0.8,
                          }}
                          interactive={false}
                        />
                        <Marker
                          position={[target.lat, target.lon]}
                          icon={L.divIcon({
                            className: '',
                            html: `<div style="font-size:${18 + explosionPhase * 10}px;transform:translate(-50%,-50%);opacity:${1 - explosionPhase};filter:drop-shadow(0 0 15px ${target.color});">💥</div>`,
                            iconSize: [0, 0],
                            iconAnchor: [0, 0],
                          })}
                          interactive={false}
                        />
                      </>
                    )}

                    {/* Target label — always visible */}
                    <Marker
                      position={[target.lat, target.lon]}
                      icon={L.divIcon({
                        className: '',
                        html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-100%) scale(${zoomScale});pointer-events:auto;">
                          <div style="font-size:22px;filter:drop-shadow(0 0 10px ${target.color});${isRecent ? 'animation:pulse 0.8s infinite;' : ''}">${target.type === 'airstrike' ? '💥' : target.type === 'artillery' ? '💣' : target.type === 'drone' ? '🎯' : '⚓'}</div>
                          <div style="font-family:'Heebo',sans-serif;margin-top:2px;background:linear-gradient(135deg, ${target.color}dd, ${target.color}99);padding:2px 8px;border-radius:4px;white-space:nowrap;text-align:center;border:1px solid rgba(255,255,255,0.2);box-shadow:0 2px 10px ${target.color}44;min-width:80px;">
                            <div style="font-size:7px;font-weight:900;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,0.5);letter-spacing:0.5px;">
                              🇮🇱 ${target.name}
                            </div>
                            <div style="font-family:'Share Tech Mono',monospace;font-size:8px;font-weight:700;color:#fff;line-height:1.2;margin-top:1px;">
                              ${target.type === 'airstrike' ? '✈️ IAF' : target.type === 'artillery' ? '💣 ARTY' : target.type === 'drone' ? '🛩️ UAV' : '🚢 NAVAL'} · ${timeLabel}
                            </div>
                          </div>
                        </div>`,
                        iconSize: [0, 0],
                        iconAnchor: [0, 0],
                      })}
                    />
                  </React.Fragment>
                );
              })}

              {/* ── Reconstruction Timeline Banner — top right of map ── */}
              <Marker
                position={[33.60, 35.80]}
                icon={L.divIcon({
                  className: '',
                  html: `<div style="font-family:'Share Tech Mono',monospace;background:linear-gradient(135deg, rgba(13,71,161,0.85), rgba(21,101,192,0.75));padding:8px 14px;border-radius:8px;border:1px solid rgba(79,195,247,0.4);box-shadow:0 4px 20px rgba(13,71,161,0.4);min-width:180px;transform:translate(-50%,-50%);">
                    <div style="font-size:10px;font-weight:900;color:#4fc3f7;letter-spacing:1px;margin-bottom:4px;text-shadow:0 0 8px rgba(79,195,247,0.4);">🇮🇱 מבצע לבנון — שחזור</div>
                    <div style="font-size:7px;color:rgba(255,255,255,0.6);margin-bottom:6px;">30 דקות אחרונות · לפי דיווחי תקשורת</div>
                    ${LEBANON_STRIKE_TARGETS.slice(0, 6).map(t => 
                      `<div style="font-size:7px;color:rgba(255,255,255,0.8);padding:1px 0;border-top:1px solid rgba(255,255,255,0.1);">
                        ${t.icon} <strong>${t.name}</strong> · ${t.timeOffsetMin < 1 ? 'עכשיו' : `${t.timeOffsetMin}ד'`} · ${t.type === 'airstrike' ? 'חה"א' : t.type === 'artillery' ? 'ארטילריה' : t.type === 'drone' ? 'כטב"מ' : 'חיל הים'}
                      </div>`
                    ).join('')}
                    <div style="font-size:6px;color:rgba(79,195,247,0.5);margin-top:4px;">OSINT RECONSTRUCTION · FUSION ENGINE v2</div>
                  </div>`,
                  iconSize: [0, 0],
                  iconAnchor: [0, 0],
                })}
              />

              {/* ── IAF Base markers ── */}
              {[
                { lat: 31.90, lon: 34.88, name: 'בסיס חצרים — IAF', icon: '✈️', color: '#4fc3f7' },
                { lat: 32.79, lon: 34.99, name: 'בסיס רמת דוד — IAF', icon: '✈️', color: '#4fc3f7' },
                { lat: 33.10, lon: 35.50, name: 'ארטילריה — גבול צפון', icon: '💣', color: '#ff6d00' },
              ].map(base => (
                <Marker
                  key={`iaf-${base.name}`}
                  position={[base.lat, base.lon]}
                  icon={L.divIcon({
                    className: '',
                    html: `<div style="display:flex;flex-direction:column;align-items:center;transform:translate(-50%,-50%);">
                      <div style="font-size:14px;filter:drop-shadow(0 0 6px ${base.color});">${base.icon}</div>
                      <div style="font-family:monospace;font-size:6px;color:${base.color};text-shadow:0 0 4px rgba(0,0,0,0.95);white-space:nowrap;font-weight:bold;">${base.name}</div>
                    </div>`,
                    iconSize: [40, 30],
                    iconAnchor: [20, 15],
                  })}
                >
                  <Popup>
                    <div className="font-mono text-[10px]">
                      <div className="font-bold" style={{ color: base.color }}>🇮🇱 {base.name}</div>
                      <div className="text-foreground/50">בסיס שיגור פעיל</div>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </>
          );
        })()}
      </MapContainer>

      <CellComparisonPanel
        visible={showCellCompare}
        onClose={() => setShowCellCompare(false)}
        populationByCity={REGIONS.filter(r => r.isCity && r.population).map(r => ({ city: r.name, population: r.population! }))}
      />

      {showInfraStatus && (
        <InfraStatusPanel
          cloud={cloudStatus}
          transit={transitStatus}
          cloudLoading={cloudLoading}
          transitLoading={transitLoading}
          onClose={() => setShowInfraStatus(false)}
        />
      )}

      {showWeatherPanel && (
        <WeatherEmergency onClose={() => setShowWeatherPanel(false)} />
      )}

      {showEmergencyMonitor && (
        <EmergencyMonitor onClose={() => setShowEmergencyMonitor(false)} />
      )}

      <TransitPanel enabled={showTransitPanel} onClose={() => setShowTransitPanel(false)} />

      
      {/* Emergency takeover moved to left alert panel */}

      {/* ════════ UI OVERLAYS ════════ */}

      {/* ── Top Header — Tactical Command Bar ── */}
      <nav className="fixed left-0 right-0 z-[1000] tactical-nav tactical-nav-sweep" role="toolbar" aria-label="בקרות מפה טקטית" style={{ containerType: 'inline-size', top: 'env(safe-area-inset-top, 0px)' }}>
        <div className="absolute inset-0 pointer-events-none backdrop-blur-2xl" style={{ background: 'linear-gradient(180deg, rgba(0,12,22,0.96), rgba(0,12,22,0.85), rgba(0,10,18,0.6))' }} />
        <div className="absolute inset-x-0 top-0 h-[2px] pointer-events-none" style={{ background: 'linear-gradient(90deg, transparent 5%, hsla(185,100%,50%,0.3) 20%, hsla(185,100%,50%,0.5) 50%, hsla(185,100%,50%,0.3) 80%, transparent 95%)' }} />
        <div className="absolute inset-x-0 bottom-0 h-px pointer-events-none" style={{ background: 'linear-gradient(90deg, transparent, hsla(185,100%,50%,0.25), transparent)' }} />

        {/* Main controls row */}
        <div className="relative z-10 flex items-center justify-between gap-1.5 px-2 py-1.5 sm:gap-2 sm:px-3 sm:py-2 md:px-4">
          {/* Left: LIVE first, then core nav */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button onClick={() => setDataMode(m => m === 'live' ? 'demo' : 'live')}
              className={`font-mono text-[9px] sm:text-[10px] px-3 sm:px-4 h-9 sm:h-10 rounded-xl border font-bold tracking-wide transition-all duration-200 active:scale-95 ${dataMode === 'live' ? 'bg-war-red/20 border-war-red/40 text-war-red shadow-[0_0_12px_rgba(255,23,68,0.15)]' : 'bg-primary/20 border-primary/30 text-primary'}`}>
              {dataMode === 'live' ? '🔴 LIVE' : 'DEMO'}
            </button>
            <button onClick={() => { if (theaterView) { resetZoomToIsrael(); } else { showFullTheater(); } }}
              className={`min-w-[36px] h-9 sm:min-w-[40px] sm:h-10 rounded-xl flex items-center justify-center border transition-all duration-200 active:scale-90 ${theaterView ? 'bg-primary/20 border-primary/40 shadow-[0_0_8px_rgba(59,130,246,0.25)]' : 'bg-white/[0.04] border-white/[0.06] hover:bg-white/[0.08]'}`}
              title={theaterView ? 'זום לישראל' : 'תצוגת זירה'}>
              <span className="text-base">{theaterView ? '🇮🇱' : '🌍'}</span>
            </button>
            <button onClick={cycleZonePatrol}
              className="min-w-[36px] h-9 sm:min-w-[40px] sm:h-10 rounded-xl flex items-center justify-center bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.08] transition-all duration-200 active:scale-90"
              title="סיור זירות">
              <span className="text-base">{zonePatrolIdx < 0 ? '📍' : ZONE_PATROL[zonePatrolIdx].emoji}</span>
            </button>
          </div>

          {/* Center: Active layer icons — tap to deactivate */}
          <div className="flex-1 min-w-0 overflow-x-auto hide-scrollbar mx-1">
            <div className="flex items-center gap-1 justify-center">
              {(() => {
                const activeLayers = [
                  showPolygons && { toggle: () => setShowPolygons(v => !v), icon: '🔷', tip: 'פוליגונים' },
                  showHeatmap && { toggle: () => setShowHeatmap(v => !v), icon: '🌡️', tip: 'מפת חום' },
                  showTrajectories && { toggle: () => setShowTrajectories(v => !v), icon: '🚀', tip: 'טילים' },
                  showForces && { toggle: () => setShowForces(v => !v), icon: '🛡️', tip: 'הגנה אווירית' },
                  showRescue && { toggle: () => setShowRescue(v => !v), icon: '🏥', tip: 'הצלה וחירום' },
                  showTraffic && { toggle: () => setShowTraffic(v => !v), icon: '🚦', tip: 'תנועה' },
                  showFlights && { toggle: () => setShowFlights(v => !v), icon: '✈️', tip: 'מטוסים' },
                  showAircraftRoutes && { toggle: () => setShowAircraftRoutes(v => !v), icon: '〰️', tip: 'מסלולי טיסה' },
                  
                  showTelegramLayer && { toggle: () => setShowTelegramLayer(v => !v), icon: '📨', tip: 'טלגרם' },
                  showSatellite && { toggle: () => setShowSatellite(v => !v), icon: '🛰️', tip: 'לוויינים' },
                  showGlobe && { toggle: () => setShowGlobe(v => !v), icon: '🌍', tip: 'גלובוס' },
                  showVehicles && { toggle: () => setShowVehicles(v => !v), icon: '🚨', tip: 'רכבי חירום' },
                  
                ].filter(Boolean) as { toggle: () => void; icon: string; tip: string }[];
                if (activeLayers.length === 0) return <span className="font-mono text-[9px] text-white/20">אין שכבות פעילות</span>;
                return activeLayers.map(({ toggle, icon, tip }) => (
                  <button key={tip} onClick={toggle} title={`${tip} — לחץ לכיבוי`}
                    className="min-w-[32px] h-8 sm:min-w-[36px] sm:h-9 rounded-lg flex items-center justify-center bg-primary/15 ring-1 ring-primary/30 text-sm transition-all active:scale-90 hover:bg-primary/25 shrink-0">
                    {icon}
                  </button>
                ));
              })()}
            </div>
          </div>

          {/* ── CLOCK — between active layers and Iran banner ── */}
          <div className="flex items-center gap-1.5 px-3 sm:px-4 h-10 sm:h-11 rounded-xl border cursor-pointer select-none transition-all active:scale-95 shrink-0"
            style={{ borderColor: `${CLOCK_COLORS[clockColorIdx]}33`, background: `${CLOCK_COLORS[clockColorIdx]}0a` }}
            onClick={() => setClockColorIdx(i => (i + 1) % 3)} title={`מצב: ${CLOCK_LABELS[clockColorIdx]}`}>
            <span className="font-mono text-sm sm:text-[15px] font-black tabular-nums" style={{ color: CLOCK_COLORS[clockColorIdx], textShadow: `0 0 12px ${CLOCK_COLORS[clockColorIdx]}66` }}>
              {new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          </div>

          {/* ── Anomaly Alert Indicator in toolbar ── */}
          {(() => {
            // Compute anomaly summary from satellite data
            const iranHotspots = satelliteHotspots.filter((h: any) => (h.region || '').includes('איראן'));
            const iranExtremes = iranHotspots.filter((h: any) => h.intensity === 'extreme' || h.intensity === 'high');
            const iranQuakes = satelliteEarthquakes.filter((q: any) => (q.region || '').includes('איראן'));
            const suspiciousQ = iranQuakes.filter((q: any) => q.possible_explosion);
            const totalIranActivity = iranHotspots.length;
            const latestIranHotspot = iranHotspots.reduce((latest: number | null, h: any) => {
              const ts = parseHotspotTimestamp(h.acq_date, h.acq_time);
              return ts !== null && (latest === null || ts > latest) ? ts : latest;
            }, null as number | null);
            const latestIranQuake = suspiciousQ.reduce((latest: number | null, q: any) => {
              const ts = q.time ? new Date(q.time).getTime() : null;
              return ts !== null && Number.isFinite(ts) && (latest === null || ts > latest) ? ts : latest;
            }, null as number | null);
            const latestEvidenceTs = [latestIranHotspot, latestIranQuake]
              .filter((ts): ts is number => typeof ts === 'number' && Number.isFinite(ts))
              .reduce((latest, ts) => Math.max(latest, ts), 0) || null;
            const detectionMins = lastSatelliteCheckAt ? Math.max(0, Math.floor((Date.now() - lastSatelliteCheckAt) / 60000)) : 0;
            const detectionLabel = formatElapsedMinutes(detectionMins);
            
            const threatLevel = suspiciousQ.length > 0 ? 'critical' : iranExtremes.length > 3 ? 'high' : totalIranActivity > 5 ? 'elevated' : totalIranActivity > 0 ? 'monitoring' : null;
            if (!threatLevel) { iranBannerKeyRef.current = null; return null; }

            // Auto-dismiss: banner shows for 3 minutes then hides. Resets only on genuinely newer evidence.
            const bannerKey = `${threatLevel}-${latestEvidenceTs ?? 0}`;
            if (bannerKey !== iranBannerKeyRef.current) {
              iranBannerKeyRef.current = bannerKey;
              setIranBannerDismissed(false);
              if (iranBannerTimerRef.current) clearTimeout(iranBannerTimerRef.current);
              iranBannerTimerRef.current = setTimeout(() => setIranBannerDismissed(true), 180000); // 3 min
            }

            if (iranBannerDismissed) return null;
            
             const threatConfig = {
              critical: { color: '#ff1744', bg: 'rgba(255,23,68,0.2)', border: '#ff174466', icon: '🚨', label: 'זיהוי הכנה לשיגור באיראן' },
              high: { color: '#ff6d00', bg: 'rgba(255,109,0,0.15)', border: '#ff6d0044', icon: '⚠️', label: 'פעילות חריגה באיראן' },
              elevated: { color: '#ffd600', bg: 'rgba(255,214,0,0.1)', border: '#ffd60033', icon: '🔶', label: 'מעקב מוגבר באיראן' },
              monitoring: { color: '#78909c', bg: 'rgba(120,144,156,0.08)', border: '#78909c22', icon: '🟡', label: 'ניטור איראן' },
            };
            const cfg = threatConfig[threatLevel];
            
            return (
              <div className="flex items-center shrink-0" style={{ animation: threatLevel === 'critical' ? 'pulse 1.2s ease-in-out infinite' : undefined }}>
                <button
                  onClick={() => {
                    if (showIranThreatRadius) {
                      setShowIranThreatRadius(false);
                    } else {
                      setShowSatellite(true);
                      setShowIranThreatRadius(true);
                      setTheaterView(true);
                      setFlyBounds(null);
                      setFlyTo(null);
                      setTimeout(() => setFlyTo({ center: [32.65, 51.68], zoom: 5 }), 50);
                    }
                  }}
                  className="flex items-center gap-1.5 px-2.5 h-9 sm:h-10 rounded-xl border transition-all active:scale-95"
                  style={{ background: cfg.bg, borderColor: cfg.border }}
                  title="לחץ לזום לאיראן"
                >
                  <span className="text-sm">{cfg.icon}</span>
                  <div className="flex flex-col items-start leading-none">
                    <span className="font-mono text-[8px] sm:text-[9px] font-bold" style={{ color: cfg.color }}>{cfg.label}</span>
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-[7px] sm:text-[8px]" style={{ color: cfg.color + 'bb' }}>🔥{totalIranActivity}{iranExtremes.length > 0 ? ` ⚡${iranExtremes.length}` : ''}{suspiciousQ.length > 0 ? ` 💥${suspiciousQ.length}` : ''}</span>
                      <span className="font-mono text-[7px] sm:text-[8px] font-bold" style={{ color: '#ffd600' }}>🕒{detectionLabel}</span>
                    </div>
                  </div>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setIranBannerDismissed(true); if (iranBannerTimerRef.current) clearTimeout(iranBannerTimerRef.current); }}
                  className="mr-0.5 w-5 h-5 rounded-full flex items-center justify-center text-[10px] opacity-50 hover:opacity-100 transition-opacity"
                  style={{ color: cfg.color }}
                  title="סגור התראה"
                >✕</button>
              </div>
            );
          })()}

          {/* ── Readiness Gauge in toolbar ── */}
          {(() => {
            // ── Readiness based on IDF Home Front Command (פיקוד העורף) & IDF Spokesperson levels ──
            // Scale: שגרה (routine) → שגרה מוגברת → מצב מיוחד → כוננות → חירום מוגבל → חירום מלא
            let rdns = 10; // baseline — שגרה
            const activeOC = orefAlerts.filter(a => {
              const t = a.title || '';
              return !t.includes('שחרור') && !t.includes('הותר') && (Date.now() - new Date(a.alert_date).getTime()) < 600000;
            }).length;
            // Each active alert raises readiness significantly
            rdns += Math.min(activeOC * 10, 35);
            // Multi-front or war scenario — IDF declares special situation
            if (isDemoWarActive || isEmergencyActive) rdns += 30;
            if (demoLaunchActive) rdns += 20;
            // Intelligence indicators — satellite anomalies
            const iranHR = satelliteHotspots.filter((h: any) => (h.region || '').includes('איראן'));
            if (iranHR.length > 10) rdns += 15;
            else if (iranHR.length > 5) rdns += 8;
            const suspER = satelliteEarthquakes.filter((q: any) => q.possible_explosion);
            if (suspER.length > 0) rdns += 12;
            // Fronts with escalating activity
            const activeFronts = new Set<string>();
            orefAlerts.forEach(a => {
              const locs = (a.locations || []).join(' ');
              if (/קריית שמונה|מטולה|נהריה|צפת|עכו/.test(locs)) activeFronts.add('north');
              if (/שדרות|אשקלון|נתיבות|עוטף/.test(locs)) activeFronts.add('south');
              if (/תל אביב|רמת גן|פתח תקווה|הרצליה/.test(locs)) activeFronts.add('center');
            });
            if (activeFronts.size >= 2) rdns += 10; // multi-front escalation
            rdns = Math.min(100, Math.max(1, rdns));
            
            // IDF Home Front Command readiness levels
            const rC = rdns >= 85 ? '#ff1744' : rdns >= 65 ? '#ff3d00' : rdns >= 45 ? '#ff6d00' : rdns >= 30 ? '#ffd600' : '#4caf50';
            const rL = rdns >= 85 ? 'חירום מלא' : rdns >= 70 ? 'חירום מוגבל' : rdns >= 50 ? 'כוננות' : rdns >= 35 ? 'מצב מיוחד' : rdns >= 20 ? 'שגרה מוגברת' : 'שגרה';
            const aP = rdns / 100;
            return (
              <button
                onClick={() => { setRightOpen(true); setRightTab('report'); }}
                className="flex items-center gap-1 px-1.5 h-9 sm:h-10 rounded-xl border transition-all active:scale-95 shrink-0"
                style={{ borderColor: `${rC}33`, background: `${rC}0a`, animation: rdns >= 60 ? 'pulse 2s ease-in-out infinite' : undefined }}
                title="רמת כוננות — לחץ לדוח מודיעין"
              >
                <svg viewBox="0 0 36 24" width="36" height="24">
                  <path d="M 4 20 A 14 14 0 0 1 32 20" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" strokeLinecap="round" />
                  <path d="M 4 20 A 14 14 0 0 1 32 20" fill="none" stroke={rC} strokeWidth="3" strokeLinecap="round"
                    strokeDasharray={`${aP * 44} ${44}`} style={{ filter: `drop-shadow(0 0 3px ${rC}66)` }} />
                  <text x="18" y="17" textAnchor="middle" fill={rC} fontSize="9" fontWeight="900" fontFamily="'Share Tech Mono', monospace">{rdns}</text>
                </svg>
                <div className="flex flex-col items-start leading-none">
                  <span className="font-mono text-[7px] sm:text-[8px] font-bold" style={{ color: rC }}>{rL}</span>
                  <span className="font-mono text-[6px] sm:text-[7px]" style={{ color: 'rgba(255,255,255,0.4)' }}>כוננות</span>
                </div>
              </button>
            );
          })()}

          {/* AI + Fullscreen buttons */}
          <div className="flex items-center bg-secondary/30 rounded-xl p-0.5 gap-0.5 border border-border shrink-0">
            <button onClick={() => { setRightOpen(true); setRightTab('ai'); }}
              className={`min-w-[36px] h-8 sm:h-9 rounded-lg flex items-center justify-center transition-all text-sm active:scale-90 ${rightTab === 'ai' ? 'bg-primary/20 text-primary' : 'text-primary/50 hover:text-primary hover:bg-primary/10'}`} title="ניתוח AI">🧠</button>
            <button onClick={() => { setRightOpen(true); setRightTab('report'); }}
              className={`min-w-[36px] h-8 sm:h-9 rounded-lg flex items-center justify-center transition-all text-sm active:scale-90 ${rightTab === 'report' ? 'bg-primary/20 text-primary' : 'text-primary/50 hover:text-primary hover:bg-primary/10'}`} title="המודיעין של שולה">📋</button>
            <div className="w-px h-4 bg-border" />
            <button onClick={() => setShowInfraStatus(v => !v)}
              className={`min-w-[36px] h-8 sm:h-9 rounded-lg flex items-center justify-center transition-all text-sm active:scale-90 ${showInfraStatus ? 'bg-primary/20 text-primary' : 'text-primary/50 hover:text-primary hover:bg-primary/10'}`} title="פאנל תשתיות חי">🛰️</button>
            <button onClick={() => { setShowCellCompare(v => !v); if (!showCellCompare) { setShowCellTowers(true); setShowPopulationDensity(true); setShowTraffic(true); } }}
              className={`min-w-[36px] h-8 sm:h-9 rounded-lg flex items-center justify-center transition-all text-sm active:scale-90 ${showCellCompare ? 'bg-primary/20 text-primary' : 'text-primary/50 hover:text-primary hover:bg-primary/10'}`} title="השוואת heatmaps: צפיפות ↔ תנועה ↔ סלולר">📊</button>
            <button onClick={() => setShowPopulationDensity(v => !v)}
              className={`min-w-[36px] h-8 sm:h-9 rounded-lg flex items-center justify-center transition-all text-sm active:scale-90 ${showPopulationDensity ? 'bg-primary/20 text-primary' : 'text-primary/50 hover:text-primary hover:bg-primary/10'}`} title="צפיפות אוכלוסין">🗺️</button>
            <button onClick={() => setShowWeatherPanel(v => !v)}
              className={`min-w-[36px] h-8 sm:h-9 rounded-lg flex items-center justify-center transition-all text-sm active:scale-90 ${showWeatherPanel ? 'bg-primary/20 text-primary' : 'text-primary/50 hover:text-primary hover:bg-primary/10'}`} title="מזג אוויר וחירום">🌡️</button>
            <button onClick={() => setShowEmergencyMonitor(v => !v)}
              className={`min-w-[36px] h-8 sm:h-9 rounded-lg flex items-center justify-center transition-all text-sm active:scale-90 ${showEmergencyMonitor ? 'bg-primary/20 text-primary' : 'text-primary/50 hover:text-primary hover:bg-primary/10'}`} title="ניטור גופי חירום">🚨</button>
            <div className="w-px h-4 bg-border" />
            <button onClick={toggleFullscreen}
              className="min-w-[36px] h-8 sm:h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all text-sm active:scale-90" title={isFullscreen ? 'צא ממסך מלא' : 'מסך מלא'}>
              {isFullscreen ? '⊡' : '⊞'}
            </button>
          </div>

          {/* ── Settings — leftmost in toolbar (last in RTL DOM) ── */}
          {(() => {
            const allLayers = [
              { active: showPolygons, toggle: () => setShowPolygons(v => !v), icon: '🔷', tip: 'פוליגונים', group: 'map' },
              { active: showHeatmap, toggle: () => setShowHeatmap(v => !v), icon: '🌡️', tip: 'מפת חום', group: 'map' },
              { active: showTrajectories, toggle: () => setShowTrajectories(v => !v), icon: '🚀', tip: 'טילים', group: 'defense' },
              { active: showForces, toggle: () => setShowForces(v => !v), icon: '🛡️', tip: 'הגנה אווירית', group: 'defense' },
              { active: showRescue, toggle: () => setShowRescue(v => !v), icon: '🏥', tip: 'הצלה וחירום', group: 'rescue' },
              { active: showTraffic, toggle: () => setShowTraffic(v => !v), icon: '🚦', tip: 'תנועה', group: 'map' },
              { active: showFlights, toggle: () => setShowFlights(v => !v), icon: '✈️', tip: 'מטוסים', group: 'air' },
              { active: showAircraftRoutes, toggle: () => setShowAircraftRoutes(v => !v), icon: '〰️', tip: 'מסלולי טיסה', group: 'air' },
              
              { active: showTelegramLayer, toggle: () => setShowTelegramLayer(v => !v), icon: '📨', tip: 'מודיעין טלגרם', group: 'intel' },
              { active: showSatellite, toggle: () => setShowSatellite(v => !v), icon: '🛰️', tip: 'לוויינים', group: 'intel' },
              { active: showGlobe, toggle: () => setShowGlobe(v => !v), icon: '🌍', tip: 'גלובוס 3D', group: 'map' },
              { active: showVehicles, toggle: () => setShowVehicles(v => !v), icon: '🚨', tip: 'רכבי חירום', group: 'rescue' },
              { active: showMaritime, toggle: () => setShowMaritime(v => !v), icon: '🚢', tip: 'תנועת אוניות', group: 'defense' },
              { active: showShelters, toggle: () => setShowShelters(v => !v), icon: '🏠', tip: 'מקלטים', group: 'rescue' },
              { active: showInfiltration, toggle: () => setShowInfiltration(v => !v), icon: '⚠️', tip: 'חדירת מחבלים', group: 'defense' },
              { active: showIranThreatRadius, toggle: () => setShowIranThreatRadius(v => !v), icon: '🎯', tip: 'רדיוס איום איראן', group: 'defense' },
              { active: showUav, toggle: () => setShowUav(v => !v), icon: '🛸', tip: `UAV Watch (${uavRadiusKm}ק"מ)`, group: 'air' },
              { active: showFlightsBoard, toggle: () => setShowFlightsBoard(v => !v), icon: '🛬', tip: 'לוח טיסות TLV/HFA/ETM', group: 'air' },
              { active: showPopulationDensity, toggle: () => setShowPopulationDensity(v => !v), icon: '🗺️', tip: 'צפיפות אוכלוסין', group: 'map' },
              { active: showGlobalEvents, toggle: () => setShowGlobalEvents(v => !v), icon: '🌐', tip: 'אירועים עולמיים', group: 'intel' },
              { active: showDataCenters, toggle: () => setShowDataCenters(v => !v), icon: '🏢', tip: 'חוות שרתים גלובליות', group: 'intel' },
              { active: showGroundStations, toggle: () => setShowGroundStations(v => !v), icon: '📡', tip: 'תחנות קרקע + לווינים', group: 'intel' },
              { active: showSatLinks, toggle: () => setShowSatLinks(v => !v), icon: '🔗', tip: 'קווי חיבור קרקע↔לווין', group: 'intel' },
              { active: showSubCables, toggle: () => setShowSubCables(v => !v), icon: '🌊', tip: 'כבלים תת-ימיים', group: 'intel' },
              { active: showBackbone, toggle: () => setShowBackbone(v => !v), icon: '🔌', tip: 'Backbone יבשתי ישראל', group: 'intel' },
              { active: showDataFlow, toggle: () => setShowDataFlow(v => !v), icon: '✨', tip: 'זרימת דאטה (חי) — ירוק/כתום/אדום', group: 'intel' },
              { active: showCellTowers, toggle: () => setShowCellTowers(v => !v), icon: '📶', tip: 'אנטנות סלולר — כיסוי לפי מפעיל', group: 'map' },
              { active: showCellCompare, toggle: () => { setShowCellCompare(v => !v); if (!showCellCompare) { setShowCellTowers(true); setShowPopulationDensity(true); setShowTraffic(true); } }, icon: '📊', tip: 'השוואת heatmaps: צפיפות ↔ תנועה ↔ סלולר', group: 'intel' },
              { active: showTransitNodes, toggle: () => setShowTransitNodes(v => !v), icon: '🚆', tip: 'תחנות רכבת/אוטובוס/קניונים — סטטוס חי', group: 'map' },
              { active: showInfraStatus, toggle: () => setShowInfraStatus(v => !v), icon: '🛰️', tip: 'פאנל תשתיות חי — ענן + תחבורה', group: 'intel' },
              { active: showWeatherPanel, toggle: () => setShowWeatherPanel(v => !v), icon: '🌡️', tip: 'מזג אוויר וחירום — התראות, אזורים, סף פעולה', group: 'rescue' },
              { active: showEmergencyMonitor, toggle: () => setShowEmergencyMonitor(v => !v), icon: '🚨', tip: 'ניטור גופי חירום — פיד, ארגונים, טלגרם, אבחון', group: 'rescue' },
            ];
            const activeCount = allLayers.filter(l => l.active).length;
            const groups = [
              { key: 'map', label: '🗺️ מפה ותצוגה' },
              { key: 'defense', label: '🛡️ הגנה ואיום' },
              { key: 'air', label: '✈️ אוויר' },
              { key: 'rescue', label: '🏥 הצלה וחירום' },
              { key: 'intel', label: '📡 מודיעין' },
            ];
            return (
              <div className="relative shrink-0">
                <button onClick={() => setShowLayerMenu(v => !v)} title="הגדרות שכבות"
                  className={`min-w-[36px] h-9 sm:min-w-[40px] sm:h-10 px-2.5 rounded-xl border font-mono text-[9px] sm:text-[10px] font-bold transition-all active:scale-95 flex items-center gap-1 ${showLayerMenu ? 'bg-primary/20 border-primary/40 text-primary' : 'bg-white/[0.04] border-white/[0.06] text-white/60 hover:text-white/90 hover:bg-white/[0.08]'}`}>
                  <span className="text-sm">⚙️</span>
                  <span className="hidden md:inline">הגדרות</span>
                  {activeCount > 0 && <span className="bg-primary/30 text-primary text-[8px] min-w-[16px] h-4 flex items-center justify-center rounded-full font-black">{activeCount}</span>}
                </button>
                {showLayerMenu && <div className="fixed inset-0 z-[1099]" onClick={() => setShowLayerMenu(false)} />}
                {showLayerMenu && (
                  <div className="fixed sm:absolute top-auto sm:top-full bottom-0 sm:bottom-auto left-0 right-0 sm:left-auto sm:right-0 sm:mt-2 z-[1100] sm:w-[300px] sm:rounded-xl rounded-t-2xl border border-white/[0.1] p-3 flex flex-col gap-1.5 sm:max-h-[70vh] max-h-[60vh] overflow-y-auto"
                    style={{ background: 'rgba(0,12,22,0.97)', backdropFilter: 'blur(20px)', boxShadow: '0 -4px 32px rgba(0,0,0,0.6)' }}>
                    <div className="sm:hidden flex justify-center pb-1"><div className="w-10 h-1 rounded-full bg-white/20" /></div>
                    <div className="flex items-center justify-between px-1 pb-2 border-b border-white/[0.08]">
                      <span className="font-mono text-xs font-bold text-white/80">⚙️ הגדרות תצוגה</span>
                      <span className="font-mono text-[9px] text-white/30">{activeCount}/{allLayers.length} פעיל</span>
                    </div>
                    <div className="px-1 pt-1">
                      <div className="font-mono text-[9px] font-bold text-foreground/40 mb-1.5">מצב תצוגה</div>
                      <div className="grid grid-cols-3 gap-1.5 mb-2">
                        {([
                          { key: 'dark' as ThemeMode, icon: '🌙', tip: 'כהה' },
                          { key: 'light' as ThemeMode, icon: '☀️', tip: 'בהיר' },
                          { key: 'tactical' as ThemeMode, icon: '🎖️', tip: 'טקטי' },
                        ]).map(mode => (
                          <button key={mode.key} onClick={() => setTheme(mode.key)}
                            className={`flex flex-col items-center gap-0.5 py-2 rounded-xl text-center transition-all active:scale-95 ${theme === mode.key ? 'bg-primary/20 ring-1 ring-primary/40 text-foreground' : 'text-foreground/30 hover:text-foreground/60 hover:bg-secondary/50'}`}>
                            <span className="text-lg">{mode.icon}</span>
                            <span className="font-mono text-[8px] font-bold">{mode.tip}</span>
                          </button>
                        ))}
                      </div>
                      <div className="font-mono text-[9px] font-bold text-foreground/40 mb-1.5">ערכת צבעים מפה</div>
                      <div className="grid grid-cols-4 gap-1.5">
                        {([
                          { key: 'dark' as TileTheme, icon: '🌙', tip: 'לילה' },
                          { key: 'light' as TileTheme, icon: '☀️', tip: 'יום' },
                          { key: 'satellite' as TileTheme, icon: '🛰', tip: 'לוויין' },
                          { key: 'thermal' as TileTheme, icon: '🔥', tip: 'טרמי' },
                        ]).map(mode => (
                          <button key={mode.key} onClick={() => setTileTheme(mode.key)}
                            className={`flex flex-col items-center gap-0.5 py-2 rounded-xl text-center transition-all active:scale-95 ${tileTheme === mode.key ? 'bg-primary/20 ring-1 ring-primary/40 text-foreground' : 'text-foreground/30 hover:text-foreground/60 hover:bg-secondary/50'}`}>
                            <span className="text-lg">{mode.icon}</span>
                            <span className="font-mono text-[8px] font-bold">{mode.tip}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="h-px bg-white/[0.06] my-1" />
                    {groups.map(group => {
                      const gl = allLayers.filter(l => l.group === group.key);
                      if (!gl.length) return null;
                      return (
                        <div key={group.key} className="px-1">
                          <div className="font-mono text-[9px] font-bold text-white/40 mb-1">{group.label}</div>
                          <div className="flex flex-col gap-0.5">
                            {gl.map(({ active, toggle, icon, tip }) => (
                              <button key={tip} onClick={toggle}
                                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-right transition-all active:scale-[0.98] ${active ? 'bg-primary/15 text-white' : 'text-white/35 hover:text-white/70 hover:bg-white/[0.04]'}`}>
                                <span className={`text-lg ${active ? '' : 'grayscale opacity-40'}`}>{icon}</span>
                                <span className="font-mono text-[11px] font-bold flex-1">{tip}</span>
                                <div className={`w-9 h-5 rounded-full transition-all duration-200 flex items-center ${active ? 'bg-primary/50 justify-end' : 'bg-white/10 justify-start'}`}>
                                  <div className={`w-4 h-4 rounded-full mx-0.5 transition-all ${active ? 'bg-primary shadow-[0_0_6px_rgba(59,130,246,0.5)]' : 'bg-white/20'}`} />
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    <div className="h-px bg-white/[0.06] mt-1" />

                    {/* ── Population Density zoom threshold ── */}
                    {showPopulationDensity && (
                      <div className="px-1 pt-2">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-mono text-[9px] font-bold text-white/40">🗺️ סף זום לתצוגה מפורטת</span>
                          <span className="font-mono text-[8px] text-white/30">זום נוכחי: {mapZoom.toFixed(0)}</span>
                        </div>
                        <div className="grid grid-cols-4 gap-1">
                          {([11, 12, 13, 14] as const).map(z => {
                            const labels: Record<number, string> = { 11: 'עיר', 12: 'רובע', 13: 'שכונה', 14: 'רחוב' };
                            const sel = popDensityZoomThreshold === z;
                            return (
                              <button
                                key={z}
                                onClick={() => setPopDensityZoomThreshold(z)}
                                className={`flex flex-col items-center gap-0.5 py-1.5 rounded-lg transition-all active:scale-95 ${sel ? 'bg-primary/20 ring-1 ring-primary/40 text-foreground' : 'text-foreground/40 hover:text-foreground/70 hover:bg-secondary/50'}`}
                              >
                                <span className="font-mono text-[10px] font-black">Z{z}</span>
                                <span className="font-mono text-[8px]">{labels[z]}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* ── Global War Zones — checkbox list ── */}
                    <div className="px-1 pt-2">
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="font-mono text-[9px] font-bold text-white/40">🌍 זירות גלובליות</span>
                        <span className="font-mono text-[8px] text-white/30">{selectedGlobalZones.length}/{GLOBAL_ZONES.length} פעיל</span>
                      </div>
                      <div className="flex flex-col gap-0.5 max-h-48 overflow-y-auto">
                        {GLOBAL_ZONES.map(zone => {
                          const active = selectedGlobalZones.includes(zone.id);
                          const flyZoom = zone.radiusKm < 100 ? 8 : zone.radiusKm < 500 ? 6 : zone.radiusKm < 1000 ? 5 : 4;
                          return (
                            <div
                              key={zone.id}
                              className={`flex items-center gap-2 px-2 py-1.5 rounded-lg transition-all ${active ? 'bg-primary/15 text-white' : 'text-white/35 hover:text-white/70 hover:bg-white/[0.04]'}`}
                            >
                              <button
                                onClick={() => {
                                  setFlyTo({ center: zone.center, zoom: flyZoom });
                                  if (!active) toggleGlobalZone(zone.id);
                                  setShowLayerMenu(false);
                                }}
                                title={`עוף לזירה — ${zone.name}`}
                                className="flex items-center gap-2 flex-1 text-right active:scale-[0.98] transition-all"
                              >
                                <span className="text-base">{zone.flag}</span>
                                <span className="font-mono text-[10px] font-bold flex-1 truncate">{zone.name}</span>
                                <span className="text-[10px] opacity-70">✈️</span>
                                <span className="font-mono text-[8px]" style={{ color: zone.color }}>R{zone.risk}</span>
                              </button>
                              <button
                                onClick={() => toggleGlobalZone(zone.id)}
                                title={active ? 'הסתר מהמפה' : 'הצג על המפה'}
                                className={`w-4 h-4 rounded border flex items-center justify-center transition-all shrink-0 ${active ? 'border-primary bg-primary/30' : 'border-white/20 hover:border-white/40'}`}
                              >
                                {active && <span className="text-primary text-[10px] leading-none">✓</span>}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex gap-1.5 mt-1.5">
                        <button onClick={() => setSelectedGlobalZones(GLOBAL_ZONES.map(z => z.id))}
                          className="flex-1 h-7 rounded-lg text-[9px] font-mono font-bold text-primary/70 hover:text-primary hover:bg-primary/10 border border-primary/20 transition-all">בחר הכל</button>
                        <button onClick={() => setSelectedGlobalZones([])}
                          className="flex-1 h-7 rounded-lg text-[9px] font-mono font-bold text-war-red/70 hover:text-war-red hover:bg-war-red/10 border border-war-red/20 transition-all">נקה</button>
                      </div>
                    </div>

                    <div className="h-px bg-white/[0.06] my-1" />

                    <div className="flex gap-2 px-1 pb-1">
                      <button onClick={() => { allLayers.forEach(l => { if (!l.active) l.toggle(); }); }}
                        className="flex-1 h-10 rounded-xl text-[10px] font-mono font-bold text-primary/80 hover:text-primary active:scale-95 hover:bg-primary/10 transition-all border border-primary/20">✅ הפעל הכל</button>
                      <button onClick={() => { allLayers.forEach(l => { if (l.active) l.toggle(); }); }}
                        className="flex-1 h-10 rounded-xl text-[10px] font-mono font-bold text-war-red/80 hover:text-war-red active:scale-95 hover:bg-war-red/10 transition-all border border-war-red/20">🚫 נקה הכל</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Analysis Status — right of settings ── */}
          <AnalysisStatusPanel />
        </div>
      </nav>



      {/* ── UAV Watch radius slider — visible when UAV layer is active ── */}
      {showUav && (
        <div className="absolute top-20 right-3 z-[1000] bg-background/85 backdrop-blur-md border border-orange-500/30 rounded-lg px-3 py-2 shadow-lg" dir="rtl">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-base">🛸</span>
            <span className="font-mono text-[10px] font-bold text-orange-400">UAV Watch</span>
            <span className="font-mono text-[9px] text-foreground/50">
              {uavTracks.length} מטרות · {uavRadiusKm}ק"מ
            </span>
          </div>
          <input
            type="range"
            min={1}
            max={50}
            step={1}
            value={uavRadiusKm}
            onChange={(e) => setUavRadiusKm(parseInt(e.target.value, 10))}
            className="w-40 accent-orange-500"
            aria-label="רדיוס סריקה"
          />
          {uavLastUpdate && (
            <div className="font-mono text-[8px] text-foreground/40 mt-1">
              עודכן: {new Date(uavLastUpdate).toLocaleTimeString('he-IL')}
            </div>
          )}
        </div>
      )}

      {/* ── GPS Error ── */}
      {gpsError && !userGPS && (
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-[1000] bg-background/80 backdrop-blur-md border border-war-yellow/20 px-3 py-1 rounded-sm">
          <span className="font-mono text-[8px] text-war-yellow">📍 GPS: {gpsError}</span>
        </div>
      )}

      {/* Readiness gauge moved to toolbar */}

      {/* Watermark brand */}
      <div className="fixed bottom-[42px] right-3 z-[999] pointer-events-none select-none opacity-[0.12]">
        <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 9, fontWeight: 700, letterSpacing: '3px', color: '#fff' }}>
          WARZONE CONTROL
        </span>
      </div>

      {/* Threat Legend & Intercept Stats moved to left panel overlay above */}

      <div className="fixed bottom-0 left-0 right-0 z-[1000] flex flex-col" role="status" aria-label="סרגל מידע" style={{ background: 'rgba(0,8,18,0.55)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}>
        {/* Row 1: Severity legend */}
        <div className="flex items-center px-3 h-5 shrink-0">
          <div className="flex items-center gap-2 shrink-0">
            {Object.entries(SEVERITY_LABELS).filter(([k]) => k !== 'safe').map(([key, label]) => (
              <div key={key} className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: SEVERITY_COLORS[key].color, boxShadow: `0 0 4px ${SEVERITY_COLORS[key].color}` }} />
                <span className="font-mono text-[7px] font-bold" style={{ color: SEVERITY_COLORS[key].color }}>{label}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-auto">
            <div className={`w-1.5 h-1.5 rounded-full ${telegram.isPolling ? 'bg-war-yellow animate-pulse' : 'bg-war-green/60'}`} />
            <span className="font-mono text-[7px] text-muted-foreground">TG:{telegram.messages.length}</span>
          </div>
        </div>
        {/* Row 2: TV-style news ticker — LARGE, clear, sorted newest first */}
        <div className="h-8 border-t border-white/20 flex items-center overflow-hidden relative" style={{ background: 'linear-gradient(90deg, rgba(180,30,30,0.15) 0%, rgba(20,20,40,0.95) 15%, rgba(20,20,40,0.95) 85%, rgba(180,30,30,0.15) 100%)' }}>
          {/* Fixed badge — LEFT side like TV news */}
          <div className="absolute left-0 top-0 bottom-0 z-10 flex items-center px-2.5" style={{ background: 'rgba(200,30,30,0.85)', boxShadow: '4px 0 16px rgba(200,30,30,0.4)' }}>
            <span className="font-mono text-[9px] text-white font-bold tracking-wider">⚡ מבזקים</span>
          </div>
          {/* Scrolling area — LTR scroll like TV news crawl */}
          <div className="flex-1 overflow-hidden pl-24">
            {(() => {
              const HEB_SOURCE: Record<string, string> = {
                centcom: 'פיקוד מרכז', nato: 'נאט"ו', irna: 'IRNA', tasnim: 'תסנים', fars: 'פארס',
                reuters: 'רויטרס', bbc: 'BBC', cnn: 'CNN', foxnews: 'פוקס', aljazeera: 'אלג\'זירה',
                ch12: 'ערוץ 12', ch13: 'ערוץ 13', ch11: 'כאן 11', news_ch12: 'ערוץ 12', news_ch13: 'ערוץ 13',
                news_ch11: 'כאן 11', ynet: 'ynet', walla: 'וואלה', maariv: 'מעריב', telegram: 'טלגרם',
                telegram_public_kann_news: 'Telegram כאן', telegram_public_news_0404: 'Telegram 0404',
                mda: 'מד"א', fire: 'כיבוי', police: 'משטרה', idf: 'צה"ל', shin_bet: 'שב"כ',
                wsj: 'WSJ', nyt: 'NYT', news_wsj: 'WSJ', news_nyt: 'NYT',
                news_ynet: 'ynet', news_walla: 'וואלה',
                gulfnews: 'גאלף ניוז', news_gulfnews: 'UAE', arabnews: 'סעודיה', news_arabnews: 'סעודיה',
                thenational: 'אמירויות', news_thenational: 'UAE',
                rt: 'RT רוסיה', news_rt: 'רוסיה', tass: 'TASS', news_tass: 'רוסיה',
                scmp: 'SCMP סין', news_scmp: 'סין', xinhua: 'שינחואה', news_xinhua: 'סין',
                ft: 'FT כלכלה', news_ft: 'FT', bloomberg: 'בלומברג', news_bloomberg: 'בלומברג',
              };
              const toHebSrc = (s: string) => {
                const k = s?.replace('news_', '').toLowerCase() || '';
                return HEB_SOURCE[k] || HEB_SOURCE[s] || s || 'כללי';
              };

              // Build headlines — concise: source + title only, no summary
              const headlines: { text: string; color: string; time: number; priority: number }[] = [];
              const isDerivedIntel = (source?: string) => {
                if (!source) return false;
                return source === 'cross_correlation' || source === 'ai_analysis' || source.endsWith('_analysis');
              };
              
              const sevPriority: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

              // Exclude satellite spam & derived intel; limit FIRMS to max 2 entries
              const tickerReports = mergedIntelReports.filter(r => !isDerivedIntel(r.source) && r.source !== 'nasa_firms' && r.source !== 'usgs_earthquakes');
              tickerReports.slice(0, 18).forEach(r => {
                const rawTitle = r.title.replace(/^\[.*?\]\s*/, '').slice(0, 55);
                const title = getHebrewTitle(rawTitle);
                const srcColor = r.source?.startsWith('telegram_public_') ? '#00e5ff' :
                  r.source === 'centcom' ? '#2196f3' : r.source === 'nato' ? '#7c4dff' :
                  r.source?.includes('irna') ? '#4caf50' : r.source?.includes('tasnim') ? '#388e3c' :
                  r.source?.includes('reuters') ? '#ff8800' : r.source?.includes('bbc') ? '#bb1919' :
                  r.source?.includes('cnn') ? '#cc0000' : r.source?.includes('aljazeera') ? '#d4a843' :
                  r.source?.includes('ch12') ? '#e91e63' : r.source?.includes('ch13') ? '#ff5722' :
                  r.source?.includes('nyt') ? '#aaa' : r.source?.includes('ynet') ? '#ff0000' :
                  r.source?.includes('tass') ? '#4caf50' : r.source?.includes('rt') ? '#66bb6a' :
                  r.source?.includes('scmp') ? '#e53935' : r.source?.includes('foxnews') ? '#003580' :
                  r.source?.includes('wsj') ? '#0274b6' : r.source?.includes('ft') ? '#f5c242' :
                  r.source?.includes('walla') ? '#00bcd4' : r.source?.includes('bloomberg') ? '#7b1fa2' : '#888';
                const time = new Date(r.created_at).getTime();
                const ageMins = Math.floor((Date.now() - time) / 60000);
                const timeLabel = ageMins < 1 ? 'עכשיו' : ageMins < 60 ? `${ageMins}ד'` : `${Math.floor(ageMins / 60)}ש'`;
                headlines.push({ 
                  text: `${toHebSrc(r.source)} | ${title} (${timeLabel})`, 
                  color: srcColor, 
                  time,
                  priority: r.source?.startsWith('telegram_public_') ? 1 : (sevPriority[r.severity] ?? 2) + 3
                });
              });

              war.filteredAlerts.filter(a => {
                if ((a.title || '').includes('שחרור') || (a.title || '').includes('הותר')) return false;
                if (a.timestamp && (Date.now() - a.timestamp) > 3600000) return false;
                return true;
              }).slice(0, 8).forEach(a => {
                headlines.push({ 
                  text: `🚨 ${(a.title || '').slice(0, 50)}`, 
                  color: SEVERITY_COLORS[a.severity]?.color || '#ff1744',
                  time: a.timestamp || Date.now(),
                  priority: 0
                });
              });

              // Launch detection alerts — highest priority in ticker
              launchDetectionMarkers.forEach(det => {
                const matchedSrc = MISSILE_SOURCES.find(ms =>
                  det.origin.name.includes('איראן') && ms.id === 'iran' ||
                  det.origin.name.includes('לבנון') && ms.id === 'lebanon_hzb' ||
                  det.origin.name.includes('תימן') && ms.id === 'houthis' ||
                  det.origin.name.includes('עיראק') && ms.id === 'iraq_militia'
                );
                const flightSec = matchedSrc?.flightTimeSec || 720;
                const elapsed = (Date.now() - new Date(det.time).getTime()) / 1000;
                const etaSec = Math.max(0, flightSec - elapsed);
                const etaMin = Math.floor(etaSec / 60);
                const etaSecRem = Math.floor(etaSec % 60);
                const phaseLabel = elapsed < flightSec * 0.15 ? 'BOOST' : elapsed < flightSec * 0.5 ? 'MIDCOURSE' : elapsed < flightSec ? 'TERMINAL' : 'שחרור';
                const targets = det.targets.map(t => t.name).join(', ');
                headlines.push({
                  text: `🚀 זיהוי שיגור — ${det.origin.name} ⏱ ETA ${etaMin}:${String(etaSecRem).padStart(2, '0')} | ${phaseLabel} | יעדים: ${targets} | ביטחון: ${det.confidence}%`,
                  color: '#ff1744',
                  time: new Date(det.time).getTime(),
                  priority: -1, // highest priority
                });
              });

              const isSpamOrSystem = (text: string) => {
                const lower = text.toLowerCase();
                const trimmed = text.trim();
                // Gambling / casino spam
                if (/casino|🎰|aviator|sugar rush|slot|bet\b|gambling|trickster/i.test(lower)) return true;
                // System messages
                if (/^(congratulations|поздравляем).*subscribed/i.test(lower)) return true;
                if (/^use \/off/i.test(lower) || /^this chat is not linked/i.test(lower)) return true;
                if (/\/off|\/on|\/start/.test(lower)) return true;
                // Too short (less than 15 chars) — "בודק עכשיו", "בדוק עכשיו", "8 דק שחרור"
                if (trimmed.length < 15) return true;
                // URL-only messages (just a link with no real text)
                const withoutUrls = trimmed.replace(/https?:\/\/\S+/g, '').trim();
                if (withoutUrls.length < 10) return true;
                // Messages that are mostly links / forwarding ads
                const urlCount = (trimmed.match(/https?:\/\/\S+/g) || []).length;
                const textWithoutUrls = withoutUrls.replace(/[^\u0590-\u05FFa-zA-Zа-яА-Я0-9\s]/g, '').trim();
                if (urlCount >= 2 && textWithoutUrls.length < 20) return true;
                // Generic short chat replies
                if (/^(בודק|בדוק|ok|אוקי|תודה|thanks|שלום|היי|hey)\b/i.test(trimmed) && trimmed.length < 20) return true;
                return false;
              };

              const filteredTgMessages = telegram.messages.filter(msg => 
                msg.text && !msg.is_duplicate && !isSpamOrSystem(msg.text)
              );

              filteredTgMessages.filter(m => m.severity === 'critical' || m.severity === 'high')
                .slice(0, 5).forEach(m => {
                  const ageMins2 = Math.floor((Date.now() - (m.message_date ? new Date(m.message_date).getTime() : new Date(m.created_at).getTime())) / 60000);
                  const tl2 = ageMins2 < 1 ? 'עכשיו' : ageMins2 < 60 ? `${ageMins2}ד'` : `${Math.floor(ageMins2 / 60)}ש'`;
                  headlines.push({ 
                    text: `📨 טלגרם | ${(m.text || '').slice(0, 50)} (${tl2})`, 
                    color: '#00e5ff',
                    time: m.message_date ? new Date(m.message_date).getTime() : new Date(m.created_at).getTime(),
                    priority: 1
                  });
                });

              // More Telegram messages (medium/warning/low) in ticker
              filteredTgMessages.filter(m => m.severity !== 'critical' && m.severity !== 'high')
                .slice(0, 12).forEach(m => {
                  const ageMins3 = Math.floor((Date.now() - (m.message_date ? new Date(m.message_date).getTime() : new Date(m.created_at).getTime())) / 60000);
                  const tl3 = ageMins3 < 1 ? 'עכשיו' : ageMins3 < 60 ? `${ageMins3}ד'` : `${Math.floor(ageMins3 / 60)}ש'`;
                  headlines.push({ 
                    text: `📨 ${(m.text || '').slice(0, 55)} (${tl3})`, 
                    color: '#00bcd4',
                    time: m.message_date ? new Date(m.message_date).getTime() : new Date(m.created_at).getTime(),
                    priority: 2
                  });
                });

              // ── Add intel analysis category headlines to ticker ──
              (() => {
                const warKw = ['שיגור', 'תקיפה', 'יירוט', 'טיל', 'רקטה', 'חיסול', 'כטב', 'כוננות', 'מבצע', 'הפצצה', 'פיגוע', 'מחבל', 'דקירה', 'חדירה', 'צה"ל', 'launch', 'strike', 'missile', 'intercept', 'drone', 'IDF', 'Hezbollah', 'Hamas', 'terror', 'attack'];
                const cyberKw = ['סייבר', 'האקר', 'פריצה', 'מתקפת סייבר', 'דליפת מידע', 'כופרה', 'DDoS', 'cyber', 'hack', 'malware', 'ransomware', 'breach', 'CVE', 'CISA', 'APT', 'zero-day'];
                const econKw = ['כלכלה', 'שוק ההון', 'בורסה', 'מניות', 'אינפלציה', 'ריבית', 'סנקציות', 'נפט', 'economy', 'market', 'stock', 'inflation', 'oil', 'sanctions'];
                const geoKw = ['גיאופוליטי', 'דיפלומטי', 'או"ם', 'נאט"ו', 'NATO', 'UN', 'הסכם', 'מו"מ', 'שגריר', 'geopolit', 'diplomat', 'treaty', 'ceasefire', 'summit', 'G7', 'EU', 'BRICS'];

                const matchCat = (text: string) => {
                  const t = text.toLowerCase();
                  if (cyberKw.some(k => t.includes(k.toLowerCase()))) return 'cyber';
                  if (econKw.some(k => t.includes(k.toLowerCase()))) return 'economy';
                  if (geoKw.some(k => t.includes(k.toLowerCase()))) return 'geopolitical';
                  if (warKw.some(k => t.includes(k.toLowerCase()))) return 'war';
                  return null;
                };

                const catLabels: Record<string, { label: string; icon: string; color: string }> = {
                  war: { label: 'ביטחון', icon: '⚔️', color: '#ff1744' },
                  cyber: { label: 'סייבר', icon: '🖥️', color: '#7c4dff' },
                  economy: { label: 'כלכלה', icon: '📊', color: '#ffab00' },
                  geopolitical: { label: 'גיאופוליטי', icon: '🌍', color: '#2196f3' },
                };

                // Collect categorized report titles for the ticker
                for (const r of mergedIntelReports) {
                  const cat = matchCat(`${r.title} ${r.summary} ${r.category || ''}`);
                  if (cat && catLabels[cat]) {
                    const rawTitle = r.title.replace(/^\[.*?\]\s*/, '').slice(0, 50);
                    const cl = catLabels[cat];
                    headlines.push({
                      text: `${cl.icon} ${cl.label} | ${rawTitle}`,
                      color: cl.color,
                      time: new Date(r.created_at).getTime(),
                      priority: 2,
                    });
                  }
                }

                // Categorized TG messages
                for (const m of filteredTgMessages.filter(m2 => m2.severity !== 'critical' && m2.severity !== 'high').slice(0, 20)) {
                  const cat = matchCat(m.text || '');
                  if (cat && catLabels[cat]) {
                    const cl = catLabels[cat];
                    headlines.push({
                      text: `${cl.icon} ${cl.label} | ${(m.text || '').slice(0, 50)}`,
                      color: cl.color,
                      time: m.message_date ? new Date(m.message_date).getTime() : new Date(m.created_at).getTime(),
                      priority: 3,
                    });
                  }
                }
              })();

              // Sort FIFO — newest first (all sources mixed together)
              headlines.sort((a, b) => b.time - a.time);

              // Deduplicate similar headlines — keep first (newest) occurrence
              const seenNorm = new Set<string>();
              const dedupedHeadlines = headlines.filter(h => {
                // Extract core text without source prefix and time suffix
                const core = h.text.replace(/^[^\|]+\|\s*/, '').replace(/\s*\([^)]*\)\s*$/, '').replace(/^[📨🚨🚀⚡]\s*/, '').trim().toLowerCase();
                // Normalize: remove punctuation, collapse whitespace
                const norm = core.replace(/["""״׳''.,!?;:\-–—]/g, '').replace(/\s+/g, ' ').trim();
                if (norm.length < 8) return true; // too short to compare
                // Check if any existing key is a substring match (>60% overlap)
                for (const seen of seenNorm) {
                  if (norm.includes(seen.slice(0, Math.floor(seen.length * 0.6))) || seen.includes(norm.slice(0, Math.floor(norm.length * 0.6)))) {
                    return false;
                  }
                }
                seenNorm.add(norm);
                return true;
              });

              const visibleHeadlines = dedupedHeadlines.slice(0, 30);

              if (visibleHeadlines.length === 0) {
                return <div className="font-mono text-[11px] text-foreground/30 px-4" dir="rtl">ממתין לעדכונים...</div>;
              }

              const items = [...visibleHeadlines, ...visibleHeadlines];
              // 50% faster again: halve previous duration
              const scrollDuration = `${Math.max(1.8, 1 + visibleHeadlines.length * 0.22)}s`;
              return (
                <div className="flex whitespace-nowrap" style={{ animation: `ticker-scroll ${scrollDuration} linear infinite` }}>
                  {items.map((h, i) => (
                    <span key={`t-${i}`} className="font-mono text-[10px] font-bold inline-flex items-center shrink-0 mx-6"
                      style={{ color: h.color, textShadow: `0 0 8px ${h.color}66, 0 0 2px ${h.color}aa` }}>
                      {h.text}
                      <span className="text-white/20 mx-4">◆</span>
                    </span>
                  ))}
                </div>
              );
            })()}
          </div>
        </div>
      </div>

      {/* ── Left Panel Toggle ── */}
      <button onClick={() => setLeftOpen(v => !v)} aria-label={leftOpen ? 'סגור פאנל התראות' : 'פתח פאנל התראות'} aria-expanded={leftOpen}
        className="absolute top-12 z-[1001] font-mono text-[9px] px-1.5 py-3 bg-background/70 backdrop-blur-md border border-border/30 rounded-r-md transition-all hover:bg-background/90"
        style={{ left: leftOpen ? '320px' : '0' }}>
        {leftOpen ? '◀' : '▶'}
      </button>

      {/* ── Left Panel: Alert Feed ── */}
      <aside className={`absolute top-12 left-0 bottom-11 z-[1000] intel-panel flex flex-col transition-all duration-300 ${leftOpen ? 'w-80 opacity-100' : 'w-0 opacity-0 overflow-hidden'}`} style={{ borderRight: '1px solid hsla(185,70%,30%,0.25)' }} role="complementary" aria-label="פאנל התראות" aria-hidden={!leftOpen}>
        <div className="px-3 py-2 border-b border-border/20 flex items-center justify-between">
          <span className="font-mono text-[9px] text-primary/70 tracking-widest">ALERTS</span>
          <span className="font-mono text-[8px] text-muted-foreground">{war.filteredAlerts.length}</span>
        </div>
        <div className="px-2 py-1.5 flex flex-wrap gap-1 border-b border-border/10">
          {[{ key: 'all', label: 'הכל' }, { key: 'early', label: '⚡ EW' }, { key: 'critical', label: '🔴' }, { key: 'oref', label: '🚨' }].map(f => (
            <button key={f.key} onClick={() => war.setFilter(f.key)}
              className={`font-mono text-[8px] px-2 py-0.5 rounded-sm transition-colors ${war.activeFilter === f.key ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}>{f.label}</button>
          ))}
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-1.5 space-y-1">
          {/* Emergency multi-region alert card — pinned at top */}
          <EmergencyTakeover
            messages={telegram.messages}
            onFlyBounds={(bounds) => setFlyBounds(bounds)}
            onClockColor={(idx) => setClockColorIdxManual(idx)}
          />
          {(() => {
            const now = Date.now();
            const recentAlerts = war.filteredAlerts.filter(alert => {
              const title = (alert.title || '');
              const body = (alert.body || '');
              if (title.includes('שחרור') || title.includes('הותר') || body.includes('שחרור') || body.includes('הותר')) return false;
              if (alert.timestamp && (now - alert.timestamp) > 6 * 3600000) return false;
              return true;
            });
            if (recentAlerts.length === 0) {
              return (
                <div className="flex flex-col items-center py-10 text-muted-foreground">
                  <span className="text-3xl opacity-20 mb-2">📡</span>
                  <span className="font-mono text-[9px]">{dataMode === 'live' ? 'אין התראות פעילות' : 'מצב הדגמה'}</span>
                </div>
              );
            }
            return recentAlerts.slice(0, 30).map(alert => {
              const sc = SEVERITY_COLORS[alert.severity] || SEVERITY_COLORS.low;
              return (
                <div key={alert.id} className="border p-2 bg-black/20 transition-all hover:bg-black/40 rounded" style={{ borderColor: `${sc.color}33` }}>
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: sc.color }} />
                    <span className="font-mono text-[10px] font-bold text-foreground/90 leading-tight">{alert.title}</span>
                  </div>
                  {alert.body && (
                    <p className="font-mono text-[9px] text-foreground/60 leading-relaxed line-clamp-3 mb-1">{(alert.body || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim()}</p>
                  )}
                  <div className="flex items-center gap-2">
                    {alert.earlyWarning && <span className="text-[7px] px-1 py-px bg-war-orange/10 text-war-orange/80 rounded-sm">EW</span>}
                    <span className="text-[7px] text-muted-foreground">{alert.confidence}%</span>
                    <span className="text-[7px] text-muted-foreground uppercase">{alert.source}</span>
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </aside>



      {/* ── Right Panel Toggle ── */}
      <button onClick={() => setRightOpen(v => !v)} aria-label={rightOpen ? 'סגור פאנל מודיעין' : 'פתח פאנל מודיעין'} aria-expanded={rightOpen}
        className="absolute z-[1001] rounded-l-md transition-all hover:scale-105 active:scale-95"
        style={{
          top: 'calc(env(safe-area-inset-top, 0px) + 56px)',
          right: rightOpen ? '280px' : '0',
          fontFamily: 'Share Tech Mono',
          fontSize: 14,
          padding: '12px 6px',
          background: 'linear-gradient(135deg, rgba(0,15,25,0.92), rgba(0,30,50,0.88))',
          border: '1px solid hsla(185,80%,40%,0.35)',
          borderRight: 'none',
          color: 'hsl(185,100%,55%)',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 2px 12px rgba(0,229,255,0.15), inset 0 0 8px rgba(0,229,255,0.05)',
        }}>
        {rightOpen ? '▶' : '◀'}
      </button>

      {/* ── Right Panel: Intel ── */}
      <aside className={`absolute right-0 bottom-14 z-[1000] overflow-y-auto transition-all duration-300 intel-panel ${rightOpen ? 'w-[280px] opacity-100' : 'w-0 opacity-0 overflow-hidden'}`} role="complementary" aria-label="פאנל מודיעין — המודיעין של שולה" aria-hidden={!rightOpen}
        style={{ borderLeft: '1px solid hsla(185,70%,30%,0.25)', top: 'calc(env(safe-area-inset-top, 0px) + 48px)' }}>
        {/* ── המודיעין של שולה — Glowing Analysis/Forecast Buttons + Compact Gauges ── */}
        <div className="border-b border-border/20">
          <div className="w-full flex items-center gap-2 px-3 py-2">
            <div className={`w-2.5 h-2.5 rounded-full ${orefAlerts.length > 0 ? 'bg-war-red animate-pulse' : 'bg-war-green/50'}`} />
            <span className="font-mono text-[11px] text-white font-bold tracking-widest flex-1 text-right">המודיעין של שולה</span>
          </div>

          <div className="px-3 pb-2.5 space-y-2">
            {/* ── ניתוח | סיכום כללי (סקאלה) | תחזית — שורה אחת ── */}
            <div className="flex gap-1 items-stretch">
              {/* ניתוח */}
              <button onClick={() => setTzofarPhase(1)}
                className="flex-1 font-mono text-[9px] py-1.5 px-1 rounded-md transition-all font-bold"
                style={{
                  background: tzofarPhase === 1 ? 'rgba(0,229,255,0.15)' : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${tzofarPhase === 1 ? 'rgba(0,229,255,0.4)' : 'rgba(255,255,255,0.06)'}`,
                  color: tzofarPhase === 1 ? '#00e5ff' : 'rgba(255,255,255,0.35)',
                  boxShadow: tzofarPhase === 1 ? '0 0 10px rgba(0,229,255,0.2)' : 'none',
                }}>
                🧠 ניתוח
              </button>

              {/* סיכום כללי — סקאלה מכל הנתונים */}
              {(() => {
                const totalEvents = emergencyEvents.length;
                const critAlerts = orefAlerts.length;
                const intelCount = intelReports.length;
                const tgCrit = (war.signals.launches || 0);
                const overallScore = Math.min(100, critAlerts * 8 + totalEvents * 2 + tgCrit * 5 + (war.signals.troops || 0) * 3 + (war.signals.rhetoric || 0) * 2);
                const scaleColor = overallScore > 70 ? '#ff1744' : overallScore > 45 ? '#ff6d00' : overallScore > 20 ? '#ffab00' : '#00e676';
                const scaleLabel = overallScore > 70 ? 'קריטי' : overallScore > 45 ? 'מוגבר' : overallScore > 20 ? 'מתון' : 'שגרה';
                return (
                  <div className="flex-1 rounded-md flex flex-col items-center justify-center py-1 px-1 cursor-default"
                    style={{ background: `${scaleColor}0a`, border: `1px solid ${scaleColor}30` }}>
                    <div className="w-full h-[3px] rounded-full overflow-hidden mb-0.5" style={{ background: 'rgba(255,255,255,0.06)' }}>
                      <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${overallScore}%`, background: `linear-gradient(90deg, #00e676, #ffab00, #ff6d00, #ff1744)`, filter: `drop-shadow(0 0 4px ${scaleColor})` }} />
                    </div>
                    <span className="font-mono text-[16px] font-black leading-none" style={{ color: scaleColor, textShadow: `0 0 8px ${scaleColor}66` }}>{overallScore}</span>
                    <span className="font-mono text-[10px] font-bold" style={{ color: `${scaleColor}cc` }}>{scaleLabel}</span>
                  </div>
                );
              })()}

              {/* תחזית */}
              <button onClick={() => setTzofarPhase(2)}
                className="flex-1 font-mono text-[9px] py-1.5 px-1 rounded-md transition-all font-bold"
                style={{
                  background: tzofarPhase === 2 ? 'rgba(179,136,255,0.15)' : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${tzofarPhase === 2 ? 'rgba(179,136,255,0.4)' : 'rgba(255,255,255,0.06)'}`,
                  color: tzofarPhase === 2 ? '#b388ff' : 'rgba(255,255,255,0.35)',
                  boxShadow: tzofarPhase === 2 ? '0 0 10px rgba(179,136,255,0.2)' : 'none',
                }}>
                🔮 תחזית
              </button>
            </div>

            {/* ── Phase 1: Analysis ── */}
            {tzofarPhase === 1 && (
              <div className="animate-in fade-in duration-500 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[8px] text-white/50 tracking-widest">🧠 ניתוח מצב</span>
                  <div className="flex items-center gap-1">
                    {summaryTime && <span className="font-mono text-[6px] text-foreground/20">{summaryTime}</span>}
                    <button onClick={fetchSituationSummary} disabled={summaryLoading}
                      className="font-mono text-[7px] text-primary/40 hover:text-primary/70 transition-colors disabled:opacity-30">
                      {summaryLoading ? '⏳' : '↻'}
                    </button>
                  </div>
                </div>

                {aiAssessment?.bottom_line && (
                  <div className="rounded-md bg-destructive/10 border border-destructive/20 px-2 py-1.5" dir="rtl">
                    <p className="font-mono text-[10px] font-bold text-white leading-snug">{aiAssessment.bottom_line}</p>
                  </div>
                )}

                <div className="rounded-md bg-white/[0.03] border border-border/10 p-2">
                  <div className="max-h-16 overflow-y-auto scrollbar-thin">
                    {(situationSummary || aiAssessment?.summary) ? (
                      <p className="font-mono text-[9px] text-white/80 leading-relaxed" dir="rtl">{aiAssessment?.summary || situationSummary}</p>
                    ) : (
                      <p className="font-mono text-[7px] text-foreground/20 text-center py-1">{summaryLoading ? 'סורק...' : 'ממתין'}</p>
                    )}
                  </div>
                </div>

                {aiAssessment?.fronts?.length > 0 && (
                  <div className="space-y-0.5" dir="rtl">
                    {aiAssessment.fronts.map((f: any, fi: number) => {
                      const tColor = f.threat_level > 70 ? '#ff1744' : f.threat_level > 40 ? '#ff6d00' : f.threat_level > 20 ? '#ffab00' : '#00e676';
                      return (
                        <div key={fi} className="flex items-center gap-1.5 py-[2px]">
                          <span className="font-mono text-[8px] text-white/70 w-12 shrink-0">{f.name}</span>
                          <div className="flex-1 h-1 bg-white/5 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${f.threat_level}%`, background: tColor }} />
                          </div>
                          <span className="font-mono text-[6px]" style={{ color: tColor }}>{f.threat_level}%</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* ── Phase 2: Forecasts ── */}
            {tzofarPhase === 2 && (
              <div className="animate-in fade-in duration-500 space-y-1.5">
                {[
                  { key: 'forecast_hour', label: 'שעה קרובה', icon: '⏱️', timeColor: '#00e5ff' },
                  { key: 'forecast_day', label: 'יום קרוב', icon: '📅', timeColor: '#ffab00' },
                  { key: 'forecast_week', label: 'שבוע קרוב', icon: '📆', timeColor: '#ff6d00' },
                ].map(({ key, label, icon, timeColor }) => {
                  const fc = aiAssessment?.[key];
                  if (!fc) return (
                    <div key={key} className="rounded-md bg-white/[0.02] border border-border/5 p-2" dir="rtl">
                      <div className="flex items-center gap-1 mb-0.5">
                        <span className="text-[7px]">{icon}</span>
                        <span className="font-mono text-[7px] font-bold" style={{ color: timeColor }}>{label}</span>
                      </div>
                      <p className="font-mono text-[7px] text-foreground/20">{summaryLoading ? 'מנתח...' : 'ממתין'}</p>
                    </div>
                  );
                  const riskColor = fc.risk_level > 70 ? '#ff1744' : fc.risk_level > 40 ? '#ff6d00' : '#00e676';
                  return (
                    <div key={key} className="rounded-md bg-white/[0.03] border border-border/10 p-2" dir="rtl">
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-1">
                          <span className="text-[7px]">{icon}</span>
                          <span className="font-mono text-[8px] font-bold" style={{ color: timeColor }}>{label}</span>
                        </div>
                        <span className="font-mono text-[6px]" style={{ color: riskColor }}>{fc.risk_level}%</span>
                      </div>
                      <p className="font-mono text-[9px] font-bold text-white mb-0.5">{fc.title}</p>
                      <p className="font-mono text-[8px] text-white/65 leading-snug">{fc.details}</p>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Compact Signal Gauges — horizontal mini bars ── */}
            <div className="pt-1.5 border-t border-border/10">
              <div className="grid grid-cols-5 gap-0.5">
                {[
                  { label: 'שיגור', key: 'launches' as const, color: '#ff1744', icon: '🚀' },
                  { label: 'כוחות', key: 'troops' as const, color: '#ff6d00', icon: '🪖' },
                  { label: 'מודיע', key: 'intel' as const, color: '#ffab00', icon: '📡' },
                  { label: 'רטור', key: 'rhetoric' as const, color: '#ffd600', icon: '📢' },
                  { label: 'דיפלו', key: 'diplo' as const, color: '#00e676', icon: '🏛' },
                ].map(sig => (
                  <div key={sig.key} className="text-center py-1 rounded-md" style={{ background: `${sig.color}06` }}>
                    <div className="text-[8px]">{sig.icon}</div>
                    <div className="font-mono text-[8px] font-black" style={{ color: `${sig.color}cc` }}>{war.signals[sig.key]}</div>
                    <div className="mx-auto mt-0.5 rounded-full overflow-hidden" style={{ width: '80%', height: 2, background: 'rgba(255,255,255,0.05)' }}>
                      <div className="h-full rounded-full" style={{ width: `${war.signals[sig.key]}%`, background: sig.color, opacity: 0.7 }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>


        {/* ── Tab Bar: INTEL / NEWS / AI / VEHICLES ── */}
        <div className="flex items-center" style={{ borderBottom: '1px solid hsla(185,80%,40%,0.15)' }}>
          {[
            { key: 'intel' as const, label: 'הודעות', icon: '📋' },
            { key: 'events' as const, label: 'אירועים', icon: '🔴' },
            { key: 'ai' as const, label: 'AI', icon: '🧠' },
            { key: 'report' as const, label: 'דוח מודיעין', icon: '📋' },
            { key: 'stocks' as const, label: 'MKT', icon: '📈' },
          ].map(tab => (
            <button key={tab.key} onClick={() => setRightTab(tab.key)}
              className="flex-1 py-1.5 transition-all"
              style={{
                fontFamily: 'Orbitron',
                fontSize: 7,
                fontWeight: 700,
                letterSpacing: '1px',
                borderBottom: rightTab === tab.key ? '2px solid hsl(185,100%,50%)' : '2px solid transparent',
                color: rightTab === tab.key ? 'hsl(185,100%,55%)' : 'hsla(185,60%,50%,0.3)',
                background: rightTab === tab.key ? 'rgba(0,255,255,0.05)' : 'transparent',
              }}>
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* ── TAB: AI — NASA Mission Control Style ── */}
        {rightTab === 'ai' && (
          <div className="px-2 py-2 space-y-2 max-h-[60vh] overflow-y-auto" dir="rtl" style={{ background: 'linear-gradient(180deg, rgba(0,4,12,0.95), rgba(0,8,20,0.98))' }}>
            {/* Mission Control Header */}
            <div className="flex items-center justify-between px-2 py-1.5 rounded-lg" style={{ background: 'linear-gradient(90deg, rgba(0,229,255,0.06), rgba(179,136,255,0.04))', border: '1px solid rgba(0,229,255,0.12)' }}>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" style={{ boxShadow: '0 0 6px #00e67660' }} />
                <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 9, fontWeight: 800, letterSpacing: '0.2em', color: 'hsl(185,100%,60%)' }}>WARWATCH — AI CORE</span>
              </div>
              <button onClick={fetchAiAssessment} disabled={aiLoading}
                className="font-mono text-[7px] px-2.5 py-1 rounded-md transition-all active:scale-95"
                style={{ background: 'rgba(0,229,255,0.08)', border: '1px solid rgba(0,229,255,0.2)', color: 'hsl(185,100%,65%)' }}>
                {aiLoading ? '⏳' : '⟳ SCAN'}
              </button>
            </div>

            {/* System Status Indicators */}
            <div className="grid grid-cols-4 gap-1">
              {[
                { label: 'SIGINT', status: 'ACTIVE', color: '#00e676' },
                { label: 'HUMINT', status: telegram.messages.length > 0 ? 'LIVE' : 'IDLE', color: telegram.messages.length > 0 ? '#00e5ff' : '#666' },
                { label: 'OSINT', status: mergedIntelReports.length > 0 ? 'LIVE' : 'IDLE', color: mergedIntelReports.length > 0 ? '#ffab00' : '#666' },
                { label: 'ELINT', status: 'STANDBY', color: '#b388ff' },
              ].map(sys => (
                <div key={sys.label} className="text-center py-1.5 rounded-md" style={{ background: `${sys.color}06`, border: `1px solid ${sys.color}15` }}>
                  <div className="w-1.5 h-1.5 rounded-full mx-auto mb-0.5" style={{ background: sys.color, boxShadow: `0 0 4px ${sys.color}50` }} />
                  <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 6, fontWeight: 700, color: sys.color, letterSpacing: '0.1em' }}>{sys.label}</div>
                  <div style={{ fontFamily: 'Share Tech Mono', fontSize: 6, color: `${sys.color}88` }}>{sys.status}</div>
                </div>
              ))}
            </div>

            {/* Data Processing Pipeline */}
            <div className="rounded-lg p-2" style={{ background: 'rgba(0,229,255,0.02)', border: '1px solid rgba(0,229,255,0.08)' }}>
              <div style={{ fontFamily: 'Orbitron, monospace', fontSize: 7, fontWeight: 700, color: 'rgba(0,229,255,0.5)', letterSpacing: '0.15em', marginBottom: 6 }}>DATA PIPELINE</div>
              <div className="space-y-1">
                {[
                  { label: 'Telegram Channels', count: telegram.groups.length, total: 50, color: '#00e5ff' },
                  { label: 'Intel Reports', count: mergedIntelReports.length, total: 100, color: '#ff6d00' },
                  { label: 'Emergency Events', count: mergedEmergencyEvents.length, total: 50, color: '#ff1744' },
                  { label: 'OREF Alerts', count: orefAlerts.length, total: 20, color: '#ffd600' },
                ].map(pipe => (
                  <div key={pipe.label} className="flex items-center gap-2">
                    <span style={{ fontFamily: 'Share Tech Mono', fontSize: 7, color: 'rgba(255,255,255,0.4)', width: 90, flexShrink: 0 }}>{pipe.label}</span>
                    <div className="flex-1 h-[3px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, (pipe.count / pipe.total) * 100)}%`, background: `linear-gradient(90deg, ${pipe.color}66, ${pipe.color})`, transition: 'width 0.5s' }} />
                    </div>
                    <span style={{ fontFamily: 'Share Tech Mono', fontSize: 7, fontWeight: 700, color: pipe.color, width: 20, textAlign: 'left' }}>{pipe.count}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Sentiment Trend */}
            <SentimentTrend />

            {/* ═══ TELEGRAM SEVERITY STATUS ═══ */}
            <TgSeveritySummary messages={telegram.messages} groups={telegram.groups} compact lastPoll={telegram.lastPoll} />

            {aiLoading && !aiAssessment && (
              <div className="flex flex-col items-center py-6">
                <div className="w-10 h-10 rounded-full relative mb-2" style={{ border: '1px solid rgba(0,229,255,0.15)' }}>
                  <div className="absolute inset-0 rounded-full border-t animate-spin" style={{ borderColor: 'hsl(185,100%,50%)' }} />
                  <div className="absolute inset-2 rounded-full border-t animate-spin" style={{ borderColor: '#b388ff', animationDirection: 'reverse', animationDuration: '1.5s' }} />
                </div>
                <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 7, color: 'rgba(0,229,255,0.5)', letterSpacing: '0.2em' }}>PROCESSING...</span>
              </div>
            )}

            {aiAssessment && (
              <>
                {/* Threat Assessment */}
                <div className="rounded-lg p-2.5" style={{
                  background: aiAssessment.overall_threat === 'critical' ? 'rgba(255,23,68,0.08)' : aiAssessment.overall_threat === 'high' ? 'rgba(255,109,0,0.08)' : 'rgba(0,230,118,0.06)',
                  border: `1px solid ${aiAssessment.overall_threat === 'critical' ? '#ff174430' : aiAssessment.overall_threat === 'high' ? '#ff6d0030' : '#00e67630'}`,
                }}>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 7, fontWeight: 800, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.15em' }}>THREAT ASSESSMENT</span>
                    <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.05)' }} />
                    <span className="text-[12px]">{aiAssessment.overall_threat === 'critical' ? '🔴' : aiAssessment.overall_threat === 'high' ? '🟠' : aiAssessment.overall_threat === 'elevated' ? '🟡' : '🟢'}</span>
                    <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 14, fontWeight: 900, color: aiAssessment.overall_threat === 'critical' ? '#ff1744' : aiAssessment.overall_threat === 'high' ? '#ff6d00' : '#00e676', textShadow: `0 0 8px ${aiAssessment.overall_threat === 'critical' ? '#ff174466' : aiAssessment.overall_threat === 'high' ? '#ff6d0066' : '#00e67666'}` }}>
                      {aiAssessment.overall_threat === 'critical' ? 'CRITICAL' : aiAssessment.overall_threat === 'high' ? 'HIGH' : aiAssessment.overall_threat === 'elevated' ? 'ELEVATED' : 'NOMINAL'}
                    </span>
                  </div>
                  <p style={{ fontFamily: 'Share Tech Mono', fontSize: 8, color: 'rgba(255,255,255,0.65)', lineHeight: 1.6 }}>{aiAssessment.summary}</p>
                  {aiAssessment.data_points && <span style={{ fontFamily: 'Share Tech Mono', fontSize: 6, color: 'rgba(255,255,255,0.2)', marginTop: 4, display: 'block' }}>{aiAssessment.data_points} data points analyzed</span>}
                </div>

                {/* Fronts Grid */}
                {aiAssessment.fronts?.length > 0 && (
                  <div className="space-y-1">
                    <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 7, color: 'rgba(0,229,255,0.4)', letterSpacing: '0.15em' }}>SECTOR STATUS</span>
                    <div className="grid grid-cols-2 gap-1">
                      {aiAssessment.fronts.map((front: any, i: number) => {
                        const tColor = front.threat_level > 70 ? '#ff1744' : front.threat_level > 40 ? '#ff6d00' : front.threat_level > 20 ? '#ffab00' : '#00e676';
                        return (
                          <div key={i} className="rounded-md p-1.5" style={{ background: `${tColor}06`, border: `1px solid ${tColor}15` }}>
                            <div className="flex items-center justify-between mb-0.5">
                              <span style={{ fontFamily: 'Share Tech Mono', fontSize: 8, fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>{front.name}</span>
                              <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 7, fontWeight: 800, color: tColor }}>{front.threat_level}%</span>
                            </div>
                            <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${front.threat_level}%`, background: tColor }} />
                            </div>
                            <span className={`font-mono text-[6px] mt-0.5 block ${front.trend === 'escalating' ? 'text-red-400' : front.trend === 'de-escalating' ? 'text-green-400' : 'text-yellow-400'}`}>
                              {front.trend === 'escalating' ? '↑ ESCALATING' : front.trend === 'de-escalating' ? '↓ DE-ESCALATING' : '→ STABLE'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Predictions */}
                {aiAssessment.predictions?.length > 0 && (
                  <div className="space-y-1">
                    <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 7, color: 'rgba(179,136,255,0.5)', letterSpacing: '0.15em' }}>PREDICTIVE MODELS</span>
                    {aiAssessment.predictions.map((pred: any, i: number) => (
                      <div key={i} className="rounded-md p-1.5" style={{ background: 'rgba(179,136,255,0.04)', border: '1px solid rgba(179,136,255,0.1)' }}>
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className="text-[7px]">{pred.type === 'military' ? '🎯' : pred.type === 'escalation' ? '⚡' : '🤝'}</span>
                          <span style={{ fontFamily: 'Share Tech Mono', fontSize: 7, color: '#b388ff' }}>{pred.timeframe}</span>
                          <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 7, fontWeight: 800, color: pred.probability > 70 ? '#ff1744' : '#ffab00', marginRight: 'auto' }}>{pred.probability}%</span>
                        </div>
                        <p style={{ fontFamily: 'Share Tech Mono', fontSize: 7, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 }}>{pred.prediction}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Key Actors */}
                {aiAssessment.key_actors?.length > 0 && (
                  <div>
                    <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 7, color: 'rgba(255,109,0,0.5)', letterSpacing: '0.15em' }}>KEY ACTORS</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {aiAssessment.key_actors.map((actor: any, i: number) => (
                        <span key={i} className="flex items-center gap-1 px-1.5 py-0.5 rounded-md" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', fontFamily: 'Share Tech Mono', fontSize: 7 }}>
                          <span>{actor.intent === 'hostile' ? '🔴' : actor.intent === 'supportive' ? '🟢' : '🟡'}</span>
                          <span style={{ color: 'rgba(255,255,255,0.7)', fontWeight: 700 }}>{actor.name}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Recommendations */}
                {aiAssessment.recommendations?.length > 0 && (
                  <div className="rounded-lg p-2" style={{ background: 'rgba(255,171,0,0.04)', border: '1px solid rgba(255,171,0,0.1)' }}>
                    <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 7, color: 'rgba(255,171,0,0.5)', letterSpacing: '0.15em' }}>RECOMMENDATIONS</span>
                    <div className="mt-1 space-y-0.5">
                      {aiAssessment.recommendations.map((rec: string, i: number) => (
                        <div key={i} className="flex items-start gap-1 px-1" style={{ fontFamily: 'Share Tech Mono', fontSize: 7, color: 'rgba(255,255,255,0.55)' }}>
                          <span style={{ color: '#ffab00', flexShrink: 0 }}>▸</span>
                          <span>{rec}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {!aiAssessment && !aiLoading && (
              <div className="flex flex-col items-center py-6">
                <div className="text-2xl opacity-15 mb-2">🛰️</div>
                <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 7, color: 'rgba(0,229,255,0.3)', letterSpacing: '0.15em' }}>AWAITING SCAN COMMAND</span>
              </div>
            )}

            {aiLastUpdate && <div style={{ fontFamily: 'Share Tech Mono', fontSize: 6, color: 'rgba(255,255,255,0.1)', textAlign: 'center', marginTop: 4 }}>Last scan: {aiLastUpdate}</div>}
          </div>
        )}

        {/* ── TAB: INTEL — Combined feed ── */}
        {rightTab === 'intel' && (
        <div className="px-3 py-2">
          {/* ── Category filter chips ── */}
          <div className="flex flex-wrap gap-1 mb-2" dir="rtl">
            {[
              { key: 'all', label: 'הכל', icon: '📋' },
              { key: 'war', label: 'ביטחון', icon: '💥' },
              { key: 'oref', label: 'פיקוד העורף', icon: '🚨' },
              { key: 'diplomatic', label: 'דיפלומטי', icon: '🏛️' },
              { key: 'humanitarian', label: 'הומניטרי', icon: '🤝' },
              { key: 'geopolitical', label: 'גיאופוליטי', icon: '🌍' },
            ].map(f => (
              <button key={f.key}
                onClick={() => setIntelFilterCategory(prev => prev === f.key ? 'all' : f.key)}
                className="font-mono text-[7px] px-1.5 py-0.5 rounded transition-all"
                style={{
                  background: intelFilterCategory === f.key ? 'rgba(0,229,255,0.15)' : 'rgba(255,255,255,0.04)',
                  color: intelFilterCategory === f.key ? '#00e5ff' : 'rgba(255,255,255,0.4)',
                  border: `1px solid ${intelFilterCategory === f.key ? 'rgba(0,229,255,0.3)' : 'rgba(255,255,255,0.08)'}`,
                }}>
                {f.icon} {f.label}
              </button>
            ))}
          </div>

          {/* ═══ ANALYSIS SUMMARIES — War / Cyber / Economy / Geopolitical + Channel Summary ═══ */}
          {(() => {
            // Strict keyword separation per domain
            const warKw = ['שיגור', 'תקיפה', 'יירוט', 'טיל', 'רקטה', 'חיסול', 'כטב', 'כוננות', 'מבצע', 'הפצצה', 'פיגוע', 'מחבל', 'דקירה', 'חדירה', 'צה"ל', 'חיל הים', 'חיל האוויר', 'launch', 'strike', 'missile', 'intercept', 'drone', 'operation', 'IDF', 'Hezbollah', 'Hamas', 'terror', 'attack', 'explosive', 'shooting', 'stabbing', 'infiltration'];
            const cyberKw = ['סייבר', 'האקר', 'פריצה', 'מתקפת סייבר', 'דליפת מידע', 'כופרה', 'פישינג', 'DDoS', 'cyber', 'hack', 'malware', 'ransomware', 'ddos', 'breach', 'phishing', 'CVE', 'CISA', 'vulnerability', 'APT', 'zero-day', 'wiper'];
            const econKw = ['כלכלה', 'שוק ההון', 'בורסה', 'מניות', 'אינפלציה', 'ריבית', 'תמ"ג', 'ייצוא', 'ייבוא', 'סנקציות', 'נפט', 'גז', 'economy', 'market', 'stock', 'inflation', 'interest rate', 'GDP', 'oil', 'sanctions', 'trade'];
            const geoKw = ['גיאופוליטי', 'דיפלומטי', 'או"ם', 'נאט"ו', 'NATO', 'UN', 'הסכם', 'מו"מ', 'שגריר', 'מעצמות', 'ברית', 'geopolit', 'diplomat', 'treaty', 'ceasefire', 'alliance', 'summit', 'G7', 'EU', 'BRICS'];

            // Exclusive matching: each item goes to the FIRST matching category only
            const matchCategory = (text: string): string | null => {
              const t = text.toLowerCase();
              if (cyberKw.some(k => t.includes(k.toLowerCase()))) return 'cyber';
              if (econKw.some(k => t.includes(k.toLowerCase()))) return 'economy';
              if (geoKw.some(k => t.includes(k.toLowerCase()))) return 'geopolitical';
              if (warKw.some(k => t.includes(k.toLowerCase()))) return 'war';
              return null;
            };

            // Categorize intel reports
            const catIntel: Record<string, typeof mergedIntelReports> = { war: [], cyber: [], economy: [], geopolitical: [] };
            for (const r of mergedIntelReports) {
              const cat = matchCategory(`${r.title} ${r.summary} ${r.category || ''}`);
              if (cat && catIntel[cat]) catIntel[cat].push(r);
            }

            // Categorize TG messages
            const catTg: Record<string, typeof telegram.messages> = { war: [], cyber: [], economy: [], geopolitical: [] };
            for (const m of telegram.messages.filter(m => m.text && !m.is_duplicate)) {
              const cat = matchCategory(m.text!);
              if (cat && catTg[cat]) catTg[cat].push(m);
            }

            const getLevel = (c: number) => c >= 8 ? { label: 'קריטי', color: '#ff1744', bg: 'rgba(255,23,68,0.12)' } : c >= 4 ? { label: 'גבוה', color: '#ff6d00', bg: 'rgba(255,109,0,0.1)' } : c >= 1 ? { label: 'בינוני', color: '#ffab00', bg: 'rgba(255,171,0,0.08)' } : { label: 'נמוך', color: '#00e676', bg: 'rgba(0,230,118,0.06)' };

            const analyses = [
              { id: 'war', icon: '⚔️', title: 'ניתוח מלחמה וביטחון', reports: catIntel.war.slice(0, 5), tgMsgs: catTg.war.slice(0, 3) },
              { id: 'cyber', icon: '🖥️', title: 'ניתוח סייבר', reports: catIntel.cyber.slice(0, 5), tgMsgs: catTg.cyber.slice(0, 3) },
              { id: 'economy', icon: '📊', title: 'ניתוח כלכלה', reports: catIntel.economy.slice(0, 5), tgMsgs: catTg.economy.slice(0, 3) },
              { id: 'geopolitical', icon: '🌍', title: 'ניתוח גיאופוליטי', reports: catIntel.geopolitical.slice(0, 5), tgMsgs: catTg.geopolitical.slice(0, 3) },
            ].map(a => ({ ...a, count: a.reports.length + a.tgMsgs.length, level: getLevel(a.reports.length + a.tgMsgs.length) }));

            // Channel summary — group all TG by channel (no hooks inside IIFE)
            const channelSummary = (() => {
              const byChannel: Record<string, { title: string; count: number; latestText: string; severity: string }> = {};
              for (const m of telegram.messages.filter(m => m.text && !m.is_duplicate)) {
                const group = telegram.groups.find(g => g.chat_id === m.chat_id);
                const name = group?.title || `ערוץ ${m.chat_id}`;
                if (!byChannel[name]) byChannel[name] = { title: name, count: 0, latestText: '', severity: 'low' };
                byChannel[name].count++;
                if (!byChannel[name].latestText) byChannel[name].latestText = m.text!.slice(0, 80);
                if (m.severity === 'critical' || (m.severity === 'high' && byChannel[name].severity !== 'critical')) byChannel[name].severity = m.severity;
              }
              return Object.values(byChannel).sort((a, b) => b.count - a.count);
            })();

            return (
              <div className="space-y-1.5 mb-3" dir="rtl">
                {analyses.map(a => (
                  <div key={a.id} className="rounded-sm overflow-hidden cursor-pointer transition-all hover:brightness-110"
                    style={{ background: a.level.bg, border: `1px solid ${a.level.color}30` }}
                    onClick={() => setExpandedIntelId(expandedIntelId === `analysis-${a.id}` ? null : `analysis-${a.id}`)}>
                    <div className="flex items-center gap-1.5 px-2 py-1.5">
                      <span style={{ fontSize: 11 }}>{a.icon}</span>
                      <span className="font-mono text-[9px] font-bold text-white/90 flex-1">{a.title}</span>
                      <span className="font-mono text-[7px] px-1.5 py-0.5 rounded-sm font-bold" style={{ background: `${a.level.color}25`, color: a.level.color }}>{a.level.label}</span>
                      <span className="font-mono text-[7px] text-white/40">{a.count} פריטים</span>
                      <span className="text-[7px] text-white/30">{expandedIntelId === `analysis-${a.id}` ? '▲' : '▼'}</span>
                    </div>
                    {expandedIntelId === `analysis-${a.id}` && (
                      <div className="px-2 pb-2 border-t border-white/5 space-y-1">
                        {a.reports.length > 0 && (
                          <div className="mt-1">
                            <span className="font-mono text-[7px] text-white/40 block mb-0.5">📋 דוחות מודיעין:</span>
                            {a.reports.map((r: any, i: number) => (
                              <div key={i} className="font-mono text-[8px] text-white/70 leading-relaxed mb-0.5">• {r.title} — <span className="text-white/40">{r.summary?.slice(0, 60)}</span></div>
                            ))}
                          </div>
                        )}
                        {a.tgMsgs.length > 0 && (
                          <div>
                            <span className="font-mono text-[7px] text-white/40 block mb-0.5">📱 טלגרם:</span>
                            {a.tgMsgs.map((m: any, i: number) => (
                              <div key={i} className="font-mono text-[8px] text-white/60 truncate leading-relaxed">• {m.text?.slice(0, 80)}</div>
                            ))}
                          </div>
                        )}
                        {a.reports.length === 0 && a.tgMsgs.length === 0 && (
                          <div className="font-mono text-[8px] text-white/40 mt-1">אין דיווחים רלוונטיים כרגע</div>
                        )}
                        <div className="font-mono text-[6px] text-white/25 mt-1 pt-1 border-t border-white/5">
                          מקורות: {a.reports.length} דוחות, {a.tgMsgs.length} הודעות TG — עדכון {new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    )}
                  </div>
                ))}

                {/* ── Channel Summary ── */}
                <div className="rounded-sm overflow-hidden cursor-pointer transition-all hover:brightness-110"
                  style={{ background: 'rgba(0,229,255,0.04)', border: '1px solid rgba(0,229,255,0.12)' }}
                  onClick={() => setExpandedIntelId(expandedIntelId === 'analysis-channels' ? null : 'analysis-channels')}>
                  <div className="flex items-center gap-1.5 px-2 py-1.5">
                    <span style={{ fontSize: 11 }}>📡</span>
                    <span className="font-mono text-[9px] font-bold text-white/90 flex-1">סיכום ערוצים</span>
                    <span className="font-mono text-[7px] text-white/40">{channelSummary.length} ערוצים</span>
                    <span className="text-[7px] text-white/30">{expandedIntelId === 'analysis-channels' ? '▲' : '▼'}</span>
                  </div>
                  {expandedIntelId === 'analysis-channels' && (
                    <div className="px-2 pb-2 border-t border-white/5 space-y-1 mt-1">
                      {channelSummary.slice(0, 8).map((ch, i) => (
                        <div key={i} className="flex items-start gap-1.5 rounded-sm px-1.5 py-1" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                          <span className="font-mono text-[7px] font-bold text-white/60 shrink-0">📡 {ch.title}</span>
                          <span className="font-mono text-[7px] text-white/30 shrink-0">{ch.count}</span>
                          <span className="font-mono text-[7px] text-white/40 truncate flex-1">{ch.latestText}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {/* ═══ TELEGRAM SEVERITY STATUS — across all tabs ═══ */}
          <TgSeveritySummary messages={telegram.messages} groups={telegram.groups} compact lastPoll={telegram.lastPoll} />

          {/* ═══ SITUATION STATUS BANNER (merged from NEWS) ═══ */}
          {(() => {
            const allText = [...mergedIntelReports.map(r => r.title + ' ' + r.summary), ...telegram.messages.filter(m => m.text).map(m => m.text!)].join(' ');
            const milKeywords = ['שיגור', 'תקיפה', 'חיסול', 'כוננות', 'גיוס', 'מבצע', 'הפצצה', 'צבא', 'launch', 'strike', 'troops', 'military', 'missile'];
            const diploKeywords = ['הצהרה', 'קבינט', 'מועצת ביטחון', 'הסכם', 'סנקציות', 'UN', 'ceasefire', 'diplomatic'];
            const terrorKeywords = ['פיגוע', 'מחבל', 'דקירה', 'ירי', 'חטיפה', 'terror', 'attack'];
            const countMatches = (kws: string[]) => kws.reduce((a, k) => a + (allText.toLowerCase().includes(k.toLowerCase()) ? 1 : 0), 0);
            const milCount = countMatches(milKeywords);
            const diploCount = countMatches(diploKeywords);
            const terrorCount = countMatches(terrorKeywords);
            let label = '🟢 שגרה', color = '#00e676', detail = 'אין אירועים חריגים';
            const criticalCount = mergedIntelReports.filter(r => r.severity === 'critical').length;
            if (criticalCount > 3 || terrorCount > 2 || milCount > 5) { label = '🔴 אירוע מבצעי'; color = '#ff1744'; detail = 'זוהה ריכוז אירועים ביטחוניים'; }
            else if (criticalCount > 0 || milCount > 2) { label = '🟠 כוננות מוגברת'; color = '#ff6d00'; detail = 'ניטור אירועים ביטחוניים'; }
            else if (diploCount > 2) { label = '🔵 תנודה מדינית'; color = '#2196f3'; detail = 'פעילות דיפלומטית מוגברת'; }
            return (
              <div className="p-2 rounded-lg" style={{ background: `${color}08`, border: `1px solid ${color}20` }}>
                <div className="flex items-center gap-2 mb-1">
                  <span style={{ fontFamily: 'Share Tech Mono', fontSize: 10, fontWeight: 900, color }}>{label}</span>
                  <span style={{ fontFamily: 'Share Tech Mono', fontSize: 7, color: 'rgba(255,255,255,0.3)', marginRight: 'auto' }}>{mergedIntelReports.length} מקורות • {telegram.messages.filter(m => !m.is_duplicate).length} TG</span>
                </div>
                <div style={{ fontFamily: 'Share Tech Mono', fontSize: 8, color: 'rgba(255,255,255,0.5)' }}>{detail}</div>
                <div className="flex gap-1 mt-1.5">
                  {[
                    { l: '⚔ צבאי', c: milCount, cl: '#ff5252' },
                    { l: '🏛 מדיני', c: diploCount, cl: '#2196f3' },
                    { l: '💥 טרור', c: terrorCount, cl: '#ff6d00' },
                  ].filter(s => s.c > 0).map(s => (
                    <span key={s.l} style={{ fontFamily: 'Share Tech Mono', fontSize: 7, padding: '2px 6px', borderRadius: 3, background: `${s.cl}12`, color: `${s.cl}cc`, border: `1px solid ${s.cl}20` }}>{s.l}: <strong>{s.c}</strong></span>
                  ))}
                </div>
              </div>
            );
          })()}

          {/* ═══ SOURCE VOLUME BAR (merged from NEWS) ═══ */}
          {(() => {
            const sourceCounts: Record<string, { total: number; critical: number }> = {};
            mergedIntelReports.forEach(r => {
              const src = r.source || 'unknown';
              if (!sourceCounts[src]) sourceCounts[src] = { total: 0, critical: 0 };
              sourceCounts[src].total++;
              if (r.severity === 'critical' || r.severity === 'high') sourceCounts[src].critical++;
            });
            const sorted = Object.entries(sourceCounts).sort((a, b) => b[1].total - a[1].total).slice(0, 6);
            if (sorted.length === 0) return null;
            const maxCount = Math.max(...sorted.map(s => s[1].total));
            return (
              <div className="p-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontFamily: 'Share Tech Mono', fontSize: 8, fontWeight: 700, color: 'rgba(0,229,255,0.5)', letterSpacing: '0.1em', marginBottom: 6 }}>📊 מקורות — נפח + חומרה</div>
                <div className="space-y-1">
                  {sorted.map(([src, data]) => {
                    const pct = (data.total / maxCount) * 100;
                    const critPct = data.total > 0 ? (data.critical / data.total) * 100 : 0;
                    const barColor = critPct > 50 ? '#ff1744' : critPct > 20 ? '#ff6d00' : '#00e5ff';
                    return (
                      <div key={src} className="flex items-center gap-2">
                        <span style={{ fontFamily: 'Share Tech Mono', fontSize: 7, color: 'rgba(255,255,255,0.45)', width: 70, flexShrink: 0, textAlign: 'right' }}>{src.replace('news_', '')}</span>
                        <div className="flex-1 h-[4px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor, transition: 'width 0.5s' }} />
                        </div>
                        <span style={{ fontFamily: 'Share Tech Mono', fontSize: 8, fontWeight: 700, color: barColor, width: 20, textAlign: 'left' }}>{data.total}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {satAlert && (
            <div className="rounded-sm overflow-hidden mb-2" dir="rtl"
              style={{
                background: `linear-gradient(135deg, ${satAlert.region === 'איראן' ? 'rgba(255,23,68,0.2)' : 'rgba(230,81,0,0.2)'}, rgba(0,0,0,0.7))`,
                border: `1px solid ${satAlert.region === 'איראן' ? 'rgba(255,23,68,0.5)' : 'rgba(230,81,0,0.5)'}`,
                boxShadow: `0 2px 8px ${satAlert.region === 'איראן' ? 'rgba(255,23,68,0.2)' : 'rgba(230,81,0,0.2)'}`,
                padding: '6px 8px',
                animation: 'fade-in 0.3s ease-out',
              }}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span style={{ fontSize: '10px' }}>🛰️</span>
                  <span className="font-mono text-[9px] font-bold" style={{ color: satAlert.region === 'איראן' ? '#ff1744' : '#e65100', letterSpacing: '1px' }}>
                    פעילות חריגה ב{satAlert.region}
                  </span>
                </div>
                <button onClick={() => setSatAlert(null)} className="text-white/40 hover:text-white/80 text-[9px] p-0.5">✕</button>
              </div>
              <div className="font-mono text-[8px] text-amber-400 mb-0.5">{satAlert.type}</div>
              <div className="font-mono text-[7px] text-white/60 leading-relaxed">{satAlert.details}</div>
              <div className="flex items-center gap-1 mt-1 pt-1 border-t border-white/10">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: satAlert.region === 'איראן' ? '#ff1744' : '#e65100', animation: 'pulse 1.5s infinite' }} />
                <span className="font-mono text-[7px] text-white/40">
                  בדיקה אחרונה — {lastSatelliteCheckAt ? new Date(lastSatelliteCheckAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : 'לא זמין'}
                </span>
              </div>
            </div>
          )}

          {/* ═══ GAS PLATFORM PROXIMITY ALERT ═══ */}
          {gasProximityAlerts.length > 0 && showMaritime && (
            <div className="rounded-sm overflow-hidden mb-2" dir="rtl"
              style={{
                background: 'linear-gradient(135deg, rgba(255,23,68,0.25), rgba(0,0,0,0.8))',
                border: '1px solid rgba(255,23,68,0.6)',
                boxShadow: '0 2px 12px rgba(255,23,68,0.3)',
                padding: '6px 8px',
                animation: 'fade-in 0.3s ease-out',
              }}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <span style={{ fontSize: '10px' }}>🚨</span>
                  <span className="font-mono text-[9px] font-bold" style={{ color: '#ff1744', letterSpacing: '1px' }}>
                    איום ימי — קרבה לאסדות גז
                  </span>
                </div>
                <button onClick={() => setGasProximityAlerts([])} className="text-white/40 hover:text-white/80 text-[9px] p-0.5">✕</button>
              </div>
              {gasProximityAlerts.slice(0, 3).map((alert, i) => (
                <div key={i} className="font-mono text-[8px] text-white/80 leading-relaxed flex items-center gap-1 mb-0.5">
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: '#ff1744', animation: 'pulse 1s infinite' }} />
                  <span style={{ color: '#ff8a80' }}>{alert.vesselName}</span>
                  <span style={{ color: '#78909c' }}>→</span>
                  <span style={{ color: '#ffab00' }}>{alert.platformName}</span>
                  <span style={{ color: '#ef9a9a' }}>({alert.distKm} ק"מ)</span>
                  <span style={{ color: '#546e7a' }}>{alert.time}</span>
                </div>
              ))}
              <div className="flex items-center gap-1 mt-1 pt-1 border-t border-white/10">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#ff1744', animation: 'pulse 1s infinite' }} />
                <span className="font-mono text-[7px] text-white/40">MARITIME THREAT PROXIMITY — חיל הים</span>
              </div>
            </div>
          )}

          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
            {(() => {
              // ── Smart cross-language dedup: normalize HE+EN, strip filler words ──
              const normalizeForDedup = (text: string) => {
                // Transliteration map for common HE↔EN equivalents
                const heToEn: Record<string, string> = {
                  'תאונה': 'accident', 'כביש': 'highway', 'שריפה': 'fire', 'פיצוץ': 'explosion',
                  'ירי': 'shooting', 'רקטה': 'rocket', 'טיל': 'missile', 'פיגוע': 'attack',
                  'תקיפה': 'strike', 'יירוט': 'intercept', 'אזעקה': 'alert', 'פצועים': 'injured',
                  'הרוגים': 'killed', 'צבא': 'army', 'חיל אוויר': 'airforce', 'חיזבאללה': 'hezbollah',
                  'חמאס': 'hamas', 'איראן': 'iran', 'לבנון': 'lebanon', 'עזה': 'gaza',
                };
                let normalized = text.toLowerCase().replace(/[\s\-_.,!?:;()\[\]{}#@"']/g, '');
                // Remove numbers
                normalized = normalized.replace(/[0-9٠-٩]/g, '');
                // Apply HE→EN mapping for cross-language dedup
                for (const [he, en] of Object.entries(heToEn)) {
                  normalized = normalized.replace(new RegExp(he, 'g'), en);
                }
                return normalized.slice(0, 40);
              };

              // Build unified feed sorted newest first
              const feedItems: { type: 'intel' | 'telegram' | 'emergency'; date: number; data: any; id: string }[] = [];
              const globalSeen = new Set<string>();
              
              // Deduplicate intel — keep only latest per normalized title
              const dedupeIntel = mergedIntelReports.filter(r => {
                const key = normalizeForDedup(r.title);
                if (globalSeen.has(key)) return false;
                globalSeen.add(key);
                return true;
              });
              
              dedupeIntel.slice(0, 15).forEach(r => feedItems.push({ type: 'intel', date: new Date(r.created_at).getTime(), data: r, id: `intel-${r.id}` }));
              
              // Deduplicate telegram by normalized content — expire from feed after 20 min
              const tgFeedMaxAge = 20 * 60 * 1000;
              telegram.messages.filter(msg => {
                if (!msg.text || msg.is_duplicate) return false;
                const msgTime = msg.message_date ? new Date(msg.message_date).getTime() : new Date(msg.created_at).getTime();
                if (Date.now() - msgTime > tgFeedMaxAge) return false;
                const key = normalizeForDedup(msg.text);
                if (globalSeen.has(key)) return false;
                globalSeen.add(key);
                return true;
              }).slice(0, 12).forEach(m => feedItems.push({ type: 'telegram', date: m.message_date ? new Date(m.message_date).getTime() : new Date(m.created_at).getTime(), data: m, id: `tg-${m.id}` }));
              
              // Deduplicate emergency events by title+location
              mergedEmergencyEvents.filter(e => {
                const key = normalizeForDedup((e.title || '') + (e.location || ''));
                if (globalSeen.has(key)) return false;
                globalSeen.add(key);
                return true;
              }).slice(0, 8).forEach(e => feedItems.push({ type: 'emergency', date: e.event_time ? new Date(e.event_time).getTime() : new Date(e.created_at).getTime(), data: e, id: `ee-${e.id}` }));
              
              feedItems.sort((a, b) => b.date - a.date);

              // Classify event type for color-coding
              const classifyText = (text: string): { type: string; icon: string; borderColor: string; bgColor: string; label: string } => {
                // Try MDA catalog first
                const mdaType = classifyMdaEvent(text);
                if (mdaType) {
                  return {
                    type: mdaType.category,
                    icon: mdaType.emoji,
                    borderColor: mdaType.color,
                    bgColor: `${mdaType.color}15`,
                    label: mdaType.labelHe.slice(0, 20),
                  };
                }
                // Fallback regex
                const t = text.toLowerCase();
                if (/תאונה|רכב|כביש|תנועה|פקקים/.test(t)) return { type: 'traffic', icon: '🚗', borderColor: '#ffffff', bgColor: 'rgba(255,255,255,0.06)', label: 'תנועה' };
                if (/שריפה|אש|דליקה|כיבוי|לכודים/.test(t)) return { type: 'fire', icon: '🔥', borderColor: '#ff9800', bgColor: 'rgba(255,152,0,0.08)', label: 'כיבוי אש' };
                if (/תקיפה|אזעקה|יירוט|טיל|נפילה|שיגור|כטב|רקטה|מלחמה|צבא|חיל/.test(t)) return { type: 'war', icon: '💥', borderColor: '#ff1744', bgColor: 'rgba(255,23,68,0.1)', label: 'ביטחון' };
                if (/משטרה|ירי|קטטה|פיגוע|חשוד|שוד/.test(t)) return { type: 'police', icon: '🚔', borderColor: '#2196f3', bgColor: 'rgba(33,150,243,0.08)', label: 'משטרה' };
                if (/אמבולנס|מד.א|פצוע|נפגע|החייאה/.test(t)) return { type: 'mda', icon: '🚑', borderColor: '#ff1744', bgColor: 'rgba(255,23,68,0.06)', label: 'מד"א' };
                if (/פיקוד העורף|מרחב מוגן|מקלט|אזעקה|התרעה|צבע אדום/.test(t)) return { type: 'oref', icon: '🚨', borderColor: '#ff6d00', bgColor: 'rgba(255,109,0,0.08)', label: 'פיקוד העורף' };
                if (/דיפלומט|שגריר|או"ם|אמנה|הסכם|שיחות|מו"מ|diplomat|un |treaty|ceasefire/.test(t)) return { type: 'diplomatic', icon: '🏛️', borderColor: '#7c4dff', bgColor: 'rgba(124,77,255,0.08)', label: 'דיפלומטי' };
                if (/הומניטר|סיוע|פליטים|עקורים|humanitarian|aid|refugee/.test(t)) return { type: 'humanitarian', icon: '🤝', borderColor: '#00bfa5', bgColor: 'rgba(0,191,165,0.08)', label: 'הומניטרי' };
                if (/גיאו.?פוליטי|geopolit|sanctions|סנקציות|מעצמות|אסטרטגי/.test(t)) return { type: 'geopolitical', icon: '🌍', borderColor: '#ff9100', bgColor: 'rgba(255,145,0,0.08)', label: 'גיאופוליטי' };
                return { type: 'general', icon: '📋', borderColor: '#666', bgColor: 'rgba(100,100,100,0.05)', label: 'כללי' };
              };

              // Apply category filter
              const classifyItem = (item: typeof feedItems[0]) => {
                const text = item.type === 'intel' ? (item.data.title + ' ' + (item.data.summary || '') + ' ' + (item.data.category || '')) :
                  item.type === 'telegram' ? (item.data.text || '') :
                  (item.data.title + ' ' + (item.data.description || ''));
                return classifyText(text);
              };

              const filteredItems = intelFilterCategory === 'all' ? feedItems :
                feedItems.filter(item => {
                  const cls = classifyItem(item);
                  // Also check intel report category field for geopolitical/humanitarian/diplomatic
                  if (item.type === 'intel') {
                    const cat = (item.data.category || '').toLowerCase();
                    if (intelFilterCategory === 'geopolitical' && cat === 'geopolitical') return true;
                    if (intelFilterCategory === 'humanitarian' && cat === 'humanitarian') return true;
                    if (intelFilterCategory === 'diplomatic' && cat === 'diplomatic') return true;
                  }
                  return cls.type === intelFilterCategory;
                });
              
              return filteredItems.slice(0, 20).map((item) => {
                const ageMins = Math.floor((Date.now() - item.date) / 60000);
                const timeLabel = ageMins < 1 ? 'עכשיו' : ageMins < 60 ? `${ageMins}m` : `${Math.floor(ageMins / 60)}h`;
                const isExpanded = expandedIntelId === item.id;

                if (item.type === 'intel') {
                  const report = item.data;
                  const sevColor = SEVERITY_COLORS[report.severity]?.color || '#666';
                  const isCentcom = report.source === 'centcom';
                  const isNato = report.source === 'nato';
                  const isCrossCorrelation = report.source === 'cross_correlation';
                  const badgeLabel = isCentcom ? '🇺🇸' : isNato ? '🏛️' : isCrossCorrelation ? '🔗' : '📋';
                  const borderColor = isCentcom ? '#3b82f6' : isNato ? '#6366f1' : isCrossCorrelation ? '#f59e0b' : sevColor;
                  const cls = classifyText(report.title + ' ' + (report.summary || ''));
                  return (
                    <div key={item.id} className="rounded cursor-pointer transition-all hover:brightness-125" 
                      style={{ borderRight: `4px solid ${cls.borderColor}`, borderTop: `1px solid ${borderColor}22`, borderBottom: `1px solid ${borderColor}22`, borderLeft: `1px solid ${borderColor}22`, background: cls.bgColor }}
                      onClick={() => setExpandedIntelId(isExpanded ? null : item.id)}>
                      <div className="flex items-center gap-1.5 px-2 py-1.5">
                        <span className="text-[10px]">{cls.icon}</span>
                        <span className="text-[8px]">{badgeLabel}</span>
                        <span className="font-mono text-[9px] font-bold text-white/90 truncate flex-1">{getHebrewTitle(report.title)}</span>
                        <span className="font-mono text-[6px] px-1 py-px rounded-sm" style={{ background: `${cls.borderColor}20`, color: cls.borderColor }}>{cls.label}</span>
                        <span className="font-mono text-[7px] text-white/40 shrink-0">{timeLabel}</span>
                        <span className="text-[8px] text-white/30">{isExpanded ? '▲' : '▼'}</span>
                      </div>
                      {isExpanded && (
                        <div className="px-2 pb-2 border-t border-white/5">
                          <p className="font-mono text-[10px] text-white/80 mt-1.5 whitespace-pre-wrap leading-relaxed" style={{ maxHeight: '200px', overflowY: 'auto' }}>{getHebrewTitle(report.summary)}</p>
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                            <span className="text-[7px] font-bold" style={{ color: `${sevColor}cc` }}>{report.severity}</span>
                            {report.category && <span className="font-mono text-[7px] px-1 py-px rounded-sm" style={{ background: 'rgba(0,229,255,0.1)', color: '#00e5ff' }}>{report.category}</span>}
                            {report.region && <span className="font-mono text-[7px] text-white/30">📍 {report.region}</span>}
                            {report.tags?.slice(0, 3).map((tag: string) => (
                              <span key={tag} className="font-mono text-[7px] text-white/40">#{tag}</span>
                            ))}
                            <span className="font-mono text-[6px] text-white/25">{report.source}</span>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                }

                if (item.type === 'telegram') {
                  const msg = item.data;
                  const cls = classifyText(msg.text || '');
                  return (
                    <div key={item.id} className="rounded cursor-pointer transition-all hover:brightness-125" 
                      style={{ borderRight: `3px solid ${cls.borderColor}`, borderTop: '1px solid #00e5ff10', borderBottom: '1px solid #00e5ff10', borderLeft: '1px solid #00e5ff10', background: cls.bgColor }}
                      onClick={() => setExpandedIntelId(isExpanded ? null : item.id)}>
                      <div className="flex items-center gap-1 px-1.5 py-1">
                        <span className="text-[8px]">{cls.icon}</span>
                        <span className="font-mono text-[8px] font-bold text-white/85 truncate flex-1">{msg.text?.slice(0, 40)}</span>
                        <span className="font-mono text-[5px] px-0.5 py-px rounded-sm" style={{ background: `${cls.borderColor}20`, color: cls.borderColor }}>{cls.label}</span>
                        <span className="font-mono text-[6px] text-white/35 shrink-0">{timeLabel}</span>
                      </div>
                      {isExpanded && (
                        <div className="px-1.5 pb-1.5 border-t border-white/5">
                          <p className="font-mono text-[9px] text-white/70 mt-1 whitespace-pre-wrap leading-relaxed">{msg.text}</p>
                          {msg.sender_name && <span className="font-mono text-[6px] text-white/35 block mt-0.5">{msg.sender_name}</span>}
                        </div>
                      )}
                    </div>
                  );
                }

                // emergency
                const evt = item.data;
                const isFire = evt.source?.includes('fire');
                const cls = classifyText(evt.title + ' ' + (evt.description || '') + ' ' + (evt.source || ''));
                const evtIcon = isFire ? '🔥' : '🚑';
                return (
                  <div key={item.id} className="rounded cursor-pointer transition-all hover:brightness-125" 
                    style={{ borderRight: `4px solid ${isFire ? '#ff9800' : '#ff1744'}`, borderTop: `1px solid ${isFire ? '#ff980022' : '#ff174422'}`, borderBottom: `1px solid ${isFire ? '#ff980022' : '#ff174422'}`, borderLeft: `1px solid ${isFire ? '#ff980022' : '#ff174422'}`, background: isFire ? 'rgba(255,152,0,0.08)' : 'rgba(255,23,68,0.06)' }}
                    onClick={() => setExpandedIntelId(isExpanded ? null : item.id)}>
                    <div className="flex items-center gap-1.5 px-2 py-1.5">
                      <span className="text-[10px]">{evtIcon}</span>
                      <span className="font-mono text-[9px] font-bold text-white/90 truncate flex-1">{evt.title}</span>
                      <span className="font-mono text-[6px] px-1 py-px rounded-sm" style={{ background: isFire ? 'rgba(255,152,0,0.2)' : 'rgba(255,23,68,0.2)', color: isFire ? '#ff9800' : '#ff1744' }}>{isFire ? 'כיבוי' : 'מד"א'}</span>
                      <span className="font-mono text-[7px] text-white/40 shrink-0">{timeLabel}</span>
                      <span className="text-[8px] text-white/30">{isExpanded ? '▲' : '▼'}</span>
                    </div>
                    {isExpanded && (
                      <div className="px-2 pb-2 border-t border-white/5">
                        {evt.description && <p className="font-mono text-[10px] text-white/75 mt-1.5 leading-relaxed">{evt.description}</p>}
                        {evt.location && <span className="font-mono text-[7px] text-white/40 block mt-1">📍 {evt.location}</span>}
                      </div>
                    )}
                  </div>
                );
              });
            })()}

            {mergedIntelReports.length === 0 && telegram.messages.length === 0 && mergedEmergencyEvents.length === 0 && (
              <div className="text-center py-3">
                <span className="text-lg opacity-30">📋</span>
                <p className="font-mono text-[8px] text-white/40 mt-1">{intelFilterCategory !== 'all' ? `אין הודעות בקטגוריה זו` : 'אין מידע מודיעיני'}</p>
                {intelFilterCategory !== 'all' && (
                  <button onClick={() => setIntelFilterCategory('all')} className="font-mono text-[8px] mt-1 px-2 py-0.5 rounded" style={{ color: '#00e5ff', background: 'rgba(0,229,255,0.1)' }}>הצג הכל</button>
                )}
              </div>
            )}
          </div>
        </div>
        )}

        {/* ── TAB: EVENTS — ריכוז כוחות ביטחון ואירועים ── */}
        {rightTab === 'events' && (
          <div className="px-3 py-2 space-y-2 max-h-[60vh] overflow-y-auto" dir="rtl">
            {/* Summary header */}
            {(() => {
              const verifiedCount = mciEvents.filter(e => e.severity !== 'verified').length;
              const totalCount = mciEvents.length;
              const activeEmergency = mergedEmergencyEvents.length;
              const statusColor = verifiedCount > 0 ? '#ff1744' : totalCount > 0 ? '#ff6d00' : '#00e676';
              const statusLabel = verifiedCount > 0 ? '🔴 אירועים מאומתים פעילים' : totalCount > 0 ? '🟠 אירועים בניטור' : '🟢 שגרה — אין אירועים חריגים';
              return (
                <div className="p-2 rounded-lg" style={{ background: `${statusColor}08`, border: `1px solid ${statusColor}25` }}>
                  <div style={{ fontFamily: 'Orbitron', fontSize: 9, fontWeight: 700, color: statusColor, letterSpacing: '0.05em' }}>
                    {statusLabel}
                  </div>
                  <div className="flex gap-3 mt-1">
                    <span style={{ fontFamily: 'Share Tech Mono', fontSize: 8, color: 'rgba(255,255,255,0.5)' }}>🎯 {totalCount} אירועים מאומתים</span>
                    <span style={{ fontFamily: 'Share Tech Mono', fontSize: 8, color: 'rgba(255,255,255,0.5)' }}>🚨 {activeEmergency} אירועי חירום</span>
                  </div>
                </div>
              );
            })()}

            {/* MCI / cross-verified events */}
            {mciEvents.length > 0 ? mciEvents.map((evt, idx) => {
              const sevColor = evt.severity === 'mci' ? '#ff1744' : evt.severity === 'combined' ? '#ff6d00' : '#ffab00';
              const sevLabel = evt.severity === 'mci' ? 'רב-נפגעים' : evt.severity === 'combined' ? 'מאומת (3+ מקורות)' : 'מאומת (2 מקורות)';
              const sevIcon = evt.severity === 'mci' ? '🔴' : evt.severity === 'combined' ? '🟠' : '🟡';
              const ago = Math.round((Date.now() - evt.newestTime) / 60000);
              return (
                <div key={`mci-${idx}`} className="p-2 rounded-lg" style={{ background: `${sevColor}08`, border: `1px solid ${sevColor}20` }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span style={{ fontSize: 12 }}>{sevIcon}</span>
                      <span style={{ fontFamily: 'Share Tech Mono', fontSize: 10, fontWeight: 700, color: sevColor }}>{evt.city}</span>
                    </div>
                    <span style={{ fontFamily: 'Share Tech Mono', fontSize: 7, color: 'rgba(255,255,255,0.4)' }}>לפני {ago} דק׳</span>
                  </div>
                  <div style={{ fontFamily: 'Share Tech Mono', fontSize: 7, color: sevColor, marginTop: 2 }}>{sevLabel}</div>
                  <div className="mt-1.5 space-y-1">
                    {evt.sources.map((s, si) => (
                      <div key={si} className="flex items-start gap-1.5" style={{ borderRight: `2px solid ${sevColor}40`, paddingRight: 6 }}>
                        <span style={{ fontSize: 10, flexShrink: 0 }}>{s.icon}</span>
                        <div>
                          <span style={{ fontFamily: 'Share Tech Mono', fontSize: 7, color: 'rgba(255,255,255,0.7)', display: 'block', lineHeight: 1.3 }}>{s.title}</span>
                          <span style={{ fontFamily: 'Share Tech Mono', fontSize: 6, color: 'rgba(255,255,255,0.3)' }}>
                            {s.type === 'oref' ? 'פיקוד העורף' : s.type === 'mda' ? 'מד"א' : s.type === 'fire' ? 'כיבוי אש' : s.type === 'telegram' ? 'טלגרם' : s.type === 'police' ? 'משטרה' : s.type === 'oref_tg' ? 'טלגרם/התרעה' : s.type === 'mda_tg' ? 'טלגרם/מד"א' : s.type === 'fire_tg' ? 'טלגרם/כיבוי' : s.type === 'strategic' ? 'אסטרטגי' : s.type === 'cyber' ? 'סייבר' : s.type === 'military_mov' ? 'תנועה צבאית' : s.type}
                            {' · '}{new Date(s.time).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            }) : (
              <div className="text-center py-4">
                <span className="text-2xl opacity-20">✅</span>
                <p style={{ fontFamily: 'Share Tech Mono', fontSize: 8, color: 'rgba(255,255,255,0.4)', marginTop: 4 }}>אין אירועים מאומתים ממספר מקורות</p>
              </div>
            )}

            {/* Recent emergency events (single-source, for context) */}
            {mergedEmergencyEvents.length > 0 && (
              <div>
                <div style={{ fontFamily: 'Share Tech Mono', fontSize: 8, fontWeight: 700, color: 'rgba(0,229,255,0.5)', letterSpacing: '0.1em', marginBottom: 4 }}>📡 אירועי חירום אחרונים (מקור יחיד)</div>
                <div className="space-y-1">
                  {mergedEmergencyEvents.slice(0, 15).map((evt: any, idx: number) => {
                    const svc = getEmergencyEventService(evt);
                    const svcIcon = svc === 'mda' ? '🚑' : svc === 'fire' ? '🔥' : svc === 'police' ? '🚔' : '⚠️';
                    const evtColor = evt.color === 'red' ? '#ff1744' : evt.color === 'orange' ? '#ff6d00' : '#888';
                    return (
                      <div key={evt.id || idx} className="flex items-start gap-1.5 py-1" style={{ borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                        <span style={{ fontSize: 10, flexShrink: 0 }}>{svcIcon}</span>
                        <div className="flex-1 min-w-0">
                          <span style={{ fontFamily: 'Share Tech Mono', fontSize: 8, color: evtColor, fontWeight: 600, display: 'block' }}>{evt.title}</span>
                          {evt.description && <span style={{ fontFamily: 'Share Tech Mono', fontSize: 7, color: 'rgba(255,255,255,0.4)', display: 'block' }}>{evt.description}</span>}
                          <span style={{ fontFamily: 'Share Tech Mono', fontSize: 6, color: 'rgba(255,255,255,0.25)' }}>
                            {evt.location || ''} · {evt.event_time ? new Date(evt.event_time).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : ''}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── TAB: MKT — Market Trend Analysis + Security Correlation ── */}
        {rightTab === 'stocks' && (
          <div className="px-3 py-2 space-y-2 max-h-[60vh] overflow-y-auto" dir="rtl">
            {/* ── Security-Market Correlation Alert ── */}
            {(() => {
              const critCount = mergedIntelReports.filter(r => r.severity === 'critical' || r.severity === 'high').length;
              const tgCrit = telegram.messages.filter(m => !m.is_duplicate && (m.severity === 'critical' || m.severity === 'high')).length;
              const totalThreat = critCount + tgCrit;
              const impactLevel = totalThreat > 10 ? 'high' : totalThreat > 3 ? 'moderate' : 'low';
              const impactColor = impactLevel === 'high' ? '#ff1744' : impactLevel === 'moderate' ? '#ff6d00' : '#00e676';
              const impactLabel = impactLevel === 'high' ? 'השפעה גבוהה' : impactLevel === 'moderate' ? 'השפעה בינונית' : 'השפעה נמוכה';
              return (
                <div className="p-2 rounded-lg" style={{ background: `${impactColor}08`, border: `1px solid ${impactColor}20` }}>
                  <div className="flex items-center gap-2">
                    <span style={{ fontFamily: 'Share Tech Mono', fontSize: 10, fontWeight: 900, color: impactColor }}>📊 {impactLabel}</span>
                    <span style={{ fontFamily: 'Share Tech Mono', fontSize: 7, color: 'rgba(255,255,255,0.3)' }}>{totalThreat} איומים פעילים</span>
                  </div>
                  <div style={{ fontFamily: 'Share Tech Mono', fontSize: 8, color: 'rgba(255,255,255,0.5)', marginTop: 4 }}>
                    {impactLevel === 'high' ? 'צפי לירידות חדות בבורסה — מצב ביטחוני קריטי' : impactLevel === 'moderate' ? 'תנודתיות מוגברת צפויה — אירועים ביטחוניים פעילים' : 'שגרה — ללא השפעה מהותית על השווקים'}
                  </div>
                </div>
              );
            })()}

            {/* ── Mock Market Data ── */}
            <div className="p-2 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontFamily: 'Share Tech Mono', fontSize: 8, fontWeight: 700, color: 'rgba(0,229,255,0.5)', letterSpacing: '0.1em', marginBottom: 6 }}>📈 מדדים עיקריים</div>
              <div className="space-y-1">
                {[
                  { name: 'ת"א 35', change: -1.2, value: '1,842' },
                  { name: 'S&P 500', change: 0.3, value: '5,234' },
                  { name: 'נפט ברנט', change: 2.1, value: '$87.40' },
                  { name: 'שקל/דולר', change: -0.4, value: '₪3.72' },
                ].map(m => (
                  <div key={m.name} className="flex items-center gap-2">
                    <span style={{ fontFamily: 'Share Tech Mono', fontSize: 8, color: 'rgba(255,255,255,0.6)', width: 70, flexShrink: 0 }}>{m.name}</span>
                    <span style={{ fontFamily: 'Share Tech Mono', fontSize: 8, color: 'rgba(255,255,255,0.8)', flex: 1 }}>{m.value}</span>
                    <span style={{ fontFamily: 'Share Tech Mono', fontSize: 8, fontWeight: 700, color: m.change > 0 ? '#00e676' : '#ff1744' }}>{m.change > 0 ? '+' : ''}{m.change}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── TAB: REPORT — Daily Intel Report + System Health ── */}
        {rightTab === 'report' && (
          <div className="px-2 py-2 max-h-[70vh] overflow-y-auto space-y-3" dir="rtl">
            <DailyIntelReport />
          </div>
        )}


      </aside>

      {/* Telegram Message — compact bottom-right card */}
      {selectedTgMessage && (
        <div className="absolute bottom-16 right-2 z-[2500] pointer-events-auto" dir="rtl" style={{ maxWidth: 'min(260px, 40vw)' }}>
          <div className="rounded-lg overflow-hidden backdrop-blur-md border border-border/30 bg-background/90 p-2.5 shadow-lg">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1">
                <span className="text-sm">📨</span>
                <span className="font-mono text-[8px] font-bold text-foreground/80">{selectedTgMessage.sender_name || 'לא ידוע'}</span>
              </div>
              <button onClick={() => setSelectedTgMessage(null)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
            </div>
            <p className="font-mono text-[8px] text-foreground/70 leading-snug line-clamp-4 mb-1">{selectedTgMessage.text}</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              {selectedTgMessage.severity && (
                <span className="font-mono text-[6px] px-1 py-0.5 rounded-sm" style={{
                  background: `${selectedTgMessage.severity === 'critical' ? '#ff1744' : selectedTgMessage.severity === 'high' ? '#ff6d00' : '#888'}20`,
                  color: selectedTgMessage.severity === 'critical' ? '#ff1744' : selectedTgMessage.severity === 'high' ? '#ff6d00' : '#888',
                }}>{selectedTgMessage.severity}</span>
              )}
              {selectedTgMessage.tags?.slice(0, 3).map((tag: string) => (
                <span key={tag} className="font-mono text-[5px] text-muted-foreground">#{tag}</span>
              ))}
              <span className="font-mono text-[5px] text-muted-foreground/50 mr-auto">
                {selectedTgMessage.message_date ? new Date(selectedTgMessage.message_date).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : ''}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Vehicle — compact bottom-left card ═══ */}
      {selectedVehicle && (
        <div className="absolute bottom-16 left-2 z-[2600] pointer-events-auto" dir="rtl" style={{ maxWidth: 'min(240px, 38vw)' }}>
          <div className="rounded-lg overflow-hidden backdrop-blur-md border bg-background/90 shadow-lg"
            style={{ borderColor: selectedVehicle.vehicleColor + '44' }}>
            <div className="px-2.5 py-2 flex items-center gap-2" style={{ background: selectedVehicle.vehicleColor + '15', borderBottom: `1px solid ${selectedVehicle.vehicleColor}22` }}>
              <span className="text-lg">{selectedVehicle.vehicleIcon}</span>
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[9px] font-bold text-foreground truncate">{selectedVehicle.vehicleLabel}</div>
                <div className="font-mono text-[7px] text-muted-foreground">{selectedVehicle.stationLabel}</div>
              </div>
              <button onClick={() => setSelectedVehicle(null)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
            </div>
            <div className="px-2.5 py-1.5 space-y-1">
              <div className="flex items-center gap-1">
                <span className="font-mono text-[7px] text-muted-foreground">סטטוס:</span>
                <span className="font-mono text-[8px] font-bold" style={{ color: selectedVehicle.arrived ? '#00e676' : '#ffab00' }}>
                  {selectedVehicle.arrived ? '✅ בזירה' : `🚨 בדרך · ${selectedVehicle.etaStr}`}
                </span>
              </div>
              {!selectedVehicle.arrived && (
                <div className="w-full bg-white/10 rounded-full h-1">
                  <div className="h-full rounded-full" style={{ width: `${Math.round(selectedVehicle.driveProgress * 100)}%`, background: selectedVehicle.vehicleColor }} />
                </div>
              )}
              <div className="font-mono text-[7px] font-bold text-foreground/80 truncate">{selectedVehicle.evt.title}</div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MCI/Verified Event — compact bottom-center card ═══ */}
      {activeMCI && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[3000] pointer-events-auto" dir="rtl" style={{ maxWidth: 'min(300px, 70vw)' }}>
          <div className="rounded-lg overflow-hidden backdrop-blur-md border shadow-lg"
            style={{
              background: activeMCI.severity === 'mci'
                ? 'linear-gradient(135deg, rgba(183,28,28,0.88), rgba(120,20,20,0.85))'
                : activeMCI.severity === 'verified'
                ? 'linear-gradient(135deg, rgba(21,101,192,0.88), rgba(13,71,161,0.85))'
                : 'linear-gradient(135deg, rgba(230,81,0,0.88), rgba(191,54,12,0.85))',
              borderColor: `${activeMCI.severity === 'mci' ? '#ff1744' : activeMCI.severity === 'verified' ? '#2196f3' : '#ff6d00'}66`,
              boxShadow: `0 4px 24px ${activeMCI.severity === 'mci' ? 'rgba(255,23,68,0.3)' : activeMCI.severity === 'verified' ? 'rgba(33,150,243,0.3)' : 'rgba(255,109,0,0.3)'}`,
              animation: 'criticalBannerSlide 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
              padding: '8px 12px',
            }}
          >
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1.5">
                <span className="text-lg">{activeMCI.severity === 'mci' ? '🚨' : activeMCI.severity === 'verified' ? '✅' : '⚠️'}</span>
                <div>
                  <div className="font-mono text-[10px] font-black text-white">
                    {activeMCI.severity === 'mci' ? 'רב-נפגעים' : activeMCI.severity === 'verified' ? 'מאומת' : 'אירוע'} · 📍 {activeMCI.city}
                  </div>
                  <div className="font-mono text-[7px] text-white/50">{activeMCI.sources.length} מקורות · {activeMCI.sources.map(s => s.type).join(', ')}</div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => { setFlyTo({ center: [activeMCI.lat, activeMCI.lon], zoom: 14 }); setActiveMCI(null); }}
                  className="font-mono text-[7px] font-bold px-2 py-1 rounded text-white/80 hover:bg-white/10 border border-white/20">🗺️</button>
                <button onClick={() => setActiveMCI(null)} className="text-white/40 hover:text-white/80 text-xs">✕</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Nav Event Info Card — compact city-name banner ═══ */}
      {activeNavEvent && !activeMCI && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[3000] pointer-events-auto" dir="rtl">
          <div className="flex items-center gap-2 rounded-full backdrop-blur-md border px-3 py-1.5"
            style={{
              background: `linear-gradient(135deg, ${activeNavEvent.color}cc, ${activeNavEvent.color}88)`,
              borderColor: `${activeNavEvent.color}55`,
              boxShadow: `0 2px 12px ${activeNavEvent.color}33`,
              animation: 'criticalBannerSlide 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            <span className="text-sm">{activeNavEvent.icon}</span>
            <span className="font-mono text-[10px] font-black text-white whitespace-nowrap">{activeNavEvent.label}</span>
            <span className="px-1.5 py-0.5 rounded-full text-[7px] font-bold text-white/80" style={{ background: 'rgba(255,255,255,0.15)' }}>{activeNavEvent.status}</span>
            <span className="font-mono text-[8px] text-white/50">⏱ {(() => {
              const mins = Math.floor((Date.now() - activeNavEvent.timestamp) / 60000);
              return mins < 1 ? 'עכשיו' : mins < 60 ? `${mins}ד'` : `${Math.floor(mins/60)}ש' ${mins%60}ד'`;
            })()}</span>
            <button onClick={() => setActiveNavEvent(null)} className="text-white/30 hover:text-white/70 text-[10px] mr-1">✕</button>
          </div>
        </div>
      )}
      {war.isLoading && (
        <div className="absolute inset-0 z-[2000] bg-background/70 backdrop-blur-sm flex items-center justify-center">
          <div className="text-center">
            <div className="w-12 h-12 border border-primary/20 rounded-full mx-auto relative">
              <div className="absolute inset-0 rounded-full border-t border-primary animate-spin" />
            </div>
            <p className="font-mono text-[10px] text-primary/60 mt-3 animate-pulse">SCANNING...</p>
          </div>
        </div>
      )}

      {/* ═══ Aircraft Detail — compact top-right card ═══ */}
      {selectedAircraftPopup && (
        <div className="absolute top-14 right-2 z-[4000] pointer-events-auto" dir="rtl" style={{ maxWidth: 'min(220px, 36vw)' }}>
          <div className="rounded-lg overflow-hidden backdrop-blur-md border bg-background/90 shadow-lg"
            style={{ borderColor: `${selectedAircraftPopup.color}44` }}>
            <div className="px-2.5 py-2 flex items-center gap-2" style={{ background: `${selectedAircraftPopup.color}15`, borderBottom: `1px solid ${selectedAircraftPopup.color}20` }}>
              <span style={{ fontSize: 20 }}>{selectedAircraftPopup.image}</span>
              <div className="flex-1 min-w-0">
                <div className="font-mono text-[9px] font-bold" style={{ color: selectedAircraftPopup.color }}>{selectedAircraftPopup.callsign}</div>
                <div className="font-mono text-[7px] text-muted-foreground">{selectedAircraftPopup.type}</div>
              </div>
              <button onClick={() => setSelectedAircraftPopup(null)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
            </div>
            <div className="px-2.5 py-1.5 space-y-1">
              <div className="font-mono text-[7px] text-foreground/70"><span className="text-foreground/40">משימה:</span> {selectedAircraftPopup.mission}</div>
              <div className="font-mono text-[7px]" style={{ color: selectedAircraftPopup.color }}>{selectedAircraftPopup.branchIcon} {selectedAircraftPopup.branch}</div>
              <div className="font-mono text-[7px] text-foreground/70">גובה: {selectedAircraftPopup.altitude.toLocaleString()} ft</div>
              <div className="rounded overflow-hidden" style={{ height: 3, background: 'rgba(255,255,255,0.05)' }}>
                <div style={{ height: '100%', width: `${Math.min(100, (selectedAircraftPopup.altitude / 45000) * 100)}%`, background: selectedAircraftPopup.color, borderRadius: 2 }} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AnalysisStatusPanel moved to toolbar */}

      {/* ═══ 3D Globe Overlay ═══ */}
      {showGlobe && (
        <GlobeView
          aircraft={AIRCRAFT_ROUTES.map(ac => {
            const pos = aircraftPositions[ac.id];
            const details = (AIRCRAFT_DETAILS as Record<string, any>)[ac.callsign] || {};
            return {
              id: ac.id,
              callsign: ac.callsign,
              type: ac.type,
              category: ac.category,
              color: ac.color,
              lat: pos?.lat ?? ac.route[0][0],
              lon: pos?.lon ?? ac.route[0][1],
              altitude: ac.altitude,
              bearing: pos?.bearing ?? 0,
              speed: ac.speed,
              mission: details.mission as string | undefined,
              branch: details.branch as string | undefined,
            };
          })}
          onClose={() => setShowGlobe(false)}
          hotspots={satelliteHotspots}
          earthquakes={satelliteEarthquakes}
          orefAlerts={orefAlerts.map(a => ({ ...a, lat: (a as any).lat, lon: (a as any).lon }))}
          emergencyEvents={mergedEmergencyEvents.filter(e => e.lat && e.lon).map(e => ({ id: e.id, title: e.title, description: e.description, lat: e.lat, lon: e.lon, color: e.color, source: e.source, event_time: e.event_time }))}
          maritimeVessels={maritimeVessels}
          telegramImpacts={telegramImpacts.filter(t => t.lat && t.lon)}
          embedded
        />
      )}

    </div>
  );
};

export default TacticalMapView;

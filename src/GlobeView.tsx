import React, { useRef, useMemo, useState, useEffect, useCallback } from 'react';
import { Canvas, useThree, useFrame, useLoader } from '@react-three/fiber';
import { OrbitControls, Html, Stars, Sphere } from '@react-three/drei';
import * as THREE from 'three';
import { supabase } from '@/integrations/supabase/client';

// ── Types ──
interface AircraftData {
  id: string;
  callsign: string;
  type: string;
  category: string;
  color: string;
  lat: number;
  lon: number;
  altitude: number;
  bearing: number;
  speed: number;
  mission?: string;
  branch?: string;
}

interface LiveFlight {
  icao24: string;
  callsign: string;
  country: string;
  lat: number;
  lon: number;
  altitude: number | null;
  velocity: number | null;
  heading: number | null;
  verticalRate: number | null;
  squawk: string | null;
}

interface SurfaceAsset {
  id: string;
  name: string;
  type: 'carrier' | 'destroyer' | 'frigate' | 'submarine' | 'ground' | 'air_defense';
  lat: number;
  lon: number;
  bearing: number;
  flag: string;
  details: string;
  color: string;
}

interface HotspotData {
  latitude: number;
  longitude: number;
  intensity: string;
  region?: string;
  frp?: number;
  brightness?: number;
}

interface OrefAlertGlobe {
  id: string;
  title: string;
  locations: string[];
  alert_date: string;
  lat?: number;
  lon?: number;
}

interface EmergencyEventGlobe {
  id: string;
  title: string;
  description?: string;
  lat?: number;
  lon?: number;
  color: string;
  source: string;
  event_time?: string;
}

interface MaritimeVesselGlobe {
  id: string;
  name: string;
  type: string;
  flag: string;
  lat: number;
  lon: number;
  heading: number;
  speed: number;
  tonnage: string;
  status: string;
}

interface TelegramImpactGlobe {
  text: string;
  label: string;
  icon: string;
  color: string;
  lat: number;
  lon: number;
  credibility: string;
  time?: number | string;
}

interface GlobeViewProps {
  aircraft: AircraftData[];
  onClose: () => void;
  hotspots?: HotspotData[];
  earthquakes?: any[];
  orefAlerts?: OrefAlertGlobe[];
  emergencyEvents?: EmergencyEventGlobe[];
  maritimeVessels?: MaritimeVesselGlobe[];
  telegramImpacts?: TelegramImpactGlobe[];
  embedded?: boolean; // if true, renders inline without close overlay
}

const GLOBE_RADIUS = 3;
const ALTITUDE_SCALE = 0.00015; // More exaggerated for visual depth

function latLonToVec3(lat: number, lon: number, altFeet: number = 0): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  const r = GLOBE_RADIUS + altFeet * ALTITUDE_SCALE;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}

// Reverse: 3D point on globe surface → lat/lon
function vec3ToLatLon(point: THREE.Vector3): { lat: number; lon: number } {
  const r = point.length();
  const lat = 90 - Math.acos(point.y / r) * (180 / Math.PI);
  const lon = -(Math.atan2(point.z, -point.x) * (180 / Math.PI)) - 180;
  return { lat, lon: ((lon + 540) % 360) - 180 };
}

// Flat (Mercator) projection: lat/lon → flat plane coordinates
const FLAT_WIDTH = 12;
const FLAT_HEIGHT = 6;
const ISRAEL_CENTER = { lat: 31.5, lon: 34.8 };
const FLAT_DEFAULT_CAMERA_Z = 2.8;
function latLonToFlat(lat: number, lon: number, altFeet: number = 0): THREE.Vector3 {
  const x = (lon / 180) * (FLAT_WIDTH / 2);
  const y = (lat / 90) * (FLAT_HEIGHT / 2);
  const z = altFeet * ALTITUDE_SCALE * 0.5;
  return new THREE.Vector3(x, y, z);
}

function altitudeColor(altFeet: number): string {
  if (altFeet <= 5000) return '#4caf50';
  if (altFeet <= 15000) return '#00e676';
  if (altFeet <= 25000) return '#ffeb3b';
  if (altFeet <= 35000) return '#29b6f6';
  if (altFeet <= 40000) return '#7c4dff';
  return '#e040fb';
}

function classifyFlight(callsign: string, country: string): { category: string; color: string } {
  const cs = callsign.toUpperCase();
  // Israeli military
  if (cs.startsWith('IAF') || cs.startsWith('ISF')) return { category: 'military', color: '#76ff03' };
  // US military
  if (cs.startsWith('RCH') || cs.startsWith('EVAC') || cs.startsWith('REACH')) return { category: 'cargo', color: '#64b5f6' };
  if (cs.startsWith('CNV') || cs.startsWith('NAVY') || cs.startsWith('TOPCAT')) return { category: 'military', color: '#42a5f5' };
  if (cs.startsWith('RRR') || cs.startsWith('FORTE') || cs.startsWith('JAKE')) return { category: 'uav', color: '#00e5ff' };
  if (cs.startsWith('DUKE') || cs.startsWith('COBRA') || cs.startsWith('VIPER')) return { category: 'military', color: '#ff3d00' };
  // Generic military patterns
  if (/^[A-Z]{3}\d{3,4}$/.test(cs) && ['United States', 'Israel', 'United Kingdom', 'France', 'Germany'].includes(country)) {
    return { category: 'military', color: '#ff9100' };
  }
  // Helicopters (lower altitude, certain patterns)
  if (cs.startsWith('LIF') || cs.startsWith('MEDEVAC')) return { category: 'helicopter', color: '#ff9100' };
  // Default commercial
  return { category: 'commercial', color: '#4fc3f7' };
}

// ── SVG Icons ──
function getSvgIcon(category: string, color: string, size: number = 22): string {
  const s = size;
  switch (category) {
    case 'military':
      return `<svg width="${s}" height="${s}" viewBox="0 0 32 32" fill="none"><path d="M16 2L14 8L4 14V17L14 15L13 24L9 27V29L16 27L23 29V27L19 24L18 15L28 17V14L18 8L16 2Z" fill="${color}" fill-opacity="0.9" stroke="${color}" stroke-width="0.5"/></svg>`;
    case 'helicopter':
      return `<svg width="${s}" height="${s}" viewBox="0 0 32 32" fill="none"><line x1="6" y1="8" x2="26" y2="8" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/><line x1="16" y1="8" x2="16" y2="14" stroke="${color}" stroke-width="1.2"/><ellipse cx="16" cy="18" rx="6" ry="4" fill="${color}" fill-opacity="0.8" stroke="${color}" stroke-width="0.6"/><line x1="22" y1="18" x2="28" y2="16" stroke="${color}" stroke-width="1.2" stroke-linecap="round"/></svg>`;
    case 'uav':
      return `<svg width="${s}" height="${s}" viewBox="0 0 32 32" fill="none"><path d="M16 4L12 10L4 14L12 16L16 28L20 16L28 14L20 10L16 4Z" fill="${color}" fill-opacity="0.7" stroke="${color}" stroke-width="0.6"/><circle cx="16" cy="14" r="2" fill="${color}" fill-opacity="0.5"/></svg>`;
    case 'cargo':
      return `<svg width="${s}" height="${s}" viewBox="0 0 32 32" fill="none"><path d="M16 2C15 2 14.5 3 14.5 4V12L4 16V19L14.5 17V24L11 27V29L16 27.5L21 29V27L18 24V17L28 19V16L18 12V4C18 3 17 2 16 2Z" fill="${color}" fill-opacity="0.85" stroke="${color}" stroke-width="0.4"/></svg>`;
    case 'carrier':
      return `<svg width="${s+4}" height="${s}" viewBox="0 0 40 28" fill="none"><path d="M2 18L6 12H34L38 18L36 22H4L2 18Z" fill="${color}" fill-opacity="0.85" stroke="${color}" stroke-width="0.6"/><rect x="10" y="8" width="18" height="4" rx="1" fill="${color}" fill-opacity="0.6"/></svg>`;
    case 'destroyer':
      return `<svg width="${s}" height="${s-4}" viewBox="0 0 32 20" fill="none"><path d="M2 14L6 8H26L30 14L28 17H4L2 14Z" fill="${color}" fill-opacity="0.8" stroke="${color}" stroke-width="0.6"/><rect x="14" y="4" width="2" height="4" fill="${color}" fill-opacity="0.7"/></svg>`;
    case 'frigate':
      return `<svg width="${s-2}" height="${s-6}" viewBox="0 0 28 18" fill="none"><path d="M2 12L5 7H23L26 12L24 15H4L2 12Z" fill="${color}" fill-opacity="0.75" stroke="${color}" stroke-width="0.5"/></svg>`;
    case 'submarine':
      return `<svg width="${s}" height="${s-8}" viewBox="0 0 32 14" fill="none"><ellipse cx="16" cy="9" rx="14" ry="4" fill="${color}" fill-opacity="0.7" stroke="${color}" stroke-width="0.5"/><rect x="14" y="3" width="4" height="3" rx="1" fill="${color}" fill-opacity="0.6"/></svg>`;
    case 'ground':
      return `<svg width="${s}" height="${s-4}" viewBox="0 0 32 22" fill="none"><rect x="4" y="10" width="24" height="8" rx="2" fill="${color}" fill-opacity="0.7" stroke="${color}" stroke-width="0.5"/><rect x="8" y="6" width="14" height="5" rx="1" fill="${color}" fill-opacity="0.6"/><line x1="22" y1="8" x2="30" y2="5" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    case 'air_defense':
      return `<svg width="${s}" height="${s}" viewBox="0 0 32 32" fill="none"><rect x="6" y="20" width="20" height="6" rx="1" fill="${color}" fill-opacity="0.6" stroke="${color}" stroke-width="0.5"/><line x1="16" y1="20" x2="16" y2="12" stroke="${color}" stroke-width="1.2"/><line x1="16" y1="12" x2="10" y2="4" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/><line x1="16" y1="12" x2="22" y2="4" stroke="${color}" stroke-width="1.5" stroke-linecap="round"/></svg>`;
    default:
      return `<svg width="${s}" height="${s}" viewBox="0 0 32 32" fill="none"><path d="M16 2C15.2 2 14.5 2.7 14.5 3.5V12L4 16V18.5L14.5 16.5V24L11 26.5V28L16 26.5L21 28V26.5L18 24V16.5L28 18.5V16L18 12V3.5C18 2.7 16.8 2 16 2Z" fill="${color}" fill-opacity="0.85" stroke="${color}" stroke-width="0.3"/></svg>`;
  }
}

// ── Surface military assets ──
const SURFACE_ASSETS: SurfaceAsset[] = [
  { id: 'cvn69', name: 'USS Eisenhower (CVN-69)', type: 'carrier', lat: 21.5, lon: 38.5, bearing: 340, flag: '🇺🇸', details: 'CSG-2 • Nimitz-class • 65 כ"ט', color: '#42a5f5' },
  { id: 'ddg100', name: 'USS Kidd (DDG-100)', type: 'destroyer', lat: 22.0, lon: 38.0, bearing: 15, flag: '🇺🇸', details: 'Arleigh Burke • Aegis • SM-3', color: '#64b5f6' },
  { id: 'ddg114', name: 'USS Ralph Johnson (DDG-114)', type: 'destroyer', lat: 21.0, lon: 39.0, bearing: 200, flag: '🇺🇸', details: 'Arleigh Burke Flight IIA', color: '#64b5f6' },
  { id: 'cg62', name: 'USS Chancellorsville (CG-62)', type: 'destroyer', lat: 26.5, lon: 50.0, bearing: 90, flag: '🇺🇸', details: 'Ticonderoga • Aegis BMD', color: '#64b5f6' },
  { id: 'lhd7', name: 'USS Iwo Jima (LHD-7)', type: 'carrier', lat: 26.0, lon: 52.0, bearing: 270, flag: '🇺🇸', details: 'Wasp-class • 22nd MEU', color: '#42a5f5' },
  { id: 'ssn_ohio', name: 'USS Florida (SSGN-728)', type: 'submarine', lat: 24.0, lon: 48.0, bearing: 45, flag: '🇺🇸', details: 'Ohio-class SSGN • 154 Tomahawk', color: '#90caf9' },
  { id: 'ssn_va', name: 'USS Missouri (SSN-780)', type: 'submarine', lat: 20.0, lon: 39.5, bearing: 0, flag: '🇺🇸', details: 'Virginia-class • ים סוף', color: '#90caf9' },
  { id: 'cdg', name: 'Charles de Gaulle (R91)', type: 'carrier', lat: 34.0, lon: 32.5, bearing: 120, flag: '🇫🇷', details: 'נ.מ גרעיני • Rafale M + E-2C', color: '#7c4dff' },
  { id: 'hms_diamond', name: 'HMS Diamond (D34)', type: 'destroyer', lat: 20.5, lon: 40.0, bearing: 330, flag: '🇬🇧', details: 'Type 45 Daring • Sea Viper', color: '#e040fb' },
  { id: 'ins_saar6', name: 'INS Magen (Sa\'ar 6)', type: 'frigate', lat: 32.5, lon: 34.2, bearing: 270, flag: '🇮🇱', details: 'Sa\'ar 6 • Iron Dome Naval', color: '#29b6f6' },
  { id: 'ins_dolphin', name: 'INS Dolphin (AIP)', type: 'submarine', lat: 33.5, lon: 33.5, bearing: 350, flag: '🇮🇱', details: 'Dolphin-class AIP • SLCMs', color: '#4dd0e1' },
  { id: 'iron_dome', name: 'כיפת ברזל', type: 'air_defense', lat: 32.0, lon: 34.8, bearing: 0, flag: '🇮🇱', details: 'מרכז • 10 סוללות פעילות', color: '#76ff03' },
  { id: 'david_sling', name: 'קלע דוד', type: 'air_defense', lat: 32.5, lon: 35.0, bearing: 0, flag: '🇮🇱', details: 'צפון • יירוט טילים בליסטיים', color: '#76ff03' },
  { id: 'thaad_uae', name: 'THAAD Battery', type: 'air_defense', lat: 24.2, lon: 54.8, bearing: 0, flag: '🇺🇸', details: 'UAE • THAAD + Patriot PAC-3', color: '#ff5722' },
  { id: 'idf_north', name: 'פיקוד צפון', type: 'ground', lat: 33.0, lon: 35.6, bearing: 0, flag: '🇮🇱', details: 'אוגדה 91 + 36 • חי"ר + שריון', color: '#4caf50' },
  { id: 'idf_south', name: 'פיקוד דרום', type: 'ground', lat: 31.3, lon: 34.4, bearing: 0, flag: '🇮🇱', details: 'אוגדת עזה • חי"ר + הנדסה', color: '#4caf50' },
];

// ── Earth Globe — NASA 8K High-resolution textures ──
function EarthGlobe({ onDoubleClick }: { onDoubleClick?: (lat: number, lon: number) => void }) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  // NASA Blue Marble high-res day + night textures (local for CORS)
  const dayMap = useLoader(THREE.TextureLoader, '/earth-8k-day.jpg');
  const nightMap = useLoader(THREE.TextureLoader, '/earth-night-hires.jpg');
  const bumpMap = useLoader(THREE.TextureLoader, 'https://cdn.jsdelivr.net/npm/three-globe@2.35.0/example/img/earth-topology.png');

  // Maximize texture quality for deep zoom
  useMemo(() => {
    [dayMap, nightMap, bumpMap].forEach(tex => {
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = 16;
      tex.generateMipmaps = true;
      tex.colorSpace = THREE.SRGBColorSpace;
    });
  }, [dayMap, nightMap, bumpMap]);

  // Calculate sun direction based on real time (synced to clock)
  const lightDirRef = useRef(new THREE.Vector3());
  
  useFrame(() => {
    const now = new Date();
    const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
    const sunLonDeg = (12 - utcHours) * 15;
    const dayOfYear = Math.floor((now.getTime() - new Date(now.getFullYear(), 0, 0).getTime()) / 86400000);
    const sunLatDeg = 23.44 * Math.sin(((360 / 365) * (dayOfYear - 81)) * (Math.PI / 180));
    
    const phi = (90 - sunLatDeg) * (Math.PI / 180);
    const theta = (sunLonDeg + 180) * (Math.PI / 180);
    lightDirRef.current.set(
      -Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta)
    ).normalize();
    
    if (meshRef.current) {
      const mat = meshRef.current.material as THREE.ShaderMaterial;
      if (mat.uniforms?.sunDirection) {
        mat.uniforms.sunDirection.value.copy(lightDirRef.current);
      }
    }
  });

  const vertexShader = `
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    void main() {
      vUv = uv;
      vNormal = normalize(normalMatrix * normal);
      vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const fragmentShader = `
    uniform sampler2D dayTexture;
    uniform sampler2D nightTexture;
    uniform sampler2D bumpTexture;
    uniform vec3 sunDirection;
    varying vec2 vUv;
    varying vec3 vNormal;
    varying vec3 vWorldPos;
    void main() {
      vec3 normal = normalize(vNormal);
      float dotNL = dot(normal, sunDirection);
      float dayFactor = smoothstep(-0.15, 0.25, dotNL);
      vec4 dayColor = texture2D(dayTexture, vUv);
      vec4 nightColor = texture2D(nightTexture, vUv);
      nightColor.rgb *= 2.0;
      vec4 color = mix(nightColor, dayColor, dayFactor);
      color.rgb = pow(color.rgb, vec3(0.92));
      color.rgb *= 1.05;
      color.rgb += vec3(0.01);
      gl_FragColor = color;
    }
  `;

  const handleDoubleClick = useCallback((e: any) => {
    e.stopPropagation();
    if (e.point && onDoubleClick) {
      const { lat, lon } = vec3ToLatLon(e.point);
      onDoubleClick(lat, lon);
    }
  }, [onDoubleClick]);

  return (
    <Sphere args={[GLOBE_RADIUS, 512, 512]} ref={meshRef} onDoubleClick={handleDoubleClick}>
      <shaderMaterial
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        uniforms={{
          dayTexture: { value: dayMap },
          nightTexture: { value: nightMap },
          bumpTexture: { value: bumpMap },
          sunDirection: { value: lightDirRef.current },
        }}
      />
    </Sphere>
  );
}

// ── Flat Earth Plane (Mercator projection) ──
function FlatEarth({ onDoubleClick }: { onDoubleClick?: (lat: number, lon: number) => void }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const dayMap = useLoader(THREE.TextureLoader, '/earth-8k-day.jpg');
  const nightMap = useLoader(THREE.TextureLoader, '/earth-night-hires.jpg');

  useMemo(() => {
    [dayMap, nightMap].forEach(tex => {
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.anisotropy = 16;
      tex.generateMipmaps = true;
      tex.colorSpace = THREE.SRGBColorSpace;
    });
  }, [dayMap, nightMap]);

  const lightDirRef = useRef(new THREE.Vector3(1, 1, 1));

  useFrame(() => {
    const now = new Date();
    const utcHours = now.getUTCHours() + now.getUTCMinutes() / 60;
    // For flat map, sunDirection just affects mixing
    const sunLonNorm = ((12 - utcHours) * 15 + 180) / 360; // 0-1
    lightDirRef.current.set(sunLonNorm, 0.5, 0).normalize();
    if (meshRef.current) {
      const mat = meshRef.current.material as THREE.ShaderMaterial;
      if (mat.uniforms?.sunLon) mat.uniforms.sunLon.value = sunLonNorm;
    }
  });

  const vs = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const fs = `
    uniform sampler2D dayTexture;
    uniform sampler2D nightTexture;
    uniform float sunLon;
    varying vec2 vUv;
    void main() {
      float dist = abs(vUv.x - sunLon);
      dist = min(dist, 1.0 - dist);
      float dayFactor = smoothstep(0.25, 0.15, dist);
      vec4 day = texture2D(dayTexture, vUv);
      vec4 night = texture2D(nightTexture, vUv);
      night.rgb *= 2.0;
      vec4 color = mix(night, day, dayFactor);
      color.rgb = pow(color.rgb, vec3(0.92)) * 1.05 + 0.01;
      gl_FragColor = color;
    }
  `;

  const handleDoubleClick = useCallback((e: any) => {
    e.stopPropagation();
    if (e.point && onDoubleClick) {
      const lat = (e.point.y / (FLAT_HEIGHT / 2)) * 90;
      const lon = (e.point.x / (FLAT_WIDTH / 2)) * 180;
      onDoubleClick(lat, lon);
    }
  }, [onDoubleClick]);

  return (
    <mesh ref={meshRef} onDoubleClick={handleDoubleClick}>
      <planeGeometry args={[FLAT_WIDTH, FLAT_HEIGHT, 1, 1]} />
      <shaderMaterial
        vertexShader={vs}
        fragmentShader={fs}
        uniforms={{
          dayTexture: { value: dayMap },
          nightTexture: { value: nightMap },
          sunLon: { value: 0.5 },
        }}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
function Atmosphere() {
  const vs = `varying vec3 vNormal; void main() { vNormal = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
  const fs = `varying vec3 vNormal; void main() { float i = pow(0.65 - dot(vNormal, vec3(0,0,1)), 2.0); gl_FragColor = vec4(0.3,0.6,1.0,1.0) * i; }`;
  return (
    <Sphere args={[GLOBE_RADIUS * 1.015, 128, 128]}>
      <shaderMaterial vertexShader={vs} fragmentShader={fs} transparent side={THREE.BackSide} blending={THREE.AdditiveBlending} depthWrite={false} />
    </Sphere>
  );
}

// ── Geo Labels ──
const GEO_LABELS = [
  { name: 'תל אביב', lat: 32.08, lon: 34.78 },
  { name: 'ירושלים', lat: 31.77, lon: 35.22 },
  { name: 'חיפה', lat: 32.79, lon: 34.99 },
  { name: 'באר שבע', lat: 31.25, lon: 34.79 },
  { name: 'אילת', lat: 29.56, lon: 34.95 },
  { name: 'עמאן', lat: 31.95, lon: 35.93 },
  { name: 'דמשק', lat: 33.51, lon: 36.29 },
  { name: 'ביירות', lat: 33.89, lon: 35.50 },
  { name: 'קהיר', lat: 30.04, lon: 31.24, size: '8px' },
  { name: 'בגדאד', lat: 33.31, lon: 44.37, size: '8px' },
  { name: 'טהרן', lat: 35.69, lon: 51.39, size: '8px' },
  { name: 'ריאד', lat: 24.71, lon: 46.68, size: '7px' },
];

function GeoLabels() {
  return (
    <>
      {GEO_LABELS.map(city => {
        const pos = latLonToVec3(city.lat, city.lon, 0);
        return (
          <Html key={city.name} position={pos} center style={{ pointerEvents: 'none' }}>
            <div style={{
              fontFamily: 'monospace', fontSize: (city as any).size || '7px', color: 'rgba(255,255,255,0.5)',
              textShadow: '0 0 6px rgba(0,0,0,0.9)', whiteSpace: 'nowrap', userSelect: 'none',
            }}>
              📍 {city.name}
            </div>
          </Html>
        );
      })}
    </>
  );
}

// ── Live Aircraft with smooth interpolation ──
function LiveAircraft3D({ flight, onClick }: { flight: LiveFlight; onClick: (f: LiveFlight) => void }) {
  const alt = flight.altitude || 0;
  const color = altitudeColor(alt);
  const { category } = classifyFlight(flight.callsign, flight.country);
  
  const posRef = useRef(latLonToVec3(flight.lat, flight.lon, alt));
  const targetPos = useMemo(() => latLonToVec3(flight.lat, flight.lon, alt), [flight.lat, flight.lon, alt]);
  const groundPos = useMemo(() => latLonToVec3(flight.lat, flight.lon, 0), [flight.lat, flight.lon]);

  // Smooth interpolation
  useFrame(() => {
    posRef.current.lerp(targetPos, 0.04);
  });

  const threeColor = useMemo(() => new THREE.Color(color), [color]);

  // Altitude stem + ground ring
  const stemLine = useMemo(() => {
    const geom = new THREE.BufferGeometry().setFromPoints([groundPos, targetPos]);
    const mat = new THREE.LineDashedMaterial({ color: threeColor, transparent: true, opacity: 0.2, dashSize: 0.015, gapSize: 0.006 });
    const line = new THREE.Line(geom, mat);
    line.computeLineDistances();
    return line;
  }, [groundPos, targetPos, threeColor]);

  const ringMesh = useMemo(() => {
    const ringSize = Math.max(0.004, Math.min(0.015, alt * 0.0000003));
    const geom = new THREE.RingGeometry(ringSize * 0.4, ringSize, 16);
    const mat = new THREE.MeshBasicMaterial({ color: threeColor, transparent: true, opacity: 0.15, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(groundPos);
    mesh.lookAt(groundPos.clone().multiplyScalar(2));
    return mesh;
  }, [groundPos, threeColor, alt]);

  const svgIcon = useMemo(() => getSvgIcon(category, color, 16), [category, color]);
  const heading = flight.heading ?? 0;
  const vRate = flight.verticalRate ?? 0;
  const vRateIcon = vRate > 1 ? '↑' : vRate < -1 ? '↓' : '→';

  return (
    <>
      <primitive object={stemLine} />
      <primitive object={ringMesh} />
      
      {/* Glowing point at altitude */}
      <mesh position={targetPos}>
        <sphereGeometry args={[0.006, 8, 8]} />
        <meshBasicMaterial color={threeColor} transparent opacity={0.6} />
      </mesh>
      
      <Html position={targetPos} center>
        <div
          onClick={() => onClick(flight)}
          style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'center' }}
        >
          <div
            style={{
              transform: `rotate(${heading}deg)`,
              filter: `drop-shadow(0 0 6px ${color})`,
              transition: 'transform 2s ease',
            }}
            dangerouslySetInnerHTML={{ __html: svgIcon }}
          />
          <div style={{
            fontFamily: 'monospace', fontSize: '5.5px', color, marginTop: -1,
            textShadow: `0 0 4px ${color}, 0 1px 3px rgba(0,0,0,0.9)`,
            whiteSpace: 'nowrap', opacity: 0.65,
          }}>
            {flight.callsign || flight.icao24}
            <span style={{ opacity: 0.4, marginLeft: 2, fontSize: '4.5px' }}>
              {alt > 0 ? `${(alt / 1000).toFixed(0)}K` : ''} {vRateIcon}
            </span>
          </div>
        </div>
      </Html>
    </>
  );
}

// ── Static Aircraft (from props) ──
function Aircraft3D({ ac, onClick }: { ac: AircraftData; onClick: (ac: AircraftData) => void }) {
  const pos = useMemo(() => latLonToVec3(ac.lat, ac.lon, ac.altitude), [ac.lat, ac.lon, ac.altitude]);
  const groundPos = useMemo(() => latLonToVec3(ac.lat, ac.lon, 0), [ac.lat, ac.lon]);
  const color = useMemo(() => altitudeColor(ac.altitude), [ac.altitude]);
  const threeColor = useMemo(() => new THREE.Color(color), [color]);

  const stemLine = useMemo(() => {
    const geom = new THREE.BufferGeometry().setFromPoints([groundPos, pos]);
    const mat = new THREE.LineDashedMaterial({ color: threeColor, transparent: true, opacity: 0.3, dashSize: 0.02, gapSize: 0.008 });
    const line = new THREE.Line(geom, mat);
    line.computeLineDistances();
    return line;
  }, [groundPos, pos, threeColor]);

  const groundDot = useMemo(() => {
    const geom = new THREE.RingGeometry(0.003, 0.008, 16);
    const mat = new THREE.MeshBasicMaterial({ color: threeColor, transparent: true, opacity: 0.2, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(groundPos);
    mesh.lookAt(groundPos.clone().multiplyScalar(2));
    return mesh;
  }, [groundPos, threeColor]);

  const svgIcon = useMemo(() => getSvgIcon(ac.category, color, 18), [ac.category, color]);

  return (
    <>
      <primitive object={stemLine} />
      <primitive object={groundDot} />
      <mesh position={pos}>
        <sphereGeometry args={[0.005, 8, 8]} />
        <meshBasicMaterial color={threeColor} transparent opacity={0.5} />
      </mesh>
      <Html position={pos} center>
        <div onClick={() => onClick(ac)} style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'center' }}>
          <div style={{ transform: `rotate(${ac.bearing}deg)`, filter: `drop-shadow(0 0 4px ${color})` }} dangerouslySetInnerHTML={{ __html: svgIcon }} />
          <div style={{
            fontFamily: 'monospace', fontSize: '6px', color, marginTop: -1,
            textShadow: `0 0 4px ${color}, 0 1px 3px rgba(0,0,0,0.9)`,
            whiteSpace: 'nowrap', opacity: 0.7,
          }}>
            {ac.callsign}
            <span style={{ opacity: 0.5, marginLeft: 2, fontSize: '5px' }}>{(ac.altitude / 1000).toFixed(0)}K</span>
          </div>
        </div>
      </Html>
    </>
  );
}

// ── Surface Asset ──
function SurfaceAsset3D({ asset, onClick }: { asset: SurfaceAsset; onClick: (a: SurfaceAsset) => void }) {
  const pos = useMemo(() => latLonToVec3(asset.lat, asset.lon, asset.type === 'submarine' ? -500 : 0), [asset.lat, asset.lon, asset.type]);
  const svgIcon = useMemo(() => getSvgIcon(asset.type, asset.color, 20), [asset.type, asset.color]);
  return (
    <Html position={pos} center>
      <div onClick={() => onClick(asset)} style={{ cursor: 'pointer', userSelect: 'none', textAlign: 'center' }}>
        <div style={{ transform: `rotate(${asset.bearing}deg)`, filter: `drop-shadow(0 0 4px ${asset.color})` }} dangerouslySetInnerHTML={{ __html: svgIcon }} />
        <div style={{
          fontFamily: 'monospace', fontSize: '5px', color: asset.color, marginTop: -1,
          textShadow: `0 0 3px ${asset.color}, 0 1px 2px rgba(0,0,0,0.9)`,
          whiteSpace: 'nowrap', opacity: 0.6, maxWidth: 60, overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {asset.flag} {asset.name.split('(')[0].trim()}
        </div>
      </div>
    </Html>
  );
}

// ── Altitude Layer Rings ──
function AltitudeRings() {
  const layers = [
    { alt: 10000, label: '10K ft', color: '#4caf50' },
    { alt: 25000, label: '25K ft', color: '#ffeb3b' },
    { alt: 40000, label: '40K ft', color: '#7c4dff' },
  ];
  
  return (
    <>
      {layers.map(layer => {
        const r = GLOBE_RADIUS + layer.alt * ALTITUDE_SCALE;
        return (
          <mesh key={layer.alt} rotation={[Math.PI / 2, 0, 0]}>
            <ringGeometry args={[r - 0.001, r + 0.001, 128]} />
            <meshBasicMaterial color={layer.color} transparent opacity={0.04} side={THREE.DoubleSide} />
          </mesh>
        );
      })}
    </>
  );
}

// ── Thermal Hotspot on Globe ──
function ThermalHotspot3D({ hotspot }: { hotspot: HotspotData }) {
  const pos = useMemo(() => latLonToVec3(hotspot.latitude, hotspot.longitude, 0), [hotspot.latitude, hotspot.longitude]);
  const color = hotspot.intensity === 'extreme' ? '#ff1744' : hotspot.intensity === 'high' ? '#ff6d00' : '#ffab00';
  const icon = hotspot.intensity === 'extreme' ? '🔥' : hotspot.intensity === 'high' ? '🌡️' : '⚡';

  const assessment = useMemo(() => {
    const region = (hotspot.region || '').toLowerCase();
    const frp = hotspot.frp || 0;
    if ((region.includes('איראן') || region.includes('iran')) && frp > 50) return '⚠️ חשד לאתר שיגור';
    if ((region.includes('איראן') || region.includes('iran'))) return '🔍 פעילות חשודה';
    if ((region.includes('תימן') || region.includes('yemen'))) return '⚠️ פעילות חות\'ית';
    if ((region.includes('סוריה') || region.includes('syria'))) return '💥 תקיפה אפשרית';
    if ((region.includes('לבנון') || region.includes('lebanon'))) return '🔥 פעילות חיזבאללה';
    if ((region.includes('עיראק') || region.includes('iraq'))) return '🔍 מיליציות';
    if (frp > 100) return '🔥 חום חריג';
    if (frp > 50) return '⚡ נקודת עניין';
    return '🌡️ נקודת חום';
  }, [hotspot.region, hotspot.frp]);

  return (
    <Html position={pos} center>
      <div style={{
        cursor: 'default', userSelect: 'none', textAlign: 'center',
        filter: `drop-shadow(0 0 6px ${color})`,
      }}>
        <div style={{ fontSize: 16, lineHeight: 1 }}>{icon}</div>
        <div style={{
          fontFamily: 'monospace', fontSize: '6px', color,
          textShadow: `0 0 6px ${color}, 0 1px 3px rgba(0,0,0,0.95)`,
          whiteSpace: 'nowrap', marginTop: 1,
        }}>
          <div style={{ fontSize: '5.5px', fontWeight: 700 }}>{assessment}</div>
          <div style={{ fontSize: '4px', opacity: 0.6 }}>
            {hotspot.region || ''} {hotspot.frp ? `${hotspot.frp}MW` : ''}
          </div>
        </div>
      </div>
    </Html>
  );
}

// ── Earthquake on Globe ──
function EarthquakePoint3D({ quake }: { quake: any }) {
  const pos = useMemo(() => latLonToVec3(quake.latitude, quake.longitude, 0), [quake.latitude, quake.longitude]);
  const magnitude = quake.magnitude || 0;
  const color = quake.possible_explosion ? '#ff1744' : magnitude >= 5 ? '#ff6d00' : '#ffeb3b';
  const icon = quake.possible_explosion ? '💥' : '🌍';

  return (
    <Html position={pos} center>
      <div style={{
        cursor: 'default', userSelect: 'none', textAlign: 'center',
        filter: `drop-shadow(0 0 4px ${color})`,
      }}>
        <div style={{ fontSize: magnitude >= 5 ? 18 : 14, lineHeight: 1 }}>{icon}</div>
        <div style={{
          fontFamily: 'monospace', fontSize: '5px', color,
          textShadow: `0 0 4px ${color}`, whiteSpace: 'nowrap',
          marginTop: 1, textAlign: 'center',
        }}>
          {quake.possible_explosion ? 'חשד לפיצוץ' : 'רעידה'} M{magnitude.toFixed(1)}
          <div style={{ fontSize: '4px', opacity: 0.5 }}>{quake.region || ''}</div>
        </div>
      </div>
    </Html>
  );
}

// ── Oref Alert on Globe ──
function OrefAlert3D({ alert, onClick }: { alert: OrefAlertGlobe; onClick?: (a: OrefAlertGlobe) => void }) {
  const pos = useMemo(() => alert.lat && alert.lon ? latLonToVec3(alert.lat, alert.lon, 0) : null, [alert.lat, alert.lon]);
  if (!pos) return null;

  return (
    <Html position={pos} center>
      <div onClick={() => onClick?.(alert)} style={{
        cursor: 'pointer', userSelect: 'none', textAlign: 'center',
        animation: 'pulse 1s infinite',
      }}>
        <div style={{ fontSize: 20, lineHeight: 1, filter: 'drop-shadow(0 0 8px #ff1744)' }}>🚨</div>
        <div style={{
          fontFamily: 'monospace', fontSize: '7px', color: '#ff1744', fontWeight: 700,
          textShadow: '0 0 6px #ff1744, 0 1px 3px rgba(0,0,0,0.95)',
          whiteSpace: 'nowrap', marginTop: 1,
        }}>
          {alert.title}
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: '5px', color: '#ff1744', opacity: 0.7, whiteSpace: 'nowrap' }}>
          {alert.locations?.slice(0, 2).join(', ')}
        </div>
      </div>
    </Html>
  );
}

// ── Emergency Event on Globe ──
function EmergencyEvent3D({ event, onClick }: { event: EmergencyEventGlobe; onClick?: (e: EmergencyEventGlobe) => void }) {
  const pos = useMemo(() => event.lat && event.lon ? latLonToVec3(event.lat, event.lon, 0) : null, [event.lat, event.lon]);
  const serviceIcon = event.source?.includes('מד') ? '🚑' : event.source?.includes('כיבוי') ? '🔥' : event.source?.includes('משטרה') ? '🚔' : '🆘';
  const color = event.color || '#ff9800';
  if (!pos) return null;

  return (
    <Html position={pos} center>
      <div onClick={() => onClick?.(event)} style={{
        cursor: 'pointer', userSelect: 'none', textAlign: 'center',
      }}>
        <div style={{ fontSize: 16, lineHeight: 1, filter: `drop-shadow(0 0 4px ${color})` }}>{serviceIcon}</div>
        <div style={{
          fontFamily: 'monospace', fontSize: '6px', color, fontWeight: 700,
          textShadow: `0 0 4px ${color}, 0 1px 3px rgba(0,0,0,0.95)`,
          whiteSpace: 'nowrap', marginTop: 1, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {event.title?.slice(0, 30)}
        </div>
      </div>
    </Html>
  );
}

// ── Maritime Vessel on Globe ──
function MaritimeVessel3D({ vessel, onClick }: { vessel: MaritimeVesselGlobe; onClick?: (v: MaritimeVesselGlobe) => void }) {
  const pos = useMemo(() => latLonToVec3(vessel.lat, vessel.lon, 0), [vessel.lat, vessel.lon]);
  const isThreat = vessel.type === 'threat' || vessel.type === 'military_hostile';
  const color = isThreat ? '#ff1744' : vessel.type === 'military_friendly' ? '#42a5f5' : vessel.type === 'cargo' ? '#78909c' : '#4fc3f7';
  const icon = isThreat ? '⚠️' : vessel.type === 'military_friendly' ? '⚓' : '🚢';

  return (
    <Html position={pos} center>
      <div onClick={() => onClick?.(vessel)} style={{
        cursor: 'pointer', userSelect: 'none', textAlign: 'center',
      }}>
        <div style={{
          fontSize: isThreat ? 18 : 14, lineHeight: 1,
          filter: `drop-shadow(0 0 4px ${color})`,
          transform: `rotate(${vessel.heading || 0}deg)`,
        }}>{icon}</div>
        <div style={{
          fontFamily: 'monospace', fontSize: '5.5px', color, fontWeight: 600,
          textShadow: `0 0 4px ${color}, 0 1px 2px rgba(0,0,0,0.95)`,
          whiteSpace: 'nowrap', marginTop: 1,
        }}>
          {vessel.name?.slice(0, 20)}
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: '4px', color, opacity: 0.5, whiteSpace: 'nowrap' }}>
          {vessel.flag} {vessel.speed}kn HDG{vessel.heading}°
        </div>
      </div>
    </Html>
  );
}

// ── Telegram Impact on Globe ──
function TelegramImpact3D({ impact, onClick }: { impact: TelegramImpactGlobe; onClick?: (t: TelegramImpactGlobe) => void }) {
  const pos = useMemo(() => impact.lat && impact.lon ? latLonToVec3(impact.lat, impact.lon, 0) : null, [impact.lat, impact.lon]);
  const isVerified = impact.credibility === 'verified';
  const color = isVerified ? '#ff6d00' : impact.credibility === 'corroborated' ? '#ffab00' : '#78909c';
  if (!pos) return null;

  return (
    <Html position={pos} center>
      <div onClick={() => onClick?.(impact)} style={{
        cursor: 'pointer', userSelect: 'none', textAlign: 'center',
      }}>
        <div style={{
          fontSize: isVerified ? 16 : 12, lineHeight: 1,
          filter: `drop-shadow(0 0 4px ${color})`,
        }}>{impact.icon || '📨'}</div>
        <div style={{
          fontFamily: 'monospace', fontSize: '5.5px', color, fontWeight: 700,
          textShadow: `0 0 4px ${color}, 0 1px 2px rgba(0,0,0,0.95)`,
          whiteSpace: 'nowrap', marginTop: 1, maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {impact.label?.slice(0, 25)}
        </div>
      </div>
    </Html>
  );
}

// ── Maritime Threat Zone (animated arc on globe surface) ──
function MaritimeZone3D({ points, color, label }: { points: [number, number][]; color: string; label: string }) {
  const line = useMemo(() => {
    const pts = points.map(([lat, lon]) => latLonToVec3(lat, lon, 200));
    // Close the loop
    if (pts.length > 2) pts.push(pts[0]);
    const geom = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.5 });
    return new THREE.Line(geom, mat);
  }, [points, color]);

  const centerPos = useMemo(() => {
    const avgLat = points.reduce((s, p) => s + p[0], 0) / points.length;
    const avgLon = points.reduce((s, p) => s + p[1], 0) / points.length;
    return latLonToVec3(avgLat, avgLon, 500);
  }, [points]);

  return (
    <>
      <primitive object={line} />
      <Html position={centerPos} center style={{ pointerEvents: 'none' }}>
        <div style={{ fontFamily: 'monospace', fontSize: '5px', color, textShadow: `0 0 4px ${color}`, whiteSpace: 'nowrap', opacity: 0.7 }}>
          ⚠️ {label}
        </div>
      </Html>
    </>
  );
}



// ── Country Borders (simplified GeoJSON as line segments) ──
function CountryBorders() {
  const bordersGroup = useMemo(() => {
    const group = new THREE.Group();
    // Simplified major country borders in the Middle East / Mediterranean region
    const borders: number[][][] = [
      // Israel borders (approximate)
      [[29.49,34.27],[29.56,34.95],[31.32,34.27],[31.52,34.39],[31.59,34.49],[32.10,34.80],[32.82,35.10],[33.10,35.15],[33.29,35.64],[33.10,35.85],[31.77,35.54],[31.32,35.55],[30.50,35.00],[29.49,34.27]],
      // Lebanon
      [[33.10,35.15],[33.29,35.64],[33.90,35.10],[34.65,36.43],[34.45,35.62],[33.90,35.10]],
      // Jordan (partial)
      [[29.18,34.96],[29.49,34.97],[30.50,35.00],[31.32,35.55],[31.77,35.54],[32.31,36.83],[33.38,38.79],[32.31,39.30],[29.18,36.07],[29.18,34.96]],
      // Egypt-Israel border
      [[29.49,34.27],[31.32,34.27],[31.07,33.75],[31.52,32.33],[31.52,25.00]],
      // Syria (partial)
      [[33.29,35.64],[33.10,35.85],[32.31,36.83],[33.38,38.79],[36.82,38.79],[37.07,42.36],[36.64,42.36],[35.19,40.95],[33.38,35.62]],
      // Iraq (partial)
      [[33.38,38.79],[32.31,39.30],[29.06,46.57],[37.07,44.77],[37.07,42.36],[36.64,42.36],[33.38,38.79]],
      // Iran (partial west)
      [[39.78,44.77],[37.07,44.77],[29.06,46.57],[25.65,57.40],[27.14,56.28],[27.14,51.59],[30.42,47.68],[32.94,46.11],[34.89,45.85],[37.07,44.77]],
      // Saudi (partial north)
      [[29.06,46.57],[32.31,39.30],[29.18,36.07],[28.00,35.18],[25.00,37.00],[20.00,40.00],[17.83,44.20],[16.37,43.10]],
      // Turkey south border
      [[36.17,36.16],[36.82,38.79],[37.07,42.36],[37.07,44.77],[39.78,44.77],[41.20,43.44],[42.00,44.55]],
      // Cyprus
      [[35.17,33.38],[34.57,32.27],[34.57,33.92],[35.17,34.58],[35.70,34.07],[35.17,33.38]],
    ];

    const material = new THREE.LineBasicMaterial({ color: new THREE.Color('#ffd54f'), transparent: true, opacity: 0.25 });

    borders.forEach(border => {
      const points: THREE.Vector3[] = [];
      border.forEach(([lat, lon]) => {
        points.push(latLonToVec3(lat, lon, 500)); // Slightly above surface
      });
      if (points.length > 1) {
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const line = new THREE.Line(geometry, material);
        group.add(line);
      }
    });

    return group;
  }, []);

  return <primitive object={bordersGroup} />;
}

// ── Clock Widget ──
function GlobeClock() {
  const [time, setTime] = useState(new Date());
  
  useEffect(() => {
    const interval = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const utc = time.toISOString().slice(11, 19);
  const ilTime = new Date(time.toLocaleString('en-US', { timeZone: 'Asia/Jerusalem' }));
  const il = ilTime.toTimeString().slice(0, 8);
  const ilOffset = time.getTimezoneOffset(); // We compute manually
  const hours = ilTime.getHours();
  const isDay = hours >= 6 && hours < 20;

  return (
    <div style={{
      position: 'absolute', top: 38, right: 10, zIndex: 25,
      background: 'rgba(0,0,0,0.85)', border: '1px solid rgba(255,215,0,0.2)',
      borderRadius: 4, padding: '6px 10px', fontFamily: 'monospace', backdropFilter: 'blur(8px)',
      minWidth: 120,
    }}>
      <div style={{ fontSize: 6, color: 'rgba(255,255,255,0.35)', fontWeight: 700, letterSpacing: 1, marginBottom: 4, textAlign: 'center' }}>
        🕐 SYNC CLOCK
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.4)' }}>UTC</span>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#29b6f6', letterSpacing: 1 }}>{utc}</span>
        </div>
        <div style={{ height: 1, background: 'rgba(255,255,255,0.06)' }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.4)' }}>🇮🇱 IL</span>
          <span style={{ fontSize: 12, fontWeight: 800, color: '#ffd54f', letterSpacing: 1 }}>{il}</span>
        </div>
      </div>
      <div style={{ marginTop: 4, fontSize: 6, color: 'rgba(255,255,255,0.2)', textAlign: 'center' }}>
        {isDay ? '☀️' : '🌙'} {isDay ? 'DAY' : 'NIGHT'} • ZULU+3
      </div>
    </div>
  );
}

function GlobeScene({ aircraft, liveFlights, hotspots, earthquakes, orefAlerts, emergencyEvents, maritimeVessels, telegramImpacts, showBorders = true, showLabels = true, showAltRings = true, showSurfaceAssets = true, showMaritimeZones = true, projection = 'globe', onSelectAircraft, onSelectSurface, onSelectLive, onSelectOref, onSelectEmergency, onSelectVessel, onSelectTelegram, alertZoomTarget }: {
  aircraft: AircraftData[];
  liveFlights: LiveFlight[];
  hotspots: HotspotData[];
  earthquakes: any[];
  orefAlerts: OrefAlertGlobe[];
  emergencyEvents: EmergencyEventGlobe[];
  maritimeVessels: MaritimeVesselGlobe[];
  telegramImpacts: TelegramImpactGlobe[];
  showBorders?: boolean;
  showLabels?: boolean;
  showAltRings?: boolean;
  showSurfaceAssets?: boolean;
  showMaritimeZones?: boolean;
  projection?: 'globe' | 'flat';
  onSelectAircraft: (ac: AircraftData) => void;
  onSelectSurface: (a: SurfaceAsset) => void;
  onSelectLive: (f: LiveFlight) => void;
  onSelectOref: (a: OrefAlertGlobe) => void;
  onSelectEmergency: (e: EmergencyEventGlobe) => void;
  onSelectVessel: (v: MaritimeVesselGlobe) => void;
  onSelectTelegram: (t: TelegramImpactGlobe) => void;
  alertZoomTarget?: { lat: number; lon: number } | null;
}) {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);
  const zoomAnimRef = useRef<{ target: THREE.Vector3; lookAt: THREE.Vector3; startTime: number; duration: number } | null>(null);
  const isFlat = projection === 'flat';

  // Position converter based on projection
  const toPos = useCallback((lat: number, lon: number, alt: number = 0) => {
    return isFlat ? latLonToFlat(lat, lon, alt) : latLonToVec3(lat, lon, alt);
  }, [isFlat]);

  const syncControlsTarget = useCallback((target: THREE.Vector3) => {
    if (controlsRef.current) {
      controlsRef.current.target.copy(target);
      controlsRef.current.update();
      return;
    }

    camera.lookAt(target);
  }, [camera]);

  useEffect(() => {
    if (isFlat) {
      const israelFlat = latLonToFlat(ISRAEL_CENTER.lat, ISRAEL_CENTER.lon, 0);
      camera.position.set(israelFlat.x, israelFlat.y, FLAT_DEFAULT_CAMERA_Z);
      syncControlsTarget(israelFlat);
    } else {
      const camPos = latLonToVec3(31.0, 44.0, 380000);
      camera.position.copy(camPos);
      syncControlsTarget(new THREE.Vector3(0, 0, 0));
    }
    camera.updateProjectionMatrix();
  }, [camera, isFlat, syncControlsTarget]);

  // Double-click zoom handler
  const handleDoubleClickZoom = useCallback((lat: number, lon: number) => {
    const currentDist = isFlat ? Math.abs(camera.position.z) : camera.position.length();
    // Zoom in by 3x, minimum distance close to surface
    const newDist = Math.max(isFlat ? 1.5 : GLOBE_RADIUS * 1.05, currentDist / 3);
    
    let camDest: THREE.Vector3;
    let lookTarget: THREE.Vector3;
    if (isFlat) {
      const flatTarget = latLonToFlat(lat, lon, 0);
      camDest = new THREE.Vector3(flatTarget.x, flatTarget.y, newDist);
      lookTarget = flatTarget.clone();
    } else {
      camDest = latLonToVec3(lat, lon, (newDist - GLOBE_RADIUS) / ALTITUDE_SCALE);
      lookTarget = new THREE.Vector3(0, 0, 0);
    }
    zoomAnimRef.current = { target: camDest, lookAt: lookTarget, startTime: Date.now(), duration: 1.5 };
  }, [camera, isFlat]);

  // Auto-zoom to alert
  useEffect(() => {
    if (!alertZoomTarget) return;
    let camDest: THREE.Vector3;
    let lookTarget: THREE.Vector3;
    if (isFlat) {
      const flatTarget = latLonToFlat(alertZoomTarget.lat, alertZoomTarget.lon, 0);
      camDest = new THREE.Vector3(flatTarget.x, flatTarget.y, 2);
      lookTarget = flatTarget.clone();
    } else {
      camDest = latLonToVec3(alertZoomTarget.lat, alertZoomTarget.lon, 80000);
      lookTarget = new THREE.Vector3(0, 0, 0);
    }
    zoomAnimRef.current = { target: camDest, lookAt: lookTarget, startTime: Date.now(), duration: 2.5 };
  }, [alertZoomTarget, isFlat]);

  useFrame(() => {
    if (!zoomAnimRef.current) return;
    const elapsed = (Date.now() - zoomAnimRef.current.startTime) / 1000;
    const t = Math.min(1, elapsed / zoomAnimRef.current.duration);
    const eased = 1 - Math.pow(1 - t, 3);
    camera.position.lerp(zoomAnimRef.current.target, eased * 0.08);
    syncControlsTarget(zoomAnimRef.current.lookAt);

    if (t >= 1) {
      camera.position.copy(zoomAnimRef.current.target);
      syncControlsTarget(zoomAnimRef.current.lookAt);
      zoomAnimRef.current = null;
    }
  });

  return (
    <>
      <ambientLight intensity={isFlat ? 0.4 : 0.15} />
      <directionalLight position={[8, 4, 6]} intensity={isFlat ? 0.8 : 1.2} color="#fff5e0" castShadow />
      <directionalLight position={[-5, -2, -4]} intensity={0.15} color="#4488ff" />
      {!isFlat && <Stars radius={80} depth={60} count={4000} factor={2} saturation={0} fade speed={0.2} />}
      
      {isFlat ? (
        <FlatEarth onDoubleClick={handleDoubleClickZoom} />
      ) : (
        <>
          <EarthGlobe onDoubleClick={handleDoubleClickZoom} />
          <Atmosphere />
        </>
      )}
      
      {!isFlat && showAltRings && <AltitudeRings />}
      {showLabels && <GeoLabels />}
      {!isFlat && showBorders && <CountryBorders />}

      {aircraft.map(ac => (
        <Aircraft3D key={ac.id} ac={ac} onClick={onSelectAircraft} />
      ))}

      {liveFlights.map(f => (
        <LiveAircraft3D key={f.icao24} flight={f} onClick={onSelectLive} />
      ))}

      {showSurfaceAssets && SURFACE_ASSETS.map(asset => (
        <SurfaceAsset3D key={asset.id} asset={asset} onClick={onSelectSurface} />
      ))}

      {hotspots.slice(0, 100).map((h, i) => (
        <ThermalHotspot3D key={`hot-${i}`} hotspot={h} />
      ))}

      {orefAlerts.slice(0, 50).map((a, i) => (
        <OrefAlert3D key={`oref-${a.id || i}`} alert={a} onClick={onSelectOref} />
      ))}

      {emergencyEvents.slice(0, 50).map((e, i) => (
        <EmergencyEvent3D key={`emer-${e.id || i}`} event={e} onClick={onSelectEmergency} />
      ))}

      {maritimeVessels.slice(0, 80).map((v, i) => (
        <MaritimeVessel3D key={`mv-${v.id || i}`} vessel={v} onClick={onSelectVessel} />
      ))}

      {telegramImpacts.slice(0, 60).map((t, i) => (
        <TelegramImpact3D key={`tgi-${i}`} impact={t} onClick={onSelectTelegram} />
      ))}

      {!isFlat && showMaritimeZones && (
        <>
          <MaritimeZone3D
            points={[[26.6, 56.0], [26.0, 56.4], [25.8, 57.0], [26.2, 57.2], [27.0, 56.6], [26.6, 56.0]]}
            color="#ff1744" label="מיצרי הורמוז — אזור סיכון"
          />
          <MaritimeZone3D
            points={[[33.0, 34.0], [32.0, 34.0], [31.5, 34.2], [31.5, 34.8], [32.0, 34.9], [33.0, 34.5], [33.0, 34.0]]}
            color="#29b6f6" label="חופי ישראל — ניטור ימי"
          />
          <MaritimeZone3D
            points={[[20.0, 38.5], [18.0, 39.0], [13.0, 43.0], [12.5, 44.5], [14.0, 43.5], [20.0, 39.5], [20.0, 38.5]]}
            color="#ff9800" label="באב אל-מנדב — מסדרון חות׳י"
          />
        </>
      )}

      {earthquakes.slice(0, 30).map((q, i) => (
        <EarthquakePoint3D key={`quake-${i}`} quake={q} />
      ))}

      <OrbitControls
        ref={controlsRef}
        enablePan={true}
        enableRotate={!isFlat}
        minDistance={isFlat ? 0.5 : GLOBE_RADIUS * 1.001}
        maxDistance={isFlat ? 20 : GLOBE_RADIUS * 8}
        rotateSpeed={0.5}
        zoomSpeed={1.2}
        panSpeed={0.4}
        screenSpacePanning={isFlat}
        mouseButtons={isFlat
          ? { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
          : { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
        touches={isFlat
          ? { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN }
          : { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        enableDamping
        dampingFactor={0.08}
      />
    </>
  );
}

function LoadingScreen() {
  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: '#000', zIndex: 40, fontFamily: 'monospace', color: '#00e676',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🌍</div>
        <div style={{ fontSize: 12, letterSpacing: 3, opacity: 0.7 }}>LOADING EARTH...</div>
      </div>
    </div>
  );
}

// ── Altitude Legend ──
function AltitudeLegend() {
  const bands = [
    { label: '0-5K', color: '#4caf50' },
    { label: '5-15K', color: '#00e676' },
    { label: '15-25K', color: '#ffeb3b' },
    { label: '25-35K', color: '#29b6f6' },
    { label: '35-40K', color: '#7c4dff' },
    { label: '40K+', color: '#e040fb' },
  ];
  return (
    <div style={{
      position: 'absolute', bottom: 10, right: 10, zIndex: 20,
      background: 'rgba(0,0,0,0.75)', border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 4, padding: '6px 8px', fontFamily: 'monospace', backdropFilter: 'blur(4px)',
    }}>
      <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.5)', marginBottom: 4, fontWeight: 700, letterSpacing: 1 }}>ALTITUDE (ft)</div>
      <div style={{ display: 'flex', gap: 1 }}>
        {bands.map(b => (
          <div key={b.label} style={{ textAlign: 'center' }}>
            <div style={{ width: 16, height: 40, background: `linear-gradient(to top, ${b.color}22, ${b.color})`, borderRadius: 2, marginBottom: 2 }} />
            <div style={{ fontSize: 5, color: b.color, opacity: 0.7 }}>{b.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AssetLegend() {
  const items = [
    { label: 'מטוס קרבי', svg: getSvgIcon('military', '#ff3d00', 14) },
    { label: 'מסחרי', svg: getSvgIcon('commercial', '#4fc3f7', 14) },
    { label: 'מסוק', svg: getSvgIcon('helicopter', '#ff9100', 14) },
    { label: 'מל"ט', svg: getSvgIcon('uav', '#00e5ff', 14) },
    { label: 'תובלה', svg: getSvgIcon('cargo', '#64b5f6', 14) },
    { label: 'נ. מטוסים', svg: getSvgIcon('carrier', '#42a5f5', 14) },
    { label: 'משחתת', svg: getSvgIcon('destroyer', '#64b5f6', 14) },
    { label: 'צוללת', svg: getSvgIcon('submarine', '#90caf9', 14) },
    { label: 'הגנ"א', svg: getSvgIcon('air_defense', '#ff5722', 14) },
  ];
  return (
    <div style={{
      position: 'absolute', bottom: 60, left: 10, zIndex: 20,
      background: 'rgba(0,0,0,0.75)', border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 4, padding: '5px 7px', fontFamily: 'monospace', backdropFilter: 'blur(4px)',
    }}>
      <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.5)', marginBottom: 3, fontWeight: 700, letterSpacing: 1 }}>ASSETS</div>
      {items.map(item => (
        <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
          <div dangerouslySetInnerHTML={{ __html: item.svg }} />
          <span style={{ fontSize: 6, color: 'rgba(255,255,255,0.5)' }}>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

// ── OOB Panel ──
const OOB_DATA = [
  { section: 'CENTCOM 🇺🇸', color: '#42a5f5', items: [
    { icon: '⚓', unit: '5th Fleet', loc: 'בחריין', assets: 'נ.מ, משחתות' },
    { icon: '🚢', unit: 'CSG-2', loc: 'ים סוף', assets: 'נ.מ + 65 כ"ט' },
    { icon: '✈️', unit: '379th AEW', loc: 'קטאר', assets: 'F-22, KC-135' },
  ]},
  { section: 'NATO', color: '#7c4dff', items: [
    { icon: '🇫🇷', unit: 'CDG CSG', loc: 'ים תיכון', assets: 'Rafale M' },
    { icon: '🇬🇧', unit: 'HMS Diamond', loc: 'ים סוף', assets: 'Type 45' },
  ]},
  { section: 'ישראל 🇮🇱', color: '#29b6f6', items: [
    { icon: '⚡', unit: 'חיל האוויר', loc: 'ארצי', assets: 'F-35I, F-16I' },
    { icon: '🛡️', unit: 'כיפת ברזל', loc: 'מרכז', assets: '10 סוללות' },
  ]},
];

function OOBPanel() {
  const [collapsed, setCollapsed] = useState(true);
  return (
    <div style={{
      position: 'absolute', top: 40, left: 10, zIndex: 25, width: collapsed ? 32 : 180,
      background: 'rgba(0,0,0,0.8)', border: '1px solid rgba(255,255,255,0.1)',
      borderRadius: 4, fontFamily: 'monospace', backdropFilter: 'blur(6px)',
      maxHeight: 'calc(100vh - 100px)', overflowY: 'auto', transition: 'width 0.2s',
    }}>
      <div onClick={() => setCollapsed(!collapsed)} style={{ padding: '4px 6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        {!collapsed && <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.6)', fontWeight: 700 }}>סד"כ — OOB</span>}
        <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>{collapsed ? '◀' : '▶'}</span>
      </div>
      {!collapsed && OOB_DATA.map(section => (
        <div key={section.section} style={{ padding: '3px 6px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ fontSize: 7, color: section.color, fontWeight: 700, marginBottom: 2 }}>{section.section}</div>
          {section.items.map(item => (
            <div key={item.unit} style={{ display: 'flex', gap: 3, marginBottom: 2 }}>
              <span style={{ fontSize: 8 }}>{item.icon}</span>
              <div>
                <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.7)', fontWeight: 600 }}>{item.unit}</div>
                <div style={{ fontSize: 6, color: 'rgba(255,255,255,0.3)' }}>{item.loc} • {item.assets}</div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── Main ──
export default function GlobeView({ aircraft, onClose, hotspots = [], earthquakes = [], orefAlerts = [], emergencyEvents = [], maritimeVessels = [], telegramImpacts = [], embedded = false }: GlobeViewProps) {
  const [selectedAc, setSelectedAc] = useState<AircraftData | null>(null);
  const [selectedSurface, setSelectedSurface] = useState<SurfaceAsset | null>(null);
  const [selectedLive, setSelectedLive] = useState<LiveFlight | null>(null);
  const [selectedOref, setSelectedOref] = useState<OrefAlertGlobe | null>(null);
  const [selectedEmergency, setSelectedEmergency] = useState<EmergencyEventGlobe | null>(null);
  const [selectedVessel, setSelectedVessel] = useState<MaritimeVesselGlobe | null>(null);
  const [selectedTelegram, setSelectedTelegram] = useState<TelegramImpactGlobe | null>(null);
  const [liveFlights, setLiveFlights] = useState<LiveFlight[]>([]);
  const [liveStatus, setLiveStatus] = useState<'loading' | 'ok' | 'error'>('loading');
  const [showLayerPanel, setShowLayerPanel] = useState(false);
  const [projection, setProjection] = useState<'globe' | 'flat'>('globe');
  const [alertZoomTarget, setAlertZoomTarget] = useState<{ lat: number; lon: number } | null>(null);
  const prevOrefCountRef = useRef(0);

  const clearAllSelections = () => { setSelectedAc(null); setSelectedSurface(null); setSelectedLive(null); setSelectedOref(null); setSelectedEmergency(null); setSelectedVessel(null); setSelectedTelegram(null); };

  // Auto-zoom when new oref alerts arrive
  useEffect(() => {
    if (orefAlerts.length > prevOrefCountRef.current) {
      const newest = orefAlerts.find(a => a.lat && a.lon);
      if (newest?.lat && newest?.lon) {
        setAlertZoomTarget({ lat: newest.lat, lon: newest.lon });
        setTimeout(() => setAlertZoomTarget(null), 5000);
      }
    }
    prevOrefCountRef.current = orefAlerts.length;
  }, [orefAlerts]);

  // Globe layer visibility
  const [globeLayers, setGlobeLayers] = useState({
    liveFlights: true,
    mockAircraft: true,
    surfaceAssets: true,
    hotspots: true,
    earthquakes: true,
    borders: true,
    labels: true,
    altRings: true,
    oob: true,
    orefAlerts: true,
    emergencyEvents: true,
    maritimeVessels: true,
    telegramImpacts: true,
  });

  const toggleLayer = (key: keyof typeof globeLayers) => setGlobeLayers(prev => ({ ...prev, [key]: !prev[key] }));

  // Fetch real flights from OpenSky
  const fetchFlights = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('opensky-flights');
      if (error) throw error;
      if (data?.aircraft && Array.isArray(data.aircraft)) {
        setLiveFlights(data.aircraft);
        setLiveStatus('ok');
      } else {
        setLiveStatus('error');
      }
    } catch (err) {
      console.error('Failed to fetch flights:', err);
      setLiveStatus('error');
    }
  }, []);

  useEffect(() => {
    fetchFlights();
    const interval = setInterval(fetchFlights, 30000);
    return () => clearInterval(interval);
  }, [fetchFlights]);

  const stats = useMemo(() => {
    const naval = SURFACE_ASSETS.filter(a => ['carrier', 'destroyer', 'frigate'].includes(a.type)).length;
    const subs = SURFACE_ASSETS.filter(a => a.type === 'submarine').length;
    return {
      total: aircraft.length + liveFlights.length,
      live: liveFlights.length,
      mock: aircraft.length,
      naval, subs,
    };
  }, [aircraft, liveFlights]);

  const selected = selectedAc || selectedSurface || selectedLive;

  const GLOBE_LAYER_DEFS = [
    { key: 'liveFlights' as const, icon: '✈️', label: 'טיסות חיות', color: '#4fc3f7' },
    { key: 'mockAircraft' as const, icon: '🛩️', label: 'מטוסים צבאיים', color: '#76ff03' },
    { key: 'surfaceAssets' as const, icon: '⚓', label: 'כוחות ימיים', color: '#42a5f5' },
    { key: 'hotspots' as const, icon: '🔥', label: 'נקודות חמות', color: '#ff6d00' },
    { key: 'earthquakes' as const, icon: '🌍', label: 'רעידות אדמה', color: '#ffeb3b' },
    { key: 'borders' as const, icon: '🗺️', label: 'גבולות', color: '#ffd54f' },
    { key: 'labels' as const, icon: '📍', label: 'תוויות ערים', color: '#fff' },
    { key: 'altRings' as const, icon: '🔘', label: 'טבעות גובה', color: '#7c4dff' },
    { key: 'oob' as const, icon: '🛡️', label: 'סד״כ — OOB', color: '#29b6f6' },
    { key: 'orefAlerts' as const, icon: '🚨', label: 'פיקוד העורף', color: '#ff1744' },
    { key: 'emergencyEvents' as const, icon: '🚑', label: 'אירועי חירום', color: '#ff9800' },
    { key: 'maritimeVessels' as const, icon: '🚢', label: 'תנועת אוניות', color: '#4fc3f7' },
    { key: 'telegramImpacts' as const, icon: '📨', label: 'מודיעין טלגרם', color: '#ff6d00' },
  ];

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: '#000' }}>
      {/* Header */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30,
        background: 'linear-gradient(180deg, rgba(0,0,0,0.7) 0%, transparent 100%)',
        padding: '8px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 14 }}>🌍</span>
          <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'rgba(255,255,255,0.7)', fontWeight: 700, letterSpacing: 2 }}>
            {projection === 'globe' ? '🌍 3D GLOBE' : '🗺️ FLAT MAP'} — LIVE
          </span>
          <span style={{
            fontFamily: 'monospace', fontSize: 7,
            color: liveStatus === 'ok' ? '#00e676' : liveStatus === 'loading' ? '#ffeb3b' : '#ff5252',
            display: 'flex', alignItems: 'center', gap: 3,
          }}>
            <span style={{
              width: 5, height: 5, borderRadius: '50%',
              background: liveStatus === 'ok' ? '#00e676' : liveStatus === 'loading' ? '#ffeb3b' : '#ff5252',
              display: 'inline-block',
              animation: liveStatus === 'loading' ? 'pulse 1s infinite' : 'none',
            }} />
            {liveStatus === 'ok' ? `LIVE ${stats.live} FLIGHTS` : liveStatus === 'loading' ? 'CONNECTING...' : 'OFFLINE'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontFamily: 'monospace', fontSize: 7, color: 'rgba(255,255,255,0.45)', display: 'flex', gap: 8 }}>
            <span>✈️ {stats.total}</span>
            <span>⚓ {stats.naval}</span>
            <span>🔱 {stats.subs}</span>
            {hotspots.length > 0 && <span>🔥 {hotspots.length} חום</span>}
            {earthquakes.length > 0 && <span>🌍 {earthquakes.length} רעידות</span>}
          </div>
           {/* Projection toggle */}
          <button onClick={() => setProjection(p => p === 'globe' ? 'flat' : 'globe')} style={{
            background: projection === 'flat' ? 'rgba(255,215,0,0.2)' : 'rgba(255,255,255,0.08)',
            border: `1px solid ${projection === 'flat' ? 'rgba(255,215,0,0.4)' : 'rgba(255,255,255,0.15)'}`,
            borderRadius: 4, color: projection === 'flat' ? '#ffd54f' : 'rgba(255,255,255,0.8)',
            fontFamily: 'monospace', fontSize: 9,
            padding: '3px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            transition: 'all 0.2s',
          }}>
            {projection === 'globe' ? '🗺️ פריסה' : '🌍 גלובוס'}
          </button>
          {/* Layer settings button */}
          <button onClick={() => setShowLayerPanel(v => !v)} style={{
            background: showLayerPanel ? 'rgba(59,130,246,0.25)' : 'rgba(255,255,255,0.08)',
            border: `1px solid ${showLayerPanel ? 'rgba(59,130,246,0.4)' : 'rgba(255,255,255,0.15)'}`,
            borderRadius: 4, color: 'rgba(255,255,255,0.8)', fontFamily: 'monospace', fontSize: 9,
            padding: '3px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
          }}>
            ⚙️ שכבות
          </button>
          {!embedded && (
            <button onClick={onClose} style={{
              background: 'linear-gradient(135deg, rgba(59,130,246,0.3), rgba(59,130,246,0.15))',
              border: '1px solid rgba(59,130,246,0.5)',
              borderRadius: 4, color: '#93c5fd', fontFamily: 'monospace', fontSize: 9, fontWeight: 700,
              padding: '4px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
              transition: 'all 0.2s',
            }}
              onMouseEnter={e => { (e.target as HTMLElement).style.background = 'linear-gradient(135deg, rgba(59,130,246,0.5), rgba(59,130,246,0.3))'; }}
              onMouseLeave={e => { (e.target as HTMLElement).style.background = 'linear-gradient(135deg, rgba(59,130,246,0.3), rgba(59,130,246,0.15))'; }}
            >🗺️ חזרה למפה הטקטית</button>
          )}
        </div>
      </div>

      {/* Layer selection panel */}
      {showLayerPanel && (
        <>
          <div style={{ position: 'absolute', inset: 0, zIndex: 31 }} onClick={() => setShowLayerPanel(false)} />
          <div dir="rtl" style={{
            position: 'absolute', top: 38, right: 140, zIndex: 32, width: 200,
            background: 'rgba(0,8,16,0.95)', border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: 6, padding: '8px 10px', fontFamily: 'monospace', backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
          }}>
            <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', fontWeight: 700, letterSpacing: 1, marginBottom: 6, textAlign: 'center' }}>
              🌍 שכבות תצוגה — גלובוס
            </div>
            {GLOBE_LAYER_DEFS.map(({ key, icon, label, color }) => (
              <div key={key} onClick={() => toggleLayer(key)} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 4,
                cursor: 'pointer', marginBottom: 2,
                background: globeLayers[key] ? 'rgba(59,130,246,0.12)' : 'transparent',
                border: `1px solid ${globeLayers[key] ? 'rgba(59,130,246,0.25)' : 'rgba(255,255,255,0.05)'}`,
                transition: 'all 0.15s',
              }}>
                <div style={{
                  width: 14, height: 14, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: globeLayers[key] ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.06)',
                  border: `1px solid ${globeLayers[key] ? 'rgba(59,130,246,0.5)' : 'rgba(255,255,255,0.1)'}`,
                  fontSize: 8, color: globeLayers[key] ? '#fff' : 'rgba(255,255,255,0.3)',
                }}>
                  {globeLayers[key] ? '✓' : ''}
                </div>
                <span style={{ fontSize: 9 }}>{icon}</span>
                <span style={{ fontSize: 8, color: globeLayers[key] ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.35)', fontWeight: globeLayers[key] ? 600 : 400 }}>
                  {label}
                </span>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 4, marginTop: 6, justifyContent: 'center' }}>
              <button onClick={() => setGlobeLayers(prev => Object.fromEntries(Object.keys(prev).map(k => [k, true])) as typeof prev)} style={{
                fontSize: 7, padding: '2px 8px', borderRadius: 3, border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontFamily: 'monospace',
              }}>הפעל הכל</button>
              <button onClick={() => setGlobeLayers(prev => Object.fromEntries(Object.keys(prev).map(k => [k, false])) as typeof prev)} style={{
                fontSize: 7, padding: '2px 8px', borderRadius: 3, border: '1px solid rgba(255,255,255,0.1)',
                background: 'rgba(255,255,255,0.05)', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontFamily: 'monospace',
              }}>נקה הכל</button>
            </div>
          </div>
        </>
      )}

      <React.Suspense fallback={<LoadingScreen />}>
        <Canvas
          camera={{ fov: 30, near: 0.001, far: 200, position: [0, 0, 6] }}
          style={{ background: '#000' }}
          dpr={Math.min(window.devicePixelRatio, 2)}
          gl={{ antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.2 }}
        >
          <GlobeScene
            aircraft={globeLayers.mockAircraft ? aircraft : []}
            liveFlights={globeLayers.liveFlights ? liveFlights : []}
            hotspots={globeLayers.hotspots ? hotspots : []}
            earthquakes={globeLayers.earthquakes ? earthquakes : []}
            orefAlerts={globeLayers.orefAlerts ? orefAlerts : []}
            emergencyEvents={globeLayers.emergencyEvents ? emergencyEvents : []}
            maritimeVessels={globeLayers.maritimeVessels ? maritimeVessels : []}
            telegramImpacts={globeLayers.telegramImpacts ? telegramImpacts : []}
            showBorders={globeLayers.borders}
            showLabels={globeLayers.labels}
            showAltRings={globeLayers.altRings}
            showSurfaceAssets={globeLayers.surfaceAssets}
            showMaritimeZones={globeLayers.maritimeVessels}
            projection={projection}
            onSelectAircraft={(ac) => { clearAllSelections(); setSelectedAc(ac); }}
            onSelectSurface={(s) => { clearAllSelections(); setSelectedSurface(s); }}
            onSelectLive={(f) => { clearAllSelections(); setSelectedLive(f); }}
            onSelectOref={(a) => { clearAllSelections(); setSelectedOref(a); }}
            onSelectEmergency={(e) => { clearAllSelections(); setSelectedEmergency(e); }}
            onSelectVessel={(v) => { clearAllSelections(); setSelectedVessel(v); }}
            onSelectTelegram={(t) => { clearAllSelections(); setSelectedTelegram(t); }}
            alertZoomTarget={alertZoomTarget}
          />
        </Canvas>
      </React.Suspense>

      {globeLayers.oob && <OOBPanel />}
      <GlobeClock />
      <AssetLegend />
      <AltitudeLegend />

      {/* Live Flight Info Panel */}
      {selectedLive && (
        <div style={{
          position: 'absolute', top: 45, right: 10, zIndex: 30,
          background: 'rgba(0,0,0,0.9)', border: `1px solid ${altitudeColor(selectedLive.altitude || 0)}30`,
          borderRadius: 6, padding: 12, width: 240, fontFamily: 'monospace', backdropFilter: 'blur(10px)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div dangerouslySetInnerHTML={{ __html: getSvgIcon(classifyFlight(selectedLive.callsign, selectedLive.country).category, altitudeColor(selectedLive.altitude || 0), 22) }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: altitudeColor(selectedLive.altitude || 0) }}>
                  {selectedLive.callsign || selectedLive.icao24}
                </div>
                <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.35)' }}>ICAO: {selectedLive.icao24} • {selectedLive.country}</div>
              </div>
            </div>
            <button onClick={() => setSelectedLive(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 12 }}>✕</button>
          </div>
          
          {/* Altitude bar */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.4)', marginBottom: 2 }}>ALTITUDE</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.min(100, ((selectedLive.altitude || 0) / 45000) * 100)}%`,
                  height: '100%', borderRadius: 3,
                  background: `linear-gradient(90deg, #4caf50, ${altitudeColor(selectedLive.altitude || 0)})`,
                  transition: 'width 1s ease',
                }} />
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: altitudeColor(selectedLive.altitude || 0), minWidth: 55, textAlign: 'right' }}>
                {(selectedLive.altitude || 0).toLocaleString()} ft
              </span>
            </div>
          </div>

          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 10px', fontSize: 8, color: 'rgba(255,255,255,0.5)' }}>
            <div>
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 6 }}>SPEED</span>
              <div style={{ fontWeight: 700, color: '#29b6f6' }}>{selectedLive.velocity ?? '—'} kts</div>
            </div>
            <div>
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 6 }}>HEADING</span>
              <div style={{ fontWeight: 700, color: '#ffeb3b' }}>{selectedLive.heading?.toFixed(0) ?? '—'}°</div>
            </div>
            <div>
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 6 }}>V/S</span>
              <div style={{ fontWeight: 700, color: (selectedLive.verticalRate ?? 0) > 0 ? '#00e676' : (selectedLive.verticalRate ?? 0) < 0 ? '#ff5252' : '#fff' }}>
                {selectedLive.verticalRate ? `${selectedLive.verticalRate > 0 ? '+' : ''}${(selectedLive.verticalRate * 196.85).toFixed(0)} fpm` : '—'}
              </div>
            </div>
            <div>
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 6 }}>SQUAWK</span>
              <div style={{ fontWeight: 700, color: selectedLive.squawk === '7700' ? '#ff0000' : selectedLive.squawk === '7600' ? '#ff9800' : '#fff' }}>
                {selectedLive.squawk || '—'}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 6, fontSize: 6, color: 'rgba(255,255,255,0.2)', textAlign: 'center' }}>
            📡 LIVE DATA • {selectedLive.lat.toFixed(3)}°N {selectedLive.lon.toFixed(3)}°E
          </div>
        </div>
      )}

      {selectedAc && (
        <div style={{
          position: 'absolute', top: 45, right: 10, zIndex: 30,
          background: 'rgba(0,0,0,0.85)', border: `1px solid ${altitudeColor(selectedAc.altitude)}25`,
          borderRadius: 5, padding: 10, width: 220, fontFamily: 'monospace', backdropFilter: 'blur(8px)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div dangerouslySetInnerHTML={{ __html: getSvgIcon(selectedAc.category, altitudeColor(selectedAc.altitude), 18) }} />
              <span style={{ fontSize: 12, fontWeight: 800, color: altitudeColor(selectedAc.altitude) }}>{selectedAc.callsign}</span>
            </div>
            <button onClick={() => setSelectedAc(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 11 }}>✕</button>
          </div>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)', marginBottom: 3 }}>{selectedAc.type}</div>
          <div style={{ marginBottom: 5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ flex: 1, height: 3, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                <div style={{
                  width: `${Math.min(100, (selectedAc.altitude / 55000) * 100)}%`,
                  height: '100%', borderRadius: 2,
                  background: `linear-gradient(90deg, #4caf50, ${altitudeColor(selectedAc.altitude)})`,
                }} />
              </div>
              <span style={{ fontSize: 9, fontWeight: 700, color: altitudeColor(selectedAc.altitude) }}>{selectedAc.altitude.toLocaleString()} ft</span>
            </div>
          </div>
          <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 }}>
            {selectedAc.mission && <div>🎯 {selectedAc.mission}</div>}
            {selectedAc.branch && <div>🏛️ {selectedAc.branch}</div>}
          </div>
        </div>
      )}

      {selectedSurface && (
        <div style={{
          position: 'absolute', top: 45, right: 10, zIndex: 30,
          background: 'rgba(0,0,0,0.85)', border: `1px solid ${selectedSurface.color}40`,
          borderRadius: 5, padding: 10, width: 220, fontFamily: 'monospace', backdropFilter: 'blur(8px)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <div dangerouslySetInnerHTML={{ __html: getSvgIcon(selectedSurface.type, selectedSurface.color, 18) }} />
              <span style={{ fontSize: 11, fontWeight: 800, color: selectedSurface.color }}>{selectedSurface.flag} {selectedSurface.name.split('(')[0]}</span>
            </div>
            <button onClick={() => setSelectedSurface(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 11 }}>✕</button>
          </div>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6 }}>
            <div>{selectedSurface.details}</div>
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 7 }}>
              {selectedSurface.lat.toFixed(2)}°N {selectedSurface.lon.toFixed(2)}°E • HDG {selectedSurface.bearing}°
            </div>
          </div>
        </div>
      )}

      {/* ═══ Oref Alert Detail Panel ═══ */}
      {selectedOref && (
        <div dir="rtl" style={{
          position: 'absolute', top: 45, right: 10, zIndex: 30,
          background: 'rgba(0,0,0,0.92)', border: '1px solid rgba(255,23,68,0.4)',
          borderRadius: 6, padding: 12, width: 240, fontFamily: 'monospace', backdropFilter: 'blur(10px)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 13, fontWeight: 800, color: '#ff1744' }}>🚨 {selectedOref.title}</span>
            <button onClick={() => setSelectedOref(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 12 }}>✕</button>
          </div>
          <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.6)', marginBottom: 4 }}>
            {selectedOref.locations?.join(', ')}
          </div>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.35)' }}>
            🕐 {selectedOref.alert_date ? new Date(selectedOref.alert_date).toLocaleTimeString('he-IL') : '—'}
          </div>
          {selectedOref.lat && selectedOref.lon && (
            <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.2)', marginTop: 4 }}>
              📍 {selectedOref.lat.toFixed(3)}°N {selectedOref.lon.toFixed(3)}°E
            </div>
          )}
          <button onClick={() => { if (selectedOref.lat && selectedOref.lon) { setAlertZoomTarget({ lat: selectedOref.lat, lon: selectedOref.lon }); setTimeout(() => setAlertZoomTarget(null), 4000); } }}
            style={{ marginTop: 6, width: '100%', padding: '4px', fontSize: 8, fontFamily: 'monospace', background: 'rgba(255,23,68,0.2)', border: '1px solid rgba(255,23,68,0.3)', borderRadius: 4, color: '#ff1744', cursor: 'pointer' }}>
            🎯 זום לאזור
          </button>
        </div>
      )}

      {/* ═══ Emergency Event Detail Panel ═══ */}
      {selectedEmergency && (
        <div dir="rtl" style={{
          position: 'absolute', top: 45, right: 10, zIndex: 30,
          background: 'rgba(0,0,0,0.92)', border: `1px solid ${selectedEmergency.color}40`,
          borderRadius: 6, padding: 12, width: 240, fontFamily: 'monospace', backdropFilter: 'blur(10px)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: selectedEmergency.color }}>
              {selectedEmergency.source?.includes('מד') ? '🚑' : selectedEmergency.source?.includes('כיבוי') ? '🔥' : '🚔'} {selectedEmergency.title}
            </span>
            <button onClick={() => setSelectedEmergency(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 12 }}>✕</button>
          </div>
          {selectedEmergency.description && <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>{selectedEmergency.description}</div>}
          <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.3)' }}>
            מקור: {selectedEmergency.source} • {selectedEmergency.event_time ? new Date(selectedEmergency.event_time).toLocaleTimeString('he-IL') : '—'}
          </div>
          {selectedEmergency.lat && selectedEmergency.lon && (
            <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.2)', marginTop: 3 }}>📍 {selectedEmergency.lat.toFixed(3)}°N {selectedEmergency.lon.toFixed(3)}°E</div>
          )}
        </div>
      )}

      {/* ═══ Maritime Vessel Detail Panel ═══ */}
      {selectedVessel && (() => {
        const isThreat = selectedVessel.type === 'threat' || selectedVessel.type === 'military_hostile';
        const vColor = isThreat ? '#ff1744' : selectedVessel.type === 'military_friendly' ? '#42a5f5' : '#4fc3f7';
        return (
          <div dir="ltr" style={{
            position: 'absolute', top: 45, right: 10, zIndex: 30,
            background: 'rgba(0,0,0,0.92)', border: `1px solid ${vColor}40`,
            borderRadius: 6, padding: 12, width: 240, fontFamily: 'monospace', backdropFilter: 'blur(10px)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 800, color: vColor }}>🚢 {selectedVessel.name}</span>
              <button onClick={() => setSelectedVessel(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 12 }}>✕</button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 12px', fontSize: 9 }}>
              <span style={{ color: '#78909c' }}>FLAG:</span><span>{selectedVessel.flag}</span>
              <span style={{ color: '#78909c' }}>TYPE:</span><span style={{ color: vColor }}>{selectedVessel.type.replace(/_/g, ' ').toUpperCase()}</span>
              <span style={{ color: '#78909c' }}>HEADING:</span><span>{selectedVessel.heading}°</span>
              <span style={{ color: '#78909c' }}>SPEED:</span><span>{selectedVessel.speed} kn</span>
              <span style={{ color: '#78909c' }}>SIZE:</span><span>{selectedVessel.tonnage}</span>
              <span style={{ color: '#78909c' }}>STATUS:</span><span style={{ color: isThreat ? '#ff1744' : '#4fc3f7' }}>{selectedVessel.status.replace(/_/g, ' ').toUpperCase()}</span>
            </div>
            <div style={{ marginTop: 6, fontSize: 7, color: '#546e7a', borderTop: '1px solid #ffffff10', paddingTop: 4 }}>
              📍 {selectedVessel.lat.toFixed(4)}°N, {selectedVessel.lon.toFixed(4)}°E
            </div>
            <button onClick={() => { setAlertZoomTarget({ lat: selectedVessel.lat, lon: selectedVessel.lon }); setTimeout(() => setAlertZoomTarget(null), 4000); }}
              style={{ marginTop: 6, width: '100%', padding: '4px', fontSize: 8, fontFamily: 'monospace', background: `${vColor}20`, border: `1px solid ${vColor}30`, borderRadius: 4, color: vColor, cursor: 'pointer' }}>
              🎯 ZOOM TO VESSEL
            </button>
          </div>
        );
      })()}

      {/* ═══ Telegram Impact Detail Panel ═══ */}
      {selectedTelegram && (
        <div dir="rtl" style={{
          position: 'absolute', top: 45, right: 10, zIndex: 30,
          background: 'rgba(0,0,0,0.92)', border: '1px solid rgba(255,109,0,0.4)',
          borderRadius: 6, padding: 12, width: 240, fontFamily: 'monospace', backdropFilter: 'blur(10px)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 800, color: '#ff6d00' }}>{selectedTelegram.icon} {selectedTelegram.label}</span>
            <button onClick={() => setSelectedTelegram(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 12 }}>✕</button>
          </div>
          <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.5)', marginBottom: 4 }}>{selectedTelegram.text?.slice(0, 120)}</div>
          <div style={{ fontSize: 7, color: selectedTelegram.credibility === 'verified' ? '#00e676' : '#ffab00' }}>
            {selectedTelegram.credibility === 'verified' ? '✅ מאומת' : selectedTelegram.credibility === 'corroborated' ? '🔄 מאושש' : '⚠️ ראשוני'}
          </div>
          <div style={{ fontSize: 7, color: 'rgba(255,255,255,0.2)', marginTop: 3 }}>📍 {selectedTelegram.lat.toFixed(3)}°N {selectedTelegram.lon.toFixed(3)}°E</div>
        </div>
      )}

      {/* ═══ Region Quick-Zoom Buttons ═══ */}
      <div style={{
        position: 'absolute', bottom: 50, left: 10, zIndex: 25, display: 'flex', flexDirection: 'column', gap: 3,
      }}>
        {[
          { label: '🇮🇱 צפון', lat: 33.0, lon: 35.5, alt: 40000 },
          { label: '🇮🇱 מרכז', lat: 32.0, lon: 34.8, alt: 30000 },
          { label: '🇮🇱 דרום', lat: 31.0, lon: 34.5, alt: 40000 },
          { label: '🇮🇱 ארצי', lat: 31.5, lon: 34.8, alt: 120000 },
          { label: '🚢 הורמוז', lat: 26.5, lon: 56.5, alt: 60000 },
          { label: '🇮🇷 איראן', lat: 33.0, lon: 53.0, alt: 200000 },
          { label: '🌍 אזור', lat: 30.0, lon: 44.0, alt: 380000 },
        ].map(r => (
          <button key={r.label} onClick={() => { setAlertZoomTarget({ lat: r.lat, lon: r.lon }); setTimeout(() => setAlertZoomTarget(null), 4000); }}
            style={{
              padding: '3px 8px', fontSize: 7, fontFamily: 'monospace', fontWeight: 700,
              background: 'rgba(0,0,0,0.75)', border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 4, color: 'rgba(255,255,255,0.7)', cursor: 'pointer',
              backdropFilter: 'blur(4px)', whiteSpace: 'nowrap',
              transition: 'all 0.15s',
            }}
            onMouseEnter={e => { (e.target as HTMLElement).style.background = 'rgba(59,130,246,0.3)'; }}
            onMouseLeave={e => { (e.target as HTMLElement).style.background = 'rgba(0,0,0,0.75)'; }}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div style={{
        position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 20,
        fontFamily: 'monospace', fontSize: 7, color: 'rgba(255,255,255,0.2)',
      }}>
        דאבל-קליק לזום • גרור לסיבוב • גלגלת לזום • לחץ על אירוע לפרטים
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

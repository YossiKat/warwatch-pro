// ═══════════════════════════════════════════════════════════════════════
// DisasterMonitor.tsx — ניטור אסונות טבע עולמי · מוכנות מדינות · צונאמי
// APIs: USGS · GDACS · NOAA · Pacific Tsunami Warning Center
// ═══════════════════════════════════════════════════════════════════════
import { useState, useEffect, useCallback } from "react";

// ─── TYPES ─────────────────────────────────────────────────────────────
type DisasterType =
  | "earthquake" | "tsunami" | "hurricane" | "flood"
  | "wildfire"   | "volcano" | "drought"   | "tornado"
  | "nuclear"    | "chemical";

type Severity = "catastrophic" | "critical" | "high" | "medium" | "low" | "watch";
type InfraStatus = "operational" | "degraded" | "critical" | "offline";

interface Disaster {
  id: string;
  type: DisasterType;
  title: string;
  location: string;
  country: string;
  countryCode: string;
  lat: number;
  lon: number;
  magnitude?: number;
  depth?: number;
  windSpeed?: number;
  category?: number;
  affectedKm2?: number;
  casualties?: number;
  severity: Severity;
  ts: Date;
  source: string;
  tsunamiRisk: boolean;
  evacuationRadius?: number;
  agencies: string[];
  updates: string[];
  status: "active" | "watch" | "warning" | "advisory" | "resolved";
}

interface CountryPreparedness {
  code: string;
  name: string;
  nameHe: string;
  flag: string;
  lat: number;
  lon: number;
  overallScore: number;
  infra: {
    water:     { status: InfraStatus; coverage: number; days: number };
    power:     { status: InfraStatus; coverage: number; backupHours: number };
    comms:     { status: InfraStatus; coverage: number };
    food:      { status: InfraStatus; days: number };
    medical:   { status: InfraStatus; hospitals: number; beds: number };
    transport: { status: InfraStatus; routes: number };
  };
  evacuation: {
    planExists: boolean;
    drillsPerYear: number;
    shelterCapacity: number;
    earlyWarningSystems: string[];
    responseTimeMin: number;
  };
  risks: DisasterType[];
  tier: "platinum" | "gold" | "silver" | "bronze" | "critical";
}

interface TsunamiAlert {
  id: string;
  active: boolean;
  level: "information" | "watch" | "advisory" | "warning" | "major-warning";
  triggerQuake?: { mag: number; depth: number; lat: number; lon: number };
  eta: Record<string, number>;
  waveHeight: Record<string, number>;
  issuer: string;
  ts: Date;
}

// ─── STATIC META ───────────────────────────────────────────────────────
const DISASTER_META: Record<DisasterType, { icon: string; label: string; color: string; bg: string }> = {
  earthquake: { icon: "🌍", label: "רעידת אדמה", color: "#ff8800", bg: "rgba(255,136,0,.1)" },
  tsunami:    { icon: "🌊", label: "צונאמי",     color: "#00e5ff", bg: "rgba(0,229,255,.1)" },
  hurricane:  { icon: "🌀", label: "הוריקן",     color: "#b040ff", bg: "rgba(176,64,255,.1)" },
  flood:      { icon: "💧", label: "שיטפון",     color: "#0088ff", bg: "rgba(0,136,255,.1)" },
  wildfire:   { icon: "🔥", label: "שריפת יער",  color: "#ff4400", bg: "rgba(255,68,0,.1)" },
  volcano:    { icon: "🌋", label: "הר געש",     color: "#ff2244", bg: "rgba(255,34,68,.1)" },
  drought:    { icon: "☀️", label: "בצורת",      color: "#ffd600", bg: "rgba(255,214,0,.1)" },
  tornado:    { icon: "🌪️", label: "טורנדו",     color: "#c0c0c0", bg: "rgba(192,192,192,.08)" },
  nuclear:    { icon: "☢️", label: "גרעיני",     color: "#ff2244", bg: "rgba(255,34,68,.15)" },
  chemical:   { icon: "🧪", label: "כימי",       color: "#00ff88", bg: "rgba(0,255,136,.08)" },
};

const SEV_META: Record<Severity, { label: string; color: string; bg: string; pulse: boolean }> = {
  catastrophic: { label: "קטסטרופלי", color: "#ff0022", bg: "rgba(255,0,34,.15)",  pulse: true },
  critical:     { label: "קריטי",     color: "#ff2244", bg: "rgba(255,34,68,.12)", pulse: true },
  high:         { label: "גבוה",      color: "#ff8800", bg: "rgba(255,136,0,.08)", pulse: false },
  medium:       { label: "בינוני",    color: "#ffd600", bg: "rgba(255,214,0,.06)", pulse: false },
  low:          { label: "נמוך",      color: "#00ff88", bg: "rgba(0,255,136,.05)", pulse: false },
  watch:        { label: "כוננות",    color: "#00e5ff", bg: "rgba(0,229,255,.05)", pulse: false },
};

const INFRA_META: Record<InfraStatus, { color: string; label: string; dot: string }> = {
  operational: { color: "#00ff88", label: "תקין",  dot: "🟢" },
  degraded:    { color: "#ffd600", label: "פגוע",  dot: "🟡" },
  critical:    { color: "#ff8800", label: "קריטי", dot: "🟠" },
  offline:     { color: "#ff2244", label: "מושבת", dot: "🔴" },
};

const TIER_META = {
  platinum: { label: "פלטינום", color: "#e0e8ff", icon: "🏆" },
  gold:     { label: "זהב",     color: "#ffd600", icon: "🥇" },
  silver:   { label: "כסף",     color: "#c0c8d8", icon: "🥈" },
  bronze:   { label: "ארד",     color: "#cd8060", icon: "🥉" },
  critical: { label: "קריטי",   color: "#ff2244", icon: "🚨" },
};

// ─── COUNTRIES ─────────────────────────────────────────────────────────
const COUNTRIES: CountryPreparedness[] = [
  {
    code: "JP", name: "Japan", nameHe: "יפן", flag: "🇯🇵", lat: 35.6, lon: 139.7, overallScore: 96,
    infra: {
      water:     { status: "operational", coverage: 99, days: 30 },
      power:     { status: "operational", coverage: 99, backupHours: 72 },
      comms:     { status: "operational", coverage: 98 },
      food:      { status: "operational", days: 90 },
      medical:   { status: "operational", hospitals: 8400, beds: 1380000 },
      transport: { status: "operational", routes: 280 },
    },
    evacuation: { planExists: true, drillsPerYear: 12, shelterCapacity: 22000,
      earlyWarningSystems: ["J-Alert", "Earthquake Early Warning", "Tsunami Warning", "PLUM"], responseTimeMin: 4 },
    risks: ["earthquake", "tsunami", "volcano"], tier: "platinum",
  },
  {
    code: "US", name: "United States", nameHe: "ארה\"ב", flag: "🇺🇸", lat: 38.9, lon: -77.0, overallScore: 88,
    infra: {
      water:     { status: "operational", coverage: 98, days: 60 },
      power:     { status: "degraded",    coverage: 96, backupHours: 48 },
      comms:     { status: "operational", coverage: 97 },
      food:      { status: "operational", days: 120 },
      medical:   { status: "operational", hospitals: 6100, beds: 920000 },
      transport: { status: "operational", routes: 450 },
    },
    evacuation: { planExists: true, drillsPerYear: 6, shelterCapacity: 85000,
      earlyWarningSystems: ["NOAA NWS", "FEMA Alerts", "WEA", "EAS", "Tsunami Warning Centers"], responseTimeMin: 8 },
    risks: ["hurricane", "tornado", "wildfire", "earthquake", "flood"], tier: "platinum",
  },
  {
    code: "IL", name: "Israel", nameHe: "ישראל", flag: "🇮🇱", lat: 31.77, lon: 35.21, overallScore: 81,
    infra: {
      water:     { status: "operational", coverage: 99, days: 45 },
      power:     { status: "operational", coverage: 99, backupHours: 24 },
      comms:     { status: "operational", coverage: 98 },
      food:      { status: "operational", days: 30 },
      medical:   { status: "operational", hospitals: 47, beds: 18000 },
      transport: { status: "operational", routes: 38 },
    },
    evacuation: { planExists: true, drillsPerYear: 4, shelterCapacity: 8200,
      earlyWarningSystems: ["OREF / פיקוד העורף", "Tzofar Red", "Home Front Command"], responseTimeMin: 6 },
    risks: ["earthquake", "flood", "wildfire"], tier: "gold",
  },
  {
    code: "TR", name: "Turkey", nameHe: "טורקיה", flag: "🇹🇷", lat: 39.9, lon: 32.8, overallScore: 58,
    infra: {
      water:     { status: "degraded", coverage: 87, days: 14 },
      power:     { status: "degraded", coverage: 88, backupHours: 8 },
      comms:     { status: "degraded", coverage: 85 },
      food:      { status: "degraded", days: 21 },
      medical:   { status: "degraded", hospitals: 1520, beds: 240000 },
      transport: { status: "degraded", routes: 48 },
    },
    evacuation: { planExists: true, drillsPerYear: 2, shelterCapacity: 1800,
      earlyWarningSystems: ["AFAD", "KANDILLI Observatory"], responseTimeMin: 22 },
    risks: ["earthquake", "tsunami", "flood", "wildfire"], tier: "silver",
  },
  {
    code: "ID", name: "Indonesia", nameHe: "אינדונזיה", flag: "🇮🇩", lat: -6.2, lon: 106.8, overallScore: 44,
    infra: {
      water:     { status: "critical", coverage: 72, days: 7 },
      power:     { status: "degraded", coverage: 78, backupHours: 4 },
      comms:     { status: "degraded", coverage: 74 },
      food:      { status: "degraded", days: 14 },
      medical:   { status: "critical", hospitals: 2800, beds: 340000 },
      transport: { status: "critical", routes: 22 },
    },
    evacuation: { planExists: true, drillsPerYear: 3, shelterCapacity: 2400,
      earlyWarningSystems: ["InaTEWS", "BMKG", "Local sirens"], responseTimeMin: 35 },
    risks: ["earthquake", "tsunami", "volcano", "flood"], tier: "bronze",
  },
  {
    code: "BD", name: "Bangladesh", nameHe: "בנגלדש", flag: "🇧🇩", lat: 23.7, lon: 90.4, overallScore: 28,
    infra: {
      water:     { status: "critical", coverage: 55, days: 3 },
      power:     { status: "critical", coverage: 62, backupHours: 2 },
      comms:     { status: "critical", coverage: 61 },
      food:      { status: "critical", days: 7 },
      medical:   { status: "critical", hospitals: 670, beds: 82000 },
      transport: { status: "offline",  routes: 8 },
    },
    evacuation: { planExists: true, drillsPerYear: 1, shelterCapacity: 600,
      earlyWarningSystems: ["CPP/HPP", "Local radio"], responseTimeMin: 55 },
    risks: ["flood", "drought"], tier: "critical",
  },
  {
    code: "DE", name: "Germany", nameHe: "גרמניה", flag: "🇩🇪", lat: 52.5, lon: 13.4, overallScore: 91,
    infra: {
      water:     { status: "operational", coverage: 99, days: 90 },
      power:     { status: "operational", coverage: 99, backupHours: 72 },
      comms:     { status: "operational", coverage: 98 },
      food:      { status: "operational", days: 180 },
      medical:   { status: "operational", hospitals: 1900, beds: 480000 },
      transport: { status: "operational", routes: 180 },
    },
    evacuation: { planExists: true, drillsPerYear: 4, shelterCapacity: 14000,
      earlyWarningSystems: ["MoWaS", "NINA App", "BBK"], responseTimeMin: 6 },
    risks: ["flood", "wildfire"], tier: "platinum",
  },
  {
    code: "HT", name: "Haiti", nameHe: "האיטי", flag: "🇭🇹", lat: 18.5, lon: -72.3, overallScore: 9,
    infra: {
      water:     { status: "offline", coverage: 30, days: 1 },
      power:     { status: "offline", coverage: 25, backupHours: 0 },
      comms:     { status: "offline", coverage: 28 },
      food:      { status: "offline", days: 2 },
      medical:   { status: "offline", hospitals: 49, beds: 7000 },
      transport: { status: "offline", routes: 3 },
    },
    evacuation: { planExists: false, drillsPerYear: 0, shelterCapacity: 80,
      earlyWarningSystems: ["ללא מערכת מוסדית"], responseTimeMin: 180 },
    risks: ["earthquake", "hurricane", "flood"], tier: "critical",
  },
];

// ─── SEED DISASTERS ────────────────────────────────────────────────────
const SEED_DISASTERS: Omit<Disaster, "id" | "ts">[] = [
  { type: "earthquake", title: "רעידת אדמה 7.1 — יפן", location: "טוקיו", country: "יפן", countryCode: "JP",
    lat: 35.65, lon: 139.78, magnitude: 7.1, depth: 15, severity: "critical", source: "USGS / JMA",
    tsunamiRisk: true, evacuationRadius: 50, agencies: ["JMA", "NIED", "Japan Self-Defense Force"],
    updates: ["USGS אימתה גודל 7.1", "J-Alert הופעל אוטומטית", "כוחות חירום מופעלים"], status: "warning" },
  { type: "tsunami", title: "אזהרת צונאמי — האוקיאנוס השקט", location: "חוף מערבי", country: "פסיפיק", countryCode: "PF",
    lat: 40.0, lon: 145.0, magnitude: 8.2, severity: "catastrophic", source: "PTWC",
    tsunamiRisk: true, evacuationRadius: 200, agencies: ["PTWC", "JMA", "NOAA", "IOC/UNESCO"],
    updates: ["PTWC הוציא Major Warning", "גל צפוי: 3-8 מטר", "פינוי חובה בחופי יפן"], status: "warning" },
  { type: "hurricane", title: "הוריקן קטגוריה 4 — מפרץ מקסיקו", location: "לואיזיאנה", country: "ארה\"ב", countryCode: "US",
    lat: 29.95, lon: -90.07, windSpeed: 230, category: 4, severity: "critical", source: "NOAA NHC",
    tsunamiRisk: false, evacuationRadius: 150, agencies: ["FEMA", "NHC", "USACE"],
    updates: ["NHC: רוחות 230 km/h", "פינוי חובה 3 parishes", "כוח National Guard מופעל"], status: "warning" },
  { type: "volcano", title: "התפרצות הר הגעש — איסלנד", location: "ריקיאנס", country: "איסלנד", countryCode: "IS",
    lat: 63.99, lon: -22.24, severity: "high", source: "IMO",
    tsunamiRisk: false, evacuationRadius: 5, agencies: ["IMO", "Civil Protection Iceland"],
    updates: ["ענן אפר 8 km", "SIGMET פעיל — תעופה נפגעת", "עיירה Grindavík פונתה"], status: "active" },
  { type: "earthquake", title: "רעידת אדמה 6.4 — תורכיה", location: "קהרמנמראש", country: "תורכיה", countryCode: "TR",
    lat: 37.58, lon: 36.92, magnitude: 6.4, depth: 8, severity: "high", source: "KANDILLI / AFAD",
    tsunamiRisk: false, evacuationRadius: 30, agencies: ["AFAD", "Red Crescent", "UN OCHA"],
    updates: ["AFAD: 6.4 Mw", "מבנים התמוטטו", "צוותי חיפוש וחילוץ בדרך"], status: "active" },
  { type: "flood", title: "שיטפון קיצוני — בנגלדש", location: "סילהט", country: "בנגלדש", countryCode: "BD",
    lat: 24.89, lon: 91.88, affectedKm2: 8400, casualties: 47, severity: "critical", source: "BWDB",
    tsunamiRisk: false, agencies: ["BWDB", "Bangladesh Army", "UNICEF"],
    updates: ["2.4M איש פונו", "גשרים קרסו", "עזרה בינלאומית מגיעה"], status: "active" },
  { type: "wildfire", title: "שריפת יער — יוון", location: "אתיקה", country: "יוון", countryCode: "GR",
    lat: 38.05, lon: 23.85, affectedKm2: 190, severity: "high", source: "EFSA",
    tsunamiRisk: false, evacuationRadius: 10, agencies: ["Greek Fire Service", "EU Copernicus", "EFSA"],
    updates: ["190 km² שרפו", "700 כבאים בשטח", "12 כפרים פונו"], status: "active" },
  { type: "earthquake", title: "רעידת אדמה 5.6 — ישראל", location: "ים המלח", country: "ישראל", countryCode: "IL",
    lat: 31.55, lon: 35.48, magnitude: 5.6, depth: 20, severity: "medium", source: "GII",
    tsunamiRisk: false, agencies: ["GII", "OREF", "משרד הפנים"],
    updates: ["5.6 Mb לפי GII", "ללא נפגעים מדווחים", "פיקוד העורף במעקב"], status: "watch" },
];

const DEMO_TSUNAMI: TsunamiAlert = {
  id: "tw-2024-001", active: false, level: "warning",
  triggerQuake: { mag: 8.2, depth: 12, lat: 40.0, lon: 145.0 },
  eta: { "יפן": 12, "הפיליפינים": 85, "הוואי": 380, "קליפורניה": 540, "ישראל": 9999 },
  waveHeight: { "יפן": 6.5, "הפיליפינים": 2.1, "הוואי": 0.8 },
  issuer: "Pacific Tsunami Warning Center (PTWC)", ts: new Date(),
};

// ─── HELPERS ───────────────────────────────────────────────────────────
function timeAgo(ts: Date): string {
  const diff = (Date.now() - ts.getTime()) / 60000;
  if (diff < 1) return "עכשיו";
  if (diff < 60) return `${Math.floor(diff)} דק'`;
  if (diff < 1440) return `${Math.floor(diff / 60)} ש'`;
  return `${Math.floor(diff / 1440)} ימ'`;
}

function ScoreRing({ score, size = 56 }: { score: number; size?: number }) {
  const r = (size / 2) - 5;
  const circ = 2 * Math.PI * r;
  const pct = score / 100;
  const color = score >= 80 ? "#00ff88" : score >= 60 ? "#ffd600" : score >= 40 ? "#ff8800" : "#ff2244";
  return (
    <svg width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#112233" strokeWidth={4} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4}
        strokeDasharray={`${circ * pct} ${circ * (1 - pct)}`} strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x={size / 2} y={size / 2 + 5} textAnchor="middle"
        style={{ fill: color, fontSize: "13px", fontWeight: 700, fontFamily: "monospace" }}>
        {score}
      </text>
    </svg>
  );
}

function InfraBar({ status, coverage, label }: { status: InfraStatus; coverage: number; label: string }) {
  const m = INFRA_META[status];
  return (
    <div style={{ marginBottom: "8px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px", fontSize: "9px" }}>
        <span style={{ color: "#5a7a8a" }}>{label}</span>
        <span style={{ color: m.color, fontFamily: "monospace" }}>{coverage}% · {m.dot} {m.label}</span>
      </div>
      <div style={{ height: "3px", background: "#112233", borderRadius: "2px" }}>
        <div style={{ height: "100%", width: `${coverage}%`, background: m.color, borderRadius: "2px", transition: "width .6s" }} />
      </div>
    </div>
  );
}

// ─── TSUNAMI OVERLAY ───────────────────────────────────────────────────
function TsunamiOverlay({ alert, onClose }: { alert: TsunamiAlert; onClose: () => void }) {
  if (!alert.active) return null;
  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 999, background: "rgba(0,0,0,.92)",
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      animation: "tsFlash 1s infinite",
    }}>
      <div style={{
        background: "#0a0015", border: "3px solid #ff0022", borderRadius: "16px",
        padding: "32px 40px", maxWidth: "700px", width: "90%", textAlign: "center", direction: "rtl",
        boxShadow: "0 0 80px rgba(255,0,34,.4)",
      }}>
        <div style={{ fontSize: "60px", marginBottom: "12px", animation: "wave 1s ease-in-out infinite" }}>🌊</div>
        <div style={{
          fontFamily: "'Orbitron',monospace", fontSize: "22px", fontWeight: 900,
          color: "#ff0022", letterSpacing: "4px", marginBottom: "4px",
        }}>אזהרת צונאמי</div>
        <div style={{ fontSize: "11px", color: "#ff6688", letterSpacing: "2px", marginBottom: "24px" }}>
          TSUNAMI WARNING — {alert.issuer}
        </div>

        {alert.triggerQuake && (
          <div style={{
            background: "rgba(255,0,34,.08)", border: "1px solid rgba(255,0,34,.3)",
            borderRadius: "10px", padding: "12px 16px", marginBottom: "20px",
            display: "flex", justifyContent: "space-around",
          }}>
            {[
              { l: "עוצמה", v: `M${alert.triggerQuake.mag}` },
              { l: "עומק", v: `${alert.triggerQuake.depth} km` },
              { l: "מיקום", v: `${alert.triggerQuake.lat.toFixed(1)}°N ${alert.triggerQuake.lon.toFixed(1)}°E` },
            ].map(r => (
              <div key={r.l}>
                <div style={{ fontSize: "10px", color: "#5a7a8a", marginBottom: "2px" }}>{r.l}</div>
                <div style={{ fontFamily: "monospace", color: "#fff", fontSize: "14px", fontWeight: 700 }}>{r.v}</div>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginBottom: "20px" }}>
          <div style={{ fontSize: "10px", color: "#5a7a8a", letterSpacing: "2px", marginBottom: "10px" }}>
            זמן הגעה משוער · גובה גל
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "8px" }}>
            {Object.entries(alert.eta).filter(([, v]) => v < 1000).map(([loc, min]) => (
              <div key={loc} style={{
                background: "rgba(0,0,0,.4)", border: "1px solid rgba(255,0,34,.2)",
                borderRadius: "8px", padding: "10px 6px",
              }}>
                <div style={{ fontSize: "11px", color: "#b8d4e8", marginBottom: "3px" }}>{loc}</div>
                <div style={{
                  fontFamily: "monospace", fontSize: "18px", fontWeight: 700,
                  color: min < 30 ? "#ff0022" : min < 90 ? "#ff8800" : "#ffd600",
                }}>
                  {min < 60 ? `${min}′` : `${Math.floor(min / 60)}h ${min % 60}′`}
                </div>
                {alert.waveHeight[loc] && (
                  <div style={{ fontSize: "10px", color: "#00e5ff", marginTop: "2px" }}>
                    גל: ~{alert.waveHeight[loc]}m
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div style={{
          background: "rgba(255,0,34,.1)", border: "1px solid rgba(255,0,34,.3)",
          borderRadius: "10px", padding: "12px", marginBottom: "20px",
          fontSize: "13px", color: "#ff4466", fontWeight: 700, lineHeight: 1.6,
        }}>
          🚨 פנה לאזורים גבוהים מעל 30 מטר מעל פני הים<br />
          🚫 אל תגש לחוף עד לביטול האזהרה<br />
          📻 עקוב אחר עדכוני רדיו / טלוויזיה
        </div>

        <button onClick={onClose} style={{
          padding: "10px 28px", borderRadius: "8px", border: "1px solid #333",
          background: "rgba(255,255,255,.05)", color: "#5a7a8a",
          fontFamily: "inherit", fontSize: "10px", cursor: "pointer", letterSpacing: "1px",
        }}>
          ✕ סגור (לצפייה בלבד)
        </button>
      </div>

      <style>{`
        @keyframes tsFlash { 0%,100%{background:rgba(0,0,0,.92)} 50%{background:rgba(30,0,5,.95)} }
        @keyframes wave { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-8px)} }
      `}</style>
    </div>
  );
}

// ─── MAIN COMPONENT ────────────────────────────────────────────────────
export default function DisasterMonitor() {
  const [disasters, setDisasters] = useState<Disaster[]>([]);
  const [selectedDisaster, setSelectedDisaster] = useState<Disaster | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<CountryPreparedness | null>(null);
  const [tsunamiAlert, setTsunamiAlert] = useState<TsunamiAlert>({ ...DEMO_TSUNAMI });
  const [activeTab, setActiveTab] = useState<"disasters" | "countries" | "tsunami">("disasters");
  const [typeFilter, setTypeFilter] = useState<DisasterType | "all">("all");
  const [lastFetch, setLastFetch] = useState(new Date());
  const [fetching, setFetching] = useState(false);
  const [globalStats, setGlobalStats] = useState({ total: 0, critical: 0, tsunami: 0, evacuations: 0 });

  const fetchLiveData = useCallback(async () => {
    setFetching(true);
    try {
      const usgsRes = await fetch(
        "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson",
        { signal: AbortSignal.timeout(8000) }
      );
      if (usgsRes.ok) {
        const data = await usgsRes.json();
        const quakes: Disaster[] = (data.features || []).slice(0, 15).map((f: any) => ({
          id: f.id,
          type: "earthquake" as DisasterType,
          title: `רעידת אדמה M${f.properties.mag.toFixed(1)} — ${f.properties.place}`,
          location: f.properties.place,
          country: f.properties.place?.split(", ").pop() || "—",
          countryCode: "XX",
          lat: f.geometry.coordinates[1],
          lon: f.geometry.coordinates[0],
          magnitude: f.properties.mag,
          depth: f.geometry.coordinates[2],
          severity: (f.properties.mag >= 7.5 ? "catastrophic"
            : f.properties.mag >= 6.5 ? "critical"
            : f.properties.mag >= 5.5 ? "high"
            : f.properties.mag >= 4.5 ? "medium" : "low") as Severity,
          ts: new Date(f.properties.time),
          source: "USGS",
          tsunamiRisk: f.properties.tsunami > 0,
          agencies: ["USGS"],
          updates: [`USGS: M${f.properties.mag.toFixed(1)}`],
          status: (f.properties.alert || "watch") as any,
        }));
        setDisasters(quakes);
        setLastFetch(new Date());
      }
    } catch {
      /* fallback to seed */
    } finally {
      setFetching(false);
    }
  }, []);

  useEffect(() => {
    const seeded = SEED_DISASTERS.map((d, i) => ({
      ...d, id: `seed-${i}`, ts: new Date(Date.now() - Math.random() * 7200000),
    }));
    setDisasters(seeded);
    fetchLiveData();
    const id = setInterval(fetchLiveData, 120_000);
    return () => clearInterval(id);
  }, [fetchLiveData]);

  useEffect(() => {
    setGlobalStats({
      total: disasters.length,
      critical: disasters.filter(d => d.severity === "critical" || d.severity === "catastrophic").length,
      tsunami: disasters.filter(d => d.tsunamiRisk).length,
      evacuations: disasters.filter(d => d.evacuationRadius).length,
    });
  }, [disasters]);

  const displayed = typeFilter === "all" ? disasters : disasters.filter(d => d.type === typeFilter);

  return (
    <div style={{
      background: "#03080d", color: "#b8d4e8", fontFamily: "'Orbitron',monospace",
      minHeight: "100vh", direction: "rtl",
    }}>
      <TsunamiOverlay alert={tsunamiAlert} onClose={() => setTsunamiAlert(a => ({ ...a, active: false }))} />

      {/* HEADER */}
      <div style={{
        background: "rgba(6,14,22,.97)", borderBottom: "1px solid #112233",
        padding: "12px 20px", display: "flex", alignItems: "center", gap: "14px",
        position: "sticky", top: 0, zIndex: 50,
      }}>
        <span style={{ fontSize: "22px" }}>🌍</span>
        <span style={{
          fontSize: "13px", letterSpacing: "3px", fontWeight: 900,
          background: "linear-gradient(135deg,#ff8800,#ff2244)",
          WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
        }}>DISASTER MONITOR</span>
        <div style={{
          width: "7px", height: "7px", borderRadius: "50%", background: "#00ff88",
          boxShadow: "0 0 8px #00ff88", animation: "blink 1.5s infinite",
        }} />
        <span style={{ fontSize: "8px", color: "#2a4458" }}>LIVE · {lastFetch.toLocaleTimeString("he-IL")}</span>
        <div style={{ marginRight: "auto", display: "flex", gap: "8px" }}>
          <button onClick={fetchLiveData} disabled={fetching} style={{
            padding: "5px 14px", borderRadius: "16px", border: "1px solid #112233",
            background: "rgba(0,255,136,.06)", color: "#00ff88",
            fontSize: "9px", cursor: "pointer", fontFamily: "inherit", letterSpacing: "1px",
          }}>{fetching ? "⏳" : "🔄"} USGS Live</button>
          <button onClick={() => setTsunamiAlert(a => ({ ...a, active: true }))} style={{
            padding: "5px 14px", borderRadius: "16px", border: "1px solid rgba(0,229,255,.3)",
            background: "rgba(0,229,255,.08)", color: "#00e5ff",
            fontSize: "9px", cursor: "pointer", fontFamily: "inherit", letterSpacing: "1px",
          }}>🌊 צונאמי DEMO</button>
        </div>
      </div>

      <div style={{ padding: "14px 18px", maxWidth: "1300px", margin: "0 auto" }}>
        {/* STATS */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: "10px", marginBottom: "16px" }}>
          {[
            { n: globalStats.total, l: "אירועים פעילים", c: "#b8d4e8", i: "🌍" },
            { n: globalStats.critical, l: "קריטי/קטסטרופלי", c: "#ff2244", i: "🚨" },
            { n: globalStats.tsunami, l: "סיכון צונאמי", c: "#00e5ff", i: "🌊" },
            { n: globalStats.evacuations, l: "פינוי פעיל", c: "#ffd600", i: "🏃" },
          ].map(s => (
            <div key={s.l} style={{
              background: "rgba(6,14,22,.85)", border: `1px solid ${s.c}22`,
              borderRadius: "12px", padding: "14px", textAlign: "center",
            }}>
              <div style={{ fontSize: "20px", marginBottom: "4px" }}>{s.i}</div>
              <div style={{ fontSize: "24px", fontWeight: 900, color: s.c }}>{s.n}</div>
              <div style={{ fontSize: "8px", color: "#2a4458", letterSpacing: "1px", marginTop: "4px" }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* TABS */}
        <div style={{
          display: "flex", gap: "4px", marginBottom: "14px",
          background: "rgba(6,14,22,.85)", border: "1px solid #112233", borderRadius: "20px",
          padding: "4px", width: "fit-content",
        }}>
          {([
            { k: "disasters", l: "⚡ אסונות", c: "#ff8800" },
            { k: "countries", l: "🌐 מדינות", c: "#00e5ff" },
            { k: "tsunami", l: "🌊 צונאמי", c: "#b040ff" },
          ] as const).map(t => (
            <button key={t.k} onClick={() => setActiveTab(t.k)} style={{
              padding: "7px 20px", borderRadius: "16px", border: "none",
              background: activeTab === t.k ? `${t.c}18` : "transparent",
              color: activeTab === t.k ? t.c : "#2a4458",
              fontSize: "10px", cursor: "pointer", fontFamily: "inherit", letterSpacing: "1px",
              borderBottom: activeTab === t.k ? `2px solid ${t.c}` : "2px solid transparent",
              transition: "all .2s",
            }}>{t.l}</button>
          ))}
        </div>

        {/* DISASTERS TAB */}
        {activeTab === "disasters" && (
          <>
            <div style={{ display: "flex", gap: "5px", marginBottom: "12px", flexWrap: "wrap" }}>
              <button onClick={() => setTypeFilter("all")} style={{
                padding: "4px 12px", borderRadius: "12px", border: "1px solid #112233",
                background: typeFilter === "all" ? "rgba(255,255,255,.08)" : "transparent",
                color: typeFilter === "all" ? "#fff" : "#2a4458",
                fontSize: "9px", cursor: "pointer", fontFamily: "inherit",
              }}>הכל</button>
              {(Object.keys(DISASTER_META) as DisasterType[]).map(k => {
                const m = DISASTER_META[k];
                return (
                  <button key={k} onClick={() => setTypeFilter(k)} style={{
                    padding: "4px 12px", borderRadius: "12px", border: "1px solid #112233",
                    background: typeFilter === k ? m.bg : "transparent",
                    color: typeFilter === k ? m.color : "#2a4458",
                    fontSize: "9px", cursor: "pointer", fontFamily: "inherit",
                  }}>{m.icon} {m.label}</button>
                );
              })}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {displayed.sort((a, b) => {
                const order: Record<Severity, number> = { catastrophic: 0, critical: 1, high: 2, medium: 3, low: 4, watch: 5 };
                return order[a.severity] - order[b.severity];
              }).map(d => {
                const dm = DISASTER_META[d.type];
                const sm = SEV_META[d.severity];
                const isSelected = selectedDisaster?.id === d.id;
                return (
                  <div key={d.id} onClick={() => setSelectedDisaster(isSelected ? null : d)}
                    style={{
                      background: isSelected ? sm.bg : "rgba(6,14,22,.85)",
                      border: `1px solid ${isSelected ? sm.color + "55" : "#112233"}`,
                      borderRight: `4px solid ${sm.color}`,
                      borderRadius: "10px", padding: "12px 16px", cursor: "pointer",
                      animation: sm.pulse ? "alertPulse 2s infinite" : "none",
                      transition: "background .2s",
                    }}>
                    <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                      <span style={{ fontSize: "26px", flexShrink: 0 }}>{dm.icon}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                          <div style={{ fontSize: "13px", color: "#fff", fontWeight: 700 }}>{d.title}</div>
                          <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                            {d.tsunamiRisk && (
                              <span style={{
                                fontSize: "9px", padding: "2px 8px", borderRadius: "8px",
                                background: "rgba(0,229,255,.1)", color: "#00e5ff",
                                border: "1px solid rgba(0,229,255,.2)",
                              }}>🌊 צונאמי</span>
                            )}
                            <span style={{
                              fontSize: "9px", padding: "2px 8px", borderRadius: "8px",
                              background: sm.bg, color: sm.color, border: `1px solid ${sm.color}44`,
                            }}>{sm.label}</span>
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: "12px", marginTop: "5px", fontSize: "9px", color: "#5a7a8a", flexWrap: "wrap" }}>
                          <span>📍 {d.location}, {d.country}</span>
                          {d.magnitude !== undefined && <span>📊 M{d.magnitude.toFixed(1)}</span>}
                          {d.depth !== undefined && <span>⬇ {d.depth}km</span>}
                          {d.windSpeed !== undefined && <span>💨 {d.windSpeed} km/h</span>}
                          {d.evacuationRadius !== undefined && <span>🏃 פינוי {d.evacuationRadius}km</span>}
                          <span>🕐 {timeAgo(d.ts)}</span>
                          <span>📡 {d.source}</span>
                        </div>

                        {isSelected && (
                          <div style={{ marginTop: "12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                            <div style={{ background: "rgba(0,0,0,.4)", borderRadius: "8px", padding: "10px" }}>
                              <div style={{ fontSize: "8px", color: "#2a4458", letterSpacing: "2px", marginBottom: "8px" }}>
                                עדכונים
                              </div>
                              {d.updates.map((u, i) => (
                                <div key={i} style={{
                                  fontSize: "10px", color: "#b8d4e8", padding: "4px 0",
                                  borderBottom: "1px solid #112233", lineHeight: 1.5,
                                }}>
                                  <span style={{ color: sm.color, marginLeft: "6px" }}>›</span>{u}
                                </div>
                              ))}
                            </div>
                            <div style={{ background: "rgba(0,0,0,.4)", borderRadius: "8px", padding: "10px" }}>
                              <div style={{ fontSize: "8px", color: "#2a4458", letterSpacing: "2px", marginBottom: "8px" }}>
                                גופים מטפלים
                              </div>
                              {d.agencies.map(a => (
                                <div key={a} style={{
                                  fontSize: "10px", color: "#b8d4e8", padding: "4px 0",
                                  borderBottom: "1px solid #112233",
                                }}>🏛 {a}</div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* COUNTRIES TAB */}
        {activeTab === "countries" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: "12px" }}>
            {[...COUNTRIES].sort((a, b) => b.overallScore - a.overallScore).map(c => {
              const tm = TIER_META[c.tier];
              const isSelected = selectedCountry?.code === c.code;
              return (
                <div key={c.code} onClick={() => setSelectedCountry(isSelected ? null : c)}
                  style={{
                    background: "rgba(6,14,22,.85)",
                    border: `1px solid ${isSelected ? "#00e5ff44" : "#112233"}`,
                    borderRadius: "14px", padding: "16px", cursor: "pointer", transition: "all .2s",
                  }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ fontSize: "28px" }}>{c.flag}</span>
                      <div>
                        <div style={{ fontSize: "14px", color: "#fff", fontWeight: 700 }}>{c.nameHe}</div>
                        <div style={{ fontSize: "9px", color: "#2a4458" }}>{c.name}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
                      <ScoreRing score={c.overallScore} />
                      <span style={{
                        fontSize: "8px", padding: "2px 8px", borderRadius: "8px",
                        background: `${tm.color}15`, color: tm.color, letterSpacing: "1px",
                      }}>{tm.icon} {tm.label}</span>
                    </div>
                  </div>

                  <InfraBar status={c.infra.water.status} coverage={c.infra.water.coverage} label="💧 מים" />
                  <InfraBar status={c.infra.power.status} coverage={c.infra.power.coverage} label="⚡ חשמל" />
                  <InfraBar status={c.infra.comms.status} coverage={c.infra.comms.coverage} label="📡 תקשורת" />
                  <InfraBar status={c.infra.medical.status} coverage={Math.min(100, c.infra.medical.hospitals / 100)} label="🏥 רפואה" />

                  <div style={{
                    display: "flex", gap: "6px", marginTop: "10px", paddingTop: "10px",
                    borderTop: "1px solid #112233", flexWrap: "wrap",
                  }}>
                    {[
                      { l: "תגובה", v: `${c.evacuation.responseTimeMin}′` },
                      { l: "תרגילים", v: `${c.evacuation.drillsPerYear}/y` },
                      { l: "מחסות", v: `${(c.evacuation.shelterCapacity / 1000).toFixed(1)}K` },
                    ].map(r => (
                      <div key={r.l} style={{
                        background: "rgba(0,0,0,.3)", borderRadius: "6px", padding: "5px 10px", textAlign: "center",
                      }}>
                        <div style={{ fontSize: "11px", color: "#fff", fontWeight: 700, fontFamily: "monospace" }}>{r.v}</div>
                        <div style={{ fontSize: "7px", color: "#2a4458" }}>{r.l}</div>
                      </div>
                    ))}
                    <div style={{ flex: 1, fontSize: "8px", color: "#2a4458", alignSelf: "center", textAlign: "left" }}>
                      {c.evacuation.earlyWarningSystems.slice(0, 2).join(" · ")}
                    </div>
                  </div>

                  {isSelected && (
                    <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #112233" }}>
                      <div style={{ fontSize: "8px", color: "#2a4458", letterSpacing: "2px", marginBottom: "8px" }}>
                        מערכות התראה מוקדמת
                      </div>
                      {c.evacuation.earlyWarningSystems.map(s => (
                        <div key={s} style={{
                          fontSize: "9px", color: "#00e5ff", padding: "3px 0",
                          borderBottom: "1px solid #112233",
                        }}>● {s}</div>
                      ))}
                      <div style={{ marginTop: "10px", fontSize: "8px", color: "#2a4458", letterSpacing: "2px", marginBottom: "6px" }}>
                        סיכוני טבע
                      </div>
                      <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
                        {c.risks.map(r => {
                          const dm = DISASTER_META[r];
                          if (!dm) return null;
                          return (
                            <span key={r} style={{
                              fontSize: "9px", padding: "2px 8px", borderRadius: "8px",
                              background: dm.bg, color: dm.color, border: `1px solid ${dm.color}33`,
                            }}>{dm.icon} {dm.label}</span>
                          );
                        })}
                      </div>
                      <div style={{ marginTop: "10px", display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "8px", fontSize: "9px" }}>
                        <div><span style={{ color: "#2a4458" }}>מים (ימים): </span><span style={{ color: "#00ff88" }}>{c.infra.water.days}</span></div>
                        <div><span style={{ color: "#2a4458" }}>חשמל גיבוי: </span><span style={{ color: "#ffd600" }}>{c.infra.power.backupHours}h</span></div>
                        <div><span style={{ color: "#2a4458" }}>מזון (ימים): </span><span style={{ color: "#00e5ff" }}>{c.infra.food.days}</span></div>
                        <div><span style={{ color: "#2a4458" }}>בתי חולים: </span><span style={{ color: "#ff4488" }}>{c.infra.medical.hospitals.toLocaleString()}</span></div>
                        <div><span style={{ color: "#2a4458" }}>מיטות: </span><span style={{ color: "#b040ff" }}>{c.infra.medical.beds.toLocaleString()}</span></div>
                        <div><span style={{ color: "#2a4458" }}>כבישי פינוי: </span><span style={{ color: "#ff8800" }}>{c.infra.transport.routes}</span></div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* TSUNAMI TAB */}
        {activeTab === "tsunami" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
            <div style={{ background: "rgba(6,14,22,.85)", border: "1px solid #112233", borderRadius: "14px", padding: "20px" }}>
              <div style={{ fontSize: "11px", color: "#00e5ff", letterSpacing: "2px", marginBottom: "16px" }}>
                🌊 מערכות התראת צונאמי עולמיות
              </div>
              {[
                { name: "PTWC — Pacific Tsunami Warning Center", country: "🇺🇸 NOAA", status: "operational", coverage: "אוקיאנוס שקט" },
                { name: "NWPTAC — NW Pacific Center", country: "🇯🇵 JMA", status: "operational", coverage: "מזרח אסיה" },
                { name: "IOTWS — Indian Ocean System", country: "🌊 UNESCO", status: "operational", coverage: "האוקיאנוס ההודי" },
                { name: "CARIBE-EWS", country: "🌊 IOC", status: "operational", coverage: "הקריביים" },
                { name: "NEAMTWS — צפון-מזרח אטלנטי + ים תיכון", country: "🇪🇺 EMSC", status: "operational", coverage: "ים תיכון" },
                { name: "InaTEWS — Indonesia", country: "🇮🇩 BMKG", status: "degraded", coverage: "אינדונזיה" },
              ].map(s => (
                <div key={s.name} style={{
                  padding: "10px 12px", borderRadius: "8px", marginBottom: "6px",
                  background: "rgba(0,0,0,.3)", border: "1px solid #112233",
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                }}>
                  <div>
                    <div style={{ fontSize: "10px", color: "#fff" }}>{s.name}</div>
                    <div style={{ fontSize: "8px", color: "#2a4458", marginTop: "2px" }}>{s.country} · {s.coverage}</div>
                  </div>
                  <span style={{ fontSize: "8px", color: s.status === "operational" ? "#00ff88" : "#ff8800" }}>
                    {s.status === "operational" ? "🟢 פעיל" : "🟡 חלקי"}
                  </span>
                </div>
              ))}
            </div>

            <div>
              <div style={{
                background: "rgba(6,14,22,.85)", border: "1px solid #112233",
                borderRadius: "14px", padding: "20px", marginBottom: "12px",
              }}>
                <div style={{ fontSize: "11px", color: "#b040ff", letterSpacing: "2px", marginBottom: "14px" }}>
                  ⚡ רמות אזהרת צונאמי — PTWC
                </div>
                {[
                  { l: "Major Warning", desc: "גלים >3m — פינוי מיידי", color: "#ff0022", trig: "M≥7.5 + נתוני מאיים" },
                  { l: "Warning", desc: "גלים 1-3m — פינוי חוף", color: "#ff2244", trig: "M≥7.0" },
                  { l: "Advisory", desc: "זרמים חזקים — זהירות חוף", color: "#ff8800", trig: "M≥6.5" },
                  { l: "Watch", desc: "מעקב — אפשרות ליצירה", color: "#ffd600", trig: "M≥6.0" },
                  { l: "Information", desc: "אין איום — מעקב בלבד", color: "#00ff88", trig: "M<6.0" },
                ].map(r => (
                  <div key={r.l} style={{
                    padding: "8px 12px", borderRadius: "8px", marginBottom: "6px",
                    borderRight: `3px solid ${r.color}`, background: `${r.color}08`,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between" }}>
                      <span style={{ fontSize: "10px", color: r.color, fontWeight: 700 }}>{r.l}</span>
                      <span style={{ fontSize: "8px", color: "#5a7a8a" }}>{r.trig}</span>
                    </div>
                    <div style={{ fontSize: "9px", color: "#b8d4e8", marginTop: "2px" }}>{r.desc}</div>
                  </div>
                ))}
              </div>

              <div style={{
                background: "rgba(6,14,22,.85)", border: "1px solid rgba(0,229,255,.2)",
                borderRadius: "14px", padding: "16px",
              }}>
                <div style={{ fontSize: "10px", color: "#2a4458", marginBottom: "10px" }}>
                  🔬 סימולציית אזהרה (DEMO)
                </div>
                <button onClick={() => setTsunamiAlert(a => ({ ...a, active: true }))} style={{
                  width: "100%", padding: "12px", borderRadius: "10px",
                  border: "2px solid rgba(0,229,255,.4)",
                  background: "rgba(0,229,255,.06)", color: "#00e5ff",
                  fontFamily: "inherit", fontSize: "11px", letterSpacing: "2px",
                  cursor: "pointer", fontWeight: 700,
                }}>🌊 הפעל אזהרת צונאמי — DEMO</button>
                <div style={{ fontSize: "8px", color: "#2a4458", marginTop: "8px", textAlign: "center" }}>
                  M8.2 · Pacific · PTWC Major Warning
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:.3} }
        @keyframes alertPulse { 0%,100%{box-shadow:none} 50%{box-shadow:0 0 20px rgba(255,34,68,.2)} }
      `}</style>
    </div>
  );
}

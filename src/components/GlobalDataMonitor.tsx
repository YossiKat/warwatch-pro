// ═══════════════════════════════════════════════════════════════
// GlobalDataMonitor.tsx — Global events / disasters / OSINT feed
// ═══════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";

interface WorldEvent {
  id: string;
  title: string;
  category: "conflict" | "aviation" | "weather" | "earthquake" | "cyber" | "nuclear" | "bio" | "news";
  severity: "critical" | "high" | "medium" | "low" | "info";
  location: string;
  country: string;
  countryCode: string;
  lat: number;
  lon: number;
  ts: Date;
  source: string;
  verified: boolean;
  tags: string[];
  summary?: string;
}

interface GlobalStat {
  label: string;
  value: string | number;
  delta?: string;
  color: string;
  icon: string;
}

const SEED_EVENTS: Omit<WorldEvent, "id" | "ts">[] = [
  { title: "סגירת מרחב אוויר זמנית — פקיסטן", category: "aviation", severity: "high", location: "לאהור", country: "פקיסטן", countryCode: "PK", lat: 31.52, lon: 74.36, source: "NOTAM OPLA", verified: true, tags: ["NOTAM", "airspace", "closure"], summary: "NOTAM: LOC CLOSED 1000-1600Z עקב תרגיל צבאי. נפגעים: 23 טיסות הוסטו." },
  { title: "רעידת אדמה 5.8 — מרוקו", category: "earthquake", severity: "medium", location: "מרקש", country: "מרוקו", countryCode: "MA", lat: 31.63, lon: -7.99, source: "USGS", verified: true, tags: ["earthquake", "5.8", "marrakech"], summary: "עומק: 10km. דיווח על נזק למבנים ישנים. אין הרוגים מאושרים." },
  { title: "עיכוב המוני — שדות דרום אירופה", category: "aviation", severity: "medium", location: "אתונה / ברצלונה / רומא", country: "EU", countryCode: "EU", lat: 40.64, lon: 14.29, source: "EUROCONTROL", verified: true, tags: ["delay", "atfm", "europe", "slot"], summary: "ATFM: Ground stops עקב עומס מרחב אוויר. עיכוב ממוצע: 47 דקות." },
  { title: "עדכון: מצב הלחימה — עזה", category: "conflict", severity: "critical", location: "עזה", country: "ישראל", countryCode: "IL", lat: 31.35, lon: 34.31, source: "IDF Spokesperson", verified: true, tags: ["war", "idf", "gaza", "hamas"], summary: "דיווח מסיכום: 12 שעות. מרחב אש פעיל בצפון עזה." },
  { title: "סופת ברד — גוש דן", category: "weather", severity: "medium", location: "תל אביב", country: "ישראל", countryCode: "IL", lat: 32.09, lon: 34.78, source: "IMS", verified: true, tags: ["weather", "hail", "tlv"], summary: "גלי ברד עד 3cm. עיכובי תחבורה בכבישים המהירים." },
  { title: "CYBER: מתקפה על תשתיות — אירן", category: "cyber", severity: "high", location: "טהרן", country: "אירן", countryCode: "IR", lat: 35.69, lon: 51.39, source: "OSINT/Telegram", verified: false, tags: ["cyber", "iran", "infrastructure"], summary: "דיווח לא מאומת: שיבוש תחנות כוח. מתוייג כ-OSINT." },
  { title: "התפרצות הר געש — פיליפינים", category: "earthquake", severity: "high", location: "לוזון", country: "פיליפינים", countryCode: "PH", lat: 14.0, lon: 121.0, source: "PHIVOLCS", verified: true, tags: ["volcano", "eruption", "philippines", "aviation-hazard"], summary: "ענן אפר גובה 12km. SIGMET פעיל. NOTAM לכל הטיסות מעל FL200." },
  { title: 'עיכוב ATFM — נתב"ג יוצאים', category: "aviation", severity: "low", location: "תל אביב", country: "ישראל", countryCode: "IL", lat: 32.01, lon: 34.88, source: "LLBG NOTAMs", verified: true, tags: ["tlv", "atfm", "departure", "delay"], summary: "Ground stop 20 דקות לטיסות לאיטליה וצרפת. עיכוב חזוי: 35-50 דק'." },
];

const CATEGORY_META: Record<WorldEvent["category"], { icon: string; label: string; color: string }> = {
  conflict: { icon: "⚔️", label: "קונפליקט", color: "#ff2244" },
  aviation: { icon: "✈️", label: "תעופה", color: "#00e5ff" },
  weather: { icon: "🌩️", label: "מזג אוויר", color: "#ffd600" },
  earthquake: { icon: "🌋", label: "גיאולוגי", color: "#ff8800" },
  cyber: { icon: "💻", label: "סייבר", color: "#b040ff" },
  nuclear: { icon: "☢️", label: "גרעין", color: "#ff2244" },
  bio: { icon: "🦠", label: "ביו", color: "#00ff88" },
  news: { icon: "📡", label: "חדשות", color: "#00e5ff" },
};

const SEV_META: Record<WorldEvent["severity"], { label: string; color: string; bg: string }> = {
  critical: { label: "קריטי", color: "#ff2244", bg: "rgba(255,34,68,.12)" },
  high: { label: "גבוה", color: "#ff8800", bg: "rgba(255,136,0,.08)" },
  medium: { label: "בינוני", color: "#ffd600", bg: "rgba(255,214,0,.07)" },
  low: { label: "נמוך", color: "#00ff88", bg: "rgba(0,255,136,.06)" },
  info: { label: "מידע", color: "#5a7a8a", bg: "rgba(90,122,138,.05)" },
};

const STATS: GlobalStat[] = [
  { label: "אירועים פעילים", value: 127, delta: "+8", color: "#ff8800", icon: "🌍" },
  { label: "NOTAMs פעילים", value: 2341, delta: "+12", color: "#00e5ff", icon: "✈️" },
  { label: "קונפליקטים", value: 23, delta: "±0", color: "#ff2244", icon: "⚔️" },
  { label: "רעידות >4.0", value: 8, delta: "+2", color: "#ff8800", icon: "🌋" },
  { label: "אירועי סייבר", value: 14, delta: "+3", color: "#b040ff", icon: "💻" },
  { label: "עיכובי תעופה", value: "47′", delta: "+5′", color: "#ffd600", icon: "⏱️" },
];

function timeAgo(ts: Date): string {
  const diff = (Date.now() - ts.getTime()) / 60000;
  if (diff < 1) return "עכשיו";
  if (diff < 60) return `לפני ${Math.floor(diff)} דק'`;
  if (diff < 1440) return `לפני ${Math.floor(diff / 60)} ש'`;
  return `לפני ${Math.floor(diff / 1440)} ימים`;
}

export default function GlobalDataMonitor() {
  const [events, setEvents] = useState<WorldEvent[]>([]);
  const [catFilter, setCatFilter] = useState<WorldEvent["category"] | "all">("all");
  const [sevFilter, setSevFilter] = useState<WorldEvent["severity"] | "all">("all");
  const [selected, setSelected] = useState<WorldEvent | null>(null);
  const [liveMode, setLiveMode] = useState(true);

  useEffect(() => {
    const base = SEED_EVENTS.map((e, i) => ({
      ...e,
      id: `ev-${i}`,
      ts: new Date(Date.now() - Math.random() * 7200000),
    }));
    setEvents(base);

    if (!liveMode) return;
    const id = setInterval(() => {
      const idx = Math.floor(Math.random() * SEED_EVENTS.length);
      const ev: WorldEvent = {
        ...SEED_EVENTS[idx],
        id: `ev-live-${Date.now()}`,
        ts: new Date(),
        title: SEED_EVENTS[idx].title + (Math.random() > 0.5 ? " [עדכון]" : " [חדש]"),
      };
      setEvents((prev) => [ev, ...prev].slice(0, 40));
    }, 25000);
    return () => clearInterval(id);
  }, [liveMode]);

  const filtered = events.filter(
    (e) =>
      (catFilter === "all" || e.category === catFilter) &&
      (sevFilter === "all" || e.severity === sevFilter)
  );

  return (
    <div style={{ background: "#03080d", color: "#b8d4e8", fontFamily: "'Orbitron', monospace", minHeight: "100vh", direction: "rtl" }}>
      <div style={{ background: "rgba(6,14,22,.97)", borderBottom: "1px solid #112233", padding: "14px 20px", display: "flex", alignItems: "center", gap: "12px" }}>
        <span style={{ fontSize: "20px" }}>🌐</span>
        <span style={{ fontSize: "12px", letterSpacing: "3px", color: "#b040ff", fontWeight: 700 }}>GLOBAL MONITOR</span>
        <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#00ff88", boxShadow: "0 0 8px #00ff88", animation: "pulse 1.5s infinite" }} />
        <span style={{ fontSize: "9px", color: "#2a4458" }}>LIVE</span>
        <button onClick={() => setLiveMode(!liveMode)} style={{ marginRight: "auto", padding: "5px 14px", borderRadius: "16px", border: "1px solid #112233", cursor: "pointer", fontFamily: "inherit", background: liveMode ? "rgba(0,255,136,.08)" : "transparent", color: liveMode ? "#00ff88" : "#2a4458", fontSize: "9px", letterSpacing: "1px" }}>
          {liveMode ? "⏸ עצור LIVE" : "▶ LIVE"}
        </button>
      </div>

      <div style={{ padding: "16px", maxWidth: "1200px", margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: "8px", marginBottom: "16px" }}>
          {STATS.map((s) => (
            <div key={s.label} style={{ background: "rgba(6,14,22,.85)", border: "1px solid #112233", borderRadius: "10px", padding: "10px", textAlign: "center" }}>
              <div style={{ fontSize: "18px", marginBottom: "2px" }}>{s.icon}</div>
              <div style={{ fontSize: "16px", fontWeight: 700, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: "7px", color: "#2a4458", marginTop: "2px", letterSpacing: "1px" }}>{s.label}</div>
              {s.delta && (
                <div style={{ fontSize: "8px", color: s.delta.startsWith("+") ? s.color : "#ff2244", marginTop: "2px" }}>{s.delta}</div>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: "6px", marginBottom: "10px", flexWrap: "wrap" }}>
          <button onClick={() => setCatFilter("all")} style={{ padding: "4px 12px", borderRadius: "12px", border: "1px solid #112233", background: catFilter === "all" ? "rgba(0,229,255,.1)" : "transparent", color: catFilter === "all" ? "#00e5ff" : "#2a4458", fontSize: "9px", cursor: "pointer", fontFamily: "inherit" }}>הכל</button>
          {Object.entries(CATEGORY_META).map(([k, v]) => (
            <button key={k} onClick={() => setCatFilter(k as WorldEvent["category"])} style={{ padding: "4px 12px", borderRadius: "12px", border: "1px solid #112233", background: catFilter === k ? `${v.color}15` : "transparent", color: catFilter === k ? v.color : "#2a4458", fontSize: "9px", cursor: "pointer", fontFamily: "inherit" }}>
              {v.icon} {v.label}
            </button>
          ))}
          <div style={{ width: "1px", background: "#112233", margin: "0 4px" }} />
          {(["all", "critical", "high", "medium"] as const).map((s) => (
            <button key={s} onClick={() => setSevFilter(s)} style={{ padding: "4px 10px", borderRadius: "10px", border: "1px solid #112233", background: sevFilter === s ? (s !== "all" ? SEV_META[s].bg : "rgba(0,229,255,.08)") : "transparent", color: sevFilter === s ? (s !== "all" ? SEV_META[s].color : "#00e5ff") : "#2a4458", fontSize: "8px", cursor: "pointer", fontFamily: "inherit" }}>
              {s === "all" ? "כל חומרות" : SEV_META[s as WorldEvent["severity"]].label}
            </button>
          ))}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {filtered.map((ev) => {
            const cm = CATEGORY_META[ev.category];
            const sm = SEV_META[ev.severity];
            const isNew = Date.now() - ev.ts.getTime() < 60000;
            return (
              <div key={ev.id} onClick={() => setSelected(selected?.id === ev.id ? null : ev)} style={{ background: selected?.id === ev.id ? sm.bg : "rgba(6,14,22,.85)", border: `1px solid ${selected?.id === ev.id ? sm.color + "44" : "#112233"}`, borderRight: `3px solid ${sm.color}`, borderRadius: "10px", padding: "12px 16px", cursor: "pointer", transition: "all .15s", display: "flex", gap: "12px", alignItems: "flex-start" }}>
                <span style={{ fontSize: "20px", flexShrink: 0, marginTop: "1px" }}>{cm.icon}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "8px" }}>
                    <div style={{ fontSize: "12px", color: "#fff", fontWeight: 700, lineHeight: 1.3 }}>
                      {isNew && (
                        <span style={{ fontSize: "8px", background: "#00ff88", color: "#000", padding: "1px 5px", borderRadius: "4px", marginLeft: "6px" }}>NEW</span>
                      )}
                      {ev.title}
                    </div>
                    <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
                      {!ev.verified && (
                        <span style={{ fontSize: "8px", padding: "2px 6px", borderRadius: "4px", background: "rgba(255,214,0,.1)", color: "#ffd600", border: "1px solid rgba(255,214,0,.2)" }}>לא מאומת</span>
                      )}
                      <span style={{ fontSize: "8px", padding: "2px 8px", borderRadius: "8px", background: sm.bg, color: sm.color, border: `1px solid ${sm.color}44` }}>{sm.label}</span>
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "12px", marginTop: "5px", fontSize: "9px", color: "#5a7a8a" }}>
                    <span>📍 {ev.location}, {ev.country}</span>
                    <span>🕐 {timeAgo(ev.ts)}</span>
                    <span>📡 {ev.source}</span>
                  </div>
                  <div style={{ display: "flex", gap: "4px", marginTop: "6px", flexWrap: "wrap" }}>
                    {ev.tags.map((t) => (
                      <span key={t} style={{ fontSize: "7px", padding: "1px 6px", borderRadius: "4px", background: "rgba(0,0,0,.4)", color: "#2a4458", letterSpacing: "0.5px" }}>#{t}</span>
                    ))}
                  </div>
                  {selected?.id === ev.id && ev.summary && (
                    <div style={{ marginTop: "10px", padding: "10px 12px", background: "rgba(0,0,0,.4)", borderRadius: "7px", fontSize: "10px", color: "#b8d4e8", lineHeight: 1.6, borderRight: `2px solid ${sm.color}` }}>
                      {ev.summary}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;700&display=swap');
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }
      `}</style>
    </div>
  );
}

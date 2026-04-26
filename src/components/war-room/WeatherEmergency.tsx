import { useState, useEffect } from 'react';

type WLevel = 'extreme' | 'severe' | 'moderate' | 'advisory' | 'clear';
type WType = 'heat' | 'storm' | 'wind' | 'flood' | 'frost' | 'fog' | 'dust' | 'fire';

interface WAlert {
  id: string;
  type: WType;
  level: WLevel;
  title: string;
  region: string;
  temp?: number;
  feels?: number;
  wind?: number;
  desc: string;
  until: string;
  source: string;
  ts: Date;
  action: boolean;
}
interface Region {
  id: string;
  name: string;
  temp: number;
  feels: number;
  hum: number;
  wind: number;
  uv: number;
  cond: string;
  icon: string;
  hi: number;
  level: WLevel;
  alertCount: number;
}

const LM: Record<WLevel, { l: string; c: string; bg: string; bd: string; pulse: boolean }> = {
  extreme: { l: 'קיצוני', c: '#ff0022', bg: 'rgba(255,0,34,.14)', bd: 'rgba(255,0,34,.35)', pulse: true },
  severe:  { l: 'חמור',   c: '#ff4400', bg: 'rgba(255,68,0,.11)',  bd: 'rgba(255,68,0,.3)',  pulse: true },
  moderate:{ l: 'בינוני', c: '#ff8800', bg: 'rgba(255,136,0,.08)', bd: 'rgba(255,136,0,.25)', pulse: false },
  advisory:{ l: 'כוננות', c: '#ffd600', bg: 'rgba(255,214,0,.07)', bd: 'rgba(255,214,0,.25)', pulse: false },
  clear:   { l: 'תקין',   c: '#00ff88', bg: 'rgba(0,255,136,.05)', bd: 'rgba(0,255,136,.2)',  pulse: false },
};
const WM: Record<WType, { icon: string; l: string; c: string }> = {
  heat:  { icon: '🌡️', l: 'גל חום',       c: '#ff4400' },
  storm: { icon: '⛈️', l: 'סופה',          c: '#b040ff' },
  wind:  { icon: '💨', l: 'רוחות חזקות',   c: '#00e5ff' },
  flood: { icon: '🌊', l: 'שיטפון',        c: '#0088ff' },
  frost: { icon: '❄️', l: 'כפור',          c: '#88ccff' },
  fog:   { icon: '🌫️', l: 'ערפל',          c: '#aaaaaa' },
  dust:  { icon: '🏜️', l: 'סופת אבק',      c: '#cc8844' },
  fire:  { icon: '🔥', l: 'סכנת שרפות',    c: '#ff4400' },
};

function heatIndex(t: number, h: number): number {
  if (t < 27) return t;
  return Math.round(
    -8.78 + 1.611 * t + 2.338 * h - 0.146 * t * h - 0.0123 * t * t -
      0.0164 * h * h + 0.00221 * t * t * h + 0.000725 * t * h * h,
  );
}
function hl(v: number): WLevel {
  return v >= 46 ? 'extreme' : v >= 40 ? 'severe' : v >= 35 ? 'moderate' : v >= 30 ? 'advisory' : 'clear';
}

const ALERTS: WAlert[] = [
  { id: 'a1', type: 'heat', level: 'extreme', title: 'גל חום קיצוני — כל הארץ', region: 'כל הארץ', temp: 45, feels: 51, desc: 'טמפרטורות עד 45°C. סכנת חיים לקשישים וילדים. יש לשהות בפנים ממוזג.', until: '21:00', source: 'השירות המטאורולוגי', ts: new Date(Date.now() - 1800000), action: true },
  { id: 'a2', type: 'fire', level: 'extreme', title: 'סכנת שרפות גבוהה — כרמל ויהודה', region: 'כרמל · יהודה · שפלה', desc: 'יבשות קיצונית ורוחות חזקות. אסור להדליק אש. כוחות כיבוי בדרגה 3.', until: 'מחר 08:00', source: 'רשות הטבע והגנים', ts: new Date(Date.now() - 3600000), action: true },
  { id: 'a3', type: 'wind', level: 'severe', title: 'רוחות חזקות — נגב ואילת', region: 'נגב · ערבה · אילת', wind: 85, desc: 'רוחות עד 85 קמ"ש. סכנה לרכבים גבוהים. חופים סגורים.', until: '18:00', source: 'IMS', ts: new Date(Date.now() - 900000), action: true },
  { id: 'a4', type: 'dust', level: 'moderate', title: 'סופת אבק — בקעת הירדן', region: 'ירדן · נגב מזרחי', desc: 'ירידה בטווח ראייה ל-500 מטר. הימנע מפעילות חיצונית.', until: '16:00', source: 'IMS', ts: new Date(Date.now() - 600000), action: false },
  { id: 'a5', type: 'heat', level: 'advisory', title: 'UV קיצוני — כל הארץ', region: 'כל הארץ', desc: 'מדד UV 12-13. כוויות תוך 10 דקות. קרם הגנה 50+ חובה.', until: '17:00', source: 'משרד הבריאות', ts: new Date(Date.now() - 300000), action: false },
];
const REGIONS: Region[] = [
  { id: 'tlv',   name: 'תל אביב',  temp: 38, feels: 44, hum: 72, wind: 12, uv: 11, cond: 'שרב',       icon: '☀️', hi: heatIndex(38, 72), level: hl(heatIndex(38, 72)), alertCount: 2 },
  { id: 'jer',   name: 'ירושלים',  temp: 34, feels: 37, hum: 45, wind: 18, uv: 10, cond: 'חם',         icon: '🌤️', hi: heatIndex(34, 45), level: hl(heatIndex(34, 45)), alertCount: 1 },
  { id: 'hfa',   name: 'חיפה',     temp: 36, feels: 42, hum: 68, wind: 8,  uv: 10, cond: 'לח וחם',    icon: '☀️', hi: heatIndex(36, 68), level: hl(heatIndex(36, 68)), alertCount: 1 },
  { id: 'beer',  name: 'באר שבע',  temp: 42, feels: 40, hum: 22, wind: 25, uv: 12, cond: 'שרב יבש',   icon: '🌵', hi: heatIndex(42, 22), level: hl(heatIndex(42, 22)), alertCount: 2 },
  { id: 'eilat', name: 'אילת',     temp: 45, feels: 43, hum: 18, wind: 20, uv: 13, cond: 'קיצוני',    icon: '🔆', hi: heatIndex(45, 18), level: hl(heatIndex(45, 18)), alertCount: 3 },
  { id: 'north', name: 'צפון',     temp: 33, feels: 36, hum: 58, wind: 15, uv: 9,  cond: 'חם ולח',    icon: '⛅', hi: heatIndex(33, 58), level: hl(heatIndex(33, 58)), alertCount: 0 },
  { id: 'negev', name: 'נגב',      temp: 44, feels: 42, hum: 15, wind: 30, uv: 12, cond: 'שרב חול',   icon: '🏜️', hi: heatIndex(44, 15), level: hl(heatIndex(44, 15)), alertCount: 3 },
  { id: 'dead',  name: 'ים המלח',  temp: 43, feels: 48, hum: 35, wind: 5,  uv: 11, cond: 'ללא רוח',  icon: '🌊', hi: heatIndex(43, 35), level: hl(heatIndex(43, 35)), alertCount: 2 },
];

const ago = (ts: Date) => {
  const d = (Date.now() - ts.getTime()) / 60000;
  return d < 1 ? 'עכשיו' : d < 60 ? `${Math.floor(d)}′` : `${Math.floor(d / 60)}ש'`;
};

interface Props {
  onClose?: () => void;
}

export default function WeatherEmergency({ onClose }: Props) {
  const [tab, setTab] = useState<'alerts' | 'regions' | 'guide'>('alerts');
  const [levelF, setLevelF] = useState<'all' | WLevel>('all');
  const [typeF, setTypeF] = useState<'all' | WType>('all');
  const [selA, setSelA] = useState<string | null>(null);
  const [selR, setSelR] = useState<string | null>(null);
  const [upd, setUpd] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setUpd(new Date()), 300000);
    return () => clearInterval(id);
  }, []);

  const shownA = ALERTS.filter(
    (a) => (levelF === 'all' || a.level === levelF) && (typeF === 'all' || a.type === typeF),
  ).sort((a, b) => {
    const o: Record<WLevel, number> = { extreme: 0, severe: 1, moderate: 2, advisory: 3, clear: 4 };
    return o[a.level] - o[b.level];
  });
  const maxHI = Math.max(...REGIONS.map((r) => r.hi));
  const extCnt = REGIONS.filter((r) => r.level === 'extreme').length;

  return (
    <div
      dir="rtl"
      style={{
        position: 'absolute',
        top: 80,
        left: 16,
        zIndex: 1000,
        width: 420,
        maxHeight: 'calc(100vh - 120px)',
        overflowY: 'auto',
        background: 'rgba(2,8,14,.92)',
        backdropFilter: 'blur(14px)',
        border: '1px solid rgba(255,68,0,.28)',
        borderRadius: 14,
        padding: 14,
        color: '#fff',
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 11,
        boxShadow: '0 12px 40px rgba(0,0,0,.55)',
      }}
    >
      <style>{`@keyframes wePulse{0%,100%{box-shadow:none}50%{box-shadow:0 0 22px rgba(255,68,0,.35)}}`}</style>

      {/* HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>🌡️</span>
        <span style={{ fontWeight: 800, letterSpacing: 1, color: '#ff8800' }}>WEATHER ALERT</span>
        <span style={{ marginInlineStart: 'auto', fontSize: 9, color: '#88a' }}>
          {upd.toLocaleTimeString('he-IL')}
        </span>
        {onClose && (
          <button
            onClick={onClose}
            style={{ background: 'transparent', border: '1px solid #334', color: '#ccc', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}
          >
            ✕
          </button>
        )}
      </div>

      {/* HEAT BANNER */}
      {maxHI >= 40 && (
        <div
          style={{
            background: 'rgba(255,68,0,.12)',
            border: '1px solid rgba(255,68,0,.35)',
            borderRadius: 10,
            padding: 10,
            marginBottom: 10,
            display: 'flex',
            gap: 10,
            alignItems: 'center',
          }}
        >
          <span style={{ fontSize: 26 }}>🌡️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 700, color: '#ff6622' }}>גל חום קיצוני פעיל</div>
            <div style={{ fontSize: 10, color: '#cca' }}>
              מדד חום מרבי: {maxHI}°C · {extCnt} אזורים בסכנה קיצונית
            </div>
          </div>
        </div>
      )}

      {/* STATS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 6, marginBottom: 10 }}>
        {[
          { n: ALERTS.filter((a) => a.level === 'extreme').length, l: 'קיצוני', c: '#ff0022' },
          { n: ALERTS.filter((a) => a.level === 'severe').length,  l: 'חמור',    c: '#ff4400' },
          { n: ALERTS.filter((a) => a.action).length,              l: 'פעולה',  c: '#ffd600' },
          { n: maxHI,                                               l: 'HI מרבי', c: '#ff8800' },
          { n: extCnt,                                              l: 'אזורים',  c: '#ff2244' },
        ].map((s, i) => (
          <div key={i} style={{ background: 'rgba(255,255,255,.04)', border: '1px solid #112', borderRadius: 8, padding: '6px 4px', textAlign: 'center' }}>
            <div style={{ color: s.c, fontWeight: 800, fontSize: 16 }}>{s.n}</div>
            <div style={{ color: '#88a', fontSize: 9 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* TABS */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10, borderBottom: '1px solid #112' }}>
        {([{ k: 'alerts', l: '⚡ התראות' }, { k: 'regions', l: '🗺️ אזורים' }, { k: 'guide', l: '📋 סף פעולה' }] as const).map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            style={{
              padding: '6px 12px',
              border: 'none',
              background: tab === t.k ? 'rgba(255,68,0,.15)' : 'transparent',
              color: tab === t.k ? '#ff6622' : '#667',
              fontSize: 10,
              cursor: 'pointer',
              borderBottom: tab === t.k ? '2px solid #ff4400' : '2px solid transparent',
              fontFamily: 'inherit',
            }}
          >
            {t.l}
          </button>
        ))}
      </div>

      {/* ALERTS TAB */}
      {tab === 'alerts' && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            <button
              onClick={() => setLevelF('all')}
              style={{ padding: '3px 10px', borderRadius: 10, border: '1px solid #223', background: levelF === 'all' ? 'rgba(255,255,255,.07)' : 'transparent', color: '#fff', fontSize: 9, cursor: 'pointer' }}
            >
              הכל
            </button>
            {(['extreme', 'severe', 'moderate', 'advisory'] as WLevel[]).map((l) => (
              <button
                key={l}
                onClick={() => setLevelF(l === levelF ? 'all' : l)}
                style={{ padding: '3px 10px', borderRadius: 10, border: `1px solid ${LM[l].bd}`, background: levelF === l ? LM[l].bg : 'transparent', color: levelF === l ? LM[l].c : '#667', fontSize: 9, cursor: 'pointer' }}
              >
                {LM[l].l}
              </button>
            ))}
            <div style={{ width: '100%', height: 0 }} />
            {(Object.keys(WM) as WType[]).map((t) => (
              <button
                key={t}
                onClick={() => setTypeF(t === typeF ? 'all' : t)}
                style={{ padding: '3px 9px', borderRadius: 10, border: '1px solid #223', background: typeF === t ? `${WM[t].c}24` : 'transparent', color: typeF === t ? WM[t].c : '#667', fontSize: 11, cursor: 'pointer' }}
                title={WM[t].l}
              >
                {WM[t].icon}
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {shownA.map((a) => {
              const lm = LM[a.level];
              const wm = WM[a.type];
              const open = selA === a.id;
              return (
                <div
                  key={a.id}
                  onClick={() => setSelA(open ? null : a.id)}
                  style={{
                    background: open ? lm.bg : 'rgba(6,14,22,.85)',
                    border: `1px solid ${open ? lm.c + '66' : lm.bd}`,
                    borderRight: `4px solid ${lm.c}`,
                    borderRadius: 10,
                    padding: '10px 12px',
                    cursor: 'pointer',
                    animation: lm.pulse && !open ? 'wePulse 2s infinite' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', gap: 8 }}>
                    <span style={{ fontSize: 22 }}>{wm.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, alignItems: 'center' }}>
                        <div style={{ fontWeight: 700, color: lm.c, fontSize: 11 }}>{a.title}</div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {a.action && <span style={{ background: '#ffd60022', color: '#ffd600', borderRadius: 4, padding: '1px 5px', fontSize: 8 }}>⚡ פעולה</span>}
                          <span style={{ background: lm.bg, color: lm.c, borderRadius: 4, padding: '1px 5px', fontSize: 8, border: `1px solid ${lm.bd}` }}>{lm.l}</span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4, fontSize: 9, color: '#99a' }}>
                        <span>📍 {a.region}</span>
                        {a.temp != null && <span>🌡️ {a.temp}°C</span>}
                        {a.feels != null && <span>מרגיש {a.feels}°C</span>}
                        {a.wind != null && <span>💨 {a.wind} קמ"ש</span>}
                        <span>⏰ עד {a.until}</span>
                        <span>🕐 {ago(a.ts)}</span>
                      </div>
                      {open && (
                        <div style={{ marginTop: 6, fontSize: 10, color: '#ccd', lineHeight: 1.5 }}>
                          {a.desc}
                          <div style={{ marginTop: 4, color: '#778', fontSize: 9 }}>מקור: {a.source}</div>
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

      {/* REGIONS TAB */}
      {tab === 'regions' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {REGIONS.slice()
            .sort((a, b) => b.hi - a.hi)
            .map((r) => {
              const lm = LM[r.level];
              const open = selR === r.id;
              return (
                <div
                  key={r.id}
                  onClick={() => setSelR(open ? null : r.id)}
                  style={{
                    background: open ? lm.bg : 'rgba(6,14,22,.85)',
                    border: `1px solid ${lm.bd}`,
                    borderRadius: 10,
                    padding: 10,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 12 }}>{r.name}</div>
                      <div style={{ fontSize: 9, color: '#99a' }}>{r.cond}</div>
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 20 }}>{r.icon}</div>
                      <div style={{ fontWeight: 800, color: lm.c, fontSize: 14 }}>{r.temp}°</div>
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginTop: 6, fontSize: 9 }}>
                    {[
                      { l: 'מרגיש', v: `${r.feels}°` },
                      { l: 'לחות', v: `${r.hum}%` },
                      { l: 'רוח', v: `${r.wind}` },
                      { l: 'UV', v: `${r.uv}` },
                    ].map((x, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: '#99a' }}>
                        <span>{x.l}</span>
                        <span style={{ color: '#fff' }}>{x.v}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px dashed #223', display: 'flex', justifyContent: 'space-between', fontSize: 9 }}>
                    <span style={{ color: '#778' }}>HI</span>
                    <span style={{ color: lm.c, fontWeight: 700 }}>
                      {r.hi}° · {lm.l}
                    </span>
                  </div>
                  {r.alertCount > 0 && (
                    <div style={{ marginTop: 4, fontSize: 9, color: '#ffd600' }}>⚠️ {r.alertCount} התראות פעילות</div>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {/* GUIDE TAB */}
      {tab === 'guide' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[
            {
              title: '🌡️ מדד חום — סף פעולה', c: '#ff4400',
              rows: [
                { l: 'עד 27°C', v: 'נורמלי', rc: '#00ff88' },
                { l: '30-35°C', v: 'כוננות — שתיית מים', rc: '#ffd600' },
                { l: '35-40°C', v: 'מתון — הגבל יציאה 10-16', rc: '#ff8800' },
                { l: '40-46°C', v: 'חמור — שהה בפנים', rc: '#ff4400' },
                { l: '46°C+', v: 'קיצוני — סכנת חיים', rc: '#ff0022' },
              ],
            },
            {
              title: '☀️ UV — הגנה', c: '#ffd600',
              rows: [
                { l: 'UV 1-2', v: 'נמוך', rc: '#00ff88' },
                { l: 'UV 3-5', v: 'מתון — קרם 30+', rc: '#ffd600' },
                { l: 'UV 6-7', v: 'גבוה — קרם 50+ כובע', rc: '#ff8800' },
                { l: 'UV 8-10', v: 'גבוה מאוד', rc: '#ff4400' },
                { l: 'UV 11+', v: 'קיצוני — כוויות ב-10 דק׳', rc: '#ff0022' },
              ],
            },
            {
              title: '💨 רוחות — סף סכנה', c: '#00e5ff',
              rows: [
                { l: '0-30 קמ"ש', v: 'רגיל', rc: '#00ff88' },
                { l: '30-50', v: 'חזקות', rc: '#ffd600' },
                { l: '50-70', v: 'סערה', rc: '#ff8800' },
                { l: '70-90', v: 'הישאר בפנים', rc: '#ff4400' },
                { l: '90+', v: 'הוריקן', rc: '#ff0022' },
              ],
            },
            {
              title: '🔥 סכנת שרפות', c: '#ff4400',
              rows: [
                { l: 'רמה 1', v: 'נמוך', rc: '#00ff88' },
                { l: 'רמה 2', v: 'מוגבר', rc: '#ffd600' },
                { l: 'רמה 3', v: 'גבוה — כיבוי בכוננות', rc: '#ff8800' },
                { l: 'רמה 4', v: 'מסוכן — אסור אש', rc: '#ff4400' },
                { l: 'רמה 5', v: 'קיצוני — פינויים', rc: '#ff0022' },
              ],
            },
          ].map((card, i) => (
            <div key={i} style={{ background: 'rgba(6,14,22,.85)', border: '1px solid #223', borderRadius: 10, padding: 10 }}>
              <div style={{ fontWeight: 700, color: card.c, marginBottom: 6, fontSize: 11 }}>{card.title}</div>
              {card.rows.map((row, j) => (
                <div
                  key={j}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 10,
                    padding: '3px 0',
                    borderBottom: j < card.rows.length - 1 ? '1px dashed #112' : 'none',
                  }}
                >
                  <span style={{ color: '#99a' }}>{row.l}</span>
                  <span style={{ color: row.rc, fontWeight: 600 }}>{row.v}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

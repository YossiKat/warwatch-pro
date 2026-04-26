import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// Leaflet via CDN (loaded once)
declare global {
  interface Window { L: any }
}

type Zone = {
  id: string; flag: string; name: string; risk: number;
  center: [number, number]; zoom: number; tags: string[];
  bbox: [[number, number], [number, number]]; color: string;
  parties: string[]; desc: string; disasters: string[];
};

const ZONES: Zone[] = [
  { id:'ukraine',flag:'🇺🇦',name:'אוקראינה-רוסיה',risk:5,center:[49.5,32],zoom:5,tags:['מלחמה פעילה','טילים','כוחות יבשה'],bbox:[[44,21],[52,41]],color:'#ff003c',parties:['רוסיה','אוקראינה','NATO'],desc:'מלחמה מלאה מאז פברואר 2022',disasters:['הפצצות ערים','פליטים 10M+'] },
  { id:'gaza',flag:'🇵🇸',name:'עזה-ישראל',risk:5,center:[31.4,34.5],zoom:8,tags:['מלחמה פעילה','הפצצות','לוחמה עירונית'],bbox:[[29.5,34.2],[33.5,36]],color:'#ff003c',parties:['ישראל','חמאס','חיזבאללה'],desc:'מלחמת עזה',disasters:['משבר הומניטרי'] },
  { id:'iran_proxy',flag:'🇮🇷',name:'איראן-פרוקסי',risk:5,center:[33,53],zoom:5,tags:['גרעין','פרוקסי'],bbox:[[25,44],[40,64]],color:'#ff003c',parties:['איראן','ארה"ב','ישראל'],desc:'תוכנית גרעין + רשת פרוקסי',disasters:['סנקציות'] },
  { id:'red_sea',flag:'🌊',name:'ים סוף',risk:4,center:[15,43],zoom:5,tags:['UAV','ספינות'],bbox:[[10,32],[29,46]],color:'#ff8800',parties:["חות'ים","ארה\"ב"],desc:"חות'ים תוקפים ספינות",disasters:['שיבוש שרשרת אספקה'] },
  { id:'taiwan',flag:'🇹🇼',name:'מיצר טייוואן',risk:4,center:[24,121],zoom:6,tags:['סין','אמפיביה'],bbox:[[20,117],[26,125]],color:'#ff8800',parties:['סין','טייוואן','ארה"ב'],desc:'מתיחות מתגברת',disasters:['ייצור שבבים'] },
  { id:'nkorea',flag:'🇰🇵',name:'קוריאה הצפונית',risk:4,center:[39.5,127.5],zoom:6,tags:['ICBM','גרעין'],bbox:[[37.5,124],[43,131]],color:'#ff8800',parties:['צפ"ק','דר"ק','ארה"ב'],desc:'שיגורי טילים',disasters:['רעב'] },
  { id:'myanmar',flag:'🇲🇲',name:'מיאנמר',risk:3,center:[19,96.5],zoom:5,tags:['מלחמת אזרחים'],bbox:[[9,92],[28,101]],color:'#ffdd00',parties:['הונטה','התנגדות'],desc:'מלחמת אזרחים',disasters:['פליטים'] },
  { id:'sudan',flag:'🇸🇩',name:'סודן',risk:3,center:[15,32],zoom:5,tags:['מלחמת אזרחים','רעב'],bbox:[[3,21],[23,38]],color:'#ffdd00',parties:['SAF','RSF'],desc:'10M+ מורעבים',disasters:['רעב'] },
  { id:'pakistan',flag:'🇵🇰',name:'פקיסטן-הודו',risk:3,center:[30,73],zoom:5,tags:['גרעין','קשמיר'],bbox:[[23,60],[37,80]],color:'#ffdd00',parties:['פקיסטן','הודו'],desc:'קשמיר',disasters:['שיטפונות'] },
  { id:'sahel',flag:'🌍',name:'סאהל',risk:3,center:[13.5,1],zoom:4,tags:['ISIS','Wagner'],bbox:[[5,-18],[25,25]],color:'#ffdd00',parties:['ISIS','JNIM','Wagner'],desc:"מאלי, בורקינה, ניז'ר",disasters:['בצורת'] },
  { id:'scs',flag:'🇨🇳',name:'ים סין הדרומי',risk:3,center:[14,114],zoom:4,tags:['סין','Spratly'],bbox:[[3,107],[22,121]],color:'#ffdd00',parties:['סין','פיליפינים','ארה"ב'],desc:'עימותים ימיים',disasters:['שיבוש דיג'] },
  { id:'global',flag:'🌍',name:'דוח גלובלי',risk:4,center:[20,10],zoom:2,tags:['עולמי'],bbox:[[-60,-180],[80,180]],color:'#00cfff',parties:['כל המעצמות'],desc:'ניתוח מצב עולמי',disasters:['אקלים'] },
];

const LVL: Record<number, { c: string; l: string }> = {
  1: { c:'#00ff88', l:'שגרה' }, 2: { c:'#7fff00', l:'עירנות' },
  3: { c:'#ffdd00', l:'מתיחות' }, 4: { c:'#ff8800', l:'סכסוך' },
  5: { c:'#ff003c', l:'מלחמה' },
};

const SEV_C: Record<string, [string, string]> = {
  critical: ['#ff003c', 'rgba(255,0,60,.1)'],
  high: ['#ff8800', 'rgba(255,136,0,.08)'],
  warning: ['#ffdd00', 'rgba(255,221,0,.07)'],
  medium: ['#00cfff', 'rgba(0,207,255,.07)'],
  low: ['#00ff88', 'rgba(0,255,136,.06)'],
};

const hexToRgba = (hex: string, a: number) => {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
};

export default function GlobalWar() {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<any>(null);
  const polyLayers = useRef<Record<string, any>>({});
  const [currentZone, setCurrentZone] = useState<Zone | null>(null);
  const [tab, setTab] = useState<'alerts'|'diplo'|'military'|'disaster'|'report'>('alerts');
  const [data, setData] = useState<any>({ alerts: [], diplomatic: [], military: [], disasters: [], report: {} });
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [clock, setClock] = useState('--:--:--');
  const [autoOn, setAutoOn] = useState(false);
  const autoTimer = useRef<number | null>(null);

  // Load Leaflet from CDN
  useEffect(() => {
    if (window.L) { initMap(); return; }
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(css);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => initMap();
    document.head.appendChild(script);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initMap = () => {
    if (!mapRef.current || mapInstance.current) return;
    const L = window.L;
    const m = L.map(mapRef.current, { center: [25, 15], zoom: 2, attributionControl: false });
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }).addTo(m);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, opacity: 0.8 }).addTo(m);
    setTimeout(() => {
      const tp = mapRef.current?.querySelector('.leaflet-tile-pane') as HTMLElement;
      if (tp) tp.style.filter = 'saturate(.18) brightness(.45) hue-rotate(175deg)';
    }, 400);
    ZONES.forEach(z => {
      if (z.id === 'global') return;
      const [[s, w], [n, e]] = z.bbox;
      const poly = L.polygon([[s, w], [s, e], [n, e], [n, w]], {
        color: z.color, fillColor: z.color, fillOpacity: 0.1, weight: 1.5, dashArray: '6,4',
      }).addTo(m);
      poly.on('click', () => selectZone(z));
      polyLayers.current[z.id] = poly;
    });
    mapInstance.current = m;
    setTimeout(() => m.invalidateSize(), 500);
    selectZone(ZONES.find(z => z.id === 'gaza')!);
  };

  const selectZone = (zone: Zone) => {
    setCurrentZone(zone);
    setData({ alerts: [], diplomatic: [], military: [], disasters: [], report: {} });
    const m = mapInstance.current;
    if (m) {
      if (zone.id === 'global') m.flyTo([20, 10], 2, { duration: 1.5 });
      else m.flyToBounds(zone.bbox, { padding: [40, 40], duration: 1.5, maxZoom: 7 });
      Object.entries(polyLayers.current).forEach(([zid, poly]: any) => {
        poly.setStyle({ opacity: zid === zone.id ? 1 : 0.4, fillOpacity: zid === zone.id ? 0.22 : 0.07 });
      });
    }
    setTimeout(() => doScan(zone), 300);
  };

  const doScan = useCallback(async (zoneArg?: Zone) => {
    const zone = zoneArg || currentZone;
    if (!zone || scanning) return;
    setScanning(true);
    setProgress(15);
    try {
      const { data: result, error } = await supabase.functions.invoke('global-war-scan', {
        body: { zone, isGlobal: zone.id === 'global' },
      });
      setProgress(80);
      if (error) {
        if ((error as any).context?.status === 429) toast.error('יותר מדי בקשות, נסה שוב בעוד דקה');
        else if ((error as any).context?.status === 402) toast.error('נגמרו קרדיטים ב-Lovable AI');
        else toast.error('שגיאה בסריקה');
        throw error;
      }
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      setData(result || {});
      // update polygon color
      if (result?.riskLevel && polyLayers.current[zone.id]) {
        const c = LVL[Math.min(5, Math.max(1, Math.round(result.riskLevel)))]?.c || zone.color;
        polyLayers.current[zone.id].setStyle({ color: c, fillColor: c, fillOpacity: 0.18, weight: 2 });
      }
      setProgress(100);
      setTimeout(() => setProgress(0), 400);
    } catch (e) {
      console.error(e);
      setProgress(0);
    } finally {
      setScanning(false);
    }
  }, [currentZone, scanning]);

  // Clock
  useEffect(() => {
    const t = setInterval(() => setClock(new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })), 1000);
    return () => clearInterval(t);
  }, []);

  // Auto-scan
  useEffect(() => {
    if (autoOn) {
      autoTimer.current = window.setInterval(() => doScan(), 120000);
    } else if (autoTimer.current) {
      clearInterval(autoTimer.current);
    }
    return () => { if (autoTimer.current) clearInterval(autoTimer.current); };
  }, [autoOn, doScan]);

  const zone = currentZone;
  const risk = zone?.risk ?? 3;
  const lvl = LVL[risk];

  return (
    <div dir="rtl" style={{ height: '100vh', background: '#020508', color: '#8ab0c4', fontFamily: 'Heebo, sans-serif', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Topbar */}
      <div style={{ background: 'rgba(2,5,8,.98)', borderBottom: '1px solid #0c1e2e', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '8px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontSize: 20 }}>📡</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 900, color: '#fff' }}>GLOBAL WAR MONITOR</div>
              <div style={{ fontSize: 8, color: '#00cfff', fontFamily: 'Share Tech Mono, monospace', letterSpacing: 2 }}>WORLD INTEL · 24/7</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flex: 1, overflowX: 'auto', scrollbarWidth: 'none' }}>
            {ZONES.map(z => (
              <button key={z.id} onClick={() => selectZone(z)}
                style={{
                  flexShrink: 0, padding: '5px 11px', borderRadius: 7,
                  border: `1px solid ${zone?.id === z.id ? z.color : '#0c1e2e'}`,
                  background: zone?.id === z.id ? hexToRgba(z.color, 0.12) : 'rgba(255,255,255,.03)',
                  color: zone?.id === z.id ? z.color : '#2a4060',
                  fontSize: 9, cursor: 'pointer', fontFamily: 'Share Tech Mono, monospace',
                  whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 5,
                }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: z.color }} />
                {z.flag} {z.name.split('-')[0]}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 8, color: '#00ff88', fontWeight: 700, letterSpacing: 1 }}>
              <div style={{ width: 5, height: 5, background: '#00ff88', borderRadius: '50%', boxShadow: '0 0 6px #00ff88' }} />LIVE
            </div>
            <div style={{ fontFamily: 'Share Tech Mono, monospace', fontSize: 14, color: '#00cfff' }}>{clock}</div>
            <button disabled={scanning} onClick={() => doScan()}
              style={{ background: 'rgba(0,207,255,.07)', border: '1px solid rgba(0,207,255,.2)', borderRadius: 5, color: '#00cfff', padding: '5px 10px', fontSize: 9, cursor: scanning ? 'not-allowed' : 'pointer', opacity: scanning ? 0.5 : 1 }}>
              {scanning ? '🔍 סורק...' : '⚡ סרוק'}
            </button>
            <button onClick={() => setAutoOn(o => !o)}
              style={{ background: autoOn ? 'rgba(0,255,136,.08)' : 'rgba(0,207,255,.07)', border: `1px solid ${autoOn ? '#00ff88' : 'rgba(0,207,255,.2)'}`, borderRadius: 5, color: autoOn ? '#00ff88' : '#00cfff', padding: '5px 10px', fontSize: 9, cursor: 'pointer' }}>
              {autoOn ? '⏸ אוטו' : '🔄 אוטו'}
            </button>
            <button onClick={() => selectZone(ZONES.find(z => z.id === 'global')!)}
              style={{ background: 'rgba(0,207,255,.07)', border: '1px solid rgba(0,207,255,.2)', borderRadius: 5, color: '#00cfff', padding: '5px 10px', fontSize: 9, cursor: 'pointer' }}>
              🌍 גלובלי
            </button>
          </div>
        </div>
        <div style={{ height: 2, background: '#0c1e2e' }}>
          <div style={{ height: '100%', background: 'linear-gradient(90deg,#00cfff,#00ff88)', width: `${progress}%`, transition: 'width .2s' }} />
        </div>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div ref={mapRef} style={{ flex: 1, background: '#020508' }} />

        {/* Sidebar */}
        <div style={{ width: 295, minWidth: 295, background: '#04090f', borderLeft: '1px solid #0c1e2e', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div style={{ padding: '12px 14px', borderBottom: '1px solid #0c1e2e', flexShrink: 0 }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>{zone?.flag || '🌍'}</div>
            <div style={{ fontSize: 15, fontWeight: 900, color: '#fff', marginBottom: 2 }}>{zone?.name || 'בחר אזור'}</div>
            <div style={{ fontSize: 9, color: '#2a4060', fontFamily: 'Share Tech Mono, monospace', letterSpacing: 1 }}>{zone?.parties.join(' · ') || 'GLOBAL'}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <div style={{ display: 'flex', gap: 2 }}>
                {[1,2,3,4,5].map(i => (
                  <div key={i} style={{ width: 18, height: 6, borderRadius: 2, background: i <= risk ? lvl.c : 'rgba(255,255,255,.05)' }} />
                ))}
              </div>
              <div style={{ fontFamily: 'Share Tech Mono, monospace', fontSize: 18, fontWeight: 900, color: lvl.c }}>{risk}/5</div>
              <div style={{ fontSize: 9, fontWeight: 700, color: lvl.c }}>{lvl.l}</div>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: 'flex', borderBottom: '1px solid #0c1e2e', flexShrink: 0 }}>
            {[
              { id: 'alerts', l: '🚨 התראות' },
              { id: 'diplo', l: '🌐 מדיני' },
              { id: 'military', l: '⚔️ צבאי' },
              { id: 'disaster', l: '🌪 אסון' },
              { id: 'report', l: '📋 דוח' },
            ].map(t => (
              <div key={t.id} onClick={() => setTab(t.id as any)}
                style={{ flex: 1, padding: '7px 0', textAlign: 'center', fontSize: 8, fontWeight: 700, letterSpacing: 0.6, color: tab === t.id ? '#00cfff' : '#2a4060', cursor: 'pointer', borderBottom: `2px solid ${tab === t.id ? '#00cfff' : 'transparent'}` }}>
                {t.l}
              </div>
            ))}
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {tab === 'alerts' && <AlertsList items={data.alerts || []} />}
            {tab === 'diplo' && <DiploList items={data.diplomatic || []} />}
            {tab === 'military' && <MilitaryList items={data.military || []} />}
            {tab === 'disaster' && <DisasterList items={data.disasters || []} />}
            {tab === 'report' && <ReportPanel report={data.report || {}} risk={data.riskLevel || risk} readiness={data.readinessScore || risk * 20} zoneName={zone?.name} />}
          </div>
        </div>
      </div>
    </div>
  );
}

const Empty = ({ icon, text }: { icon: string; text: string }) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '30px 16px', gap: 8, color: '#2a4060' }}>
    <div style={{ fontSize: 26 }}>{icon}</div>
    <div style={{ fontSize: 10 }}>{text}</div>
  </div>
);

function AlertsList({ items }: { items: any[] }) {
  if (!items.length) return <Empty icon="⚡" text="אין התראות — לחץ סרוק" />;
  return <>{items.map((a, i) => {
    const [c, bg] = SEV_C[a.severity] || SEV_C.medium;
    return (
      <div key={a.id || i} style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,.03)', borderRight: `2px solid ${c}`, background: bg, direction: 'rtl' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, gap: 5 }}>
          <span style={{ background: hexToRgba(c, 0.15), color: c, border: `1px solid ${hexToRgba(c, 0.3)}`, borderRadius: 6, padding: '1px 6px', fontSize: 7, fontWeight: 700 }}>{a.tags?.[0] || 'intel'}</span>
          {a.earlyWarning && <span style={{ background: 'rgba(255,136,0,.12)', border: '1px solid rgba(255,136,0,.3)', borderRadius: 6, padding: '1px 5px', fontSize: 7, color: '#ff8800', fontWeight: 700 }}>⚡ EWS</span>}
        </div>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', lineHeight: 1.35, marginBottom: 3 }}>{a.title}</div>
        <div style={{ fontSize: 9, color: '#8ab0c4', lineHeight: 1.5, marginBottom: 4 }}>{(a.body || '').slice(0, 200)}</div>
        {a.confidence && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 7, color: '#2a4060' }}>
            🎯<div style={{ width: 28, height: 2, background: '#0c1e2e' }}><div style={{ width: `${a.confidence}%`, height: '100%', background: c }} /></div>{a.confidence}%
          </div>
        )}
      </div>
    );
  })}</>;
}

function DiploList({ items }: { items: any[] }) {
  if (!items.length) return <Empty icon="🌐" text="אין נתונים" />;
  return <>{items.map((d, i) => (
    <div key={i} style={{ padding: '9px 12px', borderBottom: '1px solid rgba(255,255,255,.03)', direction: 'rtl' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
        <span style={{ fontSize: 18 }}>{d.flag || '🏳'}</span>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#fff' }}>{d.country}</span>
        <span style={{ fontSize: 8, fontWeight: 700, borderRadius: 5, padding: '2px 7px', border: `1px solid ${hexToRgba(d.trendColor || '#8ab0c4', 0.3)}`, color: d.trendColor || '#8ab0c4' }}>{d.role}</span>
      </div>
      <div style={{ fontSize: 9, color: '#8ab0c4', lineHeight: 1.5 }}>{d.status}</div>
      <div style={{ fontSize: 13, marginTop: 4 }}>{d.trend || '→'}</div>
    </div>
  ))}</>;
}

function MilitaryList({ items }: { items: any[] }) {
  if (!items.length) return <Empty icon="⚔️" text="אין נתונים" />;
  return <>{items.map((m, i) => (
    <div key={i} style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,.03)', borderRight: '2px solid #ff8800', background: 'rgba(255,136,0,.06)', direction: 'rtl' }}>
      <div style={{ background: 'rgba(255,136,0,.15)', color: '#ff8800', border: '1px solid rgba(255,136,0,.3)', borderRadius: 6, padding: '1px 6px', fontSize: 7, fontWeight: 700, display: 'inline-block', marginBottom: 4 }}>⚔️ {m.unit}</div>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#fff', marginBottom: 3 }}>{m.action}</div>
      <div style={{ fontSize: 9, color: '#8ab0c4' }}>{m.location} — {m.significance}</div>
    </div>
  ))}</>;
}

function DisasterList({ items }: { items: any[] }) {
  if (!items.length) return <Empty icon="🌪" text="אין אסונות פעילים" />;
  const sevCol: Record<string, string> = { critical: '#ff003c', high: '#ff8800', medium: '#ffdd00' };
  return <>{items.map((d, i) => (
    <div key={i} style={{ padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,.03)', display: 'flex', gap: 8, direction: 'rtl' }}>
      <div style={{ fontSize: 18 }}>{d.icon || '🌪'}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: '#fff', marginBottom: 2 }}>{d.title}</div>
        <div style={{ fontSize: 8, color: '#2a4060' }}>{d.detail}</div>
        {d.affected ? <div style={{ fontSize: 8, color: '#2a4060' }}>נפגעים: {d.affected.toLocaleString()}</div> : null}
        <span style={{ background: hexToRgba(sevCol[d.severity] || '#ffdd00', 0.15), color: sevCol[d.severity] || '#ffdd00', border: `1px solid ${hexToRgba(sevCol[d.severity] || '#ffdd00', 0.3)}`, borderRadius: 4, padding: '1px 5px', fontSize: 7, fontWeight: 700, marginTop: 3, display: 'inline-block' }}>{d.severity}</span>
      </div>
    </div>
  ))}</>;
}

function ReportPanel({ report, risk, readiness, zoneName }: any) {
  if (!report || !report.situation) return <Empty icon="📋" text="לחץ סרוק לדוח מלא" />;
  const c = LVL[Math.min(5, Math.max(1, Math.round(risk)))]?.c || '#00cfff';
  const Card = ({ title, body, color }: any) => (
    <div style={{ margin: '8px 10px 0', background: 'rgba(0,207,255,.04)', border: `1px solid ${color ? hexToRgba(color, 0.3) : 'rgba(0,207,255,.12)'}`, borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: color || '#00cfff', letterSpacing: 1, marginBottom: 8, fontFamily: 'Share Tech Mono, monospace' }}>{title}</div>
      <div style={{ fontSize: 10, color: color || '#8ab0c4', lineHeight: 1.7 }}>{body}</div>
    </div>
  );
  return <>
    <div style={{ margin: '10px 10px 0', background: 'rgba(0,207,255,.04)', border: '1px solid rgba(0,207,255,.12)', borderRadius: 8, padding: 12 }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: '#00cfff', letterSpacing: 1, marginBottom: 8, fontFamily: 'Share Tech Mono, monospace' }}>📋 {zoneName} — ניתוח מלא</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,.04)', fontSize: 9 }}>
        <span style={{ color: '#2a4060' }}>רמת סיכון</span><span style={{ color: c, fontFamily: 'Share Tech Mono, monospace' }}>{risk}/5 — {LVL[risk]?.l}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 9 }}>
        <span style={{ color: '#2a4060' }}>ציון כוננות</span><span style={{ color: '#fff', fontFamily: 'Share Tech Mono, monospace' }}>{readiness}%</span>
      </div>
    </div>
    <Card title="🌐 מצב כולל" body={report.situation} />
    {report.military && <Card title="⚔️ ניתוח צבאי" body={report.military} />}
    {report.diplomatic && <Card title="🌐 ניתוח מדיני" body={report.diplomatic} />}
    {report.outlook && <Card title="📅 תחזית 30 יום" body={report.outlook} />}
    {report.keyRisk && <Card title="⚠️ סיכון מרכזי" body={report.keyRisk} color={c} />}
    <div style={{ height: 20 }} />
  </>;
}

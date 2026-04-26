import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';
import mermaid from 'mermaid';

const SystemFlowCanvas = lazy(() => import('@/components/war-room/SystemFlowCanvas'));

interface Profile {
  id: string;
  user_id: string;
  display_name: string | null;
  email: string | null;
  location_consent: boolean;
  credits: number;
  last_login: string | null;
  created_at: string;
}

type TabId = 'users' | 'architecture' | 'health';

// ── System health polling ──
interface FunctionHealth {
  name: string;
  category: string;
  lastRun: string | null;
  status: 'ok' | 'warn' | 'error' | 'unknown';
  latency: number | null;
}

const EDGE_FUNCTIONS: { name: string; category: string }[] = [
  { name: 'telegram-poll', category: 'מודיעין' },
  { name: 'telegram-public-scrape', category: 'מודיעין' },
  { name: 'news-flash', category: 'מודיעין' },
  { name: 'x-feed-scrape', category: 'מודיעין' },
  { name: 'centcom-nato-feed', category: 'מודיעין' },
  { name: 'oref-alerts', category: 'התרעות' },
  { name: 'emergency-feed', category: 'התרעות' },
  { name: 'cisa-kev', category: 'התרעות' },
  { name: 'nasa-firms', category: 'גאו-מרחבי' },
  { name: 'nasa-eonet', category: 'גאו-מרחבי' },
  { name: 'usgs-earthquakes', category: 'גאו-מרחבי' },
  { name: 'opensky-flights', category: 'גאו-מרחבי' },
  { name: 'traffic-check', category: 'גאו-מרחבי' },
  { name: 'sentiment-analysis', category: 'AI' },
  { name: 'situation-analysis', category: 'AI' },
  { name: 'daily-intel-report', category: 'AI' },
  { name: 'translate-headlines', category: 'AI' },
  { name: 'system-health-check', category: 'תפעול' },
];

const SYSTEM_DIAGRAM = `graph TB
  subgraph TRIGGERS["Triggers"]
    direction LR
    CRON["Cron Jobs"]
    RT_WS["WebSocket"]
    USER_ACT["User Actions"]
  end

  subgraph EDGE["Edge Functions"]
    direction TB
    subgraph INTEL["Intelligence"]
      TG_POLL["telegram-poll"]
      TG_SCRAPE["telegram-scrape"]
      NEWS["news-flash"]
      X_FEED["x-feed"]
      CENTCOM["centcom-nato"]
    end
    subgraph ALERTS["Alerts"]
      OREF_FN["oref-alerts"]
      EMERG["emergency-feed"]
      CISA["cisa-kev"]
    end
    subgraph GEO["Geospatial"]
      NASA_F["nasa-firms"]
      NASA_E["nasa-eonet"]
      USGS["usgs-quakes"]
      OSKY["opensky"]
      TRAFFIC["traffic"]
    end
    subgraph AI["AI Analysis"]
      SENT["sentiment"]
      SIT["situation"]
      DAILY["daily-report"]
      TRANS["translate"]
    end
  end

  subgraph DB["Database"]
    TG_M["telegram_messages"]
    TG_G["telegram_groups"]
    OREF_T["oref_alerts"]
    EMERG_T["emergency_events"]
    INTEL_T["intel_reports"]
    DAILY_T["daily_intel_reports"]
    SENT_T["sentiment_scores"]
    PROF["profiles"]
    ROLES["user_roles"]
  end

  subgraph RT["Realtime"]
    PG["Postgres Changes"]
    CH["Channels"]
  end

  subgraph FE["Frontend"]
    subgraph PG2["Pages"]
      WR["War Room"]
      CP["CarPlay"]
      DR["Drive"]
      CMD["Command Center"]
      ADM["Admin"]
    end
    subgraph HOOKS["Hooks"]
      UW["useWarRoom"]
      UT["useTelegram"]
      UE["useEmergency"]
    end
  end

  subgraph EXT["External APIs"]
    TG_API["Telegram"]
    OREF_API["Pikud HaOref"]
    NASA_API["NASA"]
    USGS_API["USGS"]
    AI_GW["Lovable AI"]
  end

  TG_API --> TG_POLL
  TG_API --> TG_SCRAPE
  OREF_API --> OREF_FN
  NASA_API --> NASA_F
  NASA_API --> NASA_E
  USGS_API --> USGS
  AI_GW --> SENT
  AI_GW --> SIT
  AI_GW --> DAILY

  CRON --> TG_POLL
  CRON --> OREF_FN
  CRON --> SENT

  TG_POLL --> TG_M
  TG_SCRAPE --> TG_M
  OREF_FN --> OREF_T
  EMERG --> EMERG_T
  NEWS --> INTEL_T
  SENT --> SENT_T
  DAILY --> DAILY_T
  NASA_F --> EMERG_T
  USGS --> EMERG_T

  TG_M --> PG
  OREF_T --> PG
  EMERG_T --> PG
  PG --> CH

  CH --> UW
  CH --> UT
  CH --> UE

  UW --> WR
  UW --> CMD
  UT --> WR
  UE --> WR

  classDef trigger fill:#ff6d00,stroke:#ff6d00,color:#000
  classDef edge fill:#1565c0,stroke:#42a5f5,color:#fff
  classDef db fill:#2e7d32,stroke:#66bb6a,color:#fff
  classDef rt fill:#6a1b9a,stroke:#ab47bc,color:#fff
  classDef fe fill:#0097a7,stroke:#26c6da,color:#fff
  classDef ext fill:#c62828,stroke:#ef5350,color:#fff

  class CRON,RT_WS,USER_ACT trigger
  class TG_POLL,TG_SCRAPE,NEWS,X_FEED,CENTCOM,OREF_FN,EMERG,CISA,NASA_F,NASA_E,USGS,OSKY,TRAFFIC,SENT,SIT,DAILY,TRANS edge
  class TG_M,TG_G,OREF_T,EMERG_T,INTEL_T,DAILY_T,SENT_T,PROF,ROLES db
  class PG,CH rt
  class WR,CP,DR,CMD,ADM,UW,UT,UE fe
  class TG_API,OREF_API,NASA_API,USGS_API,AI_GW ext`;

// ── Mermaid Diagram Component ──
const MermaidDiagram = () => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'dark',
      themeVariables: {
        darkMode: true,
        background: '#0a0f1a',
        primaryColor: '#1565c0',
        primaryTextColor: '#e0e0e0',
        primaryBorderColor: '#42a5f5',
        lineColor: '#42a5f5',
        secondaryColor: '#2e7d32',
        tertiaryColor: '#6a1b9a',
        fontSize: '12px',
      },
      flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
        curve: 'basis',
      },
    });

    const render = async () => {
      if (!containerRef.current) return;
      try {
        const { svg } = await mermaid.render('sys-arch-diagram', SYSTEM_DIAGRAM);
        containerRef.current.innerHTML = svg;
        // Make SVG responsive
        const svgEl = containerRef.current.querySelector('svg');
        if (svgEl) {
          svgEl.style.width = '100%';
          svgEl.style.height = 'auto';
          svgEl.style.maxHeight = '75vh';
        }
      } catch (e) {
        console.error('Mermaid render error:', e);
        if (containerRef.current) {
          containerRef.current.innerHTML = '<div style="color:#ff5252;padding:20px;">שגיאה ברנדור התרשים</div>';
        }
      }
    };
    render();
  }, []);

  return <div ref={containerRef} />;
};

// ── Data Flow Stats ──
const DataFlowStats = () => {
  const [counts, setCounts] = useState({
    telegramMsgs: 0,
    orefAlerts: 0,
    emergencyEvents: 0,
    intelReports: 0,
    sentimentScores: 0,
    dailyReports: 0,
    users: 0,
  });

  useEffect(() => {
    const fetchCounts = async () => {
      const [tg, oref, emerg, intel, sent, daily, users] = await Promise.all([
        supabase.from('telegram_messages').select('id', { count: 'exact', head: true }),
        supabase.from('oref_alerts').select('id', { count: 'exact', head: true }),
        supabase.from('emergency_events').select('id', { count: 'exact', head: true }),
        supabase.from('intel_reports').select('id', { count: 'exact', head: true }),
        supabase.from('sentiment_scores').select('id', { count: 'exact', head: true }),
        supabase.from('daily_intel_reports').select('id', { count: 'exact', head: true }),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
      ]);
      setCounts({
        telegramMsgs: tg.count || 0,
        orefAlerts: oref.count || 0,
        emergencyEvents: emerg.count || 0,
        intelReports: intel.count || 0,
        sentimentScores: sent.count || 0,
        dailyReports: daily.count || 0,
        users: users.count || 0,
      });
    };
    fetchCounts();
    const interval = setInterval(fetchCounts, 30000);
    return () => clearInterval(interval);
  }, []);

  const items = [
    { label: 'הודעות טלגרם', count: counts.telegramMsgs, color: '#42a5f5', icon: '💬' },
    { label: 'התרעות פיקוד העורף', count: counts.orefAlerts, color: '#ff1744', icon: '🚨' },
    { label: 'אירועי חירום', count: counts.emergencyEvents, color: '#ff6d00', icon: '⚠️' },
    { label: 'דיווחי מודיעין', count: counts.intelReports, color: '#00e676', icon: '📋' },
    { label: 'ניתוחי סנטימנט', count: counts.sentimentScores, color: '#ce93d8', icon: '📊' },
    { label: 'דו"חות יומיים', count: counts.dailyReports, color: '#ffd740', icon: '📰' },
    { label: 'משתמשים', count: counts.users, color: '#26c6da', icon: '👥' },
  ];

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 20 }}>
      {items.map(item => (
        <div key={item.label} style={{
          background: 'rgba(0, 20, 40, 0.9)',
          border: `1px solid ${item.color}33`,
          borderRadius: 8,
          padding: '12px 14px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 20 }}>{item.icon}</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: item.color, fontFamily: 'Orbitron, monospace' }}>
            {item.count.toLocaleString()}
          </div>
          <div style={{ fontSize: 10, color: '#78909c', marginTop: 2 }}>{item.label}</div>
        </div>
      ))}
    </div>
  );
};

const Admin = () => {
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [search, setSearch] = useState('');
  const [stats, setStats] = useState({ total: 0, withLocation: 0, today: 0 });
  const [activeTab, setActiveTab] = useState<TabId>('architecture');

  useEffect(() => {
    const checkAdmin = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate('/register'); return; }

      const { data: roles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);

      const hasAdmin = roles?.some((r: any) => r.role === 'admin');
      if (!hasAdmin) { navigate('/'); return; }
      setIsAdmin(true);
      fetchProfiles();
    };
    checkAdmin();
  }, [navigate]);

  const fetchProfiles = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (data) {
      setProfiles(data as Profile[]);
      const today = new Date().toDateString();
      setStats({
        total: data.length,
        withLocation: data.filter((p: any) => p.location_consent).length,
        today: data.filter((p: any) => new Date(p.created_at).toDateString() === today).length,
      });
    }
    setLoading(false);
  };

  const exportCSV = () => {
    const headers = ['שם', 'אימייל', 'תאריך הרשמה', 'אישור מיקום', 'קרדיטים', 'כניסה אחרונה'];
    const rows = filteredProfiles.map(p => [
      p.display_name || '-',
      p.email || '-',
      new Date(p.created_at).toLocaleDateString('he-IL'),
      p.location_consent ? 'כן' : 'לא',
      String(p.credits),
      p.last_login ? new Date(p.last_login).toLocaleDateString('he-IL') : '-',
    ]);
    const csv = '\uFEFF' + [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `users_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredProfiles = profiles.filter(p =>
    !search || (p.display_name || '').includes(search) || (p.email || '').includes(search)
  );

  if (!isAdmin) return null;

  const cardStyle: React.CSSProperties = {
    background: 'rgba(0, 20, 40, 0.9)',
    border: '1px solid hsla(185, 80%, 40%, 0.2)',
    borderRadius: 8,
    padding: '16px 20px',
    textAlign: 'center' as const,
  };

  const tabs: { id: TabId; label: string; icon: string }[] = [
    { id: 'users', label: 'משתמשים', icon: '👥' },
    { id: 'architecture', label: 'ארכיטקטורה', icon: '🏗️' },
    { id: 'health', label: 'בריאות המערכת', icon: '💚' },
  ];

  return (
    <div dir="rtl" style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a0f1a 0%, #0d1b2a 50%, #1b2838 100%)',
      color: '#e0e0e0',
      padding: '20px 24px',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 900, fontFamily: 'Orbitron, monospace', color: 'hsl(185, 100%, 55%)', letterSpacing: 2, margin: 0 }}>
            🛡️ ADMIN PANEL
          </h1>
          <div style={{ fontSize: 11, color: 'hsla(185, 60%, 50%, 0.5)', fontFamily: 'Orbitron, monospace', marginTop: 4 }}>
            SYSTEM MANAGEMENT
          </div>
        </div>
        <button onClick={() => navigate('/')} style={{
          background: 'rgba(0, 200, 255, 0.1)', border: '1px solid hsla(185, 80%, 40%, 0.3)',
          borderRadius: 6, padding: '8px 16px', color: 'hsl(185, 100%, 55%)', cursor: 'pointer',
          fontSize: 13, fontWeight: 600,
        }}>
          ← חזרה למערכת
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, borderBottom: '1px solid hsla(185, 80%, 40%, 0.15)', paddingBottom: 12 }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: activeTab === tab.id ? 'rgba(0, 200, 255, 0.15)' : 'transparent',
              border: `1px solid ${activeTab === tab.id ? 'hsla(185, 80%, 40%, 0.5)' : 'hsla(185, 80%, 40%, 0.15)'}`,
              borderRadius: 6,
              padding: '8px 18px',
              color: activeTab === tab.id ? 'hsl(185, 100%, 55%)' : '#78909c',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: activeTab === tab.id ? 700 : 500,
              transition: 'all 0.2s',
            }}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ═══ TAB: Users ═══ */}
      {activeTab === 'users' && (
        <>
          {/* Stats Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12, marginBottom: 24 }}>
            <div style={cardStyle}>
              <div style={{ fontSize: 28, fontWeight: 900, color: 'hsl(185, 100%, 55%)', fontFamily: 'Orbitron, monospace' }}>{stats.total}</div>
              <div style={{ fontSize: 11, color: '#78909c', marginTop: 4 }}>סה"כ משתמשים</div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 28, fontWeight: 900, color: '#00e676', fontFamily: 'Orbitron, monospace' }}>{stats.withLocation}</div>
              <div style={{ fontSize: 11, color: '#78909c', marginTop: 4 }}>אישרו מיקום</div>
            </div>
            <div style={cardStyle}>
              <div style={{ fontSize: 28, fontWeight: 900, color: '#ffd740', fontFamily: 'Orbitron, monospace' }}>{stats.today}</div>
              <div style={{ fontSize: 11, color: '#78909c', marginTop: 4 }}>נרשמו היום</div>
            </div>
          </div>

          {/* Toolbar */}
          <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="🔍 חיפוש לפי שם או אימייל..."
              style={{
                flex: 1, minWidth: 200, padding: '10px 14px', borderRadius: 6,
                background: 'rgba(0, 20, 40, 0.8)', border: '1px solid hsla(185, 80%, 40%, 0.2)',
                color: '#e0e0e0', fontSize: 13, outline: 'none',
              }}
            />
            <button onClick={exportCSV} style={{
              background: 'linear-gradient(135deg, hsl(185, 100%, 40%), hsl(185, 80%, 30%))',
              border: 'none', borderRadius: 6, padding: '10px 20px', color: '#fff',
              fontWeight: 700, fontSize: 13, cursor: 'pointer',
            }}>
              📥 ייצוא CSV
            </button>
          </div>

          {/* Users Table */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: '#78909c' }}>⏳ טוען...</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid hsla(185, 80%, 40%, 0.2)' }}>
                    {['#', 'שם', 'אימייל', 'תאריך הרשמה', 'מיקום', 'קרדיטים', 'כניסה אחרונה'].map(h => (
                      <th key={h} style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 700, color: 'hsl(185, 100%, 55%)', fontSize: 11, fontFamily: 'Orbitron, monospace', letterSpacing: 1 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredProfiles.map((p, i) => (
                    <tr key={p.id} style={{ borderBottom: '1px solid hsla(185, 80%, 40%, 0.08)', transition: 'background 0.2s' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0, 200, 255, 0.03)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
                      <td style={{ padding: '10px 12px', color: '#546e7a' }}>{i + 1}</td>
                      <td style={{ padding: '10px 12px', fontWeight: 600 }}>{p.display_name || '—'}</td>
                      <td style={{ padding: '10px 12px', color: '#90a4ae', direction: 'ltr', textAlign: 'right' }}>{p.email || '—'}</td>
                      <td style={{ padding: '10px 12px', color: '#78909c' }}>
                        {new Date(p.created_at).toLocaleDateString('he-IL')} {new Date(p.created_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <span style={{
                          display: 'inline-block', padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                          background: p.location_consent ? 'rgba(0, 230, 118, 0.1)' : 'rgba(255, 82, 82, 0.1)',
                          color: p.location_consent ? '#00e676' : '#ff5252',
                          border: `1px solid ${p.location_consent ? 'rgba(0, 230, 118, 0.3)' : 'rgba(255, 82, 82, 0.3)'}`,
                        }}>
                          {p.location_consent ? '✅ כן' : '❌ לא'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', fontFamily: 'Orbitron, monospace', fontSize: 12, color: p.credits > 50 ? '#00e676' : p.credits > 10 ? '#ffd740' : '#ff5252' }}>
                        {p.credits}
                      </td>
                      <td style={{ padding: '10px 12px', color: '#546e7a', fontSize: 11 }}>
                        {p.last_login ? new Date(p.last_login).toLocaleString('he-IL') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredProfiles.length === 0 && (
                <div style={{ textAlign: 'center', padding: 30, color: '#546e7a' }}>אין משתמשים רשומים</div>
              )}
            </div>
          )}
        </>
      )}

      {/* ═══ TAB: Architecture — Live Packet Flow ═══ */}
      {activeTab === 'architecture' && (
        <>
          <Suspense fallback={
            <div style={{ textAlign: 'center', padding: 60, color: '#42a5f5', fontFamily: 'Orbitron, monospace' }}>
              ⏳ טוען ויזואליזציה...
            </div>
          }>
            <SystemFlowCanvas />
          </Suspense>

          {/* Layer descriptions */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12, marginTop: 16 }}>
            {[
              { title: 'External APIs (7)', color: '#ef5350', desc: 'Telegram, פיקוד העורף, NASA, USGS, CENTCOM, X, Lovable AI.' },
              { title: 'Edge Functions (10)', color: '#42a5f5', desc: 'מודיעין, התרעות, גאו-מרחבי, AI — כל הפונקציות שאוספות ומעבדות נתונים.' },
              { title: 'Database (7 טבלאות)', color: '#66bb6a', desc: 'Postgres עם RLS. הודעות, התרעות, אירועים, דוחות, סנטימנט, פרופילים.' },
              { title: 'Realtime', color: '#ab47bc', desc: 'Postgres Changes → Channels. שידור חי של שינויים לכל הקליינטים.' },
              { title: 'Frontend (5 דפים)', color: '#26c6da', desc: 'War Room, CarPlay, Drive, Command Center, Admin.' },
            ].map(layer => (
              <div key={layer.title} style={{
                background: 'rgba(0, 20, 40, 0.9)',
                border: `1px solid ${layer.color}33`,
                borderRadius: 8,
                padding: '14px 16px',
                borderRight: `4px solid ${layer.color}`,
              }}>
                <div style={{ fontSize: 13, fontWeight: 800, color: layer.color, marginBottom: 6 }}>{layer.title}</div>
                <div style={{ fontSize: 11, color: '#90a4ae', lineHeight: 1.5 }}>{layer.desc}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ═══ TAB: System Health ═══ */}
      {activeTab === 'health' && (
        <SystemHealthTab />
      )}
    </div>
  );
};

// ── System Health Tab ──
const SystemHealthTab = () => {
  const [recentActivity, setRecentActivity] = useState<{ table: string; count: number; latest: string }[]>([]);
  const [healthResults, setHealthResults] = useState<Record<string, { status: 'ok' | 'error' | 'pending'; latency: number | null }>>({});
  const [checking, setChecking] = useState(false);
  const [hourlyData, setHourlyData] = useState<{ hour: string; telegram: number; oref: number; emergency: number }[]>([]);

  useEffect(() => {
    const fetch24hActivity = async () => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const tables = [
        { name: 'telegram_messages', field: 'created_at' },
        { name: 'oref_alerts', field: 'created_at' },
        { name: 'emergency_events', field: 'created_at' },
        { name: 'intel_reports', field: 'created_at' },
        { name: 'sentiment_scores', field: 'created_at' },
      ];

      const results = await Promise.all(
        tables.map(async t => {
          const { count, data } = await supabase
            .from(t.name as any)
            .select('created_at', { count: 'exact' })
            .gte(t.field, since)
            .order(t.field, { ascending: false })
            .limit(1);
          const latest = (data as any)?.[0]?.created_at || '—';
          return { table: t.name, count: count || 0, latest };
        })
      );
      setRecentActivity(results);
    };

    const fetchHourlyHistory = async () => {
      const now = Date.now();
      const hours: typeof hourlyData = [];
      // Build 24 hour buckets
      for (let i = 23; i >= 0; i--) {
        const start = new Date(now - (i + 1) * 3600000).toISOString();
        const end = new Date(now - i * 3600000).toISOString();
        const hourLabel = new Date(now - i * 3600000).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
        hours.push({ hour: hourLabel, telegram: 0, oref: 0, emergency: 0 });
      }

      // Fetch all records from last 24h in one go per table, then bucket client-side
      const since = new Date(now - 24 * 3600000).toISOString();
      const [tgRes, orefRes, emergRes] = await Promise.all([
        supabase.from('telegram_messages').select('created_at').gte('created_at', since).order('created_at', { ascending: true }),
        supabase.from('oref_alerts').select('created_at').gte('created_at', since).order('created_at', { ascending: true }),
        supabase.from('emergency_events').select('created_at').gte('created_at', since).order('created_at', { ascending: true }),
      ]);

      const bucket = (records: any[] | null, key: 'telegram' | 'oref' | 'emergency') => {
        (records || []).forEach((r: any) => {
          const ts = new Date(r.created_at).getTime();
          const idx = Math.floor((ts - (now - 24 * 3600000)) / 3600000);
          if (idx >= 0 && idx < 24) (hours[idx] as any)[key]++;
        });
      };

      bucket(tgRes.data, 'telegram');
      bucket(orefRes.data, 'oref');
      bucket(emergRes.data, 'emergency');
      setHourlyData(hours);
    };

    fetch24hActivity();
    fetchHourlyHistory();
    const interval = setInterval(() => { fetch24hActivity(); fetchHourlyHistory(); }, 60000);
    return () => clearInterval(interval);
  }, []);

  const runHealthCheck = useCallback(async () => {
    setChecking(true);
    const initial: typeof healthResults = {};
    EDGE_FUNCTIONS.forEach(fn => { initial[fn.name] = { status: 'pending', latency: null }; });
    setHealthResults(initial);

    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const baseUrl = `https://${projectId}.supabase.co/functions/v1`;

    await Promise.allSettled(
      EDGE_FUNCTIONS.map(async fn => {
        const t0 = performance.now();
        try {
          const res = await fetch(`${baseUrl}/${fn.name}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${anonKey}`,
            },
            body: JSON.stringify({ health_check: true }),
            signal: AbortSignal.timeout(10000),
          });
          const latency = Math.round(performance.now() - t0);
          setHealthResults(prev => ({
            ...prev,
            [fn.name]: { status: res.ok || res.status === 400 ? 'ok' : 'error', latency },
          }));
        } catch {
          const latency = Math.round(performance.now() - t0);
          setHealthResults(prev => ({
            ...prev,
            [fn.name]: { status: 'error', latency },
          }));
        }
      })
    );
    setChecking(false);
  }, []);

  const categoryColors: Record<string, string> = {
    'מודיעין': '#42a5f5',
    'התרעות': '#ff1744',
    'גאו-מרחבי': '#00e676',
    'AI': '#ce93d8',
    'תפעול': '#ffd740',
  };

  const maxHourly = Math.max(1, ...hourlyData.map(h => h.telegram + h.oref + h.emergency));

  return (
    <>
      {/* Health Check Button */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h3 style={{ fontSize: 14, fontWeight: 800, color: 'hsl(185, 100%, 55%)', fontFamily: 'Orbitron, monospace', margin: 0 }}>
          🏥 בדיקת בריאות חיה
        </h3>
        <button
          onClick={runHealthCheck}
          disabled={checking}
          style={{
            background: checking ? 'rgba(0, 200, 255, 0.05)' : 'linear-gradient(135deg, hsl(185, 100%, 40%), hsl(160, 80%, 30%))',
            border: '1px solid hsla(185, 80%, 40%, 0.4)',
            borderRadius: 6,
            padding: '10px 24px',
            color: '#fff',
            fontWeight: 700,
            fontSize: 13,
            cursor: checking ? 'not-allowed' : 'pointer',
            fontFamily: 'Orbitron, monospace',
            letterSpacing: 1,
          }}
        >
          {checking ? '⏳ בודק...' : '▶ הרץ בדיקה'}
        </button>
      </div>

      {/* Health Results Grid */}
      {Object.keys(healthResults).length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, marginBottom: 24 }}>
          {EDGE_FUNCTIONS.map(fn => {
            const r = healthResults[fn.name];
            if (!r) return null;
            const statusColor = r.status === 'ok' ? '#00e676' : r.status === 'error' ? '#ff5252' : '#ffd740';
            const statusIcon = r.status === 'ok' ? '✅' : r.status === 'error' ? '❌' : '⏳';
            return (
              <div key={fn.name} style={{
                background: 'rgba(0, 20, 40, 0.9)',
                border: `1px solid ${statusColor}33`,
                borderRadius: 8,
                padding: '10px 14px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#e0e0e0', fontFamily: 'monospace' }}>
                    {statusIcon} {fn.name}
                  </div>
                  <div style={{ fontSize: 9, color: categoryColors[fn.category] || '#78909c' }}>{fn.category}</div>
                </div>
                <div style={{
                  fontSize: 13,
                  fontWeight: 900,
                  fontFamily: 'Orbitron, monospace',
                  color: r.latency !== null ? (r.latency < 1000 ? '#00e676' : r.latency < 3000 ? '#ffd740' : '#ff5252') : '#546e7a',
                }}>
                  {r.latency !== null ? `${r.latency}ms` : '—'}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 24h Hourly Bar Chart */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, fontWeight: 800, color: 'hsl(185, 100%, 55%)', fontFamily: 'Orbitron, monospace', marginBottom: 12 }}>
          📈 היסטוריית נתונים — 24 שעות אחרונות
        </h3>
        <div style={{
          background: 'rgba(0, 20, 40, 0.9)',
          border: '1px solid hsla(185, 80%, 40%, 0.15)',
          borderRadius: 8,
          padding: '16px 12px 8px',
          overflowX: 'auto',
        }}>
          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 10, justifyContent: 'center' }}>
            <span style={{ color: '#42a5f5' }}>■ הודעות טלגרם</span>
            <span style={{ color: '#ff1744' }}>■ התרעות</span>
            <span style={{ color: '#ff6d00' }}>■ אירועי חירום</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 140, minWidth: 600 }}>
            {hourlyData.map((h, i) => {
              const total = h.telegram + h.oref + h.emergency;
              const barH = (total / maxHourly) * 120;
              const tgH = total > 0 ? (h.telegram / total) * barH : 0;
              const orefH = total > 0 ? (h.oref / total) * barH : 0;
              const emergH = total > 0 ? (h.emergency / total) * barH : 0;
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 20 }}>
                  <div style={{ fontSize: 8, color: '#546e7a', marginBottom: 2 }}>{total || ''}</div>
                  <div style={{ width: '70%', display: 'flex', flexDirection: 'column-reverse' }}>
                    {tgH > 0 && <div style={{ height: tgH, background: '#42a5f5', borderRadius: '2px 2px 0 0' }} />}
                    {orefH > 0 && <div style={{ height: orefH, background: '#ff1744' }} />}
                    {emergH > 0 && <div style={{ height: emergH, background: '#ff6d00', borderRadius: '0 0 2px 2px' }} />}
                    {total === 0 && <div style={{ height: 2, background: '#1a2a3a', borderRadius: 2 }} />}
                  </div>
                  <div style={{ fontSize: 7, color: '#546e7a', marginTop: 4, transform: 'rotate(-45deg)', whiteSpace: 'nowrap' }}>{h.hour}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 24h Activity */}
      <div style={{ marginBottom: 24 }}>
        <h3 style={{ fontSize: 14, fontWeight: 800, color: 'hsl(185, 100%, 55%)', fontFamily: 'Orbitron, monospace', marginBottom: 12 }}>
          📊 סיכום 24 שעות
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          {recentActivity.map(a => (
            <div key={a.table} style={{
              background: 'rgba(0, 20, 40, 0.9)',
              border: '1px solid hsla(185, 80%, 40%, 0.15)',
              borderRadius: 8,
              padding: '12px 14px',
            }}>
              <div style={{ fontSize: 11, color: '#78909c', fontFamily: 'monospace' }}>{a.table}</div>
              <div style={{ fontSize: 24, fontWeight: 900, color: a.count > 0 ? '#00e676' : '#ff5252', fontFamily: 'Orbitron, monospace' }}>
                {a.count.toLocaleString()}
              </div>
              <div style={{ fontSize: 9, color: '#546e7a', marginTop: 2 }}>
                אחרון: {a.latest !== '—' ? new Date(a.latest).toLocaleString('he-IL') : '—'}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Edge Functions Grid */}
      <h3 style={{ fontSize: 14, fontWeight: 800, color: 'hsl(185, 100%, 55%)', fontFamily: 'Orbitron, monospace', marginBottom: 12 }}>
        ⚡ Edge Functions ({EDGE_FUNCTIONS.length})
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
        {EDGE_FUNCTIONS.map(fn => (
          <div key={fn.name} style={{
            background: 'rgba(0, 20, 40, 0.9)',
            border: `1px solid ${(categoryColors[fn.category] || '#42a5f5')}33`,
            borderRadius: 8,
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%',
              background: categoryColors[fn.category] || '#42a5f5',
              boxShadow: `0 0 6px ${categoryColors[fn.category] || '#42a5f5'}`,
            }} />
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#e0e0e0', fontFamily: 'monospace' }}>{fn.name}</div>
              <div style={{ fontSize: 9, color: categoryColors[fn.category] || '#78909c' }}>{fn.category}</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
};

export default Admin;

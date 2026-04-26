import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Tooltip } from 'recharts';

interface DailyReport {
  id: string;
  report_date: string;
  summary: string;
  threat_level: number;
  fronts: Record<string, { mentions: number; status: string; risk: number }>;
  key_findings: string[];
  recommendations: string[];
  source_stats: Record<string, number>;
  created_at: string;
}

const STATUS_COLORS: Record<string, string> = { escalating: '#ff1744', elevated: '#ff6d00', monitoring: '#00e676' };
const STATUS_LABELS: Record<string, string> = { escalating: 'הסלמה', elevated: 'מוגבר', monitoring: 'ניטור' };
const FRONT_FLAGS: Record<string, string> = { iran: '🇮🇷', lebanon: '🇱🇧', gaza: '🇵🇸', yemen: '🇾🇪', syria: '🇸🇾', iraq: '🇮🇶', westbank: '🏴' };
const FRONT_LABELS: Record<string, string> = { iran: 'איראן', lebanon: 'לבנון', gaza: 'עזה', yemen: 'תימן', syria: 'סוריה', iraq: 'עיראק', westbank: 'יו"ש' };

const DailyIntelReport = () => {
  const [report, setReport] = useState<DailyReport | null>(null);
  const [trendData, setTrendData] = useState<{ date: string; threat: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [expandedSection, setExpandedSection] = useState<string | null>('situation');
  const [translatedTexts, setTranslatedTexts] = useState<Map<string, string>>(new Map());

  const fetchReport = async () => {
    setLoading(true);
    const [latestRes, trendRes] = await Promise.all([
      supabase.from('daily_intel_reports').select('*').order('report_date', { ascending: false }).limit(1).single(),
      supabase.from('daily_intel_reports').select('report_date, threat_level').order('report_date', { ascending: true }).limit(30),
    ]);
    setReport(latestRes.data as unknown as DailyReport | null);
    setTrendData((trendRes.data || []).map((d: any) => ({
      date: new Date(d.report_date).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' }),
      threat: d.threat_level,
    })));
    setLoading(false);
  };

  const generateReport = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('daily-intel-report');
      if (!error && data?.report) { setReport(data.report); fetchReport(); }
    } finally { setGenerating(false); }
  };

  useEffect(() => { fetchReport(); }, []);

  const translateTexts = useCallback(async (texts: string[]) => {
    const hebrewRegex = /[\u0590-\u05FF]/;
    const toTranslate = texts
      .map(text => (text || '').trim())
      .filter(text => text.length > 0 && !hebrewRegex.test(text) && !translatedTexts.has(text));
    if (toTranslate.length === 0) return;

    try {
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/translate-headlines`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts: toTranslate }),
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) return;

      const data = await res.json();
      if (!Array.isArray(data.translations)) return;

      setTranslatedTexts(prev => {
        const next = new Map(prev);
        toTranslate.forEach((orig, idx) => {
          if (data.translations[idx]) next.set(orig, data.translations[idx]);
        });
        return next;
      });
    } catch (error) {
      console.warn('Daily report translation failed:', error);
    }
  }, [translatedTexts]);

  const getHebrewText = useCallback((text: string) => {
    const normalized = (text || '').trim();
    const hebrewRegex = /[\u0590-\u05FF]/;
    if (!normalized || hebrewRegex.test(normalized)) return normalized;
    return translatedTexts.get(normalized) || normalized;
  }, [translatedTexts]);

  useEffect(() => {
    if (!report) return;
    const texts = [report.summary, ...(report.key_findings || []), ...(report.recommendations || [])].filter(Boolean);
    void translateTexts(texts);
  }, [report, translateTexts]);

  const threatColor = !report ? '#455a64' :
    report.threat_level >= 70 ? '#ff1744' :
    report.threat_level >= 40 ? '#ff6d00' :
    report.threat_level >= 20 ? '#ffd600' : '#00e676';

  const threatLabel = !report ? '' :
    report.threat_level >= 70 ? 'קריטי' :
    report.threat_level >= 40 ? 'מוגבר' :
    report.threat_level >= 20 ? 'ניטור' : 'שגרה';

  const SectionHeader = ({ id, title, icon }: { id: string; title: string; icon: string }) => (
    <button onClick={() => setExpandedSection(expandedSection === id ? null : id)}
      className="w-full flex items-center gap-2 py-2.5 px-3 transition-all"
      style={{
        borderRight: expandedSection === id ? `3px solid ${threatColor}` : '3px solid transparent',
        background: expandedSection === id ? `${threatColor}12` : 'transparent',
      }}>
      <span className="text-sm">{icon}</span>
      <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 11, fontWeight: 800, color: expandedSection === id ? '#fff' : 'rgba(255,255,255,0.5)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{title}</span>
      <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', marginRight: 'auto' }}>{expandedSection === id ? '▼' : '◀'}</span>
    </button>
  );

  return (
    <div className="rounded-xl overflow-hidden" dir="rtl" style={{
      background: 'linear-gradient(180deg, rgba(0,15,25,0.95), rgba(0,10,20,0.98))',
      border: `1px solid ${threatColor}30`,
      boxShadow: `0 0 30px ${threatColor}10, inset 0 1px 0 rgba(255,255,255,0.04)`,
    }}>
      {/* ═══ HEADER — Military briefing style ═══ */}
      <div className="relative px-4 py-3" style={{
        background: `linear-gradient(135deg, rgba(0,20,35,0.9), ${threatColor}18)`,
        borderBottom: `2px solid ${threatColor}40`,
      }}>
        {/* Decorative classification stripe */}
        <div className="absolute top-0 inset-x-0 h-0.5" style={{ background: `linear-gradient(90deg, transparent, ${threatColor}, transparent)` }} />
        
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="relative">
              <span className="text-2xl" style={{ filter: `drop-shadow(0 0 8px ${threatColor}66)` }}>🎖️</span>
              <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: threatColor, boxShadow: `0 0 8px ${threatColor}` }} />
            </div>
            <div>
              <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 13, fontWeight: 900, letterSpacing: '0.15em', color: '#fff', textShadow: `0 0 20px ${threatColor}44` }}>
                הניתוח של שולה
              </div>
              <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 9, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.2em' }}>
                דוח מודיעין יומי — סד״ק
              </div>
              {report && <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 8, color: `${threatColor}99`, marginTop: 2 }}>
                {new Date(report.report_date).toLocaleDateString('he-IL', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </div>}
            </div>
          </div>
          <button onClick={generateReport} disabled={generating}
            className="transition-all active:scale-95"
            style={{
              fontFamily: "'Share Tech Mono', monospace",
              fontSize: 9, fontWeight: 700, padding: '6px 14px',
              background: `${threatColor}15`,
              border: `1px solid ${threatColor}40`,
              color: threatColor,
              borderRadius: 8, cursor: generating ? 'wait' : 'pointer',
              letterSpacing: '0.1em',
            }}>
            {generating ? '⏳ מייצר...' : '🔄 עדכן דוח'}
          </button>
        </div>
      </div>

      <div className="px-3 py-3">
        {loading ? (
          <div className="flex items-center justify-center py-8 gap-3">
            <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: `${threatColor}40`, borderTopColor: 'transparent' }} />
            <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.15em' }}>טוען דוח מודיעין...</span>
          </div>
        ) : !report ? (
          <div className="flex flex-col items-center py-8 gap-3">
            <span className="text-3xl opacity-20">📡</span>
            <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: 'rgba(255,255,255,0.3)', letterSpacing: '0.15em' }}>אין דוח זמין — לחץ "עדכן דוח" ליצירה</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">

            {/* ═══ 1. THREAT LEVEL — dramatic gauge ═══ */}
            <div className="p-3 rounded-lg relative overflow-hidden" style={{
              background: `linear-gradient(135deg, ${threatColor}08, ${threatColor}04)`,
              border: `1px solid ${threatColor}25`,
            }}>
              {/* Background glow */}
              <div className="absolute inset-0 pointer-events-none" style={{
                background: `radial-gradient(ellipse at 80% 50%, ${threatColor}15, transparent 60%)`,
              }} />
              <div className="relative flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.15em' }}>THREAT LEVEL</span>
                  <span style={{
                    fontFamily: "'Share Tech Mono', monospace",
                    fontSize: 8, fontWeight: 700, padding: '2px 8px',
                    background: `${threatColor}20`, border: `1px solid ${threatColor}40`,
                    color: threatColor, borderRadius: 4, letterSpacing: '0.1em',
                  }}>{threatLabel}</span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 28, fontWeight: 900, color: threatColor, textShadow: `0 0 20px ${threatColor}44`, lineHeight: 1 }}>
                    {report.threat_level}
                  </span>
                  <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.25)' }}>/100</span>
                </div>
              </div>
              {/* Progress bar */}
              <div className="relative" style={{ height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{
                  width: `${report.threat_level}%`, height: '100%',
                  background: `linear-gradient(90deg, ${threatColor}88, ${threatColor})`,
                  borderRadius: 3,
                  boxShadow: `0 0 12px ${threatColor}44`,
                  transition: 'width 1s ease',
                }} />
              </div>
            </div>

            {/* ═══ 2. TREND ═══ */}
            {trendData.length > 1 && (
              <div className="p-2.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.5)', marginBottom: 6, letterSpacing: '0.15em' }}>📈 TREND — {trendData.length} DAYS</div>
                <div style={{ width: '100%', height: 50 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={trendData} margin={{ top: 2, right: 2, bottom: 0, left: -20 }}>
                      <defs>
                        <linearGradient id="threatGradDark" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={threatColor} stopOpacity={0.3} />
                          <stop offset="100%" stopColor={threatColor} stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="date" tick={{ fontSize: 7, fill: 'rgba(255,255,255,0.3)', fontFamily: "'Share Tech Mono', monospace" }} axisLine={false} tickLine={false} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 7, fill: 'rgba(255,255,255,0.2)', fontFamily: "'Share Tech Mono', monospace" }} axisLine={false} tickLine={false} />
                      <Tooltip contentStyle={{ fontSize: 9, fontWeight: 700, background: 'rgba(0,15,25,0.95)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: '#fff', boxShadow: '0 4px 16px rgba(0,0,0,0.4)', fontFamily: "'Share Tech Mono', monospace" }} formatter={(value: number) => [`${value}/100`, 'THREAT']} />
                      <Area type="monotone" dataKey="threat" stroke={threatColor} strokeWidth={2} fill="url(#threatGradDark)" dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* ═══ 3. SECTIONS ═══ */}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginTop: 4 }} />

            {/* 3a. מצב */}
            <SectionHeader id="situation" title="הערכת מצב" icon="🗺️" />
            {expandedSection === 'situation' && (
              <div className="px-3 pb-3 animate-in fade-in duration-300">
                <p style={{ fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.85)', lineHeight: 2.0, borderRight: `2px solid ${threatColor}40`, paddingRight: 10 }}>{getHebrewText(report.summary)}</p>
              </div>
            )}

            {/* 3b. חזיתות */}
            <SectionHeader id="fronts" title="חזיתות פעילות" icon="⚔️" />
            {expandedSection === 'fronts' && (
              <div className="px-3 pb-3 space-y-1.5 animate-in fade-in duration-300">
                {Object.entries(report.fronts || {}).map(([key, front]) => {
                  const riskColor = front.risk > 70 ? '#ff1744' : front.risk > 40 ? '#ff6d00' : front.risk > 20 ? '#ffd600' : '#00e676';
                  return (
                    <div key={key} className="flex items-center gap-2 py-2 px-3 rounded-lg" style={{
                      background: `${riskColor}08`,
                      borderRight: `3px solid ${riskColor}`,
                      border: `1px solid ${riskColor}15`,
                    }}>
                      <span className="text-lg" style={{ filter: `drop-shadow(0 0 4px ${riskColor}44)` }}>{FRONT_FLAGS[key] || '🏴'}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between">
                          <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 12, fontWeight: 800, color: '#fff' }}>{FRONT_LABELS[key] || key}</span>
                          <span style={{
                            fontFamily: "'Share Tech Mono', monospace",
                            fontSize: 8, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                            background: `${STATUS_COLORS[front.status] || '#666'}20`,
                            color: STATUS_COLORS[front.status] || '#666',
                            border: `1px solid ${STATUS_COLORS[front.status] || '#666'}40`,
                            letterSpacing: '0.1em',
                          }}>
                            {STATUS_LABELS[front.status] || front.status}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                            <div className="h-full rounded-full" style={{ width: `${front.risk}%`, background: `linear-gradient(90deg, ${riskColor}88, ${riskColor})`, boxShadow: `0 0 6px ${riskColor}33`, transition: 'width 0.5s' }} />
                          </div>
                          <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 10, fontWeight: 900, color: riskColor }}>{front.risk}%</span>
                          <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 8, fontWeight: 600, color: 'rgba(255,255,255,0.3)' }}>{front.mentions} אזכורים</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 3c. ממצאים */}
            <SectionHeader id="findings" title="ממצאים מרכזיים" icon="🔍" />
            {expandedSection === 'findings' && report.key_findings?.length > 0 && (
              <div className="px-3 pb-3 space-y-1.5 animate-in fade-in duration-300">
                {report.key_findings.map((finding, i) => {
                  const priority = i < 2 ? '#ff1744' : i < 4 ? '#ff6d00' : '#448aff';
                  return (
                    <div key={i} className="flex items-start gap-2 py-2 px-3 rounded-lg" style={{
                      background: `${priority}06`,
                      borderRight: `2px solid ${priority}60`,
                    }}>
                      <span style={{
                        fontFamily: "'Share Tech Mono', monospace",
                        fontSize: 9, color: '#fff', fontWeight: 900, marginTop: 2,
                        width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: `${priority}30`, border: `1px solid ${priority}50`,
                        borderRadius: '50%', flexShrink: 0,
                      }}>{i + 1}</span>
                      <p style={{ fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.8)', lineHeight: 1.8 }}>{getHebrewText(finding)}</p>
                    </div>
                  );
                })}
              </div>
            )}

            {/* 3d. מקורות */}
            <SectionHeader id="sources" title="מקורות מודיעין" icon="📡" />
            {expandedSection === 'sources' && (
              <div className="px-3 pb-3 animate-in fade-in duration-300">
                <div className="grid grid-cols-2 gap-1.5">
                  {Object.entries(report.source_stats || {}).map(([src, count]) => (
                    <div key={src} className="flex items-center justify-between px-3 py-1.5 rounded-md" style={{
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.06)',
                    }}>
                      <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 9, fontWeight: 600, color: 'rgba(255,255,255,0.5)' }}>{src}</span>
                      <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 12, fontWeight: 900, color: '#448aff' }}>{count as number}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 3e. מערך ימי */}
            <SectionHeader id="maritime" title="סקירה ימית" icon="🚢" />
            {expandedSection === 'maritime' && (
              <div className="px-3 pb-3 space-y-1.5 animate-in fade-in duration-300">
                {[
                  { zone: 'ים תיכון — חופי ישראל', flag: '🇮🇱', risk: 'ניטור', riskColor: '#ffab00', detail: 'ניטור כלי שיט חשודים סביב אסדות גז לווייתן, תמר וכריש. כוחות חיל הים במצב כוננות' },
                  { zone: 'ים סוף / באב אל-מנדב', flag: '🇾🇪', risk: 'מוגבר', riskColor: '#ff6d00', detail: 'איום חות\'י פעיל — סירות תקיפה מהירות וכלי טיס תקיפה בלתי מאויש (USV) מזוהים באזור' },
                  { zone: 'מצר הורמוז', flag: '🇮🇷', risk: 'ניטור', riskColor: '#ffab00', detail: 'תנועה מסחרית רגילה. ניטור כלי שיט צבאיים איראניים באזור' },
                  { zone: 'ים תיכון — נאט"ו / צי 6', flag: '🇺🇸', risk: 'פעיל', riskColor: '#42a5f5', detail: 'USS Gerald R. Ford ונושאת מטוסים בפריסה. סיירות DDG בליווי' },
                ].map((z, i) => (
                  <div key={i} className="flex items-start gap-2 py-2 px-3 rounded-lg" style={{
                    background: `${z.riskColor}06`, borderRight: `3px solid ${z.riskColor}`,
                    border: `1px solid ${z.riskColor}15`,
                  }}>
                    <span className="text-lg">{z.flag}</span>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 11, fontWeight: 800, color: '#fff' }}>{z.zone}</span>
                        <span style={{
                          fontFamily: "'Share Tech Mono', monospace", fontSize: 8, fontWeight: 700,
                          padding: '2px 8px', borderRadius: 4,
                          background: `${z.riskColor}20`, color: z.riskColor, border: `1px solid ${z.riskColor}40`,
                        }}>{z.risk}</span>
                      </div>
                      <p style={{ fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: 10, color: 'rgba(255,255,255,0.6)', lineHeight: 1.8, marginTop: 4 }}>{z.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* 3f. המלצות */}
            <SectionHeader id="recommendations" title="המלצות לפעולה" icon="📋" />
            {expandedSection === 'recommendations' && report.recommendations?.length > 0 && (
              <div className="px-3 pb-3 space-y-1.5 animate-in fade-in duration-300">
                {report.recommendations.map((rec, i) => (
                  <div key={i} className="flex items-start gap-2 py-2 px-3 rounded-md" style={{
                    background: 'rgba(255,255,255,0.02)',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                  }}>
                    <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 11, color: '#ff6d00', fontWeight: 800, flexShrink: 0 }}>▸</span>
                    <p style={{ fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.7)', lineHeight: 1.8 }}>{getHebrewText(rec)}</p>
                  </div>
                ))}
              </div>
            )}

            {/* ═══ Classification & Timestamp ═══ */}
            <div className="flex items-center justify-between mt-2 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 7, fontWeight: 700, color: '#ff6d00', letterSpacing: '0.2em', padding: '2px 8px', background: 'rgba(255,109,0,0.08)', border: '1px solid rgba(255,109,0,0.2)', borderRadius: 3 }}>
                סיווג: מוגבל — הניתוח של שולה
              </span>
              <span style={{ fontFamily: "'Share Tech Mono', monospace", fontSize: 7, color: 'rgba(255,255,255,0.2)' }}>
                {new Date(report.created_at).toLocaleString('he-IL')}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DailyIntelReport;
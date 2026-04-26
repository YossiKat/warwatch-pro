import { useState, useMemo } from 'react';
import { useTelegram } from '@/hooks/useTelegram';

const SEVERITY_COLORS: Record<string, string> = {
  critical: '#ff1744', high: '#ff6d00', warning: '#ffab00', medium: '#ffd600', low: '#00e676',
};

function severityRank(s: string): number {
  return { critical: 0, high: 1, warning: 2, medium: 3, low: 4 }[s] ?? 5;
}

const TzofarDisplay = () => {
  const { messages, stats, isPolling, triggerPoll, groups } = useTelegram();

  // ── Counters ──
  const counters = useMemo(() => {
    const total = messages.length;
    const duplicates = messages.filter(m => m.is_duplicate).length;
    const unique = total - duplicates;
    const spam = messages.filter(m => !m.is_duplicate && m.text && m.text.length < 10).length;
    const critical = messages.filter(m => m.severity === 'critical').length;
    const high = messages.filter(m => m.severity === 'high').length;
    const warning = messages.filter(m => m.severity === 'warning').length;
    const medium = messages.filter(m => m.severity === 'medium').length;
    return { total, duplicates, unique, spam, critical, high, warning, medium };
  }, [messages]);

  // ── Trend analysis ──
  const trendAnalysis = useMemo(() => {
    const now = Date.now();
    const hourAgo = now - 3600000;
    const twoHoursAgo = now - 7200000;
    const sixHoursAgo = now - 21600000;

    const lastHour = messages.filter(m => !m.is_duplicate && new Date(m.created_at).getTime() > hourAgo);
    const prevHour = messages.filter(m => !m.is_duplicate && new Date(m.created_at).getTime() > twoHoursAgo && new Date(m.created_at).getTime() <= hourAgo);
    const last6h = messages.filter(m => !m.is_duplicate && new Date(m.created_at).getTime() > sixHoursAgo);

    const lastCritHigh = lastHour.filter(m => m.severity === 'critical' || m.severity === 'high').length;
    const prevCritHigh = prevHour.filter(m => m.severity === 'critical' || m.severity === 'high').length;

    const trendDirection = lastCritHigh > prevCritHigh + 2 ? 'escalating' : lastCritHigh < prevCritHigh - 2 ? 'de-escalating' : 'stable';
    const trendIcon = trendDirection === 'escalating' ? '📈' : trendDirection === 'de-escalating' ? '📉' : '➡️';
    const trendColor = trendDirection === 'escalating' ? '#ff1744' : trendDirection === 'de-escalating' ? '#00e676' : '#ffab00';
    const trendLabel = trendDirection === 'escalating' ? 'הסלמה' : trendDirection === 'de-escalating' ? 'הרגעה' : 'יציב';

    // Build 6h histogram (6 bars, 1 per hour)
    const histogram: { hour: string; total: number; critHigh: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const from = now - (i + 1) * 3600000;
      const to = now - i * 3600000;
      const inRange = messages.filter(m => {
        const t = new Date(m.created_at).getTime();
        return !m.is_duplicate && t > from && t <= to;
      });
      const h = new Date(to);
      histogram.push({
        hour: `${h.getHours().toString().padStart(2, '0')}:00`,
        total: inRange.length,
        critHigh: inRange.filter(m => m.severity === 'critical' || m.severity === 'high').length,
      });
    }

    const bySev = { critical: 0, high: 0, warning: 0, medium: 0, low: 0 };
    lastHour.forEach(m => { if (m.severity in bySev) bySev[m.severity as keyof typeof bySev]++; });

    return { lastHour: lastHour.length, prevHour: prevHour.length, last6h: last6h.length, trendDirection, trendIcon, trendColor, trendLabel, lastCritHigh, prevCritHigh, bySev, histogram };
  }, [messages]);

  // ── Threat score ──
  const threatScore = useMemo(() => {
    const { bySev } = trendAnalysis;
    return Math.min(100, bySev.critical * 25 + bySev.high * 12 + bySev.warning * 5 + bySev.medium * 2);
  }, [trendAnalysis]);
  const threatColor = threatScore > 60 ? '#ff1744' : threatScore > 30 ? '#ff6d00' : threatScore > 10 ? '#ffab00' : '#00e676';
  const threatLabel = threatScore > 60 ? '🔴 קריטי' : threatScore > 30 ? '🟠 מוגבר' : threatScore > 10 ? '🟡 ניטור' : '🟢 שגרה';

  // ── Group health ──
  const groupHealth = useMemo(() => {
    const now = Date.now();
    return groups.map(g => {
      const groupMsgs = messages.filter(m => m.chat_id === g.chat_id);
      const last24h = groupMsgs.filter(m => now - new Date(m.created_at).getTime() < 86400000);
      const lastHour = groupMsgs.filter(m => now - new Date(m.created_at).getTime() < 3600000);
      const uniqueSenders = new Set(last24h.map(m => m.sender_name).filter(Boolean));
      const lastMsgAge = g.last_message_at ? now - new Date(g.last_message_at).getTime() : Infinity;
      const critCount = last24h.filter(m => m.severity === 'critical' || m.severity === 'high').length;
      const duplicateRate = last24h.length > 0 ? last24h.filter(m => m.is_duplicate).length / last24h.length : 0;

      let health = 0;
      if (lastMsgAge < 300000) health += 40;
      else if (lastMsgAge < 1800000) health += 30;
      else if (lastMsgAge < 3600000) health += 20;
      else if (lastMsgAge < 86400000) health += 10;
      health += Math.min(30, last24h.length * 3);
      health += Math.min(20, uniqueSenders.size * 10);
      health += Math.round((1 - duplicateRate) * 10);

      const status: 'active' | 'stale' | 'offline' =
        lastMsgAge < 3600000 ? 'active' : lastMsgAge < 86400000 ? 'stale' : 'offline';
      const statusColor = status === 'active' ? '#00e676' : status === 'stale' ? '#ffab00' : '#ff5252';

      return { ...g, health: Math.min(100, health), status, statusColor, lastMsgAge, msgCount24h: last24h.length, msgCountHour: lastHour.length, senderCount: uniqueSenders.size, critCount, duplicateRate };
    }).sort((a, b) => b.health - a.health);
  }, [groups, messages]);

  // ── Live feed ──
  const liveFeed = useMemo(() => {
    return messages.filter(m => !m.is_duplicate && m.text && m.text.length > 3).slice(0, 25);
  }, [messages]);

  function formatAge(ms: number): string {
    if (ms < 60000) return 'עכשיו';
    if (ms < 3600000) return `${Math.floor(ms / 60000)}ד'`;
    if (ms < 86400000) return `${Math.floor(ms / 3600000)}שע'`;
    return `${Math.floor(ms / 86400000)}י'`;
  }

  const maxHist = Math.max(1, ...trendAnalysis.histogram.map(h => h.total));

  return (
    <div className="px-3 py-2 space-y-2 max-h-[60vh] overflow-y-auto" dir="rtl" style={{ fontFamily: 'Share Tech Mono' }}>

      {/* ═══ 1. MESSAGE COUNTERS BAR ═══ */}
      <div className="grid grid-cols-4 gap-1">
        {[
          { label: 'הודעות', value: counters.total, icon: '📨', color: '#00e5ff' },
          { label: 'כפילויות', value: counters.duplicates, icon: '♻️', color: '#b388ff' },
          { label: 'ספאם', value: counters.spam, icon: '🚫', color: '#ff5252' },
          { label: 'אזהרות', value: counters.critical + counters.high + counters.warning, icon: '⚠️', color: '#ff6d00' },
        ].map(c => (
          <div key={c.label} className="text-center py-1.5 rounded-lg" style={{
            background: `${c.color}08`,
            border: `1px solid ${c.color}18`,
          }}>
            <div className="text-[10px]">{c.icon}</div>
            <div className="text-sm font-black leading-none mt-0.5" style={{ color: c.value > 0 ? c.color : 'rgba(255,255,255,0.12)' }}>{c.value}</div>
            <div className="text-[6px] font-bold mt-0.5" style={{ color: `${c.color}66` }}>{c.label}</div>
          </div>
        ))}
      </div>

      {/* ═══ 2. ROUTINE STATUS — Threat Gauge ═══ */}
      <div className="flex items-center gap-3 p-2.5 rounded-lg" style={{ background: `${threatColor}08`, border: `1px solid ${threatColor}20` }}>
        <div className="relative w-12 h-12 flex items-center justify-center shrink-0">
          <svg width="48" height="48" viewBox="0 0 48 48">
            <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="2.5" />
            <circle cx="24" cy="24" r="20" fill="none" stroke={threatColor} strokeWidth="3"
              strokeDasharray="126" strokeDashoffset={126 - (threatScore / 100) * 126}
              strokeLinecap="round" transform="rotate(-90 24 24)"
              style={{ transition: 'all 1s ease', filter: `drop-shadow(0 0 8px ${threatColor}80)` }} />
          </svg>
          <span className="absolute text-base font-black font-mono" style={{ color: threatColor }}>{threatScore}</span>
        </div>
        <div className="flex-1">
          <div className="text-[11px] font-bold mb-0.5" style={{ color: threatColor }}>{threatLabel}</div>
          <div className="text-[8px] text-white/40">מצב בשגרה · {trendAnalysis.lastHour} הודעות/שעה</div>
          <div className="flex gap-1 mt-1">
            {[
              { key: 'critical', label: 'קריט', color: '#ff1744' },
              { key: 'high', label: 'גבוה', color: '#ff6d00' },
              { key: 'warning', label: 'אזהר', color: '#ffab00' },
              { key: 'medium', label: 'בינו', color: '#ffd600' },
            ].map(s => {
              const count = trendAnalysis.bySev[s.key as keyof typeof trendAnalysis.bySev];
              return (
                <span key={s.key} className="text-[7px] font-bold px-1 py-[1px] rounded" style={{
                  background: count > 0 ? `${s.color}15` : 'rgba(255,255,255,0.02)',
                  color: count > 0 ? s.color : 'rgba(255,255,255,0.15)',
                  border: `1px solid ${count > 0 ? `${s.color}30` : 'transparent'}`,
                }}>{count} {s.label}</span>
              );
            })}
          </div>
        </div>
        <button onClick={() => { void triggerPoll(); }} disabled={isPolling}
          className="px-2.5 py-2 rounded-lg text-[10px] font-bold transition-all active:scale-95"
          style={{ background: isPolling ? 'rgba(0,229,255,0.15)' : 'rgba(0,229,255,0.06)', border: '1px solid rgba(0,229,255,0.2)', color: 'hsl(190,100%,65%)' }}>
          <span className={isPolling ? 'animate-spin inline-block' : ''}>⟳</span>
        </button>
      </div>

      {/* ═══ 3. TREND COMPARISON — 6h Histogram ═══ */}
      <div className="p-2.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[8px] font-bold tracking-widest" style={{ color: 'rgba(0,229,255,0.5)' }}>📊 השוואת מגמה — 6 שעות</span>
          <span className="text-[9px] font-bold px-2 py-0.5 rounded-full" style={{
            background: `${trendAnalysis.trendColor}12`, color: trendAnalysis.trendColor,
            border: `1px solid ${trendAnalysis.trendColor}25`,
          }}>{trendAnalysis.trendIcon} {trendAnalysis.trendLabel}</span>
        </div>

        {/* Histogram bars */}
        <div className="flex items-end gap-1 h-12">
          {trendAnalysis.histogram.map((h, i) => {
            const barH = Math.max(2, (h.total / maxHist) * 100);
            const critH = h.total > 0 ? (h.critHigh / h.total) * barH : 0;
            return (
              <div key={i} className="flex-1 flex flex-col items-center">
                <div className="w-full rounded-t-sm relative" style={{ height: `${barH}%`, minHeight: '2px' }}>
                  <div className="absolute bottom-0 w-full rounded-t-sm" style={{ height: `${barH}%`, background: 'rgba(0,229,255,0.2)' }} />
                  {critH > 0 && <div className="absolute bottom-0 w-full rounded-t-sm" style={{ height: `${critH}%`, background: 'rgba(255,23,68,0.5)' }} />}
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex gap-1 mt-1">
          {trendAnalysis.histogram.map((h, i) => (
            <div key={i} className="flex-1 text-center">
              <div className="text-[6px] text-white/25">{h.hour}</div>
              <div className="text-[7px] font-bold text-white/40">{h.total}</div>
            </div>
          ))}
        </div>

        {/* Hour comparison */}
        <div className="grid grid-cols-3 gap-2 mt-2 pt-2" style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}>
          <div className="text-center">
            <div className="text-[6px] text-white/25">שעה אחרונה</div>
            <div className="text-sm font-black" style={{ color: trendAnalysis.trendColor }}>{trendAnalysis.lastHour}</div>
          </div>
          <div className="text-center">
            <div className="text-[6px] text-white/25">שעה קודמת</div>
            <div className="text-sm font-black text-white/35">{trendAnalysis.prevHour}</div>
          </div>
          <div className="text-center">
            <div className="text-[6px] text-white/25">6 שעות</div>
            <div className="text-sm font-black text-white/35">{trendAnalysis.last6h}</div>
          </div>
        </div>
      </div>

      {/* ═══ 4. GROUP STATUS ═══ */}
      <div className="p-2.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[8px] font-bold tracking-widest" style={{ color: 'rgba(0,229,255,0.5)' }}>📡 סטטוס קבוצות</span>
          <div className="flex items-center gap-1.5">
            {[
              { color: '#00e676', count: groupHealth.filter(g => g.status === 'active').length },
              { color: '#ffab00', count: groupHealth.filter(g => g.status === 'stale').length },
              { color: '#ff5252', count: groupHealth.filter(g => g.status === 'offline').length },
            ].map(s => (
              <div key={s.color} className="flex items-center gap-0.5">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
                <span className="text-[7px] text-white/30">{s.count}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          {groupHealth.map(g => (
            <div key={g.id} className="flex items-center gap-2 py-1.5 px-2 rounded-md"
              style={{ background: `${g.statusColor}06`, border: `1px solid ${g.statusColor}12` }}>
              <div className="relative w-2.5 h-2.5 shrink-0">
                <div className="absolute inset-0 rounded-full" style={{
                  background: g.statusColor, boxShadow: `0 0 6px ${g.statusColor}60`,
                  animation: g.status === 'active' ? 'pulse 2s infinite' : 'none',
                }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[9px] font-bold text-white/80 truncate">{g.title}</div>
                <div className="flex items-center gap-2 text-[6.5px] text-white/30">
                  <span>{g.msgCount24h} / 24ש</span>
                  <span>·</span>
                  <span>{g.senderCount} שולחים</span>
                  {g.duplicateRate > 0.1 && (
                    <>
                      <span>·</span>
                      <span style={{ color: '#b388ff' }}>{Math.round(g.duplicateRate * 100)}% כפל</span>
                    </>
                  )}
                  {g.critCount > 0 && (
                    <>
                      <span>·</span>
                      <span style={{ color: '#ff1744' }}>{g.critCount} חמורות</span>
                    </>
                  )}
                </div>
              </div>
              <div className="w-10 shrink-0">
                <div className="h-[3px] rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
                  <div className="h-full rounded-full transition-all duration-500" style={{
                    width: `${g.health}%`,
                    background: g.health > 60 ? '#00e676' : g.health > 30 ? '#ffab00' : '#ff5252',
                  }} />
                </div>
                <div className="text-[6px] text-center mt-0.5" style={{
                  color: `${g.health > 60 ? '#00e676' : g.health > 30 ? '#ffab00' : '#ff5252'}88`,
                }}>{g.health}%</div>
              </div>
              <div className="text-[7px] font-bold shrink-0 w-8 text-left" style={{ color: g.statusColor }}>
                {formatAge(g.lastMsgAge)}
              </div>
            </div>
          ))}
          {groupHealth.length === 0 && (
            <div className="text-[8px] text-white/20 text-center py-2">אין קבוצות מחוברות</div>
          )}
        </div>
      </div>

      {/* ═══ 5. LIVE FEED ═══ */}
      <div className="p-2.5 rounded-lg" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)' }}>
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#00e5ff', animation: 'pulse 1.5s infinite', boxShadow: '0 0 6px rgba(0,229,255,0.5)' }} />
            <span className="text-[8px] font-bold tracking-widest" style={{ color: 'rgba(0,229,255,0.5)' }}>📡 פיד חי</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-[7px] text-white/25">{liveFeed.length} הודעות</span>
            <button onClick={() => { void triggerPoll(); }} disabled={isPolling}
              className="text-[8px] font-bold px-1.5 py-0.5 rounded transition-all"
              style={{ background: 'rgba(0,229,255,0.08)', border: '1px solid rgba(0,229,255,0.15)', color: 'hsl(190,100%,65%)' }}>
              {isPolling ? '⏳' : '⟳'}
            </button>
          </div>
        </div>
        <div className="space-y-1 max-h-[30vh] overflow-y-auto scrollbar-thin">
          {liveFeed.length === 0 ? (
            <p className="text-[8px] text-white/20 text-center py-3">ממתין להודעות...</p>
          ) : (
            liveFeed.map((m, i) => {
              const sevColor = SEVERITY_COLORS[m.severity] || '#666';
              const ageMins = Math.floor((Date.now() - new Date(m.created_at).getTime()) / 60000);
              const ageStr = ageMins < 1 ? 'עכשיו' : ageMins < 60 ? `${ageMins}ד'` : `${Math.floor(ageMins / 60)}ש'`;
              const group = groups.find(g => g.chat_id === m.chat_id);
              return (
                <div key={m.id || i} className="flex items-start gap-1.5 py-1.5 px-1.5 rounded-md transition-all"
                  style={{ background: `${sevColor}06`, borderRight: `2px solid ${sevColor}50` }}>
                  <div className="w-1.5 h-1.5 rounded-full mt-1 shrink-0" style={{ background: sevColor, boxShadow: `0 0 4px ${sevColor}40` }} />
                  <div className="flex-1 min-w-0">
                    <p className="text-[9px] text-white/85 leading-snug break-words">{m.text?.slice(0, 120)}{(m.text?.length || 0) > 120 ? '...' : ''}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <span className="text-[6px] font-bold px-1 py-[1px] rounded" style={{ background: `${sevColor}15`, color: sevColor }}>{m.severity}</span>
                      {group && <span className="text-[6px] text-white/25 truncate max-w-[60px]">{group.title}</span>}
                      <span className="text-[6px] text-white/20">{ageStr}</span>
                      {m.sender_name && <span className="text-[6px] text-white/15">— {m.sender_name}</span>}
                    </div>
                    {m.tags && m.tags.length > 0 && (
                      <div className="flex gap-0.5 mt-0.5 flex-wrap">
                        {m.tags.slice(0, 4).map((tag: string) => (
                          <span key={tag} className="text-[5px] px-1 py-[1px] rounded-sm" style={{ background: 'rgba(179,136,255,0.08)', color: 'rgba(179,136,255,0.6)' }}>#{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="flex items-center justify-between text-[7px] text-white/15 pt-1">
        <span>סה״כ {counters.total} · ייחודיות {counters.unique} · כפל {counters.duplicates}</span>
        <span>בוט: warroom_control</span>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
};

export default TzofarDisplay;

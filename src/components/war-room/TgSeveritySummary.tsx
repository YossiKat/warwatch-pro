import { useMemo, useState } from 'react';

interface TgMessage {
  id: string;
  text: string | null;
  severity: string;
  is_duplicate: boolean;
  created_at: string;
  chat_id: number;
  sender_name: string | null;
  tags: string[];
}

interface TgGroup {
  id: string;
  chat_id: number;
  title: string;
  message_count: number;
  last_message_at: string | null;
}

interface Props {
  messages: TgMessage[];
  groups: TgGroup[];
  compact?: boolean;
  lastPoll?: Date | null;
}

const SEVERITY_META: Record<string, { label: string; color: string; icon: string; priority: number }> = {
  critical: { label: 'קריטי', color: '#ff1744', icon: '🔴', priority: 0 },
  high: { label: 'גבוה', color: '#ff6d00', icon: '🟠', priority: 1 },
  warning: { label: 'אזהרה', color: '#ffab00', icon: '🟡', priority: 2 },
  medium: { label: 'בינוני', color: '#ffd600', icon: '🟡', priority: 3 },
  low: { label: 'נמוך', color: '#00e676', icon: '🟢', priority: 4 },
};

const TgSeveritySummary = ({ messages, groups, compact = false, lastPoll }: Props) => {
  const [expandedSeverity, setExpandedSeverity] = useState<string | null>(null);

  const uniqueMessages = useMemo(() => messages.filter(m => !m.is_duplicate && m.text), [messages]);

  const severityGroups = useMemo(() => {
    const grouped: Record<string, { msgs: TgMessage[]; byGroup: Record<string, TgMessage[]> }> = {};
    for (const sev of Object.keys(SEVERITY_META)) {
      const sevMsgs = uniqueMessages.filter(m => m.severity === sev);
      const byGroup: Record<string, TgMessage[]> = {};
      for (const msg of sevMsgs) {
        const group = groups.find(g => g.chat_id === msg.chat_id);
        const groupName = group?.title || `קבוצה ${msg.chat_id}`;
        if (!byGroup[groupName]) byGroup[groupName] = [];
        byGroup[groupName].push(msg);
      }
      grouped[sev] = { msgs: sevMsgs, byGroup };
    }
    return grouped;
  }, [uniqueMessages, groups]);

  // Rate: messages per hour in last hour
  const msgRate = useMemo(() => {
    const hourAgo = Date.now() - 3600000;
    return uniqueMessages.filter(m => new Date(m.created_at).getTime() > hourAgo).length;
  }, [uniqueMessages]);

  // Build summary per severity: top keywords/topics
  const buildSummary = (msgs: TgMessage[]): string => {
    if (msgs.length === 0) return 'אין דיווחים';
    const allText = msgs.map(m => m.text!).join(' ');
    // Extract top repeated words (>= 3 chars, non-stop)
    const stops = new Set(['את', 'של', 'על', 'עם', 'אל', 'מן', 'הוא', 'היא', 'זה', 'אני', 'לא', 'כי', 'גם', 'the', 'and', 'for', 'that', 'this', 'with', 'from']);
    const words = allText.split(/\s+/).filter(w => w.length >= 3 && !stops.has(w.toLowerCase()));
    const freq: Record<string, number> = {};
    words.forEach(w => { const k = w.toLowerCase(); freq[k] = (freq[k] || 0) + 1; });
    const topWords = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);
    
    // Pick representative messages
    const latest = msgs.slice(0, 3);
    const summaryParts = latest.map(m => m.text!.slice(0, 60).trim());
    return summaryParts.join(' • ') + (topWords.length > 0 ? ` [${topWords.join(', ')}]` : '');
  };

  const activeSeverities = Object.entries(SEVERITY_META)
    .filter(([sev]) => (severityGroups[sev]?.msgs.length || 0) > 0)
    .sort((a, b) => a[1].priority - b[1].priority);

  // Stale detection: no messages in 30 minutes
  const latestMsgTime = useMemo(() => {
    if (uniqueMessages.length === 0) return null;
    return Math.max(...uniqueMessages.map(m => new Date(m.created_at).getTime()));
  }, [uniqueMessages]);

  const lastActivity = lastPoll ? lastPoll.getTime() : (latestMsgTime || 0);
  const minutesSinceActivity = lastActivity ? Math.floor((Date.now() - lastActivity) / 60000) : Infinity;
  const isStale = minutesSinceActivity >= 30;

  const lastPullLabel = useMemo(() => {
    if (!lastPoll) return null;
    return lastPoll.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }, [lastPoll]);

  if (uniqueMessages.length === 0 && !isStale) return null;

  return (
    <div className="space-y-1" dir="rtl">
      {/* Stale warning banner */}
      {isStale && (
        <div className="flex items-center gap-2 px-2 py-1.5 rounded-md animate-pulse" style={{
          background: 'rgba(255,23,68,0.12)',
          border: '1px solid rgba(255,23,68,0.4)',
        }}>
          <span className="text-[10px]">⚠️</span>
          <span className="font-mono text-[8px] font-bold" style={{ color: '#ff1744' }}>
            לא נכנסו הודעות טלגרם מעל {minutesSinceActivity} דקות — בדוק תקלה
          </span>
        </div>
      )}

      {/* Status bar */}
      <div className="flex items-center gap-2 px-2 py-1 rounded-md" style={{
        background: isStale ? 'rgba(255,23,68,0.05)' : 'rgba(0,229,255,0.03)',
        border: `1px solid ${isStale ? 'rgba(255,23,68,0.15)' : 'rgba(0,229,255,0.08)'}`,
      }}>
        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{
          background: isStale ? '#ff1744' : '#00e5ff',
          animation: isStale ? 'blink-warning 1s infinite' : 'pulse 1.5s infinite',
          boxShadow: `0 0 4px ${isStale ? 'rgba(255,23,68,0.5)' : 'rgba(0,229,255,0.5)'}`,
        }} />
        <span style={{ fontFamily: 'Orbitron, monospace', fontSize: 7, fontWeight: 700, color: isStale ? 'rgba(255,23,68,0.7)' : 'rgba(0,229,255,0.5)', letterSpacing: '0.1em' }}>TELEGRAM STATUS</span>
        <span className="font-mono text-[7px] text-white/30">{msgRate}/שעה</span>
        {lastPullLabel && (
          <span className="font-mono text-[6px] text-white/20" title="משיכה אחרונה">🔄 {lastPullLabel}</span>
        )}
        <span className="mr-auto" />
        {/* Severity badges inline */}
        <div className="flex gap-0.5">
          {activeSeverities.map(([sev, meta]) => (
            <span key={sev} className="font-mono text-[7px] font-bold px-1 py-[1px] rounded" style={{
              background: `${meta.color}15`, color: meta.color, border: `1px solid ${meta.color}30`,
            }}>{severityGroups[sev].msgs.length}</span>
          ))}
        </div>
      </div>

      {/* Severity cards — clickable for summary */}
      {activeSeverities.map(([sev, meta]) => {
        const data = severityGroups[sev];
        const isExpanded = expandedSeverity === sev;
        return (
          <div key={sev} className="rounded-sm overflow-hidden cursor-pointer transition-all hover:brightness-110"
            style={{ background: `${meta.color}08`, border: `1px solid ${meta.color}20` }}
            onClick={() => setExpandedSeverity(isExpanded ? null : sev)}>
            <div className="flex items-center gap-1.5 px-2 py-1">
              <span className="text-[9px]">{meta.icon}</span>
              <span className="font-mono text-[8px] font-bold text-white/85 flex-1">{meta.label}</span>
              <span className="font-mono text-[8px] font-bold" style={{ color: meta.color }}>{data.msgs.length}</span>
              <span className="text-[7px] text-white/25">{isExpanded ? '▲' : '▼'}</span>
            </div>
            {isExpanded && (
              <div className="px-2 pb-2 border-t border-white/5 space-y-1.5">
                {/* Summary */}
                <p className="font-mono text-[8px] text-white/60 mt-1 leading-relaxed">{buildSummary(data.msgs)}</p>
                
                {/* By group */}
                {Object.entries(data.byGroup).map(([groupName, groupMsgs]) => (
                  <div key={groupName} className="rounded-sm px-1.5 py-1" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}>
                    <div className="flex items-center gap-1 mb-0.5">
                      <span className="font-mono text-[7px] font-bold text-white/50">📡 {groupName}</span>
                      <span className="font-mono text-[6px] text-white/25 mr-auto">{groupMsgs.length} הודעות</span>
                    </div>
                    {groupMsgs.slice(0, compact ? 2 : 3).map((m, i) => (
                      <div key={i} className="font-mono text-[7px] text-white/50 truncate leading-relaxed">• {m.text?.slice(0, 70)}</div>
                    ))}
                    {groupMsgs.length > (compact ? 2 : 3) && (
                      <div className="font-mono text-[6px] text-white/20">+{groupMsgs.length - (compact ? 2 : 3)} נוספות</div>
                    )}
                  </div>
                ))}
                
                <div className="font-mono text-[6px] text-white/15 pt-1 border-t border-white/5">
                  {Object.keys(data.byGroup).length} קבוצות · {data.msgs.length} הודעות · עדכון {new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default TgSeveritySummary;

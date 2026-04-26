import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface AnalysisJob {
  name: string;
  nameHe: string;
  icon: string;
  edgeFunction: string;
  interval: string;
  lastRun: Date | null;
  status: 'ok' | 'running' | 'error' | 'unknown';
  result?: string;
}

const ANALYSIS_JOBS: (Omit<AnalysisJob, 'lastRun' | 'status' | 'result'> & { maxAgeMin: number })[] = [
  { name: 'intel-gather', nameHe: 'איסוף מודיעין', icon: '🔍', edgeFunction: 'intel-gather', interval: '5 דק', maxAgeMin: 120 },
  { name: 'sentiment-analysis', nameHe: 'ניתוח סנטימנט', icon: '📊', edgeFunction: 'sentiment-analysis', interval: '5 דק', maxAgeMin: 120 },
  { name: 'situation-analysis', nameHe: 'הערכת מצב', icon: '🎯', edgeFunction: 'situation-analysis', interval: '5 דק', maxAgeMin: 120 },
  { name: 'daily-intel-report', nameHe: 'דו"ח מודיעין', icon: '📋', edgeFunction: 'daily-intel-report', interval: '24 שע', maxAgeMin: 1500 },
  { name: 'centcom-nato-feed', nameHe: 'CENTCOM/NATO', icon: '🏛️', edgeFunction: 'centcom-nato-feed', interval: '5 דק', maxAgeMin: 120 },
  { name: 'news-flash', nameHe: 'מבזקי חדשות', icon: '📰', edgeFunction: 'news-flash', interval: '2 דק', maxAgeMin: 60 },
  { name: 'x-feed-scrape', nameHe: 'סריקת X', icon: '🐦', edgeFunction: 'x-feed-scrape', interval: '5 דק', maxAgeMin: 120 },
  { name: 'telegram-poll', nameHe: 'טלגרם', icon: '📡', edgeFunction: 'telegram-poll', interval: '1 דק', maxAgeMin: 360 },
  { name: 'oref-alerts', nameHe: 'פיקוד העורף', icon: '🚨', edgeFunction: 'oref-alerts', interval: '1 דק', maxAgeMin: 120 },
  { name: 'nasa-firms', nameHe: 'נק\' חום NASA', icon: '🔥', edgeFunction: 'nasa-firms', interval: '1 דק', maxAgeMin: 120 },
  { name: 'emergency-feed', nameHe: 'אירועי חירום', icon: '🚑', edgeFunction: 'emergency-feed', interval: '2 דק', maxAgeMin: 120 },
];

function timeAgo(date: Date): string {
  const diff = Math.max(0, Date.now() - date.getTime());
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'עכשיו';
  if (mins < 60) return `${mins}ד'`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}שע`;
  return `${Math.floor(hrs / 24)}י`;
}

export default function AnalysisStatusPanel() {
  const [jobs, setJobs] = useState<AnalysisJob[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [triggeringJob, setTriggeringJob] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    const results: AnalysisJob[] = [];

    const checks = await Promise.all([
      supabase.from('intel_reports').select('created_at').order('created_at', { ascending: false }).limit(1),
      supabase.from('sentiment_scores').select('created_at').order('created_at', { ascending: false }).limit(1),
      supabase.from('daily_intel_reports').select('created_at').order('created_at', { ascending: false }).limit(1),
      supabase.from('oref_alerts').select('created_at').order('created_at', { ascending: false }).limit(1),
      supabase.from('emergency_events').select('created_at').order('created_at', { ascending: false }).limit(1),
      supabase.from('telegram_messages').select('created_at').order('created_at', { ascending: false }).limit(1),
    ]);

    const tableMap: Record<string, Date | null> = {
      'intel-gather': checks[0].data?.[0]?.created_at ? new Date(checks[0].data[0].created_at) : null,
      'sentiment-analysis': checks[1].data?.[0]?.created_at ? new Date(checks[1].data[0].created_at) : null,
      'situation-analysis': checks[1].data?.[0]?.created_at ? new Date(checks[1].data[0].created_at) : null,
      'daily-intel-report': checks[2].data?.[0]?.created_at ? new Date(checks[2].data[0].created_at) : null,
      'oref-alerts': checks[3].data?.[0]?.created_at ? new Date(checks[3].data[0].created_at) : null,
      'emergency-feed': checks[4].data?.[0]?.created_at ? new Date(checks[4].data[0].created_at) : null,
      'telegram-poll': checks[5].data?.[0]?.created_at ? new Date(checks[5].data[0].created_at) : null,
      'centcom-nato-feed': checks[0].data?.[0]?.created_at ? new Date(checks[0].data[0].created_at) : null,
      'news-flash': checks[0].data?.[0]?.created_at ? new Date(checks[0].data[0].created_at) : null,
      'x-feed-scrape': checks[0].data?.[0]?.created_at ? new Date(checks[0].data[0].created_at) : null,
      'nasa-firms': checks[0].data?.[0]?.created_at ? new Date(checks[0].data[0].created_at) : null,
    };

    for (const job of ANALYSIS_JOBS) {
      const lastRun = tableMap[job.name] || null;
      const ageMinutes = lastRun ? (Date.now() - lastRun.getTime()) / 60000 : Infinity;
      let status: 'ok' | 'error' | 'unknown' = 'unknown';
      if (lastRun) {
        status = ageMinutes < job.maxAgeMin ? 'ok' : 'error';
      }
      results.push({ ...job, lastRun, status });
    }
    setJobs(results);
  }, []);

  useEffect(() => {
    checkStatus();
    const interval = setInterval(checkStatus, 30000);
    return () => clearInterval(interval);
  }, [checkStatus]);

  const triggerJob = async (edgeFunction: string) => {
    setTriggeringJob(edgeFunction);
    try {
      await supabase.functions.invoke(edgeFunction);
      setTimeout(checkStatus, 3000);
    } catch {
      // ignore
    } finally {
      setTimeout(() => setTriggeringJob(null), 2000);
    }
  };

  const okCount = jobs.filter(j => j.status === 'ok').length;
  const totalCount = jobs.length;
  const statusColor = okCount === totalCount ? '#00e676' : okCount > totalCount / 2 ? '#ff9800' : '#ff5252';

  return (
    <div className="relative shrink-0">
      {/* Inline toolbar button */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`min-w-[36px] h-9 sm:min-w-[40px] sm:h-10 px-2.5 rounded-xl border font-mono text-[9px] sm:text-[10px] font-bold transition-all active:scale-95 flex items-center gap-1 ${expanded ? 'bg-white/[0.08] border-white/[0.15]' : 'bg-white/[0.04] border-white/[0.06] hover:bg-white/[0.08]'}`}
        title={`${okCount}/${totalCount} ניתוחים פעילים`}
      >
        <div className="w-2 h-2 rounded-full shrink-0" style={{ background: statusColor, boxShadow: `0 0 6px ${statusColor}50` }} />
        <span style={{ color: statusColor, fontSize: 9 }}>{okCount}/{totalCount}</span>
        <span className="hidden md:inline text-white/50">סטטוס</span>
      </button>

      {/* Clickaway */}
      {expanded && <div className="fixed inset-0 z-[1099]" onClick={() => setExpanded(false)} />}

      {/* Dropdown panel */}
      {expanded && (
        <div className="fixed sm:absolute top-auto sm:top-full bottom-0 sm:bottom-auto left-0 right-0 sm:left-auto sm:right-0 sm:mt-2 z-[1100] sm:w-[280px] sm:rounded-xl rounded-t-2xl border border-white/[0.1] p-0 flex flex-col sm:max-h-[70vh] max-h-[60vh] overflow-hidden"
          style={{ background: 'rgba(0,12,22,0.97)', backdropFilter: 'blur(20px)', boxShadow: '0 -4px 32px rgba(0,0,0,0.6)' }}>
          {/* Mobile handle */}
          <div className="sm:hidden flex justify-center py-2"><div className="w-10 h-1 rounded-full bg-white/20" /></div>
          
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
            <span className="font-mono text-[10px] text-white/60 font-bold tracking-wider">סטטוס ניתוחים</span>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full" style={{ background: statusColor, boxShadow: `0 0 4px ${statusColor}` }} />
              <span className="font-mono text-[9px]" style={{ color: statusColor }}>{okCount}/{totalCount}</span>
            </div>
          </div>

          {/* Jobs list */}
          <div className="overflow-y-auto flex-1">
            {jobs.map(job => {
              const isTriggering = triggeringJob === job.edgeFunction;
              const dotColor = isTriggering ? '#ffeb3b' : job.status === 'ok' ? '#00e676' : job.status === 'error' ? '#ff5252' : '#78909c';
              return (
                <div
                  key={job.name}
                  className="flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors hover:bg-white/[0.04] border-b border-white/[0.02]"
                  onClick={() => triggerJob(job.edgeFunction)}
                >
                  <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{
                    background: dotColor,
                    boxShadow: isTriggering ? '0 0 8px #ffeb3b' : job.status === 'ok' ? `0 0 4px ${dotColor}40` : 'none',
                    animation: isTriggering ? 'pulse 0.5s infinite' : 'none',
                  }} />
                  <span className="text-[11px] w-4 text-center shrink-0">{job.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-[9px] text-white/75 font-semibold truncate">{job.nameHe}</div>
                    <div className="font-mono text-[7px] text-white/25">כל {job.interval}</div>
                  </div>
                  <div className="font-mono text-[8px] font-semibold shrink-0" style={{ color: dotColor }}>
                    {isTriggering ? '⟳ רץ...' : job.lastRun ? timeAgo(job.lastRun) : '—'}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="px-3 py-1.5 text-center font-mono text-[7px] text-white/20 border-t border-white/[0.04]">
            לחץ על שורה להפעלה ידנית
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

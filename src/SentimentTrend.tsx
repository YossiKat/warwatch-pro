import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ReferenceLine, ResponsiveContainer } from 'recharts';

interface SentimentPoint {
  score: number;
  label: string;
  data_points: number;
  sources: string[];
  created_at: string;
  raw_data: {
    escalation_drivers?: string[];
    deescalation_signals?: string[];
    trend_direction?: string;
  };
}

interface ChartPoint {
  time: string;
  score: number;
  label: string;
  fullTime: string;
}

const SCORE_COLORS: Record<string, string> = {
  extreme_escalation: '#ff1744',
  escalation: '#ff6d00',
  tension: '#ffab00',
  neutral: '#78909c',
  deescalation: '#00e676',
};

function getColor(score: number): string {
  if (score >= 60) return SCORE_COLORS.extreme_escalation;
  if (score >= 25) return SCORE_COLORS.escalation;
  if (score >= -10) return SCORE_COLORS.tension;
  if (score >= -40) return SCORE_COLORS.neutral;
  return SCORE_COLORS.deescalation;
}

function getGradientId(score: number): string {
  if (score >= 25) return 'escalation';
  if (score >= -10) return 'tension';
  return 'calm';
}

const CustomTooltip = ({ active, payload }: any) => {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload as ChartPoint;
  return (
    <div className="rounded-sm px-3 py-2" style={{
      background: 'rgba(0,15,25,0.95)',
      border: '1px solid hsla(185,80%,40%,0.3)',
      backdropFilter: 'blur(8px)',
    }}>
      <div style={{ fontFamily: 'Share Tech Mono', fontSize: 9, color: 'hsla(185,60%,50%,0.5)' }}>{d.fullTime}</div>
      <div style={{ fontFamily: 'Orbitron', fontSize: 12, fontWeight: 700, color: getColor(d.score), textShadow: `0 0 6px ${getColor(d.score)}40` }}>
        {d.score > 0 ? '+' : ''}{d.score} — {d.label}
      </div>
    </div>
  );
};

export default function SentimentTrend() {
  const [history, setHistory] = useState<SentimentPoint[]>([]);
  const [current, setCurrent] = useState<SentimentPoint | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);

  const fetchSentiment = useCallback(async () => {
    setIsLoading(true);
    try {
      await supabase.functions.invoke('sentiment-analysis').catch(() => {});
      const { data } = await supabase
        .from('sentiment_scores')
        .select('score,label,data_points,sources,created_at,raw_data')
        .order('created_at', { ascending: false })
        .limit(48);

      if (data && data.length > 0) {
        const reversed = [...data].reverse() as SentimentPoint[];
        setHistory(reversed);
        setCurrent(reversed[reversed.length - 1]);
      }
      setLastFetch(new Date());
    } catch (e) {
      console.error('Sentiment fetch error:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { fetchSentiment(); }, [fetchSentiment]);

  useEffect(() => {
    const channel = supabase
      .channel('sentiment-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sentiment_scores' }, (payload) => {
        const newPoint = payload.new as SentimentPoint;
        setHistory(prev => [...prev, newPoint].slice(-48));
        setCurrent(newPoint);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  useEffect(() => {
    const timer = setInterval(fetchSentiment, 900000);
    return () => clearInterval(timer);
  }, [fetchSentiment]);

  const chartData: ChartPoint[] = history.map(p => ({
    time: new Date(p.created_at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
    score: p.score,
    label: p.label,
    fullTime: new Date(p.created_at).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
  }));

  const currentScore = current?.score ?? 0;
  const currentLabel = current?.label ?? 'AWAITING...';
  const currentColor = getColor(currentScore);
  const drivers = (current?.raw_data?.escalation_drivers || []).slice(0, 3);
  const signals = (current?.raw_data?.deescalation_signals || []).slice(0, 2);
  const trend = current?.raw_data?.trend_direction;

  const trendIcon = trend === 'escalating' ? '📈' : trend === 'de-escalating' ? '📉' : '➡️';
  const trendLabel = trend === 'escalating' ? 'ESCALATING' : trend === 'de-escalating' ? 'DE-ESCALATING' : 'STABLE';

  return (
    <div className="rounded-sm overflow-hidden" style={{ background: 'rgba(200,210,220,0.12)', border: '1px solid rgba(180,195,210,0.2)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2" style={{ background: 'rgba(180,195,210,0.15)', borderBottom: '1px solid rgba(180,195,210,0.15)' }}>
        <div className="flex items-center gap-2">
          <span style={{ fontFamily: 'Orbitron', fontSize: 10, fontWeight: 700, letterSpacing: '2px', color: 'rgba(220,230,240,0.9)' }}>📊 SENTIMENT</span>
          {isLoading && <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#ffd600' }} />}
        </div>
        <div className="flex items-center gap-2">
          <span style={{ fontFamily: 'Share Tech Mono', fontSize: 9, color: 'rgba(200,215,230,0.6)' }}>
            {lastFetch ? lastFetch.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '--:--'}
          </span>
          <button
            onClick={fetchSentiment}
            disabled={isLoading}
            style={{ fontFamily: 'Orbitron', fontSize: 7, padding: '2px 8px', border: '1px solid rgba(180,195,210,0.3)', background: 'rgba(180,195,210,0.1)', color: 'rgba(200,215,230,0.7)', cursor: 'pointer', borderRadius: 2, letterSpacing: '1px' }}
          >
            REFRESH
          </button>
        </div>
      </div>

      {/* Score display */}
      <div className="flex items-center gap-3 px-3 py-2">
        <div className="text-center min-w-[60px]">
          <div style={{ fontFamily: 'Orbitron', fontSize: 24, fontWeight: 900, color: currentColor, textShadow: `0 0 12px ${currentColor}44` }}>
            {currentScore > 0 ? '+' : ''}{currentScore}
          </div>
          <div style={{ fontFamily: 'Share Tech Mono', fontSize: 7, color: 'rgba(200,215,230,0.6)', marginTop: 2 }}>{trendIcon} {trendLabel}</div>
        </div>
        <div className="flex-1 min-w-0">
          <div style={{ fontFamily: 'Orbitron', fontSize: 10, fontWeight: 700, color: currentColor }}>{currentLabel}</div>
          {drivers.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {drivers.map((d, i) => (
                <div key={i} style={{ fontFamily: 'Share Tech Mono', fontSize: 8, color: 'rgba(255,60,80,0.85)' }} dir="rtl">🔺 {d}</div>
              ))}
            </div>
          )}
          {signals.length > 0 && (
            <div className="mt-0.5 space-y-0.5">
              {signals.map((s, i) => (
                <div key={i} style={{ fontFamily: 'Share Tech Mono', fontSize: 8, color: 'rgba(0,180,90,0.85)' }} dir="rtl">🔽 {s}</div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="px-1 pb-2" style={{ height: 120 }}>
        {chartData.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 5, right: 8, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="sentGradEsc" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ff1744" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="#ff1744" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="sentGradTen" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#ffab00" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#ffab00" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="sentGradCalm" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#00e676" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#00e676" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="time" tick={{ fontSize: 8, fill: 'rgba(180,195,210,0.7)', fontFamily: 'Share Tech Mono' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis domain={[-100, 100]} tick={{ fontSize: 8, fill: 'rgba(180,195,210,0.7)', fontFamily: 'Share Tech Mono' }} axisLine={false} tickLine={false} ticks={[-50, 0, 50]} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={0} stroke="hsla(185,100%,50%,0.1)" strokeDasharray="3 3" />
              <ReferenceLine y={50} stroke="rgba(255,23,68,0.15)" strokeDasharray="2 2" />
              <ReferenceLine y={-50} stroke="rgba(0,230,118,0.15)" strokeDasharray="2 2" />
              <Area
                type="monotone"
                dataKey="score"
                stroke={currentColor}
                strokeWidth={2}
                fill={`url(#sentGrad${getGradientId(currentScore).charAt(0).toUpperCase() + getGradientId(currentScore).slice(1)})`}
                dot={false}
                activeDot={{ r: 3, fill: currentColor, stroke: 'rgba(0,0,0,0.5)', strokeWidth: 1 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center">
            <span style={{ fontFamily: 'Share Tech Mono', fontSize: 9, color: 'rgba(200,215,230,0.4)' }}>AWAITING DATA FOR TREND CHART...</span>
          </div>
        )}
      </div>

      {/* Scale legend */}
      <div className="flex items-center justify-between px-3 py-1.5" style={{ borderTop: '1px solid rgba(180,195,210,0.15)' }}>
        <span style={{ fontFamily: 'Share Tech Mono', fontSize: 7, color: '#00e676' }}>◄ CALM -100</span>
        <div className="flex gap-1">
          {[
            { label: 'CALM', color: '#00e676' },
            { label: 'NORMAL', color: '#78909c' },
            { label: 'TENSION', color: '#ffab00' },
            { label: 'ESCALATION', color: '#ff6d00' },
            { label: 'WAR', color: '#ff1744' },
          ].map(s => (
            <span key={s.label} className="px-1 py-0.5 rounded-sm" style={{
              fontFamily: 'Orbitron', fontSize: 5, letterSpacing: '1px',
              background: `${s.color}15`, color: `${s.color}99`,
            }}>
              {s.label}
            </span>
          ))}
        </div>
        <span style={{ fontFamily: 'Share Tech Mono', fontSize: 7, color: '#ff1744' }}>+100 WAR ►</span>
      </div>
    </div>
  );
}

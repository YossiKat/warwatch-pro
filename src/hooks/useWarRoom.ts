import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTzevaadomWS, type TzevaadomAlert } from './useTzevaadomWS';

export interface Alert {
  id: string;
  title: string;
  body: string;
  source: 'oref' | 'il' | 'world' | 'aljazeera' | 'x' | 'telegram';
  severity: 'critical' | 'high' | 'warning' | 'medium' | 'low';
  earlyWarning: boolean;
  confidence: number;
  tags: string[];
  timestamp: number;
  botName?: string;
}

export interface OrefAlert {
  id: string;
  title: string;
  alert_date: string;
  category: number;
  description: string | null;
  locations: string[];
  created_at: string;
}

export interface Signals {
  launches: number;
  troops: number;
  intel: number;
  rhetoric: number;
  diplo: number;
}

export interface ScanHistoryItem {
  time: string;
  level: number;
  total: number;
  earlyWarnings: number;
}

export interface WarRoomState {
  alerts: Alert[];
  orefAlerts: OrefAlert[];
  readinessLevel: number;
  readinessScore: string;
  readinessReason: string;
  signals: Signals;
  isLoading: boolean;
  scanCount: number;
  scanHistory: ScanHistoryItem[];
  activeFilter: string;
  liveStatus: { live: boolean; sources: string[]; lastFetch: Date | null };
}

const DEMO_ALERTS: Alert[] = [
  {
    id: '1', title: '⚡ זיהוי תנועת כוחות חריגה בגבול צפון',
    body: 'מערכות מעקב זיהו תנועה חריגה של כלי רכב צבאיים באזור דרום לבנון. הפעילות חורגת מהשגרה ומצריכה ניטור מוגבר.',
    source: 'il', severity: 'warning', earlyWarning: true, confidence: 78, tags: ['חיזבאללה', 'גבול צפון', 'כוחות'], timestamp: Date.now() - 120000
  },
  {
    id: '2', title: 'אזעקות צבע אדום ברשימות שדרות ועוטף עזה',
    body: 'פיקוד העורף הפעיל אזעקות באזור עוטף עזה. תושבים התבקשו להיכנס למרחבים מוגנים. דווח על יירוטים מוצלחים.',
    source: 'oref', severity: 'critical', earlyWarning: false, confidence: 95, tags: ['אזעקות', 'עוטף עזה', 'רקטות'], timestamp: Date.now() - 60000
  },
  {
    id: '3', title: 'הצהרה איראנית: "ההתנגדות מוכנה לתגובה"',
    body: 'דובר משמרות המהפכה פרסם הצהרה בה נאמר כי כוחות ההתנגדות מוכנים לתגובה מקיפה.',
    source: 'aljazeera', severity: 'high', earlyWarning: true, confidence: 65, tags: ['איראן', 'משמרות המהפכה', 'רטוריקה'], timestamp: Date.now() - 240000
  },
  {
    id: '4', title: 'צה"ל מעלה כוננות בפיקוד צפון',
    body: 'דובר צה"ל הודיע על העלאת מוכנות בפיקוד צפון בעקבות הערכת מצב.',
    source: 'il', severity: 'high', earlyWarning: false, confidence: 90, tags: ['צה"ל', 'פיקוד צפון', 'מילואים'], timestamp: Date.now() - 180000
  },
];

const DEMO_SIGNALS: Signals = {
  launches: 35,
  troops: 58,
  intel: 42,
  rhetoric: 67,
  diplo: 25,
};

// Convert Oref DB alert to display Alert
function orefToAlert(oref: OrefAlert): Alert {
  const ageMs = Date.now() - new Date(oref.alert_date).getTime();
  const severity: Alert['severity'] =
    ageMs < 900000 ? 'critical' :
    ageMs < 3600000 ? 'high' :
    ageMs < 10800000 ? 'warning' : 'medium';

  const categoryMap: Record<number, string> = {
    1: 'ירי רקטות וטילים',
    2: 'חדירת כלי טיס עוין',
    3: 'רעידת אדמה',
    6: 'חדירת מחבלים',
  };

  return {
    id: oref.id,
    title: `🚨 ${oref.title}`,
    body: `${categoryMap[oref.category] || 'התרעה'} — ${oref.locations.join(', ')}`,
    source: 'oref',
    severity,
    earlyWarning: ageMs < 300000,
    confidence: 95,
    tags: oref.locations.slice(0, 3),
    timestamp: new Date(oref.alert_date).getTime(),
  };
}

export function useWarRoom(dataMode: 'demo' | 'live' = 'live') {
  const isLive = dataMode === 'live';
  const ws = useTzevaadomWS(isLive);

  const [state, setState] = useState<WarRoomState>({
    alerts: [],
    orefAlerts: [],
    readinessLevel: 1,
    readinessScore: '-',
    readinessReason: 'המערכת מנתחת אותות מרובים כדי להעריך את רמת הסיכון הנוכחית.',
    signals: { launches: 0, troops: 0, intel: 0, rhetoric: 0, diplo: 0 },
    isLoading: false,
    scanCount: 0,
    scanHistory: [],
    activeFilter: 'all',
    liveStatus: { live: false, sources: [], lastFetch: null },
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Convert WebSocket alert to display Alert
  const wsAlertToAlert = useCallback((wsAlert: TzevaadomAlert): Alert => {
    const ageMs = Date.now() - wsAlert.time * 1000;
    const severity: Alert['severity'] =
      ageMs < 900000 ? 'critical' :
      ageMs < 3600000 ? 'high' : 'warning';

    const threatLabels: Record<string, string> = {
      rockets_missiles: 'ירי רקטות וטילים',
      terror_infiltration: 'חדירת מחבלים',
      hostile_aircraft: 'חדירת כלי טיס עוין',
      earthquake: 'רעידת אדמה',
      hazmat: 'חומרים מסוכנים',
    };

    return {
      id: `ws-${wsAlert.notificationId || wsAlert.time}`,
      title: `🚨 ${wsAlert.cities.slice(0, 5).join(', ')}`,
      body: `${threatLabels[wsAlert.threatKey] || 'התרעה'} — ${wsAlert.cities.join(', ')}`,
      source: 'oref',
      severity,
      earlyWarning: ageMs < 300000,
      confidence: 98,
      tags: wsAlert.cities.slice(0, 3),
      timestamp: wsAlert.time * 1000,
    };
  }, []);

  // Inject WebSocket alerts into state in real-time
  useEffect(() => {
    if (!isLive) return;
    ws.setOnAlert((wsAlert) => {
      const displayAlert = wsAlertToAlert(wsAlert);
      setState(prev => {
        // Dedupe by id
        const exists = prev.alerts.some(a => a.id === displayAlert.id);
        if (exists) return prev;

        const newAlerts = [displayAlert, ...prev.alerts].slice(0, 500);
        const recentCritical = newAlerts.filter(a => a.severity === 'critical').length;
        const recentHigh = newAlerts.filter(a => a.severity === 'high').length;
        const level = recentCritical > 0 ? 4 : recentHigh > 2 ? 3 : newAlerts.length > 0 ? 2 : 1;

        return {
          ...prev,
          alerts: newAlerts,
          readinessLevel: level,
          readinessScore: level >= 3 ? '72' : level >= 2 ? '47' : '25',
          readinessReason: level >= 3
            ? `🔴 ${recentCritical} התרעות קריטיות בזמן אמת via WebSocket.`
            : level >= 2
            ? `🟠 ${newAlerts.length} התרעות פעילות. ניטור בזמן אמת.`
            : '✅ אין התרעות פעילות.',
          liveStatus: { ...prev.liveStatus, live: true, sources: [...new Set([...prev.liveStatus.sources, 'websocket'])] },
        };
      });
    });
  }, [isLive, ws, wsAlertToAlert]);

  // Fetch live alerts from edge function
  const fetchLiveAlerts = useCallback(async () => {
    try {
      const { data, error } = await supabase.functions.invoke('oref-alerts');
      if (error) {
        console.error('Edge function error:', error);
        return null;
      }
      return data;
    } catch (e) {
      console.error('Failed to fetch live alerts:', e);
      return null;
    }
  }, []);

  // Also fetch directly from DB for cached alerts
  const fetchCachedAlerts = useCallback(async () => {
    const { data } = await supabase
      .from('oref_alerts')
      .select('*')
      .order('alert_date', { ascending: false })
      .limit(200);
    return data || [];
  }, []);

  const runScan = useCallback(async () => {
    setState(prev => ({ ...prev, isLoading: true, scanCount: prev.scanCount + 1 }));

    if (dataMode === 'demo') {
      // DEMO: only show hardcoded demo alerts, no real data
      const level = 2;
      const now = new Date();
      const historyItem: ScanHistoryItem = {
        time: now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
        level,
        total: DEMO_ALERTS.length,
        earlyWarnings: DEMO_ALERTS.filter(a => a.earlyWarning).length,
      };
      setState(prev => ({
        ...prev,
        alerts: DEMO_ALERTS,
        orefAlerts: [],
        readinessLevel: level,
        readinessScore: '47',
        readinessReason: 'מצב הדגמה — נתונים לדוגמה בלבד. עבור למצב LIVE לנתונים אמיתיים.',
        signals: DEMO_SIGNALS,
        isLoading: false,
        scanHistory: [historyItem, ...prev.scanHistory].slice(0, 8),
        liveStatus: { live: false, sources: [], lastFetch: new Date() },
      }));
      return;
    }

    // LIVE: fetch only real data from backend (with timeout)
    const timeoutPromise = <T,>(p: Promise<T>, ms: number, fallback: T): Promise<T> =>
      Promise.race([p, new Promise<T>(resolve => setTimeout(() => resolve(fallback), ms))]);

    const fetchIntelReports = async () => {
      const { data } = await supabase
        .from('intel_reports')
        .select('*')
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .not('source', 'eq', 'nasa_firms')
        .not('source', 'eq', 'usgs_earthquakes')
        .order('created_at', { ascending: false })
        .limit(200);
      return data || [];
    };

    const fetchTelegramMessages = async () => {
      const { data } = await supabase
        .from('telegram_messages')
        .select('id,created_at,is_duplicate,content_hash,message_date,text,sender_name,message_id,chat_id,update_id,duplicate_of,severity,tags,bot_name')
        .eq('is_duplicate', false)
        .not('text', 'is', null)
        .neq('text', '')
        .gte('created_at', new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(50);
      return data || [];
    };

    const fetchEmergencyEvents = async () => {
      const { data } = await supabase
        .from('emergency_events')
        .select('*')
        .gte('created_at', new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(50);
      return data || [];
    };

    const [liveResult, cachedAlerts, intelReports, telegramMsgs, emergencyEvents] = await Promise.all([
      timeoutPromise(fetchLiveAlerts(), 8000, null),
      timeoutPromise(fetchCachedAlerts(), 8000, []),
      timeoutPromise(fetchIntelReports(), 5000, []),
      timeoutPromise(fetchTelegramMessages(), 5000, []),
      timeoutPromise(fetchEmergencyEvents(), 5000, []),
    ]);

    const orefAlerts: OrefAlert[] = liveResult?.alerts || cachedAlerts || [];
    const liveOrefDisplayAlerts = orefAlerts
      .filter(a => {
        const ageMs = Date.now() - new Date(a.alert_date).getTime();
        return ageMs < 24 * 60 * 60 * 1000;
      })
      .map(orefToAlert);

    // Convert intel reports to display alerts (X, telegram, AND news sources)
    const intelAlerts: Alert[] = intelReports
      .map(r => {
        const isX = r.source.startsWith('x_');
        const isTelegram = r.source.startsWith('telegram_public_');
        const isNews = r.source.startsWith('news_');
        if (!isX && !isTelegram && !isNews) return null;
        
        const ageMs = Date.now() - new Date(r.created_at).getTime();
        const sev: Alert['severity'] = r.severity === 'critical' ? 'critical' : r.severity === 'high' ? 'high' : r.severity === 'medium' ? 'warning' : 'low';
        
        // Extract news source info for display
        const newsSourceId = isNews ? r.source.replace('news_', '') : null;
        const newsLabel = newsSourceId ? (r.raw_data as any)?.source_name || newsSourceId.toUpperCase() : null;
        
        return {
          id: `intel-${r.id}`,
          title: isNews ? r.title : r.title,
          body: r.summary,
          source: (isNews ? 'world' : isX ? 'x' : 'telegram') as Alert['source'],
          severity: sev,
          earlyWarning: ageMs < 300000 && (sev === 'critical' || sev === 'high'),
          confidence: sev === 'critical' ? 85 : sev === 'high' ? 70 : 55,
          tags: r.tags?.slice(0, 3) || [],
          timestamp: new Date(r.created_at).getTime(),
          botName: newsSourceId || undefined,
        } as Alert;
      })
      .filter((a): a is Alert => a !== null);

    // Alert-related keyword pattern — these messages expire after 10 minutes
    const ALERT_KEYWORD_RE = /אזעקה|צבע אדום|רקטה|טיל|יירוט|שיגור|נפילה|פיצוץ|חילופי אש|انفجار|إطلاق|صواريخ|غارة|Explosion|Missile|Launch|Air strike|Siren|Red alert/i;
    const TEN_MINUTES_MS = 10 * 60 * 1000;

    // Convert telegram messages to display alerts (filter out expired alert messages)
    const telegramAlerts: Alert[] = telegramMsgs
      .filter(m => {
        const ageMs = Date.now() - new Date(m.created_at).getTime();
        const isAlertMsg = ALERT_KEYWORD_RE.test(m.text || '');
        // Drop alert-keyword messages older than 10 minutes
        if (isAlertMsg && ageMs > TEN_MINUTES_MS) return false;
        return true;
      })
      .map(m => {
        const sev: Alert['severity'] = m.severity === 'critical' ? 'critical' : m.severity === 'high' ? 'high' : m.severity === 'warning' ? 'warning' : m.severity === 'medium' ? 'medium' : 'low';
        const ageMs = Date.now() - new Date(m.created_at).getTime();
        return {
          id: `tg-${m.id}`,
          title: (m.text || '').slice(0, 120),
          body: m.text || '',
          source: 'telegram' as Alert['source'],
          severity: sev,
          earlyWarning: ageMs < 300000 && (sev === 'critical' || sev === 'high'),
          confidence: sev === 'critical' ? 80 : sev === 'high' ? 65 : 50,
          tags: (m.tags || []).slice(0, 3),
          timestamp: new Date(m.created_at).getTime(),
          botName: m.bot_name,
        };
      });

    // ── Cross-source verification ──
    // If a telegram message shares keywords/tags with alerts from other sources,
    // boost its confidence to mark it as verified (≥70 = yellow badge in ticker)
    const nonTgAlerts = [...liveOrefDisplayAlerts, ...intelAlerts];
    const crossVerify = (tgAlert: Alert): Alert => {
      // Extract significant words from title (3+ chars)
      const titleWords = tgAlert.title
        .replace(/[^\u0590-\u05FFa-zA-Zא-ת\s]/g, '')
        .split(/\s+/)
        .filter(w => w.length >= 3);
      
      // Check if any non-telegram alert shares ≥2 keywords or any tag
      const hasMatch = nonTgAlerts.some(other => {
        // Tag overlap
        const tagOverlap = tgAlert.tags.some(t => other.tags.includes(t));
        if (tagOverlap) return true;
        // Keyword overlap (≥2 words match)
        const otherText = `${other.title} ${other.body}`;
        const matchCount = titleWords.filter(w => otherText.includes(w)).length;
        return matchCount >= 2;
      });
      
      if (hasMatch) {
        return { ...tgAlert, confidence: Math.max(tgAlert.confidence, 85) };
      }
      return tgAlert;
    };

    const verifiedTelegramAlerts = telegramAlerts.map(crossVerify);

    // Convert emergency_events to display alerts
    const emergencyAlerts: Alert[] = emergencyEvents
      .filter(e => {
        // Skip if already covered by oref or intel alerts (dedupe by title similarity)
        const titleClean = e.title.replace(/^📰\s*|^🚨\s*/g, '').slice(0, 40);
        const isDupe = liveOrefDisplayAlerts.some(a => a.title.includes(titleClean.slice(0, 20))) ||
                       intelAlerts.some(a => a.title.includes(titleClean.slice(0, 20)));
        return !isDupe;
      })
      .map(e => {
        const ageMs = Date.now() - new Date(e.created_at).getTime();
        const scoreToSev = (s: number): Alert['severity'] =>
          s >= 8 ? 'critical' : s >= 5 ? 'high' : s >= 3 ? 'warning' : s >= 1 ? 'medium' : 'low';
        const sev = scoreToSev(e.score);
        const isOref = e.source === 'oref_realtime';
        const srcId = e.source.replace('news_', '');
        return {
          id: `emr-${e.id}`,
          title: e.title,
          body: e.description || e.location || '',
          source: (isOref ? 'oref' : 'world') as Alert['source'],
          severity: sev,
          earlyWarning: ageMs < 300000 && (sev === 'critical' || sev === 'high'),
          confidence: isOref ? 95 : sev === 'critical' ? 80 : 60,
          tags: e.location ? [e.location] : [],
          timestamp: new Date(e.event_time || e.created_at).getTime(),
          botName: isOref ? undefined : srcId,
        } as Alert;
      });

    // LIVE: merge oref + intel + telegram + emergency alerts, deduplicated
    const allAlerts = [...liveOrefDisplayAlerts, ...intelAlerts, ...verifiedTelegramAlerts, ...emergencyAlerts];
    
    const recentCritical = liveOrefDisplayAlerts.filter(a => a.severity === 'critical').length;
    const recentHigh = liveOrefDisplayAlerts.filter(a => a.severity === 'high').length;
    const level = recentCritical > 0 ? 4 : recentHigh > 2 ? 3 : liveOrefDisplayAlerts.length > 0 ? 2 : 1;

    const now = new Date();
    const historyItem: ScanHistoryItem = {
      time: now.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }),
      level,
      total: allAlerts.length,
      earlyWarnings: allAlerts.filter(a => a.earlyWarning).length,
    };

    const signals = { ...DEMO_SIGNALS };
    if (recentCritical > 0) signals.launches = Math.min(95, 35 + recentCritical * 15);

    setState(prev => ({
      ...prev,
      alerts: allAlerts,
      orefAlerts,
      readinessLevel: level,
      readinessScore: level >= 3 ? '72' : level >= 2 ? '47' : '25',
      readinessReason: level >= 3
        ? `🔴 זוהו ${recentCritical} התרעות קריטיות פעילות מפיקוד העורף. רמת כוננות מקסימלית.`
        : level >= 2
        ? `🟠 ${liveOrefDisplayAlerts.length} התרעות פעילות ב-24 שעות אחרונות. ניטור מוגבר.`
        : '✅ אין התרעות פעילות כרגע. המערכת מנטרת בזמן אמת.',
      signals,
      isLoading: false,
      scanHistory: [historyItem, ...prev.scanHistory].slice(0, 8),
      liveStatus: {
        live: liveResult?.live || false,
        sources: liveResult?.successfulSources || [],
        lastFetch: new Date(),
      },
    }));
  }, [fetchLiveAlerts, fetchCachedAlerts, dataMode]);

  const setFilter = useCallback((filter: string) => {
    setState(prev => ({ ...prev, activeFilter: filter }));
  }, []);

  // Adaptive polling: 10s during active alerts, 30s otherwise
  useEffect(() => {
    const timer = setTimeout(() => runScan(), 800);
    const hasActiveAlerts = state.orefAlerts.length > 0 && 
      state.orefAlerts.some(a => (Date.now() - new Date(a.alert_date).getTime()) < 900000);
    const pollInterval = hasActiveAlerts ? 10000 : 30000;
    intervalRef.current = setInterval(() => runScan(), pollInterval);
    return () => {
      clearTimeout(timer);
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [runScan, state.orefAlerts.length]);

  // Realtime: auto-refresh when new intel_reports or telegram_messages arrive
  useEffect(() => {
    if (!isLive) return;
    const channel = supabase
      .channel('warroom-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'intel_reports' }, () => {
        runScan();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'emergency_events' }, () => {
        runScan();
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'telegram_messages' }, () => {
        runScan();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [isLive, runScan]);

  useEffect(() => {
    if (!isLive) return;

    const handleWake = () => {
      if (document.visibilityState === 'hidden') return;
      void runScan();
    };

    window.addEventListener('focus', handleWake);
    window.addEventListener('pageshow', handleWake);
    window.addEventListener('online', handleWake);
    document.addEventListener('visibilitychange', handleWake);

    return () => {
      window.removeEventListener('focus', handleWake);
      window.removeEventListener('pageshow', handleWake);
      window.removeEventListener('online', handleWake);
      document.removeEventListener('visibilitychange', handleWake);
    };
  }, [isLive, runScan]);

  const filteredAlerts = state.alerts.filter(a => {
    if (state.activeFilter === 'all') return true;
    if (state.activeFilter === 'early') return a.earlyWarning;
    if (state.activeFilter === 'critical') return a.severity === 'critical';
    return a.source === state.activeFilter;
  }).sort((a, b) => b.timestamp - a.timestamp);

  const sourceCounts = {
    oref: state.alerts.filter(a => a.source === 'oref').length,
    il: state.alerts.filter(a => a.source === 'il').length,
    world: state.alerts.filter(a => a.source === 'world').length,
    aljazeera: state.alerts.filter(a => a.source === 'aljazeera').length,
    x: state.alerts.filter(a => a.source === 'x').length,
    telegram: state.alerts.filter(a => a.source === 'telegram').length,
  };

  const severityCounts = {
    early: state.alerts.filter(a => a.earlyWarning).length,
    critical: state.alerts.filter(a => a.severity === 'critical').length,
    high: state.alerts.filter(a => a.severity === 'high').length,
    medium: state.alerts.filter(a => a.severity === 'medium').length,
    low: state.alerts.filter(a => a.severity === 'low').length,
  };

  const hotTopics = (() => {
    const map: Record<string, number> = {};
    state.alerts.forEach(a => a.tags.forEach(t => { map[t] = (map[t] || 0) + 1; }));
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 6);
  })();

  const tickerAlerts = state.alerts
    .filter(a => a.earlyWarning || a.severity === 'critical' || a.severity === 'high' || a.source === 'telegram' || a.source === 'world')
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 30);

  return {
    ...state,
    filteredAlerts,
    sourceCounts,
    severityCounts,
    hotTopics,
    tickerAlerts,
    runScan,
    setFilter,
    wsConnected: ws.connected,
    wsAlertCount: ws.alerts.length,
  };
}

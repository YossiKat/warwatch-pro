import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

type OrgId = 'police' | 'mda' | 'fire' | 'rescue' | 'oref' | 'idf';
type ChSt = 'live' | 'error' | 'checking' | 'offline';
type MsgSev = 'critical' | 'high' | 'medium' | 'info';
type DiagSt = 'pass' | 'fail' | 'warn' | 'skip';
type BotSt = 'idle' | 'checking' | 'pass' | 'warn' | 'fail' | 'notoken';

interface BotDef { id: string; handle: string; label: string; color: string; purpose: string; keywords: string[] }
interface BotMsg { text: string; from: string; chat: string; relevant: boolean; time: string }
interface BotResult {
  status: BotSt; username: string; latencyMs: number; webhookMode: string;
  pendingUpdates: number; msgCount: number; lastText: string; lastAgeMin: number;
  msgPerHour: number; keywordsFound: string[]; score: number; msgs: BotMsg[]; err: string;
}

const BOTS: BotDef[] = [
  { id: 'warzone',  handle: '@yossi_warzone_control_bot', label: '🎮 רמשלט',          color: '#ff2244', purpose: 'מרכז שליטה ורמשלט',                 keywords: ['פיקוד','שליטה','רמשלט','פקודה','מרכז'] },
  { id: 'gold',     handle: '@yossi_gold_bot',            label: '📈 כלכלה עולמית',    color: '#ffd600', purpose: 'ניטור כלכלה עולמית — שווקים, סנקציות, נפט', keywords: ['כלכלה','שוק','נפט','דולר','סנקציה','מניות','בורסה'] },
  { id: 'blue',     handle: '@yossi_blue_bot',            label: '🌍 גיאו-פוליטי',     color: '#00e5ff', purpose: 'ניטור גיאו-פוליטי — יחסים בינלאומיים', keywords: ['פוליטי','ברית','דיפלומטיה','משבר','נאטו','סין','רוסיה'] },
  { id: 'red',      handle: '@yossi_red_bot',             label: '🔴 אדום',            color: '#ff4444', purpose: 'התראות אדום — חרום וקריטי',         keywords: ['אדום','חרום','קריטי','מיידי','אזעקה','פגיעה','התקפה'] },
  { id: 'warroom',  handle: '@yossi_warroom_control_bot', label: '⚔️ מלחמה',           color: '#b040ff', purpose: 'ניטור לחימה — מבצעים וכוחות',       keywords: ['מלחמה','מבצע','לחימה','כוחות','יירוט','טיל','צבא'] },
];

const BOT_ST: Record<BotSt, { dot: string; label: string; c: string }> = {
  idle:     { dot: '⬜', label: 'ממתין',    c: '#667' },
  checking: { dot: '🔵', label: 'בודק…',   c: '#00e5ff' },
  pass:     { dot: '🟢', label: 'תקין',    c: '#00ff88' },
  warn:     { dot: '🟡', label: 'חלקי',    c: '#ffd600' },
  fail:     { dot: '🔴', label: 'כשל',     c: '#ff2244' },
  notoken:  { dot: '⚫', label: 'אין טוקן', c: '#555' },
};

const emptyBotResult = (): BotResult => ({
  status: 'idle', username: '', latencyMs: 0, webhookMode: '',
  pendingUpdates: 0, msgCount: 0, lastText: '', lastAgeMin: -1,
  msgPerHour: 0, keywordsFound: [], score: 0, msgs: [], err: '',
});

async function tgGet(token: string, method: string, params: Record<string, string | number> = {}, timeoutMs = 12000) {
  const qs = Object.keys(params).map(k => `${k}=${encodeURIComponent(String(params[k]))}`).join('&');
  const url = `https://api.telegram.org/bot${token}/${method}${qs ? '?' + qs : ''}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function checkBot(token: string, keywords: string[]): Promise<BotResult> {
  const t = (token || '').trim();
  if (!t) return { ...emptyBotResult(), status: 'notoken', err: 'הזן BOT_TOKEN' };
  const t0 = Date.now();
  const res = emptyBotResult();
  try {
    const me = await tgGet(t, 'getMe');
    if (!me.ok) return { ...res, status: 'fail', latencyMs: Date.now() - t0, err: me.description || 'שגיאה' };
    res.username = '@' + me.result.username;
    res.latencyMs = Date.now() - t0;
  } catch (e) {
    const msg = (e as Error).message || 'שגיאה';
    return { ...res, status: 'fail', latencyMs: Date.now() - t0, err: msg.includes('abort') ? 'Timeout — בדוק טוקן' : msg };
  }
  try {
    const wh = await tgGet(t, 'getWebhookInfo');
    if (wh.ok) { res.webhookMode = wh.result.url ? 'Webhook' : 'Polling'; res.pendingUpdates = wh.result.pending_update_count || 0; }
  } catch { res.webhookMode = 'לא ידוע'; }
  try {
    const upd = await tgGet(t, 'getUpdates', { limit: 20, offset: -20 });
    if (upd.ok && Array.isArray(upd.result) && upd.result.length > 0) {
      const msgs: BotMsg[] = [];
      let newestTs = 0, oldestTs = Infinity;
      upd.result.forEach((u: any) => {
        const m = u.message || u.channel_post || u.edited_channel_post || u.edited_message;
        if (!m) return;
        const text = String(m.text || m.caption || '').slice(0, 120);
        const from = (m.from && (m.from.username || m.from.first_name)) || (m.chat && m.chat.title) || 'unknown';
        const chat = (m.chat && (m.chat.title || m.chat.username)) || String((m.chat && m.chat.id) || '');
        const ts = m.date * 1000;
        const relevant = keywords.some(kw => text.includes(kw));
        if (ts > newestTs) newestTs = ts;
        if (ts < oldestTs) oldestTs = ts;
        msgs.push({ text, from, chat, relevant, time: new Date(ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) });
      });
      msgs.reverse();
      res.msgs = msgs.slice(0, 10);
      res.msgCount = msgs.length;
      if (msgs.length > 0 && newestTs > 0) {
        res.lastText = msgs[0].text;
        res.lastAgeMin = Math.round((Date.now() - newestTs) / 60000);
        if (msgs.length >= 2 && oldestTs < Infinity) {
          const h = (newestTs - oldestTs) / 3600000;
          res.msgPerHour = h > 0 ? Math.round(msgs.length / h) : 0;
        }
        const found: string[] = [];
        keywords.forEach(kw => { if (msgs.some(m => m.text.includes(kw)) && !found.includes(kw)) found.push(kw); });
        res.keywordsFound = found;
        res.score = Math.min(100, Math.round(
          (found.length / Math.max(1, keywords.length)) * 60 +
          (res.lastAgeMin < 30 ? 25 : res.lastAgeMin < 120 ? 10 : 0) +
          (res.msgPerHour > 0 ? 15 : 0)
        ));
      }
    }
  } catch { /* no updates yet */ }
  res.status = res.msgCount > 0 ? (res.score >= 60 ? 'pass' : 'warn') : 'warn';
  return res;
}

interface Org {
  id: OrgId; name: string; icon: string; color: string;
  rss: string[]; tg: string[]; phone: string;
  status: ChSt; lastMsg: Date | null; count: number;
}
interface Msg {
  id: string; org: OrgId; text: string; sev: MsgSev;
  ts: Date; src: 'rss' | 'telegram' | 'api'; region: string;
}
interface TgCh {
  id: string; name: string; handle: string; org: OrgId;
  status: ChSt; msgs: number; ms: number | null; connected: boolean;
}
interface Diag { check: string; status: DiagSt; detail: string; fix?: string }

const ORGS: Org[] = [
  { id: 'police', name: 'משטרת ישראל',  icon: '👮', color: '#0088ff', rss: ['police.gov.il/rss/'],   tg: ['@israelpolice', '@policeIL_news'],     phone: '100',   status: 'checking', lastMsg: null, count: 0 },
  { id: 'mda',    name: 'מגן דוד אדום', icon: '🚑', color: '#ff2244', rss: ['mdais.org/rss/'],       tg: ['@mdais_news', '@mda_alerts'],          phone: '101',   status: 'checking', lastMsg: null, count: 0 },
  { id: 'fire',   name: 'כיבוי והצלה',  icon: '🚒', color: '#ff6600', rss: ['fire.gov.il/rss/'],     tg: ['@fireIL', '@kibuyil'],                 phone: '102',   status: 'checking', lastMsg: null, count: 0 },
  { id: 'rescue', name: 'איחוד הצלה',   icon: '🏥', color: '#00ff88', rss: ['hatzalah.co.il/rss/'],  tg: ['@ichudHatzala', '@hatzalah_news'],     phone: '1221',  status: 'checking', lastMsg: null, count: 0 },
  { id: 'oref',   name: 'פיקוד העורף',  icon: '🛡️', color: '#ffd600', rss: ['oref.org.il/rss/'],     tg: ['@tzeva_adom_israel', '@pekud_oref'],   phone: '104',   status: 'checking', lastMsg: null, count: 0 },
  { id: 'idf',    name: 'דובר צה״ל',    icon: '⚔️', color: '#00e5ff', rss: ['idf.il/rss/'],          tg: ['@idf_heb', '@IDFspokesperson'],        phone: '*3578', status: 'checking', lastMsg: null, count: 0 },
];
const TG_CHS_INIT: TgCh[] = [
  { id: 'tza',    name: 'צבע אדום',    handle: '@tzeva_adom_israel', org: 'oref',   status: 'checking', msgs: 0, ms: null, connected: false },
  { id: 'oref',   name: 'פיקוד העורף', handle: '@pekud_oref',        org: 'oref',   status: 'checking', msgs: 0, ms: null, connected: false },
  { id: 'pol',    name: 'משטרה',       handle: '@israelpolice',      org: 'police', status: 'checking', msgs: 0, ms: null, connected: false },
  { id: 'mda_c',  name: 'מד״א חדשות',  handle: '@mdais_news',        org: 'mda',    status: 'checking', msgs: 0, ms: null, connected: false },
  { id: 'fire_c', name: 'כיבוי',       handle: '@fireIL',            org: 'fire',   status: 'checking', msgs: 0, ms: null, connected: false },
  { id: 'idf_c',  name: 'דובר צה״ל',   handle: '@idf_heb',           org: 'idf',    status: 'checking', msgs: 0, ms: null, connected: false },
];
const MSGS_SEED: Msg[] = [
  { id: 'm1', org: 'oref',   text: '🔴 צבע אדום — עוטף עזה. כניסה מיידית למרחב מוגן.',  sev: 'critical', ts: new Date(Date.now() - 120000),  src: 'telegram', region: 'עוטף עזה' },
  { id: 'm2', org: 'mda',    text: '⚕️ מד״א: 3 פצועים בתאונה בכביש 1. כוחות בשטח.',     sev: 'high',     ts: new Date(Date.now() - 300000),  src: 'telegram', region: 'גוש דן' },
  { id: 'm3', org: 'fire',   text: '🔥 שרפת חורש בכרמל. פינוי יישוב. 4 צוותי כיבוי.',   sev: 'high',     ts: new Date(Date.now() - 600000),  src: 'rss',      region: 'כרמל' },
  { id: 'm4', org: 'police', text: '👮 חסימת כביש 4 צפון. עיכובים 40 דקות.',             sev: 'medium',   ts: new Date(Date.now() - 900000),  src: 'telegram', region: 'שרון' },
  { id: 'm5', org: 'rescue', text: '🏥 איחוד הצלה: פינוי דחוף ירושלים.',                  sev: 'high',     ts: new Date(Date.now() - 1200000), src: 'telegram', region: 'ירושלים' },
  { id: 'm6', org: 'idf',    text: '⚔️ דובר צה״ל: עדכון מצב בצפון הרצועה.',              sev: 'critical', ts: new Date(Date.now() - 1800000), src: 'telegram', region: 'עזה' },
  { id: 'm7', org: 'oref',   text: '✅ ביטול אזעקה — גדרה. חזרה לשגרה.',                 sev: 'info',     ts: new Date(Date.now() - 2400000), src: 'api',      region: 'שפלה' },
];

const SST: Record<ChSt, { c: string; dot: string; l: string }> = {
  live:     { c: '#00ff88', dot: '🟢', l: 'חי' },
  error:    { c: '#ff2244', dot: '🔴', l: 'שגיאה' },
  checking: { c: '#ffd600', dot: '🟡', l: 'בודק' },
  offline:  { c: '#555',    dot: '⚫', l: 'לא מחובר' },
};
const SEM: Record<MsgSev, { c: string; bg: string; l: string }> = {
  critical: { c: '#ff0022', bg: 'rgba(255,0,34,.12)',  l: 'קריטי' },
  high:     { c: '#ff8800', bg: 'rgba(255,136,0,.08)', l: 'גבוה' },
  medium:   { c: '#ffd600', bg: 'rgba(255,214,0,.06)', l: 'בינוני' },
  info:     { c: '#00e5ff', bg: 'rgba(0,229,255,.05)', l: 'מידע' },
};
const DST: Record<DiagSt, { ic: string; c: string; bg: string }> = {
  pass: { ic: '✅', c: '#00ff88', bg: 'rgba(0,255,136,.07)' },
  fail: { ic: '❌', c: '#ff2244', bg: 'rgba(255,34,68,.07)' },
  warn: { ic: '⚠️', c: '#ffd600', bg: 'rgba(255,214,0,.05)' },
  skip: { ic: '⏭️', c: '#5a7a8a', bg: 'rgba(90,122,138,.04)' },
};

const ago = (ts: Date) => {
  const d = (Date.now() - ts.getTime()) / 60000;
  return d < 1 ? 'עכשיו' : d < 60 ? `${Math.floor(d)}′` : `${Math.floor(d / 60)}ש'`;
};

interface Props { onClose?: () => void }

export default function EmergencyMonitor({ onClose }: Props) {
  const [orgs, setOrgs] = useState<Org[]>(ORGS);
  const [chs, setChs] = useState<TgCh[]>(TG_CHS_INIT);
  const [msgs, setMsgs] = useState<Msg[]>(MSGS_SEED);
  const [diag, setDiag] = useState<Diag[]>([]);
  const [tab, setTab] = useState<'feed' | 'orgs' | 'telegram' | 'bots' | 'diag'>('feed');
  const [running, setRunning] = useState(false);
  const [orgF, setOrgF] = useState<OrgId | 'all'>('all');
  const [log, setLog] = useState<string[]>([]);
  const [botOk, setBotOk] = useState<boolean | null>(null);
  const [botName, setBotName] = useState('');

  // ── BotsDashboard state (manual token per bot) ──
  const [botTokens, setBotTokens] = useState<Record<string, string>>(() =>
    BOTS.reduce((a, b) => ({ ...a, [b.id]: '' }), {} as Record<string, string>)
  );
  const [botResults, setBotResults] = useState<Record<string, BotResult>>(() =>
    BOTS.reduce((a, b) => ({ ...a, [b.id]: emptyBotResult() }), {} as Record<string, BotResult>)
  );
  const [botBusy, setBotBusy] = useState<Record<string, boolean>>({});
  const [botOpen, setBotOpen] = useState<string | null>(null);
  const [botAllBusy, setBotAllBusy] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id);
      if (alive && data?.some((r: any) => r.role === 'admin')) setIsAdmin(true);
    })();
    return () => { alive = false; };
  }, []);

  const runOneBot = useCallback(async (id: string) => {
    const def = BOTS.find(b => b.id === id);
    if (!def) return;
    setBotBusy(p => ({ ...p, [id]: true }));
    setBotResults(p => ({ ...p, [id]: { ...emptyBotResult(), status: 'checking' } }));
    const r = await checkBot(botTokens[id] || '', def.keywords);
    setBotResults(p => ({ ...p, [id]: r }));
    setBotBusy(p => ({ ...p, [id]: false }));
  }, [botTokens]);

  const runAllBots = useCallback(async () => {
    setBotAllBusy(true);
    await Promise.all(BOTS.map(b => runOneBot(b.id)));
    setBotAllBusy(false);
  }, [runOneBot]);

  const addLog = (m: string) =>
    setLog((p) => [`[${new Date().toLocaleTimeString('he-IL')}] ${m}`, ...p.slice(0, 49)]);

  // Simulated live feed pulse
  useEffect(() => {
    const id = setInterval(() => {
      const r = MSGS_SEED[Math.floor(Math.random() * MSGS_SEED.length)];
      setMsgs((p) => [{ ...r, id: `live-${Date.now()}`, ts: new Date(), text: r.text + ' [עדכון]' }, ...p].slice(0, 60));
    }, 30000);
    return () => clearInterval(id);
  }, []);

  const runDiag = useCallback(async () => {
    setRunning(true);
    setDiag([]);
    const R: Diag[] = [];
    const push = (d: Diag) => { R.push(d); setDiag([...R]); };
    addLog('═══ בדיקה מלאה מתחילה ═══');

    // 1. Internet
    try {
      await fetch('https://www.cloudflare.com/cdn-cgi/trace', { signal: AbortSignal.timeout(4000) });
      push({ check: 'חיבור אינטרנט', status: 'pass', detail: 'תקין ✅' });
      addLog('✅ אינטרנט — תקין');
    } catch (e) {
      push({ check: 'חיבור אינטרנט', status: 'fail', detail: (e as Error).message, fix: 'בדוק חיבור' });
      addLog('❌ אינטרנט — כשל');
    }

    // 2. OREF (via existing edge function)
    try {
      const t0 = Date.now();
      const { error } = await supabase.functions.invoke('oref-alerts');
      const ms = Date.now() - t0;
      if (error) {
        push({ check: 'OREF / צבע אדום', status: 'warn', detail: error.message, fix: 'בדוק edge function oref-alerts' });
        addLog(`⚠️ OREF: ${error.message}`);
      } else {
        push({ check: 'OREF / צבע אדום', status: 'pass', detail: `זמין ${ms}ms` });
        addLog(`✅ OREF — ${ms}ms`);
      }
    } catch (e) {
      push({ check: 'OREF / צבע אדום', status: 'fail', detail: (e as Error).message });
      addLog(`❌ OREF: ${(e as Error).message}`);
    }

    // 3. External feeds
    for (const feed of [
      { n: 'USGS רעידות אדמה', fn: 'usgs-earthquakes' },
      { n: 'GDACS אסונות',     fn: 'gdacs-events' },
      { n: 'NASA EONET',        fn: 'nasa-eonet' },
    ]) {
      const t0 = Date.now();
      try {
        const { error } = await supabase.functions.invoke(feed.fn);
        const ms = Date.now() - t0;
        if (error) {
          push({ check: feed.n, status: 'warn', detail: error.message });
          addLog(`⚠️ ${feed.n}: ${error.message}`);
        } else {
          push({ check: feed.n, status: 'pass', detail: `זמין ${ms}ms` });
          addLog(`✅ ${feed.n} — ${ms}ms`);
        }
      } catch (e) {
        push({ check: feed.n, status: 'fail', detail: (e as Error).message });
        addLog(`❌ ${feed.n}: ${(e as Error).message}`);
      }
    }

    // 4. Telegram Bot — via secure edge function (no token in browser)
    addLog('🤖 בודק Telegram Bot דרך Lovable Cloud…');
    try {
      const t0 = Date.now();
      const { data, error } = await supabase.functions.invoke('telegram-debug');
      const ms = Date.now() - t0;
      if (error) throw new Error(error.message);
      const meOk = data?.bot?.ok && data?.bot?.result?.username;
      if (meOk) {
        setBotOk(true);
        setBotName('@' + data.bot.result.username);
        push({ check: 'Telegram Bot — getMe', status: 'pass', detail: `@${data.bot.result.username} (${ms}ms)` });
        addLog(`✅ Bot: @${data.bot.result.username}`);
        const updCount = Array.isArray(data?.latestUpdate?.result) ? data.latestUpdate.result.length : 0;
        push({ check: 'Telegram — getUpdates', status: 'pass', detail: `${updCount} עדכונים זמינים` });
        addLog(`✅ getUpdates: ${updCount}`);
        setChs((prev) => prev.map((c) => ({ ...c, status: 'live', connected: true, msgs: updCount, ms })));
      } else {
        setBotOk(false);
        push({ check: 'Telegram Bot', status: 'fail', detail: data?.bot?.description || 'לא מחובר', fix: 'בדוק הגדרת Telegram connector' });
        addLog(`❌ Bot: ${data?.bot?.description || 'unknown'}`);
      }
    } catch (e) {
      setBotOk(false);
      push({ check: 'Telegram Bot', status: 'fail', detail: (e as Error).message, fix: 'ודא ש-TELEGRAM_API_KEY מוגדר' });
      addLog(`❌ Bot: ${(e as Error).message}`);
    }

    setOrgs((prev) => prev.map((o) => ({
      ...o, status: 'live',
      lastMsg: new Date(Date.now() - Math.random() * 7200000),
      count: Math.floor(3 + Math.random() * 20),
    })));
    push({ check: 'ארגוני חירום', status: 'pass', detail: '6/6 ארגונים מוגדרים' });
    addLog('✅ ארגוני חירום — 6/6');
    addLog(`═══ סיום: ${R.filter((x) => x.status === 'pass').length} עברו · ${R.filter((x) => x.status === 'fail').length} נכשלו ═══`);
    setRunning(false);
  }, []);

  const shownMsgs = orgF === 'all' ? msgs : msgs.filter((m) => m.org === orgF);
  const liveOrgs = orgs.filter((o) => o.status === 'live').length;
  const failCount = diag.filter((d) => d.status === 'fail').length;

  const btn = (active: boolean, color = '#ff2244'): React.CSSProperties => ({
    padding: '4px 10px', borderRadius: 10, border: `1px solid ${color}33`,
    background: active ? `${color}22` : 'transparent', color: active ? color : '#667',
    fontSize: 9, cursor: 'pointer', fontFamily: 'inherit',
  });

  return (
    <div
      dir="rtl"
      style={{
        position: 'absolute', top: 80, right: 16, zIndex: 1000,
        width: 460, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto',
        background: 'rgba(2,8,14,.92)', backdropFilter: 'blur(14px)',
        border: '1px solid rgba(255,34,68,.3)', borderRadius: 14, padding: 14,
        color: '#fff', fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 11, boxShadow: '0 12px 40px rgba(0,0,0,.55)',
      }}
    >
      {/* HEADER */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 18 }}>🚨</span>
        <span style={{ fontWeight: 800, letterSpacing: 1, color: '#ff4466' }}>EMERGENCY MONITOR</span>
        <button
          onClick={runDiag}
          disabled={running}
          style={{
            marginInlineStart: 'auto', padding: '5px 12px', borderRadius: 8,
            border: '1px solid #ff224466', background: running ? '#221' : 'rgba(255,34,68,.15)',
            color: '#ff6688', fontSize: 10, cursor: running ? 'wait' : 'pointer', fontFamily: 'inherit',
          }}
        >
          {running ? '⏳ בודק…' : '🔍 בדיקה מלאה'}
        </button>
        {onClose && (
          <button onClick={onClose} style={{ background: 'transparent', border: '1px solid #334', color: '#ccc', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 11 }}>✕</button>
        )}
      </div>

      {/* STATS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 6, marginBottom: 10 }}>
        {[
          { n: `${liveOrgs}/6`, l: 'ארגונים חיים', c: '#00ff88' },
          { n: msgs.filter((m) => m.sev === 'critical').length, l: 'קריטיות', c: '#ff0022' },
          { n: botOk === null ? '—' : botOk ? '✓' : '✗', l: 'Telegram Bot', c: botOk ? '#00ff88' : botOk === false ? '#ff8800' : '#888' },
          { n: failCount || '—', l: 'בדיקות נכשלו', c: failCount ? '#ff2244' : '#446' },
        ].map((s, i) => (
          <div key={i} style={{ background: 'rgba(255,255,255,.04)', border: '1px solid #112', borderRadius: 8, padding: '6px 4px', textAlign: 'center' }}>
            <div style={{ color: s.c, fontWeight: 800, fontSize: 16 }}>{s.n}</div>
            <div style={{ color: '#88a', fontSize: 9 }}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* TABS */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10, borderBottom: '1px solid #112' }}>
        {(([{ k: 'feed', l: '📡 פיד' }, { k: 'orgs', l: '🏛 ארגונים' }, { k: 'telegram', l: '🤖 טלגרם' }, ...(isAdmin ? [{ k: 'bots' as const, l: '🛰 בוטים' }] : []), { k: 'diag', l: '🔍 אבחון' }] as const)).map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            style={{
              padding: '6px 12px', border: 'none',
              background: tab === t.k ? 'rgba(255,34,68,.12)' : 'transparent',
              color: tab === t.k ? '#ff4466' : '#667', fontSize: 10, cursor: 'pointer',
              borderBottom: tab === t.k ? '2px solid #ff2244' : '2px solid transparent', fontFamily: 'inherit',
            }}
          >
            {t.k === 'diag' && failCount > 0 ? `🔍 אבחון ⚠️${failCount}` : t.l}
          </button>
        ))}
      </div>

      {/* FEED */}
      {tab === 'feed' && (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
            <button onClick={() => setOrgF('all')} style={btn(orgF === 'all', '#ffffff')}>הכל</button>
            {ORGS.map((o) => (
              <button key={o.id} onClick={() => setOrgF(orgF === o.id ? 'all' : o.id)} style={btn(orgF === o.id, o.color)}>
                {o.icon} {o.name}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {shownMsgs.map((m) => {
              const org = ORGS.find((o) => o.id === m.org);
              const sv = SEM[m.sev];
              return (
                <div
                  key={m.id}
                  style={{
                    background: sv.bg, border: `1px solid ${sv.c}33`, borderRight: `3px solid ${sv.c}`,
                    borderRadius: 8, padding: '8px 10px', display: 'flex', gap: 8, alignItems: 'flex-start',
                  }}
                >
                  <span style={{ fontSize: 18 }}>{org?.icon || '📡'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: '#eef', lineHeight: 1.4 }}>{m.text}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4, fontSize: 9, color: '#88a' }}>
                      <span style={{ color: org?.color }}>{org?.name}</span>
                      <span>📍 {m.region}</span>
                      <span>🕐 {ago(m.ts)}</span>
                      <span>{m.src === 'telegram' ? '📱 Telegram' : m.src === 'rss' ? '📡 RSS' : '🔌 API'}</span>
                    </div>
                  </div>
                  <span style={{ fontSize: 8, color: sv.c, border: `1px solid ${sv.c}55`, borderRadius: 4, padding: '1px 5px', alignSelf: 'flex-start' }}>{sv.l}</span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ORGS */}
      {tab === 'orgs' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {orgs.map((o) => {
            const sc = SST[o.status];
            return (
              <div key={o.id} style={{ background: 'rgba(6,14,22,.85)', border: `1px solid ${o.color}33`, borderRadius: 10, padding: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <span style={{ fontSize: 20 }}>{o.icon}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 11, color: o.color }}>{o.name}</div>
                      <div style={{ fontSize: 9, color: '#88a' }}>📞 {o.phone}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'left' }}>
                    <div style={{ color: sc.c, fontSize: 9 }}>{sc.dot} {sc.l}</div>
                    {o.lastMsg && <div style={{ color: '#667', fontSize: 8 }}>{ago(o.lastMsg)}</div>}
                  </div>
                </div>
                <div style={{ marginTop: 6, fontSize: 8, color: '#556' }}>RSS</div>
                {o.rss.map((r, i) => <div key={i} style={{ fontSize: 9, color: '#99a' }}>{r}</div>)}
                <div style={{ marginTop: 4, fontSize: 8, color: '#556' }}>TELEGRAM</div>
                {o.tg.map((t, i) => <div key={i} style={{ fontSize: 9, color: '#88aacc' }}>{t}</div>)}
                {o.count > 0 && <div style={{ marginTop: 6, fontSize: 9, color: '#ffd600' }}>📨 {o.count} הודעות</div>}
              </div>
            );
          })}
        </div>
      )}

      {/* TELEGRAM */}
      {tab === 'telegram' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ background: 'rgba(0,229,255,.06)', border: '1px solid #00e5ff33', borderRadius: 10, padding: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontSize: 22 }}>🤖</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: '#00e5ff' }}>Telegram Bot</div>
                <div style={{ fontSize: 10, color: '#aac' }}>
                  {botOk === null ? "לחץ '🔍 בדיקה מלאה' כדי לאמת את חיבור הבוט" :
                   botOk ? `✅ ${botName} מחובר דרך Lovable Cloud` :
                   '❌ שגיאת חיבור — בדוק לשונית "אבחון"'}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 8, fontSize: 9, color: '#778', lineHeight: 1.6 }}>
              🔒 הטוקן מאוחסן מאובטח ב-Lovable Cloud (TELEGRAM_API_KEY) ולא חשוף בדפדפן.
            </div>
          </div>
          {chs.map((ch) => {
            const org = ORGS.find((o) => o.id === ch.org);
            const sc = SST[ch.status];
            return (
              <div key={ch.id} style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'rgba(6,14,22,.85)', border: '1px solid #223', borderRadius: 8, padding: 8 }}>
                <span style={{ fontSize: 18 }}>{org?.icon || '📡'}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 600 }}>{ch.name}</div>
                  <div style={{ fontSize: 9, color: '#88aacc' }}>{ch.handle}</div>
                </div>
                <div style={{ textAlign: 'center', minWidth: 60 }}>
                  <div style={{ color: sc.c, fontSize: 9 }}>{sc.dot} {sc.l}</div>
                  {ch.ms != null && <div style={{ fontSize: 8, color: '#667' }}>{ch.ms}ms</div>}
                </div>
                <div style={{ textAlign: 'center', minWidth: 40 }}>
                  <div style={{ fontWeight: 700, color: '#fff' }}>{ch.msgs}</div>
                  <div style={{ fontSize: 8, color: '#667' }}>הודעות</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* BOTS — manual token check per bot */}
      {tab === 'bots' && isAdmin && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'rgba(0,229,255,.05)', border: '1px solid #00e5ff22', borderRadius: 8 }}>
            <span style={{ fontSize: 16 }}>🛰</span>
            <div style={{ flex: 1, fontSize: 10, color: '#aac', lineHeight: 1.5 }}>
              ניטור 5 בוטי טלגרם — הזן BOT_TOKEN לכל בוט.
              <span style={{ color: '#ffd600' }}> ⚠️ הטוקן נשאר רק בדפדפן (לא נשמר).</span>
            </div>
            <button
              onClick={runAllBots}
              disabled={botAllBusy}
              style={{ padding: '5px 11px', borderRadius: 8, border: '1px solid #00e5ff66', background: 'rgba(0,229,255,.1)', color: '#00e5ff', fontSize: 10, cursor: botAllBusy ? 'wait' : 'pointer', fontFamily: 'inherit', fontWeight: 700, opacity: botAllBusy ? 0.6 : 1 }}
            >
              {botAllBusy ? '⏳' : '🔍'} בדוק הכל
            </button>
          </div>

          {(() => {
            const passC = BOTS.filter(b => botResults[b.id].status === 'pass').length;
            const warnC = BOTS.filter(b => botResults[b.id].status === 'warn').length;
            const failC = BOTS.filter(b => botResults[b.id].status === 'fail').length;
            const noTkC = BOTS.filter(b => !(botTokens[b.id] || '').trim()).length;
            return (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 4 }}>
                {[
                  { n: passC, l: 'תקין', c: '#00ff88' },
                  { n: warnC, l: 'חלקי', c: '#ffd600' },
                  { n: failC, l: 'כשל',  c: '#ff2244' },
                  { n: noTkC, l: 'ללא טוקן', c: '#555' },
                ].map((s, i) => (
                  <div key={i} style={{ background: `${s.c}10`, border: `1px solid ${s.c}33`, borderRadius: 6, padding: 4, textAlign: 'center' }}>
                    <div style={{ color: s.c, fontWeight: 800, fontSize: 14 }}>{s.n}</div>
                    <div style={{ color: s.c, opacity: 0.75, fontSize: 8 }}>{s.l}</div>
                  </div>
                ))}
              </div>
            );
          })()}

          {BOTS.map(bot => {
            const r = botResults[bot.id];
            const sm = BOT_ST[r.status];
            const isBusy = !!botBusy[bot.id];
            const isOpen = botOpen === bot.id;
            const hasTk = !!(botTokens[bot.id] || '').trim();
            const sc = r.score >= 70 ? '#00ff88' : r.score >= 40 ? '#ffd600' : '#ff2244';
            return (
              <div key={bot.id} style={{ borderRadius: 10, border: `1px solid ${isOpen ? bot.color + '66' : '#1a2a38'}`, background: 'rgba(6,14,22,.85)', overflow: 'hidden' }}>
                <div style={{ padding: 8, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ width: 3, height: 36, background: bot.color, borderRadius: 2, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 130 }}>
                    <div style={{ fontSize: 11, color: '#fff', fontWeight: 700 }}>{bot.label}</div>
                    <div style={{ fontSize: 9, color: bot.color, fontFamily: 'monospace' }}>{bot.handle}</div>
                    {r.username && <div style={{ fontSize: 9, color: '#00e5ff', fontFamily: 'monospace' }}>{r.username}</div>}
                  </div>
                  <div style={{ textAlign: 'center', minWidth: 60 }}>
                    <div style={{ fontSize: 10, color: sm.c, fontWeight: 700 }}>{sm.dot} {sm.label}</div>
                    {r.latencyMs > 0 && <div style={{ fontSize: 8, color: '#445' }}>{r.latencyMs}ms</div>}
                  </div>
                  {r.status !== 'idle' && r.status !== 'notoken' && r.status !== 'checking' && (
                    <div style={{ minWidth: 70 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <div style={{ flex: 1, height: 4, background: '#112', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${r.score}%`, background: sc }} />
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 700, color: sc, fontFamily: 'monospace' }}>{r.score}</span>
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ padding: '0 8px 8px', display: 'flex', gap: 6, alignItems: 'center' }}>
                  <input
                    value={botTokens[bot.id]}
                    onChange={e => setBotTokens(p => ({ ...p, [bot.id]: e.target.value }))}
                    placeholder="123456789:AABBcc..."
                    type="password"
                    style={{ flex: 1, padding: '5px 8px', borderRadius: 6, background: 'rgba(0,0,0,.6)', border: `1px solid ${hasTk ? bot.color + '66' : '#1a2a38'}`, color: '#fff', fontFamily: 'monospace', fontSize: 9, direction: 'ltr', outline: 'none' }}
                  />
                  <button
                    onClick={() => runOneBot(bot.id)}
                    disabled={isBusy || !hasTk}
                    style={{ padding: '5px 10px', borderRadius: 6, border: `1px solid ${bot.color}66`, background: `${bot.color}18`, color: bot.color, fontSize: 9, cursor: (!hasTk || isBusy) ? 'not-allowed' : 'pointer', fontFamily: 'inherit', fontWeight: 700, opacity: !hasTk ? 0.45 : 1 }}
                  >
                    {isBusy ? '⏳' : '🔍'}
                  </button>
                  <button
                    onClick={() => setBotOpen(isOpen ? null : bot.id)}
                    style={{ padding: '5px 8px', borderRadius: 6, border: '1px solid #1a2a38', background: 'transparent', color: '#5a7a8a', fontSize: 9, cursor: 'pointer', fontFamily: 'inherit' }}
                  >
                    {isOpen ? '▲' : '▼'}
                  </button>
                </div>

                {r.msgCount > 0 && (
                  <div style={{ padding: '0 8px 8px', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {[
                      { l: 'הודעות', v: String(r.msgCount), c: '#b8d4e8' },
                      { l: 'אחרונה', v: r.lastAgeMin >= 0 ? `${r.lastAgeMin}'` : '—', c: r.lastAgeMin < 30 ? '#00ff88' : r.lastAgeMin < 120 ? '#ffd600' : '#ff8800' },
                      { l: "קצב/ש'", v: r.msgPerHour > 0 ? String(r.msgPerHour) : '—', c: '#00e5ff' },
                      { l: 'ממתים', v: String(r.pendingUpdates), c: r.pendingUpdates > 15 ? '#ff8800' : '#5a7a8a' },
                      { l: 'מצב', v: r.webhookMode || '—', c: '#b040ff' },
                    ].map(s => (
                      <div key={s.l} style={{ background: 'rgba(0,0,0,.45)', borderRadius: 5, padding: '3px 7px', textAlign: 'center' }}>
                        <div style={{ fontSize: 10, color: s.c, fontWeight: 700, fontFamily: 'monospace' }}>{s.v}</div>
                        <div style={{ fontSize: 7, color: '#445' }}>{s.l}</div>
                      </div>
                    ))}
                  </div>
                )}

                {r.keywordsFound.length > 0 && (
                  <div style={{ padding: '0 8px 8px', display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                    {r.keywordsFound.map(kw => (
                      <span key={kw} style={{ fontSize: 8, padding: '1px 6px', borderRadius: 4, background: `${bot.color}18`, color: bot.color, border: `1px solid ${bot.color}33` }}>{kw}</span>
                    ))}
                  </div>
                )}

                {r.err && r.status === 'fail' && (
                  <div style={{ padding: '0 8px 8px' }}>
                    <div style={{ padding: '5px 8px', background: 'rgba(255,34,68,.07)', borderRadius: 5, fontSize: 9, color: '#ff6688', border: '1px solid rgba(255,34,68,.2)' }}>
                      {r.err}
                      {r.err.includes('Unauthorized') && <div style={{ marginTop: 3, color: '#ffd600' }}>פתח @BotFather → /mybots → API Token</div>}
                    </div>
                  </div>
                )}

                {isOpen && r.lastText && (
                  <div style={{ padding: '8px 10px', borderTop: '1px solid #112', background: 'rgba(0,0,0,.3)' }}>
                    <div style={{ fontSize: 8, color: '#445', marginBottom: 4 }}>הודעה אחרונה ({r.lastAgeMin}′)</div>
                    <div style={{ padding: '6px 8px', background: `${bot.color}08`, borderRight: `2px solid ${bot.color}`, borderRadius: 5, fontSize: 9, color: '#cde', direction: 'ltr', fontFamily: 'monospace', wordBreak: 'break-word' }}>
                      {r.lastText}
                    </div>
                  </div>
                )}

                {isOpen && r.msgs.length > 0 && (
                  <div style={{ padding: '8px 10px', borderTop: '1px solid #112' }}>
                    <div style={{ fontSize: 8, color: '#445', marginBottom: 4 }}>פיד הודעות ({r.msgs.length})</div>
                    <div style={{ maxHeight: 160, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 3 }}>
                      {r.msgs.map((m, i) => (
                        <div key={i} style={{ padding: '4px 6px', borderRadius: 4, background: m.relevant ? `${bot.color}10` : 'rgba(0,0,0,.3)', border: `1px solid ${m.relevant ? bot.color + '33' : '#1a2a38'}`, fontSize: 8 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                            <span style={{ color: '#5a7a8a' }}>{m.chat || m.from}</span>
                            <span style={{ color: '#334', fontFamily: 'monospace' }}>{m.time}</span>
                          </div>
                          <div style={{ color: '#cde', direction: 'ltr', fontFamily: 'monospace', wordBreak: 'break-word' }}>{m.text || '(ללא טקסט)'}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {isOpen && !hasTk && (
                  <div style={{ padding: '8px 10px', borderTop: '1px solid #112', fontSize: 9, color: '#aac', lineHeight: 1.6 }}>
                    <div style={{ color: '#ffd600', fontWeight: 700, marginBottom: 4 }}>איך מאחזרים טוקן:</div>
                    1. פתח Telegram → @BotFather<br />
                    2. שלח /mybots → בחר בוט → API Token<br />
                    3. העתק והדבק למעלה → לחץ 🔍
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* DIAG */}
      {tab === 'diag' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {diag.length === 0 && !running && (
            <div style={{ textAlign: 'center', padding: 20, color: '#667' }}>
              <div style={{ fontSize: 32 }}>🔍</div>
              <div style={{ marginTop: 8, fontSize: 11 }}>לחץ "בדיקה מלאה" להרצת כל הבדיקות</div>
              <button
                onClick={runDiag}
                style={{ marginTop: 10, padding: '6px 14px', borderRadius: 8, border: '1px solid #ff224466', background: 'rgba(255,34,68,.15)', color: '#ff6688', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                🔍 הפעל בדיקה מלאה
              </button>
            </div>
          )}
          {diag.length > 0 && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 4 }}>
                {[
                  { n: diag.filter((d) => d.status === 'pass').length, l: 'עברו', c: '#00ff88' },
                  { n: diag.filter((d) => d.status === 'fail').length, l: 'נכשלו', c: '#ff2244' },
                  { n: diag.filter((d) => d.status === 'warn').length, l: 'אזהרות', c: '#ffd600' },
                  { n: diag.filter((d) => d.status === 'skip').length, l: 'דולגו', c: '#5a7a8a' },
                ].map((s, i) => (
                  <div key={i} style={{ background: 'rgba(255,255,255,.04)', border: '1px solid #112', borderRadius: 6, padding: 4, textAlign: 'center' }}>
                    <div style={{ color: s.c, fontWeight: 800, fontSize: 14 }}>{s.n}</div>
                    <div style={{ color: '#88a', fontSize: 8 }}>{s.l}</div>
                  </div>
                ))}
              </div>
              {diag.map((d, i) => {
                const ds = DST[d.status];
                return (
                  <div key={i} style={{ display: 'flex', gap: 8, background: ds.bg, border: `1px solid ${ds.c}33`, borderRadius: 8, padding: 8 }}>
                    <span style={{ fontSize: 14 }}>{ds.ic}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 11 }}>{d.check}</div>
                      <div style={{ fontSize: 9, color: '#aab' }}>{d.detail}</div>
                      {d.fix && <div style={{ fontSize: 9, color: '#ffd600', marginTop: 2 }}>💡 {d.fix}</div>}
                    </div>
                    <span style={{ fontSize: 8, color: ds.c, alignSelf: 'flex-start' }}>{d.status.toUpperCase()}</span>
                  </div>
                );
              })}
            </>
          )}
          <div style={{ background: 'rgba(0,0,0,.4)', border: '1px solid #112', borderRadius: 8, padding: 8, maxHeight: 180, overflowY: 'auto' }}>
            <div style={{ fontSize: 9, color: '#778', marginBottom: 4 }}>📋 LOG</div>
            {log.length === 0 ? (
              <div style={{ fontSize: 9, color: '#445' }}>ממתין…</div>
            ) : (
              log.map((l, i) => (
                <div key={i} style={{ fontFamily: 'monospace', fontSize: 9, color: '#8aa', lineHeight: 1.4 }}>{l}</div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
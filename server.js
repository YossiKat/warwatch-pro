/**
 * ═══════════════════════════════════════════════════════════
 *  EWS MISSION CONTROL — server.js
 *  מיקום: ~/Desktop/ews/server.js
 *
 *  הפעלה: node server.js
 *
 *  מקורות:
 *  ✅ OREF פיקוד העורף  (כל 8s)
 *  ✅ צופר tzevaadom    (כל 10s)
 *  ✅ 7 RSS ערוצים      (כל 60s)
 *  ✅ Telegram channels  (כל 15s — קנאלים פומביים)
 *  ✅ AI ניתוח           (Anthropic — כל 90s)
 *  ✅ WebSocket push     (מיידי לכל לקוחות)
 *  ✅ Telegram Bot       (פקודות: /status /news /ask)
 * ═══════════════════════════════════════════════════════════
 */
'use strict';
require('dotenv').config();

const http   = require('http');
const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const os     = require('os');
const cp     = require('child_process');

// ── CONFIG ────────────────────────────────────────────────────
const PORT    = parseInt(process.env.PORT) || 3000;
// ════════════════════════════════════════════════════
// MULTI-BOT CONFIGURATION — 3 בוטים
// ════════════════════════════════════════════════════
// Bot 1: יוסי חמל אדום (ביטחוני/חירום)

// ═══════════════════════════════════════════════════════════════
// PRODUCTION SETUP — CORS + STATIC FILES + RAILWAY/NGROK
// ═══════════════════════════════════════════════════════════════

// Allow friends to access from Lovable + any origin
function addCORSHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}


// ════════════════════════════════════════════════════════════
// AUTH SYSTEM — Registration + Auto-login
// Simple token-based: no DB needed, stores in memory + .env
// ════════════════════════════════════════════════════════════
// Allowed users — loaded from env or created on first registration
let USERS = {}; // { token: { name, phone, role, createdAt, lastSeen } }

// Admin tokens from env (pre-approved)
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || crypto.randomBytes(16).toString('hex');
if (process.env.ADMIN_TOKEN) {
  USERS[ADMIN_TOKEN] = { name:'Admin', role:'admin', createdAt:Date.now(), lastSeen:null };
  log('🔐 Admin token loaded from .env');
} else {
  USERS[ADMIN_TOKEN] = { name:'Admin', role:'admin', createdAt:Date.now(), lastSeen:null };
  log('🔐 Admin token (save to .env): ADMIN_TOKEN=' + ADMIN_TOKEN);
}

// Registration requires invite code (set in .env)
const INVITE_CODE = process.env.INVITE_CODE || 'warwatch2025';

function generateToken() {
  return crypto.randomBytes(24).toString('base64url');
}

function validateToken(req) {
  const auth  = req.headers['authorization'] || '';
  const query = new URL('http://x' + req.url).searchParams.get('token') || '';
  const token = auth.replace('Bearer ', '').trim() || query;
  if (!token) return null;
  const user  = USERS[token];
  if (!user)   return null;
  user.lastSeen = Date.now();
  return { ...user, token };
}

function requireAuth(req, res) {
  const user = validateToken(req);
  if (!user) {
    res.writeHead(401, { 'Content-Type':'application/json', ...corsHeaders() });
    res.end(JSON.stringify({ error:'Unauthorized', code:401 }));
    return null;
  }
  return user;
}

// ── Auth API Endpoints ────────────────────────────────────────
function handleAuth(url, req, res) {
  const body = [];
  req.on('data', chunk => body.push(chunk));
  req.on('end', () => {
    let data = {};
    try { data = JSON.parse(Buffer.concat(body).toString()); } catch {}

    // POST /auth/register — first-time registration
    if (url === '/auth/register' && req.method === 'POST') {
      const { name, phone, invite } = data;
      if (!name || name.length < 2) {
        sendJSON(400, { error:'שם נדרש (לפחות 2 תווים)' }); return;
      }
      if (!invite || invite.trim() !== INVITE_CODE) {
        sendJSON(403, { error:'קוד הזמנה שגוי' }); return;
      }
      const token = generateToken();
      USERS[token] = {
        name: name.trim().slice(0, 30),
        phone: (phone || '').slice(0, 15),
        role: 'viewer',
        createdAt: Date.now(),
        lastSeen: Date.now(),
      };
      log('🔐 New user: ' + name + ' (' + (phone || 'no phone') + ')');
      sendJSON(200, { token, user: USERS[token] });
      return;
    }

    // POST /auth/login — validate existing token
    if (url === '/auth/login' && req.method === 'POST') {
      const { token } = data;
      if (!token || !USERS[token]) {
        sendJSON(401, { error:'Token לא תקין — הירשם שוב' }); return;
      }
      USERS[token].lastSeen = Date.now();
      sendJSON(200, { user: USERS[token], token });
      return;
    }

    // GET /auth/me — check current token
    if (url === '/auth/me' && req.method === 'GET') {
      const user = validateToken(req);
      if (!user) { sendJSON(401, { error:'לא מחובר' }); return; }
      sendJSON(200, { user, ts: Date.now() });
      return;
    }

    // GET /auth/users — admin only
    if (url === '/auth/users') {
      const user = validateToken(req);
      if (!user || user.role !== 'admin') { sendJSON(403, { error:'Admin only' }); return; }
      sendJSON(200, {
        users: Object.entries(USERS).map(([tok, u]) => ({
          token: tok.slice(0, 8) + '...',
          name: u.name, role: u.role,
          lastSeen: u.lastSeen ? new Date(u.lastSeen).toLocaleString('he-IL') : 'never',
        })),
        total: Object.keys(USERS).length,
      });
      return;
    }

    sendJSON(404, { error: 'Not found' });
  });
}

// Serve static files from current directory
function serveStatic(req, res) {
  const path = require('path');
  const fs   = require('fs');
  const ext  = req.url.split('.').pop().toLowerCase();
  const mime = {
    html:'text/html', js:'application/javascript',
    css:'text/css', json:'application/json',
    ico:'image/x-icon', png:'image/png',
  };
  // Map / to warwatch.html or index.html
  let filePath = req.url === '/' ? '/warwatch.html' : req.url;
  if (!path.extname(filePath)) filePath += '.html';
  const fullPath = path.join(__dirname, filePath);
  if (fs.existsSync(fullPath)) {
    const ct = mime[ext] || 'text/plain';
    res.writeHead(200, { 'Content-Type': ct, ...corsHeaders() });
    fs.createReadStream(fullPath).pipe(res);
    return true;
  }
  return false;
}
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

const TG_RED   = (process.env.TG_BOT_RED   || process.env.TELEGRAM_BOT_TOKEN || '').trim();
// Bot 2: יוסי חמל כלכלה
const TG_ECON  = (process.env.TG_BOT_ECON  || '').trim();
// Bot 3: בוט כחול (מידע כללי)
const TG_BLUE  = (process.env.TG_BOT_BLUE  || '').trim();

// Primary bot (backwards compat)
const TG       = TG_RED;
const AI_KEY   = (process.env.ANTHROPIC_API_KEY || '').trim();

// Bot metadata
const BOTS = [
  { id:'red',  token:TG_RED,  name:'יוסי חמל אדום 🔴', emoji:'🔴', type:'security', priority:10, active:!!TG_RED  },
  { id:'econ', token:TG_ECON, name:'יוסי חמל כלכלה 💰', emoji:'💰', type:'economy',  priority:5,  active:!!TG_ECON },
  { id:'blue', token:TG_BLUE, name:'בוט כחול 🔵',         emoji:'🔵', type:'general',  priority:3,  active:!!TG_BLUE },
].filter(b => b.token);

const hasTG    = BOTS.length > 0 || !!TG_RED;

// קנאלי טלגרם שמנוטרים (הוסף/הסר לפי הצורך)
// ── קנאלי טלגרם למעקב ──────────────────────────────────────
// הבוט @yossikat_bat חייב להיות member (הוסף/עקוב אחרי כל קנאל)
// username בלבד — הבוט ימשוך chatId בהפעלה
// ════════════════════════════════════════════════════
// CHANNEL LISTS PER BOT
// ════════════════════════════════════════════════════

// 🔴 יוסי חמל אדום — ביטחוני/חירום ONLY
const CHANNELS_RED = [
  '@PikudHaOref_all',      // פיקוד העורף 🚨 PRIORITY
  '@pikud_haoref_alerts',
  '@iooopooor',            // ביטחוני מהיר
  '@kavhamilhama',         // קו המלחמה
  '@Hadashot_Bitachon',
  '@hadashotbithoniot',
  '@realtimesecurity2',
  '@flashnewsssss',        // פלאש ⚡
  '@Tisraelnewss',
  '@divuchimbizmanemet',
  '@ynetalerts',
  '@amitseg',
  '@mdais_updates',        // מד"א
  '@hatzalah_news',        // איחוד הצלה
  '@fire_department_il',   // כיבוי אש
  '@mda_israel',
];

// 💰 יוסי חמל כלכלה — כלכלה ושוק הון
const CHANNELS_ECON = [
  '@globescreener',        // גלובס סורק
  '@ynet_econews',         // ynet כלכלה
  '@calcalist_il',         // כלכליסט
  '@maariv_business',      // מעריב כלכלה
  '@themarker_il',         // TheMarker
  '@bizportal_alerts',     // ביזפורטל
  '@nasdaq_alerts',        // NASDAQ עדכונים
  '@oil_gas_news',         // נפט וגז
  '@crypto_hebrew',        // קריפטו עברית
  '@shekel_dollar',        // שקל/דולר
  '@boi_israel',           // בנק ישראל
  '@mof_israel',           // משרד אוצר
];

// 🔵 בוט כחול — מידע כללי
const CHANNELS_BLUE = [
  '@news_il',              // ישראל ניוז
  '@FoxNewsChannel',
  '@CNN_International',
  '@BBCBreaking',
  '@reuters_israel',
  '@timesofisrael',
  '@haaretz_breaking',
  '@ynet_breaking',
  '@kan_news',             // כאן חדשות
  '@mako_news',            // מאקו
  '@channel12news',        // ערוץ 12
  '@channel13news',        // ערוץ 13
];

// All channels combined (for single-bot mode)
const TG_CHANNELS_LIST = [
  ...CHANNELS_RED,
  ...CHANNELS_ECON.slice(0,4),  // economy headlines
  ...CHANNELS_BLUE.slice(0,4),  // general news
];

// ── OREF OFFICIAL CHANNEL ID ──────────────────────────────────
// @PikudHaOref_all = -1001234567890 (יזוהה אוטומטית)
const OREF_PRIORITY_CHANNELS = ['@PikudHaOref_all','@pikud_haoref_alerts'];

const TG_CHANNELS = []; // chat IDs — resolved at runtime

// ── FIRST-MESSAGE DEDUP ──────────────────────────────────────
// מניעת כפילויות: רק ההודעה הראשונה על כל נושא מוצגת
// מנגנון: hash של תוכן ≥80% זהה = כפילות
const contentHashes  = new Map(); // hash → timestamp
const DEDUP_WINDOW   = 300000;    // 5 דקות — חלון זמן לזיהוי כפילויות
const DEDUP_THRESH   = 0.80;      // 80% דמיון = כפילות

function textFingerprint(text) {
  // Normalize: lowercase, remove punctuation, keep words only
  return (text || '').toLowerCase()
    .replace(/[^א-תa-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(w => w.length > 2)
    .sort()
    .join('|');
}

function isDuplicate(text) {
  const fp = textFingerprint(text);
  const words = new Set(fp.split('|'));
  const now = Date.now();

  // Clean old entries
  for (const [key, ts] of contentHashes) {
    if (now - ts > DEDUP_WINDOW) contentHashes.delete(key);
  }

  // Check similarity against recent fingerprints
  for (const [existingFP, ts] of contentHashes) {
    if (now - ts > DEDUP_WINDOW) continue;
    const existingWords = new Set(existingFP.split('|'));
    const intersection = new Set([...words].filter(w => existingWords.has(w)));
    const union = new Set([...words, ...existingWords]);
    const similarity = union.size > 0 ? intersection.size / union.size : 0;
    if (similarity >= DEDUP_THRESH) return true;
  }

  // Not a duplicate — register fingerprint
  contentHashes.set(fp, now);
  return false;
}

// ── CHANNEL ID RESOLVER ──────────────────────────────────────
async function resolveChannelIds() {
  if (!hasTG) return;
  let resolved=0;
  for (const username of TG_CHANNELS_LIST) {
    try {
      // Try getChat — works for public channels even without membership
      const r = await tgRequest('getChat', { chat_id: username });
      if (r?.ok && r.result?.id) {
        const id = r.result.id;
        if (!TG_CHANNELS.includes(id)) { TG_CHANNELS.push(id); resolved++; }
      } else {
        // Channel not accessible — add as string for direct matching
        if(!TG_CHANNELS.includes(username)) TG_CHANNELS.push(username);
      }
    } catch { }
    await new Promise(r => setTimeout(r, 200));
  }
  log(`📡 Channels: ${resolved} resolved, ${TG_CHANNELS_LIST.length} configured`);
  log(`📡 הבוט מקבל הודעות מכל קנאל שהוא חבר בו`);
  log(`📡 כדי לקבל הודעות: הוסף את הבוט כ-Admin בכל קנאל`);
}

const hasAI = AI_KEY.length > 30;

// ── HTTP HELPER ───────────────────────────────────────────────
function httpFetch(url, opts = {}, timeout = 10000) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const mod = u.protocol === 'https:' ? https : http;
      const bodyBuf = opts.body ? Buffer.from(opts.body, 'utf8') : null;
      const options = {
        hostname : u.hostname,
        port     : u.port || (u.protocol === 'https:' ? 443 : 80),
        path     : u.pathname + u.search,
        method   : opts.method || 'GET',
        timeout,
        headers  : {
          'User-Agent'   : 'EWS/3.0',
          'Accept'       : '*/*',
          'Content-Type' : 'application/json',
          ...(opts.headers || {}),
          ...(bodyBuf ? { 'Content-Length': bodyBuf.length } : {}),
        },
      };
      const req = mod.request(options, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end',  () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
      });
      req.on('error',   err => reject(err));
      req.on('timeout', ()  => { req.destroy(); reject(new Error('timeout')); });
      if (bodyBuf) req.write(bodyBuf);
      req.end();
    } catch(e) { reject(e); }
  });
}

// ── RSS PARSER ────────────────────────────────────────────────
function parseRSS(xml) {
  const items = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const b = m[1];
    const g = tag => {
      const r = new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i');
      return (r.exec(b)?.[1] || '').replace(/<[^>]+>/g, '').trim();
    };
    items.push({
      title      : g('title'),
      link       : g('link'),
      pubDate    : g('pubDate'),
      guid       : g('guid') || g('link') || g('title'),
      description: g('description').slice(0, 400),
    });
  }
  return items;
}

// ── STATE ─────────────────────────────────────────────────────
let orefActive   = null;
let orefHistory  = [];
let tzActive     = null;
let rssItems     = [];
let tgMessages   = [];   // הודעות מקנאלי טלגרם
let aiAnalysis   = null; // ניתוח AI אחרון
let tgOffset     = 0;
let tgChatSet    = new Set(TG_CHANNELS);  // כל ה-chat IDs הידועים

const seenGuids  = new Set();
const seenTgMsgs = new Set();
const clients    = new Set();

// ── KEYWORDS ──────────────────────────────────────────────────
const KW_RELEVANT = [
  'israel','gaza','hamas','hezbollah','iran','idf','houthi','missile',
  'rocket','attack','strike','explosion','siren','alert','ballistic',
  'ישראל','עזה','חמאס','חיזבאללה','איראן','צה"ל','טיל','רקטה',
  'אזעקה','ירי','תקיפה','פיצוץ','צבע אדום','כוננות','שיגור',
  'נפילה','נפל','מד"א','כבאים','חילוץ','כוחות','פינוי','פצוע','הרוג',
];

// ── IMPACT KEYWORDS ────────────────────────────────────────────
const KW_IMPACT=[
  'נפל','נפילה','פגיעה ב','פגע','פיצוץ','רסיסים','שבר','אש','שריפה',
  'impact','explosion','shrapnel','hit','direct hit','fallen',
];
const KW_RESCUE=[
  'מד"א','אמבולנס','אמבולנסים','כבאים','כיבוי אש','חילוץ','פינוי','הצלה','נט"ן',
  'ambulance','rescue','firefighter','paramedic','first aid',
];
const KW_FORCES=[
  'כוחות גדולים','כוחות רבים','מספר כוחות','ריכוז','פריסה','כוחות ביטחון',
  'large forces','concentration','deployment','security forces',
];
const KW_VIDEO=['וידאו','צילום','תמונה','סרטון','video','footage','photo','pic','clip'];

const isImpact  = t => KW_IMPACT.some(k=>(t||'').toLowerCase().includes(k));
const isRescue  = t => KW_RESCUE.some(k=>(t||'').toLowerCase().includes(k));
const isForces  = t => KW_FORCES.some(k=>(t||'').toLowerCase().includes(k));
const hasMedia  = t => KW_VIDEO.some(k=>(t||'').toLowerCase().includes(k));
const isRelevant= t => KW_RELEVANT.some(k=>(t||'').toLowerCase().includes(k));

// ── CITY COORDINATE MAP ────────────────────────────────────────
const CITY_COORDS={
  'תל אביב':{lat:32.07,lng:34.79},'ת"א':{lat:32.07,lng:34.79},'יפו':{lat:32.05,lng:34.75},
  'בני ברק':{lat:32.08,lng:34.83},'פתח תקווה':{lat:32.09,lng:34.89},
  'חולון':{lat:32.01,lng:34.78},'בת-ים':{lat:32.02,lng:34.75},
  'ראשון לציון':{lat:31.97,lng:34.80},'רחובות':{lat:31.90,lng:34.81},
  'ירושלים':{lat:31.77,lng:35.22},'ירושלים':{lat:31.77,lng:35.22},
  'חיפה':{lat:32.82,lng:35.00},'נהריה':{lat:33.00,lng:35.10},
  'עכו':{lat:32.93,lng:35.08},'צפת':{lat:32.96,lng:35.50},
  'קריית שמונה':{lat:33.21,lng:35.57},'מטולה':{lat:33.27,lng:35.57},
  'שלומי':{lat:33.07,lng:35.14},'נתניה':{lat:32.33,lng:34.86},
  'אשדוד':{lat:31.80,lng:34.65},'אשקלון':{lat:31.67,lng:34.57},
  'שדרות':{lat:31.52,lng:34.60},'נתיבות':{lat:31.42,lng:34.59},
  'באר שבע':{lat:31.25,lng:34.80},'אילת':{lat:29.56,lng:34.95},
  'כפר עזה':{lat:31.47,lng:34.53},'ניר עוז':{lat:31.36,lng:34.47},
  'בארי':{lat:31.40,lng:34.49},'רעים':{lat:31.44,lng:34.52},
  'קריית גת':{lat:31.61,lng:34.77},'לוד':{lat:31.95,lng:34.90},
  'רמלה':{lat:31.93,lng:34.88},'מודיעין':{lat:31.90,lng:35.01},
  'טבריה':{lat:32.79,lng:35.53},'כרמיאל':{lat:32.92,lng:35.30},
  'אופקים':{lat:31.31,lng:34.62},'דימונה':{lat:31.07,lng:35.03},
};

function extractCity(text){
  if(!text)return null;
  for(const[city,coords]of Object.entries(CITY_COORDS)){
    if(text.includes(city))return{city,...coords};
  }
  // Partial match (3+ chars)
  for(const[city,coords]of Object.entries(CITY_COORDS)){
    if(city.length>=4&&text.includes(city.slice(0,4)))return{city,...coords};
  }
  return null;
}

// ── HEAT SCORE ─────────────────────────────────────────────────
function calcHeat(text,src='rss'){
  let s=0;const l=(text||'').toLowerCase();
  if(isImpact(l))s+=25;if(isRescue(l))s+=20;if(isForces(l))s+=15;
  if(l.includes('קשה')||l.includes('critical'))s+=20;
  if(l.includes('הרוג')||l.includes('killed'))s+=30;
  if(l.includes('פצוע')||l.includes('wounded'))s+=15;
  if(l.includes('אזעקה'))s+=15;if(l.includes('שיגור'))s+=20;
  if(['oref','idf'].includes(src))s+=30;
  return s;
}
function severityOf(text){
  const l=(text||'').toLowerCase();
  return /rocket|missile|killed|explosion|attack|אזעקה|ירי|שיגור|הרוג|נפילה/.test(l)?'critical':
    /alert|warning|launch|כוננות|אזהרה|פצוע/.test(l)?'high':'medium';
}

// ── RESCUE FORCE CONCENTRATION ─────────────────────────────────
// Track rescue/security force mentions per city
const FORCE_MAP={}; // city → {count, lastSeen, sources}
const FORCE_ALERT_THRESHOLD=3; // 3+ mentions = alert
const FORCE_WINDOW=1800000;    // 30 minutes

function trackForces(text,source,ts=Date.now()){
  if(!isRescue(text)&&!isForces(text))return null;
  const loc=extractCity(text);if(!loc)return null;
  const city=loc.city;
  if(!FORCE_MAP[city])FORCE_MAP[city]={count:0,firstSeen:ts,lastSeen:ts,sources:[],lat:loc.lat,lng:loc.lng};
  const fm=FORCE_MAP[city];
  fm.count++;fm.lastSeen=ts;fm.sources.push(source);
  // Clean stale entries
  Object.keys(FORCE_MAP).forEach(c=>{if(ts-FORCE_MAP[c].lastSeen>FORCE_WINDOW)delete FORCE_MAP[c];});
  if(fm.count>=FORCE_ALERT_THRESHOLD){
    return{city,lat:loc.lat,lng:loc.lng,count:fm.count,window:'30min',sources:[...new Set(fm.sources)]};
  }
  return null;
}

// ── WEBSOCKET ─────────────────────────────────────────────────
function wsHandshake(req, socket) {
  const key    = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
}

function wsSend(socket, data) {
  try {
    const buf  = Buffer.from(JSON.stringify(data), 'utf8');
    const len  = buf.length;
    const head = len < 126
      ? Buffer.from([0x81, len])
      : Buffer.from([0x81, 126, (len >> 8) & 0xff, len & 0xff]);
    socket.write(Buffer.concat([head, buf]));
  } catch { /* client gone */ }
}

function broadcast(data) {
  clients.forEach(s => wsSend(s, data));
}

// ── LOG ───────────────────────────────────────────────────────
function log(msg) {
  const t = new Date().toLocaleTimeString('he-IL', { hour12: false });
  console.log(`[${t}] ${msg}`);
}

// ═══════════════════════════════════════════════════════════════
// OREF — כל 8 שניות
// ═══════════════════════════════════════════════════════════════
// OREF connection stats
let orefStats = { ok:0, fail:0, lastOk:null, lastFail:null, lastStatus:null };


// ════════════════════════════════════════════════════════════
// TELEGRAM USER API — גישה לקבוצות אישיות
// להפעלה: הוסף ל-.env:
//   TG_API_ID=12345678
//   TG_API_HASH=abcdef1234567890abcdef
//   TG_PHONE=+972501234567
//
// קבל API_ID + API_HASH מ: https://my.telegram.org/apps
// ════════════════════════════════════════════════════════════
const USER_API_ID   = process.env.TG_API_ID   || '';
const USER_API_HASH = process.env.TG_API_HASH || '';
const USER_PHONE    = process.env.TG_PHONE    || '';

let gramjsClient = null;
let userGroups   = [];

async function initUserAPI() {
  if(!USER_API_ID || !USER_API_HASH || !USER_PHONE){
    log('ℹ️  Telegram User API לא מוגדר (.env: TG_API_ID, TG_API_HASH, TG_PHONE)');
    return;
  }
  try {
    // Try to load telegram (gramjs)
    const { TelegramClient, StringSession } = require('telegram');
    const session = new StringSession(process.env.TG_SESSION || '');
    gramjsClient = new TelegramClient(session, parseInt(USER_API_ID), USER_API_HASH, {
      connectionRetries: 5,
      useWSS: false,
    });
    await gramjsClient.connect();
    if(!await gramjsClient.isUserAuthorized()){
      log('📱 Telegram User: יש להתחבר ראשית — הרץ: node tg_login.js');
      gramjsClient = null;
      return;
    }
    log('✅ Telegram User API מחובר');
    // Fetch personal dialogs (groups + channels)
    const dialogs = await gramjsClient.getDialogs({limit:50});
    userGroups = dialogs.map(d => ({
      id:   d.id?.toString(),
      name: d.title || d.name || 'Unknown',
      type: d.isChannel?'channel':d.isGroup?'group':'private',
    }));
    log(`📡 קבוצות אישיות: ${userGroups.length}`);
    userGroups.forEach(g => log(`  → [${g.type}] ${g.name}`));

    // Add to TG_CHANNELS
    userGroups.forEach(g => {
      if(!TG_CHANNELS.includes(parseInt(g.id))) TG_CHANNELS.push(parseInt(g.id));
    });

    // Start listening to new messages
    gramjsClient.addEventHandler(async (event) => {
      const msg = event.message;
      if(!msg?.text || msg.text.length < 10) return;
      const chatId = msg.peerId?.channelId || msg.peerId?.chatId || 0;
      const chatName = userGroups.find(g => g.id === chatId?.toString())?.name || String(chatId);
      const text = msg.text;
      if(!isRelevant(text)) return;
      if(isDuplicate(text)) return;
      const heat = calcHeat(text,'tg');
      const loc  = extractCity(text);
      const item = {
        id: `tg_user:${chatId}:${msg.id}`,
        chatId, chatName, text: text.slice(0,600),
        timestamp: (msg.date||0)*1000,
        severity: severityOf(text),
        heat, hasImpact:isImpact(text), hasRescue:isRescue(text),
        hasVideo: !!(msg.media), hasForces:isForces(text),
        impactCity:loc?.city||null, impactLat:loc?.lat||null, impactLng:loc?.lng||null,
        fromUserAPI: true,
      };
      tgMessages.unshift(item);
      if(tgMessages.length>200) tgMessages=tgMessages.slice(0,200);
      broadcast({type:'TG_MESSAGE',payload:item});
      log(`💬 USER [${chatName}] 🔥${heat} ${text.slice(0,50)}`);
      // Force/impact tracking
      if(item.hasImpact&&loc) broadcast({type:'IMPACT_EVENT',payload:{...loc,text:text.slice(0,200),source:'tg:'+chatName,timestamp:item.timestamp}});
      trackForces(text,chatName,item.timestamp);
    }, new (require('telegram/events').NewMessage)({}));

  } catch(e) {
    log(`⚠️  Telegram User API שגיאה: ${e.message.slice(0,60)}`);
    log('💡 התקן: cd ~/Desktop/ews && npm install telegram');
  }
}

async function pollOref() {
  const OREF_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': 'https://www.oref.org.il/heb/alerts-history/',
    'X-Requested-With': 'XMLHttpRequest',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'he-IL,he;q=0.9,en-US;q=0.8,en;q=0.7',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  };
  try {
    const { status, body } = await httpFetch(
      'https://www.oref.org.il/WarningMessages/alert/alerts.json',
      { headers: OREF_HEADERS }, 7000
    );
    orefStats.lastStatus = status;
    if (status !== 200) {
      orefStats.fail++; orefStats.lastFail = new Date().toISOString();
      log(`⚠️  OREF HTTP ${status}`); return;
    }
    orefStats.ok++; orefStats.lastOk = new Date().toISOString();

    if (!body || !body.trim()) {
      // שגרה
      if (orefActive) { orefActive = null; broadcast({ type: 'OREF_CLEAR' }); log('✅ OREF שוחרר'); }
      return;
    }

    const d = JSON.parse(body);
    if (d?.data?.length > 0) {
      const key = `${d.title}:${d.data.slice(0, 6).join(',')}`;
      if (key !== orefActive?.key) {
        orefActive = { ...d, key, ts: Date.now() };
        broadcast({ type: 'OREF_ALERT', payload: orefActive });
        log(`🚨 OREF: ${d.title} — ${d.data.slice(0, 4).join(', ')}`);
        tgNotify(`🚨 *פיקוד העורף — צבע אדום*\n${d.title}\n📍 ${d.data.slice(0, 8).join(' · ')}`);
      }
    } else {
      if (orefActive) {
        orefActive = null;
        broadcast({ type: 'OREF_CLEAR' });
        log('✅ OREF שוחרר — שגרה');
        tgNotify('✅ *שגרה — OREF* — כל האזורים שוחררו');
      }
    }
  } catch(e) {
    orefStats.fail++; orefStats.lastFail = new Date().toISOString();
    log(`⚠️  OREF poll error: ${e.message.slice(0,50)}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// TZOFAR — כל 10 שניות
// ═══════════════════════════════════════════════════════════════
async function pollTzofar() {
  const endpoints = [
    'https://api.tzevaadom.co.il/alerts',
    'https://www.tzevaadom.co.il/alerts.php',
  ];
  for (const url of endpoints) {
    try {
      const { status, body } = await httpFetch(url, { headers: { Accept: 'application/json' } }, 7000);
      if (status !== 200 || !body?.trim()) continue;
      const d = JSON.parse(body);
      const areas = Array.isArray(d) ? d : (d.alerts || d.data || []);
      if (areas.length > 0) {
        const key = areas.slice(0, 6).join(',');
        if (key !== tzActive?.key) {
          tzActive = { areas, key, ts: Date.now() };
          broadcast({ type: 'TZOFAR_ALERT', payload: tzActive });
          log(`🔴 צופר: ${areas.slice(0, 5).join(' · ')}`);
          tgNotify(`🔴 *צופר — אזעקה*\n📍 ${areas.slice(0, 8).join(' · ')}`);
        }
      } else if (tzActive) {
        tzActive = null;
        broadcast({ type: 'TZOFAR_CLEAR' });
      }
      return;
    } catch { continue; }
  }
}

// ═══════════════════════════════════════════════════════════════
// OREF HISTORY — כל 2 דקות
// ═══════════════════════════════════════════════════════════════
async function pollOrefHistory() {
  try {
    const { status, body } = await httpFetch(
      'https://www.oref.org.il/WarningMessages/History/AlertsHistory.json',
      { headers: { 'Referer': 'https://www.oref.org.il/', 'X-Requested-With': 'XMLHttpRequest' } }
    );
    if (status !== 200) return;
    const d = JSON.parse(body);
    if (Array.isArray(d) && d.length) {
      orefHistory = d.slice(0, 20);
      broadcast({ type: 'OREF_HISTORY', payload: orefHistory });
    }
  } catch { }
}

// ═══════════════════════════════════════════════════════════════
// RSS FEEDS — 7 ערוצים במקביל, כל 60s
// ═══════════════════════════════════════════════════════════════
const RSS_FEEDS = [
  { id: 'toi',    url: 'https://www.timesofisrael.com/feed/' },
  { id: 'jpost',  url: 'https://www.jpost.com/rss/rssfeedsfrontpage.aspx' },
  { id: 'ynet',   url: 'https://www.ynet.co.il/Integration/StoryRss2.xml' },
  { id: 'bbc',    url: 'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml' },
  { id: 'alj',    url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { id: 'idf',    url: 'https://www.idf.il/en/minisites/press-releases/rss.xml' },
  { id: 'reuters',url: 'https://feeds.reuters.com/reuters/topNews' },
];

async function pollOneFeed(feed) {
  try {
    const { status, body } = await httpFetch(feed.url, {}, 12000);
    if (status !== 200) return 0;
    const items = parseRSS(body);
    let n = 0;
    for (const it of items) {
      if (!isRelevant(`${it.title} ${it.description}`)) continue;
      const key = `${feed.id}:${(it.guid || it.title || '').slice(0, 60)}`;
      if (seenGuids.has(key)) continue;
      seenGuids.add(key);
      const alert = {
        id          : key,
        title       : it.title,
        body        : it.description,
        source      : feed.id,
        severity    : severityOf(it.title + ' ' + it.description),
        earlyWarning: false,
        link        : it.link,
        timestamp   : new Date(it.pubDate || Date.now()).getTime() || Date.now(),
        affectedRegions: [],
      };
      rssItems.unshift(alert);
      if (rssItems.length > 400) rssItems = rssItems.slice(0, 400);
      broadcast({ type: 'NEW_ALERT', payload: alert });
      n++;
    }
    return n;
  } catch { return 0; }
}

async function pollAllRSS() {
  const results = await Promise.allSettled(RSS_FEEDS.map(f => pollOneFeed(f)));
  const total = results.reduce((s, r) => s + (r.value || 0), 0);
  if (total > 0) log(`RSS: +${total} ידיעות`);
}

// ═══════════════════════════════════════════════════════════════
// TELEGRAM — קריאת הודעות מקנאלים + bot commands
// ═══════════════════════════════════════════════════════════════
async function tgRequest(method, body = {}) {
  if (!hasTG) return null;
  try {
    const { status, body: resp } = await httpFetch(
      `https://api.telegram.org/bot${TG}/${method}`,
      { method: 'POST', body: JSON.stringify(body) },
      15000
    );
    return JSON.parse(resp);
  } catch { return null; }
}

// שלח הודעה לכל ה-chats הידועים
async function tgNotify(text) {
  if (!hasTG || tgChatSet.size === 0) return;
  for (const chatId of tgChatSet) {
    await tgRequest('sendMessage', { chat_id: chatId, text, parse_mode: 'Markdown' });
  }
}

// טפל בפקודת בוט
async function tgHandleCommand(chatId, text, fromUsername) {
  const parts = text.trim().split(/\s+/);
  const cmd   = parts[0].toLowerCase().replace('@' + (tgBotUsername || ''), '');
  const arg   = parts.slice(1).join(' ');
  log(`TG @${fromUsername}: ${text.slice(0, 50)}`);

  switch (cmd) {
    case '/start':
    case '/help':
    case '/עזרה':
      await tgRequest('sendMessage', { chat_id: chatId, parse_mode: 'Markdown', text:
        '⚡ *EWS Mission Control*\n\n' +
        '🚨 */oref* — אזעקות פעילות עכשיו\n' +
        '📋 */history* — 5 אזעקות אחרונות\n' +
        '📰 */news* — חדשות דחופות\n' +
        '📡 */status* — מצב המערכת\n' +
        '🗺 */north* — מצב הצפון\n' +
        '🗺 */south* — מצב הדרום\n' +
        '🇮🇷 */iran* — עדכוני איראן\n' +
        '✈️ */houthi* — עדכוני חות\'יים\n' +
        '🤖 */ask [שאלה]* — שאל AI\n\n' +
        'הבוט שולח התראות אוטומטיות על אזעקות.'
      });
      break;

    case '/oref':
    case '/אזעקות':
      if (orefActive) {
        await tgRequest('sendMessage', { chat_id: chatId, parse_mode: 'Markdown', text:
          `🚨 *אזעקה פעילה — ${orefActive.title}*\n📍 ${(orefActive.data || []).join(' · ')}`
        });
      } else {
        await tgRequest('sendMessage', { chat_id: chatId, text: '✅ אין אזעקות פעילות כרגע.' });
      }
      break;

    case '/history':
    case '/היסטוריה':
      if (!orefHistory.length) { await tgRequest('sendMessage', { chat_id: chatId, text: 'אין היסטוריה.' }); break; }
      const hist = orefHistory.slice(0, 5).map(h => `• ${(h.alertDate || '').slice(0, 16)} — ${h.title}`).join('\n');
      await tgRequest('sendMessage', { chat_id: chatId, parse_mode: 'Markdown', text: `📋 *היסטוריית OREF*\n\n${hist}` });
      break;

    case '/news':
    case '/חדשות':
      const top = rssItems.filter(a => a.severity === 'critical' || a.severity === 'high').slice(0, 5);
      if (!top.length) { await tgRequest('sendMessage', { chat_id: chatId, text: 'אין חדשות דחופות כרגע.' }); break; }
      const newsText = top.map((a, i) => `${i + 1}. ${a.title.slice(0, 80)}`).join('\n\n');
      await tgRequest('sendMessage', { chat_id: chatId, parse_mode: 'Markdown', text: `📰 *חדשות דחופות*\n\n${newsText}` });
      break;

    case '/status':
    case '/מצב':
      await tgRequest('sendMessage', { chat_id: chatId, parse_mode: 'Markdown', text:
        `📡 *EWS Status*\n` +
        `🕐 ${new Date().toLocaleTimeString('he-IL')}\n` +
        `🚨 OREF: ${orefActive ? '🔴 *' + orefActive.title + '*' : '✅ שגרה'}\n` +
        `🔴 צופר: ${tzActive ? '🔴 *' + (tzActive.areas || []).slice(0, 3).join(', ') + '*' : '✅ שגרה'}\n` +
        `📰 RSS: ${rssItems.length} ידיעות\n` +
        `💬 TG messages: ${tgMessages.length}\n` +
        `👥 WebSocket: ${clients.size}\n` +
        `⏱ Uptime: ${Math.round(process.uptime() / 60)}m\n` +
        `🤖 AI: ${hasAI ? '✅' : '❌'} | TG Bot: ${hasTG ? '✅' : '❌'}`
      });
      break;

    case '/north':
    case '/צפון': {
      const items = rssItems.filter(a => /(north|lebanon|hezbollah|galilee|צפון|לבנון|גליל|חיזבאללה|קריית שמונה)/i.test(a.title + a.body)).slice(0, 3);
      const txt = items.length ? items.map(a => `• ${a.title.slice(0, 80)}`).join('\n\n') : 'אין אירועים בצפון';
      await tgRequest('sendMessage', { chat_id: chatId, parse_mode: 'Markdown', text: `🗺 *מצב הצפון*\n\n${txt}` });
      break;
    }
    case '/south':
    case '/דרום': {
      const items = rssItems.filter(a => /(south|gaza|hamas|דרום|עזה|חמאס|שדרות|עוטף)/i.test(a.title + a.body)).slice(0, 3);
      const txt = items.length ? items.map(a => `• ${a.title.slice(0, 80)}`).join('\n\n') : 'אין אירועים בדרום';
      await tgRequest('sendMessage', { chat_id: chatId, parse_mode: 'Markdown', text: `🗺 *מצב הדרום*\n\n${txt}` });
      break;
    }
    case '/iran':
    case '/איראן': {
      const items = rssItems.filter(a => /(iran|nuclear|ballistic|משגר|איראן|גרעין|טיל בליסטי)/i.test(a.title + a.body)).slice(0, 3);
      const txt = items.length ? items.map(a => `• ${a.title.slice(0, 80)}`).join('\n\n') : 'אין עדכונים על איראן';
      await tgRequest('sendMessage', { chat_id: chatId, parse_mode: 'Markdown', text: `🇮🇷 *מצב איראן*\n\n${txt}` });
      break;
    }
    case '/houthi':
    case '/חות\'יים': {
      const items = rssItems.filter(a => /(houthi|yemen|hout|תימן|חות)/i.test(a.title + a.body)).slice(0, 3);
      const txt = items.length ? items.map(a => `• ${a.title.slice(0, 80)}`).join('\n\n') : 'אין עדכוני חות\'יים';
      await tgRequest('sendMessage', { chat_id: chatId, parse_mode: 'Markdown', text: `✈️ *חות'יים*\n\n${txt}` });
      break;
    }

    case '/ask':
    case '/שאל':
      if (!hasAI) { await tgRequest('sendMessage', { chat_id: chatId, text: '❌ Anthropic AI Key לא מוגדר' }); break; }
      if (!arg)   { await tgRequest('sendMessage', { chat_id: chatId, text: 'שימוש: /ask מה המצב הביטחוני?' }); break; }
      await tgRequest('sendMessage', { chat_id: chatId, text: '🤖 מנתח...' });
      try {
        const ctx = [
          orefActive ? `OREF פעיל: ${orefActive.title} — ${(orefActive.data || []).join(', ')}` : 'OREF: שגרה',
          tzActive   ? `צופר: ${(tzActive.areas || []).join(', ')}` : 'צופר: שגרה',
          ...rssItems.slice(0, 8).map(a => `[${a.source}] ${a.title}`),
          ...tgMessages.slice(0, 5).map(m => `[TG:${m.chatName}] ${m.text}`),
        ].join('\n');
        const { body } = await httpFetch('https://api.anthropic.com/v1/messages', {
          method  : 'POST',
          headers : { 'x-api-key': AI_KEY, 'anthropic-version': '2023-06-01' },
          body    : JSON.stringify({
            model     : 'claude-haiku-4-5-20251001',
            max_tokens: 400,
            messages  : [{ role: 'user', content: `נתוני מודיעין:\n${ctx}\n\nשאלה: ${arg}\n\nענה בעברית, קצר ועניני.` }],
          }),
        }, 20000);
        const d     = JSON.parse(body);
        const reply = d.content?.[0]?.text || 'אין תשובה';
        await tgRequest('sendMessage', { chat_id: chatId, text: `🤖 ${reply.slice(0, 500)}` });
      } catch (e) {
        await tgRequest('sendMessage', { chat_id: chatId, text: `❌ שגיאה: ${e.message.slice(0, 60)}` });
      }
      break;

    default:
      // הודעה חופשית — אם AI זמין, נתח
      if (hasAI && text.length > 5 && !text.startsWith('/')) {
        // Forward free text to AI
        await tgHandleCommand(chatId, '/ask ' + text, fromUsername);
      }
  }
}

// Telegram long-poll loop
let tgBotUsername = '';
async function tgGetMe() {
  const r = await tgRequest('getMe', {});
  if (r?.ok) { tgBotUsername = r.result.username; log(`✈️  Telegram @${tgBotUsername} פעיל`); }
}

// ════════════════════════════════════════════════════
// MULTI-BOT POLLING ENGINE
// ════════════════════════════════════════════════════
const botOffsets = { red:0, econ:0, blue:0 };
const botLastSeen = { red:Date.now(), econ:Date.now(), blue:Date.now() };
let botStats = {};

async function tgRequestBot(bot, method, body={}) {
  if(!bot.token) return null;
  try{
    const url=`https://api.telegram.org/bot${bot.token}/${method}`;
    const {status,body:resp}=await httpFetch(url,{
      method:'POST',body:JSON.stringify(body),
      headers:{'Content-Type':'application/json'}
    },25000);
    if(status!==200)return null;
    return JSON.parse(resp);
  }catch{return null;}
}

async function tgPollBot(bot) {
  if(!bot.token||!bot.active) return;
  const offset = botOffsets[bot.id]||0;
  try{
    const r = await tgRequestBot(bot, 'getUpdates', {offset, timeout:20, limit:100});
    if(!r?.ok||!r.result?.length) return;
    botLastSeen[bot.id]=Date.now();
    for(const upd of r.result){
      botOffsets[bot.id]=upd.update_id+1;
      const msg=upd.message||upd.channel_post||upd.edited_message||upd.edited_channel_post;
      if(!msg)continue;
      const chatId   = msg.chat.id;
      const chatName = msg.chat.title||msg.chat.username||String(chatId);
      const text     = msg.text||msg.caption||'';
      const username = msg.from?.username||'channel';
      tgChatSet.add(chatId);
      if(text.startsWith('/')){await tgHandleCommand(chatId,text,username);continue;}
      if(text.length>10){
        const msgKey=`tg:${bot.id}:${chatId}:${upd.update_id}`;
        if(seenTgMsgs.has(msgKey))continue;
        seenTgMsgs.add(msgKey);
        if(isDuplicate(text)){log(`🔁 ${bot.emoji} כפילות [${chatName}]`);continue;}
        const heat=calcHeat(text,'tg');
        const loc=extractCity(text);
        const hasImp=isImpact(text);
        const hasRes=isRescue(text);
        const hasVid=!!(msg.video||msg.document||msg.animation)||hasMedia(text);
        const ts=(msg.date||Math.floor(Date.now()/1000))*1000;
        const item={
          id:msgKey, chatId, chatName:`${bot.emoji} ${chatName}`,
          username, text:text.slice(0,600), timestamp:ts,
          severity:severityOf(text), heat,
          hasImpact:hasImp, hasRescue:hasRes, hasVideo:hasVid,
          hasForces:isForces(text),
          impactCity:loc?.city||null, impactLat:loc?.lat||null, impactLng:loc?.lng||null,
          media:msg.video?'video':msg.photo?'photo':msg.animation?'gif':null,
          bot:bot.id, botName:bot.name,
          source:bot.type,
        };
        tgMessages.unshift(item);
        if(tgMessages.length>300)tgMessages=tgMessages.slice(0,300);
        broadcast({type:'TG_MESSAGE',payload:item});
        if(!botStats[bot.id])botStats[bot.id]={count:0,impact:0,rescue:0};
        botStats[bot.id].count++;
        if(hasImp){botStats[bot.id].impact++;broadcast({type:'IMPACT_EVENT',payload:{...loc,text:text.slice(0,200),source:`tg:${chatName}`,timestamp:ts,hasVideo:hasVid,fromChannel:chatName,bot:bot.id}});}
        const fa=trackForces(text,chatName,ts);
        if(fa){log(`🚨 כוחות: ${fa.city} ×${fa.count} [${bot.emoji}]`);broadcast({type:'FORCE_CONCENTRATION',payload:{...fa,message:`${fa.count} דיווחים ב${fa.city}`,type:'rescue_concentration'}});}
        log(`${bot.emoji} [${chatName}] 🔥${heat}${hasImp?'💥':''}${hasRes?'🚑':''}${hasVid?'📹':''} ${text.slice(0,50)}`);
      }
    }
  }catch(e){log(`⚠️  ${bot.emoji} poll: ${e.message.slice(0,40)}`);}
}

// Poll ALL bots concurrently
async function tgPollAll(){
  await Promise.allSettled(BOTS.map(b=>tgPollBot(b)));
}

async function tgPollUpdates() {
  if (!hasTG) return;
  try {
    const r = await tgRequest('getUpdates', { offset: tgOffset, timeout: 20, limit: 100 });
    if (!r?.ok || !r.result?.length) return;
    for (const upd of r.result) {
      tgOffset = upd.update_id + 1;
      const msg = upd.message || upd.channel_post || upd.edited_message || upd.edited_channel_post;
      if (!msg) continue;
      const chatId   = msg.chat.id;
      const chatName = msg.chat.title || msg.chat.username || String(chatId);
      const text     = msg.text || msg.caption || '';
      const username = msg.from?.username || 'channel';

      // זכור את ה-chat
      tgChatSet.add(chatId);
      // Auto-add to channels list if not there
      if(!TG_CHANNELS.includes(chatId)) {
        TG_CHANNELS.push(chatId);
        log(`📡 חדש: [${chatName}] (${chatId})`);
      }

      // הודעת בוט-command
      if (text.startsWith('/')) {
        await tgHandleCommand(chatId, text, username);
        continue;
      }

      // הודעה מקנאל — שמור ונתח (ללא סינון לפי רשימת ערוצים)
      // הבוט מקבל אוטומטית מכל קנאל שהוא Admin בו
      if (text.length > 10 && isRelevant(text)) {
        const msgKey = `tg:${chatId}:${upd.update_id}`;
        if (!seenTgMsgs.has(msgKey)) {
          seenTgMsgs.add(msgKey);

          // ── FIRST-MESSAGE FILTER ──────────────────────────
          // רק ההודעה הראשונה על כל נושא מוצגת — כפילויות מסוננות
          if (isDuplicate(text)) {
            log(`🔁 TG כפילות מסוננת [${chatName}] ${text.slice(0, 50)}`);
            continue;
          }

          const heat = calcHeat(text, 'tg');
          const loc  = extractCity(text);
          const hasImp  = isImpact(text);
          const hasRes  = isRescue(text);
          const hasVid  = !!(msg.video||msg.document||msg.animation) || hasMedia(text);
          const ts      = (msg.date || Math.floor(Date.now()/1000))*1000;

          const item = {
            id        : msgKey,
            chatId, chatName, username,
            text      : text.slice(0, 600),
            timestamp : ts,
            severity  : severityOf(text),
            heat,
            hasImpact : hasImp,
            hasRescue : hasRes,
            hasVideo  : hasVid,
            hasForces : isForces(text),
            impactCity: loc?.city || null,
            impactLat : loc?.lat  || null,
            impactLng : loc?.lng  || null,
            media     : msg.video ? 'video' : msg.photo ? 'photo' : msg.animation ? 'gif' : null,
          };

          tgMessages.unshift(item);
          if (tgMessages.length > 200) tgMessages = tgMessages.slice(0, 200);
          broadcast({ type: 'TG_MESSAGE', payload: item });
          log(`💬 TG ✅ [${chatName}] 🔥${heat}${hasImp?'💥':''}${hasRes?'🚑':''}${hasVid?'📹':''} ${text.slice(0, 60)}`);

          // ── OREF official channel → trigger immediately ─────────
          const isOrefOfficial = OREF_PRIORITY_CHANNELS.some(ch=>(chatName||'').toLowerCase().includes(ch.replace('@','').toLowerCase()));
          if(isOrefOfficial && isImpact(text)){
            const orefLoc=extractCity(text);
            if(orefLoc){
              broadcast({type:'OREF_ALERT',payload:{
                title:`פיקוד העורף: ${orefLoc.city}`,
                data:[orefLoc.city],cat:1,ts:Date.now(),
                source:'tg_oref',text:text.slice(0,300),
              }});
              log(`🚨 OREF TG PRIORITY: ${orefLoc.city}`);
            }
          }

          // ── Impact event → place marker on map ─────────────────
          if (hasImp && loc) {
            const impEv = { id:'tg_imp_'+msgKey, type:'impact', city:loc.city, lat:loc.lat, lng:loc.lng,
              text:text.slice(0,200), source:'tg:'+chatName, timestamp:ts, heat,
              hasVideo:hasVid, fromChannel:chatName };
            broadcast({ type:'IMPACT_EVENT', payload:impEv });
            log(`💥 TG Impact: ${loc.city} [${chatName}]`);
          }

          // ── Rescue force concentration tracking ────────────────
          const forceAlert = trackForces(text, chatName, ts);
          if (forceAlert) {
            log(`🚨 FORCE CONCENTRATION: ${forceAlert.city} × ${forceAlert.count} mentions`);
            broadcast({ type:'FORCE_CONCENTRATION', payload:{...forceAlert,
              message:`${forceAlert.count} דיווחים על כוחות חירום ב-${forceAlert.city}`,
              type:'rescue_concentration'} });
          }
        }
      }
    }
  } catch { /* silent */ }
  setTimeout(tgPollUpdates, 2000);
}


// ════════════════════════════════════════════════════════════
// SATELLITE THERMAL MONITORING MODULE
// ════════════════════════════════════════════════════════════
const SAT = (() => {
  try { return require('./satellite_module'); }
  catch { return null; }
})();

// Keys already declared above (FIRMS_KEY, N2YO_KEY, EUMET_KEY)

let lastThermalScan  = 0;
let lastSatPositions = [];
let thermalDetections = [];

async function scanSatellites(){
  if(!SAT){log('⚠️  satellite_module.js לא נמצא');return;}
  const now=Date.now();
  if(now-lastThermalScan < 180000) return; // scan every 3min
  lastThermalScan=now;

  // 1. FIRMS thermal scan of launch sites
  if(FIRMS_KEY){
    try{
      const detections = await SAT.scanLaunchZones();
      if(detections.length){
        detections.forEach(d=>{
          thermalDetections.unshift(d);
          log(`🛰 THERMAL [${d.zoneName}] FRP:${d.frp}MW ${d.severity} (${d.satellite})`);
          // Broadcast to all clients
          broadcast({ type:'THERMAL_DETECTION', payload:d });
          // If HIGH/CRITICAL near launch site → alert
          if(d.severity==='CRITICAL'||(d.severity==='HIGH'&&d.frp>300)){
            broadcast({ type:'LAUNCH_ANOMALY', payload:{
              ...d,
              message:`⚠️ אנומליה תרמית: ${d.zoneName} | FRP: ${d.frp}MW | ${d.satellite}`,
              trajectories: d.trajectories,
            }});
            log(`🚨 LAUNCH ANOMALY: ${d.zoneName} ${d.frp}MW`);
          }
        });
      }
    }catch(e){log(`⚠️ FIRMS: ${e.message.slice(0,40)}`);}
  }

  // 2. Satellite positions over Israel
  if(N2YO_KEY){
    try{
      const positions=await SAT.fetchSatPositions(31.5,35.0);
      if(positions){lastSatPositions=positions;broadcast({type:'SAT_POSITIONS',payload:positions});}
    }catch(e){log(`⚠️ N2YO: ${e.message.slice(0,40)}`);}
  }
}

// Satellite status endpoint

// ═══════════════════════════════════════════════════════════════
// AI ANALYSIS — ניתוח כולל כל 90 שניות
// ═══════════════════════════════════════════════════════════════
async function runAIAnalysis() {
  if (!hasAI) return;
  try {
    const orefCtx  = orefActive ? `OREF: ${orefActive.title} — ${(orefActive.data || []).slice(0, 6).join(', ')}` : 'OREF: שגרה';
    const tzofarCtx= tzActive   ? `צופר: ${(tzActive.areas || []).slice(0, 6).join(', ')}` : 'צופר: שגרה';
    const rssCtx   = rssItems.filter(a => a.severity === 'critical' || a.severity === 'high').slice(0, 10).map(a => `[${a.source}] ${a.title}`).join('\n');
    const tgCtx    = tgMessages.slice(0, 8).map(m => `[TG:${m.chatName}] ${m.text.slice(0, 100)}`).join('\n');

    const { body } = await httpFetch('https://api.anthropic.com/v1/messages', {
      method  : 'POST',
      headers : { 'x-api-key': AI_KEY, 'anthropic-version': '2023-06-01' },
      body    : JSON.stringify({
        model     : 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system    : 'Israel security AI. Respond ONLY with valid JSON: {"readinessLevel":1-5,"readinessScore":10-100,"readinessReason":"Hebrew","threats":[{"id":"iran|hamas|hizb|houthi|syria","score":0-100}],"regions":[{"id":"zone_id","risk":1-5}],"summary":"Hebrew 1-2 sentences"}',
        messages  : [{ role: 'user', content: `${new Date().toLocaleString('he-IL')}\n${orefCtx}\n${tzofarCtx}\nRSS:\n${rssCtx}\nTelegram:\n${tgCtx}\n\nJSON only.` }],
      }),
    }, 25000);

    const d    = JSON.parse(body);
    let raw    = (d.content?.[0]?.text || '').trim().replace(/^```json?\n?/, '').replace(/\n?```$/, '');
    aiAnalysis = JSON.parse(raw);
    broadcast({ type: 'AI_ANALYSIS', payload: aiAnalysis });
    log(`🤖 AI: כוננות ${aiAnalysis.readinessLevel}/5 — ${(aiAnalysis.readinessReason || '').slice(0, 50)}`);
  } catch (e) {
    log(`⚠️  AI: ${e.message.slice(0, 50)}`);
  }
}

// ═══════════════════════════════════════════════════════════════
// HTTP SERVER
// ═══════════════════════════════════════════════════════════════
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js'  : 'application/javascript',
  '.css' : 'text/css',
  '.json': 'application/json',
  '.png' : 'image/png',
  '.ico' : 'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url    = req.url.split('?')[0];
  const sendJSON = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  // ── API ─────────────────────────────────────────────────────
  if (url === '/api/satellites') {
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({
      firms:    { enabled:!!FIRMS_KEY, detections:thermalDetections.slice(0,20), zones:(SAT?.LAUNCH_ZONES||[]).length },
      n2yo:     { enabled:!!N2YO_KEY,  positions:lastSatPositions },
      eumetsat: { enabled:!!EUMET_KEY },
      sats:     SAT?.THERMAL_SATS||[],
      configured: SAT?.isConfigured||{},
      lastScan: lastThermalScan?new Date(lastThermalScan).toISOString():'never',
    }));
    return;
  }
  if (url.startsWith('/api/trajectory')) {
    // Calculate trajectory: /api/trajectory?src=iran&dst=32.07,34.79
    const params=new URLSearchParams(url.split('?')[1]||'');
    const srcId=params.get('src')||'iran';
    const dstStr=params.get('dst')||'32.07,34.79';
    const SOURCES={iran:{lat:32.0,lng:53.0},lebanon:{lat:33.8,lng:35.7},gaza:{lat:31.4,lng:34.3},yemen:{lat:15.3,lng:44.2}};
    const srcPos=SOURCES[srcId]||SOURCES.iran;
    const [dLat,dLng]=dstStr.split(',').map(Number);
    if(SAT){
      const traj=SAT.calcTrajectory(srcPos.lat,srcPos.lng,dLat,dLng);
      res.setHeader('Content-Type','application/json');res.end(JSON.stringify(traj));
    }else{res.end(JSON.stringify({error:'satellite_module not loaded'}));}
    return;
  }
  if (url === '/health' || url === '/ping') {
    sendJSON(200, { status: 'ok', uptime: process.uptime(), ts: Date.now() });
    return;
  }
  if (url === '/api/bots') {
    sendJSON(200, {
      bots: BOTS.map(b=>({
        id:b.id, name:b.name, emoji:b.emoji, type:b.type,
        active:b.active, token:b.token?'✅ configured':'❌ missing',
        messages:(botStats[b.id]?.count)||0,
        impacts:(botStats[b.id]?.impact)||0,
        rescues:(botStats[b.id]?.rescue)||0,
        lastSeen: botLastSeen[b.id]?new Date(botLastSeen[b.id]).toISOString():null,
      })),
      totalMessages: tgMessages.length,
      channels: {
        red: CHANNELS_RED.length,
        econ: CHANNELS_ECON.length,
        blue: CHANNELS_BLUE.length,
      },
    });
    return;
  }
  if (url === '/api/status') {
    sendJSON(200, { ok: true, version: '3', orefActive: !!orefActive, tzActive: !!tzActive,
      rss: rssItems.length, tgMessages: tgMessages.length, clients: clients.size,
      uptime: Math.round(process.uptime()), hasTelegram: hasTG, hasAI });
    return;
  }
  if (url === '/api/alerts') { sendJSON(200, rssItems.slice(0, 60)); return; }
  if (url === '/api/hot') {
    const all=[...rssItems,...tgMessages].sort((a,b)=>(b.heat||0)-(a.heat||0));
    sendJSON(200,all.slice(0,20));return;
  }
  if (url === '/api/tg') { sendJSON(200,{messages:tgMessages.slice(0,50),channels:TG_CHANNELS_LIST||[],total:tgMessages.length}); return; }
  if (url === '/api/tg-messages') { sendJSON(200, tgMessages.slice(0, 50)); return; }
  if (url === '/api/airspace') {
    sendJSON(200,{total:droneState.aircraft.length,drones:droneState.drones,military:droneState.military,lastScan:droneState.lastScan?new Date(droneState.lastScan).toISOString():'never'});
    return;
  }
  if (url === '/api/netmon') {
    sendJSON(200,{...netStatus,cables:CRITICAL_CABLES,ixp:INTERNET_IXP,timestamp:new Date().toISOString()});
    return;
  }
  if (url === '/api/license') {
    sendJSON(200,{...LICENSE,serverTime:new Date().toISOString(),uptime:Math.round(process.uptime()),clients:clients.size});
    return;
  }
  if (url.startsWith('/api/streetlevel')) {
    const params=new URLSearchParams(url.split('?')[1]||'');
    const lat=parseFloat(params.get('lat')||'32.07');
    const lng=parseFloat(params.get('lng')||'34.79');
    const rad=parseInt(params.get('r')||'500');
    queryStreetLevel(lat,lng,rad).then(d=>sendJSON(200,d||{error:'no data'})).catch(()=>sendJSON(500,{error:'failed'}));
    return;
  }
  if (url === '/api/forces') {
    sendJSON(200,{concentrations:FORCE_MAP||{},threshold:3,window:'30min'});return;
  }
  if (url === '/api/rss-check') {
    const feeds=[
      {id:'toi',url:'https://www.timesofisrael.com/feed/'},
      {id:'jpost',url:'https://www.jpost.com/rss/rssfeedsfrontpage.aspx'},
      {id:'ynet',url:'https://www.ynet.co.il/Integration/StoryRss2.xml'},
      {id:'bbc',url:'https://feeds.bbci.co.uk/news/world/middle_east/rss.xml'},
      {id:'idf',url:'https://www.idf.il/en/minisites/press-releases/rss.xml'},
      {id:'walla',url:'https://rss.walla.co.il/feed/22'},
    ];
    Promise.allSettled(feeds.map(async f=>{const t0=Date.now();try{const r=await httpFetch(f.url,{},10000);const items=parseRSS(r.body);return{id:f.id,ok:r.status===200,items:items.length,ms:Date.now()-t0};}catch(e){return{id:f.id,ok:false,error:e.message.slice(0,40),ms:Date.now()-t0};}}))
    .then(results=>sendJSON(200,{feeds:results.map(r=>r.value||{error:String(r.reason)}),cached:rssItems.length,timestamp:new Date().toISOString()}))
    .catch(e=>sendJSON(500,{error:e.message}));
    return;
  }
  if (url === '/api/ai') { sendJSON(200, aiAnalysis || { readinessLevel: 1, readinessScore: 10, readinessReason: 'ממתין לניתוח' }); return; }
  if (url === '/api/telegram') {
    if (!hasTG) { sendJSON(200, { ok: false, error: 'no token' }); return; }
    const r = await tgRequest('getMe', {});
    sendJSON(200, r || { ok: false });
    return;
  }
  if (url === '/api/ai-test') {
    if (!hasAI) { sendJSON(200, { ok: false, error: 'no key' }); return; }
    try {
      const { body } = await httpFetch('https://api.anthropic.com/v1/messages', {
        method: 'POST', headers: { 'x-api-key': AI_KEY, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 5, messages: [{ role: 'user', content: 'ok' }] }),
      }, 12000);
      const d = JSON.parse(body);
      sendJSON(200, { ok: !!d.content, model: d.model, error: d.error?.message });
    } catch (e) { sendJSON(500, { ok: false, error: e.message }); }
    return;
  }

  // ── OREF PROXY ──────────────────────────────────────────────
  // OREF status endpoint
  if (url === '/api/oref-status') {
    const now=Date.now();
    const secSinceOk = orefStats.lastOk ? Math.round((now-new Date(orefStats.lastOk))/1000) : null;
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({
      connected: secSinceOk!==null && secSinceOk<30,
      lastOkAgo: secSinceOk,
      lastOk: orefStats.lastOk,
      lastFail: orefStats.lastFail,
      lastStatus: orefStats.lastStatus,
      successCount: orefStats.ok,
      failCount: orefStats.fail,
      orefActive: orefActive ? {title:orefActive.title, areas:orefActive.data, ts:orefActive.ts} : null,
      currentTime: new Date().toISOString(),
      pollInterval: 8000,
    }));
    return;
  }

  if (url === '/proxy/oref') {
    httpFetch('https://www.oref.org.il/WarningMessages/alert/alerts.json',
      { headers: { 'User-Agent':'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36','Referer':'https://www.oref.org.il/heb/alerts-history/','X-Requested-With':'XMLHttpRequest','Accept':'application/json','Cache-Control':'no-cache' } })
      .then(({ body }) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(body || ''); })
      .catch(() => { res.writeHead(502); res.end('{}'); });
    return;
  }
  if (url === '/proxy/oref-history') {
    httpFetch('https://www.oref.org.il/WarningMessages/History/AlertsHistory.json',
      { headers: { 'Referer': 'https://www.oref.org.il/', 'X-Requested-With': 'XMLHttpRequest' } })
      .then(({ body }) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(body || '[]'); })
      .catch(() => { res.writeHead(502); res.end('[]'); });
    return;
  }

  // ── STATIC ──────────────────────────────────────────────────
  const filePath = url === '/' ? '/index.html' : url;
  const fullPath = path.join(__dirname, filePath);
  if (!fullPath.startsWith(__dirname)) { res.writeHead(403); res.end(); return; }

  fs.readFile(fullPath, (err, data) => {
    if (err) {
      // fallback to index.html
      fs.readFile(path.join(__dirname, 'index.html'), (e2, d2) => {
        if (e2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(d2);
      });
      return;
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

// ── WEBSOCKET UPGRADE ────────────────────────────────────────
server.on('upgrade', (req, socket) => {
  if (req.headers.upgrade?.toLowerCase() !== 'websocket') { socket.destroy(); return; }
  wsHandshake(req, socket);
  clients.add(socket);
  log(`WS: ${clients.size} clients connected`);

  // Send current state immediately
  wsSend(socket, {
    type   : 'INIT',
    payload: {
      orefActive,
      tzActive,
      orefHistory : orefHistory.slice(0, 5),
      alerts      : rssItems.slice(0, 30),
      tgMessages  : tgMessages.slice(0, 20),
      aiAnalysis,
    },
  });

  socket.on('close', () => { clients.delete(socket); });
  socket.on('error', () => { clients.delete(socket); });
  socket.on('data',  () => { /* pong */ });
});

// ═══════════════════════════════════════════════════════════════
// LAUNCH
// ═══════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════
// חמל ארצי — hamal.co.il real-time events scraper
// ════════════════════════════════════════════════════════════
const HAMAL_URLS = [
  'https://hamal.co.il',
  'https://www.hamal.co.il/צבע_אדום-36',
];
const seenHamal = new Set();

async function pollHamal() {
  for (const baseUrl of HAMAL_URLS) {
    try {
      const { status, body } = await httpFetch(baseUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'he-IL,he;q=0.9',
          'Referer': 'https://hamal.co.il/',
        }
      }, 10000);

      if (status !== 200) continue;

      // Extract news items from HTML
      const items = [];
      // Pattern 1: title tags
      const titleRe = /<h[123][^>]*class="[^"]*(?:title|headline|post-title)[^"]*"[^>]*>([^<]{10,})<\/h[123]>/gi;
      // Pattern 2: article text
      const artRe = /<(?:p|div)[^>]*class="[^"]*(?:content|text|body)[^"]*"[^>]*>([^<]{20,150})<\/(?:p|div)>/gi;

      let m;
      while ((m = titleRe.exec(body)) !== null) {
        const text = m[1].replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/<[^>]+>/g,'').trim();
        if (text.length > 10) items.push(text);
      }
      // Fallback: meta description
      const metaRe = /<meta[^>]+(?:name|property)="(?:description|og:description)"[^>]+content="([^"]{20,200})"/gi;
      while ((m = metaRe.exec(body)) !== null) items.push(m[1]);

      items.forEach(text => {
        if (!isRelevant(text)) return;
        const key = 'hamal:' + text.slice(0, 40);
        if (seenHamal.has(key)) return;
        seenHamal.add(key);
        const heat = calcHeat(text, 'hamal');
        const loc  = extractCity(text);
        const item = {
          id: key, chatName: 'חמל ארצי', chatId: 'hamal',
          text, timestamp: Date.now(), severity: severityOf(text),
          heat, source: 'hamal',
          hasImpact: isImpact(text), hasRescue: isRescue(text),
          impactCity: loc?.city||null, impactLat: loc?.lat||null, impactLng: loc?.lng||null,
        };
        tgMessages.unshift(item);
        if (tgMessages.length > 200) tgMessages = tgMessages.slice(0, 200);
        broadcast({ type: 'TG_MESSAGE', payload: item });
        log(`📡 חמל: 🔥${heat} ${text.slice(0, 60)}`);
        if (item.hasImpact && loc) {
          broadcast({ type: 'IMPACT_EVENT', payload: { ...loc, text, source: 'hamal', timestamp: Date.now() } });
        }
      });
      break; // success — no need for fallback URL
    } catch(e) {
      log(`⚠️  חמל poll: ${e.message.slice(0, 40)}`);
    }
  }
}

// ── Emergency RSS feeds ──────────────────────────────────────
const EMERGENCY_FEEDS = [
  { id:'mda_rss',  url:'https://www.mdais.org/rss.xml',           name:'מד"א' },
  { id:'mda_news', url:'https://www.mdais.org/en/rss.xml',        name:"MDA News" },
  { id:'hatzalah', url:'https://israelrescue.org/feed/',           name:'איחוד הצלה' },
];

async function pollEmergencyFeeds() {
  for (const feed of EMERGENCY_FEEDS) {
    try {
      const { status, body } = await httpFetch(feed.url, {}, 10000);
      if (status !== 200) continue;
      const items = parseRSS(body);
      items.slice(0, 5).forEach(item => {
        const key = `emfeed:${feed.id}:${item.guid}`;
        if (seenGuids.has(key)) return;
        seenGuids.add(key);
        const text = `${item.title} ${item.description}`.slice(0, 400);
        if (!isRelevant(text)) return;
        const heat = calcHeat(text, 'emergency');
        const loc  = extractCity(text);
        const msg = {
          id: key, chatName: feed.name, chatId: feed.id,
          text: item.title, timestamp: new Date(item.pubDate||0).getTime()||Date.now(),
          severity: severityOf(text), heat, source: 'emergency_rss',
          hasImpact: isImpact(text), hasRescue: isRescue(text),
          impactCity: loc?.city||null, impactLat: loc?.lat||null, impactLng: loc?.lng||null,
        };
        tgMessages.unshift(msg);
        if (tgMessages.length > 200) tgMessages = tgMessages.slice(0, 200);
        broadcast({ type: 'TG_MESSAGE', payload: msg });
        log(`🚑 ${feed.name}: ${item.title.slice(0, 60)}`);
      });
    } catch(e) {
      log(`⚠️  ${feed.name} RSS: ${e.message.slice(0, 30)}`);
    }
  }
}


// ════════════════════════════════════════════════════════════
// GLOBAL INTERNET / BGP MONITORING
// ════════════════════════════════════════════════════════════
const CF_RADAR_TOKEN = process.env.CLOUDFLARE_RADAR_TOKEN || '';
const RIPE_ATLAS_KEY = process.env.RIPE_ATLAS_KEY || '';

const CRITICAL_CABLES = [
  {name:'FLAG/FALCON',  route:'Israel-India-SE Asia', risk:0},
  {name:'SEA-ME-WE-4',  route:'Israel-Europe-Asia',   risk:0},
  {name:'CADMOS',       route:'Israel-Cyprus-France',  risk:0},
];
const INTERNET_IXP = [
  {name:'IIX',    city:'Tel Aviv',  asn:'AS2200', country:'IL'},
  {name:'LINX',   city:'London',    asn:'AS5459', country:'GB'},
  {name:'AMS-IX', city:'Amsterdam', asn:'AS1200', country:'NL'},
  {name:'DE-CIX', city:'Frankfurt', asn:'AS6695', country:'DE'},
];
let netStatus = { lastScan:0, bottlenecks:[], bgpEvents:[], cableAlerts:[], globalHealth:'unknown' };

async function monitorInternetHealth(){
  const now = Date.now();
  if(now - netStatus.lastScan < 120000) return;
  netStatus.lastScan = now;
  try{
    if(CF_RADAR_TOKEN){
      const r=await httpFetch('https://api.cloudflare.com/client/v4/radar/bgp/timeseries?dateRange=1h&format=json',
        {headers:{'Authorization':'Bearer '+CF_RADAR_TOKEN}},10000);
      if(r.status===200){
        netStatus.globalHealth='ok';
        const d=JSON.parse(r.body);
        const vals=d?.result?.serie_total?.values||[];
        if(vals.length>4){
          const last=vals[vals.length-1],prev=vals[vals.length-4];
          if(prev>0&&Math.abs(last-prev)/prev>0.25){
            const pct=Math.round((last-prev)/prev*100);
            const evt={type:'BGP_SPIKE',pct,ts:now};
            netStatus.bgpEvents.unshift(evt);
            if(netStatus.bgpEvents.length>20)netStatus.bgpEvents.pop();
            broadcast({type:'NET_EVENT',payload:{...evt,message:'BGP spike: '+pct+'%'}});
            log('BGP anomaly: '+pct+'% change');
          }
        }
      }
    }else{
      // Free check via public endpoint
      const r=await httpFetch('https://stat.ripe.net/data/bgp-updates/data.json?resource=0.0.0.0/0&hours=1',{},8000);
      if(r.status===200)netStatus.globalHealth='monitoring';
    }
  }catch(e){log('Internet monitor: '+e.message.slice(0,40));}
}

// ════════════════════════════════════════════════════════════
// DRONE / UAV TRACKING — OpenSky Network ADS-B (FREE)
// ════════════════════════════════════════════════════════════
const OPENSKY_USER = process.env.OPENSKY_USER || '';
const OPENSKY_PASS = process.env.OPENSKY_PASS || '';
const ISRAEL_BBOX  = {lamin:29.4,lomin:34.2,lamax:33.5,lomax:36.0};

let droneState = {lastScan:0,aircraft:[],drones:[],military:[],alerts:new Set()};

const MIL_CALL_PREFIXES = ['IAF','F16','F35','B52','REACH','CANUCK','HERMES','APOLLO','TOPGUN'];

function classifyAircraft(ac){
  const icao=ac[0],lat=ac[6],lon=ac[5],baro_alt=ac[7]||0,vel=ac[9]||0;
  const callsign=(ac[1]||'').trim().toUpperCase();
  const altM=Math.round(baro_alt);
  const speedKt=Math.round(vel*1.944);
  const cat=ac[14]||0;
  const isMil=MIL_CALL_PREFIXES.some(p=>callsign.startsWith(p))||
               (icao&&icao.startsWith('7')&&!icao.startsWith('738')&&!icao.startsWith('739'));
  const isDrone=(altM>0&&altM<500&&speedKt<80)||(cat===6)||(!callsign&&altM<300&&altM>0);
  return{icao,lat,lon,altM,speedKt,callsign:callsign||'???',isMil,isDrone,cat};
}

async function scanAirspace(){
  const now=Date.now();
  if(now-droneState.lastScan<30000)return;
  droneState.lastScan=now;
  try{
    const b=ISRAEL_BBOX;
    const auth=OPENSKY_USER?{'Authorization':'Basic '+Buffer.from(OPENSKY_USER+':'+OPENSKY_PASS).toString('base64')}:{};
    const url='https://opensky-network.org/api/states/all?lamin='+b.lamin+'&lomin='+b.lomin+'&lamax='+b.lamax+'&lomax='+b.lomax;
    const r=await httpFetch(url,{headers:auth},15000);
    if(r.status!==200)return;
    const d=JSON.parse(r.body);
    const classified=(d.states||[]).map(classifyAircraft).filter(a=>a.lat&&a.lon);
    droneState.aircraft=classified;
    droneState.drones=classified.filter(a=>a.isDrone);
    droneState.military=classified.filter(a=>a.isMil);
    broadcast({type:'AIRSPACE_UPDATE',payload:{
      total:classified.length,
      drones:droneState.drones,
      military:droneState.military,
      ts:now,
    }});
    droneState.drones.forEach(d=>{
      const k='drone:'+d.icao;
      if(!droneState.alerts.has(k)){
        droneState.alerts.add(k);
        const threat=d.altM<100?'HIGH':d.altM<300?'MEDIUM':'LOW';
        log('DRONE: '+d.callsign+' @'+d.altM+'m '+d.speedKt+'kt ['+threat+']');
        broadcast({type:'DRONE_ALERT',payload:{...d,threat,
          message:'רחפן: '+d.callsign+' גובה '+d.altM+'m '+threat}});
        setTimeout(()=>droneState.alerts.delete(k),300000);
      }
    });
    if(classified.length)log('Airspace: '+classified.length+' ac | '+droneState.drones.length+' drones | '+droneState.military.length+' mil');
  }catch(e){log('Airspace: '+e.message.slice(0,40));}
}

// ════════════════════════════════════════════════════════════
// STREET-LEVEL via Overpass API (OpenStreetMap)
// ════════════════════════════════════════════════════════════
async function queryStreetLevel(lat,lng,radiusM=500){
  const q='[out:json][timeout:10];(way["highway"](around:'+radiusM+','+lat+','+lng+');node["amenity"="hospital"](around:'+radiusM+','+lat+','+lng+');node["amenity"="police"](around:'+radiusM+','+lat+','+lng+');node["amenity"="fire_station"](around:'+radiusM+','+lat+','+lng+'););out body;';
  try{
    const r=await httpFetch('https://overpass-api.de/api/interpreter',
      {method:'POST',body:q,headers:{'Content-Type':'text/plain'}},15000);
    if(r.status!==200)return null;
    const d=JSON.parse(r.body);
    const streets=[...new Set(d.elements.filter(e=>e.type==='way'&&e.tags?.name).map(e=>e.tags.name))].slice(0,10);
    const hospitals=d.elements.filter(e=>e.tags?.amenity==='hospital').length;
    const police=d.elements.filter(e=>e.tags?.amenity==='police').length;
    const fire=d.elements.filter(e=>e.tags?.amenity==='fire_station').length;
    return{streets,hospitals,police,fire,total:d.elements.length};
  }catch{return null;}
}

// ════════════════════════════════════════════════════════════
// SYSTEM LICENSE — PERPETUAL
// ════════════════════════════════════════════════════════════
const LICENSE = {
  key:      process.env.LICENSE_KEY || 'EWS-YOSSIKAT-PERPETUAL-2025',
  owner:    'Yossi WarZone Control',
  system:   'EWS Israel Tactical Intelligence Hub',
  type:     'PERPETUAL',
  version:  '5.0',
  features: ['oref','tzofar','tg3bots','ai','satellite','drone_adsb','streetlevel','netmon','carplay','admin'],
  issued:   '2025-01-01',
  expires:  'NEVER',
  valid:    true,
  maxClients: 99,
  allowedHosts: ['localhost','127.0.0.1','10.0.0.0/8','192.168.0.0/16'],
};

function checkLicense(){
  log('LICENSE: '+LICENSE.key+' ['+LICENSE.type+'] '+(LICENSE.valid?'VALID':'INVALID'));
  log('  Owner: '+LICENSE.owner+' | Features: '+LICENSE.features.length);
  return LICENSE.valid;
}

// ════════════════════════════════════════════════════
// BOT STARTUP VALIDATION
// ════════════════════════════════════════════════════
async function validateBots(){
  log('\n📱 בדיקת בוטים:');
  for(const bot of BOTS){
    try{
      const r=await tgRequestBot(bot,'getMe',{});
      if(r?.ok){
        bot.username='@'+r.result.username;
        log(`  ✅ ${bot.emoji} ${bot.name} → ${bot.username}`);
      }else{
        bot.active=false;
        log(`  ❌ ${bot.emoji} ${bot.name} — טוקן שגוי`);
      }
    }catch{
      bot.active=false;
      log(`  ⚠️  ${bot.emoji} ${bot.name} — לא מגיב`);
    }
  }
  if(!BOTS.some(b=>b.active)){
    log('  ⚠️  אין בוטים פעילים — הוסף טוקנים ל-.env');
    log('  💡 TG_BOT_RED=...  TG_BOT_ECON=...  TG_BOT_BLUE=...');
  } else {
    const activeBots = BOTS.filter(b=>b.active);
    log('');
    log('  📋 להוסיף בוטים לקנאלים:');
    activeBots.forEach(b=>{
      log(`  → פתח @kavhamilhama → Admins → הוסף ${b.username||b.name}`);
    });
    log('  (הבוט יקבל הודעות רק מקנאלים שהוסף אליהם)');
  }
  log('');
}

server.listen(PORT, '0.0.0.0', async () => {
  // Resolve TG channel IDs at boot
  if (hasTG) {
    setTimeout(resolveChannelIds, 2000);
    setInterval(resolveChannelIds, 3600000);
  }
  // Get local IP
  const ifaces = os.networkInterfaces();
  const localIP = Object.values(ifaces).flat()
    .find(i => i.family === 'IPv4' && !i.internal)?.address || '?';

  log('══════════════════════════════════════');
  log(`🚀 EWS Mission Control v3 — port ${PORT}`);
  log(`🖥️  http://localhost:${PORT}`);
  log(`📱 http://${localIP}:${PORT}`);
  log(`🔧 http://localhost:${PORT}/diag.html`);
  log(`🤖 AI:  ${hasAI ? '✅ מחובר' : '❌ חסר'}`);
  log(`✈️  TG:  ${hasTG ? '✅ מחובר' : '❌ חסר'}`);
  log('══════════════════════════════════════');

  // Initial data fetch
  // Telegram User API (אם מוגדר)
  initUserAPI().catch(e=>log('⚠️ UserAPI:'+e.message));
  checkLicense();
  await validateBots();
  await pollOref();
  setTimeout(pollHamal,         5000);
  setTimeout(pollEmergencyFeeds,10000);
  await pollTzofar();
  await pollOrefHistory();
  await pollAllRSS();

  // Start Telegram bot
  if (hasTG) {
    await tgGetMe();
    tgPollUpdates();
    // Startup notification
    setTimeout(() => tgNotify(
      `✅ *EWS הופעל*\n🕐 ${new Date().toLocaleTimeString('he-IL')}\n` +
      `📡 OREF + צופר + RSS + AI\n/help לרשימת פקודות`
    ), 4000);
  }

  // AI initial analysis
  if (hasAI) setTimeout(runAIAnalysis, 5000);

  // Polling intervals
  setInterval(pollOref,         8000);
  setInterval(pollHamal,        30000);
  setInterval(scanAirspace,     30000);    // ADS-B every 30s
  setInterval(monitorInternetHealth, 120000); // Internet every 2min
  setTimeout(scanAirspace,      8000);
  setTimeout(monitorInternetHealth, 15000);
  setInterval(pollEmergencyFeeds, 90000); // מד"א/הצלה כל 90s
  setInterval(pollTzofar,     10000);
  setInterval(pollOrefHistory,120000);
  setInterval(pollAllRSS,     60000);
  setInterval(runAIAnalysis,  90000);

  // Heartbeat
  setInterval(() => broadcast({ type: 'PING', ts: Date.now() }), 30000);

  log('✅ כל המנגנונים פעילים');
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    log(`⚠️  Port ${PORT} תפוס — מנקה...`);
    try {
      cp.execSync(`lsof -ti :${PORT} | xargs kill -9 2>/dev/null || true`);
      setTimeout(() => 
// ════════════════════════════════════════════════════════════
// חמל ארצי — hamal.co.il real-time events scraper
server.listen(PORT, '0.0.0.0'), 800);
    } catch {
      log(`❌ לא ניתן לפנות פורט ${PORT}`);
      process.exit(1);
    }
  } else {
    log(`❌ ${e.message}`);
    process.exit(1);
  }
});

process.on('uncaughtException',  e => log(`⚠️  ${e.message}`));
process.on('unhandledRejection', e => log(`⚠️  ${e}`));

// ══ NASA FIRMS THERMAL MODULE ════════════════════════════════
const FIRMS_KEY = (process.env.FIRMS_MAP_KEY||'').trim();
const FIRMS_BBOX = '29,34,37,36'; // Israel + neighbors (W,S,E,N)
let lastFIRMS=[],lastFIRMSTime=0;

function parseCSVFirms(body){
  const lines=body.trim().split('\n');if(lines.length<2)return[];
  const H=lines[0].split(',').map(h=>h.trim());
  return lines.slice(1).map(l=>{const v=l.split(',');const r={};H.forEach((h,i)=>r[h]=(v[i]||'').trim());return r;}).filter(r=>r.latitude&&r.longitude);
}

async function fetchFIRMS(){
  if(!FIRMS_KEY)return;
  const all=[];
  for(const src of['VIIRS_NOAA20_NRT','MODIS_NRT']){
    try{
      const{status,body}=await httpFetch(`https://firms.modaps.eosdis.nasa.gov/api/area/csv/${FIRMS_KEY}/${src}/${FIRMS_BBOX}/1`,{},15000);
      if(status!==200)continue;
      parseCSVFirms(body).forEach(r=>{
        const frp=parseFloat(r.frp||0);if(frp<1)return;
        all.push({lat:parseFloat(r.latitude),lng:parseFloat(r.longitude),frp,
          bright:parseFloat(r.bright_ti4||r.brightness||0),
          confidence:r.confidence||'n',sat:src.includes('VIIRS')?'VIIRS':'MODIS',
          date:r.acq_date,time:r.acq_time,source:src});
      });
    }catch(e){log(`FIRMS ${src}: ${e.message.slice(0,30)}`);}
  }
  if(all.length){
    lastFIRMS=all;lastFIRMSTime=Date.now();
    broadcast({type:'THERMAL_DATA',payload:{hotspots:all,count:all.length,ts:Date.now()}});
    log(`🛰  FIRMS: ${all.length} thermal hotspots`);
    // Cross-check with impacts
    impactEvents.slice(0,5).forEach(ev=>{
      all.forEach(h=>{
        const d=Math.sqrt((h.lat-ev.lat)**2+(h.lng-ev.lng)**2)*111;
        if(d<30&&h.frp>20)broadcast({type:'THERMAL_CORRELATION',payload:{impact:ev.city,hotspot:h,distKm:Math.round(d),satellite:h.sat,frp:h.frp}});
      });
    });
  }
}

// Add /api/thermal endpoint and FIRMS poll to server launch

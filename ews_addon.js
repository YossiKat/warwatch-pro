/**
 * EWS ADDON MODULE — v7.1
 * מודול תוספת ל-Lovable warwatch-guardian-hub
 * 
 * ⚠️  SAFE INJECTION — לא דורס שום קוד קיים
 * מוסיף: מיקום משתמש + מרחק לנפילה + ניטור תרמי + פוליגוני יישובים
 * 
 * שימוש: הוסף לפני </body> ב-israel_intel_hub.html
 * <script src="ews_addon.js"></script>
 */

(function() {
'use strict';


// ════════════════════════════════════════════════════════════
// AUTH — הרשמה ראשונה + כניסה אוטומטית
// ════════════════════════════════════════════════════════════
const EWS_AUTH_KEY = 'ews_auth_token';
const EWS_USER_KEY = 'ews_user_data';

// Screen HTML injected once
const AUTH_SCREEN_HTML = `
<div id="ews-auth-screen" style="
  position:fixed;inset:0;z-index:99999;
  background:rgba(2,5,8,.98);backdrop-filter:blur(20px);
  display:flex;align-items:center;justify-content:center;
  font-family:'Heebo',sans-serif;direction:rtl;
">
  <div style="background:#04090f;border:1px solid #0c1e2e;border-radius:14px;padding:32px 36px;width:340px;max-width:92vw;">
    <!-- Logo -->
    <div style="text-align:center;margin-bottom:24px">
      <div style="width:50px;height:50px;border-radius:50%;border:2px solid rgba(0,207,255,.2);position:relative;margin:0 auto 12px">
        <div style="position:absolute;inset:0;border-radius:50%;background:conic-gradient(from 0deg,transparent,rgba(0,207,255,.7) 40deg,transparent);animation:ews_auth_radar 2.5s linear infinite"></div>
        <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:6px;height:6px;background:#00cfff;border-radius:50%;box-shadow:0 0 8px #00cfff"></div>
      </div>
      <div style="font-size:18px;font-weight:900;color:#fff;letter-spacing:1px">Yossi WarZone</div>
      <div style="font-size:10px;color:#00cfff;font-family:'Share Tech Mono',monospace;letter-spacing:2px;margin-top:2px">ISRAEL INTEL HUB</div>
    </div>

    <!-- Tabs -->
    <div style="display:flex;gap:4px;margin-bottom:20px;background:rgba(255,255,255,.04);border-radius:8px;padding:3px">
      <button id="ews-tab-login" onclick="ews_switchTab('login')" style="flex:1;padding:7px;border:none;border-radius:6px;font-size:12px;font-family:'Heebo',sans-serif;cursor:pointer;background:#00cfff22;color:#00cfff;border:1px solid #00cfff33">כניסה</button>
      <button id="ews-tab-register" onclick="ews_switchTab('register')" style="flex:1;padding:7px;border:none;border-radius:6px;font-size:12px;font-family:'Heebo',sans-serif;cursor:pointer;background:transparent;color:#2a4060">הרשמה</button>
    </div>

    <!-- Login panel -->
    <div id="ews-panel-login">
      <div style="font-size:11px;color:#8ab0c4;margin-bottom:16px;text-align:center">
        אם נרשמת כבר — הכנס את שמך ואנחנו נמצא את הטוקן שלך
      </div>
      <input id="ews-login-name" type="text" placeholder="שמך המלא" autocomplete="name"
        style="width:100%;padding:11px 13px;background:rgba(255,255,255,.05);border:1px solid #0c1e2e;border-radius:8px;color:#fff;font-size:13px;font-family:'Heebo',sans-serif;margin-bottom:12px;outline:none;direction:rtl;box-sizing:border-box"
        onkeydown="if(event.key==='Enter')ews_doLogin()">
      <button onclick="ews_doLogin()" style="width:100%;padding:12px;background:rgba(0,207,255,.12);border:1px solid rgba(0,207,255,.3);border-radius:8px;color:#00cfff;font-size:14px;font-family:'Heebo',sans-serif;cursor:pointer;font-weight:700">
        ⚡ כניסה
      </button>
    </div>

    <!-- Register panel -->
    <div id="ews-panel-register" style="display:none">
      <input id="ews-reg-name" type="text" placeholder="שם מלא *" autocomplete="name"
        style="width:100%;padding:11px 13px;background:rgba(255,255,255,.05);border:1px solid #0c1e2e;border-radius:8px;color:#fff;font-size:13px;font-family:'Heebo',sans-serif;margin-bottom:10px;outline:none;direction:rtl;box-sizing:border-box">
      <input id="ews-reg-phone" type="tel" placeholder="טלפון (אופציונלי)" autocomplete="tel"
        style="width:100%;padding:11px 13px;background:rgba(255,255,255,.05);border:1px solid #0c1e2e;border-radius:8px;color:#fff;font-size:13px;font-family:'Heebo',sans-serif;margin-bottom:10px;outline:none;direction:rtl;box-sizing:border-box">
      <input id="ews-reg-invite" type="text" placeholder="קוד הזמנה *"
        style="width:100%;padding:11px 13px;background:rgba(255,255,255,.05);border:1px solid #0c1e2e;border-radius:8px;color:#fff;font-size:13px;font-family:'Heebo',sans-serif;margin-bottom:12px;outline:none;direction:rtl;box-sizing:border-box"
        onkeydown="if(event.key==='Enter')ews_doRegister()">
      <button onclick="ews_doRegister()" style="width:100%;padding:12px;background:rgba(0,255,136,.1);border:1px solid rgba(0,255,136,.3);border-radius:8px;color:#00ff88;font-size:14px;font-family:'Heebo',sans-serif;cursor:pointer;font-weight:700">
        ✅ הרשמה
      </button>
    </div>

    <!-- Status message -->
    <div id="ews-auth-msg" style="margin-top:14px;padding:8px 12px;border-radius:6px;font-size:11px;display:none;text-align:center"></div>
    
    <!-- Skip (demo) -->
    <div style="text-align:center;margin-top:16px">
      <button onclick="ews_skipAuth()" style="background:none;border:none;color:#2a4060;font-size:10px;cursor:pointer;font-family:'Heebo',sans-serif">
        המשך כאורח (ללא שמירת נתונים)
      </button>
    </div>
  </div>
</div>
<style>
  @keyframes ews_auth_radar { to { transform: rotate(360deg); } }
  #ews-login-name:focus, #ews-reg-name:focus, #ews-reg-phone:focus, #ews-reg-invite:focus {
    border-color: rgba(0,207,255,.4) !important;
    box-shadow: 0 0 0 2px rgba(0,207,255,.08);
  }
</style>
`;

function ews_switchTab(tab) {
  const isLogin = tab === 'login';
  document.getElementById('ews-panel-login').style.display    = isLogin ? 'block' : 'none';
  document.getElementById('ews-panel-register').style.display = isLogin ? 'none'  : 'block';
  document.getElementById('ews-tab-login').style.background    = isLogin ? '#00cfff22' : 'transparent';
  document.getElementById('ews-tab-login').style.color         = isLogin ? '#00cfff'   : '#2a4060';
  document.getElementById('ews-tab-login').style.border        = isLogin ? '1px solid #00cfff33' : 'none';
  document.getElementById('ews-tab-register').style.background = !isLogin ? 'rgba(0,255,136,.1)' : 'transparent';
  document.getElementById('ews-tab-register').style.color      = !isLogin ? '#00ff88'   : '#2a4060';
  ews_setAuthMsg('');
}

function ews_setAuthMsg(msg, ok) {
  const el = document.getElementById('ews-auth-msg');
  if (!el) return;
  if (!msg) { el.style.display = 'none'; return; }
  el.style.display = 'block';
  el.style.background = ok ? 'rgba(0,255,136,.1)' : 'rgba(255,0,60,.1)';
  el.style.border = `1px solid ${ok ? 'rgba(0,255,136,.3)' : 'rgba(255,0,60,.3)'}`;
  el.style.color  = ok ? '#00ff88' : '#ff8888';
  el.textContent = msg;
}

async function ews_doRegister() {
  const name   = document.getElementById('ews-reg-name')?.value?.trim();
  const phone  = document.getElementById('ews-reg-phone')?.value?.trim();
  const invite = document.getElementById('ews-reg-invite')?.value?.trim();
  if (!name)   { ews_setAuthMsg('נדרש שם מלא'); return; }
  if (!invite) { ews_setAuthMsg('נדרש קוד הזמנה'); return; }
  ews_setAuthMsg('⏳ מתחבר...');
  try {
    const r = await fetch(window._EWS_SERVER + '/auth/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, phone, invite }),
    });
    const d = await r.json();
    if (!r.ok) { ews_setAuthMsg(d.error || 'שגיאה בהרשמה'); return; }
    // Save token permanently
    localStorage.setItem(EWS_AUTH_KEY, d.token);
    localStorage.setItem(EWS_USER_KEY, JSON.stringify(d.user));
    ews_setAuthMsg('✅ ברוך הבא, ' + d.user.name + '!', true);
    setTimeout(ews_closeAuth, 1200);
  } catch {
    ews_setAuthMsg('שרת לא זמין — המשך כאורח');
    setTimeout(ews_skipAuth, 2000);
  }
}

async function ews_doLogin() {
  const name = document.getElementById('ews-login-name')?.value?.trim();
  // Try stored token first
  const storedToken = localStorage.getItem(EWS_AUTH_KEY);
  if (storedToken) {
    ews_setAuthMsg('⏳ מאמת...');
    try {
      const r = await fetch(window._EWS_SERVER + '/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: storedToken }),
      });
      const d = await r.json();
      if (r.ok) {
        ews_setAuthMsg('✅ ברוך הבא, ' + d.user.name + '!', true);
        setTimeout(ews_closeAuth, 800);
        return;
      }
    } catch {}
  }
  // Token failed — clear and show register
  localStorage.removeItem(EWS_AUTH_KEY);
  ews_setAuthMsg('לא נמצא חשבון — אנא הירשם תחילה');
  setTimeout(() => ews_switchTab('register'), 1500);
}

function ews_skipAuth() {
  localStorage.setItem(EWS_AUTH_KEY, 'guest');
  localStorage.setItem(EWS_USER_KEY, JSON.stringify({ name: 'אורח', role: 'guest' }));
  ews_closeAuth();
}

function ews_closeAuth() {
  const screen = document.getElementById('ews-auth-screen');
  if (screen) {
    screen.style.transition = 'opacity .4s';
    screen.style.opacity = '0';
    setTimeout(() => screen.remove(), 400);
  }
  // Update GPS panel to show user name
  const stored = localStorage.getItem(EWS_USER_KEY);
  if (stored) {
    const user = JSON.parse(stored);
    const gpsPanel = document.getElementById('ews-gps-panel');
    if (gpsPanel && user.name) {
      const nameEl = document.createElement('span');
      nameEl.style.cssText = 'color:#00ff88;font-size:9px;padding:0 6px;border-right:1px solid #0c1e2e';
      nameEl.textContent = '👤 ' + user.name;
      gpsPanel.insertBefore(nameEl, gpsPanel.firstChild);
    }
  }
}

// ── MAIN AUTH CHECK ──────────────────────────────────────────
function ews_checkAuth() {
  const token = localStorage.getItem(EWS_AUTH_KEY);
  
  if (token) {
    // Token exists — silent auto-login
    if (token === 'guest') { return; } // guest mode, skip validation
    
    // Validate in background
    fetch(window._EWS_SERVER + '/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    }).then(r => r.json()).then(d => {
      if (d.user) {
        // Update stored user data
        localStorage.setItem(EWS_USER_KEY, JSON.stringify(d.user));
        console.log('[EWS Auth] Auto-login:', d.user.name);
      } else {
        // Token expired — show auth screen
        localStorage.removeItem(EWS_AUTH_KEY);
        ews_showAuthScreen();
      }
    }).catch(() => {
      // Server offline — allow through (offline mode)
      console.log('[EWS Auth] Server offline — offline mode');
    });
    return; // Don't show screen while validating
  }
  
  // No token — show auth screen
  ews_showAuthScreen();
}

function ews_showAuthScreen() {
  // Don't show twice
  if (document.getElementById('ews-auth-screen')) return;
  const div = document.createElement('div');
  div.innerHTML = AUTH_SCREEN_HTML;
  document.body.appendChild(div.firstChild);
  // Auto-focus name field
  setTimeout(() => {
    const f = document.getElementById('ews-login-name');
    if (f) f.focus();
  }, 300);
}

// Expose globally for Lovable to use
window.EWS_checkAuth = ews_checkAuth;
window.EWS_logout = function() {
  localStorage.removeItem(EWS_AUTH_KEY);
  localStorage.removeItem(EWS_USER_KEY);
  location.reload();
};

// ─── Wait for Lovable map to be ready ─────────────────────────────────────
function waitForMap(cb, ms=200) {
  if (typeof map !== 'undefined' && map && map.getCenter) cb();
  else setTimeout(() => waitForMap(cb, ms), ms);
}

// ─── Haversine distance ────────────────────────────────────────────────────
function ews_hav(lat1, lon1, lat2, lon2) {
  const R = 6371, dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. USER LOCATION — GPS tracking + map marker
// ═══════════════════════════════════════════════════════════════════════════
window.EWS = window.EWS || {};
EWS.userPos = null;
EWS.userMarker = null;
EWS.accuracyCircle = null;
EWS.watchId = null;

function ews_startGPS() {
  if (!navigator.geolocation) {
    console.warn('[EWS] Geolocation not supported');
    return;
  }

  const opts = { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 };

  // One-time fast fix
  navigator.geolocation.getCurrentPosition(ews_onPos, ews_onGPSErr, opts);

  // Continuous watch
  EWS.watchId = navigator.geolocation.watchPosition(ews_onPos, ews_onGPSErr, opts);
}

function ews_onPos(pos) {
  const lat = pos.coords.latitude;
  const lng = pos.coords.longitude;
  const acc = pos.coords.accuracy;
  EWS.userPos = { lat, lng, acc };

  waitForMap(() => {
    // Remove old marker
    if (EWS.userMarker) { map.removeLayer(EWS.userMarker); }
    if (EWS.accuracyCircle) { map.removeLayer(EWS.accuracyCircle); }

    // Create user position pane
    if (!map.getPane('ews_user')) {
      const pe = map.createPane('ews_user');
      pe.style.zIndex = 650;
    }

    // Accuracy ring
    EWS.accuracyCircle = L.circle([lat, lng], {
      radius: acc, color: 'rgba(0,207,255,.5)', fillColor: 'rgba(0,207,255,.08)',
      fillOpacity: 1, weight: 1, pane: 'ews_user'
    }).addTo(map);

    // User marker — pulsing blue dot
    const ico = L.divIcon({ html: `
      <div style="position:relative;width:20px;height:20px">
        <div style="position:absolute;inset:0;border-radius:50%;background:rgba(0,120,255,.2);animation:ews_pulse 2s ease-out infinite"></div>
        <div style="position:absolute;inset:4px;border-radius:50%;background:#0088ff;border:2px solid #fff;box-shadow:0 0 12px rgba(0,136,255,.8)"></div>
      </div>`, className: '', iconAnchor: [10, 10] });

    EWS.userMarker = L.marker([lat, lng], { icon: ico, pane: 'ews_user', zIndexOffset: 9000 }).addTo(map);
    EWS.userMarker.bindTooltip('📍 מיקומך הנוכחי', { direction: 'top', permanent: false });

    // Update status
    ews_updateGPSStatus(lat, lng, acc);

    // Recalculate all distances to active alerts
    ews_updateAllDistances();
  });
}

function ews_onGPSErr(err) {
  console.warn('[EWS GPS]', err.message);
  const el = document.getElementById('ews-gps-status');
  if (el) el.textContent = '📍 GPS: לא זמין';
}

function ews_updateGPSStatus(lat, lng, acc) {
  const el = document.getElementById('ews-gps-status');
  if (el) el.innerHTML = `📍 ${lat.toFixed(4)}, ${lng.toFixed(4)} <span style="font-size:8px;color:rgba(255,255,255,.4)">±${Math.round(acc)}m</span>`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. DISTANCE TO IMPACT — חישוב מרחק לנפילה
// ═══════════════════════════════════════════════════════════════════════════
EWS.activeImpacts = [];
EWS.distBanner = null;

function ews_addImpact(lat, lng, cityName, source, text) {
  if (!lat || !lng) return;
  const impact = { lat, lng, city: cityName, source, text, ts: Date.now() };
  EWS.activeImpacts.push(impact);

  // Add impact marker on map
  waitForMap(() => {
    if (!map.getPane('ews_impact')) {
      const pe = map.createPane('ews_impact');
      pe.style.zIndex = 600;
    }

    // Crosshair rings
    const ring1 = L.circle([lat, lng], {
      radius: 500, color: '#ff0050', fillColor: 'rgba(255,0,80,.15)',
      fillOpacity: 1, weight: 2, dashArray: '4,4', pane: 'ews_impact'
    }).addTo(map);
    const ring2 = L.circle([lat, lng], {
      radius: 2000, color: 'rgba(255,0,80,.4)', fillColor: 'transparent',
      fillOpacity: 0, weight: 1, dashArray: '4,8', pane: 'ews_impact'
    }).addTo(map);

    // Impact icon
    const ico = L.divIcon({ html: `
      <div style="text-align:center">
        <div style="font-size:20px;animation:ews_fall .4s infinite alternate">☄️</div>
        <div style="background:rgba(0,0,0,.9);border:1px solid #ff005055;border-radius:4px;padding:1px 6px;font-size:8px;font-family:'Share Tech Mono',monospace;color:#ff8888;white-space:nowrap">${cityName||'נפילה'}</div>
      </div>`, className: '', iconAnchor: [20, 2] });
    const mk = L.marker([lat, lng], { icon: ico, pane: 'ews_impact', zIndexOffset: 800 }).addTo(map);

    // Draw line from user to impact
    if (EWS.userPos) {
      const dist = ews_hav(EWS.userPos.lat, EWS.userPos.lng, lat, lng);
      const line = L.polyline([[EWS.userPos.lat, EWS.userPos.lng], [lat, lng]], {
        color: 'rgba(255,200,0,.6)', weight: 1.5, dashArray: '6,4', pane: 'ews_impact'
      }).addTo(map);
      const midLat = (EWS.userPos.lat + lat) / 2;
      const midLng = (EWS.userPos.lng + lng) / 2;
      const distIco = L.divIcon({ html: `<div style="background:rgba(0,0,0,.85);border:1px solid rgba(255,200,0,.4);border-radius:4px;padding:2px 7px;font-size:9px;font-family:'Share Tech Mono',monospace;color:#ffcc00;white-space:nowrap">${Math.round(dist)} ק"מ</div>`, className: '', iconAnchor: [20, 8] });
      L.marker([midLat, midLng], { icon: distIco, pane: 'ews_impact', interactive: false }).addTo(map);

      // Show distance banner
      ews_showDistBanner(dist, cityName, lat, lng);

      // Auto-remove line after 5 min
      setTimeout(() => { try { map.removeLayer(line); } catch {} }, 300000);
    }

    setTimeout(() => {
      try { map.removeLayer(ring1); map.removeLayer(ring2); map.removeLayer(mk); } catch {}
    }, 600000); // 10 min
  });
}

function ews_showDistBanner(distKm, city, impLat, impLng) {
  let banner = document.getElementById('ews-dist-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'ews-dist-banner';
    banner.style.cssText = `
      position:fixed;bottom:36px;left:50%;transform:translateX(-50%);z-index:800;
      background:rgba(2,5,8,.97);border:1px solid rgba(255,0,80,.5);
      border-radius:18px;padding:6px 18px;white-space:nowrap;pointer-events:none;
      display:flex;align-items:center;gap:12px;font-family:'Share Tech Mono',monospace;
    `;
    document.body.appendChild(banner);
  }
  const urgency = distKm < 5 ? '#ff003c' : distKm < 20 ? '#ff4422' : distKm < 50 ? '#ff8800' : '#ffdd00';
  banner.innerHTML = `
    <span style="font-size:8px;color:rgba(255,255,255,.4)">📍 אתה</span>
    <span style="font-size:14px;font-weight:900;color:${urgency}">${Math.round(distKm)} ק"מ</span>
    <span style="font-size:8px;color:rgba(255,255,255,.4)">← ☄️ ${city||'נפילה'}</span>
  `;
  banner.style.borderColor = urgency + '88';
  if (distKm < 10) banner.style.animation = 'ews_pulse 1s infinite';
  setTimeout(() => { if (banner) banner.remove(); }, 120000);
}

function ews_updateAllDistances() {
  if (!EWS.userPos || !EWS.activeImpacts.length) return;
  EWS.activeImpacts.forEach(imp => {
    const dist = ews_hav(EWS.userPos.lat, EWS.userPos.lng, imp.lat, imp.lng);
    console.log(`[EWS] ${imp.city}: ${Math.round(dist)} ק"מ ממך`);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. THERMAL MONITORING — NASA FIRMS + EUMETSAT
// ═══════════════════════════════════════════════════════════════════════════
EWS.thermalData = [];
EWS.thermalLayer = null;
EWS.thermalVisible = false;
EWS.lastThermalScan = 0;

// Threat launch zones for thermal monitoring

// ── SMART SERVER URL DETECTION ────────────────────────────────────────────
window._EWS_SERVER = (function() {
  // 1. Explicit override (set in Lovable env or manually)
  if (window._EWS_SERVER_URL) return window._EWS_SERVER_URL;
  // 2. Same origin (Mac or Railway — warwatch.html served by server.js)
  if (location.hostname !== 'localhost' && !location.hostname.includes('lovable')) {
    return location.origin;
  }
  // 3. Lovable app — check localStorage for server URL
  const stored = localStorage.getItem('ews_server_url');
  if (stored) return stored;
  // 4. Fallback to localhost
  return 'http://localhost:3000';
})();

// Show server URL in GPS panel for debugging
console.log('[EWS] Server URL:', window._EWS_SERVER);

const EWS_LAUNCH_ZONES = [
  { id: 'iran_shahrud',  name: 'Shahrud — Iran',   lat: 36.2, lng: 54.8, bbox: '52,35,57,37', frpMin: 200, color: '#ff0050' },
  { id: 'iran_isfahan',  name: 'Isfahan — Iran',   lat: 32.5, lng: 51.5, bbox: '50,31,54,34', frpMin: 150, color: '#ff0050' },
  { id: 'leb_baalbek',   name: 'Baalbek — Lebanon',lat: 33.8, lng: 35.7, bbox: '35,33,37,34.5',frpMin: 40,  color: '#ff4422' },
  { id: 'gaza_strip',    name: 'Gaza Strip',        lat: 31.4, lng: 34.4, bbox: '34.2,31.2,34.6,31.8',frpMin: 20, color: '#ff6600' },
  { id: 'yemen_sanaa',   name: 'Yemen — Houthis',  lat: 15.3, lng: 44.2, bbox: '42,13,47,16', frpMin: 80,  color: '#ffcc00' },
  { id: 'syria_deir',    name: 'Syria — IRGC',     lat: 35.3, lng: 40.1, bbox: '38,33,42,37', frpMin: 60,  color: '#cc2200' },
];

// Israel monitoring zones
const EWS_ISRAEL_ZONES = [
  { id: 'north_il',  name: 'צפון ישראל',    bbox: '34.8,32.5,36.0,33.4', frpMin: 15, color: '#ff4422' },
  { id: 'center_il', name: 'מרכז ישראל',    bbox: '34.5,31.5,35.5,32.5', frpMin: 10, color: '#ff8800' },
  { id: 'south_il',  name: 'דרום ישראל',    bbox: '34.0,29.5,35.5,31.5', frpMin: 10, color: '#ffdd00' },
  { id: 'gaza_env',  name: 'עוטף עזה',      bbox: '34.2,31.1,34.7,31.7', frpMin: 5,  color: '#ff0050' },
];

async function ews_scanThermal() {
  const now = Date.now();
  if (now - EWS.lastThermalScan < 180000) return; // every 3 min
  EWS.lastThermalScan = now;

  const firmsKey = (window._FIRMS_KEY || '').trim();
  if (!firmsKey) {
    // Demo mode — simulate thermal data
    ews_addThermalDemo();
    return;
  }

  const allZones = [...EWS_LAUNCH_ZONES, ...EWS_ISRAEL_ZONES];
  for (const zone of allZones) {
    try {
      // Proxy through our server if available (avoids CORS)
      const firmsBase = `${window._EWS_SERVER}/proxy/firms`;
      const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${firmsKey}/VIIRS_NOAA20_NRT/${zone.bbox}/1`;
      const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (!r.ok) continue;
      const csv = await r.text();
      const lines = csv.trim().split('\n');
      if (lines.length < 2) continue;
      const hdr = lines[0].split(',');
      lines.slice(1).forEach(line => {
        const cols = line.split(',');
        const row = {};
        hdr.forEach((h, i) => row[h.trim()] = (cols[i] || '').trim());
        const frp = parseFloat(row.frp || 0);
        if (frp < zone.frpMin) return;
        const key = `${zone.id}:${row.acq_date}:${row.latitude?.slice(0,6)}`;
        if (EWS.thermalData.find(d => d.key === key)) return;
        const det = {
          key, zone, frp, satellite: 'VIIRS-NOAA20',
          lat: parseFloat(row.latitude), lng: parseFloat(row.longitude),
          date: row.acq_date, time: row.acq_time,
        };
        EWS.thermalData.unshift(det);
        if (EWS.thermalData.length > 100) EWS.thermalData.pop();
        ews_onThermalDetection(det);
      });
    } catch (e) { /* zone failed — continue */ }
  }
}

function ews_addThermalDemo() {
  // Show simulated thermal markers for demo when no FIRMS key
  const demos = [
    { lat: 36.2, lng: 54.8, frp: 45, zone: EWS_LAUNCH_ZONES[0], note: 'Demo' },
    { lat: 31.4, lng: 34.4, frp: 22, zone: EWS_ISRAEL_ZONES[3], note: 'Demo' },
  ];
  demos.forEach(d => ews_onThermalDetection({ ...d, key: 'demo_' + d.lat, satellite: 'Demo', date: new Date().toISOString().slice(0,10) }));
}

function ews_onThermalDetection(det) {
  const { zone, frp, lat, lng } = det;
  const urgency = frp > 500 ? 'CRITICAL' : frp > 200 ? 'HIGH' : frp > 50 ? 'MEDIUM' : 'LOW';
  const col = urgency === 'CRITICAL' ? '#ff003c' : frp > 200 ? '#ff6600' : frp > 50 ? '#ffcc00' : '#aaaaff';

  waitForMap(() => {
    if (!map.getPane('ews_thermal')) {
      const pe = map.createPane('ews_thermal'); pe.style.zIndex = 460;
    }
    const ico = L.divIcon({ html: `
      <div style="text-align:center">
        <div style="font-size:${urgency==='CRITICAL'?20:15}px;filter:drop-shadow(0 0 8px ${col});animation:${urgency==='CRITICAL'?'ews_pulse .8s infinite':'none'}">🌡</div>
        <div style="background:rgba(0,0,0,.9);border:1px solid ${col}55;border-radius:3px;padding:1px 5px;font-size:7px;font-family:'Share Tech Mono',monospace;color:${col};white-space:nowrap">${zone.name.slice(0,16)} ${Math.round(frp)}MW</div>
      </div>`, className: '', iconAnchor: [16, 0] });

    const mk = L.marker([lat, lng], { icon: ico, pane: 'ews_thermal', zIndexOffset: 500 }).addTo(map);
    mk.bindPopup(`<div class="map-popup" style="border-color:${col}">
      <div style="color:${col};font-size:12px;font-weight:900">🌡 ${zone.name}</div>
      <div style="font-size:9px;color:var(--text,#8ab0c4);margin:4px 0">FRP: ${Math.round(frp)} MW | ${urgency}</div>
      <div style="font-size:9px;color:var(--dim,#2a4060)">${det.satellite} | ${det.date}</div>
    </div>`, { maxWidth: 200, className: '' });

    // If high FRP — alert
    if (frp >= zone.frpMin * 2) {
      if (typeof showFlash === 'function') {
        showFlash(`🛰 ${urgency}: ${zone.name}`, `FRP: ${Math.round(frp)}MW | ${det.satellite}`, frp > 300);
      }
    }

    setTimeout(() => { try { map.removeLayer(mk); } catch {} }, 21600000); // 6h
  });

  // Update thermal sidebar
  ews_renderThermalSidebar();
}

function ews_toggleThermal(on) {
  EWS.thermalVisible = on;
  const btn = document.getElementById('ews-btn-thermal');
  if (btn) btn.classList.toggle('on', on);
  if (on) {
    ews_scanThermal();
    setInterval(ews_scanThermal, 180000);
  }
}

function ews_renderThermalSidebar() {
  const el = document.getElementById('ews-tc-thermal');
  if (!el) return;
  if (!EWS.thermalData.length) {
    el.innerHTML = '<div style="padding:16px;text-align:center;font-size:9px;color:var(--dim,#2a4060)">אין נתונים תרמיים — הפעל FIRMS</div>';
    return;
  }
  el.innerHTML = `<div style="padding:6px 10px;font-size:8px;color:var(--dim,#2a4060);border-bottom:1px solid var(--border,#0c1e2e)">${EWS.thermalData.length} זיהויים תרמיים פעילים</div>` +
    EWS.thermalData.slice(0, 20).map(d => {
      const col = d.frp > 200 ? '#ff6600' : d.frp > 50 ? '#ffcc00' : '#4488ff';
      return `<div style="padding:7px 10px;border-bottom:1px solid rgba(255,255,255,.04);border-right:2px solid ${col};cursor:pointer" onclick="map.flyTo([${d.lat},${d.lng}],10)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
          <span style="color:${col};font-size:10px;font-weight:700">🌡 ${d.zone.name}</span>
          <span style="font-family:'Share Tech Mono',monospace;font-size:10px;color:${col}">${Math.round(d.frp)}MW</span>
        </div>
        <div style="font-size:8px;color:var(--dim,#2a4060)">${d.satellite} | ${d.date}</div>
      </div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. OREF HOOK — intercept alerts and calculate distance
// ═══════════════════════════════════════════════════════════════════════════
function ews_hookOref() {
  // Hook into existing OREF polling if it exists
  // Try various function names used in different versions
  const triggerFns = ['triggerOref', 'triggerOrefWW', 'handleOref'];
  triggerFns.forEach(fnName => {
    if (typeof window[fnName] === 'function') {
      const orig = window[fnName];
      window[fnName] = function(d) {
        orig.call(this, d);
        // EWS: calculate distances
        const areas = d.data || d.areas || [];
        if (EWS.userPos && areas.length) {
          ews_calcOrefDistances(areas, d.title || 'צבע אדום');
        }
      };
      console.log(`[EWS] Hooked ${fnName} ✅`);
    }
  });
}

function ews_calcOrefDistances(areas, title) {
  if (!EWS.userPos) return;
  // Find closest area to user
  let minDist = Infinity, closestArea = null, closestCoords = null;

  const settleLookup = typeof ALL_SETTLEMENTS !== 'undefined' ? ALL_SETTLEMENTS : [];
  areas.forEach(area => {
    const settlement = settleLookup.find(s => area.includes(s.n.slice(0, 3)) || s.n.includes(area.slice(0, 3)));
    if (settlement) {
      const dist = ews_hav(EWS.userPos.lat, EWS.userPos.lng, settlement.lat, settlement.lng);
      if (dist < minDist) {
        minDist = dist;
        closestArea = area;
        closestCoords = { lat: settlement.lat, lng: settlement.lng };
      }
    }
  });

  if (closestArea && closestCoords) {
    ews_showDistBanner(minDist, closestArea, closestCoords.lat, closestCoords.lng);
    ews_addImpact(closestCoords.lat, closestCoords.lng, closestArea, 'OREF', title);
  }
}

// Hook into WS messages for TG impact events
function ews_hookWS() {
  // Monitor for impact messages from TG
  const origAddTGMsg = window.addTGMsg;
  if (typeof origAddTGMsg === 'function') {
    window.addTGMsg = function(msg) {
      origAddTGMsg.call(this, msg);
      if (msg.hasImpact && msg.impactLat && msg.impactLng) {
        ews_addImpact(msg.impactLat, msg.impactLng, msg.impactCity || '?', msg.chatName, msg.text);
      }
    };
    console.log('[EWS] Hooked addTGMsg ✅');
  }

  // Monitor WS if raw WebSocket exists
  const origWS = window.WebSocket;
  window.WebSocket = function(...args) {
    const ws = new origWS(...args);
    const origOnMsg = ws.onmessage;
    ws.addEventListener('message', ev => {
      try {
        const m = JSON.parse(ev.data);
        if (m.type === 'OREF_ALERT') {
          const areas = m.payload?.data || [];
          if (EWS.userPos && areas.length) ews_calcOrefDistances(areas, m.payload?.title || '');
        }
        if (m.type === 'IMPACT_EVENT' && m.payload?.lat) {
          ews_addImpact(m.payload.lat, m.payload.lng, m.payload.city || '?', 'TG', m.payload.text || '');
        }
      } catch {}
    });
    return ws;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. INJECT UI — add panels without touching existing HTML
// ═══════════════════════════════════════════════════════════════════════════
function ews_injectUI() {
  // CSS animations
  const style = document.createElement('style');
  style.textContent = `
    @keyframes ews_pulse {0%{transform:scale(1);opacity:.8}50%{transform:scale(1.4);opacity:.4}100%{transform:scale(1);opacity:.8}}
    @keyframes ews_fall {0%{transform:translateY(-3px)}100%{transform:translateY(3px)}}
    .ews-panel{position:fixed;z-index:800;background:rgba(2,5,8,.97);border:1px solid #0c1e2e;border-radius:8px;font-family:'Share Tech Mono',monospace;font-size:9px;color:#8ab0c4;}
    .ews-btn{background:rgba(0,207,255,.07);border:1px solid rgba(0,207,255,.2);border-radius:5px;color:#00cfff;padding:4px 9px;font-size:9px;cursor:pointer;font-family:'Share Tech Mono',monospace;white-space:nowrap;}
    .ews-btn.on{background:rgba(0,255,136,.08);border-color:#00ff88;color:#00ff88;}
    .ews-btn:hover{background:rgba(0,207,255,.15);}
    #ews-gps-panel{bottom:36px;left:50%;transform:translateX(-50%);padding:5px 14px;display:flex;align-items:center;gap:12px;min-width:280px;justify-content:center;}
    #ews-layer-btns{top:${window.innerWidth<768?'55':'12'}px;left:12px;display:flex;flex-direction:column;gap:4px;z-index:401;}
    #ews-sidebar{position:fixed;left:0;top:0;bottom:30px;width:272px;background:rgba(4,9,15,.98);border-right:1px solid #0c1e2e;display:none;flex-direction:column;z-index:450;transform:translateX(-100%);transition:transform .3s;}
    #ews-sidebar.open{transform:translateX(0);}
    #ews-toggle-btn{position:fixed;right:0;top:50%;transform:translateY(-50%);z-index:401;background:rgba(4,9,15,.95);border:1px solid rgba(0,207,255,.2);border-radius:8px 0 0 8px;padding:10px 8px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;}
    .ews-tab{flex:1;padding:7px 0;text-align:center;font-size:8px;font-weight:700;color:#2a4060;cursor:pointer;border-bottom:2px solid transparent;}
    .ews-tab.active{color:#00cfff;border-bottom-color:#00cfff;}
    .ews-tc{display:none;flex:1;overflow-y:auto;flex-direction:column;}
    .ews-tc.active{display:flex;}
  `;
  document.head.appendChild(style);

  // GPS status strip (bottom center)
  const gpsBanner = document.createElement('div');
  gpsBanner.id = 'ews-gps-panel';
  gpsBanner.className = 'ews-panel';
  gpsBanner.innerHTML = `
    <span id="ews-gps-status" style="color:#00cfff">📍 מחפש מיקום...</span>
    <button class="ews-btn" onclick="EWS.flyToUser()">🎯 מיקומי</button>
    <button class="ews-btn" id="ews-btn-thermal" onclick="ews_toggleThermal(!EWS.thermalVisible)">🌡 תרמי</button>
    <button class="ews-btn" onclick="ews_toggleSidebar()">🛸 EWS</button>
    <button class="ews-btn" onclick="ews_setServerURL()" id="ews-server-btn" title="${window._EWS_SERVER}">⚙️ שרת</button>
  `;
  document.body.appendChild(gpsBanner);

  // EWS Sidebar
  const sidebar = document.createElement('div');
  sidebar.id = 'ews-sidebar';
  sidebar.innerHTML = `
    <div style="padding:8px 12px;background:rgba(0,207,255,.04);border-bottom:1px solid #0c1e2e;display:flex;align-items:center;justify-content:space-between;flex-shrink:0">
      <span style="color:#00cfff;letter-spacing:2px;font-size:9px">🛸 EWS ADDON</span>
      <span onclick="ews_toggleSidebar()" style="cursor:pointer;color:#2a4060;padding:2px 8px;font-size:13px">✕</span>
    </div>
    <div style="display:flex;border-bottom:1px solid #0c1e2e;flex-shrink:0">
      <div class="ews-tab active" onclick="ews_showTab('thermal',this)">🌡 תרמי</div>
      <div class="ews-tab" onclick="ews_showTab('impacts',this)">☄️ נפילות</div>
      <div class="ews-tab" onclick="ews_showTab('zones',this)">🗺 אזורים</div>
    </div>
    <div id="ews-tc-thermal"  class="ews-tc active"><div style="padding:16px;text-align:center;font-size:9px;color:#2a4060">הפעל ניטור תרמי</div></div>
    <div id="ews-tc-impacts"  class="ews-tc"></div>
    <div id="ews-tc-zones"    class="ews-tc"></div>
  `;
  document.body.appendChild(sidebar);
}

function ews_toggleSidebar() {
  const sb = document.getElementById('ews-sidebar');
  if (sb) sb.classList.toggle('open');
}

function ews_showTab(id, el) {
  document.querySelectorAll('.ews-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  document.querySelectorAll('.ews-tc').forEach(t => t.classList.remove('active'));
  const tc = document.getElementById('ews-tc-' + id);
  if (tc) tc.classList.add('active');
}

function ews_renderImpactsSidebar() {
  const el = document.getElementById('ews-tc-impacts');
  if (!el) return;
  if (!EWS.activeImpacts.length) {
    el.innerHTML = '<div style="padding:20px;text-align:center;font-size:9px;color:#2a4060">☄️ אין נפילות מזוהות</div>';
    return;
  }
  el.innerHTML = EWS.activeImpacts.slice(0, 15).map(imp => {
    const dist = EWS.userPos ? Math.round(ews_hav(EWS.userPos.lat, EWS.userPos.lng, imp.lat, imp.lng)) : '?';
    const col = typeof dist === 'number' ? (dist < 5 ? '#ff003c' : dist < 20 ? '#ff4422' : dist < 50 ? '#ff8800' : '#ffdd00') : '#ffdd00';
    const t = new Date(imp.ts).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });
    return `<div style="padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.04);border-right:2px solid ${col};cursor:pointer" onclick="map.flyTo([${imp.lat},${imp.lng}],13)">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">
        <span style="color:${col};font-size:11px;font-weight:700">☄️ ${imp.city}</span>
        <span style="font-size:10px;color:${col};font-family:'Share Tech Mono',monospace">${dist} ק"מ</span>
      </div>
      <div style="font-size:8px;color:#2a4060">${imp.source} | ${t}</div>
    </div>`;
  }).join('');
}

// ── Helper: fly to user ──────────────────────────────────────────────────
EWS.flyToUser = function() {
  if (EWS.userPos && typeof map !== 'undefined') {
    map.flyTo([EWS.userPos.lat, EWS.userPos.lng], 13, { duration: 1.2 });
  } else {
    alert('GPS: ממתין למיקום...');
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// 6. INIT — boot everything
// ═══════════════════════════════════════════════════════════════════════════
function ews_init() {
  console.log('[EWS Addon] Initializing...');
  ews_checkAuth();
  ews_injectUI();
  ews_startGPS();
  ews_hookOref();
  ews_hookWS();
  // Start thermal scan
  setInterval(ews_scanThermal, 180000);
  // Update impacts sidebar periodically
  setInterval(() => { ews_renderImpactsSidebar(); }, 10000);
  console.log('[EWS Addon] Ready ✅ — GPS + Thermal + Distance active');
}

// Wait for DOM + map
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => setTimeout(ews_init, 2000));
} else {
  setTimeout(ews_init, 2000);
}


// ── SERVER URL CONFIGURATION ─────────────────────────────────────────────
function ews_setServerURL() {
  const current = localStorage.getItem('ews_server_url') || 'http://localhost:3000';
  const url = prompt(
    '🖥️ כתובת שרת EWS\n\nדוגמאות:\n• מקומי: http://localhost:3000\n• ngrok: https://abc123.ngrok-free.app\n• Railway: https://ews.up.railway.app',
    current
  );
  if (url && url.startsWith('http')) {
    localStorage.setItem('ews_server_url', url.trim().replace(/\/$/, ''));
    window._EWS_SERVER = url.trim().replace(/\/$/, '');
    // Test connection
    fetch(window._EWS_SERVER + '/health')
      .then(r => r.json())
      .then(d => {
        const btn = document.getElementById('ews-server-btn');
        if (btn) { btn.textContent = '✅ שרת'; btn.style.borderColor = '#00ff88'; }
        console.log('[EWS] Server connected:', d);
      })
      .catch(() => {
        const btn = document.getElementById('ews-server-btn');
        if (btn) { btn.textContent = '❌ שרת'; btn.style.borderColor = '#ff003c'; }
      });
  }
}

// Test server on load
setTimeout(() => {
  fetch(window._EWS_SERVER + '/health')
    .then(r => r.json())
    .then(d => {
      const btn = document.getElementById('ews-server-btn');
      if (btn) { btn.textContent = '✅ שרת'; btn.style.borderColor = '#00ff88'; }
      const statusEl = document.getElementById('ews-gps-status');
      if (statusEl) statusEl.title = 'Server: ' + window._EWS_SERVER;
    })
    .catch(() => {
      const btn = document.getElementById('ews-server-btn');
      if (btn) { btn.textContent = '⚙️ שרת'; btn.style.borderColor = 'rgba(0,207,255,.2)'; }
    });
}, 3000);

})(); // IIFE — no global namespace pollution

import { useRef, useEffect, useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

// ── Edge function name → node ID mapping ──
const EDGE_FN_TO_NODE: Record<string, string> = {
  'telegram-poll': 'tg_poll',
  'telegram-public-scrape': 'tg_scrape',
  'oref-alerts': 'oref_fn',
  'emergency-feed': 'emerg_fn',
  'nasa-firms': 'nasa_fn',
  'nasa-eonet': 'nasa_fn',
  'usgs-earthquakes': 'usgs_fn',
  'opensky-flights': 'opensky_fn',
  'traffic-check': 'traffic_fn',
  'sentiment-analysis': 'sentiment_fn',
  'situation-analysis': 'sentiment_fn',
  'daily-intel-report': 'daily_fn',
  'translate-headlines': 'translate_fn',
  'news-flash': 'news_fn',
  'centcom-nato-feed': 'centcom_fn',
  'x-feed-scrape': 'news_fn',
  'cisa-kev': 'centcom_fn',
  'system-health-check': 'bot_state',
};

const HEALTH_CHECK_FUNCTIONS = [
  'telegram-poll', 'telegram-public-scrape', 'news-flash', 'x-feed-scrape',
  'centcom-nato-feed', 'oref-alerts', 'emergency-feed', 'cisa-kev',
  'nasa-firms', 'nasa-eonet', 'usgs-earthquakes', 'opensky-flights',
  'traffic-check', 'sentiment-analysis', 'situation-analysis',
  'daily-intel-report', 'translate-headlines', 'system-health-check',
];

interface HealthResult {
  status: 'ok' | 'error' | 'pending';
  latency: number | null;
  fnName: string;
}

// ═══════════════════════════════════════════════
// ANIMATED SYSTEM ARCHITECTURE — PACKET FLOW
// Canvas-based real-time data flow visualization
// ═══════════════════════════════════════════════

interface Node {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  glow: string;
  category: string;
  icon: string;
  pulsePhase: number;
  liveCount?: number;
}

interface Connection {
  from: string;
  to: string;
  color: string;
  speed: number; // packets per second
  label?: string;
  avgLatencyMs?: number; // avg response time
  memoryMB?: number; // estimated memory usage
}

interface Packet {
  connIdx: number;
  progress: number; // 0..1
  speed: number;
  size: number;
  color: string;
  glow: string;
  trail: number[];
}

// ── Node definitions with layout positions (normalized 0-1) ──
const NODES: Node[] = [
  // External APIs — left column
  { id: 'telegram_api', label: 'Telegram Bot', x: 0.02, y: 0.06, w: 0.11, h: 0.045, color: '#0088cc', glow: '#0088cc', category: 'ext', icon: '📡', pulsePhase: 0 },
  { id: 'tg_channels', label: 'TG Channels', x: 0.02, y: 0.13, w: 0.11, h: 0.045, color: '#0088cc', glow: '#29b6f6', category: 'ext', icon: '📢', pulsePhase: 0.3 },
  { id: 'oref_api', label: 'פיקוד העורף', x: 0.02, y: 0.20, w: 0.11, h: 0.045, color: '#ff1744', glow: '#ff1744', category: 'ext', icon: '🚨', pulsePhase: 0.5 },
  { id: 'nasa_api', label: 'NASA', x: 0.02, y: 0.27, w: 0.11, h: 0.045, color: '#00bcd4', glow: '#00bcd4', category: 'ext', icon: '🛰️', pulsePhase: 1 },
  { id: 'usgs_api', label: 'USGS', x: 0.02, y: 0.34, w: 0.11, h: 0.045, color: '#8bc34a', glow: '#8bc34a', category: 'ext', icon: '🌍', pulsePhase: 1.5 },
  { id: 'ai_gw', label: 'Lovable AI', x: 0.02, y: 0.41, w: 0.11, h: 0.045, color: '#ce93d8', glow: '#e040fb', category: 'ext', icon: '🧠', pulsePhase: 2 },
  { id: 'centcom_api', label: 'CENTCOM', x: 0.02, y: 0.48, w: 0.11, h: 0.045, color: '#ff6d00', glow: '#ff6d00', category: 'ext', icon: '🎖️', pulsePhase: 2.5 },
  { id: 'x_api', label: 'X / Twitter', x: 0.02, y: 0.55, w: 0.11, h: 0.045, color: '#90a4ae', glow: '#cfd8dc', category: 'ext', icon: '🐦', pulsePhase: 3 },
  { id: 'rss_news', label: 'RSS / News', x: 0.02, y: 0.62, w: 0.11, h: 0.045, color: '#ff9800', glow: '#ffb74d', category: 'ext', icon: '📰', pulsePhase: 3.2 },
  { id: 'opensky_api', label: 'OpenSky', x: 0.02, y: 0.69, w: 0.11, h: 0.045, color: '#4fc3f7', glow: '#81d4fa', category: 'ext', icon: '✈️', pulsePhase: 3.5 },
  { id: 'osrm_api', label: 'OSRM Traffic', x: 0.02, y: 0.76, w: 0.11, h: 0.045, color: '#66bb6a', glow: '#a5d6a7', category: 'ext', icon: '🚦', pulsePhase: 3.8 },

  // Edge Functions — center-left column
  { id: 'tg_poll', label: 'telegram-poll', x: 0.22, y: 0.06, w: 0.13, h: 0.042, color: '#1565c0', glow: '#42a5f5', category: 'edge', icon: '⚡', pulsePhase: 0.2 },
  { id: 'tg_scrape', label: 'tg-scrape', x: 0.22, y: 0.13, w: 0.13, h: 0.042, color: '#1565c0', glow: '#42a5f5', category: 'edge', icon: '⚡', pulsePhase: 0.4 },
  { id: 'oref_fn', label: 'oref-alerts', x: 0.22, y: 0.20, w: 0.13, h: 0.042, color: '#c62828', glow: '#ef5350', category: 'edge', icon: '⚡', pulsePhase: 0.6 },
  { id: 'emerg_fn', label: 'emergency-feed', x: 0.22, y: 0.27, w: 0.13, h: 0.042, color: '#c62828', glow: '#ef5350', category: 'edge', icon: '⚡', pulsePhase: 0.8 },
  { id: 'nasa_fn', label: 'nasa-firms', x: 0.22, y: 0.34, w: 0.13, h: 0.042, color: '#00838f', glow: '#26c6da', category: 'edge', icon: '⚡', pulsePhase: 1.0 },
  { id: 'usgs_fn', label: 'usgs-quakes', x: 0.22, y: 0.41, w: 0.13, h: 0.042, color: '#00838f', glow: '#26c6da', category: 'edge', icon: '⚡', pulsePhase: 1.2 },
  { id: 'sentiment_fn', label: 'sentiment', x: 0.22, y: 0.48, w: 0.13, h: 0.042, color: '#6a1b9a', glow: '#ce93d8', category: 'edge', icon: '⚡', pulsePhase: 1.4 },
  { id: 'daily_fn', label: 'daily-report', x: 0.22, y: 0.55, w: 0.13, h: 0.042, color: '#6a1b9a', glow: '#ce93d8', category: 'edge', icon: '⚡', pulsePhase: 1.6 },
  { id: 'news_fn', label: 'news-flash', x: 0.22, y: 0.62, w: 0.13, h: 0.042, color: '#1565c0', glow: '#42a5f5', category: 'edge', icon: '⚡', pulsePhase: 1.8 },
  { id: 'centcom_fn', label: 'centcom-nato', x: 0.22, y: 0.69, w: 0.13, h: 0.042, color: '#1565c0', glow: '#42a5f5', category: 'edge', icon: '⚡', pulsePhase: 2.0 },
  { id: 'opensky_fn', label: 'opensky-flights', x: 0.22, y: 0.76, w: 0.13, h: 0.042, color: '#00838f', glow: '#4fc3f7', category: 'edge', icon: '⚡', pulsePhase: 2.2 },
  { id: 'traffic_fn', label: 'traffic-check', x: 0.22, y: 0.83, w: 0.13, h: 0.042, color: '#00838f', glow: '#66bb6a', category: 'edge', icon: '⚡', pulsePhase: 2.4 },
  { id: 'translate_fn', label: 'translate', x: 0.22, y: 0.90, w: 0.13, h: 0.042, color: '#6a1b9a', glow: '#ce93d8', category: 'edge', icon: '⚡', pulsePhase: 2.6 },

  // Database — center column
  { id: 'tg_msgs', label: 'telegram_msgs', x: 0.44, y: 0.06, w: 0.13, h: 0.042, color: '#2e7d32', glow: '#66bb6a', category: 'db', icon: '🗄️', pulsePhase: 0.3 },
  { id: 'tg_groups', label: 'telegram_groups', x: 0.44, y: 0.14, w: 0.13, h: 0.042, color: '#2e7d32', glow: '#66bb6a', category: 'db', icon: '👥', pulsePhase: 0.5 },
  { id: 'oref_tbl', label: 'oref_alerts', x: 0.44, y: 0.22, w: 0.13, h: 0.042, color: '#2e7d32', glow: '#66bb6a', category: 'db', icon: '🗄️', pulsePhase: 0.7 },
  { id: 'emerg_tbl', label: 'emergency_events', x: 0.44, y: 0.30, w: 0.13, h: 0.042, color: '#2e7d32', glow: '#66bb6a', category: 'db', icon: '🗄️', pulsePhase: 1.1 },
  { id: 'intel_tbl', label: 'intel_reports', x: 0.44, y: 0.38, w: 0.13, h: 0.042, color: '#2e7d32', glow: '#66bb6a', category: 'db', icon: '🗄️', pulsePhase: 1.5 },
  { id: 'sent_tbl', label: 'sentiment_scores', x: 0.44, y: 0.46, w: 0.13, h: 0.042, color: '#2e7d32', glow: '#66bb6a', category: 'db', icon: '🗄️', pulsePhase: 1.9 },
  { id: 'daily_tbl', label: 'daily_intel', x: 0.44, y: 0.54, w: 0.13, h: 0.042, color: '#2e7d32', glow: '#66bb6a', category: 'db', icon: '🗄️', pulsePhase: 2.3 },
  { id: 'profiles', label: 'profiles', x: 0.44, y: 0.62, w: 0.13, h: 0.042, color: '#2e7d32', glow: '#66bb6a', category: 'db', icon: '🗄️', pulsePhase: 2.7 },
  { id: 'bot_state', label: 'bot_state', x: 0.44, y: 0.70, w: 0.13, h: 0.042, color: '#2e7d32', glow: '#66bb6a', category: 'db', icon: '🤖', pulsePhase: 3.0 },
  { id: 'push_subs', label: 'push_subs', x: 0.44, y: 0.78, w: 0.13, h: 0.042, color: '#2e7d32', glow: '#66bb6a', category: 'db', icon: '🔔', pulsePhase: 3.2 },

  // Realtime — center-right
  { id: 'pg_changes', label: 'PG Changes', x: 0.65, y: 0.25, w: 0.12, h: 0.055, color: '#6a1b9a', glow: '#ab47bc', category: 'rt', icon: '🔄', pulsePhase: 0.5 },
  { id: 'channels', label: 'Channels', x: 0.65, y: 0.45, w: 0.12, h: 0.055, color: '#6a1b9a', glow: '#ab47bc', category: 'rt', icon: '📡', pulsePhase: 1.0 },

  // Frontend — right column
  { id: 'war_room', label: 'War Room', x: 0.83, y: 0.08, w: 0.14, h: 0.055, color: '#0097a7', glow: '#26c6da', category: 'fe', icon: '🖥️', pulsePhase: 0.1 },
  { id: 'carplay', label: 'CarPlay', x: 0.83, y: 0.20, w: 0.14, h: 0.055, color: '#0097a7', glow: '#26c6da', category: 'fe', icon: '🚗', pulsePhase: 0.6 },
  { id: 'cmd_center', label: 'Command Center', x: 0.83, y: 0.32, w: 0.14, h: 0.055, color: '#0097a7', glow: '#26c6da', category: 'fe', icon: '🎛️', pulsePhase: 1.1 },
  { id: 'drive_mode', label: 'Drive Mode', x: 0.83, y: 0.44, w: 0.14, h: 0.055, color: '#0097a7', glow: '#26c6da', category: 'fe', icon: '🛣️', pulsePhase: 1.6 },
  { id: 'admin_pg', label: 'Admin', x: 0.83, y: 0.56, w: 0.14, h: 0.055, color: '#0097a7', glow: '#26c6da', category: 'fe', icon: '⚙️', pulsePhase: 2.1 },
  { id: 'tactical_map', label: 'Tactical Map', x: 0.83, y: 0.68, w: 0.14, h: 0.055, color: '#0097a7', glow: '#26c6da', category: 'fe', icon: '🗺️', pulsePhase: 2.5 },
];

// ── Connections (data flow paths) ──
const CONNECTIONS: Connection[] = [
  // External → Edge
  { from: 'telegram_api', to: 'tg_poll', color: '#0088cc', speed: 2.5, label: 'Bot Updates', avgLatencyMs: 120, memoryMB: 8 },
  { from: 'tg_channels', to: 'tg_scrape', color: '#29b6f6', speed: 1.5, label: '56 Channels', avgLatencyMs: 2800, memoryMB: 32 },
  { from: 'oref_api', to: 'oref_fn', color: '#ff1744', speed: 3.0, label: 'Alerts', avgLatencyMs: 85, memoryMB: 4 },
  { from: 'oref_api', to: 'emerg_fn', color: '#ff1744', speed: 1.0, avgLatencyMs: 150, memoryMB: 6 },
  { from: 'nasa_api', to: 'nasa_fn', color: '#00bcd4', speed: 0.8, avgLatencyMs: 3200, memoryMB: 18 },
  { from: 'usgs_api', to: 'usgs_fn', color: '#8bc34a', speed: 0.6, avgLatencyMs: 450, memoryMB: 5 },
  { from: 'ai_gw', to: 'sentiment_fn', color: '#ce93d8', speed: 1.2, label: 'AI', avgLatencyMs: 4500, memoryMB: 64 },
  { from: 'ai_gw', to: 'daily_fn', color: '#ce93d8', speed: 0.5, avgLatencyMs: 8200, memoryMB: 128 },
  { from: 'ai_gw', to: 'translate_fn', color: '#ce93d8', speed: 0.8, avgLatencyMs: 1200, memoryMB: 16 },
  { from: 'centcom_api', to: 'centcom_fn', color: '#ff6d00', speed: 0.7, avgLatencyMs: 600, memoryMB: 8 },
  { from: 'x_api', to: 'news_fn', color: '#90a4ae', speed: 1.0, avgLatencyMs: 950, memoryMB: 12 },
  { from: 'rss_news', to: 'news_fn', color: '#ff9800', speed: 1.5, label: '30+ RSS', avgLatencyMs: 3500, memoryMB: 42 },
  { from: 'opensky_api', to: 'opensky_fn', color: '#4fc3f7', speed: 0.8, label: 'Flights', avgLatencyMs: 5000, memoryMB: 24 },
  { from: 'osrm_api', to: 'traffic_fn', color: '#66bb6a', speed: 0.6, label: 'Routes', avgLatencyMs: 380, memoryMB: 6 },

  // Edge → Database
  { from: 'tg_poll', to: 'tg_msgs', color: '#42a5f5', speed: 2.5, label: 'INSERT', avgLatencyMs: 15, memoryMB: 2 },
  { from: 'tg_poll', to: 'tg_groups', color: '#42a5f5', speed: 1.0, avgLatencyMs: 10, memoryMB: 1 },
  { from: 'tg_poll', to: 'bot_state', color: '#42a5f5', speed: 0.8, avgLatencyMs: 8, memoryMB: 1 },
  { from: 'tg_scrape', to: 'tg_msgs', color: '#42a5f5', speed: 1.5, avgLatencyMs: 25, memoryMB: 4 },
  { from: 'tg_scrape', to: 'tg_groups', color: '#29b6f6', speed: 1.0, label: 'Groups', avgLatencyMs: 12, memoryMB: 2 },
  { from: 'oref_fn', to: 'oref_tbl', color: '#ef5350', speed: 3.0, label: 'INSERT', avgLatencyMs: 10, memoryMB: 1 },
  { from: 'emerg_fn', to: 'emerg_tbl', color: '#ef5350', speed: 1.0, avgLatencyMs: 18, memoryMB: 2 },
  { from: 'nasa_fn', to: 'emerg_tbl', color: '#26c6da', speed: 0.8, avgLatencyMs: 20, memoryMB: 3 },
  { from: 'usgs_fn', to: 'emerg_tbl', color: '#26c6da', speed: 0.6, avgLatencyMs: 12, memoryMB: 2 },
  { from: 'sentiment_fn', to: 'sent_tbl', color: '#ce93d8', speed: 1.2, avgLatencyMs: 35, memoryMB: 8 },
  { from: 'daily_fn', to: 'daily_tbl', color: '#ce93d8', speed: 0.5, avgLatencyMs: 50, memoryMB: 12 },
  { from: 'news_fn', to: 'intel_tbl', color: '#42a5f5', speed: 1.0, avgLatencyMs: 30, memoryMB: 6 },
  { from: 'centcom_fn', to: 'intel_tbl', color: '#42a5f5', speed: 0.7, avgLatencyMs: 22, memoryMB: 3 },
  { from: 'opensky_fn', to: 'emerg_tbl', color: '#4fc3f7', speed: 0.8, avgLatencyMs: 28, memoryMB: 4 },

  // Database → Realtime
  { from: 'tg_msgs', to: 'pg_changes', color: '#66bb6a', speed: 2.0, label: 'CHANGE', avgLatencyMs: 5, memoryMB: 1 },
  { from: 'tg_groups', to: 'pg_changes', color: '#66bb6a', speed: 1.0, avgLatencyMs: 3, memoryMB: 1 },
  { from: 'oref_tbl', to: 'pg_changes', color: '#66bb6a', speed: 2.5, avgLatencyMs: 5, memoryMB: 1 },
  { from: 'emerg_tbl', to: 'pg_changes', color: '#66bb6a', speed: 1.5, avgLatencyMs: 5, memoryMB: 1 },
  { from: 'intel_tbl', to: 'pg_changes', color: '#66bb6a', speed: 1.0, avgLatencyMs: 5, memoryMB: 1 },
  { from: 'pg_changes', to: 'channels', color: '#ab47bc', speed: 3.0, label: 'BROADCAST', avgLatencyMs: 2, memoryMB: 1 },

  // Realtime → Frontend
  { from: 'channels', to: 'war_room', color: '#26c6da', speed: 3.0, label: 'SUBSCRIBE', avgLatencyMs: 8, memoryMB: 2 },
  { from: 'channels', to: 'carplay', color: '#26c6da', speed: 2.0, avgLatencyMs: 8, memoryMB: 2 },
  { from: 'channels', to: 'cmd_center', color: '#26c6da', speed: 2.5, avgLatencyMs: 8, memoryMB: 2 },
  { from: 'channels', to: 'drive_mode', color: '#26c6da', speed: 1.5, avgLatencyMs: 8, memoryMB: 2 },
  { from: 'channels', to: 'tactical_map', color: '#26c6da', speed: 2.0, avgLatencyMs: 8, memoryMB: 2 },
];

// ── Bottleneck thresholds ──
const BOTTLENECK_LATENCY_MS = 3000; // > 3s = bottleneck
const BOTTLENECK_MEMORY_MB = 50; // > 50MB = heavy

// ── Load-based color scale (traffic congestion on lines) ──
// loadRatio = inFlightPackets / expectedSteadyState (= speed * 2.5s avg flight time)
function loadColor(ratio: number): string {
  if (ratio >= 1.0) return '#ff1744';   // CRITICAL — over capacity
  if (ratio >= 0.8) return '#ff6d00';   // HIGH — orange
  if (ratio >= 0.5) return '#ffd740';   // MEDIUM — yellow
  if (ratio >= 0.2) return '#76ff03';   // NORMAL — light green
  return '#00bcd4';                      // IDLE — cyan
}
function loadLabel(ratio: number): string {
  if (ratio >= 1.0) return 'OVERLOAD';
  if (ratio >= 0.8) return 'HIGH';
  if (ratio >= 0.5) return 'MEDIUM';
  if (ratio >= 0.2) return 'NORMAL';
  return 'IDLE';
}

// ── Rich node detail metadata ──
interface NodeDetail {
  description: string;
  tech: string;
  inputs: string[];
  outputs: string[];
  fields?: string[];
  schedule?: string;
  rls?: string;
  status?: string;
}

const NODE_DETAILS: Record<string, NodeDetail> = {
  telegram_api: { description: 'Telegram Bot API — מקבל עדכונים מ-3 בוטים (Gold, Red, Blue) באמצעות long-polling.', tech: 'Bot API v7 / getUpdates', inputs: ['User messages', 'Group messages', 'Channel posts'], outputs: ['tg_poll Edge Function'], schedule: 'כל דקה (pg_cron)', status: 'פעיל — 3 בוטים' },
  tg_channels: { description: 'סריקת 56 ערוצי טלגרם ציבוריים — ביטחוניים, חדשותיים, מודיעיניים.', tech: 'Public Channel Scraping', inputs: ['56 public channels'], outputs: ['tg_scrape Edge Function'], schedule: 'כל 2 דקות', status: 'פעיל' },
  oref_api: { description: 'ממשק פיקוד העורף — התרעות צבע אדום בזמן אמת + היסטוריה.', tech: 'REST API / JSON', inputs: ['Live alerts', 'History feed'], outputs: ['oref-alerts', 'emergency-feed'], schedule: 'כל 30 שניות', status: 'פעיל' },
  nasa_api: { description: 'NASA FIRMS — נקודות חמות (שריפות/פיצוצים) מלוויין. EONET — אירועי טבע גלובליים.', tech: 'REST API / GeoJSON', inputs: ['FIRMS satellite data', 'EONET events'], outputs: ['nasa-firms Edge Function'], schedule: 'כל 10 דקות', status: 'פעיל' },
  usgs_api: { description: 'USGS — רעידות אדמה בזמן אמת מרחבי העולם, סינון לאזור המזרח התיכון.', tech: 'GeoJSON Feed', inputs: ['Earthquake feed M2.5+'], outputs: ['usgs-quakes Edge Function'], schedule: 'כל 5 דקות', status: 'פעיל' },
  ai_gw: { description: 'Lovable AI Gateway — גישה ל-Gemini/GPT לניתוח סנטימנט, דוחות יומיים, ותרגום.', tech: 'OpenAI/Gemini API', inputs: ['Headlines', 'Intel data', 'Raw text'], outputs: ['sentiment', 'daily-report', 'translate'], status: 'פעיל' },
  centcom_api: { description: 'CENTCOM — הודעות פיקוד מרכזי אמריקני + NATO RSS feeds.', tech: 'RSS / HTML Scraping', inputs: ['Press releases', 'NATO news'], outputs: ['centcom-nato Edge Function'], schedule: 'כל 15 דקות', status: 'פעיל' },
  x_api: { description: 'X/Twitter — סריקת חשבונות ביטחוניים וחדשותיים רלוונטיים.', tech: 'HTML Scraping', inputs: ['Security accounts', 'News feeds'], outputs: ['news-flash Edge Function'], schedule: 'כל 5 דקות', status: 'פעיל' },
  rss_news: { description: '30+ פידי RSS/HTML מ-ynet, BBC, Reuters, Al Jazeera, IRNA, TASS, ועוד.', tech: 'RSS/Atom/HTML parsing', inputs: ['30+ news sources', 'IL/Global media'], outputs: ['news-flash Edge Function'], schedule: 'כל 3 דקות', status: 'פעיל — 308 פריטים' },
  opensky_api: { description: 'OpenSky Network — מעקב טיסות בזמן אמת מעל ישראל והמזרח התיכון.', tech: 'REST API / State Vectors', inputs: ['ADS-B transponder data'], outputs: ['opensky-flights Edge Function'], schedule: 'כל 2 דקות', status: 'Timeout לעיתים' },
  osrm_api: { description: 'OSRM — חישוב מסלולי נהיגה וזמני הגעה עבור CarPlay ו-Drive Mode.', tech: 'OSRM Routing API', inputs: ['Origin/Destination coords'], outputs: ['traffic-check Edge Function'], status: 'פעיל' },

  // Edge Functions
  tg_poll: { description: 'Long-polling loop של 55 שניות — מקבל הודעות מ-3 בוטים, מסווג חומרה, מזהה כפילויות.', tech: 'Deno Edge Function', inputs: ['Telegram Bot API'], outputs: ['telegram_messages', 'telegram_groups', 'bot_state'], fields: ['severity scoring', 'dedup by content_hash', 'trilingual tagging'], schedule: 'pg_cron כל דקה', status: 'פעיל' },
  tg_scrape: { description: 'סריקת 56 ערוצים ציבוריים — חילוץ כותרות, תיוג חומרה, זיהוי מילות מפתח.', tech: 'Deno Edge Function', inputs: ['56 TG channels'], outputs: ['telegram_messages', 'telegram_groups'], fields: ['keyword matching (HE/AR/EN)', 'severity classification'], schedule: 'pg_cron כל 2 דקות', status: 'פעיל' },
  oref_fn: { description: 'שליפת התרעות חיות + היסטוריה מפיקוד העורף, שמירה ב-DB.', tech: 'Deno Edge Function', inputs: ['Pikud HaOref API'], outputs: ['oref_alerts'], fields: ['category', 'locations[]', 'alert_date'], schedule: 'כל 30 שניות', status: '206 התרעות נשלפו' },
  emerg_fn: { description: 'איסוף אירועי חירום ממקורות מגוונים — MDA, כיבוי, משטרה.', tech: 'Deno Edge Function', inputs: ['Multiple emergency feeds'], outputs: ['emergency_events'], fields: ['lat/lon', 'score', 'color coding'], status: 'פעיל' },
  nasa_fn: { description: 'שליפת נקודות חמות מ-NASA FIRMS — סינון לאזור ישראל והמזרח התיכון.', tech: 'Deno Edge Function', inputs: ['NASA FIRMS API'], outputs: ['emergency_events'], fields: ['coordinates', 'confidence', 'satellite'], schedule: 'כל 10 דקות', status: 'פעיל' },
  usgs_fn: { description: 'שליפת רעידות אדמה מ-USGS — M2.5+ באזור המזרח התיכון.', tech: 'Deno Edge Function', inputs: ['USGS GeoJSON'], outputs: ['emergency_events'], fields: ['magnitude', 'depth', 'location'], schedule: 'כל 5 דקות', status: 'פעיל' },
  sentiment_fn: { description: 'ניתוח סנטימנט AI על כותרות חדשות — מייצר ציון 0-100 עם תווית.', tech: 'Deno + Lovable AI (Gemini)', inputs: ['News headlines', 'TG messages'], outputs: ['sentiment_scores'], fields: ['score', 'label', 'top_headlines[]', 'sources[]'], status: 'פעיל' },
  daily_fn: { description: 'דוח מודיעין יומי — AI מסכם את כל המידע ב-24h לדוח מובנה עם חזיתות והמלצות.', tech: 'Deno + Lovable AI (GPT)', inputs: ['All intel data'], outputs: ['daily_intel_reports'], fields: ['fronts', 'key_findings[]', 'recommendations[]', 'threat_level'], schedule: 'פעם ביום', status: 'פעיל' },
  news_fn: { description: 'אוסף חדשות מ-30+ מקורות — RSS, HTML scraping, ניתוח ותיוג.', tech: 'Deno Edge Function', inputs: ['30+ RSS/HTML sources'], outputs: ['intel_reports'], fields: ['category', 'severity', 'region', 'tags[]'], schedule: 'כל 3 דקות', status: '308 פריטים' },
  centcom_fn: { description: 'שליפת הודעות CENTCOM ו-NATO — סינון רלוונטיות לאזור.', tech: 'Deno Edge Function', inputs: ['CENTCOM/NATO RSS'], outputs: ['intel_reports'], fields: ['source', 'category', 'region'], schedule: 'כל 15 דקות', status: 'פעיל' },
  opensky_fn: { description: 'מעקב טיסות OpenSky — state vectors מעל ישראל, סינון צבאי/אזרחי.', tech: 'Deno Edge Function', inputs: ['OpenSky API'], outputs: ['emergency_events'], fields: ['callsign', 'altitude', 'velocity', 'origin_country'], schedule: 'כל 2 דקות', status: 'Timeout לעיתים' },
  traffic_fn: { description: 'חישוב מסלולים — בדיקת תנועה וזמני הגעה ליעדים.', tech: 'Deno + OSRM', inputs: ['Coordinates'], outputs: ['Route data to frontend'], fields: ['distance', 'duration', 'geometry'], status: 'פעיל' },
  translate_fn: { description: 'תרגום כותרות — AI מתרגם כותרות מערבית/אנגלית לעברית.', tech: 'Deno + Lovable AI', inputs: ['Foreign headlines'], outputs: ['Translated text'], fields: ['source_lang', 'target_lang', 'translated_text'], status: 'פעיל' },

  // Database tables
  tg_msgs: { description: 'טבלת הודעות טלגרם — כל ההודעות מ-3 בוטים + ערוצים ציבוריים.', tech: 'PostgreSQL + RLS', inputs: ['telegram-poll', 'telegram-public-scrape'], outputs: ['PG Changes → Realtime'], fields: ['text', 'chat_id', 'severity', 'tags[]', 'content_hash', 'is_duplicate'], rls: 'SELECT: anon + authenticated', status: 'Realtime enabled' },
  tg_groups: { description: 'טבלת קבוצות/ערוצי טלגרם — מעקב אחרי כל הקבוצות שהבוט נמצא בהן.', tech: 'PostgreSQL + RLS', inputs: ['telegram-poll', 'telegram-public-scrape'], outputs: ['PG Changes'], fields: ['chat_id', 'title', 'type', 'message_count', 'last_message_at'], rls: 'SELECT: public', status: 'פעיל' },
  oref_tbl: { description: 'טבלת התרעות פיקוד העורף — צבע אדום, חדירת כלי טיס, רעידות אדמה.', tech: 'PostgreSQL + RLS', inputs: ['oref-alerts'], outputs: ['PG Changes → Realtime'], fields: ['title', 'locations[]', 'category', 'alert_date', 'description'], rls: 'SELECT: public', status: 'Realtime enabled' },
  emerg_tbl: { description: 'טבלת אירועי חירום — מאירועי MDA, שריפות NASA, רעידות USGS.', tech: 'PostgreSQL + RLS', inputs: ['emergency-feed', 'nasa-firms', 'usgs-quakes'], outputs: ['PG Changes → Realtime'], fields: ['title', 'lat/lon', 'score', 'color', 'source', 'event_time'], rls: 'SELECT: public', status: 'Realtime enabled' },
  intel_tbl: { description: 'טבלת דיווחי מודיעין — חדשות מעובדות מ-30+ מקורות עם תיוג.', tech: 'PostgreSQL + RLS', inputs: ['news-flash', 'centcom-nato'], outputs: ['PG Changes'], fields: ['title', 'summary', 'category', 'severity', 'region', 'tags[]', 'source'], rls: 'SELECT: public', status: 'פעיל' },
  sent_tbl: { description: 'טבלת ציוני סנטימנט — ניתוח AI של מצב הרוח הביטחוני.', tech: 'PostgreSQL + RLS', inputs: ['sentiment-analysis'], outputs: ['PG Changes'], fields: ['score (0-100)', 'label', 'top_headlines[]', 'sources[]', 'data_points'], rls: 'SELECT: public', status: 'פעיל' },
  daily_tbl: { description: 'טבלת דוחות מודיעין יומיים — סיכום AI מובנה של כל היממה.', tech: 'PostgreSQL + RLS', inputs: ['daily-intel-report'], outputs: ['Frontend'], fields: ['summary', 'threat_level', 'fronts (JSON)', 'key_findings[]', 'recommendations[]'], rls: 'SELECT: public', status: 'פעיל' },
  profiles: { description: 'טבלת פרופילי משתמשים — נתוני משתמש, קרדיטים, הרשאות מיקום.', tech: 'PostgreSQL + RLS', inputs: ['Auth trigger on signup'], outputs: ['Admin panel'], fields: ['display_name', 'email', 'credits', 'location_consent', 'last_login'], rls: 'SELECT: own + admin | UPDATE: own', status: 'פעיל' },
  bot_state: { description: 'מצב בוט טלגרם — שומר את ה-offset האחרון לכל בוט.', tech: 'PostgreSQL', inputs: ['telegram-poll'], outputs: ['telegram-poll (read)'], fields: ['bot_name', 'update_offset', 'updated_at'], rls: 'SELECT: anon + auth', status: 'פעיל' },
  push_subs: { description: 'מנויי Push — הרשמות Web Push Notifications של משתמשים.', tech: 'PostgreSQL + RLS', inputs: ['Browser Push API'], outputs: ['Push notifications'], fields: ['endpoint', 'p256dh', 'auth', 'user_agent'], rls: 'INSERT/DELETE: anon + auth', status: 'פעיל' },

  // Realtime
  pg_changes: { description: 'Postgres Changes — מאזין לשינויים בטבלאות ומעביר אותם ל-Channels.', tech: 'Supabase Realtime', inputs: ['telegram_messages', 'oref_alerts', 'emergency_events', 'intel_reports', 'telegram_groups'], outputs: ['Channels'], fields: ['INSERT events', 'UPDATE events'], status: 'פעיל — מאזין ל-5 טבלאות' },
  channels: { description: 'Realtime Channels — שידור חי של שינויים לכל הקליינטים המחוברים.', tech: 'Supabase Realtime WebSocket', inputs: ['PG Changes'], outputs: ['War Room', 'CarPlay', 'Command Center', 'Drive Mode', 'Tactical Map'], fields: ['Broadcast to all subscribers'], status: 'פעיל' },

  // Frontend
  war_room: { description: 'חדר מלחמה ראשי — מפה טקטית, פיד התרעות, סנטימנט, טיקר חדשות.', tech: 'React + Leaflet + Canvas', inputs: ['useWarRoom', 'useTelegram', 'useEmergencyData'], outputs: ['UI Display'], fields: ['ThreatMap', 'AlertFeed', 'SentimentTrend', 'Ticker', 'ReadinessGauge'], status: 'פעיל' },
  carplay: { description: 'מצב CarPlay — ממשק נהיגה מינימלי עם מפה, ניווט, והתרעות קוליות.', tech: 'React + Leaflet + GPS Sim', inputs: ['Realtime channels', 'OSRM routes'], outputs: ['UI Display'], fields: ['GPS simulation', 'Voice alerts', 'Route display'], status: 'פעיל' },
  cmd_center: { description: 'מרכז פיקוד — תצוגה מורחבת עם פילוח לפי חזיתות ומקורות.', tech: 'React', inputs: ['Realtime channels'], outputs: ['UI Display'], fields: ['Multi-front view', 'Source filtering'], status: 'פעיל' },
  drive_mode: { description: 'מצב נהיגה — ממשק פשוט למעקב בזמן נסיעה.', tech: 'React + Leaflet', inputs: ['Realtime channels', 'GPS'], outputs: ['UI Display'], fields: ['Simplified alerts', 'Route tracking'], status: 'פעיל' },
  admin_pg: { description: 'פאנל ניהול — משתמשים, ארכיטקטורת מערכת, בריאות, ו-health checks.', tech: 'React + Canvas', inputs: ['Supabase queries'], outputs: ['UI Display'], fields: ['User management', 'System flow', 'Health monitoring', 'Edge function status'], status: 'פעיל' },
  tactical_map: { description: 'מפה טקטית — שכבות מרובות עם התרעות, אירועים, טיסות, ותנועה.', tech: 'React + Leaflet + GeoJSON', inputs: ['All data sources'], outputs: ['Map layers'], fields: ['Alert markers', 'Fire hotspots', 'Flight tracks', 'Route overlays'], status: 'פעיל' },
};

function getNodeCenter(node: Node, cw: number, ch: number): [number, number] {
  return [node.x * cw + (node.w * cw) / 2, node.y * ch + (node.h * ch) / 2];
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

const SystemFlowCanvas = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const packetsRef = useRef<Packet[]>([]);
  const timeRef = useRef(0);
  const hoveredNodeRef = useRef<string | null>(null);
  const [liveCounts, setLiveCounts] = useState<Record<string, number>>({});
  const [totalPackets, setTotalPackets] = useState(0);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [healthResults, setHealthResults] = useState<Record<string, HealthResult>>({});
  const [healthChecking, setHealthChecking] = useState(false);
  const healthResultsRef = useRef<Record<string, HealthResult>>({});

  // Keep ref in sync for canvas reads
  useEffect(() => { healthResultsRef.current = healthResults; }, [healthResults]);

  // ── Run health check on all edge functions ──
  const runHealthCheck = useCallback(async () => {
    setHealthChecking(true);
    const initial: Record<string, HealthResult> = {};
    HEALTH_CHECK_FUNCTIONS.forEach(fn => { initial[fn] = { status: 'pending', latency: null, fnName: fn }; });
    setHealthResults(initial);

    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const baseUrl = `https://${projectId}.supabase.co/functions/v1`;

    await Promise.allSettled(
      HEALTH_CHECK_FUNCTIONS.map(async fn => {
        const t0 = performance.now();
        try {
          const res = await fetch(`${baseUrl}/${fn}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${anonKey}` },
            body: JSON.stringify({ health_check: true }),
            signal: AbortSignal.timeout(15000),
          });
          const latency = Math.round(performance.now() - t0);
          setHealthResults(prev => ({ ...prev, [fn]: { status: res.ok || res.status === 400 ? 'ok' : 'error', latency, fnName: fn } }));
        } catch {
          const latency = Math.round(performance.now() - t0);
          setHealthResults(prev => ({ ...prev, [fn]: { status: 'error', latency, fnName: fn } }));
        }
      })
    );
    setHealthChecking(false);
  }, []);

  // Fetch live data counts
  useEffect(() => {
    const fetchCounts = async () => {
      const [tg, oref, emerg, intel, sent, daily] = await Promise.all([
        supabase.from('telegram_messages').select('id', { count: 'exact', head: true }),
        supabase.from('oref_alerts').select('id', { count: 'exact', head: true }),
        supabase.from('emergency_events').select('id', { count: 'exact', head: true }),
        supabase.from('intel_reports').select('id', { count: 'exact', head: true }),
        supabase.from('sentiment_scores').select('id', { count: 'exact', head: true }),
        supabase.from('daily_intel_reports').select('id', { count: 'exact', head: true }),
      ]);
      setLiveCounts({
        tg_msgs: tg.count || 0,
        oref_tbl: oref.count || 0,
        emerg_tbl: emerg.count || 0,
        intel_tbl: intel.count || 0,
        sent_tbl: sent.count || 0,
        daily_tbl: daily.count || 0,
      });
    };
    fetchCounts();
    const iv = setInterval(fetchCounts, 15000);
    return () => clearInterval(iv);
  }, []);

  // Mouse tracking for hover effects
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const cw = canvas.width / (window.devicePixelRatio || 1);
      const ch = canvas.height / (window.devicePixelRatio || 1);
      let found: string | null = null;
      for (const n of NODES) {
        const nx = n.x * cw, ny = n.y * ch, nw = n.w * cw, nh = n.h * ch;
        if (mx >= nx && mx <= nx + nw && my >= ny && my <= ny + nh) {
          found = n.id;
          break;
        }
      }
      hoveredNodeRef.current = found;
      canvas.style.cursor = found ? 'pointer' : 'default';
    };
    canvas.addEventListener('mousemove', handleMove);
    const handleClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const cw = canvas.width / (window.devicePixelRatio || 1);
      const ch = canvas.height / (window.devicePixelRatio || 1);
      let found: string | null = null;
      for (const n of NODES) {
        const nx = n.x * cw, ny = n.y * ch, nw = n.w * cw, nh = n.h * ch;
        if (mx >= nx && mx <= nx + nw && my >= ny && my <= ny + nh) {
          found = n.id;
          break;
        }
      }
      setSelectedNode(prev => prev === found ? null : found);
    };
    canvas.addEventListener('click', handleClick);
    return () => {
      canvas.removeEventListener('mousemove', handleMove);
      canvas.removeEventListener('click', handleClick);
    };
  }, []);

  // Main animation loop
  const animate = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const cw = canvas.width / dpr;
    const ch = canvas.height / dpr;
    const dt = 0.016; // ~60fps
    timeRef.current += dt;
    const t = timeRef.current;

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    // ── Background grid ──
    ctx.strokeStyle = 'rgba(0, 200, 255, 0.03)';
    ctx.lineWidth = 0.5;
    const gridSize = 30;
    for (let x = 0; x < cw; x += gridSize) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke();
    }
    for (let y = 0; y < ch; y += gridSize) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(cw, y); ctx.stroke();
    }

    // ── Compute live load per connection (packets-in-flight / expected) ──
    const liveCountsByConn = new Array(CONNECTIONS.length).fill(0);
    for (const pkt of packetsRef.current) liveCountsByConn[pkt.connIdx]++;

    // ── Draw connections (lines) ──
    const nodeMap = new Map(NODES.map(n => [n.id, n]));
    for (let ci = 0; ci < CONNECTIONS.length; ci++) {
      const conn = CONNECTIONS[ci];
      const fromNode = nodeMap.get(conn.from);
      const toNode = nodeMap.get(conn.to);
      if (!fromNode || !toNode) continue;

      const [fx, fy] = getNodeCenter(fromNode, cw, ch);
      const [tx, ty] = getNodeCenter(toNode, cw, ch);

      const isHighlighted = hoveredNodeRef.current === conn.from || hoveredNodeRef.current === conn.to;
      const isLatencyBottleneck = (conn.avgLatencyMs || 0) >= BOTTLENECK_LATENCY_MS || (conn.memoryMB || 0) >= BOTTLENECK_MEMORY_MB;

      // Live throughput load: packets in flight vs expected steady-state (speed × ~2.5s avg flight)
      const expected = Math.max(0.5, conn.speed * 2.5);
      const loadRatio = liveCountsByConn[ci] / expected;
      const lColor = loadColor(loadRatio);
      const isOverload = loadRatio >= 1.0 || isLatencyBottleneck;

      // Connection line
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      const cx1 = fx + (tx - fx) * 0.4;
      const cy1 = fy;
      const cx2 = fx + (tx - fx) * 0.6;
      const cy2 = ty;
      ctx.bezierCurveTo(cx1, cy1, cx2, cy2, tx, ty);

      if (isOverload) {
        const bPulse = Math.sin(t * 4) * 0.3 + 0.6;
        ctx.strokeStyle = hexToRgba(lColor, isHighlighted ? 0.95 : bPulse);
        ctx.lineWidth = isHighlighted ? 3.5 : 2.5;
        ctx.setLineDash([6, 4]);
      } else {
        // Tint by load — stronger alpha when more loaded
        const baseAlpha = 0.15 + Math.min(0.55, loadRatio * 0.5);
        ctx.strokeStyle = hexToRgba(lColor, isHighlighted ? 0.85 : baseAlpha);
        ctx.lineWidth = isHighlighted ? 2.5 : 1 + Math.min(1.5, loadRatio);
        ctx.setLineDash([]);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // ── Bottleneck warning icon at midpoint ──
      if (isOverload) {
        const mp = 0.5;
        const mip = 1 - mp;
        const mx = mip * mip * mip * fx + 3 * mip * mip * mp * cx1 + 3 * mip * mp * mp * cx2 + mp * mp * mp * tx;
        const my = mip * mip * mip * fy + 3 * mip * mip * mp * cy1 + 3 * mip * mp * mp * cy2 + mp * mp * mp * ty;

        const wPulse = Math.sin(t * 3) * 0.3 + 0.7;
        ctx.beginPath();
        ctx.moveTo(mx, my - 7);
        ctx.lineTo(mx - 6, my + 4);
        ctx.lineTo(mx + 6, my + 4);
        ctx.closePath();
        ctx.fillStyle = hexToRgba(lColor, wPulse);
        ctx.fill();
        ctx.fillStyle = '#000';
        ctx.font = 'bold 8px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('!', mx, my);
      }

      // ── Speed/Memory/Load label on highlighted connections ──
      if (isHighlighted) {
        const lp = 0.35;
        const lip = 1 - lp;
        const lx = lip * lip * lip * fx + 3 * lip * lip * lp * cx1 + 3 * lip * lp * lp * cx2 + lp * lp * lp * tx;
        const ly = lip * lip * lip * fy + 3 * lip * lip * lp * cy1 + 3 * lip * lp * lp * cy2 + lp * lp * lp * ty;

        const latStr = conn.avgLatencyMs ? `${conn.avgLatencyMs}ms` : '';
        const memStr = conn.memoryMB ? `${conn.memoryMB}MB` : '';
        const loadStr = `${loadLabel(loadRatio)} ${(loadRatio * 100).toFixed(0)}%`;
        const metricText = [loadStr, latStr, memStr].filter(Boolean).join(' | ');

        const tw = ctx.measureText(metricText).width + 14;
        ctx.beginPath();
        ctx.roundRect(lx - tw / 2, ly - 16, tw, 14, 4);
        ctx.fillStyle = 'rgba(0, 10, 20, 0.92)';
        ctx.fill();
        ctx.strokeStyle = hexToRgba(lColor, 0.6);
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = lColor;
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(metricText, lx, ly - 9);
      }
    }

    // ── Spawn packets ──
    for (let ci = 0; ci < CONNECTIONS.length; ci++) {
      const conn = CONNECTIONS[ci];
      if (Math.random() < conn.speed * dt * 0.4) {
        packetsRef.current.push({
          connIdx: ci,
          progress: 0,
          speed: 0.15 + Math.random() * 0.25,
          size: 2 + Math.random() * 3,
          color: conn.color,
          glow: conn.color,
          trail: [],
        });
      }
    }

    // ── Update & draw packets ──
    const alive: Packet[] = [];
    for (const pkt of packetsRef.current) {
      pkt.progress += pkt.speed * dt;
      if (pkt.progress > 1) continue;

      const conn = CONNECTIONS[pkt.connIdx];
      const fromNode = nodeMap.get(conn.from);
      const toNode = nodeMap.get(conn.to);
      if (!fromNode || !toNode) continue;

      const [fx, fy] = getNodeCenter(fromNode, cw, ch);
      const [tx, ty] = getNodeCenter(toNode, cw, ch);

      // Bezier position
      const p = pkt.progress;
      const cx1 = fx + (tx - fx) * 0.4;
      const cy1 = fy;
      const cx2 = fx + (tx - fx) * 0.6;
      const cy2 = ty;
      const ip = 1 - p;
      const px = ip * ip * ip * fx + 3 * ip * ip * p * cx1 + 3 * ip * p * p * cx2 + p * p * p * tx;
      const py = ip * ip * ip * fy + 3 * ip * ip * p * cy1 + 3 * ip * p * p * cy2 + p * p * p * ty;

      // Trail
      pkt.trail.push(px, py);
      if (pkt.trail.length > 20) pkt.trail.splice(0, 2);

      // Draw trail
      if (pkt.trail.length >= 4) {
        for (let i = 2; i < pkt.trail.length; i += 2) {
          const alpha = (i / pkt.trail.length) * 0.6;
          ctx.beginPath();
          ctx.moveTo(pkt.trail[i - 2], pkt.trail[i - 1]);
          ctx.lineTo(pkt.trail[i], pkt.trail[i + 1]);
          ctx.strokeStyle = hexToRgba(pkt.color, alpha);
          ctx.lineWidth = pkt.size * 0.5;
          ctx.stroke();
        }
      }

      // Draw packet (glowing dot)
      ctx.beginPath();
      ctx.arc(px, py, pkt.size, 0, Math.PI * 2);
      ctx.fillStyle = pkt.color;
      ctx.fill();

      // Glow
      ctx.beginPath();
      ctx.arc(px, py, pkt.size * 3, 0, Math.PI * 2);
      const grad = ctx.createRadialGradient(px, py, 0, px, py, pkt.size * 3);
      grad.addColorStop(0, hexToRgba(pkt.glow, 0.5));
      grad.addColorStop(1, hexToRgba(pkt.glow, 0));
      ctx.fillStyle = grad;
      ctx.fill();

      alive.push(pkt);
    }
    packetsRef.current = alive;
    setTotalPackets(alive.length);

    // ── Draw nodes ──
    for (const node of NODES) {
      const nx = node.x * cw;
      const ny = node.y * ch;
      const nw = node.w * cw;
      const nh = node.h * ch;
      const isHovered = hoveredNodeRef.current === node.id;
      const pulse = Math.sin(t * 2 + node.pulsePhase) * 0.5 + 0.5;

      // Node background
      ctx.beginPath();
      ctx.roundRect(nx, ny, nw, nh, 6);
      ctx.fillStyle = hexToRgba(node.color, isHovered ? 0.35 : 0.15 + pulse * 0.05);
      ctx.fill();

      // Node border
      ctx.beginPath();
      ctx.roundRect(nx, ny, nw, nh, 6);
      ctx.strokeStyle = hexToRgba(node.glow, isHovered ? 0.9 : 0.4 + pulse * 0.2);
      ctx.lineWidth = isHovered ? 2 : 1;
      ctx.stroke();

      // Glow effect
      if (isHovered || pulse > 0.7) {
        ctx.shadowColor = node.glow;
        ctx.shadowBlur = isHovered ? 20 : 8;
        ctx.beginPath();
        ctx.roundRect(nx, ny, nw, nh, 6);
        ctx.strokeStyle = hexToRgba(node.glow, isHovered ? 0.5 : 0.15);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      // Node label
      ctx.fillStyle = isHovered ? '#fff' : hexToRgba('#e0e0e0', 0.9);
      ctx.font = `${isHovered ? 'bold ' : ''}${Math.max(9, nw * 0.075)}px 'Courier New', monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${node.icon} ${node.label}`, nx + nw / 2, ny + nh / 2);

      // Live count badge
      const count = liveCounts[node.id];
      if (count !== undefined && count > 0) {
        const badgeText = count > 999 ? `${(count / 1000).toFixed(1)}K` : String(count);
        const badgeW = ctx.measureText(badgeText).width + 10;
        ctx.beginPath();
        ctx.roundRect(nx + nw - badgeW - 2, ny - 6, badgeW, 14, 4);
        ctx.fillStyle = hexToRgba(node.glow, 0.8);
        ctx.fill();
        ctx.fillStyle = '#000';
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(badgeText, nx + nw - badgeW / 2 - 2, ny + 1);
      }

      // ── Health check badge on node ──
      const hr = healthResultsRef.current;
      const nodeHealthEntries = Object.entries(hr).filter(([fn]) => EDGE_FN_TO_NODE[fn] === node.id);
      if (nodeHealthEntries.length > 0) {
        // Use worst status and max latency
        let worstStatus: 'ok' | 'error' | 'pending' = 'ok';
        let maxLatency = 0;
        for (const [, h] of nodeHealthEntries) {
          if (h.status === 'error') worstStatus = 'error';
          else if (h.status === 'pending' && worstStatus !== 'error') worstStatus = 'pending';
          if (h.latency && h.latency > maxLatency) maxLatency = h.latency;
        }

        const statusIcon = worstStatus === 'ok' ? '✓' : worstStatus === 'error' ? '✗' : '…';
        const statusColor = worstStatus === 'ok' ? '#00e676' : worstStatus === 'error' ? '#ff5252' : '#ffd740';
        const latencyColor = maxLatency > 3000 ? '#ff5252' : maxLatency > 1000 ? '#ffd740' : '#00e676';
        const latencyText = maxLatency > 0 ? `${maxLatency}ms` : '';
        const fullText = latencyText ? `${statusIcon} ${latencyText}` : statusIcon;

        ctx.font = 'bold 9px monospace';
        const tw2 = ctx.measureText(fullText).width + 12;

        // Badge at bottom-right of node
        const bx = nx + nw - tw2 - 2;
        const by = ny + nh - 2;
        ctx.beginPath();
        ctx.roundRect(bx, by, tw2, 14, 4);
        ctx.fillStyle = 'rgba(0, 10, 20, 0.9)';
        ctx.fill();
        ctx.strokeStyle = hexToRgba(statusColor, 0.6);
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.fillStyle = latencyText ? latencyColor : statusColor;
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(fullText, bx + tw2 / 2, by + 7);

        // Pulse ring on error
        if (worstStatus === 'error') {
          const ep = Math.sin(t * 5) * 0.4 + 0.6;
          ctx.beginPath();
          ctx.roundRect(nx - 2, ny - 2, nw + 4, nh + 4, 8);
          ctx.strokeStyle = hexToRgba('#ff5252', ep * 0.5);
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    }

    // ── Category labels ──
    const categories = [
      { label: 'EXTERNAL APIs', x: 0.04, y: 0.03, color: '#ef5350' },
      { label: 'EDGE FUNCTIONS', x: 0.24, y: 0.03, color: '#42a5f5' },
      { label: 'DATABASE', x: 0.46, y: 0.03, color: '#66bb6a' },
      { label: 'REALTIME', x: 0.67, y: 0.22, color: '#ab47bc' },
      { label: 'FRONTEND', x: 0.85, y: 0.03, color: '#26c6da' },
    ];
    for (const cat of categories) {
      ctx.fillStyle = hexToRgba(cat.color, 0.7);
      ctx.font = 'bold 10px "Orbitron", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(cat.label, cat.x * cw, cat.y * ch);

      // Underline
      const tw = ctx.measureText(cat.label).width;
      ctx.beginPath();
      ctx.moveTo(cat.x * cw, cat.y * ch + 4);
      ctx.lineTo(cat.x * cw + tw, cat.y * ch + 4);
      ctx.strokeStyle = hexToRgba(cat.color, 0.3);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.restore();
    animRef.current = requestAnimationFrame(animate);
  }, [liveCounts]);

  // Resize canvas
  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = container.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Start animation
  useEffect(() => {
    animRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animRef.current);
  }, [animate]);

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '75vh', minHeight: 500 }}>
      <canvas ref={canvasRef} style={{ display: 'block', borderRadius: 10 }} />
      {/* Overlay HUD */}
      <div style={{
        position: 'absolute', bottom: 12, left: 12,
        background: 'rgba(0, 10, 20, 0.85)', backdropFilter: 'blur(10px)',
        border: '1px solid rgba(0, 200, 255, 0.2)', borderRadius: 8,
        padding: '8px 14px', display: 'flex', gap: 16, alignItems: 'center',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            width: 6, height: 6, borderRadius: '50%', background: '#00e676',
            boxShadow: '0 0 8px #00e676', animation: 'pulse 1.5s infinite',
          }} />
          <span style={{ fontSize: 10, color: '#00e676', fontFamily: 'Orbitron, monospace' }}>LIVE</span>
        </div>
        <span style={{ fontSize: 10, color: '#42a5f5', fontFamily: 'monospace' }}>
          {totalPackets} packets
        </span>
        <span style={{ fontSize: 10, color: '#78909c', fontFamily: 'monospace' }}>
          {CONNECTIONS.length} connections
        </span>
        <span style={{ fontSize: 10, color: '#78909c', fontFamily: 'monospace' }}>
          {NODES.length} nodes
        </span>
        <span style={{ fontSize: 10, color: CONNECTIONS.filter(c => (c.avgLatencyMs || 0) >= BOTTLENECK_LATENCY_MS || (c.memoryMB || 0) >= BOTTLENECK_MEMORY_MB).length > 0 ? '#ff5252' : '#00e676', fontFamily: 'monospace' }}>
          ⚠ {CONNECTIONS.filter(c => (c.avgLatencyMs || 0) >= BOTTLENECK_LATENCY_MS || (c.memoryMB || 0) >= BOTTLENECK_MEMORY_MB).length} bottlenecks
        </span>
        <button
          onClick={runHealthCheck}
          disabled={healthChecking}
          style={{
            background: healthChecking ? 'rgba(255,215,64,0.15)' : 'linear-gradient(135deg, #00e676, #00897b)',
            border: '1px solid rgba(0,230,118,0.4)',
            borderRadius: 5,
            padding: '3px 12px',
            color: '#fff',
            fontWeight: 800,
            fontSize: 10,
            cursor: healthChecking ? 'not-allowed' : 'pointer',
            fontFamily: 'Orbitron, monospace',
            letterSpacing: 1,
          }}
        >
          {healthChecking ? '⏳ בודק...' : '▶ HEALTH CHECK'}
        </button>
        {Object.keys(healthResults).length > 0 && (() => {
          const ok = Object.values(healthResults).filter(h => h.status === 'ok').length;
          const err = Object.values(healthResults).filter(h => h.status === 'error').length;
          const pending = Object.values(healthResults).filter(h => h.status === 'pending').length;
          return (
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: err > 0 ? '#ff5252' : '#00e676' }}>
              ✅{ok} ❌{err} {pending > 0 ? `⏳${pending}` : ''}
            </span>
          );
        })()}
      </div>
      {/* Top-right legend */}
      <div style={{
        position: 'absolute', top: 12, right: 12,
        background: 'rgba(0, 10, 20, 0.85)', backdropFilter: 'blur(10px)',
        border: '1px solid rgba(0, 200, 255, 0.15)', borderRadius: 8,
        padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 6,
        minWidth: 140,
      }}>
        <div style={{ fontSize: 9, color: '#00bcd4', fontFamily: 'monospace', fontWeight: 700, letterSpacing: 0.5 }}>עומס על קווים</div>
        {[
          { label: 'OVERLOAD ≥100%', color: '#ff1744' },
          { label: 'HIGH 80-100%', color: '#ff6d00' },
          { label: 'MEDIUM 50-80%', color: '#ffd740' },
          { label: 'NORMAL 20-50%', color: '#76ff03' },
          { label: 'IDLE <20%', color: '#00bcd4' },
        ].map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 18, height: 3, borderRadius: 2, background: l.color, boxShadow: `0 0 6px ${l.color}` }} />
            <span style={{ fontSize: 9, color: '#cfd8dc', fontFamily: 'monospace' }}>{l.label}</span>
          </div>
        ))}
        <div style={{ height: 1, background: 'rgba(0, 200, 255, 0.15)', margin: '2px 0' }} />
        <div style={{ fontSize: 9, color: '#00bcd4', fontFamily: 'monospace', fontWeight: 700, letterSpacing: 0.5 }}>שכבות</div>
        {[
          { label: 'External APIs', color: '#ef5350' },
          { label: 'Edge Functions', color: '#42a5f5' },
          { label: 'Database', color: '#66bb6a' },
          { label: 'Realtime', color: '#ab47bc' },
          { label: 'Frontend', color: '#26c6da' },
        ].map(l => (
          <div key={l.label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: l.color, boxShadow: `0 0 4px ${l.color}` }} />
            <span style={{ fontSize: 9, color: '#90a4ae', fontFamily: 'monospace' }}>{l.label}</span>
          </div>
        ))}
      </div>

      {/* ═══ Node Detail Panel ═══ */}
      {selectedNode && (() => {
        const node = NODES.find(n => n.id === selectedNode);
        const detail = NODE_DETAILS[selectedNode];
        if (!node || !detail) return null;
        const inConns = CONNECTIONS.filter(c => c.to === selectedNode);
        const outConns = CONNECTIONS.filter(c => c.from === selectedNode);
        const count = liveCounts[selectedNode];

        return (
          <div style={{
            position: 'absolute', top: 0, right: 0, width: 340, height: '100%',
            background: 'rgba(0, 8, 18, 0.96)', backdropFilter: 'blur(20px)',
            borderLeft: `2px solid ${node.color}`, borderRadius: '0 10px 10px 0',
            overflowY: 'auto', padding: 0, zIndex: 10,
            animation: 'slide-in-right 0.25s ease-out',
          }}>
            {/* Header */}
            <div style={{
              padding: '16px 18px 12px', borderBottom: `1px solid ${node.color}33`,
              background: `linear-gradient(135deg, ${hexToRgba(node.color, 0.15)}, transparent)`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 22 }}>{node.icon}</span>
                <button onClick={() => setSelectedNode(null)} style={{
                  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 4, color: '#90a4ae', cursor: 'pointer', padding: '4px 10px', fontSize: 12,
                }}>✕</button>
              </div>
              <div style={{ fontSize: 16, fontWeight: 900, color: node.color, fontFamily: 'Orbitron, monospace', marginTop: 6 }}>
                {node.label}
              </div>
              <div style={{ fontSize: 10, color: '#78909c', marginTop: 2 }}>{node.category.toUpperCase()}</div>
              {count !== undefined && (
                <div style={{ fontSize: 22, fontWeight: 900, color: node.glow, fontFamily: 'Orbitron, monospace', marginTop: 8 }}>
                  {count.toLocaleString()} <span style={{ fontSize: 10, color: '#546e7a' }}>רשומות</span>
                </div>
              )}
            </div>

            {/* Description */}
            <div style={{ padding: '14px 18px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#42a5f5', letterSpacing: 1, marginBottom: 6 }}>תיאור</div>
              <div style={{ fontSize: 12, color: '#b0bec5', lineHeight: 1.6 }}>{detail.description}</div>
            </div>

            {/* Tech */}
            <div style={{ padding: '10px 18px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#ce93d8', letterSpacing: 1, marginBottom: 4 }}>טכנולוגיה</div>
              <div style={{
                display: 'inline-block', padding: '3px 10px', borderRadius: 4,
                background: 'rgba(206,147,216,0.1)', border: '1px solid rgba(206,147,216,0.2)',
                fontSize: 11, color: '#ce93d8', fontFamily: 'monospace',
              }}>{detail.tech}</div>
            </div>

            {/* Fields */}
            {detail.fields && detail.fields.length > 0 && (
              <div style={{ padding: '10px 18px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#ffd740', letterSpacing: 1, marginBottom: 6 }}>שדות / יכולות</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {detail.fields.map(f => (
                    <span key={f} style={{
                      padding: '2px 8px', borderRadius: 3, fontSize: 10,
                      background: 'rgba(255,215,64,0.08)', border: '1px solid rgba(255,215,64,0.15)',
                      color: '#ffd740', fontFamily: 'monospace',
                    }}>{f}</span>
                  ))}
                </div>
              </div>
            )}

            {/* Inputs / Outputs */}
            <div style={{ padding: '10px 18px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#00e676', letterSpacing: 1, marginBottom: 6 }}>כניסות ({detail.inputs.length})</div>
              {detail.inputs.map(inp => (
                <div key={inp} style={{ fontSize: 11, color: '#81c784', padding: '2px 0', fontFamily: 'monospace' }}>→ {inp}</div>
              ))}
            </div>
            <div style={{ padding: '10px 18px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: '#ef5350', letterSpacing: 1, marginBottom: 6 }}>יציאות ({detail.outputs.length})</div>
              {detail.outputs.map(out => (
                <div key={out} style={{ fontSize: 11, color: '#ef9a9a', padding: '2px 0', fontFamily: 'monospace' }}>← {out}</div>
              ))}
            </div>

            {/* Connected flows with metrics */}
            {(inConns.length > 0 || outConns.length > 0) && (
              <div style={{ padding: '10px 18px', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#42a5f5', letterSpacing: 1, marginBottom: 6 }}>חיבורים ({inConns.length + outConns.length})</div>
                {inConns.map((c, i) => {
                  const isBottle = (c.avgLatencyMs || 0) >= BOTTLENECK_LATENCY_MS || (c.memoryMB || 0) >= BOTTLENECK_MEMORY_MB;
                  return (
                    <div key={`in-${i}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' }}>
                      <span style={{ fontSize: 10, color: '#90a4ae', fontFamily: 'monospace' }}>⬅ {c.from}</span>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {c.avgLatencyMs && <span style={{ fontSize: 9, color: (c.avgLatencyMs >= 3000 ? '#ff5252' : c.avgLatencyMs >= 1000 ? '#ffd740' : '#00e676'), fontFamily: 'monospace' }}>{c.avgLatencyMs}ms</span>}
                        {c.memoryMB && <span style={{ fontSize: 9, color: (c.memoryMB >= 50 ? '#ff5252' : '#78909c'), fontFamily: 'monospace' }}>{c.memoryMB}MB</span>}
                        {isBottle && <span style={{ fontSize: 9, color: '#ff5252' }}>⚠</span>}
                      </div>
                    </div>
                  );
                })}
                {outConns.map((c, i) => {
                  const isBottle = (c.avgLatencyMs || 0) >= BOTTLENECK_LATENCY_MS || (c.memoryMB || 0) >= BOTTLENECK_MEMORY_MB;
                  return (
                    <div key={`out-${i}`} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' }}>
                      <span style={{ fontSize: 10, color: '#90a4ae', fontFamily: 'monospace' }}>➡ {c.to}</span>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {c.avgLatencyMs && <span style={{ fontSize: 9, color: (c.avgLatencyMs >= 3000 ? '#ff5252' : c.avgLatencyMs >= 1000 ? '#ffd740' : '#00e676'), fontFamily: 'monospace' }}>{c.avgLatencyMs}ms</span>}
                        {c.memoryMB && <span style={{ fontSize: 9, color: (c.memoryMB >= 50 ? '#ff5252' : '#78909c'), fontFamily: 'monospace' }}>{c.memoryMB}MB</span>}
                        {isBottle && <span style={{ fontSize: 9, color: '#ff5252' }}>⚠</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Schedule & RLS */}
            <div style={{ padding: '10px 18px' }}>
              {detail.schedule && (
                <div style={{ marginBottom: 6 }}>
                  <span style={{ fontSize: 9, color: '#78909c' }}>⏰ </span>
                  <span style={{ fontSize: 10, color: '#b0bec5' }}>{detail.schedule}</span>
                </div>
              )}
              {detail.rls && (
                <div style={{ marginBottom: 6 }}>
                  <span style={{ fontSize: 9, color: '#78909c' }}>🔒 </span>
                  <span style={{ fontSize: 10, color: '#b0bec5' }}>{detail.rls}</span>
                </div>
              )}
              {detail.status && (
                <div style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px',
                  borderRadius: 4, background: 'rgba(0,230,118,0.08)', border: '1px solid rgba(0,230,118,0.2)',
                }}>
                  <div style={{ width: 5, height: 5, borderRadius: '50%', background: '#00e676', boxShadow: '0 0 6px #00e676' }} />
                  <span style={{ fontSize: 10, color: '#00e676' }}>{detail.status}</span>
                </div>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
};

export default SystemFlowCanvas;

import React, { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable';
import { useWarRoom } from '@/hooks/useWarRoom';
import { useTelegram } from '@/hooks/useTelegram';
import { supabase } from '@/integrations/supabase/client';
import SentimentTrend from '@/components/war-room/SentimentTrend';
import DailyIntelReport from '@/components/war-room/DailyIntelReport';
import TgSeveritySummary from '@/components/war-room/TgSeveritySummary';
import FitIsraelBounds from '@/components/war-room/FitIsraelBounds';
import 'leaflet/dist/leaflet.css';

// ── Clock Component ──
const LiveClock = () => {
  const [time, setTime] = useState(new Date());
  useEffect(() => { const id = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(id); }, []);
  return (
    <div className="text-center">
      <div className="font-mono text-2xl font-black tabular-nums" style={{ color: '#00e5ff', textShadow: '0 0 15px rgba(0,229,255,0.4)', fontFamily: 'Orbitron, monospace' }}>
        {time.toLocaleTimeString('he-IL')}
      </div>
      <div className="font-mono text-[9px] text-white/40 mt-0.5">
        {time.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
      </div>
    </div>
  );
};

// ── Panel Shell ──
const Panel = ({ title, icon, children, color = '#00e5ff', noPad = false }: { title: string; icon: string; children: React.ReactNode; color?: string; noPad?: boolean }) => (
  <div className="flex flex-col h-full rounded-lg overflow-hidden" style={{ background: 'rgba(0,8,18,0.95)', border: `1px solid ${color}22` }}>
    <div className="flex items-center gap-2 px-3 py-1.5 shrink-0" style={{ background: `linear-gradient(90deg, ${color}12, transparent)`, borderBottom: `1px solid ${color}18` }}>
      <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: color, boxShadow: `0 0 6px ${color}80` }} />
      <span className="text-[10px] font-black tracking-[0.2em] uppercase" style={{ fontFamily: 'Orbitron, monospace', color: `${color}cc` }}>{icon} {title}</span>
    </div>
    <div className={`flex-1 min-h-0 overflow-auto ${noPad ? '' : 'p-2'}`}>{children}</div>
  </div>
);

// ── Severity colors ──
const SEV_COLORS: Record<string, string> = { critical: '#ff1744', high: '#ff6d00', medium: '#ffab00', low: '#888', early_warning: '#ff6d00' };

// ── Mini Map ──
const MiniMap = ({ emergencyEvents, orefAlerts }: { emergencyEvents: any[]; orefAlerts: any[] }) => (
  <MapContainer center={[31.5, 34.8]} zoom={7} className="w-full h-full" zoomControl={false}
    attributionControl={false} style={{ background: '#000d1a' }}>
    <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
    <FitIsraelBounds />
    {emergencyEvents.filter(e => e.lat && e.lon).map(e => (
      <CircleMarker key={e.id} center={[e.lat, e.lon]} radius={5}
        pathOptions={{ color: e.color === 'red' ? '#ff1744' : e.color === 'orange' ? '#ff6d00' : '#ffab00', fillColor: e.color === 'red' ? '#ff1744' : '#ff6d00', fillOpacity: 0.6, weight: 1 }}>
        <Popup><div className="font-mono text-[9px]" dir="rtl"><strong>{e.title}</strong><br/>{e.location || ''}</div></Popup>
      </CircleMarker>
    ))}
    {orefAlerts.slice(0, 20).map(a => (
      <CircleMarker key={a.id} center={[31.5 + Math.random() * 2 - 1, 34.8 + Math.random() * 1 - 0.5]} radius={8}
        pathOptions={{ color: '#ff1744', fillColor: '#ff1744', fillOpacity: 0.3, weight: 2 }}>
        <Popup><div className="font-mono text-[9px]" dir="rtl"><strong>🚨 {a.title}</strong><br/>{a.locations?.join(', ')}</div></Popup>
      </CircleMarker>
    ))}
  </MapContainer>
);

const CommandCenter = () => {
  const war = useWarRoom();
  const telegram = useTelegram();
  const [intelReports, setIntelReports] = useState<any[]>([]);
  const [emergencyEvents, setEmergencyEvents] = useState<any[]>([]);
  const [orefAlerts, setOrefAlerts] = useState<any[]>([]);
  const [time, setTime] = useState(Date.now());

  // Refresh timer
  useEffect(() => { const id = setInterval(() => setTime(Date.now()), 30000); return () => clearInterval(id); }, []);

  // Fetch data
  useEffect(() => {
    const load = async () => {
      const [ir, ee, oa] = await Promise.all([
        supabase.from('intel_reports').select('*').order('created_at', { ascending: false }).limit(30),
        supabase.from('emergency_events').select('*').order('created_at', { ascending: false }).limit(20),
        supabase.from('oref_alerts').select('*').order('created_at', { ascending: false }).limit(20),
      ]);
      if (ir.data) setIntelReports(ir.data);
      if (ee.data) setEmergencyEvents(ee.data);
      if (oa.data) setOrefAlerts(oa.data);
    };
    load();
  }, [time]);

  // Visibility refresh
  useEffect(() => {
    const handler = () => { if (document.visibilityState === 'visible') setTime(Date.now()); };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  // Stats
  const stats = useMemo(() => {
    const critCount = intelReports.filter(r => r.severity === 'critical' || r.severity === 'high').length;
    const tgCount = telegram.messages.length;
    const orefCount = orefAlerts.length;
    const eeCount = emergencyEvents.length;
    const threatLevel = critCount > 10 ? 5 : critCount > 5 ? 4 : critCount > 2 ? 3 : critCount > 0 ? 2 : 1;
    return { critCount, tgCount, orefCount, eeCount, threatLevel };
  }, [intelReports, telegram.messages, orefAlerts, emergencyEvents]);

  const LEVEL_CFG: Record<number, { color: string; label: string; labelHe: string }> = {
    1: { color: '#00e676', label: 'NORMAL', labelHe: 'שגרה' },
    2: { color: '#76ff03', label: 'ELEVATED', labelHe: 'עירנות' },
    3: { color: '#ffd600', label: 'ALERT', labelHe: 'כוננות' },
    4: { color: '#ff6d00', label: 'WARNING', labelHe: 'אזהרה' },
    5: { color: '#ff1744', label: 'CRITICAL', labelHe: 'חירום' },
  };
  const lv = LEVEL_CFG[stats.threatLevel];

  return (
    <div className="w-screen h-screen flex flex-col overflow-hidden" style={{ background: '#000a14' }} dir="rtl">
      {/* ── Top Bar ── */}
      <header className="shrink-0 flex items-center justify-between px-4 py-2 border-b" style={{ background: 'linear-gradient(90deg, rgba(0,12,24,0.98), rgba(0,8,18,0.95))', borderColor: '#00e5ff18' }}>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full animate-pulse" style={{ background: lv.color, boxShadow: `0 0 10px ${lv.color}` }} />
            <span className="text-sm font-black tracking-[0.25em]" style={{ fontFamily: 'Orbitron, monospace', color: '#00e5ff', textShadow: '0 0 10px rgba(0,229,255,0.3)' }}>
              COMMAND CENTER
            </span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-md" style={{ background: `${lv.color}15`, border: `1px solid ${lv.color}33` }}>
            <span className="text-[10px] font-bold" style={{ fontFamily: 'Orbitron', color: lv.color }}>{lv.label}</span>
            <span className="text-[9px] text-white/50 font-mono">{lv.labelHe}</span>
          </div>
        </div>
        <LiveClock />
        <div className="flex items-center gap-4">
          {[
            { label: 'INTEL', value: intelReports.length, color: '#00e5ff' },
            { label: 'TG', value: stats.tgCount, color: '#4fc3f7' },
            { label: 'OREF', value: stats.orefCount, color: stats.orefCount > 0 ? '#ff1744' : '#00e676' },
            { label: 'EVENTS', value: stats.eeCount, color: stats.eeCount > 5 ? '#ff6d00' : '#00e676' },
          ].map(s => (
            <div key={s.label} className="text-center">
              <div className="text-[7px] font-bold tracking-[0.15em] text-white/30" style={{ fontFamily: 'Orbitron' }}>{s.label}</div>
              <div className="text-sm font-black tabular-nums" style={{ fontFamily: 'Orbitron', color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      </header>

      {/* ── Main Grid ── */}
      <div className="flex-1 min-h-0 p-1.5">
        <ResizablePanelGroup direction="horizontal" className="h-full gap-1.5">
          {/* Left Column */}
          <ResizablePanel defaultSize={30} minSize={20}>
            <ResizablePanelGroup direction="vertical" className="h-full gap-1.5">
              {/* Threat Gauge */}
              <ResizablePanel defaultSize={30} minSize={15}>
                <Panel title="THREAT LEVEL" icon="🎯" color={lv.color}>
                  <div className="flex flex-col items-center justify-center h-full gap-2">
                    <div className="text-6xl font-black" style={{ fontFamily: 'Orbitron', color: lv.color, textShadow: `0 0 30px ${lv.color}60` }}>
                      {stats.threatLevel}
                    </div>
                    <div className="text-sm font-bold tracking-[0.3em]" style={{ fontFamily: 'Orbitron', color: lv.color }}>{lv.label}</div>
                    <div className="w-full max-w-[180px] space-y-1 mt-2">
                      {[
                        { label: 'CRITICAL', val: stats.critCount, max: 20, color: '#ff1744' },
                        { label: 'SOURCES', val: Object.keys(war.sourceCounts).filter(k => war.sourceCounts[k] > 0).length, max: 8, color: '#00e5ff' },
                        { label: 'TELEGRAM', val: stats.tgCount, max: 100, color: '#4fc3f7' },
                      ].map(b => (
                        <div key={b.label} className="flex items-center gap-2">
                          <span className="text-[7px] font-mono text-white/40 w-14 shrink-0">{b.label}</span>
                          <div className="flex-1 h-1.5 rounded-full overflow-hidden bg-white/5">
                            <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, (b.val / b.max) * 100)}%`, background: b.color }} />
                          </div>
                          <span className="text-[8px] font-mono font-bold w-6 text-left" style={{ color: b.color }}>{b.val}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Panel>
              </ResizablePanel>
              <ResizableHandle withHandle />
              {/* Telegram Summary */}
              <ResizablePanel defaultSize={35} minSize={15}>
                <Panel title="TELEGRAM" icon="📨" color="#4fc3f7">
                  <TgSeveritySummary messages={telegram.messages} groups={telegram.groups} compact lastPoll={telegram.lastPoll} />
                  <div className="mt-2 space-y-1">
                    {telegram.messages.filter(m => !m.is_duplicate && m.text).slice(0, 8).map(m => {
                      const sev = m.severity || 'low';
                      const color = SEV_COLORS[sev] || '#888';
                      const age = Math.floor((Date.now() - new Date(m.message_date || m.created_at).getTime()) / 60000);
                      return (
                        <div key={m.id} className="rounded px-2 py-1" style={{ borderRight: `3px solid ${color}`, background: `${color}08` }}>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[8px] font-bold text-white/80 truncate flex-1">{m.text?.slice(0, 50)}</span>
                            <span className="font-mono text-[6px] text-white/30 shrink-0">{age < 1 ? 'עכשיו' : `${age}ד'`}</span>
                          </div>
                          {m.sender_name && <span className="font-mono text-[6px] text-white/25">{m.sender_name}</span>}
                        </div>
                      );
                    })}
                  </div>
                </Panel>
              </ResizablePanel>
              <ResizableHandle withHandle />
              {/* Sentiment */}
              <ResizablePanel defaultSize={35} minSize={15}>
                <Panel title="SENTIMENT" icon="📊" color="#b388ff">
                  <SentimentTrend />
                </Panel>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Center: Map */}
          <ResizablePanel defaultSize={40} minSize={25}>
            <Panel title="TACTICAL MAP" icon="🗺️" noPad>
              <MiniMap emergencyEvents={emergencyEvents} orefAlerts={orefAlerts} />
            </Panel>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right Column */}
          <ResizablePanel defaultSize={30} minSize={20}>
            <ResizablePanelGroup direction="vertical" className="h-full gap-1.5">
              {/* OREF Alerts */}
              <ResizablePanel defaultSize={25} minSize={10}>
                <Panel title="OREF ALERTS" icon="🚨" color={orefAlerts.length > 0 ? '#ff1744' : '#00e676'}>
                  {orefAlerts.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                      <div className="text-center">
                        <span className="text-3xl opacity-30">✅</span>
                        <p className="font-mono text-[9px] text-white/30 mt-1">אין התרעות פעילות</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      {orefAlerts.slice(0, 6).map(a => (
                        <div key={a.id} className="rounded px-2 py-1.5" style={{ background: 'rgba(255,23,68,0.08)', borderRight: '3px solid #ff1744' }}>
                          <div className="font-mono text-[9px] font-bold text-white/90">{a.title}</div>
                          <div className="font-mono text-[7px] text-white/40">{a.locations?.join(', ')}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </Panel>
              </ResizablePanel>
              <ResizableHandle withHandle />
              {/* Intel Feed */}
              <ResizablePanel defaultSize={45} minSize={20}>
                <Panel title="INTEL FEED" icon="📋" color="#ff6d00">
                  <div className="space-y-1">
                    {intelReports.slice(0, 12).map(r => {
                      const sevColor = SEV_COLORS[r.severity] || '#888';
                      const age = Math.floor((Date.now() - new Date(r.created_at).getTime()) / 60000);
                      const timeLabel = age < 1 ? 'עכשיו' : age < 60 ? `${age}ד'` : `${Math.floor(age / 60)}ש'`;
                      return (
                        <div key={r.id} className="rounded px-2 py-1" style={{ borderRight: `3px solid ${sevColor}`, background: `${sevColor}06` }}>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[8px] font-bold text-white/85 truncate flex-1">{r.title}</span>
                            <span className="font-mono text-[6px] text-white/30 shrink-0">{timeLabel}</span>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <span className="font-mono text-[6px] px-1 rounded-sm" style={{ background: `${sevColor}20`, color: sevColor }}>{r.severity}</span>
                            <span className="font-mono text-[6px] text-white/30">{r.source}</span>
                            {r.region && <span className="font-mono text-[5px] text-white/20">📍 {r.region}</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </Panel>
              </ResizablePanel>
              <ResizableHandle withHandle />
              {/* Daily Report */}
              <ResizablePanel defaultSize={30} minSize={15}>
                <Panel title="DAILY REPORT" icon="📋" color="#7c4dff">
                  <DailyIntelReport />
                </Panel>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* ── Bottom Status Bar ── */}
      <footer className="shrink-0 flex items-center justify-between px-4 h-7 border-t" style={{ background: 'rgba(0,8,18,0.95)', borderColor: '#00e5ff12' }}>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <div className={`w-1.5 h-1.5 rounded-full ${telegram.isPolling ? 'bg-yellow-400 animate-pulse' : 'bg-green-500'}`} />
            <span className="font-mono text-[7px] text-white/40">TG: {telegram.messages.length} msgs</span>
          </div>
          <span className="font-mono text-[7px] text-white/25">|</span>
          <span className="font-mono text-[7px] text-white/40">INTEL: {intelReports.length}</span>
          <span className="font-mono text-[7px] text-white/25">|</span>
          <span className="font-mono text-[7px] text-white/40">OREF: {orefAlerts.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <a href="/" className="font-mono text-[7px] text-primary/60 hover:text-primary/90 transition-colors">🗺️ MAP VIEW</a>
          <span className="font-mono text-[7px] text-white/15">|</span>
          <span className="font-mono text-[6px] text-white/15 tracking-[0.2em]" style={{ fontFamily: 'Orbitron' }}>WARZONE CONTROL v2.0</span>
        </div>
      </footer>
    </div>
  );
};

export default CommandCenter;

// FlightMonitor — Real OpenSky data via flights-board edge function.
// Shows departures/arrivals/taxi/approach for TLV, HFA, ETM with live filtering.
import { useMemo, useState } from 'react';
import { useFlightsBoard, type BoardFlight, type FlightPhase } from '@/hooks/useFlightsBoard';

const PHASE_META: Record<FlightPhase, { label: string; color: string; bg: string; emoji: string }> = {
  departing: { label: 'ממריא',  color: '#00ff88', bg: 'rgba(0,255,136,.10)',  emoji: '✈️' },
  arriving:  { label: 'נוחת',   color: '#00b0ff', bg: 'rgba(0,176,255,.10)',  emoji: '🛬' },
  approach:  { label: 'מתקרב',  color: '#ffab00', bg: 'rgba(255,171,0,.10)',  emoji: '📡' },
  taxi:      { label: 'בקרקע',  color: '#9e9e9e', bg: 'rgba(158,158,158,.10)', emoji: '🛞' },
  enroute:   { label: 'בדרך',   color: '#b040ff', bg: 'rgba(176,64,255,.10)', emoji: '🌐' },
};

type ViewMode = 'departure' | 'arrival' | 'all';
type FilterPhase = FlightPhase | 'all';

interface FlightMonitorProps {
  embedded?: boolean; // if true, no fixed-height/min-height styles
  defaultAirport?: string;
}

export default function FlightMonitor({ embedded = false, defaultAirport = 'TLV' }: FlightMonitorProps) {
  const { airports, loading, lastUpdate } = useFlightsBoard(true, 60_000);
  const [selectedAirport, setSelectedAirport] = useState(defaultAirport);
  const [view, setView] = useState<ViewMode>('all');
  const [filter, setFilter] = useState<FilterPhase>('all');
  const [windowH, setWindowH] = useState<1 | 2 | 4>(2);
  const [selected, setSelected] = useState<BoardFlight | null>(null);

  const ap = useMemo(
    () => airports.find((a) => a.iata === selectedAirport) || airports[0],
    [airports, selectedAirport]
  );

  const flights = useMemo<BoardFlight[]>(() => {
    if (!ap) return [];
    let list = ap.flights;
    if (view === 'departure') list = list.filter((f) => f.phase === 'departing' || f.phase === 'taxi');
    else if (view === 'arrival') list = list.filter((f) => f.phase === 'arriving' || f.phase === 'approach');
    if (filter !== 'all') list = list.filter((f) => f.phase === filter);
    // ±Nh window: keep flights with ETA ≤ windowH based on current speed/distance
    list = list.filter((f) => {
      if (f.phase === 'taxi') return true;
      const kmh = (f.ktVel || 0) * 1.852;
      if (kmh < 50) return f.distanceKm < 50;
      const etaH = f.distanceKm / kmh;
      return etaH <= windowH;
    });
    return [...list].sort((a, b) => a.distanceKm - b.distanceKm);
  }, [ap, view, filter, windowH]);

  const stats = useMemo(() => {
    const all = ap?.flights || [];
    return {
      total: all.length,
      departing: all.filter((f) => f.phase === 'departing').length,
      arriving:  all.filter((f) => f.phase === 'arriving').length,
      approach:  all.filter((f) => f.phase === 'approach').length,
      taxi:      all.filter((f) => f.phase === 'taxi').length,
    };
  }, [ap]);

  return (
    <div
      style={{
        background: '#03080d',
        color: '#b8d4e8',
        fontFamily: "'Orbitron', monospace",
        minHeight: embedded ? undefined : '100vh',
        padding: 0,
        direction: 'rtl',
      }}
    >
      {/* HEADER */}
      <div
        style={{
          background: 'rgba(6,14,22,.97)',
          borderBottom: '1px solid #112233',
          padding: '14px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 16,
          position: embedded ? 'static' : 'sticky',
          top: 0,
          zIndex: 50,
        }}
      >
        <span style={{ fontSize: 20 }}>✈️</span>
        <span style={{ fontSize: 13, letterSpacing: 3, color: '#00e5ff', fontWeight: 700 }}>
          FLIGHT MONITOR · OpenSky LIVE
        </span>
        <span style={{ fontSize: 9, color: '#2a4458', marginRight: 'auto' }}>
          {loading ? 'טוען…' : lastUpdate ? `עדכון: ${new Date(lastUpdate).toLocaleTimeString('he-IL')}` : '—'}
        </span>
      </div>

      <div style={{ padding: 16, maxWidth: 1200, margin: '0 auto' }}>
        {/* AIRPORT SELECTOR */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {airports.map((a) => (
            <button
              key={a.iata}
              onClick={() => { setSelectedAirport(a.iata); setSelected(null); }}
              style={{
                padding: '8px 16px',
                borderRadius: 20,
                border: 'none',
                background: ap?.iata === a.iata ? '#00e5ff' : 'rgba(0,229,255,.06)',
                color: ap?.iata === a.iata ? '#000' : '#5a7a8a',
                fontSize: 10,
                letterSpacing: 1,
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontWeight: ap?.iata === a.iata ? 700 : 400,
              }}
            >
              {a.iata} · {a.nameHe || a.name}
            </button>
          ))}
          {airports.length === 0 && (
            <span style={{ fontSize: 11, color: '#5a7a8a' }}>אין נתוני שדות תעופה — ממתין ל-OpenSky…</span>
          )}
        </div>

        {/* STATS */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 10, marginBottom: 16 }}>
          {[
            { n: stats.total,     l: 'במרחב',   c: '#b8d4e8' },
            { n: stats.departing, l: 'ממריאים', c: PHASE_META.departing.color },
            { n: stats.arriving,  l: 'נוחתים',  c: PHASE_META.arriving.color },
            { n: stats.approach,  l: 'מתקרבים', c: PHASE_META.approach.color },
            { n: stats.taxi,      l: 'בקרקע',   c: PHASE_META.taxi.color },
          ].map((s) => (
            <div
              key={s.l}
              style={{
                background: 'rgba(6,14,22,.85)',
                border: '1px solid #112233',
                borderRadius: 10,
                padding: 12,
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 22, fontWeight: 700, color: s.c }}>{s.n}</div>
              <div style={{ fontSize: 9, color: '#2a4458', letterSpacing: 1, marginTop: 3 }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* TABS */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          {(['all', 'departure', 'arrival'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                padding: '6px 14px',
                borderRadius: 16,
                border: 'none',
                background: view === v ? 'rgba(0,229,255,.15)' : 'transparent',
                color: view === v ? '#00e5ff' : '#2a4458',
                fontSize: 10,
                letterSpacing: 1,
                cursor: 'pointer',
                fontFamily: 'inherit',
                borderBottom: view === v ? '2px solid #00e5ff' : '2px solid transparent',
              }}
            >
              {v === 'departure' ? '✈️ המראות' : v === 'arrival' ? '🛬 נחיתות' : '📋 הכל'}
            </button>
          ))}
          <div style={{ width: 1, height: 20, background: '#112233', margin: '0 4px' }} />
          {(['all', 'departing', 'arriving', 'approach', 'taxi'] as const).map((f) => {
            const meta = f !== 'all' ? PHASE_META[f] : null;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                style={{
                  padding: '4px 12px',
                  borderRadius: 12,
                  border: '1px solid #112233',
                  background: filter === f ? (meta?.bg || 'rgba(0,229,255,.08)') : 'transparent',
                  color: filter === f ? (meta?.color || '#00e5ff') : '#2a4458',
                  fontSize: 9,
                  letterSpacing: 1,
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                {f === 'all' ? 'הכל' : meta?.label}
              </button>
            );
          })}
          <div style={{ width: 1, height: 20, background: '#112233', margin: '0 4px' }} />
          <span style={{ fontSize: 9, color: '#5a7a8a', letterSpacing: 1 }}>חלון:</span>
          {([1, 2, 4] as const).map((h) => (
            <button
              key={h}
              onClick={() => setWindowH(h)}
              style={{
                padding: '4px 10px',
                borderRadius: 12,
                border: '1px solid #112233',
                background: windowH === h ? 'rgba(0,229,255,.15)' : 'transparent',
                color: windowH === h ? '#00e5ff' : '#2a4458',
                fontSize: 9,
                letterSpacing: 1,
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontWeight: windowH === h ? 700 : 400,
              }}
            >
              ±{h}h
            </button>
          ))}
        </div>

        {/* TABLE */}
        <div style={{ background: 'rgba(6,14,22,.85)', border: '1px solid #112233', borderRadius: 12, overflow: 'hidden' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '110px 100px 1fr 90px 90px 90px 90px',
              gap: 8,
              padding: '10px 16px',
              borderBottom: '1px solid #112233',
              fontSize: 8,
              color: '#2a4458',
              letterSpacing: 2,
            }}
          >
            <span>קולסיין</span>
            <span>מדינה</span>
            <span>שלב</span>
            <span>מרחק</span>
            <span>גובה (ft)</span>
            <span>מהירות (kt)</span>
            <span>כיוון</span>
          </div>

          {flights.length === 0 && !loading && (
            <div style={{ padding: 20, textAlign: 'center', fontSize: 11, color: '#5a7a8a' }}>
              אין טיסות תואמות במרחב {ap?.iata || ''}
            </div>
          )}

          {flights.map((f) => {
            const meta = PHASE_META[f.phase];
            const isSel = selected?.icao24 === f.icao24;
            return (
              <div
                key={f.icao24}
                onClick={() => setSelected(isSel ? null : f)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '110px 100px 1fr 90px 90px 90px 90px',
                  gap: 8,
                  padding: '11px 16px',
                  borderBottom: '1px solid #0a1520',
                  cursor: 'pointer',
                  background: isSel ? 'rgba(0,229,255,.05)' : 'transparent',
                  fontSize: 11,
                }}
              >
                <span style={{ color: '#fff', fontWeight: 700, fontFamily: 'monospace' }}>{f.callsign}</span>
                <span style={{ fontSize: 10 }}>{f.country || '—'}</span>
                <span
                  style={{
                    padding: '3px 10px',
                    borderRadius: 10,
                    background: meta.bg,
                    color: meta.color,
                    fontSize: 9,
                    letterSpacing: 1,
                    textAlign: 'center',
                    width: 'fit-content',
                  }}
                >
                  {meta.emoji} {meta.label}
                </span>
                <span style={{ fontFamily: 'monospace' }}>{f.distanceKm} km</span>
                <span style={{ fontFamily: 'monospace', color: '#00e5ff' }}>{f.altFt.toLocaleString()}</span>
                <span style={{ fontFamily: 'monospace' }}>{f.ktVel}</span>
                <span style={{ fontFamily: 'monospace', color: '#5a7a8a' }}>
                  {f.headingDeg != null ? `${Math.round(f.headingDeg)}°` : '—'}
                </span>
              </div>
            );
          })}
        </div>

        {/* DETAIL PANEL */}
        {selected && (
          <div
            style={{
              marginTop: 12,
              background: 'rgba(6,14,22,.95)',
              border: '1px solid #112233',
              borderRadius: 12,
              padding: '18px 20px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <span style={{ fontSize: 15, color: '#fff', fontWeight: 700, letterSpacing: 2 }}>
                {PHASE_META[selected.phase].emoji} {selected.callsign} — {PHASE_META[selected.phase].label}
              </span>
              <button
                onClick={() => setSelected(null)}
                style={{ background: 'none', border: 'none', color: '#2a4458', fontSize: 18, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
              {[
                { t: 'ICAO24', v: selected.icao24 },
                { t: 'מדינה', v: selected.country || '—' },
                { t: 'מרחק משדה', v: `${selected.distanceKm} km` },
                { t: 'גובה', v: `${selected.altFt.toLocaleString()} ft` },
                { t: 'מהירות', v: `${selected.ktVel} kt` },
                { t: 'כיוון', v: selected.headingDeg != null ? `${Math.round(selected.headingDeg)}°` : '—' },
                { t: 'קצב אנכי', v: `${selected.verticalRateMs.toFixed(1)} m/s` },
                { t: 'בקרקע', v: selected.onGround ? 'כן' : 'לא' },
              ].map((r) => (
                <div key={r.t} style={{ borderBottom: '1px solid #112233', paddingBottom: 8 }}>
                  <div style={{ fontSize: 8, color: '#2a4458', letterSpacing: 1, marginBottom: 3 }}>{r.t}</div>
                  <div style={{ fontSize: 12, color: '#fff', fontFamily: 'monospace' }}>{r.v}</div>
                </div>
              ))}
            </div>
            <div
              style={{
                marginTop: 12,
                padding: 10,
                background: 'rgba(0,229,255,.04)',
                borderRadius: 8,
                fontSize: 10,
                color: '#5a7a8a',
              }}
            >
              📡 מיקום: {selected.lat.toFixed(3)}°N {selected.lon.toFixed(3)}°E
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

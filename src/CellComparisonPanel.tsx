// ═══════════════════════════════════════════════════════════════
// CellComparisonPanel — השוואת צפיפות אוכלוסין × תנועה × סלולר
// מציג טבלת ערים מובילות + מגמות + פערים (mismatch detection)
// ═══════════════════════════════════════════════════════════════
import { useMemo } from 'react';
import { aggregateByCity, CARRIER_META } from '@/lib/cell-towers-il';

interface CityRow {
  city: string;
  population: number; // thousands
  cellTowers: number;
  fiveGRatio: number;
  // Derived
  towersPer100k: number;
  trafficLoad: number; // 0-1 simulated proxy
  mismatch: 'aligned' | 'under-served' | 'over-served';
}

interface Props {
  visible: boolean;
  onClose: () => void;
  // Population list from REGIONS (city, population in thousands)
  populationByCity: { city: string; population: number }[];
}

export default function CellComparisonPanel({ visible, onClose, populationByCity }: Props) {
  const rows = useMemo<CityRow[]>(() => {
    if (!visible) return [];
    const cellStats = aggregateByCity();
    const out: CityRow[] = [];
    for (const p of populationByCity) {
      const match = cellStats.find(c => c.city === p.city);
      const towers = match?.total ?? 0;
      const fiveG = match?.fiveGRatio ?? 0;
      const towersPer100k = p.population > 0 ? (towers / p.population) * 100 : 0;
      // Simulated traffic load proxy: scales with population, capped
      const trafficLoad = Math.min(1, Math.log10(1 + p.population) / 3);
      // Mismatch: if towers/100k < 3 → under-served; > 8 → over-served (relative to median)
      let mismatch: CityRow['mismatch'] = 'aligned';
      if (towersPer100k < 3 && p.population > 30) mismatch = 'under-served';
      else if (towersPer100k > 9) mismatch = 'over-served';
      out.push({ city: p.city, population: p.population, cellTowers: towers, fiveGRatio: fiveG, towersPer100k, trafficLoad, mismatch });
    }
    return out.sort((a, b) => b.population - a.population).slice(0, 20);
  }, [visible, populationByCity]);

  if (!visible) return null;

  const maxPop = Math.max(...rows.map(r => r.population), 1);
  const maxTowers = Math.max(...rows.map(r => r.cellTowers), 1);

  const mismatchColor = (m: CityRow['mismatch']) =>
    m === 'aligned' ? '#00e676' : m === 'under-served' ? '#ff1744' : '#ffd600';
  const mismatchLabel = (m: CityRow['mismatch']) =>
    m === 'aligned' ? '✓ מאוזן' : m === 'under-served' ? '⚠ תת-כיסוי' : '↑ עודף';

  return (
    <div
      className="animate-fade-in"
      style={{
        position: 'absolute',
        top: '70px',
        left: '12px',
        width: '420px',
        maxHeight: 'calc(100vh - 100px)',
        background: 'rgba(8,12,22,0.96)',
        border: '1px solid rgba(0,229,255,0.35)',
        borderRadius: '10px',
        padding: '12px 14px',
        color: '#e0e0e0',
        fontFamily: "'Share Tech Mono', monospace",
        zIndex: 1000,
        backdropFilter: 'blur(8px)',
        boxShadow: '0 8px 32px rgba(0,229,255,0.15)',
        overflowY: 'auto',
        direction: 'rtl',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', borderBottom: '1px solid rgba(0,229,255,0.2)', paddingBottom: '8px' }}>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#00e5ff' }}>📊 השוואת תשתית ישראל</div>
          <div style={{ fontSize: '10px', color: '#78909c' }}>צפיפות × תנועה × סלולר — איתור פערים</div>
        </div>
        <button onClick={onClose} style={{ background: 'transparent', border: '1px solid #455a64', color: '#90caf9', borderRadius: '4px', padding: '2px 8px', cursor: 'pointer', fontSize: '14px' }}>✕</button>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '10px', fontSize: '9px', marginBottom: '10px', flexWrap: 'wrap' }}>
        {Object.entries(CARRIER_META).slice(0, 4).map(([k, m]) => (
          <span key={k} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <span style={{ width: '8px', height: '8px', background: m.color, borderRadius: '50%' }} />
            {m.labelHe}
          </span>
        ))}
      </div>

      {/* Table */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '90px 60px 60px 1fr 60px', gap: '6px', fontSize: '9px', color: '#78909c', borderBottom: '1px dashed #37474f', paddingBottom: '4px' }}>
          <span>עיר</span>
          <span>אוכלוסין</span>
          <span>אנטנות</span>
          <span>השוואה</span>
          <span>סטטוס</span>
        </div>
        {rows.map((r) => (
          <div key={r.city} style={{ display: 'grid', gridTemplateColumns: '90px 60px 60px 1fr 60px', gap: '6px', alignItems: 'center', fontSize: '10px', padding: '4px 0', borderBottom: '1px dashed rgba(55,71,79,0.4)' }}>
            <span style={{ color: '#e0e0e0', fontWeight: 600, fontSize: '10px' }}>{r.city}</span>
            <span style={{ color: '#90caf9' }}>{r.population}k</span>
            <span style={{ color: '#fff' }}>{r.cellTowers}</span>
            {/* Bars */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <div title="צפיפות אוכלוסין" style={{ height: '4px', background: '#1e3a5f', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ width: `${(r.population / maxPop) * 100}%`, height: '100%', background: 'linear-gradient(90deg,#00e5ff,#0288d1)' }} />
              </div>
              <div title="עומס תנועה (משוער)" style={{ height: '4px', background: '#5f1e1e', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ width: `${r.trafficLoad * 100}%`, height: '100%', background: 'linear-gradient(90deg,#ffd600,#ff6d00)' }} />
              </div>
              <div title="אנטנות סלולר" style={{ height: '4px', background: '#1e5f3a', borderRadius: '2px', overflow: 'hidden' }}>
                <div style={{ width: `${(r.cellTowers / maxTowers) * 100}%`, height: '100%', background: 'linear-gradient(90deg,#00e676,#00897b)' }} />
              </div>
            </div>
            <span style={{ color: mismatchColor(r.mismatch), fontWeight: 700, fontSize: '9px', textAlign: 'center' }}>{mismatchLabel(r.mismatch)}</span>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div style={{ marginTop: '12px', padding: '8px', background: 'rgba(0,229,255,0.05)', borderRadius: '6px', fontSize: '10px' }}>
        <div style={{ color: '#00e5ff', fontWeight: 700, marginBottom: '4px' }}>📈 מגמות</div>
        <div style={{ color: '#ff1744' }}>• {rows.filter(r => r.mismatch === 'under-served').length} ערים בתת-כיסוי סלולרי</div>
        <div style={{ color: '#ffd600' }}>• {rows.filter(r => r.mismatch === 'over-served').length} ערים בעודף תשתית</div>
        <div style={{ color: '#00e676' }}>• {rows.filter(r => r.mismatch === 'aligned').length} ערים מאוזנות</div>
        <div style={{ color: '#90caf9', marginTop: '4px' }}>• ממוצע 5G: {Math.round(rows.reduce((s, r) => s + r.fiveGRatio, 0) / Math.max(rows.length, 1) * 100)}%</div>
      </div>
    </div>
  );
}

import { useTransitStatus } from '@/hooks/useTransitStatus';

const TIER_COLOR: Record<string, string> = {
  normal: '#00e676',
  delayed: '#ffab00',
  disrupted: '#ff1744',
  offline: '#9e9e9e',
};

const TIER_LABEL: Record<string, string> = {
  normal: 'תקין',
  delayed: 'עיכוב',
  disrupted: 'משובש',
  offline: 'לא זמין',
};

const TYPE_ICON: Record<string, string> = {
  train: '🚆',
  bus: '🚌',
  light_rail: '🚊',
};

interface Props {
  enabled: boolean;
  onClose?: () => void;
}

const TransitPanel = ({ enabled, onClose }: Props) => {
  const { data, loading } = useTransitStatus(enabled, 60_000);

  if (!enabled) return null;

  return (
    <div
      dir="rtl"
      style={{
        position: 'absolute',
        top: 80,
        left: 16,
        zIndex: 1000,
        width: 320,
        maxHeight: '70vh',
        overflowY: 'auto',
        background: 'rgba(8, 14, 22, 0.92)',
        border: '1px solid rgba(0, 229, 255, 0.3)',
        borderRadius: 8,
        padding: 12,
        color: '#e0f7fa',
        fontSize: 11,
        fontFamily: 'monospace',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 4px 20px rgba(0, 229, 255, 0.15)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, borderBottom: '1px solid rgba(0,229,255,0.2)', paddingBottom: 8 }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{ fontSize: 14 }}>🚊</span>
          <span style={{ fontWeight: 700, color: '#00e5ff', letterSpacing: 1 }}>תחבורה ציבורית</span>
          {loading && <span style={{ fontSize: 9, color: '#ffab00' }}>● LIVE</span>}
        </div>
        {onClose && (
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#5a7a8a', cursor: 'pointer', fontSize: 14 }}>✕</button>
        )}
      </div>

      {!data ? (
        <div style={{ color: '#5a7a8a', textAlign: 'center', padding: 20 }}>טוען נתונים...</div>
      ) : (
        <>
          <div style={{ marginBottom: 12, padding: 8, background: 'rgba(0,0,0,0.3)', borderRadius: 6, borderRight: `3px solid ${TIER_COLOR[data.overall] || TIER_COLOR.normal}` }}>
            <div style={{ fontSize: 9, color: '#5a7a8a', marginBottom: 2 }}>סטטוס כללי</div>
            <div style={{ color: TIER_COLOR[data.overall] || TIER_COLOR.normal, fontWeight: 700, fontSize: 13 }}>
              {TIER_LABEL[data.overall] || data.overall}
            </div>
          </div>

          {data.alerts && data.alerts.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: '#ffab00', marginBottom: 4, fontWeight: 700 }}>⚠️ התראות</div>
              {data.alerts.slice(0, 3).map((a, i) => (
                <div key={i} style={{ padding: 6, background: 'rgba(255,171,0,0.08)', borderRight: '2px solid #ffab00', marginBottom: 4, borderRadius: 4, fontSize: 10 }}>{a}</div>
              ))}
            </div>
          )}

          <div style={{ fontSize: 9, color: '#5a7a8a', marginBottom: 6, fontWeight: 700 }}>קווים פעילים ({data.lines.length})</div>
          {data.lines.map((line) => (
            <div key={line.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 6, borderBottom: '1px solid rgba(0,229,255,0.08)' }}>
              <span style={{ fontSize: 14 }}>{TYPE_ICON[line.type] || '🚍'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: '#e0f7fa', fontSize: 10, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {line.nameHe || line.name}
                </div>
                <div style={{ fontSize: 9, color: '#5a7a8a' }}>{line.operator}</div>
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ color: TIER_COLOR[line.status] || TIER_COLOR.normal, fontSize: 10, fontWeight: 700 }}>
                  {TIER_LABEL[line.status]}
                </div>
                {line.delayMin > 0 && (
                  <div style={{ fontSize: 9, color: '#ffab00' }}>+{line.delayMin}′</div>
                )}
              </div>
            </div>
          ))}

          <div style={{ marginTop: 10, fontSize: 9, color: '#3a5868', textAlign: 'center' }}>
            עודכן: {new Date(data.fetchedAt).toLocaleTimeString('he-IL')}
          </div>
        </>
      )}
    </div>
  );
};

export default TransitPanel;

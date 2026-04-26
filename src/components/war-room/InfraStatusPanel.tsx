import React from 'react';
import type { CloudStatusResult, CloudLoadStatus } from '@/hooks/useCloudStatus';
import type { TransitResult, TransitStatus } from '@/hooks/useTransitStatus';

const CLOUD_COLOR: Record<CloudLoadStatus, string> = {
  normal: '#00e676',
  congested: '#ff9100',
  fault: '#ff1744',
};
const CLOUD_LABEL: Record<CloudLoadStatus, string> = {
  normal: 'תקין',
  congested: 'עומס',
  fault: 'תקלה',
};

const TRANSIT_COLOR_MAP: Record<TransitStatus, string> = {
  normal: '#00e676',
  delayed: '#ff9100',
  disrupted: '#ff1744',
  offline: '#616161',
};
const TRANSIT_LABEL: Record<TransitStatus, string> = {
  normal: 'תקין',
  delayed: 'עיכוב',
  disrupted: 'שיבוש',
  offline: 'מנותק',
};

interface Props {
  cloud: CloudStatusResult | null;
  transit: TransitResult | null;
  cloudLoading: boolean;
  transitLoading: boolean;
  onClose: () => void;
}

export default function InfraStatusPanel({ cloud, transit, cloudLoading, transitLoading, onClose }: Props) {
  return (
    <div style={{
      position: 'absolute', top: 60, left: 12, zIndex: 1200,
      width: 320, maxHeight: 'calc(100vh - 120px)', overflowY: 'auto',
      background: 'rgba(5,12,20,0.95)', border: '1px solid #112233',
      borderRadius: 12, padding: 14, fontFamily: 'monospace', fontSize: 10,
      color: '#b8d4e8', direction: 'rtl',
      boxShadow: '0 0 30px rgba(0,0,0,0.5)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#00e5ff' }}>📡 סטטוס תשתיות</span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#2a4458', cursor: 'pointer', fontSize: 14 }}>✕</button>
      </div>

      {/* Cloud Providers */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 10, color: '#5a7a8a', marginBottom: 4, letterSpacing: 1 }}>☁️ ספקי ענן</div>
        {cloudLoading && !cloud && <div style={{ color: '#5a7a8a' }}>טוען...</div>}
        {cloud && cloud.providers.map(p => (
          <div key={p.provider} style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: '4px 8px', marginBottom: 2,
            background: 'rgba(0,0,0,0.3)', borderRadius: 6,
            borderRight: `3px solid ${CLOUD_COLOR[p.status]}`,
          }}>
            <span style={{ fontWeight: 600 }}>{p.provider}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {p.incidentCount > 0 && <span style={{ color: '#ff9100', fontSize: 9 }}>{p.incidentCount} אירועים</span>}
              <span style={{
                padding: '1px 6px', borderRadius: 8, fontSize: 8,
                background: CLOUD_COLOR[p.status] + '22',
                color: CLOUD_COLOR[p.status],
                fontWeight: 700,
              }}>
                {CLOUD_LABEL[p.status]}
              </span>
            </div>
          </div>
        ))}
        {cloud && cloud.providers.some(p => p.headlines.length > 0) && (
          <div style={{ marginTop: 4, padding: '4px 6px', background: 'rgba(255,136,0,0.05)', borderRadius: 6, fontSize: 9, color: '#8a6a3a' }}>
            {cloud.providers.flatMap(p => p.headlines).slice(0, 3).map((h, i) => (
              <div key={i} style={{ marginBottom: 2 }}>• {h}</div>
            ))}
          </div>
        )}
      </div>

      {/* Transit */}
      <div>
        <div style={{ fontSize: 10, color: '#5a7a8a', marginBottom: 4, letterSpacing: 1 }}>🚆 תחבורה ציבורית</div>
        {transitLoading && !transit && <div style={{ color: '#5a7a8a' }}>טוען...</div>}
        {transit && (
          <>
            <div style={{
              display: 'flex', justifyContent: 'space-between', padding: '4px 8px',
              background: 'rgba(0,0,0,0.3)', borderRadius: 6, marginBottom: 4,
              borderRight: `3px solid ${TRANSIT_COLOR_MAP[transit.overall]}`,
            }}>
              <span style={{ fontWeight: 600 }}>סטטוס כללי</span>
              <span style={{
                padding: '1px 6px', borderRadius: 8, fontSize: 8,
                background: TRANSIT_COLOR_MAP[transit.overall] + '22',
                color: TRANSIT_COLOR_MAP[transit.overall],
                fontWeight: 700,
              }}>
                {TRANSIT_LABEL[transit.overall]}
              </span>
            </div>
            {transit.lines.filter(l => l.status !== 'normal').map(l => (
              <div key={l.id} style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '3px 8px', marginBottom: 1, fontSize: 9,
                borderRight: `2px solid ${TRANSIT_COLOR_MAP[l.status]}`,
              }}>
                <span>{l.type === 'train' ? '🚆' : l.type === 'light_rail' ? '🚊' : '🚌'} {l.nameHe}</span>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  {l.delayMin > 0 && <span style={{ color: '#ff9100' }}>+{l.delayMin}׳</span>}
                  <span style={{ color: TRANSIT_COLOR_MAP[l.status], fontSize: 8 }}>{TRANSIT_LABEL[l.status]}</span>
                </div>
              </div>
            ))}
            {transit.alerts.length > 0 && (
              <div style={{ marginTop: 4, padding: '4px 6px', background: 'rgba(255,136,0,0.05)', borderRadius: 6, fontSize: 9, color: '#8a6a3a' }}>
                {transit.alerts.slice(0, 3).map((a, i) => (
                  <div key={i} style={{ marginBottom: 2 }}>⚠️ {a}</div>
                ))}
              </div>
            )}
            {transit.lines.filter(l => l.status !== 'normal').length === 0 && (
              <div style={{ color: '#00e676', fontSize: 9, textAlign: 'center', padding: 4 }}>✅ כל הקווים פועלים כסדרם</div>
            )}
          </>
        )}
      </div>

      {cloud && (
        <div style={{ marginTop: 8, fontSize: 8, color: '#2a4458', textAlign: 'center' }}>
          עדכון: {new Date(cloud.fetchedAt).toLocaleTimeString('he-IL')}
        </div>
      )}
    </div>
  );
}

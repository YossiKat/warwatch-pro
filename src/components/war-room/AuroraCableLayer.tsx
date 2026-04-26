// ═══════════════════════════════════════════════════════════════
// AuroraCableLayer — תצוגה חדשנית של מסלולי דאטה תת-ימיים ויבשתיים
// Layered glow + animated traveling wave + landing beacons
// "Aurora Network" — fiber lines as ribbons of light beneath the sea
// ═══════════════════════════════════════════════════════════════
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import type { SubmarineCable, BackboneLink } from '@/lib/data-routes';

export type CableLoad = 'normal' | 'congested' | 'fault';

export interface AuroraCablesProps {
  cables: SubmarineCable[];
  backbone: BackboneLink[];
  enabled?: boolean;
  loadFor?: (id: string) => CableLoad;
}

// Convert hex (#rrggbb) → rgba string
function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

interface PathSeg {
  id: string;
  points: [number, number][];
  baseColor: string;
  capacity: number;        // normalized 0-1
  type: 'submarine' | 'backbone' | 'peering';
  load: CableLoad;
  landings: { name: string; lat: number; lon: number }[];
}

const LOAD_TINT: Record<CableLoad, string> = {
  normal: '#00e5ff',
  congested: '#ffab00',
  fault: '#ff1744',
};

export default function AuroraCableLayer({ cables, backbone, enabled = true, loadFor }: AuroraCablesProps) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(performance.now());

  useEffect(() => {
    if (!enabled || !map) return;

    // ── Build path data ──
    const segs: PathSeg[] = [];
    const maxCableTbps = Math.max(1, ...cables.map(c => c.capacityTbps || 1));
    for (const c of cables) {
      const pts = c.waypoints.filter(p => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])) as [number, number][];
      if (pts.length < 2) continue;
      segs.push({
        id: `cable-${c.id}`,
        points: pts,
        baseColor: c.color,
        capacity: Math.min(1, (c.capacityTbps || 10) / maxCableTbps),
        type: 'submarine',
        load: loadFor?.(c.id) ?? 'normal',
        landings: c.landingPoints.filter(lp => Number.isFinite(lp.lat) && Number.isFinite(lp.lon)),
      });
    }
    const maxBbGbps = Math.max(1, ...backbone.map(b => b.capacityGbps || 1));
    for (const b of backbone) {
      if (!Number.isFinite(b.from?.lat) || !Number.isFinite(b.to?.lat)) continue;
      segs.push({
        id: `bb-${b.id}`,
        points: [[b.from.lat, b.from.lon], [b.to.lat, b.to.lon]],
        baseColor: b.color,
        capacity: Math.min(1, (b.capacityGbps || 800) / maxBbGbps),
        type: b.type === 'peering' ? 'peering' : 'backbone',
        load: loadFor?.(b.id) ?? 'normal',
        landings: [{ name: b.from.name, lat: b.from.lat, lon: b.from.lon }, { name: b.to.name, lat: b.to.lat, lon: b.to.lon }],
      });
    }

    // ── Canvas setup ──
    const size = map.getSize();
    const canvas = L.DomUtil.create('canvas', 'leaflet-aurora-cable-canvas') as HTMLCanvasElement;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.x * dpr;
    canvas.height = size.y * dpr;
    canvas.style.width = `${size.x}px`;
    canvas.style.height = `${size.y}px`;
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '420';
    canvasRef.current = canvas;
    map.getPanes().overlayPane.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const resize = () => {
      const s = map.getSize();
      const r = window.devicePixelRatio || 1;
      canvas.width = s.x * r;
      canvas.height = s.y * r;
      canvas.style.width = `${s.x}px`;
      canvas.style.height = `${s.y}px`;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(r, r);
    };

    const reposition = () => {
      const tl = map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(canvas, tl);
    };

    // ── Project a path to screen coords (cached per frame) ──
    const projectPath = (pts: [number, number][]) =>
      pts.map(p => map.latLngToContainerPoint(p));

    // ── Smooth Catmull-Rom-ish path through projected points ──
    const drawSmoothPath = (proj: L.Point[]) => {
      ctx.beginPath();
      ctx.moveTo(proj[0].x, proj[0].y);
      if (proj.length === 2) {
        ctx.lineTo(proj[1].x, proj[1].y);
        return;
      }
      for (let i = 0; i < proj.length - 1; i++) {
        const p0 = proj[Math.max(0, i - 1)];
        const p1 = proj[i];
        const p2 = proj[i + 1];
        const p3 = proj[Math.min(proj.length - 1, i + 2)];
        const cp1x = p1.x + (p2.x - p0.x) / 6;
        const cp1y = p1.y + (p2.y - p0.y) / 6;
        const cp2x = p2.x - (p3.x - p1.x) / 6;
        const cp2y = p2.y - (p3.y - p1.y) / 6;
        ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, p2.x, p2.y);
      }
    };

    // ── Cumulative arc-length on screen for traveling waves ──
    const arcLengths = (proj: L.Point[]) => {
      const cum: number[] = [0];
      let total = 0;
      for (let i = 1; i < proj.length; i++) {
        total += Math.hypot(proj[i].x - proj[i - 1].x, proj[i].y - proj[i - 1].y);
        cum.push(total);
      }
      return { cum, total };
    };

    const pointAtScreen = (proj: L.Point[], cum: number[], total: number, t: number): L.Point => {
      const d = (t % 1) * total;
      for (let i = 1; i < proj.length; i++) {
        if (d <= cum[i]) {
          const local = (d - cum[i - 1]) / Math.max(1, cum[i] - cum[i - 1]);
          return L.point(
            proj[i - 1].x + (proj[i].x - proj[i - 1].x) * local,
            proj[i - 1].y + (proj[i].y - proj[i - 1].y) * local,
          );
        }
      }
      return proj[proj.length - 1];
    };

    const draw = (now: number) => {
      const t = (now - startRef.current) / 1000;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const ordered = [...segs].sort((a, b) => {
        const order = { submarine: 0, backbone: 1, peering: 2 } as const;
        return order[a.type] - order[b.type];
      });

      for (const s of ordered) {
        const proj = projectPath(s.points);
        if (proj.length < 2) continue;

        const tint = LOAD_TINT[s.load];
        const baseW = s.type === 'submarine' ? 1.1 + s.capacity * 1.4
                    : s.type === 'backbone'  ? 0.9 + s.capacity * 1.0
                    : 0.7;

        // ── Layer 1: abyssal shadow (submarine only) ──
        if (s.type === 'submarine') {
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = 'rgba(0, 10, 24, 0.34)';
          ctx.lineWidth = baseW + 3.5;
          drawSmoothPath(proj); ctx.stroke();
        }

        // ── Layer 2: outer halo ──
        const glowPulse = 0.5 + 0.5 * Math.sin(t * 1.0 + (s.id.charCodeAt(0) % 10));
        ctx.strokeStyle = rgba(s.baseColor, 0.10 + glowPulse * 0.07);
        ctx.lineWidth = baseW + 4;
        drawSmoothPath(proj); ctx.stroke();

        // ── Layer 2b: inner halo ──
        ctx.strokeStyle = rgba(s.baseColor, 0.16 + glowPulse * 0.06);
        ctx.lineWidth = baseW + 1.8;
        drawSmoothPath(proj); ctx.stroke();

        // ── Layer 3: core ribbon ──
        ctx.strokeStyle = rgba(s.baseColor, 0.72);
        ctx.lineWidth = baseW;
        if (s.type === 'peering') ctx.setLineDash([3, 5]);
        drawSmoothPath(proj); ctx.stroke();
        ctx.setLineDash([]);

        // ── Layer 4: traveling comet pulses ──
        const { cum, total } = arcLengths(proj);
        if (total > 12 && s.type !== 'peering') {
          const pulseCount = Math.max(2, Math.round(1 + s.capacity * 3));
          const speed = s.load === 'fault' ? 0.022 : s.load === 'congested' ? 0.05 : 0.09;

          for (let i = 0; i < pulseCount; i++) {
            const phase = (t * speed + i / pulseCount) % 1;
            const head = pointAtScreen(proj, cum, total, phase);

            // Comet trail
            const trailLen = 18;
            for (let j = 0; j < trailLen; j++) {
              const back = (phase - j * 0.0045 + 1) % 1;
              const pt = pointAtScreen(proj, cum, total, back);
              const a = (1 - j / trailLen) * 0.5;
              const r = (1 - j / trailLen) * 1.6 + 0.3;
              ctx.fillStyle = rgba(tint, a);
              ctx.beginPath();
              ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
              ctx.fill();
            }

            // Bright head
            const grad = ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, 7);
            grad.addColorStop(0, rgba('#ffffff', 0.95));
            grad.addColorStop(0.35, rgba(tint, 0.75));
            grad.addColorStop(1, rgba(tint, 0));
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(head.x, head.y, 7, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // ── Layer 5: fault overlay — dim red dashes ──
        if (s.load === 'fault' && Math.floor(t * 2) % 2 === 0) {
          ctx.strokeStyle = rgba('#ff1744', 0.5);
          ctx.lineWidth = baseW + 0.5;
          ctx.setLineDash([4, 8]);
          drawSmoothPath(proj); ctx.stroke();
          ctx.setLineDash([]);
        }
      }

      // ── Landing beacons — small, gentle ring ──
      const beaconPulse = (t * 1.2) % 1;
      const seenLandings = new Set<string>();
      for (const s of ordered) {
        for (const lp of s.landings) {
          const key = `${lp.lat.toFixed(2)},${lp.lon.toFixed(2)}`;
          if (seenLandings.has(key)) continue;
          seenLandings.add(key);
          const pt = map.latLngToContainerPoint([lp.lat, lp.lon]);
          const tint = LOAD_TINT[s.load];

          // Single soft expanding ring
          const ringR = 2.5 + beaconPulse * 8;
          ctx.strokeStyle = rgba(tint, (1 - beaconPulse) * 0.55);
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, ringR, 0, Math.PI * 2);
          ctx.stroke();

          // Tiny anchor dot
          ctx.fillStyle = '#0b1422';
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 2.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = rgba(tint, 0.85);
          ctx.lineWidth = 0.9;
          ctx.stroke();
        }
      }

      rafRef.current = requestAnimationFrame(draw);
    };

    reposition();
    rafRef.current = requestAnimationFrame(draw);

    map.on('move', reposition);
    map.on('zoom', reposition);
    map.on('resize', resize);
    map.on('moveend', reposition);
    map.on('zoomend', reposition);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      map.off('move', reposition);
      map.off('zoom', reposition);
      map.off('resize', resize);
      map.off('moveend', reposition);
      map.off('zoomend', reposition);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    };
  }, [map, cables, backbone, enabled, loadFor]);

  return null;
}

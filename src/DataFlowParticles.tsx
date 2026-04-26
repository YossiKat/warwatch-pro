// ═══════════════════════════════════════════════════════════════
// DataFlowParticles — אנימציית זרימת דאטה לאורך כבלים/backbone
// נקודות זוהרות שנעות לאורך פוליליין, צבע לפי עומס:
//   ירוק = תקין | כתום = עומס | אדום = תקלה
// ═══════════════════════════════════════════════════════════════
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

export type LoadStatus = 'normal' | 'congested' | 'fault';

export interface FlowPath {
  id: string;
  points: [number, number][]; // [lat, lon]
  status: LoadStatus;
  speed?: number;       // particles per second
  particleCount?: number;
}

const STATUS_COLOR: Record<LoadStatus, string> = {
  normal: '#00e676',     // ירוק
  congested: '#ff9100',  // כתום
  fault: '#ff1744',      // אדום
};

interface Props {
  paths: FlowPath[];
  enabled?: boolean;
}

// Cumulative segment lengths for interpolation
function buildSegments(points: [number, number][]) {
  const segs: { from: [number, number]; to: [number, number]; len: number; cum: number }[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const dlat = b[0] - a[0];
    const dlon = b[1] - a[1];
    const len = Math.sqrt(dlat * dlat + dlon * dlon);
    segs.push({ from: a, to: b, len, cum: total });
    total += len;
  }
  return { segs, total };
}

function pointAt(segs: ReturnType<typeof buildSegments>['segs'], total: number, t: number): [number, number] {
  if (total === 0 || segs.length === 0) return segs[0]?.from ?? [0, 0];
  const dist = (t % 1) * total;
  for (const s of segs) {
    if (dist <= s.cum + s.len) {
      const local = (dist - s.cum) / (s.len || 1);
      return [s.from[0] + (s.to[0] - s.from[0]) * local, s.from[1] + (s.to[1] - s.from[1]) * local];
    }
  }
  const last = segs[segs.length - 1];
  return last.to;
}

export default function DataFlowParticles({ paths, enabled = true }: Props) {
  const map = useMap();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(performance.now());

  useEffect(() => {
    if (!enabled || !map) return;

    const mapSize = map.getSize();
    const canvas = L.DomUtil.create('canvas', 'leaflet-data-flow-canvas') as HTMLCanvasElement;
    canvas.width = mapSize.x;
    canvas.height = mapSize.y;
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '450';
    canvasRef.current = canvas;

    const overlayPane = map.getPanes().overlayPane;
    overlayPane.appendChild(canvas);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Pre-compute segments per path
    const segCache = paths.map(p => ({ ...buildSegments(p.points), path: p }));

    const resize = () => {
      const s = map.getSize();
      canvas.width = s.x;
      canvas.height = s.y;
    };

    const reposition = () => {
      const topLeft = map.containerPointToLayerPoint([0, 0]);
      L.DomUtil.setPosition(canvas, topLeft);
    };

    const draw = (now: number) => {
      const elapsed = (now - startTimeRef.current) / 1000;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (const entry of segCache) {
        const { segs, total, path } = entry;
        if (total === 0) continue;
        const color = STATUS_COLOR[path.status];
        const speed = path.speed ?? (path.status === 'congested' ? 0.04 : path.status === 'fault' ? 0.015 : 0.08);
        const count = path.particleCount ?? 4;

        for (let i = 0; i < count; i++) {
          const phase = (elapsed * speed + i / count) % 1;
          const [lat, lon] = pointAt(segs, total, phase);
          const pt = map.latLngToContainerPoint([lat, lon]);

          // Glow halo
          const grad = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, 8);
          grad.addColorStop(0, color);
          grad.addColorStop(0.4, color + 'aa');
          grad.addColorStop(1, color + '00');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 8, 0, Math.PI * 2);
          ctx.fill();

          // Bright core
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }

        // Fault: blink red dashes
        if (path.status === 'fault' && Math.floor(elapsed * 3) % 2 === 0) {
          ctx.strokeStyle = color + '88';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 6]);
          ctx.beginPath();
          for (let i = 0; i < path.points.length; i++) {
            const pt = map.latLngToContainerPoint(path.points[i]);
            if (i === 0) ctx.moveTo(pt.x, pt.y);
            else ctx.lineTo(pt.x, pt.y);
          }
          ctx.stroke();
          ctx.setLineDash([]);
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
  }, [map, paths, enabled]);

  return null;
}

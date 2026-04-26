import { useRef, useCallback, useEffect, useState } from 'react';

interface RouteKey {
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
}

type LatLng = [number, number];

interface CachedRoute {
  waypoints: LatLng[];
  distance: number; // meters
  duration: number; // seconds
  fetchedAt: number;
  clipped?: boolean; // true if route was clipped to Israel bounds
}

const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving';
const CACHE_TTL = 10 * 60 * 1000; // 10 min
const MAX_CONCURRENT = 3;

// Render bounds for Israel map overlays — tighter than a generic bbox so markers/routes
// don't bleed into Jordan or the Mediterranean, while still keeping border towns visible.
export const ISRAEL_RENDER_BOUNDS = { latMin: 29.45, latMax: 33.4, lonMin: 34.25, lonMax: 35.88 };

export function isWithinIsraelRenderBounds(lat: number, lon: number): boolean {
  return lat >= ISRAEL_RENDER_BOUNDS.latMin && lat <= ISRAEL_RENDER_BOUNDS.latMax &&
         lon >= ISRAEL_RENDER_BOUNDS.lonMin && lon <= ISRAEL_RENDER_BOUNDS.lonMax;
}

function isInBounds(wp: LatLng): boolean {
  return isWithinIsraelRenderBounds(wp[0], wp[1]);
}

/**
 * Clip route waypoints to Israel bounds.
 * Instead of rejecting the entire route, we keep segments that are within bounds
 * and clamp border-crossing points to the boundary edge.
 */
function clipRouteToIsrael(waypoints: LatLng[]): LatLng[] | null {
  if (waypoints.length < 2) return null;

  // Quick check — if all points are in bounds, return as-is
  if (waypoints.every(isInBounds)) return waypoints;

  const clipped: LatLng[] = [];
  
  for (let i = 0; i < waypoints.length; i++) {
    const wp = waypoints[i];
    
    if (isInBounds(wp)) {
      // If previous point was out of bounds, add a clamped transition point
      if (i > 0 && !isInBounds(waypoints[i - 1])) {
        clipped.push(clampToBounds(waypoints[i - 1], wp));
      }
      clipped.push(wp);
    } else {
      // Point is outside bounds
      if (i > 0 && isInBounds(waypoints[i - 1])) {
        // Transitioning from in-bounds to out — add clamped edge point
        clipped.push(clampToBounds(wp, waypoints[i - 1]));
      }
      // Skip out-of-bounds points entirely
    }
  }

  // Need at least 2 points for a valid route
  return clipped.length >= 2 ? clipped : null;
}

/**
 * Clamp an out-of-bounds point toward an in-bounds reference point,
 * placing it at the boundary edge.
 */
function clampToBounds(outPt: LatLng, inPt: LatLng): LatLng {
  let t = 1; // interpolation factor: 0 = outPt, 1 = inPt
  
  // Find the largest t where the interpolated point crosses each boundary
  const dLat = inPt[0] - outPt[0];
  const dLon = inPt[1] - outPt[1];
  
  if (dLat !== 0) {
    if (outPt[0] < ISRAEL_RENDER_BOUNDS.latMin) t = Math.min(t, (ISRAEL_RENDER_BOUNDS.latMin - outPt[0]) / dLat);
    if (outPt[0] > ISRAEL_RENDER_BOUNDS.latMax) t = Math.min(t, (ISRAEL_RENDER_BOUNDS.latMax - outPt[0]) / dLat);
  }
  if (dLon !== 0) {
    if (outPt[1] < ISRAEL_RENDER_BOUNDS.lonMin) t = Math.min(t, (ISRAEL_RENDER_BOUNDS.lonMin - outPt[1]) / dLon);
    if (outPt[1] > ISRAEL_RENDER_BOUNDS.lonMax) t = Math.min(t, (ISRAEL_RENDER_BOUNDS.lonMax - outPt[1]) / dLon);
  }

  t = Math.max(0, Math.min(1, t));
  return [
    outPt[0] + dLat * t,
    outPt[1] + dLon * t,
  ];
}

function routeKey(r: RouteKey): string {
  return `${r.fromLat.toFixed(5)},${r.fromLon.toFixed(5)}->${r.toLat.toFixed(5)},${r.toLon.toFixed(5)}`;
}

/**
 * Hook that fetches real road routes from OSRM public API.
 * Caches results, handles rate limiting, and clips routes to Israel bounds.
 */
export function useOSRMRoutes() {
  const cache = useRef<Map<string, CachedRoute>>(new Map());
  const pending = useRef<Set<string>>(new Set());
  const [version, setVersion] = useState(0);

  // Clean expired cache entries periodically
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      for (const [key, val] of cache.current.entries()) {
        if (now - val.fetchedAt > CACHE_TTL) {
          cache.current.delete(key);
        }
      }
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  const fetchRoute = useCallback(async (from: RouteKey) => {
    const key = routeKey(from);
    
    // Already cached
    const cached = cache.current.get(key);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) return;

    // Already fetching
    if (pending.current.has(key)) return;

    // Rate limit
    if (pending.current.size >= MAX_CONCURRENT) return;

    pending.current.add(key);

    try {
      const url = `${OSRM_BASE}/${from.fromLon},${from.fromLat};${from.toLon},${from.toLat}?overview=full&geometries=geojson`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`OSRM ${res.status}`);
      const data = await res.json();

      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const rawCoords: LatLng[] = route.geometry.coordinates.map(
          (c: [number, number]) => [c[1], c[0]] as LatLng // GeoJSON is [lon,lat], Leaflet needs [lat,lon]
        );

        // Clip route to Israel bounds — smart fallback for border routes
        const clippedCoords = clipRouteToIsrael(rawCoords);
        
        // Reject routes with large jumps (> 0.08 degrees ≈ 8km between consecutive points)
        const hasLargeJump = clippedCoords && clippedCoords.some((pt, i) => {
          if (i === 0) return false;
          return Math.hypot(pt[0] - clippedCoords[i-1][0], pt[1] - clippedCoords[i-1][1]) > 0.08;
        });

        if (clippedCoords && clippedCoords.length >= 2 && !hasLargeJump) {
          cache.current.set(key, {
            waypoints: clippedCoords,
            distance: route.distance,
            duration: route.duration,
            fetchedAt: Date.now(),
            clipped: clippedCoords.length !== rawCoords.length,
          });
        } else {
          // Route entirely outside Israel — store empty fallback
          cache.current.set(key, {
            waypoints: [[from.fromLat, from.fromLon], [from.toLat, from.toLon]],
            distance: 0,
            duration: 0,
            fetchedAt: Date.now(),
          });
        }

        setVersion(v => v + 1); // trigger re-render
      }
    } catch (err) {
      console.warn('OSRM route fetch failed:', key, err);
      // On failure, create a simple fallback so we don't retry immediately
      cache.current.set(key, {
        waypoints: [[from.fromLat, from.fromLon], [from.toLat, from.toLon]],
        distance: 0,
        duration: 0,
        fetchedAt: Date.now(),
      });
      setVersion(v => v + 1);
    } finally {
      pending.current.delete(key);
    }
  }, []);

  const getRoute = useCallback((from: RouteKey): CachedRoute | null => {
    const key = routeKey(from);
    const cached = cache.current.get(key);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL) {
      return cached;
    }
    // Trigger fetch (non-blocking)
    fetchRoute(from);
    return null;
  }, [fetchRoute]);

  return { getRoute, version };
}

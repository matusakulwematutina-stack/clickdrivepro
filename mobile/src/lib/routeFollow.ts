import type { LatLng } from '../types';
import { haversineKm } from './geo';

/** Cap (0–360°) de A vers B */
export function bearingDegrees(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const φ1 = toRad(a.latitude);
  const φ2 = toRad(b.latitude);
  const Δλ = toRad(b.longitude - a.longitude);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x);
  return ((θ * 180) / Math.PI + 360) % 360;
}

export function lerpLatLng(a: LatLng, b: LatLng, t: number): LatLng {
  const u = Math.max(0, Math.min(1, t));
  return {
    latitude: a.latitude + (b.latitude - a.latitude) * u,
    longitude: a.longitude + (b.longitude - a.longitude) * u,
  };
}

type Snap = {
  point: LatLng;
  index: number;
  bearing: number;
  progress: number; // 0..1 le long de la route
};

/** Projette un GPS sur le tracé routier (guidage). */
export function snapToRoute(point: LatLng, route: LatLng[]): Snap | null {
  if (route.length < 2) return null;

  let bestDist = Infinity;
  let best: Snap | null = null;
  let cumBefore = 0;
  let total = 0;
  for (let i = 0; i < route.length - 1; i++) {
    total += haversineKm(route[i], route[i + 1]);
  }
  if (total <= 0) {
    return {
      point: route[0],
      index: 0,
      bearing: 0,
      progress: 0,
    };
  }

  for (let i = 0; i < route.length - 1; i++) {
    const a = route[i];
    const b = route[i + 1];
    const segLen = haversineKm(a, b) || 1e-9;

    // Projection approximative en lat/lng
    const vx = b.longitude - a.longitude;
    const vy = b.latitude - a.latitude;
    const wx = point.longitude - a.longitude;
    const wy = point.latitude - a.latitude;
    const c1 = vx * wx + vy * wy;
    const c2 = vx * vx + vy * vy || 1e-12;
    const t = Math.max(0, Math.min(1, c1 / c2));
    const proj = {
      latitude: a.latitude + vy * t,
      longitude: a.longitude + vx * t,
    };
    const d = haversineKm(point, proj);
    if (d < bestDist) {
      bestDist = d;
      const along = cumBefore + segLen * t;
      best = {
        point: proj,
        index: i,
        bearing: bearingDegrees(a, b),
        progress: along / total,
      };
    }
    cumBefore += segLen;
  }

  return best;
}

/** Point sur la route à un progrès 0..1 */
export function pointAtProgress(route: LatLng[], progress: number): Snap | null {
  if (route.length < 2) return null;
  let total = 0;
  const lens: number[] = [];
  for (let i = 0; i < route.length - 1; i++) {
    const len = haversineKm(route[i], route[i + 1]);
    lens.push(len);
    total += len;
  }
  if (total <= 0) {
    return { point: route[0], index: 0, bearing: 0, progress: 0 };
  }
  let target = Math.max(0, Math.min(1, progress)) * total;
  for (let i = 0; i < lens.length; i++) {
    if (target <= lens[i] || i === lens.length - 1) {
      const t = lens[i] > 0 ? target / lens[i] : 0;
      const a = route[i];
      const b = route[i + 1];
      return {
        point: lerpLatLng(a, b, Math.min(1, t)),
        index: i,
        bearing: bearingDegrees(a, b),
        progress: Math.max(0, Math.min(1, progress)),
      };
    }
    target -= lens[i];
  }
  const last = route.length - 1;
  return {
    point: route[last],
    index: last - 1,
    bearing: bearingDegrees(route[last - 1], route[last]),
    progress: 1,
  };
}

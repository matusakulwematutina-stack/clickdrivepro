import type { LatLng } from '../types';

export type RouteManeuver = {
  id: string;
  type: string;
  modifier?: string | null;
  /** Numéro de sortie au rond-point (1, 2, 3…) */
  exit?: number | null;
  location: LatLng;
  distanceM: number;
  name?: string | null;
};

export type RouteResult = {
  coordinates: LatLng[];
  distanceKm: number;
  durationMin: number;
  steps: RouteManeuver[];
};

/**
 * Itinéraire routier via OSRM — avec étapes (ronds-points, virages, arrivée).
 */
function parseOsrmRoute(route: {
  geometry?: { coordinates?: [number, number][] };
  distance?: number;
  duration?: number;
  legs?: Array<{
    steps?: Array<{
      distance?: number;
      name?: string;
      maneuver?: {
        type?: string;
        modifier?: string;
        exit?: number;
        location?: [number, number];
      };
    }>;
  }>;
}): RouteResult | null {
  if (!route?.geometry?.coordinates?.length) return null;

  const coordinates: LatLng[] = route.geometry.coordinates.map((c) => ({
    longitude: c[0],
    latitude: c[1],
  }));

  const steps: RouteManeuver[] = [];
  const legs = route.legs || [];
  let stepIdx = 0;
  for (const leg of legs) {
    for (const step of leg.steps || []) {
      const m = step.maneuver || {};
      const loc = m.location;
      if (!loc) continue;
      steps.push({
        id: `s-${stepIdx++}-${m.type}-${loc[0]}-${loc[1]}`,
        type: String(m.type || 'turn'),
        modifier: m.modifier ?? null,
        exit: typeof m.exit === 'number' ? m.exit : null,
        location: { longitude: loc[0], latitude: loc[1] },
        distanceM: Number(step.distance || 0),
        name: step.name || null,
      });
    }
  }

  return {
    coordinates,
    distanceKm: Number(((route.distance || 0) / 1000).toFixed(2)),
    durationMin: Math.max(1, Math.round((route.duration || 0) / 60)),
    steps,
  };
}

/** Itinéraire A → B (ou plus via `fetchDrivingRouteWaypoints`). */
export async function fetchDrivingRoute(
  from: LatLng,
  to: LatLng,
): Promise<RouteResult | null> {
  return fetchDrivingRouteWaypoints([from, to]);
}

/** Itinéraire multi-points (pickup → arrêts → destination). */
export async function fetchDrivingRouteWaypoints(
  points: LatLng[],
): Promise<RouteResult | null> {
  if (points.length < 2) return null;
  const path = points.map((p) => `${p.longitude},${p.latitude}`).join(';');
  const url =
    `https://router.project-osrm.org/route/v1/driving/${path}` +
    `?overview=full&geometries=geojson&steps=true`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    return parseOsrmRoute(json?.routes?.[0]);
  } catch {
    return null;
  }
}

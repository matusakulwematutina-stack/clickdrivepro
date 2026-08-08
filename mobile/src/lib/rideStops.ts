import type { LatLng, Ride, RideStop } from '../types';

export function parseRideStops(ride: Pick<Ride, 'stops'> | { stops?: unknown }): RideStop[] {
  const raw = ride.stops;
  if (!Array.isArray(raw)) return [];
  const out: RideStop[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const lat = Number((item as RideStop).lat);
    const lng = Number((item as RideStop).lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const label = String((item as RideStop).label || 'Arrêt').trim() || 'Arrêt';
    out.push({ label, lat, lng });
  }
  return out.slice(0, 2);
}

export function stopToLatLng(stop: RideStop): LatLng {
  return { latitude: stop.lat, longitude: stop.lng };
}

/** Points restants pendant la course (arrêts non faits + destination). */
export function remainingWaypoints(ride: Ride): Array<{ label: string; coordinate: LatLng }> {
  const stops = parseRideStops(ride);
  const done = Math.max(0, Math.min(ride.stops_done ?? 0, stops.length));
  const pending = stops.slice(done).map((s, i) => ({
    label: s.label || `Arrêt ${done + i + 1}`,
    coordinate: stopToLatLng(s),
  }));
  pending.push({
    label: ride.dropoff_address || 'Destination',
    coordinate: { latitude: ride.dropoff_lat, longitude: ride.dropoff_lng },
  });
  return pending;
}

export function rideLegsLabel(ride: Ride): string | null {
  const n = parseRideStops(ride).length;
  if (n === 1) return 'Double arrêt';
  if (n >= 2) return 'Triple arrêt';
  return null;
}

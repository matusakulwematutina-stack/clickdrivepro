import type { LatLng } from '../types';

const EARTH_KM = 6371;

export function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

/** Estimation simple durée (min) à ~25 km/h urbain. */
export function estimateDurationMin(distanceKm: number): number {
  return Math.max(5, Math.round((distanceKm / 25) * 60));
}

export function formatPrice(fc: number): string {
  return `${Math.round(fc).toLocaleString('fr-FR')} FC`;
}

/** Prix convenu (offre acceptée) — final_price prioritaire. */
export function rideAgreedPrice(ride: {
  final_price?: number | string | null;
  estimated_price?: number | string | null;
} | null | undefined): number {
  if (!ride) return 0;
  const n = Number(ride.final_price ?? ride.estimated_price ?? 0);
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export const LUBUMBASHI: LatLng = {
  latitude: -11.6647,
  longitude: 27.4794,
};

/** Zone de service ClickPro Drive */
export const SERVICE_RADIUS_KM = 60;

/** Delta max carte ≈ diamètre 120 km (évite de zoomer trop loin) */
export const SERVICE_MAX_LAT_DELTA = (SERVICE_RADIUS_KM * 2.1) / 111;

export type MapRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export function isInServiceArea(point: LatLng, radiusKm = SERVICE_RADIUS_KM): boolean {
  return haversineKm(LUBUMBASHI, point) <= radiusKm;
}

/** Ramène un point dans le cercle de service (bordure si hors zone) */
export function clampToServiceArea(point: LatLng, radiusKm = SERVICE_RADIUS_KM): LatLng {
  const dist = haversineKm(LUBUMBASHI, point);
  if (dist <= radiusKm || dist === 0) return point;

  const ratio = (radiusKm * 0.98) / dist;
  return {
    latitude: LUBUMBASHI.latitude + (point.latitude - LUBUMBASHI.latitude) * ratio,
    longitude: LUBUMBASHI.longitude + (point.longitude - LUBUMBASHI.longitude) * ratio,
  };
}

export function lubumbashiViewBox(): {
  west: number;
  south: number;
  east: number;
  north: number;
} {
  const dLat = SERVICE_RADIUS_KM / 111;
  const dLng =
    SERVICE_RADIUS_KM / (111 * Math.cos((LUBUMBASHI.latitude * Math.PI) / 180));
  return {
    west: LUBUMBASHI.longitude - dLng,
    south: LUBUMBASHI.latitude - dLat,
    east: LUBUMBASHI.longitude + dLng,
    north: LUBUMBASHI.latitude + dLat,
  };
}

/**
 * Si la région sort de Lubumbashi (60 km), renvoie une région corrigée.
 * Sinon null (rien à faire).
 */
export function constrainMapRegion(region: MapRegion): MapRegion | null {
  let { latitude, longitude, latitudeDelta, longitudeDelta } = region;
  let changed = false;

  if (latitudeDelta > SERVICE_MAX_LAT_DELTA) {
    latitudeDelta = SERVICE_MAX_LAT_DELTA;
    longitudeDelta = SERVICE_MAX_LAT_DELTA;
    changed = true;
  }

  const center = { latitude, longitude };
  if (!isInServiceArea(center)) {
    const clamped = clampToServiceArea(center);
    latitude = clamped.latitude;
    longitude = clamped.longitude;
    changed = true;
  }

  if (!changed) return null;
  return { latitude, longitude, latitudeDelta, longitudeDelta };
}

export const LUBUMBASHI_REGION: MapRegion = {
  ...LUBUMBASHI,
  latitudeDelta: 0.12,
  longitudeDelta: 0.12,
};

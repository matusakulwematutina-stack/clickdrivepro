import { fetchAppSettings, fetchProvinces } from './adminApi';
import type { AppSettings, LatLng, ServiceProvince, VehicleType } from '../types';
import {
  haversineKm,
  LUBUMBASHI,
  SERVICE_RADIUS_KM,
  type MapRegion,
} from './geo';

let cachedSettings: AppSettings | null = null;
let cachedProvince: ServiceProvince | null = null;
let loadedAt = 0;
let lastError: string | null = null;

const TTL_MS = 30_000;

export function getServiceConfigError() {
  return lastError;
}

export function clearServiceConfigCache() {
  cachedSettings = null;
  cachedProvince = null;
  loadedAt = 0;
}

export async function loadServiceConfig(force = false) {
  if (!force && cachedSettings && Date.now() - loadedAt < TTL_MS) {
    return { settings: cachedSettings, province: cachedProvince };
  }
  try {
    const [settings, provinces] = await Promise.all([
      fetchAppSettings(),
      fetchProvinces(),
    ]);
    cachedSettings = settings;
    cachedProvince =
      provinces.find((p) => p.code === settings?.active_province_code) ||
      provinces.find((p) => p.is_active) ||
      null;
    loadedAt = Date.now();
    lastError = settings ? null : 'Réglages admin introuvables';
    if (__DEV__) {
      console.log('[serviceConfig]', {
        province: cachedProvince?.code,
        radius: settings?.zone_radius_km,
        taxiKm: settings?.price_per_km_taxi,
        commission: settings?.commission_enabled
          ? settings?.commission_percent
          : 'off',
      });
    }
  } catch (e) {
    lastError = e instanceof Error ? e.message : 'Erreur chargement réglages';
    console.warn('[serviceConfig]', lastError);
  }
  return { settings: cachedSettings, province: cachedProvince };
}

export function getCachedSettings() {
  return cachedSettings;
}

export function getCachedProvince() {
  return cachedProvince;
}

export function getServiceCenter(): LatLng {
  if (cachedProvince) {
    return {
      latitude: cachedProvince.center_lat,
      longitude: cachedProvince.center_lng,
    };
  }
  return LUBUMBASHI;
}

export function getServiceRadiusKm() {
  return Number(cachedSettings?.zone_radius_km ?? SERVICE_RADIUS_KM);
}

export function getServiceViewBox() {
  const center = getServiceCenter();
  const radiusKm = getServiceRadiusKm();
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos((center.latitude * Math.PI) / 180));
  return {
    west: center.longitude - dLng,
    south: center.latitude - dLat,
    east: center.longitude + dLng,
    north: center.latitude + dLat,
  };
}

export function getServiceMapRegion(): MapRegion {
  const center = getServiceCenter();
  const radiusKm = getServiceRadiusKm();
  const latitudeDelta = Math.min(0.9, Math.max(0.08, (radiusKm * 1.4) / 111));
  return {
    ...center,
    latitudeDelta,
    longitudeDelta: latitudeDelta,
  };
}

export function isPointInActiveZone(point: LatLng): boolean {
  return haversineKm(getServiceCenter(), point) <= getServiceRadiusKm();
}

export function clampToActiveZone(point: LatLng): LatLng {
  const center = getServiceCenter();
  const radiusKm = getServiceRadiusKm();
  const dist = haversineKm(center, point);
  if (dist <= radiusKm || dist === 0) return point;
  const ratio = (radiusKm * 0.98) / dist;
  return {
    latitude: center.latitude + (point.latitude - center.latitude) * ratio,
    longitude: center.longitude + (point.longitude - center.longitude) * ratio,
  };
}

/** Limite le pan/zoom carte à la zone admin active. */
export function constrainServiceMapRegion(region: MapRegion): MapRegion | null {
  const radiusKm = getServiceRadiusKm();
  const maxDelta = (radiusKm * 2.1) / 111;
  let { latitude, longitude, latitudeDelta, longitudeDelta } = region;
  let changed = false;

  if (latitudeDelta > maxDelta) {
    latitudeDelta = maxDelta;
    longitudeDelta = maxDelta;
    changed = true;
  }

  const center = { latitude, longitude };
  if (!isPointInActiveZone(center)) {
    const clamped = clampToActiveZone(center);
    latitude = clamped.latitude;
    longitude = clamped.longitude;
    changed = true;
  }

  if (!changed) return null;
  return { latitude, longitude, latitudeDelta, longitudeDelta };
}

export function estimateFareFromSettings(
  vehicleType: VehicleType,
  distanceKm: number,
  durationMin: number,
  intermediateStops = 0,
): number {
  const s = cachedSettings;
  const stopFee = Math.max(0, intermediateStops) * 1500;
  if (!s) {
    const fallback: Record<VehicleType, { base: number; perKm: number; min: number }> = {
      taxi: { base: 5000, perKm: 1200, min: 5000 },
      moto: { base: 2000, perKm: 800, min: 2000 },
      pickup: { base: 8000, perKm: 1800, min: 8000 },
    };
    const r = fallback[vehicleType];
    const raw = r.base + distanceKm * r.perKm + durationMin * 150 + stopFee;
    return Math.max(r.min, Math.round(raw / 100) * 100);
  }
  const base =
    vehicleType === 'moto'
      ? Number(s.base_fare_moto)
      : vehicleType === 'pickup'
        ? Number(s.base_fare_pickup)
        : Number(s.base_fare_taxi);
  const perKm =
    vehicleType === 'moto'
      ? Number(s.price_per_km_moto)
      : vehicleType === 'pickup'
        ? Number(s.price_per_km_pickup)
        : Number(s.price_per_km_taxi);
  const raw = base + distanceKm * perKm + durationMin * 50 + stopFee;
  return Math.max(base, Math.round(raw / 100) * 100);
}

export function commissionForPrice(price: number): {
  percent: number;
  amount: number;
} {
  const s = cachedSettings;
  if (!s?.commission_enabled) return { percent: 0, amount: 0 };
  const percent = Number(s.commission_percent || 0);
  const amount = Math.round((price * percent) / 100);
  return { percent, amount };
}

export function getMinDriverBalanceFc() {
  return Number(cachedSettings?.min_driver_balance_fc ?? 5000);
}

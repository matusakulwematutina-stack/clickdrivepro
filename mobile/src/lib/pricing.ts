import { estimateFareFromSettings } from './serviceConfig';
import type { VehicleType } from '../types';

const RATES: Record<
  VehicleType,
  { base: number; perKm: number; perMin: number; min: number; label: string }
> = {
  taxi: { base: 5000, perKm: 1200, perMin: 150, min: 5000, label: 'Taxi' },
  moto: { base: 2000, perKm: 800, perMin: 100, min: 2000, label: 'Moto' },
  pickup: { base: 8000, perKm: 1800, perMin: 200, min: 8000, label: 'Pickup' },
};

export function estimateFare(
  vehicleType: VehicleType,
  distanceKm: number,
  durationMin: number,
  intermediateStops = 0,
): number {
  return estimateFareFromSettings(
    vehicleType,
    distanceKm,
    durationMin,
    intermediateStops,
  );
}

export function vehicleLabel(type: VehicleType): string {
  return RATES[type].label;
}

export const VEHICLE_OPTIONS: {
  id: VehicleType;
  label: string;
  icon: string;
}[] = [
  { id: 'taxi', label: 'Taxi', icon: '🚕' },
  { id: 'moto', label: 'Moto', icon: '🏍' },
  { id: 'pickup', label: 'Pickup', icon: '🛻' },
];

import type { VehicleType } from '../types';
import { resolveVehicleColor } from './vehicleColor';

const TAXI_DEFAULT = require('../../assets/vehicle-taxi.png');
const MOTO_DEFAULT = require('../../assets/vehicle-moto.png');
const PICKUP_DEFAULT = require('../../assets/vehicle-pickup.png');

/** Taxis colorés (même style vue du dessus que l’asset jaune d’origine). */
const TAXI_BY_COLOR: Record<string, number> = {
  blanc: require('../../assets/vehicle-taxi-blanc.png'),
  noir: require('../../assets/vehicle-taxi-noir.png'),
  gris: require('../../assets/vehicle-taxi-gris.png'),
  argent: require('../../assets/vehicle-taxi-gris.png'),
  rouge: require('../../assets/vehicle-taxi-rouge.png'),
  bleu: require('../../assets/vehicle-taxi-bleu.png'),
  vert: require('../../assets/vehicle-taxi-vert.png'),
  jaune: TAXI_DEFAULT,
  orange: require('../../assets/vehicle-taxi-orange.png'),
  marron: require('../../assets/vehicle-taxi-noir.png'),
  beige: require('../../assets/vehicle-taxi-blanc.png'),
};

const HEX_TO_KEY: Record<string, string> = {
  '#F5F5F5': 'blanc',
  '#EEEEEE': 'blanc',
  '#1A1A1A': 'noir',
  '#222222': 'noir',
  '#9CA3AF': 'gris',
  '#C0C0C0': 'argent',
  '#B0B0B0': 'argent',
  '#E53935': 'rouge',
  '#1E88E5': 'bleu',
  '#1565C0': 'bleu',
  '#43A047': 'vert',
  '#FDD835': 'jaune',
  '#FFCC00': 'jaune',
  '#FB8C00': 'orange',
  '#6D4C41': 'marron',
  '#D7CCC8': 'beige',
};

function colorKey(vehicleColor?: string | null): string {
  if (!vehicleColor?.trim()) return 'jaune';
  const raw = vehicleColor
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (raw in TAXI_BY_COLOR) return raw;
  // "verte" / "bleue" / "noire" → radical
  const fem = raw.replace(/e$/, '');
  if (fem in TAXI_BY_COLOR) return fem;
  const hex = resolveVehicleColor(vehicleColor);
  if (hex) {
    const mapped = HEX_TO_KEY[hex.toUpperCase()];
    if (mapped) return mapped;
  }
  const first = raw.split(/[\s/-]+/)[0];
  if (first in TAXI_BY_COLOR) return first;
  const firstFem = first.replace(/e$/, '');
  if (firstFem in TAXI_BY_COLOR) return firstFem;
  return 'jaune';
}

/** Image PNG à utiliser sur la carte / aperçu (pas de tintColor). */
export function vehicleImageSource(
  vehicleType?: VehicleType | null,
  vehicleColor?: string | null,
): number {
  const type: VehicleType =
    vehicleType === 'moto' || vehicleType === 'pickup' ? vehicleType : 'taxi';

  if (type === 'moto') return MOTO_DEFAULT;
  if (type === 'pickup') return PICKUP_DEFAULT;

  const key = colorKey(vehicleColor);
  return TAXI_BY_COLOR[key] ?? TAXI_DEFAULT;
}

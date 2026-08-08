import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PlaceSuggestion } from './places';

const KEY = 'clickpro_address_history_v1';
const MAX = 15;

export type HistoryPlace = PlaceSuggestion & { usedAt: number };

export async function loadAddressHistory(): Promise<HistoryPlace[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryPlace[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (p) =>
          p &&
          typeof p.label === 'string' &&
          typeof p.latitude === 'number' &&
          typeof p.longitude === 'number',
      )
      .slice(0, MAX);
  } catch {
    return [];
  }
}

export async function rememberAddress(
  place: PlaceSuggestion,
): Promise<HistoryPlace[]> {
  const prev = await loadAddressHistory();
  const id =
    place.id ||
    `hist-${place.latitude.toFixed(5)}-${place.longitude.toFixed(5)}`;
  const entry: HistoryPlace = {
    ...place,
    id,
    usedAt: Date.now(),
  };
  const next = [
    entry,
    ...prev.filter(
      (p) =>
        p.id !== id &&
        !(
          Math.abs(p.latitude - place.latitude) < 1e-5 &&
          Math.abs(p.longitude - place.longitude) < 1e-5
        ),
    ),
  ].slice(0, MAX);
  await AsyncStorage.setItem(KEY, JSON.stringify(next));
  return next;
}

export async function clearAddressHistory(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}

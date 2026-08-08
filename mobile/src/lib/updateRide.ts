import { supabase } from './supabase';
import type { Ride } from '../types';

const OPTIONAL_COLS = [
  'stops_done',
  'stops',
  'for_third_party',
  'passenger_name',
  'passenger_phone',
  'pickup_label',
  'dropoff_label',
  'started_at',
  'completed_at',
  'final_price',
  'commission_percent',
  'commission_amount',
  'commission_waived',
  'commission_paid',
  'province_code',
] as const;

function isMissingColumnError(message: string) {
  return /column|schema cache|Could not find/i.test(message);
}

function stripMissingFromMessage(
  payload: Record<string, unknown>,
  message: string,
): Record<string, unknown> | null {
  const next = { ...payload };
  let removed = false;
  for (const col of OPTIONAL_COLS) {
    if (col in next && new RegExp(col, 'i').test(message)) {
      delete next[col];
      removed = true;
    }
  }
  // Si le message est générique, retire toutes les colonnes optionnelles présentes
  if (!removed && isMissingColumnError(message)) {
    for (const col of OPTIONAL_COLS) {
      if (col in next) {
        delete next[col];
        removed = true;
      }
    }
  }
  return removed ? next : null;
}

/**
 * Met à jour une course en retirant les colonnes absentes du schéma Supabase.
 */
export async function updateRideSafe(
  rideId: string,
  patch: Record<string, unknown>,
): Promise<{ ride: Ride | null; error: string | null; stripped: string[] }> {
  let payload: Record<string, unknown> = { ...patch };
  const stripped: string[] = [];

  for (let i = 0; i < 4; i++) {
    const { data, error } = await supabase
      .from('rides')
      .update(payload)
      .eq('id', rideId)
      .select('*')
      .single();

    if (!error && data) {
      return { ride: data as Ride, error: null, stripped };
    }

    if (!error?.message || !isMissingColumnError(error.message)) {
      return { ride: null, error: error?.message || 'Échec mise à jour', stripped };
    }

    const cleaned = stripMissingFromMessage(payload, error.message);
    if (!cleaned) {
      return { ride: null, error: error.message, stripped };
    }
    for (const key of Object.keys(payload)) {
      if (!(key in cleaned) && !stripped.includes(key)) stripped.push(key);
    }
    payload = cleaned;
    if (!('status' in payload) && !Object.keys(payload).length) {
      return { ride: null, error: error.message, stripped };
    }
  }

  return { ride: null, error: 'Échec mise à jour course', stripped };
}

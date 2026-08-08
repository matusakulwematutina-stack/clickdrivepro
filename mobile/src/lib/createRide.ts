import { supabase } from './supabase';
import type { PaymentMethod, Ride, RideStop, VehicleType } from '../types';

export type CreateRideInput = {
  clientId: string;
  vehicleType: VehicleType;
  pickup: { lat: number; lng: number; address: string };
  dropoff: { lat: number; lng: number; address: string };
  stops: RideStop[];
  forThirdParty: boolean;
  passengerName: string | null;
  passengerPhone: string | null;
  distanceKm: number;
  durationMin: number;
  estimatedPrice: number;
  paymentMethod?: PaymentMethod;
};

function isMissingColumnError(message: string) {
  return /column|schema cache|Could not find/i.test(message);
}

function dropoffWithExtras(
  address: string,
  stops: RideStop[],
  forThirdParty: boolean,
  passengerName: string | null,
  passengerPhone: string | null,
) {
  const parts = [address];
  if (stops.length) {
    parts.push(`via ${stops.map((s) => s.label).join(' → ')}`);
  }
  if (forThirdParty && (passengerName || passengerPhone)) {
    parts.push(
      `passager: ${[passengerName, passengerPhone].filter(Boolean).join(' ')}`,
    );
  }
  return parts.join(' · ');
}

/**
 * Crée une course en essayant d’abord le schéma complet (arrêts / tiers),
 * puis un payload minimal si des colonnes manquent encore en base.
 */
export async function createClientRide(
  input: CreateRideInput,
): Promise<{ ride: Ride | null; error: string | null; degraded: boolean }> {
  const base = {
    client_id: input.clientId,
    vehicle_type: input.vehicleType,
    status: 'requested' as const,
    pickup_address: input.pickup.address,
    pickup_lat: input.pickup.lat,
    pickup_lng: input.pickup.lng,
    dropoff_lat: input.dropoff.lat,
    dropoff_lng: input.dropoff.lng,
    distance_km: input.distanceKm,
    duration_min: input.durationMin,
    estimated_price: input.estimatedPrice,
    payment_method: (input.paymentMethod || 'cash') as PaymentMethod,
  };

  const full = {
    ...base,
    dropoff_address: input.dropoff.address,
    stops: input.stops,
    stops_done: 0,
    for_third_party: input.forThirdParty,
    passenger_name: input.passengerName,
    passenger_phone: input.passengerPhone,
  };

  const withoutStopsDone = {
    ...base,
    dropoff_address: input.dropoff.address,
    stops: input.stops,
    for_third_party: input.forThirdParty,
    passenger_name: input.passengerName,
    passenger_phone: input.passengerPhone,
  };

  const withLabels = {
    ...full,
    pickup_label: input.pickup.address,
    dropoff_label: input.dropoff.address,
  };

  const minimal = {
    ...base,
    dropoff_address: dropoffWithExtras(
      input.dropoff.address,
      input.stops,
      input.forThirdParty,
      input.passengerName,
      input.passengerPhone,
    ),
  };

  const attempts: Array<{ payload: Record<string, unknown>; degraded: boolean }> = [
    { payload: withLabels, degraded: false },
    { payload: full, degraded: false },
    { payload: withoutStopsDone, degraded: false },
    { payload: minimal, degraded: true },
  ];

  let lastError = 'Impossible de créer la course.';

  for (const attempt of attempts) {
    const { data, error } = await supabase
      .from('rides')
      .insert(attempt.payload)
      .select('*')
      .single();

    if (!error && data) {
      // Dispatch séquentiel : 1er chauffeur prioritaire (plus proche)
      const { error: dispatchErr } = await supabase.rpc('start_ride_dispatch', {
        p_ride_id: data.id,
      });
      if (dispatchErr) {
        console.warn('start_ride_dispatch', dispatchErr.message);
      }
      const { data: fresh } = await supabase
        .from('rides')
        .select('*')
        .eq('id', data.id)
        .maybeSingle();
      return {
        ride: (fresh as Ride) || (data as Ride),
        error: null,
        degraded: attempt.degraded,
      };
    }

    lastError = error?.message || lastError;
    if (error && !isMissingColumnError(error.message)) {
      break;
    }
  }

  if (isMissingColumnError(lastError)) {
    return {
      ride: null,
      error:
        'La base n’est pas à jour. Ouvrez Supabase → SQL Editor et exécutez le fichier migrate-stops-third-party.sql, puis réessayez.',
      degraded: false,
    };
  }

  return { ride: null, error: lastError, degraded: false };
}

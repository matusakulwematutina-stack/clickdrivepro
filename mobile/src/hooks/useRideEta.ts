import { useEffect, useMemo, useRef, useState } from 'react';
import { computeRideEta, etaPhase, type RideEtaInfo } from '../lib/rideEta';
import type { Ride } from '../types';

type Baseline = {
  rideId: string;
  phase: 'pickup' | 'trip';
  min: number;
};

/**
 * ETA dynamique + retard par rapport à l’estimation initiale (pickup ou trajet).
 */
export function useRideEta(
  ride: Ride | null,
  routeDurationMin: number | null,
): RideEtaInfo | null {
  const baselineRef = useRef<Baseline | null>(null);
  const [clockTick, setClockTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setClockTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!ride) {
      baselineRef.current = null;
      return;
    }
    const phase = etaPhase(ride.status);
    if (
      !phase ||
      baselineRef.current?.rideId !== ride.id ||
      baselineRef.current?.phase !== phase
    ) {
      baselineRef.current = null;
    }
  }, [ride?.id, ride?.status]);

  useEffect(() => {
    if (!ride || routeDurationMin == null) return;
    const phase = etaPhase(ride.status);
    if (!phase) return;
    if (
      !baselineRef.current ||
      baselineRef.current.rideId !== ride.id ||
      baselineRef.current.phase !== phase
    ) {
      baselineRef.current = { rideId: ride.id, phase, min: routeDurationMin };
    }
  }, [ride?.id, ride?.status, routeDurationMin]);

  return useMemo(() => {
    if (!ride) return null;
    const phase = etaPhase(ride.status);
    if (!phase) return null;

    const referenceIso =
      phase === 'pickup'
        ? ride.accepted_at ?? ride.created_at
        : ride.started_at;

    let baseline: number | null = null;
    if (phase === 'trip' && ride.duration_min != null && ride.duration_min > 0) {
      baseline = ride.duration_min;
    } else if (
      baselineRef.current?.rideId === ride.id &&
      baselineRef.current?.phase === phase
    ) {
      baseline = baselineRef.current.min;
    } else {
      baseline = routeDurationMin;
    }

    return computeRideEta({
      status: ride.status,
      routeDurationMin,
      baselineDurationMin: baseline,
      referenceIso,
      now: new Date(),
    });
  }, [ride, routeDurationMin, clockTick]);
}

import type { RideStatus } from '../types';

export type RideEtaPhase = 'pickup' | 'trip';

export type RideEtaInfo = {
  phase: RideEtaPhase;
  etaMin: number;
  arrivalAt: Date;
  delayMin: number;
  isLate: boolean;
  targetLabel: string;
};

function etaPhase(status: RideStatus): RideEtaPhase | null {
  if (status === 'accepted' || status === 'arriving') return 'pickup';
  if (status === 'ongoing') return 'trip';
  return null;
}

export function formatArrivalClock(date: Date): string {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function formatEtaDuration(min: number): string {
  if (min < 1) return '< 1 min';
  if (min === 1) return '1 min';
  return `${min} min`;
}

export function computeRideEta(input: {
  status: RideStatus;
  routeDurationMin: number | null;
  baselineDurationMin: number | null;
  referenceIso: string | null;
  now?: Date;
}): RideEtaInfo | null {
  const phase = etaPhase(input.status);
  if (!phase || input.routeDurationMin == null) return null;

  const now = input.now ?? new Date();
  const etaMin = Math.max(1, Math.round(input.routeDurationMin));
  const arrivalAt = new Date(now.getTime() + etaMin * 60_000);

  let delayMin = 0;
  const baseline = input.baselineDurationMin ?? etaMin;
  const refIso = input.referenceIso;
  if (refIso) {
    const refMs = new Date(refIso).getTime();
    if (Number.isFinite(refMs)) {
      const expectedArrival = refMs + baseline * 60_000;
      const projectedArrival = now.getTime() + etaMin * 60_000;
      delayMin = Math.max(0, Math.round((projectedArrival - expectedArrival) / 60_000));
    }
  }

  const targetLabel =
    phase === 'pickup' ? 'Arrivée chauffeur' : 'Arrivée destination';

  return {
    phase,
    etaMin,
    arrivalAt,
    delayMin,
    isLate: delayMin >= 2,
    targetLabel,
  };
}

export { etaPhase };

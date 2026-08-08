import { useEffect, useRef } from 'react';
import {
  resetVoiceGuidance,
  tickVoiceGuidance,
  type VoiceRole,
} from '../lib/voiceGuidance';
import type { RouteManeuver } from '../lib/routing';
import type { LatLng } from '../types';

type Opts = {
  role: VoiceRole;
  enabled: boolean;
  position: LatLng | null;
  destination: LatLng | null;
  steps: RouteManeuver[];
};

/**
 * Annonces vocales liées au guidage (ronds-points, 150 m, arrivée).
 */
export function useVoiceGuidance({
  role,
  enabled,
  position,
  destination,
  steps,
}: Opts) {
  const lastTick = useRef(0);

  useEffect(() => {
    if (!enabled) {
      resetVoiceGuidance();
    }
  }, [enabled]);

  useEffect(() => {
    return () => {
      resetVoiceGuidance();
    };
  }, []);

  useEffect(() => {
    if (!enabled || !position || !destination) return;

    const now = Date.now();
    // Évite de spammer (max ~2 fois / seconde)
    if (now - lastTick.current < 450) return;
    lastTick.current = now;

    tickVoiceGuidance({
      role,
      position,
      destination,
      steps,
      enabled,
    });
  }, [
    role,
    enabled,
    position?.latitude,
    position?.longitude,
    destination?.latitude,
    destination?.longitude,
    steps,
  ]);
}

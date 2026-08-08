import * as Speech from 'expo-speech';
import { haversineKm } from './geo';
import type { RouteManeuver } from './routing';
import type { LatLng } from '../types';

const spokenIds = new Set<string>();

export function resetVoiceGuidance() {
  spokenIds.clear();
  Speech.stop();
}

function once(key: string): boolean {
  if (spokenIds.has(key)) return false;
  spokenIds.add(key);
  return true;
}

export async function speak(text: string, rate = 0.95) {
  try {
    const speaking = await Speech.isSpeakingAsync();
    if (speaking) {
      // Laisse finir la phrase en cours, puis enfile (simple: skip si occupé)
      return;
    }
    Speech.speak(text, {
      language: 'fr-FR',
      pitch: 1.0,
      rate,
    });
  } catch (e) {
    console.warn('Speech:', e);
  }
}

/** Force la parole même si une autre annonce tourne (messages prioritaires) */
export async function speakNow(text: string, rate = 0.95) {
  try {
    Speech.stop();
    Speech.speak(text, { language: 'fr-FR', pitch: 1.0, rate });
  } catch (e) {
    console.warn('Speech:', e);
  }
}

function exitLabel(n: number): string {
  const map: Record<number, string> = {
    1: 'la première sortie',
    2: 'la deuxième sortie',
    3: 'la troisième sortie',
    4: 'la quatrième sortie',
    5: 'la cinquième sortie',
    6: 'la sixième sortie',
  };
  return map[n] || `la sortie numéro ${n}`;
}

function turnPhrase(modifier?: string | null): string {
  switch (modifier) {
    case 'left':
      return 'tournez à gauche';
    case 'right':
      return 'tournez à droite';
    case 'slight left':
      return 'inclinez légèrement à gauche';
    case 'slight right':
      return 'inclinez légèrement à droite';
    case 'sharp left':
      return 'tournez franchement à gauche';
    case 'sharp right':
      return 'tournez franchement à droite';
    case 'uturn':
      return 'faites demi-tour';
    case 'straight':
      return 'continuez tout droit';
    default:
      return 'continuez';
  }
}

export function phraseForManeuver(step: RouteManeuver): string | null {
  const type = step.type;
  if (type === 'depart' || type === 'notification') return null;

  if (type === 'roundabout' || type === 'rotary' || type === 'roundabout turn') {
    const exit = step.exit || 1;
    return `Au rond-point, prenez ${exitLabel(exit)}.`;
  }

  if (type === 'exit roundabout' || type === 'exit rotary') {
    const exit = step.exit || 1;
    return `Sortez du rond-point par ${exitLabel(exit)}.`;
  }

  if (type === 'arrive') {
    return 'Vous êtes arrivé à destination.';
  }

  if (type === 'turn' || type === 'end of road' || type === 'fork' || type === 'new name') {
    return `${turnPhrase(step.modifier)}.`;
  }

  if (type === 'merge') {
    return 'Rejoignez la voie.';
  }

  return null;
}

const APPROACH_M = 90; // annonce ~90 m avant la manœuvre
const PREPARE_M = 150;
const ARRIVE_M = 35;

export type VoiceRole = 'driver' | 'client';

/**
 * Évalue la position et déclenche les annonces vocales adaptées.
 */
export function tickVoiceGuidance(opts: {
  role: VoiceRole;
  position: LatLng;
  destination: LatLng;
  steps: RouteManeuver[];
  /** true quand la course est en cours (ongoing) ou chauffeur vers destination */
  enabled: boolean;
}) {
  const { role, position, destination, steps, enabled } = opts;
  if (!enabled) return;

  const distToDestM = haversineKm(position, destination) * 1000;

  // —— 150 m : préparer / ne rien oublier (surtout client) ——
  if (distToDestM <= PREPARE_M && distToDestM > ARRIVE_M) {
    if (role === 'client' && once('client-prepare-150')) {
      speakNow(
        'Attention : vous arrivez dans cent cinquante mètres. ' +
          'Préparez-vous à descendre, et assurez-vous de ne rien oublier dans le véhicule, ' +
          'ni sur votre siège, ni dans le coffre.',
      );
    }
    if (role === 'driver' && once('driver-prepare-150')) {
      speak(
        'Destination dans cent cinquante mètres. Préparez-vous à l’arrivée du client.',
      );
    }
  }

  // —— Arrivée ——
  if (distToDestM <= ARRIVE_M) {
    if (role === 'client' && once('client-arrived')) {
      speakNow(
        'Vous êtes arrivé à destination. ' +
          'Avant de quitter le véhicule, vérifiez bien que vous n’oubliez rien : ' +
          'sac, téléphone, argent, ou tout objet sur votre siège.',
      );
    }
    if (role === 'driver' && once('driver-arrived')) {
      speakNow('Vous êtes arrivé à destination.');
    }
    return;
  }

  // —— Manœuvres / ronds-points (chauffeur principalement, aussi utile client) ——
  for (const step of steps) {
    if (step.type === 'depart') continue;
    const d = haversineKm(position, step.location) * 1000;
    if (d > APPROACH_M) continue;

    const phrase = phraseForManeuver(step);
    if (!phrase) continue;

    const key = `maneuver-${step.id}`;
    if (!once(key)) continue;

    // Ronds-points : message plus clair et prioritaire
    if (
      step.type.includes('roundabout') ||
      step.type === 'rotary' ||
      step.type === 'exit roundabout' ||
      step.type === 'exit rotary'
    ) {
      speakNow(phrase);
    } else if (role === 'driver') {
      speak(phrase);
    }
  }
}

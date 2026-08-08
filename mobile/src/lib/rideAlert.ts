import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import * as Haptics from 'expo-haptics';

let sound: Audio.Sound | null = null;
let ready = false;
let ringing = false;
let vibeTimer: ReturnType<typeof setInterval> | null = null;

async function ensureAudioMode() {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
    staysActiveInBackground: false,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
    interruptionModeIOS: InterruptionModeIOS.DoNotMix,
    interruptionModeAndroid: InterruptionModeAndroid.DoNotMix,
  });
}

/** Précharge la mélodie ring-ring (évite le retard) */
export async function preloadRideAlert() {
  try {
    await ensureAudioMode();
    if (sound) return;
    const { sound: s } = await Audio.Sound.createAsync(
      require('../../assets/sounds/ride-alert.wav'),
      { shouldPlay: false, volume: 1.0, isLooping: true },
    );
    sound = s;
    ready = true;
  } catch (e) {
    console.warn('preloadRideAlert:', e);
  }
}

async function ensureSound() {
  if (ready && sound) return sound;
  await preloadRideAlert();
  if (!sound) throw new Error('Son alerte indisponible');
  return sound;
}

function startVibrationPulse() {
  if (vibeTimer) return;
  const pulse = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
  };
  pulse();
  vibeTimer = setInterval(pulse, 900);
}

function stopVibrationPulse() {
  if (vibeTimer) {
    clearInterval(vibeTimer);
    vibeTimer = null;
  }
}

/**
 * Sonnerie continue : ring, ring, ring… jusqu’à stopRideAlert().
 */
export async function playNewRideAlert() {
  try {
    const s = await ensureSound();
    await s.setIsLoopingAsync(true);
    await s.setVolumeAsync(1.0);
    await s.setPositionAsync(0);
    if (!ringing) {
      ringing = true;
      await s.playAsync();
      startVibrationPulse();
    } else {
      // Déjà en train de sonner : ramène au début du motif
      await s.setPositionAsync(0);
      if (!(await s.getStatusAsync()).isPlaying) {
        await s.playAsync();
      }
    }
  } catch (e) {
    console.warn('rideAlert:', e);
    startVibrationPulse();
  }
}

/** Arrête la sonnerie (offre envoyée, hors ligne, course ouverte…) */
export async function stopRideAlert() {
  ringing = false;
  stopVibrationPulse();
  try {
    if (sound) {
      await sound.stopAsync();
      await sound.setPositionAsync(0);
    }
  } catch {
    /* ignore */
  }
}

export function isRideAlertRinging() {
  return ringing;
}

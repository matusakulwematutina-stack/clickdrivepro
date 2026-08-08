import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { colors } from '../lib/theme';

const HOLD_MS = 1800;

type Props = {
  onConfirm: () => void | Promise<void>;
  /** Affiché dans la boîte de dialogue après maintien */
  confirmMessage?: string;
  style?: ViewStyle;
  compact?: boolean;
};

/**
 * SOS anti-erreur : maintien ~1,8 s + confirmation.
 * Pas de simple tap — évite les appuis accidentels en bas d’écran.
 */
export function SosHoldButton({
  onConfirm,
  confirmMessage = 'Envoyer une alerte d’urgence à l’admin ?',
  style,
  compact = true,
}: Props) {
  const [progress, setProgress] = useState(0);
  const [holding, setHolding] = useState(false);
  const startRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const armedRef = useRef(false);

  const clearAnim = () => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const reset = () => {
    clearAnim();
    startRef.current = 0;
    armedRef.current = false;
    setHolding(false);
    setProgress(0);
  };

  const askConfirm = () => {
    Alert.alert('SOS — confirmation', confirmMessage, [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Envoyer SOS',
        style: 'destructive',
        onPress: () => {
          void onConfirm();
        },
      },
    ]);
  };

  const tick = () => {
    const elapsed = Date.now() - startRef.current;
    const p = Math.min(1, elapsed / HOLD_MS);
    setProgress(p);
    if (p >= 1) {
      if (!armedRef.current) {
        armedRef.current = true;
        clearAnim();
        setHolding(false);
        setProgress(0);
        askConfirm();
      }
      return;
    }
    rafRef.current = requestAnimationFrame(tick);
  };

  const onPressIn = () => {
    armedRef.current = false;
    startRef.current = Date.now();
    setHolding(true);
    setProgress(0);
    clearAnim();
    rafRef.current = requestAnimationFrame(tick);
  };

  const onPressOut = () => {
    if (!armedRef.current) reset();
  };

  useEffect(() => () => clearAnim(), []);

  return (
    <Pressable
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      onPress={() => {
        /* tap court ignoré volontairement */
      }}
      accessibilityRole="button"
      accessibilityLabel="SOS, maintenir pour activer"
      accessibilityHint="Maintenir environ deux secondes puis confirmer"
      style={({ pressed }) => [
        styles.btn,
        compact && styles.compact,
        (holding || pressed) && styles.btnActive,
        style,
      ]}
    >
      <View style={[styles.fill, { width: `${Math.round(progress * 100)}%` }]} />
      <Text style={styles.label}>SOS</Text>
      <Text style={styles.hint}>{holding ? '…' : 'maintenir'}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    minWidth: 72,
    height: 44,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.danger,
    backgroundColor: 'rgba(255,77,77,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    paddingHorizontal: 10,
  },
  compact: {
    minWidth: 64,
    height: 40,
  },
  btnActive: {
    backgroundColor: 'rgba(255,77,77,0.35)',
  },
  fill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(255,77,77,0.55)',
  },
  label: {
    color: '#fff',
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 0.5,
    zIndex: 1,
  },
  hint: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 9,
    fontWeight: '700',
    zIndex: 1,
    marginTop: -1,
  },
});

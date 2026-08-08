import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { PrimaryButton } from '../components/PrimaryButton';
import { colors, spacing } from '../lib/theme';

type Props = {
  onLogin: () => void;
  onRegister: () => void;
};

export function WelcomeScreen({ onLogin, onRegister }: Props) {
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(24)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(slide, { toValue: 0, duration: 700, useNativeDriver: true }),
    ]).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.04, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 1200, useNativeDriver: true }),
      ]),
    ).start();
  }, [fade, slide, pulse]);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <View style={styles.glow} />
      <Animated.View style={[styles.brandBlock, { opacity: fade, transform: [{ translateY: slide }] }]}>
        <Animated.View style={[styles.badge, { transform: [{ scale: pulse }] }]}>
          <Text style={styles.badgeText}>DRIVE</Text>
        </Animated.View>
        <Text style={styles.brand}>ClickPro</Text>
        <Text style={styles.brandAccent}>Drive</Text>
        <Text style={styles.tagline}>Commandez. Suivez. Arrivez.</Text>
      </Animated.View>

      <Animated.View style={[styles.actions, { opacity: fade }]}>
        <PrimaryButton title="Se connecter" onPress={onLogin} />
        <PrimaryButton title="Créer un compte" onPress={onRegister} variant="ghost" />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    paddingBottom: 48,
    justifyContent: 'space-between',
  },
  glow: {
    position: 'absolute',
    top: -80,
    right: -60,
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(255,204,0,0.12)',
  },
  brandBlock: {
    marginTop: 120,
  },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: colors.yellow,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    marginBottom: 18,
  },
  badgeText: {
    color: '#111',
    fontWeight: '900',
    letterSpacing: 2,
    fontSize: 12,
  },
  brand: {
    color: colors.white,
    fontSize: 48,
    fontWeight: '900',
    letterSpacing: -1,
  },
  brandAccent: {
    color: colors.yellow,
    fontSize: 56,
    fontWeight: '900',
    marginTop: -8,
    letterSpacing: -1.5,
  },
  tagline: {
    marginTop: 16,
    color: colors.muted,
    fontSize: 17,
  },
  actions: {
    gap: 12,
  },
});

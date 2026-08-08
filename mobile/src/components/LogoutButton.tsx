import React from 'react';
import { Alert, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { colors } from '../lib/theme';

type Props = {
  style?: ViewStyle;
  label?: string;
  compact?: boolean;
};

/** Bouton déconnexion visible (jaune), confirmé. */
export function LogoutButton({
  style,
  label = 'Déconnexion',
  compact,
}: Props) {
  const { signOut } = useAuth();

  return (
    <Pressable
      hitSlop={10}
      onPress={() => {
        Alert.alert('Déconnexion', 'Voulez-vous vous déconnecter ?', [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Déconnecter',
            style: 'destructive',
            onPress: () => {
              void signOut();
            },
          },
        ]);
      }}
      style={[styles.btn, compact && styles.compact, style]}
    >
      <Text style={[styles.text, compact && styles.textCompact]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.yellow,
    backgroundColor: 'rgba(255,204,0,0.12)',
  },
  compact: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  text: {
    color: colors.yellow,
    fontWeight: '800',
    fontSize: 12,
  },
  textCompact: {
    fontSize: 11,
  },
});

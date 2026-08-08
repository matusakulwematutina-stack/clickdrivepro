import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors } from '../lib/theme';

type Props = {
  lines: Array<{ label: string; value: string }>;
};

/** Affiche les IDs partagés client ↔ chauffeur. */
export function IdentityBadge({ lines }: Props) {
  const visible = lines.filter((l) => l.value && l.value !== '—');
  if (!visible.length) return null;
  return (
    <View style={styles.box}>
      {visible.map((l) => (
        <Text key={l.label} style={styles.line} numberOfLines={1}>
          <Text style={styles.label}>{l.label} </Text>
          {l.value}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: 'rgba(255,204,0,0.1)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.yellow,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    gap: 2,
  },
  line: { color: colors.white, fontSize: 11, fontWeight: '700' },
  label: { color: colors.yellow, fontWeight: '800' },
});

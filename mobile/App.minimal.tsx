import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

/** Écran de test — pour vérifier Expo Go sans navigation. */
export default function App() {
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <Text style={styles.brand}>ClickPro</Text>
      <Text style={styles.accent}>Drive</Text>
      <Text style={styles.ok}>SDK 54 OK</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0B0B0B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brand: { color: '#fff', fontSize: 42, fontWeight: '900' },
  accent: { color: '#FFCC00', fontSize: 48, fontWeight: '900', marginTop: -8 },
  ok: { color: '#9A9A9A', marginTop: 16, fontWeight: '700' },
});

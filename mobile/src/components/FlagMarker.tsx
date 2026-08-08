import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';
import type { LatLng } from '../types';

type Props = {
  coordinate: LatLng;
  title?: string;
  /** drapeau damier = destination / arrivée */
  variant?: 'finish' | 'pickup' | 'stop';
  /** Lettre / chiffre pour un arrêt intermédiaire */
  badge?: string;
};

/** Point destination avec drapeau (arrivée / terminé). */
export function FlagMarker({
  coordinate,
  title = 'Destination',
  variant = 'finish',
  badge,
}: Props) {
  const [track, setTrack] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setTrack(false), 400);
    return () => clearTimeout(t);
  }, []);

  const isFinish = variant === 'finish';
  const isStop = variant === 'stop';

  return (
    <Marker
      coordinate={coordinate}
      title={title}
      anchor={{ x: 0.2, y: 1 }}
      zIndex={80}
      tracksViewChanges={track}
    >
      <View style={styles.wrap} collapsable={false}>
        <View style={styles.pole} />
        {isFinish ? (
          <View style={styles.flag}>
            {/* Damier 2x3 */}
            <View style={styles.row}>
              <View style={[styles.cell, styles.black]} />
              <View style={[styles.cell, styles.white]} />
              <View style={[styles.cell, styles.black]} />
            </View>
            <View style={styles.row}>
              <View style={[styles.cell, styles.white]} />
              <View style={[styles.cell, styles.black]} />
              <View style={[styles.cell, styles.white]} />
            </View>
          </View>
        ) : (
          <View style={[styles.pickupFlag, isStop && styles.stopFlag]}>
            <Text style={styles.pickupText}>{badge || (isStop ? '•' : 'A')}</Text>
          </View>
        )}
        <View style={styles.base} />
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 36,
    height: 44,
    alignItems: 'flex-start',
    backgroundColor: 'transparent',
  },
  pole: {
    position: 'absolute',
    left: 4,
    top: 0,
    width: 3,
    height: 38,
    backgroundColor: '#333',
    borderRadius: 1,
  },
  flag: {
    marginLeft: 7,
    marginTop: 2,
    borderWidth: 1,
    borderColor: '#111',
    overflow: 'hidden',
  },
  row: { flexDirection: 'row' },
  cell: { width: 8, height: 8 },
  black: { backgroundColor: '#111' },
  white: { backgroundColor: '#F5F5F5' },
  pickupFlag: {
    marginLeft: 7,
    marginTop: 2,
    width: 22,
    height: 16,
    backgroundColor: '#FFCC00',
    borderWidth: 1.5,
    borderColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pickupText: { color: '#111', fontWeight: '900', fontSize: 11 },
  stopFlag: { backgroundColor: '#fff', borderColor: '#FFCC00' },
  base: {
    position: 'absolute',
    left: 1,
    bottom: 0,
    width: 10,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
});

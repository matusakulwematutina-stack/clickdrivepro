import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { vehicleImageSource } from '../lib/vehicleAssets';
import type { VehicleType } from '../types';

type Props = {
  vehicleType?: VehicleType | null;
  vehicleColor?: string | null;
  size?: number;
};

/** Aperçu du même PNG que sur la carte. */
export function VehiclePreview({
  vehicleType = 'taxi',
  vehicleColor,
  size = 72,
}: Props) {
  return (
    <View style={[styles.wrap, { width: size, height: size, backgroundColor: '#111' }]}>
      <Image
        source={vehicleImageSource(vehicleType, vehicleColor)}
        style={{ width: size * 0.92, height: size * 0.92 }}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    overflow: 'hidden',
  },
});

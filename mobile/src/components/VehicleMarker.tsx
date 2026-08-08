import React, { useEffect, useState } from 'react';
import { Image, Platform, StyleSheet, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { vehicleImageSource } from '../lib/vehicleAssets';
import type { LatLng, VehicleType } from '../types';

type Props = {
  coordinate: LatLng;
  heading?: number | null;
  vehicleType?: VehicleType | null;
  vehicleColor?: string | null;
  title?: string;
};

/**
 * Véhicule carte = PNG vue du dessus (taxi coloré / moto / pickup).
 * Android : image native (évite coupe moitié des vues custom).
 */
export function VehicleMarker({
  coordinate,
  heading = 0,
  vehicleType = 'taxi',
  vehicleColor,
  title = 'Véhicule',
}: Props) {
  const type: VehicleType =
    vehicleType === 'moto' || vehicleType === 'pickup' ? vehicleType : 'taxi';
  const rotation = typeof heading === 'number' && heading >= 0 ? heading : 0;
  const source = vehicleImageSource(type, vehicleColor);
  const colorKey = String(vehicleColor || 'jaune');

  const [track, setTrack] = useState(true);
  useEffect(() => {
    setTrack(true);
    const t = setTimeout(() => setTrack(false), 1800);
    return () => clearTimeout(t);
  }, [coordinate.latitude, coordinate.longitude, rotation, type, colorKey]);

  // key force le rechargement de l’image quand la couleur change (Android)
  const markerKey = `veh-${type}-${colorKey}`;

  if (Platform.OS === 'android') {
    return (
      <Marker
        key={markerKey}
        coordinate={coordinate}
        title={title}
        image={source}
        anchor={{ x: 0.5, y: 0.5 }}
        rotation={rotation}
        flat
        zIndex={999}
        tracksViewChanges={false}
      />
    );
  }

  return (
    <Marker
      key={markerKey}
      coordinate={coordinate}
      title={title}
      anchor={{ x: 0.5, y: 0.5 }}
      rotation={rotation}
      flat
      zIndex={999}
      tracksViewChanges={track}
    >
      <View style={styles.wrap} collapsable={false}>
        <Image source={source} style={styles.vehicle} resizeMode="contain" />
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
    overflow: 'visible',
  },
  vehicle: {
    width: 64,
    height: 64,
    backgroundColor: 'transparent',
  },
});

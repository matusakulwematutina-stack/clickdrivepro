import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { Animated } from 'react-native';
import { Marker } from 'react-native-maps';
import type { LatLng } from '../types';
import { colors } from '../lib/theme';

type Props = {
  coordinates: LatLng[];
  durationMs?: number;
  running?: boolean;
};

/** Point animé qui suit le trajet (guidage). */
export function RouteGuide({
  coordinates,
  durationMs = 12000,
  running = true,
}: Props) {
  const progress = useRef(new Animated.Value(0)).current;
  const [point, setPoint] = React.useState<LatLng | null>(null);
  const animRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (!running || coordinates.length < 2) {
      animRef.current?.stop();
      setPoint(null);
      return;
    }

    progress.setValue(0);
    const id = progress.addListener(({ value }) => {
      const idx = Math.min(
        coordinates.length - 1,
        Math.floor(value * (coordinates.length - 1)),
      );
      const next = Math.min(coordinates.length - 1, idx + 1);
      const t = value * (coordinates.length - 1) - idx;
      const a = coordinates[idx];
      const b = coordinates[next];
      setPoint({
        latitude: a.latitude + (b.latitude - a.latitude) * t,
        longitude: a.longitude + (b.longitude - a.longitude) * t,
      });
    });

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(progress, {
          toValue: 1,
          duration: durationMs,
          useNativeDriver: false,
        }),
        Animated.timing(progress, {
          toValue: 0,
          duration: 0,
          useNativeDriver: false,
        }),
      ]),
    );
    animRef.current = loop;
    loop.start();

    return () => {
      progress.removeListener(id);
      loop.stop();
    };
  }, [coordinates, durationMs, running, progress]);

  if (!point) return null;

  return (
    <Marker coordinate={point} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges zIndex={50}>
      <View style={styles.dot}>
        <View style={styles.core} />
      </View>
    </Marker>
  );
}

const styles = StyleSheet.create({
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,204,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  core: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.yellow,
    borderWidth: 2,
    borderColor: '#111',
  },
});

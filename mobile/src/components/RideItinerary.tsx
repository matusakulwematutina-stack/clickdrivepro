import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { parseRideStops, rideLegsLabel } from '../lib/rideStops';
import { colors } from '../lib/theme';
import type { Ride } from '../types';

type Leg = {
  key: string;
  kind: 'pickup' | 'stop' | 'dropoff';
  badge: string;
  label: string;
};

function buildLegs(ride: Ride): Leg[] {
  const stops = parseRideStops(ride);
  const legs: Leg[] = [
    {
      key: 'pickup',
      kind: 'pickup',
      badge: 'A',
      label: ride.pickup_address?.trim() || 'Position client',
    },
  ];

  stops.forEach((s, i) => {
    legs.push({
      key: `stop-${i}`,
      kind: 'stop',
      badge: String(i + 1),
      label: s.label || `Arrêt ${i + 1}`,
    });
  });

  legs.push({
    key: 'dropoff',
    kind: 'dropoff',
    badge: '★',
    label: ride.dropoff_address?.trim() || 'Destination',
  });

  return legs;
}

type Props = {
  ride: Ride;
  showTypeBadge?: boolean;
  compact?: boolean;
};

/** Itinéraire départ → arrêts → arrivée (compact = une ligne / petite police). */
export function RideItinerary({
  ride,
  showTypeBadge = true,
  compact = true,
}: Props) {
  const legs = buildLegs(ride);
  const typeLabel = rideLegsLabel(ride);

  if (compact) {
    return (
      <View style={styles.compactWrap}>
        {showTypeBadge && typeLabel ? (
          <Text style={styles.typeBadgeSm}>{typeLabel}</Text>
        ) : null}
        {legs.map((leg) => (
          <View key={leg.key} style={styles.compactRow}>
            <Text
              style={[
                styles.compactBadge,
                leg.kind === 'stop' && styles.compactBadgeStop,
              ]}
            >
              {leg.badge}
            </Text>
            <Text style={styles.compactLabel} numberOfLines={1}>
              {leg.label}
            </Text>
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {showTypeBadge && typeLabel ? (
        <Text style={styles.typeBadge}>{typeLabel}</Text>
      ) : null}
      <View style={styles.timeline}>
        {legs.map((leg, index) => {
          const isLast = index === legs.length - 1;
          return (
            <View key={leg.key} style={styles.legRow}>
              <View style={styles.rail}>
                <View
                  style={[
                    styles.dot,
                    leg.kind === 'pickup' && styles.dotPickup,
                    leg.kind === 'stop' && styles.dotStop,
                    leg.kind === 'dropoff' && styles.dotDrop,
                  ]}
                >
                  <Text style={[styles.dotText, styles.dotTextDark]}>{leg.badge}</Text>
                </View>
                {!isLast && <View style={styles.line} />}
              </View>
              <View style={[styles.legBody, isLast && styles.legBodyLast]}>
                <Text style={styles.legLabel} numberOfLines={2}>
                  {leg.label}
                </Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // —— mode compact (chauffeur) ——
  compactWrap: { gap: 3 },
  typeBadgeSm: {
    alignSelf: 'flex-start',
    color: '#111',
    backgroundColor: colors.yellow,
    overflow: 'hidden',
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
    marginBottom: 2,
  },
  compactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    minHeight: 18,
  },
  compactBadge: {
    width: 14,
    textAlign: 'center',
    color: colors.yellow,
    fontSize: 11,
    fontWeight: '800',
  },
  compactBadgeStop: { color: '#ccc' },
  compactLabel: {
    flex: 1,
    color: colors.white,
    fontSize: 12,
    fontWeight: '500',
  },

  // —— mode détaillé ——
  wrap: { gap: 6 },
  typeBadge: {
    alignSelf: 'flex-start',
    color: '#111',
    backgroundColor: colors.yellow,
    overflow: 'hidden',
    fontSize: 11,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 7,
  },
  timeline: { gap: 0 },
  legRow: { flexDirection: 'row', alignItems: 'stretch', gap: 8 },
  rail: { width: 20, alignItems: 'center' },
  dot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgPanel,
  },
  dotPickup: { backgroundColor: colors.yellow, borderColor: colors.yellow },
  dotStop: { backgroundColor: '#fff', borderColor: colors.yellow },
  dotDrop: { backgroundColor: colors.yellow, borderColor: colors.yellow },
  dotText: { color: colors.white, fontSize: 10, fontWeight: '800' },
  dotTextDark: { color: '#111' },
  line: {
    width: 2,
    flex: 1,
    minHeight: 8,
    backgroundColor: colors.border,
    marginVertical: 2,
  },
  legBody: { flex: 1, paddingBottom: 8, paddingTop: 0, justifyContent: 'center' },
  legBodyLast: { paddingBottom: 0 },
  legLabel: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 17,
  },
});

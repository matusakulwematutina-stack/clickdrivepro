import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import {
  formatArrivalClock,
  formatEtaDuration,
  type RideEtaInfo,
} from '../lib/rideEta';
import { colors } from '../lib/theme';

type Props = {
  info: RideEtaInfo | null;
};

export function RideEtaBanner({ info }: Props) {
  if (!info) return null;

  const timeStr = formatArrivalClock(info.arrivalAt);

  return (
    <View style={[styles.box, info.isLate && styles.boxLate]}>
      <Text style={styles.main}>
        {info.targetLabel} · ~{formatEtaDuration(info.etaMin)} · {timeStr}
      </Text>
      {info.delayMin >= 1 ? (
        <Text style={[styles.sub, info.isLate && styles.subLate]}>
          Retard estimé · +{info.delayMin} min
        </Text>
      ) : (
        <Text style={styles.subOk}>À l&apos;heure</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: colors.bgPanel,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: 2,
  },
  boxLate: {
    borderColor: colors.danger,
    backgroundColor: 'rgba(255,77,77,0.08)',
  },
  main: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '700',
  },
  sub: {
    color: colors.yellowDim,
    fontSize: 11,
    fontWeight: '600',
  },
  subLate: {
    color: colors.danger,
  },
  subOk: {
    color: colors.success,
    fontSize: 11,
    fontWeight: '600',
  },
});

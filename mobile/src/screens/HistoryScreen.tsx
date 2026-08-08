import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { LogoutButton } from '../components/LogoutButton';
import { useAuth } from '../context/AuthContext';
import { formatPrice } from '../lib/geo';
import { supabase } from '../lib/supabase';
import { colors, radii, spacing } from '../lib/theme';
import type { Ride } from '../types';

type Props = {
  onBack: () => void;
};

export function HistoryScreen({ onBack }: Props) {
  const { profile, driver } = useAuth();
  const [rides, setRides] = useState<Ride[]>([]);

  useEffect(() => {
    if (!profile?.id) return;
    const query = supabase.from('rides').select('*').order('created_at', { ascending: false }).limit(50);

    const run =
      profile.role === 'driver' && driver?.id
        ? query.eq('driver_id', driver.id)
        : query.eq('client_id', profile.id);

    run.then(({ data }) => setRides((data as Ride[]) ?? []));
  }, [profile?.id, profile?.role, driver?.id]);

  return (
    <View style={styles.root}>
      <View style={styles.topRow}>
        <Pressable onPress={onBack}>
          <Text style={styles.back}>← Retour</Text>
        </Pressable>
        <LogoutButton compact />
      </View>
      <Text style={styles.title}>Historique</Text>
      <FlatList
        data={rides}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={styles.empty}>Aucune course pour l’instant.</Text>}
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>{item.dropoff_address || 'Course'}</Text>
            <Text style={styles.meta}>
              {item.status} · {formatPrice(item.final_price ?? item.estimated_price ?? 0)}
            </Text>
            <Text style={styles.date}>{new Date(item.created_at).toLocaleString('fr-FR')}</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.lg,
    paddingTop: 64,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  back: { color: colors.yellow, fontWeight: '700' },
  title: { color: colors.white, fontSize: 28, fontWeight: '900', marginBottom: 16 },
  empty: { color: colors.muted, marginTop: 24 },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: radii.md,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 4,
  },
  cardTitle: { color: colors.white, fontWeight: '800' },
  meta: { color: colors.yellow, fontWeight: '700' },
  date: { color: colors.muted, fontSize: 12 },
});

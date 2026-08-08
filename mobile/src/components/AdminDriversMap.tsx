import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { formatPrice } from '../lib/geo';
import { getServiceCenter, getServiceMapRegion } from '../lib/serviceConfig';
import { supabase } from '../lib/supabase';
import { colors } from '../lib/theme';
import type { DriverAdminRow } from '../types';
import { ServiceMapView } from './ServiceMapView';
import { VehiclePreview } from './VehiclePreview';
import type { VehicleType } from '../types';

export type DriverMapStatus = 'online' | 'busy' | 'offline' | 'blocked' | 'nogps';

export function driverMapStatus(d: DriverAdminRow): DriverMapStatus {
  if (d.is_enabled === false) return 'blocked';
  if (d.lat == null || d.lng == null) return 'nogps';
  if (d.is_online && d.is_available === false) return 'busy';
  if (d.is_online) return 'online';
  return 'offline';
}

const STATUS_META: Record<
  DriverMapStatus,
  { label: string; color: string; short: string }
> = {
  online: { label: 'En ligne', color: colors.success, short: 'ON' },
  busy: { label: 'En course', color: colors.yellow, short: 'BUSY' },
  offline: { label: 'Hors ligne', color: '#6B7280', short: 'OFF' },
  blocked: { label: 'Bloqué', color: colors.danger, short: 'STOP' },
  nogps: { label: 'Sans GPS', color: '#9CA3AF', short: '?' },
};

type Props = {
  drivers: DriverAdminRow[];
  onDriversPatch?: (rows: DriverAdminRow[]) => void;
  onSelect?: (d: DriverAdminRow) => void;
  height?: number;
};

export function AdminDriversMap({
  drivers,
  onDriversPatch,
  onSelect,
  height = 360,
}: Props) {
  const mapRef = useRef<MapView | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | DriverMapStatus>('all');

  const withGps = useMemo(
    () => drivers.filter((d) => d.lat != null && d.lng != null),
    [drivers],
  );

  const visible = useMemo(() => {
    if (filter === 'all') return withGps;
    return withGps.filter((d) => driverMapStatus(d) === filter);
  }, [withGps, filter]);

  const counts = useMemo(() => {
    const c = { online: 0, busy: 0, offline: 0, blocked: 0, nogps: 0 };
    for (const d of drivers) c[driverMapStatus(d)] += 1;
    return c;
  }, [drivers]);

  const selected = drivers.find((d) => d.id === selectedId) ?? null;

  useEffect(() => {
    const channel = supabase
      .channel(`admin-drivers-map-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'drivers' },
        async () => {
          const { data } = await supabase
            .from('drivers')
            .select(
              'id, profile_id, is_online, is_available, is_enabled, vehicle_type, plate_number, vehicle_brand, vehicle_model, vehicle_color, license_number, board_document_ref, lat, lng, wallet_balance, status, profiles(full_name, phone)',
            )
            .order('updated_at', { ascending: false });
          if (data && onDriversPatch) {
            onDriversPatch(data as unknown as DriverAdminRow[]);
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [onDriversPatch]);

  const fitKey = visible
    .map((d) => `${d.id}:${d.lat}:${d.lng}`)
    .join('|');

  useEffect(() => {
    if (!visible.length || !mapRef.current) return;
    const coords = visible.map((d) => ({
      latitude: d.lat!,
      longitude: d.lng!,
    }));
    const t = setTimeout(() => {
      if (!mapRef.current) return;
      if (coords.length === 1) {
        mapRef.current.animateToRegion(
          {
            ...coords[0],
            latitudeDelta: 0.08,
            longitudeDelta: 0.08,
          },
          350,
        );
        return;
      }
      mapRef.current.fitToCoordinates(coords, {
        edgePadding: { top: 56, right: 36, bottom: 72, left: 36 },
        animated: true,
      });
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey]);

  return (
    <View style={[styles.wrap, { height }]}>
      <ServiceMapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={getServiceMapRegion()}
        googleStyle
        scrollEnabled
        pitchEnabled={false}
      >
        {visible.map((d) => {
          const st = driverMapStatus(d);
          const meta = STATUS_META[st];
          const name = d.profiles?.full_name || 'Chauffeur';
          const darkPin = st === 'blocked' || st === 'offline' || st === 'nogps';
          return (
            <Marker
              key={`${d.id}-${d.vehicle_color || 'x'}-${d.vehicle_type}`}
              coordinate={{ latitude: d.lat!, longitude: d.lng! }}
              title={`${name} · ${meta.label}`}
              description={`${d.vehicle_type} · ${d.vehicle_color || '—'} · ${d.plate_number || 'N/A'} · ${formatPrice(Number(d.wallet_balance || 0))}`}
              onPress={() => {
                setSelectedId(d.id);
                onSelect?.(d);
              }}
              tracksViewChanges
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={styles.vehiclePin}>
                <VehiclePreview
                  vehicleType={(d.vehicle_type as VehicleType) || 'taxi'}
                  vehicleColor={d.vehicle_color}
                  size={48}
                />
                <View style={[styles.statusDot, { backgroundColor: meta.color }]}>
                  <Text style={[styles.pinText, darkPin && styles.pinTextLight]}>
                    {meta.short}
                  </Text>
                </View>
              </View>
            </Marker>
          );
        })}
      </ServiceMapView>

      <View style={styles.legend}>
        {(
          [
            ['all', 'Tous'],
            ['online', 'En ligne'],
            ['busy', 'Course'],
            ['offline', 'Off'],
            ['blocked', 'Bloqué'],
          ] as const
        ).map(([id, label]) => {
          const active = filter === id;
          const count =
            id === 'all'
              ? drivers.length
              : counts[id as Exclude<typeof id, 'all'>];
          return (
            <Pressable
              key={id}
              onPress={() => setFilter(id)}
              style={[styles.chip, active && styles.chipOn]}
            >
              <Text style={[styles.chipText, active && styles.chipTextOn]}>
                {label} {count}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {selected ? (
        <View style={styles.selected}>
          <Text style={styles.selTitle}>
            {selected.profiles?.full_name || 'Chauffeur'} ·{' '}
            {STATUS_META[driverMapStatus(selected)].label}
          </Text>
          <Text style={styles.selMeta}>
            {selected.profiles?.phone || '—'} · {selected.vehicle_type} ·{' '}
            {selected.plate_number || 'N/A'} ·{' '}
            {formatPrice(Number(selected.wallet_balance || 0))}
          </Text>
        </View>
      ) : (
        <View style={styles.selected}>
          <Text style={styles.selMeta}>
            {withGps.length}/{drivers.length} avec GPS · centre{' '}
            {getServiceCenter().latitude.toFixed(2)},{' '}
            {getServiceCenter().longitude.toFixed(2)}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  vehiclePin: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  statusDot: {
    position: 'absolute',
    right: 0,
    top: 0,
    minWidth: 22,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
    borderWidth: 1,
    borderColor: '#111',
  },
  pinText: {
    color: '#111',
    fontWeight: '900',
    fontSize: 7,
  },
  pinTextLight: { color: '#fff' },
  legend: {
    position: 'absolute',
    top: 8,
    left: 8,
    right: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  chip: {
    backgroundColor: 'rgba(14,14,14,0.88)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  chipOn: {
    backgroundColor: colors.yellow,
    borderColor: colors.yellow,
  },
  chipText: { color: colors.white, fontSize: 10, fontWeight: '700' },
  chipTextOn: { color: '#111' },
  selected: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    backgroundColor: 'rgba(14,14,14,0.92)',
    borderRadius: 10,
    padding: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  selTitle: { color: colors.white, fontWeight: '800', fontSize: 12 },
  selMeta: { color: colors.muted, fontSize: 11, marginTop: 2 },
});

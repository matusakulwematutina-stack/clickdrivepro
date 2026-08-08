import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { FlagMarker } from '../../components/FlagMarker';
import { GuidedVehicleMarker } from '../../components/GuidedVehicleMarker';
import { IdentityBadge } from '../../components/IdentityBadge';
import { PrimaryButton } from '../../components/PrimaryButton';
import { RideItinerary } from '../../components/RideItinerary';
import { ServiceMapView } from '../../components/ServiceMapView';
import { useAuth } from '../../context/AuthContext';
import { RideEtaBanner } from '../../components/RideEtaBanner';
import { useRideEta } from '../../hooks/useRideEta';
import { useVoiceGuidance } from '../../hooks/useVoiceGuidance';
import { clearActiveRide, rememberActiveRide } from '../../lib/activeRide';
import { formatPrice, rideAgreedPrice } from '../../lib/geo';
import { shortId } from '../../lib/ids';
import { fetchDrivingRouteWaypoints, type RouteManeuver } from '../../lib/routing';
import {
  parseRideStops,
  remainingWaypoints,
  rideLegsLabel,
} from '../../lib/rideStops';
import { resetVoiceGuidance, speakNow } from '../../lib/voiceGuidance';
import { supabase } from '../../lib/supabase';
import { colors, spacing } from '../../lib/theme';
import { createSosAlert } from '../../lib/adminApi';
import { commissionForPrice, loadServiceConfig } from '../../lib/serviceConfig';
import { finalizeRidePayments } from '../../lib/walletApi';
import { LogoutButton } from '../../components/LogoutButton';
import { SosHoldButton } from '../../components/SosHoldButton';
import { updateRideSafe } from '../../lib/updateRide';
import type { LatLng, Ride, RideStatus } from '../../types';

type Props = {
  ride: Ride;
  onDone: () => void;
};

function isToPickup(status: RideStatus) {
  return status === 'accepted' || status === 'arriving';
}

/** Navigation destination = après « Démarrer la course » */
function isTripStarted(status: RideStatus) {
  return status === 'ongoing';
}

export function DriverRideScreen({ ride: initial, onDone }: Props) {
  const { driver, profile, refreshProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const [ride, setRide] = useState(initial);
  /** Progression locale si la colonne stops_done n’existe pas encore en base */
  const [localStopsDone, setLocalStopsDone] = useState(initial.stops_done ?? 0);
  const [loading, setLoading] = useState(false);
  const [routeCoords, setRouteCoords] = useState<LatLng[]>([]);
  const [routeSteps, setRouteSteps] = useState<RouteManeuver[]>([]);
  const [routeDurationMin, setRouteDurationMin] = useState<number | null>(null);
  const [position, setPosition] = useState<LatLng | null>(() =>
    driver?.lat != null && driver?.lng != null
      ? { latitude: driver.lat, longitude: driver.lng }
      : null,
  );
  const [heading, setHeading] = useState(driver?.heading ?? 0);
  const [clientInfo, setClientInfo] = useState<{
    name?: string | null;
    phone?: string | null;
  } | null>(null);
  const mapRef = useRef<MapView | null>(null);
  const lastRouteKey = useRef('');

  useEffect(() => {
    void loadServiceConfig(true);
  }, []);

  useEffect(() => {
    if (!ride.client_id) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('full_name, phone')
        .eq('id', ride.client_id)
        .maybeSingle();
      if (!cancelled && data) setClientInfo(data);
    })();
    return () => {
      cancelled = true;
    };
  }, [ride.client_id]);

  const tripStarted = isTripStarted(ride.status);
  const stopsDone = Math.max(ride.stops_done ?? 0, localStopsDone);
  const rideForStops = useMemo(
    () => ({ ...ride, stops_done: stopsDone }),
    [ride, stopsDone],
  );

  const stops = useMemo(() => parseRideStops(ride), [ride.stops]);
  const remaining = useMemo(
    () => remainingWaypoints(rideForStops),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      ride.dropoff_lat,
      ride.dropoff_lng,
      ride.dropoff_address,
      stopsDone,
      JSON.stringify(ride.stops ?? []),
    ],
  );
  const nextWaypoint = remaining[0];
  const remainingKey = remaining
    .map((w) => `${w.coordinate.latitude},${w.coordinate.longitude}`)
    .join('|');

  const voiceDestination = useMemo(() => {
    if (tripStarted || ride.status === 'arrived') {
      return nextWaypoint?.coordinate ?? {
        latitude: ride.dropoff_lat,
        longitude: ride.dropoff_lng,
      };
    }
    return { latitude: ride.pickup_lat, longitude: ride.pickup_lng };
  }, [
    tripStarted,
    ride.status,
    nextWaypoint?.coordinate.latitude,
    nextWaypoint?.coordinate.longitude,
    ride.dropoff_lat,
    ride.dropoff_lng,
    ride.pickup_lat,
    ride.pickup_lng,
  ]);

  useVoiceGuidance({
    role: 'driver',
    enabled:
      ride.status === 'accepted' ||
      ride.status === 'arriving' ||
      ride.status === 'arrived' ||
      ride.status === 'ongoing',
    position,
    destination: voiceDestination,
    steps: routeSteps,
  });

  useEffect(() => {
    rememberActiveRide(initial.id);
    const channel = supabase
      .channel(`driver-ride-${initial.id}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rides', filter: `id=eq.${initial.id}` },
        (payload) => {
          const next = payload.new as Ride;
          setRide(next);
          if (typeof next.stops_done === 'number') {
            setLocalStopsDone(next.stops_done);
          }
          if (
            next.status === 'completed' ||
            next.status === 'cancelled_by_client' ||
            next.status === 'cancelled_by_driver'
          ) {
            clearActiveRide();
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [initial.id]);

  useEffect(() => {
    let sub: Location.LocationSubscription | null = null;
    let mounted = true;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted' || !mounted) return;

      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (!mounted) return;
      const next = {
        latitude: current.coords.latitude,
        longitude: current.coords.longitude,
      };
      setPosition(next);
      setHeading(current.coords.heading ?? 0);

      if (driver?.id) {
        await supabase
          .from('drivers')
          .update({
            lat: next.latitude,
            lng: next.longitude,
            heading: current.coords.heading ?? 0,
            updated_at: new Date().toISOString(),
          })
          .eq('id', driver.id);
      }

      sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 15,
          timeInterval: 4000,
        },
        async (pos) => {
          if (!mounted) return;
          const p = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          };
          setPosition(p);
          if (pos.coords.heading != null && pos.coords.heading >= 0) {
            setHeading(pos.coords.heading);
          }
          if (driver?.id) {
            await supabase
              .from('drivers')
              .update({
                lat: p.latitude,
                lng: p.longitude,
                heading: pos.coords.heading ?? 0,
                updated_at: new Date().toISOString(),
              })
              .eq('id', driver.id);
          }
        },
      );
    })();

    return () => {
      mounted = false;
      sub?.remove();
    };
  }, [driver?.id]);

  useEffect(() => {
    let active = true;

    const from = position ?? {
      latitude: ride.pickup_lat,
      longitude: ride.pickup_lng,
    };
    const points =
      tripStarted || ride.status === 'arrived'
        ? remaining.map((w) => w.coordinate)
        : [{ latitude: ride.pickup_lat, longitude: ride.pickup_lng }];

    const destKey = points.map((p) => `${p.latitude},${p.longitude}`).join('|');
    const roundedLat = Math.round(from.latitude * 500) / 500;
    const roundedLng = Math.round(from.longitude * 500) / 500;
    const key = `${ride.status}:${stopsDone}:${roundedLat},${roundedLng}:${destKey}`;
    if (key === lastRouteKey.current) return;
    lastRouteKey.current = key;

    (async () => {
      const route = await fetchDrivingRouteWaypoints([from, ...points]);
      if (!active) return;
      if (route) {
        setRouteCoords(route.coordinates);
        setRouteSteps(route.steps);
        setRouteDurationMin(route.durationMin);
        resetVoiceGuidance();
        mapRef.current?.fitToCoordinates(route.coordinates, {
          edgePadding: { top: 70, right: 40, bottom: 160, left: 40 },
          animated: true,
        });
      } else {
        setRouteCoords([from, ...points]);
        setRouteSteps([]);
        setRouteDurationMin(null);
      }
    })();

    return () => {
      active = false;
    };
  }, [
    ride.status,
    stopsDone,
    tripStarted,
    position?.latitude,
    position?.longitude,
    ride.pickup_lat,
    ride.pickup_lng,
    ride.dropoff_lat,
    ride.dropoff_lng,
    remainingKey,
  ]);

  const dropoff = useMemo(
    () => ({ latitude: ride.dropoff_lat, longitude: ride.dropoff_lng }),
    [ride.dropoff_lat, ride.dropoff_lng],
  );

  const finishAndLeave = async () => {
    await clearActiveRide();
    if (driver?.id) {
      await supabase
        .from('drivers')
        .update({ is_available: true, is_online: true, status: 'online' })
        .eq('id', driver.id);
    }
    await refreshProfile();
    onDone();
  };

  const setStatus = async (
    status: RideStatus,
    extra: Record<string, unknown> = {},
    opts?: { leave?: boolean },
  ): Promise<boolean> => {
    setLoading(true);
    const { ride: updated, error, stripped } = await updateRideSafe(ride.id, {
      status,
      ...extra,
    });
    setLoading(false);
    if (error || !updated) {
      Alert.alert('Erreur', error || 'Mise à jour impossible');
      return false;
    }
    if (typeof extra.stops_done === 'number') {
      setLocalStopsDone(extra.stops_done);
    }
    const merged: Ride = {
      ...updated,
      stops_done:
        typeof updated.stops_done === 'number'
          ? updated.stops_done
          : typeof extra.stops_done === 'number'
            ? extra.stops_done
            : stopsDone,
    };
    if (stripped.includes('stops_done') && typeof extra.stops_done === 'number') {
      merged.stops_done = extra.stops_done;
    }
    setRide(merged);
    lastRouteKey.current = '';

    if (opts?.leave !== false) {
      if (
        status === 'completed' ||
        status === 'cancelled_by_driver' ||
        status === 'cancelled_by_client'
      ) {
        await finishAndLeave();
      }
    }
    return true;
  };

  const nextAction = async () => {
    if (ride.status === 'accepted' || ride.status === 'arriving') {
      await setStatus('arrived');
      return;
    }
    if (ride.status === 'arrived') {
      const first = remainingWaypoints({ ...ride, stops_done: 0 })[0];
      speakNow(
        first
          ? `Course démarrée. Direction ${first.label}.`
          : 'Course démarrée. Suivez le guidage vers la destination.',
      );
      setLocalStopsDone(0);
      await setStatus('ongoing', {
        started_at: new Date().toISOString(),
        stops_done: 0,
      });
      return;
    }
    if (ride.status === 'ongoing') {
      const done = stopsDone;
      if (done < stops.length) {
        const nextDone = done + 1;
        const next = remainingWaypoints({ ...ride, stops_done: nextDone })[0];
        speakNow(
          next
            ? `Arrêt validé. Direction ${next.label}.`
            : 'Arrêt validé. Direction destination finale.',
        );
        setLocalStopsDone(nextDone);
        await setStatus('ongoing', { stops_done: nextDone });
        return;
      }
      speakNow('Course terminée. Merci.');
      // Toujours le prix accepté par les deux parties (pas un recalcul)
      const price = rideAgreedPrice(ride);
      const waived = !!ride.commission_waived;
      const commission = waived
        ? { percent: 0, amount: 0 }
        : commissionForPrice(price);
      const ok = await setStatus(
        'completed',
        {
          completed_at: new Date().toISOString(),
          final_price: price,
          estimated_price: price,
          commission_percent: commission.percent,
          commission_amount: commission.amount,
        },
        { leave: false },
      );
      if (!ok) return;
      try {
        await finalizeRidePayments(ride.id);
      } catch (e) {
        Alert.alert(
          'Portefeuille',
          e instanceof Error
            ? e.message
            : 'Commission / paiement non débité — contactez l’admin.',
        );
      }
      await finishAndLeave();
    }
  };

  const sendSos = async () => {
    try {
      await createSosAlert({
        rideId: ride.id,
        reporterId: profile?.id || driver?.profile_id || '',
        reporterRole: 'driver',
        clientId: ride.client_id,
        driverId: ride.driver_id || driver?.id,
        message: 'SOS chauffeur pendant la course',
        lat: position?.latitude,
        lng: position?.longitude,
      });
      Alert.alert('SOS', 'Alerte envoyée. L’admin a été notifié.');
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Échec SOS');
    }
  };

  const nextLabel =
    ride.status === 'accepted' || ride.status === 'arriving'
      ? 'Je suis arrivé'
      : ride.status === 'arrived'
        ? 'Démarrer la course'
        : ride.status === 'ongoing'
          ? stopsDone < stops.length
            ? 'Arrêt suivant'
            : 'Terminer la course'
          : 'Retour';

  const guideLabel = tripStarted
    ? nextWaypoint
      ? `Vers ${nextWaypoint.label}`
      : 'Navigation'
    : isToPickup(ride.status)
      ? ride.for_third_party
        ? 'Vers le passager'
        : 'En route vers le client'
      : ride.status === 'arrived'
        ? 'Prêt à démarrer'
        : 'Course';

  const passengerLine = ride.for_third_party
    ? [ride.passenger_name, ride.passenger_phone].filter(Boolean).join(' · ')
    : null;
  const legsTag = rideLegsLabel(ride);
  const rideEta = useRideEta(ride, routeDurationMin);

  const mapCenter = position ?? {
    latitude: ride.pickup_lat,
    longitude: ride.pickup_lng,
  };

  // Carte Google Maps native (dans l’APK) — pas de site web, pas de popup
  const showGoogleMap =
    ride.status === 'accepted' ||
    ride.status === 'arriving' ||
    ride.status === 'arrived' ||
    ride.status === 'ongoing';

  return (
    <View style={styles.root}>
      {showGoogleMap ? (
        <ServiceMapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          googleStyle
          lockServiceArea={false}
          initialRegion={{
            ...mapCenter,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          }}
        >
          {!tripStarted && isToPickup(ride.status) && (
            <FlagMarker
              coordinate={{ latitude: ride.pickup_lat, longitude: ride.pickup_lng }}
              title={ride.for_third_party ? 'Passager' : 'Client'}
              variant="pickup"
            />
          )}
          {stops.map((s, i) => (
            <FlagMarker
              key={`stop-${i}`}
              coordinate={{ latitude: s.lat, longitude: s.lng }}
              title={s.label || `Arrêt ${i + 1}`}
              variant="stop"
              badge={String(i + 1)}
            />
          ))}
          <FlagMarker coordinate={dropoff} title="Destination" variant="finish" />
          {routeCoords.length > 1 && (
            <Polyline
              coordinates={routeCoords}
              strokeColor={tripStarted ? '#1A73E8' : colors.yellow}
              strokeWidth={tripStarted ? 6 : 5}
            />
          )}
          <GuidedVehicleMarker
            route={
              routeCoords.length > 1
                ? routeCoords
                : [mapCenter, nextWaypoint?.coordinate ?? dropoff]
            }
            gps={position}
            headingHint={heading}
            vehicleType={driver?.vehicle_type ?? ride.vehicle_type}
            vehicleColor={driver?.vehicle_color}
            title="Mon véhicule"
            autoCruise={!position}
          />
        </ServiceMapView>
      ) : (
        <View style={styles.mapOff}>
          <Text style={styles.mapOffText}>Carte désactivée</Text>
        </View>
      )}

      <View style={[styles.topBar, { top: Math.max(insets.top, 10) }]}>
        <View style={styles.topLeft}>
          {(ride.status === 'accepted' ||
            ride.status === 'arriving' ||
            ride.status === 'arrived' ||
            ride.status === 'ongoing') && (
            <SosHoldButton onConfirm={sendSos} />
          )}
        </View>
        <LogoutButton compact />
      </View>

      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 10) + 6 }]}>
        <View style={styles.sheetRow}>
          <Text style={styles.brand}>{guideLabel}</Text>
          <Text style={styles.meta}>
            {formatPrice(rideAgreedPrice(ride))}
            {legsTag ? ` · ${legsTag}` : ''}
            {' · convenu'}
          </Text>
        </View>
        {passengerLine ? (
          <Text style={styles.title} numberOfLines={1}>
            {passengerLine}
          </Text>
        ) : null}
        {rideEta ? <RideEtaBanner info={rideEta} /> : null}
        <IdentityBadge
          lines={[
            { label: 'ID client', value: shortId(ride.client_id) },
            {
              label: 'Client',
              value: clientInfo?.name || ride.passenger_name || '—',
            },
            {
              label: 'Tél.',
              value: clientInfo?.phone || ride.passenger_phone || '—',
            },
            { label: 'ID course', value: shortId(ride.id) },
          ]}
        />
        {!tripStarted && stops.length > 0 ? (
          <RideItinerary ride={ride} compact showTypeBadge />
        ) : (
          <Text style={styles.title} numberOfLines={1}>
            {tripStarted
              ? nextWaypoint?.label || ride.dropoff_address || 'Destination'
              : ride.dropoff_address || 'Destination'}
          </Text>
        )}
        <View style={styles.actions}>
          <PrimaryButton
            title={nextLabel}
            onPress={nextAction}
            loading={loading}
            style={styles.mainBtn}
          />
          {ride.status !== 'completed' &&
            ride.status !== 'cancelled_by_client' &&
            ride.status !== 'cancelled_by_driver' && (
              <Pressable
                onPress={() => setStatus('cancelled_by_driver')}
                disabled={loading}
                style={styles.cancelBtn}
              >
                <Text style={styles.cancelText}>Annuler</Text>
              </Pressable>
            )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  topLeft: { minWidth: 64 },
  mapOff: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bgElevated,
  },
  mapOffText: { color: colors.muted, fontWeight: '700' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bgPanel,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: spacing.md,
    paddingTop: 10,
    gap: 6,
    borderTopWidth: 1,
    borderColor: colors.border,
  },
  sheetRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  brand: { color: colors.yellow, fontWeight: '800', fontSize: 11 },
  title: { color: colors.white, fontSize: 12, fontWeight: '600' },
  meta: { color: colors.muted, fontSize: 11 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
  mainBtn: { flex: 1, height: 44 },
  cancelBtn: {
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelText: { color: colors.muted, fontWeight: '700', fontSize: 13 },
});

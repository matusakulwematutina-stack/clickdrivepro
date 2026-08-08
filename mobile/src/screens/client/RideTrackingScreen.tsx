import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FlagMarker } from '../../components/FlagMarker';
import { GuidedVehicleMarker } from '../../components/GuidedVehicleMarker';
import { IdentityBadge } from '../../components/IdentityBadge';
import { LogoutButton } from '../../components/LogoutButton';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SosHoldButton } from '../../components/SosHoldButton';
import { ServiceMapView } from '../../components/ServiceMapView';
import { useAuth } from '../../context/AuthContext';
import { RideEtaBanner } from '../../components/RideEtaBanner';
import { useRideEta } from '../../hooks/useRideEta';
import { useVoiceGuidance } from '../../hooks/useVoiceGuidance';
import { createSosAlert } from '../../lib/adminApi';
import { clearActiveRide, rememberActiveRide } from '../../lib/activeRide';
import { formatPrice, rideAgreedPrice } from '../../lib/geo';
import { shortId, vehiclePublicId } from '../../lib/ids';
import { vehicleLabel } from '../../lib/pricing';
import { playNewRideAlert, preloadRideAlert, stopRideAlert } from '../../lib/rideAlert';
import { fetchDrivingRouteWaypoints, type RouteManeuver } from '../../lib/routing';
import { parseRideStops, remainingWaypoints, rideLegsLabel } from '../../lib/rideStops';
import { resetVoiceGuidance } from '../../lib/voiceGuidance';
import { supabase } from '../../lib/supabase';
import { colors, spacing } from '../../lib/theme';
import type { Driver, LatLng, Ride, RideOffer } from '../../types';

type Props = {
  rideId: string;
  onClose: () => void;
};

const STATUS_LABEL: Record<string, string> = {
  requested: 'Recherche d’un chauffeur…',
  offered: 'Chauffeur contacté — en attente',
  accepted: 'Chauffeur en route',
  arriving: 'Chauffeur approche',
  arrived: 'Chauffeur arrivé',
  ongoing: 'Course en cours',
  completed: 'Course terminée',
  cancelled_by_client: 'Course annulée',
  cancelled_by_driver: 'Annulée par le chauffeur',
  no_driver_found: 'Aucun chauffeur trouvé',
};

function secondsLeft(iso?: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.ceil(ms / 1000));
}

type OfferRow = RideOffer & {
  drivers?: {
    id?: string;
    plate_number?: string | null;
    vehicle_type?: string | null;
    vehicle_brand?: string | null;
    vehicle_model?: string | null;
    vehicle_color?: string | null;
    profiles?: { full_name?: string | null; phone?: string | null } | null;
  } | null;
};

export function RideTrackingScreen({ rideId, onClose }: Props) {
  const { profile } = useAuth();
  const insets = useSafeAreaInsets();
  const [ride, setRide] = useState<Ride | null>(null);
  const [driver, setDriver] = useState<Driver | null>(null);
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [rating, setRating] = useState(5);
  const [saving, setSaving] = useState(false);
  const [routeCoords, setRouteCoords] = useState<LatLng[]>([]);
  const [routeSteps, setRouteSteps] = useState<RouteManeuver[]>([]);
  const [routeDurationMin, setRouteDurationMin] = useState<number | null>(null);
  const knownOfferIds = useRef<Set<string>>(new Set());
  const offersReady = useRef(false);

  const loadOffers = async () => {
    const { data } = await supabase
      .from('ride_offers')
      .select(
        '*, drivers(id, plate_number, vehicle_type, vehicle_brand, vehicle_model, vehicle_color, profiles(full_name, phone))',
      )
      .eq('ride_id', rideId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false });
    const list = (data as OfferRow[]) ?? [];

    const nextIds = new Set(list.map((o) => o.id));
    if (offersReady.current) {
      const hasNew = list.some((o) => !knownOfferIds.current.has(o.id));
      if (hasNew) playNewRideAlert();
      if (list.length === 0) stopRideAlert();
    } else {
      offersReady.current = true;
    }
    knownOfferIds.current = nextIds;

    setOffers(list);
  };

  useEffect(() => {
    let active = true;
    rememberActiveRide(rideId);
    preloadRideAlert();

    const load = async () => {
      const { data } = await supabase.from('rides').select('*').eq('id', rideId).maybeSingle();
      if (!active || !data) return;
      setRide(data as Ride);
      if (data.driver_id) {
        const { data: d } = await supabase
          .from('drivers')
          .select('*')
          .eq('id', data.driver_id)
          .maybeSingle();
        if (active) setDriver((d as Driver) ?? null);
      }
      await loadOffers();
    };

    load();

    const tick = setInterval(() => {
      void supabase.rpc('tick_ride_dispatch', { p_ride_id: rideId }).then(() => {
        if (active) void load();
      });
    }, 4000);

    const channel = supabase
      .channel(`ride-${rideId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` },
        (payload) => {
          const next = payload.new as Ride;
          setRide(next);
          // Course acceptée / terminée → stop sonnerie offres
          if (
            next.status === 'accepted' ||
            next.status === 'ongoing' ||
            next.status === 'completed' ||
            next.status === 'cancelled_by_client' ||
            next.status === 'cancelled_by_driver' ||
            next.status === 'no_driver_found'
          ) {
            stopRideAlert();
          }
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'ride_offers',
          filter: `ride_id=eq.${rideId}`,
        },
        (payload) => {
          const offer = payload.new as { id: string; status?: string };
          // Son immédiat dès que le chauffeur propose un prix
          if (offer.status === 'pending' || !offer.status) {
            if (!knownOfferIds.current.has(offer.id)) {
              knownOfferIds.current.add(offer.id);
              playNewRideAlert();
            }
          }
          loadOffers();
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'ride_offers',
          filter: `ride_id=eq.${rideId}`,
        },
        () => {
          loadOffers();
        },
      )
      .subscribe();

    return () => {
      active = false;
      clearInterval(tick);
      stopRideAlert();
      offersReady.current = false;
      knownOfferIds.current = new Set();
      supabase.removeChannel(channel);
    };
  }, [rideId]);

  // Dès qu’un chauffeur est assigné : charger profil (couleur véhicule) + suivre GPS
  useEffect(() => {
    if (!ride?.driver_id) {
      setDriver(null);
      return;
    }
    let active = true;
    const driverId = ride.driver_id;

    const fetchDriver = async () => {
      const { data: d } = await supabase
        .from('drivers')
        .select(
          'id, profile_id, vehicle_type, vehicle_brand, vehicle_model, vehicle_color, plate_number, lat, lng, heading, is_online, is_available',
        )
        .eq('id', driverId)
        .maybeSingle();
      if (active && d) setDriver(d as Driver);
    };
    void fetchDriver();

    const channel = supabase
      .channel(`driver-loc-${driverId}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'drivers',
          filter: `id=eq.${driverId}`,
        },
        (payload) => {
          const next = payload.new as Driver;
          setDriver((prev) => ({
            ...(prev || ({} as Driver)),
            ...next,
            // Ne pas perdre la couleur si le payload GPS est partiel
            vehicle_color:
              next.vehicle_color ?? prev?.vehicle_color ?? null,
            vehicle_type: next.vehicle_type ?? prev?.vehicle_type,
          }));
        },
      )
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [ride?.driver_id]);

  useEffect(() => {
    if (!ride) return;
    let active = true;

    const toPickup =
      ride.status === 'accepted' || ride.status === 'arriving';
    const tripActive = ride.status === 'ongoing';
    const previewRoute =
      ride.status === 'requested' ||
      ride.status === 'offered' ||
      ride.status === 'arrived';

    const stops = parseRideStops(ride);
    const remaining = remainingWaypoints(ride);

    if (toPickup && driver?.lat != null && driver?.lng != null) {
      const points: LatLng[] = [
        { latitude: driver.lat, longitude: driver.lng },
        { latitude: ride.pickup_lat, longitude: ride.pickup_lng },
      ];
      (async () => {
        const route = await fetchDrivingRouteWaypoints(points);
        if (!active) return;
        if (route) {
          setRouteCoords(route.coordinates);
          setRouteSteps(route.steps);
          setRouteDurationMin(route.durationMin);
          resetVoiceGuidance();
        } else {
          setRouteCoords(points);
          setRouteSteps([]);
          setRouteDurationMin(null);
        }
      })();
    } else if (tripActive && driver?.lat != null && driver?.lng != null) {
      const destPoints =
        remaining.length > 0
          ? remaining.map((w) => w.coordinate)
          : [{ latitude: ride.dropoff_lat, longitude: ride.dropoff_lng }];
      const points: LatLng[] = [
        { latitude: driver.lat, longitude: driver.lng },
        ...destPoints,
      ];
      (async () => {
        const route = await fetchDrivingRouteWaypoints(points);
        if (!active) return;
        if (route) {
          setRouteCoords(route.coordinates);
          setRouteSteps(route.steps);
          setRouteDurationMin(route.durationMin);
          resetVoiceGuidance();
        } else {
          setRouteCoords(points);
          setRouteSteps([]);
          setRouteDurationMin(null);
        }
      })();
    } else if (previewRoute) {
      const points: LatLng[] = [
        { latitude: ride.pickup_lat, longitude: ride.pickup_lng },
        ...stops.map((s) => ({ latitude: s.lat, longitude: s.lng })),
        { latitude: ride.dropoff_lat, longitude: ride.dropoff_lng },
      ];
      (async () => {
        const route = await fetchDrivingRouteWaypoints(points);
        if (!active) return;
        if (route) {
          setRouteCoords(route.coordinates);
          setRouteSteps(route.steps);
          setRouteDurationMin(null);
          resetVoiceGuidance();
        } else {
          setRouteCoords(points);
          setRouteSteps([]);
          setRouteDurationMin(null);
        }
      })();
    } else {
      setRouteCoords([]);
      setRouteSteps([]);
      setRouteDurationMin(null);
    }

    return () => {
      active = false;
    };
  }, [
    ride?.id,
    ride?.status,
    ride?.pickup_lat,
    ride?.pickup_lng,
    ride?.dropoff_lat,
    ride?.dropoff_lng,
    ride?.stops_done,
    JSON.stringify(ride?.stops ?? []),
    driver?.lat,
    driver?.lng,
  ]);

  const rideEta = useRideEta(ride, routeDurationMin);

  // Position suivie = véhicule (pour annoncer 150 m / arrivée au client)
  const voicePos =
    driver?.lat != null && driver?.lng != null
      ? { latitude: driver.lat, longitude: driver.lng }
      : null;

  const clientNext =
    ride && (ride.status === 'ongoing' || ride.status === 'arrived')
      ? remainingWaypoints(ride)[0]
      : null;

  useVoiceGuidance({
    role: 'client',
    enabled: !!ride && (ride.status === 'ongoing' || ride.status === 'arrived'),
    position: voicePos,
    destination: clientNext?.coordinate ?? null,
    steps: routeSteps,
  });

  const cancelRide = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('rides')
      .update({ status: 'cancelled_by_client' })
      .eq('id', rideId);
    setSaving(false);
    if (error) Alert.alert('Erreur', error.message);
    else {
      await clearActiveRide();
      onClose();
    }
  };

  const acceptOffer = async (offerId: string, price: number) => {
    stopRideAlert();
    setSaving(true);
    const { error } = await supabase.rpc('accept_ride_offer', { p_offer_id: offerId });
    if (error) {
      setSaving(false);
      Alert.alert('Erreur', error.message);
      return;
    }
    // Recharge la course pour afficher exactement le prix accepté (pas l’ancien estimé)
    const { data: fresh } = await supabase
      .from('rides')
      .select('*')
      .eq('id', rideId)
      .maybeSingle();
    if (fresh) setRide(fresh as Ride);
    setSaving(false);
    const agreed = fresh
      ? rideAgreedPrice(fresh as Ride)
      : Math.round(Number(price) || 0);
    Alert.alert('Course confirmée', `Prix convenu : ${formatPrice(agreed)}`);
    await loadOffers();
  };

  const declineOffer = async (offerId: string) => {
    stopRideAlert();
    setSaving(true);
    const { error } = await supabase.rpc('decline_ride_offer', { p_offer_id: offerId });
    setSaving(false);
    if (error) {
      Alert.alert('Erreur', error.message);
      return;
    }
    await loadOffers();
  };

  const submitRating = async () => {
    setSaving(true);
    const { error } = await supabase
      .from('rides')
      .update({ client_rating: rating })
      .eq('id', rideId);
    setSaving(false);
    if (error) Alert.alert('Erreur', error.message);
    else {
      await clearActiveRide();
      Alert.alert('Merci', 'Votre note a été enregistrée.');
      onClose();
    }
  };

  // Si la course se termine / annule en temps réel → libérer la reprise
  useEffect(() => {
    if (!ride) return;
    const done =
      ride.status === 'completed' ||
      ride.status === 'cancelled_by_client' ||
      ride.status === 'cancelled_by_driver' ||
      ride.status === 'no_driver_found';
    if (done) clearActiveRide();
  }, [ride?.status]);

  if (!ride) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={{ color: colors.white }}>Chargement de la course…</Text>
      </View>
    );
  }

  // Toujours un point véhicule : GPS chauffeur, sinon départ
  const vehicleCoord =
    driver?.lat != null && driver?.lng != null
      ? { latitude: driver.lat, longitude: driver.lng }
      : { latitude: ride.pickup_lat, longitude: ride.pickup_lng };

  const vehicleType = driver?.vehicle_type ?? ride.vehicle_type;
  const negotiating = ride.status === 'requested' || ride.status === 'offered';
  // Couleur depuis profil chauffeur, sinon depuis l’offre acceptée / première offre
  const offerVehicleColor =
    offers.find((o) => o.status === 'accepted')?.drivers?.vehicle_color ??
    offers.find((o) => o.drivers?.vehicle_color)?.drivers?.vehicle_color ??
    null;
  const mapVehicleColor = driver?.vehicle_color || offerVehicleColor || null;

  return (
    <View style={styles.root}>
      <ServiceMapView
        style={StyleSheet.absoluteFill}
        initialRegion={{
          latitude: ride.pickup_lat,
          longitude: ride.pickup_lng,
          latitudeDelta: 0.06,
          longitudeDelta: 0.06,
        }}
      >
        <FlagMarker
          coordinate={{ latitude: ride.pickup_lat, longitude: ride.pickup_lng }}
          title="Départ"
          variant="pickup"
        />
        {parseRideStops(ride).map((s, i) => (
          <FlagMarker
            key={`stop-${i}`}
            coordinate={{ latitude: s.lat, longitude: s.lng }}
            title={s.label || `Arrêt ${i + 1}`}
            variant="stop"
            badge={String(i + 1)}
          />
        ))}
        <FlagMarker
          coordinate={{ latitude: ride.dropoff_lat, longitude: ride.dropoff_lng }}
          title="Arrivée"
          variant="finish"
        />
        {routeCoords.length > 1 && (
          <Polyline coordinates={routeCoords} strokeColor={colors.yellow} strokeWidth={5} />
        )}
        <GuidedVehicleMarker
          route={
            routeCoords.length > 1
              ? routeCoords
              : [
                  { latitude: ride.pickup_lat, longitude: ride.pickup_lng },
                  ...parseRideStops(ride).map((s) => ({
                    latitude: s.lat,
                    longitude: s.lng,
                  })),
                  { latitude: ride.dropoff_lat, longitude: ride.dropoff_lng },
                ]
          }
          gps={
            driver?.lat != null && driver?.lng != null
              ? { latitude: driver.lat, longitude: driver.lng }
              : vehicleCoord
          }
          headingHint={driver?.heading}
          vehicleType={vehicleType}
          vehicleColor={mapVehicleColor}
          title={vehicleLabel(vehicleType)}
          autoCruise={
            ride.status === 'accepted' ||
            ride.status === 'arriving' ||
            ride.status === 'ongoing'
          }
        />
      </ServiceMapView>

      <View style={[styles.topFloat, { top: Math.max(insets.top, 10) }]}>
        <View style={styles.topLeft}>
          {(ride.status === 'accepted' ||
            ride.status === 'arriving' ||
            ride.status === 'arrived' ||
            ride.status === 'ongoing') && (
            <SosHoldButton
              onConfirm={async () => {
                try {
                  await createSosAlert({
                    rideId: ride.id,
                    reporterId: profile?.id || ride.client_id,
                    reporterRole: 'client',
                    clientId: ride.client_id,
                    driverId: ride.driver_id,
                    message: 'SOS client pendant la course',
                    lat: driver?.lat ?? ride.pickup_lat,
                    lng: driver?.lng ?? ride.pickup_lng,
                  });
                  Alert.alert('SOS', 'Alerte envoyée. Secours notifié.');
                } catch (e) {
                  Alert.alert(
                    'Erreur',
                    e instanceof Error ? e.message : 'Échec SOS',
                  );
                }
              }}
            />
          )}
        </View>
        <LogoutButton compact />
      </View>

      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 10) + 6 }]}>
        <View style={styles.sheetTop}>
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text style={styles.status}>{STATUS_LABEL[ride.status] ?? ride.status}</Text>
            {negotiating && (
              <Text style={styles.dispatchHint}>
                {offers.some((o) => o.status === 'pending')
                  ? `Répondez à l’offre${
                      secondsLeft(ride.client_response_expires_at) != null
                        ? ` · ${secondsLeft(ride.client_response_expires_at)}s`
                        : ''
                    }`
                  : `Appel séquentiel (chauffeur le plus proche)${
                      ride.dispatch_round ? ` · tour ${ride.dispatch_round}` : ''
                    }`}
              </Text>
            )}
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={styles.price}>{formatPrice(rideAgreedPrice(ride))}</Text>
            <Text style={styles.priceCaption}>
              {negotiating ? 'Votre proposition' : 'Prix convenu'}
            </Text>
          </View>
        </View>
        {rideEta && !negotiating ? <RideEtaBanner info={rideEta} /> : null}

        <Text style={styles.meta} numberOfLines={2}>
          {rideLegsLabel(ride) ? `${rideLegsLabel(ride)} · ` : ''}
          {ride.dropoff_address || 'Destination'}
          {ride.for_third_party && ride.passenger_name
            ? ` · pour ${ride.passenger_name}`
            : ''}
          {driver && !negotiating
            ? ` · ${vehicleLabel(driver.vehicle_type ?? ride.vehicle_type)}${
                driver.plate_number ? ` ${driver.plate_number}` : ''
              }`
            : ''}
        </Text>

        {driver && !negotiating && (
          <IdentityBadge
            lines={[
              { label: 'ID chauffeur', value: shortId(driver.id) },
              {
                label: 'ID véhicule',
                value: vehiclePublicId({
                  plate: driver.plate_number,
                  driverId: driver.id,
                }),
              },
              {
                label: 'Véhicule',
                value: [
                  vehicleLabel(driver.vehicle_type),
                  driver.vehicle_brand,
                  driver.vehicle_model,
                  driver.vehicle_color,
                ]
                  .filter(Boolean)
                  .join(' · '),
              },
            ]}
          />
        )}

        {negotiating && (
          <View style={styles.offersBox}>
            {offers.length === 0 ? (
              <Text style={styles.meta}>En attente d’offres…</Text>
            ) : (
              <FlatList
                data={offers}
                keyExtractor={(item) => item.id}
                style={{ maxHeight: 200 }}
                renderItem={({ item }) => (
                  <View style={styles.offerCard}>
                    <View style={styles.offerInfo}>
                      <Text style={styles.offerPrice}>
                        {formatPrice(item.offered_price_cents)}
                      </Text>
                      <Text style={styles.offerMeta} numberOfLines={2}>
                        {item.accepts_client_price ? 'Votre prix' : 'Contre-offre'}
                        {item.drivers?.profiles?.full_name
                          ? ` · ${item.drivers.profiles.full_name}`
                          : ''}
                      </Text>
                      <Text style={styles.offerIds} numberOfLines={2}>
                        ID chauff. {shortId(item.drivers?.id || item.driver_id)}
                        {' · '}
                        ID véh.{' '}
                        {vehiclePublicId({
                          plate: item.drivers?.plate_number,
                          driverId: item.drivers?.id || item.driver_id,
                        })}
                      </Text>
                    </View>
                    <View style={styles.offerActions}>
                      <PrimaryButton
                        title="Non"
                        variant="ghost"
                        loading={saving}
                        onPress={() => declineOffer(item.id)}
                        style={{ width: 64 }}
                      />
                      <PrimaryButton
                        title="Oui"
                        loading={saving}
                        onPress={() => acceptOffer(item.id, item.offered_price_cents)}
                        style={{ width: 64 }}
                      />
                    </View>
                  </View>
                )}
              />
            )}
          </View>
        )}

        {negotiating || ride.status === 'accepted' || ride.status === 'arriving' ? (
          <PrimaryButton
            title="Annuler"
            onPress={cancelRide}
            variant="ghost"
            loading={saving}
          />
        ) : null}

        {ride.status === 'completed' && (
          <View style={styles.ratingRow}>
            <View style={styles.stars}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Text
                  key={n}
                  onPress={() => setRating(n)}
                  style={[styles.star, n <= rating && styles.starOn]}
                >
                  ★
                </Text>
              ))}
            </View>
            <PrimaryButton
              title="Noter"
              onPress={submitRating}
              loading={saving}
              style={{ flex: 1 }}
            />
          </View>
        )}

        {(ride.status === 'cancelled_by_client' ||
          ride.status === 'cancelled_by_driver' ||
          ride.status === 'no_driver_found' ||
          ride.status === 'completed') && (
          <PrimaryButton title="Fermer" onPress={onClose} variant="ghost" />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center' },
  topFloat: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  topLeft: { minWidth: 64 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(14,14,14,0.94)',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingHorizontal: spacing.md,
    paddingTop: 12,
    gap: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  sheetTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  status: { color: colors.white, fontSize: 15, fontWeight: '700', flex: 1 },
  price: { color: colors.yellow, fontSize: 14, fontWeight: '700' },
  priceCaption: { color: colors.muted, fontSize: 10, fontWeight: '600' },
  dispatchHint: { color: colors.yellow, fontSize: 11, fontWeight: '700', marginTop: 2 },
  meta: { color: colors.muted, fontSize: 12 },
  offersBox: { gap: 6, marginTop: 2 },
  offerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    padding: 8,
    marginBottom: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  offerInfo: { flex: 1, gap: 2 },
  offerPrice: { color: colors.white, fontSize: 16, fontWeight: '800' },
  offerMeta: { color: colors.muted, fontSize: 11 },
  offerIds: { color: colors.yellow, fontSize: 10, fontWeight: '800' },
  offerActions: { flexDirection: 'row', gap: 6 },
  ratingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  stars: { flexDirection: 'row', gap: 4 },
  star: { fontSize: 26, color: colors.border },
  starOn: { color: colors.yellow },
});

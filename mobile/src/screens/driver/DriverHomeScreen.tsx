import React, { useEffect, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { FlagMarker } from '../../components/FlagMarker';
import { IdentityBadge } from '../../components/IdentityBadge';
import { LogoutButton } from '../../components/LogoutButton';
import { PawapayTopupForm } from '../../components/PawapayTopupForm';
import { PrimaryButton } from '../../components/PrimaryButton';
import { RideItinerary } from '../../components/RideItinerary';
import { ServiceMapView } from '../../components/ServiceMapView';
import { VehicleMarker } from '../../components/VehicleMarker';
import { useAuth } from '../../context/AuthContext';
import { fetchActiveRideForDriver, rememberActiveRide } from '../../lib/activeRide';
import { requestWithdrawal } from '../../lib/adminApi';
import { formatPrice, LUBUMBASHI, rideAgreedPrice } from '../../lib/geo';
import { shortId } from '../../lib/ids';
import { playNewRideAlert, preloadRideAlert, stopRideAlert } from '../../lib/rideAlert';
import { parseRideStops } from '../../lib/rideStops';
import {
  getMinDriverBalanceFc,
  loadServiceConfig,
} from '../../lib/serviceConfig';
import { supabase } from '../../lib/supabase';
import { colors, spacing } from '../../lib/theme';
import type { LatLng, Ride } from '../../types';

type Props = {
  onOpenRide: (ride: Ride) => void;
  onResumeRide?: (ride: Ride) => void;
  onOpenVehicle?: () => void;
};

export function DriverHomeScreen({
  onOpenRide,
  onResumeRide,
  onOpenVehicle,
}: Props) {
  const { driver, profile, refreshProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const [online, setOnline] = useState(driver?.is_online ?? false);
  const [requests, setRequests] = useState<Ride[]>([]);
  const [selectedRideId, setSelectedRideId] = useState<string | null>(null);
  const [position, setPosition] = useState<LatLng>(LUBUMBASHI);
  const [offerPrices, setOfferPrices] = useState<Record<string, string>>({});
  const [sendingId, setSendingId] = useState<string | null>(null);
  const [walletAmount, setWalletAmount] = useState('');
  const [walletPhone, setWalletPhone] = useState('');
  const [walletBusy, setWalletBusy] = useState(false);
  const [walletMode, setWalletMode] = useState<'topup' | 'withdraw'>('topup');
  const [clientLabels, setClientLabels] = useState<
    Record<string, { name?: string | null; phone?: string | null }>
  >({});
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const mapRef = useRef<MapView | null>(null);
  const knownRideIds = useRef<Set<string>>(new Set());
  const alertReady = useRef(false);
  const driverId = driver?.id;

  const selectedRide =
    requests.find((r) => r.id === selectedRideId) ?? requests[0] ?? null;

  useEffect(() => {
    if (!requests.length) {
      setSelectedRideId(null);
      return;
    }
    if (!selectedRideId || !requests.some((r) => r.id === selectedRideId)) {
      setSelectedRideId(requests[0].id);
    }
  }, [requests, selectedRideId]);

  useEffect(() => {
    const ride = selectedRide;
    if (!ride?.client_id || clientLabels[ride.client_id]) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, phone')
        .eq('id', ride.client_id)
        .maybeSingle();
      if (cancelled || !data) return;
      setClientLabels((prev) => ({
        ...prev,
        [ride.client_id]: {
          name: data.full_name,
          phone: data.phone,
        },
      }));
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedRide?.client_id, selectedRide?.id]);

  useEffect(() => {
    if (!selectedRide) return;
    const stops = parseRideStops(selectedRide);
    const coords: LatLng[] = [
      position,
      { latitude: selectedRide.pickup_lat, longitude: selectedRide.pickup_lng },
      ...stops.map((s) => ({ latitude: s.lat, longitude: s.lng })),
      { latitude: selectedRide.dropoff_lat, longitude: selectedRide.dropoff_lng },
    ];
    const t = setTimeout(() => {
      mapRef.current?.fitToCoordinates(coords, {
        edgePadding: { top: 100, right: 32, bottom: 180, left: 32 },
        animated: true,
      });
    }, 250);
    return () => clearTimeout(t);
  }, [selectedRide?.id, position.latitude, position.longitude]);

  useEffect(() => {
    setOnline(driver?.is_online ?? false);
  }, [driver?.is_online]);

  useEffect(() => {
    if (profile?.phone) {
      setWalletPhone((prev) => prev || profile.phone || '');
    }
  }, [profile?.phone]);

  useEffect(() => {
    void (async () => {
      await loadServiceConfig(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const pos = await Location.getCurrentPositionAsync({});
      const next = {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      };
      setPosition(next);
      mapRef.current?.animateToRegion(
        { ...next, latitudeDelta: 0.04, longitudeDelta: 0.04 },
        400,
      );
    })();
  }, []);

  // Reprendre la course en cours après coupure / redémarrage
  useEffect(() => {
    if (!driverId || !onResumeRide) return;
    let cancelled = false;
    (async () => {
      const ride = await fetchActiveRideForDriver(driverId);
      if (!cancelled && ride) {
        await rememberActiveRide(ride.id);
        onResumeRide(ride);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId]);

  useEffect(() => {
    if (!online || !driverId) {
      watchRef.current?.remove();
      watchRef.current = null;
      return;
    }

    let mounted = true;
    (async () => {
      watchRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 25,
          timeInterval: 5000,
        },
        async (pos) => {
          if (!mounted) return;
          const next = {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          };
          setPosition(next);
          await supabase
            .from('drivers')
            .update({
              lat: next.latitude,
              lng: next.longitude,
              heading: pos.coords.heading ?? 0,
              updated_at: new Date().toISOString(),
            })
            .eq('id', driverId);
        },
      );
    })();

    return () => {
      mounted = false;
      watchRef.current?.remove();
    };
  }, [online, driverId]);

  useEffect(() => {
    if (!online || !driverId) {
      setRequests([]);
      return;
    }

    // Précharge le son dès la mise en ligne → alerte sans retard
    preloadRideAlert();

    const load = async () => {
      // Uniquement les courses ciblées vers CE chauffeur (dispatch séquentiel)
      const { data, error } = await supabase.rpc('list_dispatch_rides_for_driver');
      if (error) {
        console.warn('list_dispatch_rides_for_driver', error.message);
      }
      const open = (data as Ride[]) ?? [];

      const nextIds = new Set(open.map((r) => r.id));
      // Nouvelle course pour moi → sonnerie
      for (const r of open) {
        if (alertReady.current && !knownRideIds.current.has(r.id)) {
          playNewRideAlert();
        }
      }
      if (!alertReady.current) {
        alertReady.current = true;
      }
      knownRideIds.current = nextIds;

      if (open.length === 0) {
        stopRideAlert();
      }

      setRequests(open);

      setOfferPrices((prev) => {
        const next = { ...prev };
        for (const r of open) {
          if (!next[r.id]) next[r.id] = String(Math.round(r.estimated_price || 0));
        }
        return next;
      });
    };

    load();
    // Avance le dispatch + rafraîchit la file (sonnerie limitée dans le temps)
    const tick = setInterval(() => {
      void supabase.rpc('tick_ride_dispatch').then(() => load());
    }, 4000);

    const channel = supabase
      .channel(`driver-requests-${driverId}-${Date.now()}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'rides' },
        () => {
          load();
        },
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ride_offers' }, () =>
        load(),
      )
      .subscribe();

    const acceptChannel = supabase
      .channel(`driver-selected-${driverId}-${Date.now()}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rides',
          filter: `driver_id=eq.${driverId}`,
        },
        async (payload) => {
          const ride = payload.new as Ride;
          if (ride.status === 'accepted') {
            stopRideAlert();
            await rememberActiveRide(ride.id);
            // Recharge pour garantir le prix convenu (offre acceptée)
            const { data: fresh } = await supabase
              .from('rides')
              .select('*')
              .eq('id', ride.id)
              .maybeSingle();
            onOpenRide((fresh as Ride) || ride);
          }
        },
      )
      .subscribe();

    return () => {
      clearInterval(tick);
      supabase.removeChannel(channel);
      supabase.removeChannel(acceptChannel);
      stopRideAlert();
      alertReady.current = false;
      knownRideIds.current = new Set();
    };
    // onOpenRide volontairement hors deps (évite resubscribe en boucle)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, driverId]);

  const submitWithdraw = async () => {
    if (!driverId) return;
    const phone = walletPhone.trim() || profile?.phone || '';
    const amount = Number(String(walletAmount).replace(/\s/g, '').replace(',', '.'));
    setWalletBusy(true);
    try {
      if (!phone) throw new Error('Indiquez le numéro de retrait');
      await requestWithdrawal({ driverId, amountFc: amount, phone });
      Alert.alert('OK', 'Demande de retrait envoyée (PawaPay / admin).');
      setWalletAmount('');
      await refreshProfile();
    } catch (e) {
      Alert.alert('Portefeuille', e instanceof Error ? e.message : 'Échec');
    } finally {
      setWalletBusy(false);
    }
  };

  const toggleOnline = async (value: boolean) => {
    if (!driverId) return;
    if (value && driver?.is_enabled === false) {
      Alert.alert(
        'Compte désactivé',
        'Votre compte chauffeur a été désactivé par l’administrateur.',
      );
      return;
    }
    const minBal = getMinDriverBalanceFc();
    const bal = Number(driver?.wallet_balance ?? 0);
    if (value && bal < minBal) {
      Alert.alert(
        'Solde insuffisant',
        `Rechargez votre compte (min. ${formatPrice(minBal)}) pour couper la commission et recevoir des courses.\nSolde actuel : ${formatPrice(bal)}`,
      );
      return;
    }
    setOnline(value);
    if (!value) {
      stopRideAlert();
      alertReady.current = false;
      knownRideIds.current = new Set();
    }
    const { error } = await supabase
      .from('drivers')
      .update({
        is_online: value,
        is_available: value,
        status: value ? 'online' : 'offline',
        lat: position.latitude,
        lng: position.longitude,
        updated_at: new Date().toISOString(),
      })
      .eq('id', driverId);
    if (error) {
      Alert.alert('Erreur', error.message);
      setOnline(!value);
      return;
    }
    await refreshProfile();
  };

  const sendOffer = async (ride: Ride, acceptClientPrice: boolean) => {
    if (!driverId) return;
    const raw = acceptClientPrice
      ? String(Math.round(ride.estimated_price || 0))
      : offerPrices[ride.id];
    const price = Number(String(raw).replace(/\s/g, '').replace(',', '.'));
    if (!price || price < 500) {
      Alert.alert('Prix', 'Proposez un prix valide (min. 500 FC).');
      return;
    }

    setSendingId(ride.id);
    stopRideAlert();
    const { error } = await supabase.from('ride_offers').upsert(
      {
        ride_id: ride.id,
        driver_id: driverId,
        offered_price_cents: Math.round(price),
        accepts_client_price: acceptClientPrice,
        status: 'pending',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'ride_id,driver_id' },
    );

    if (!error) {
      await supabase
        .from('rides')
        .update({ status: 'offered', updated_at: new Date().toISOString() })
        .eq('id', ride.id)
        .in('status', ['requested', 'offered']);
    }

    setSendingId(null);

    if (error) {
      // unique index may need manual insert if upsert conflict target wrong
      const { error: insErr } = await supabase.from('ride_offers').insert({
        ride_id: ride.id,
        driver_id: driverId,
        offered_price_cents: Math.round(price),
        accepts_client_price: acceptClientPrice,
        status: 'pending',
      });
      if (insErr) {
        Alert.alert('Erreur offre', insErr.message);
        return;
      }
      await supabase
        .from('rides')
        .update({ status: 'offered', updated_at: new Date().toISOString() })
        .eq('id', ride.id)
        .in('status', ['requested', 'offered']);
    }

    // Démarre le délai de réponse client (réglage admin)
    await supabase.rpc('mark_offer_awaiting_client', { p_ride_id: ride.id });

    Alert.alert(
      'Offre envoyée',
      acceptClientPrice
        ? `Vous acceptez ${formatPrice(price)}. En attente du client…`
        : `Contre-offre ${formatPrice(price)} envoyée. En attente du client…`,
    );
    setRequests((prev) => prev.filter((r) => r.id !== ride.id));
  };

  const previewStops = selectedRide ? parseRideStops(selectedRide) : [];
  const previewLine: LatLng[] = selectedRide
    ? [
        { latitude: selectedRide.pickup_lat, longitude: selectedRide.pickup_lng },
        ...previewStops.map((s) => ({ latitude: s.lat, longitude: s.lng })),
        {
          latitude: selectedRide.dropoff_lat,
          longitude: selectedRide.dropoff_lng,
        },
      ]
    : [];

  return (
    <View style={styles.root}>
      <ServiceMapView
        ref={mapRef}
        style={styles.map}
        googleStyle
        lockServiceArea={false}
        initialRegion={{
          ...position,
          latitudeDelta: 0.04,
          longitudeDelta: 0.04,
        }}
      >
        <VehicleMarker
          key={`veh-${driver?.vehicle_type}-${driver?.vehicle_color || 'x'}`}
          coordinate={position}
          heading={0}
          vehicleType={driver?.vehicle_type ?? 'taxi'}
          vehicleColor={driver?.vehicle_color}
          title="Mon véhicule"
        />
        {selectedRide && (
          <>
            <FlagMarker
              coordinate={{
                latitude: selectedRide.pickup_lat,
                longitude: selectedRide.pickup_lng,
              }}
              title="Prise en charge"
              variant="pickup"
            />
            {previewStops.map((s, i) => (
              <FlagMarker
                key={`prev-stop-${i}`}
                coordinate={{ latitude: s.lat, longitude: s.lng }}
                title={s.label || `Arrêt ${i + 1}`}
                variant="stop"
                badge={String(i + 1)}
              />
            ))}
            <FlagMarker
              coordinate={{
                latitude: selectedRide.dropoff_lat,
                longitude: selectedRide.dropoff_lng,
              }}
              title="Destination"
              variant="finish"
            />
            {previewLine.length > 1 && (
              <Polyline
                coordinates={previewLine}
                strokeColor={colors.yellow}
                strokeWidth={4}
              />
            )}
          </>
        )}
      </ServiceMapView>

      <View style={[styles.header, { top: Math.max(insets.top, 12) + 8 }]}>
        <View style={styles.brandCol}>
          <Text style={styles.brand}>ClickPro Drive</Text>
          {onOpenVehicle ? (
            <Pressable onPress={onOpenVehicle} hitSlop={8} style={styles.vehicleLink}>
              <Text style={styles.vehicleLinkText}>Profil véhicule</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.onlineRow}>
          <Text style={styles.onlineLabel}>{online ? 'En ligne' : 'Hors ligne'}</Text>
          <Switch
            value={online}
            onValueChange={toggleOnline}
            trackColor={{ false: '#333', true: colors.yellowDim }}
            thumbColor={online ? colors.yellow : '#888'}
          />
          <LogoutButton compact style={{ marginLeft: 4 }} />
        </View>
      </View>

      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 10) + 6 }]}>
        {!online ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.empty}>
              Rechargez votre solde pour couper la commission, puis passez en ligne.
            </Text>
            <Text style={styles.walletHint}>
              Solde : {formatPrice(Number(driver?.wallet_balance ?? 0))}
              {' · min courses '}
              {formatPrice(getMinDriverBalanceFc())}
            </Text>
            <View style={styles.modeRow}>
              <Pressable
                onPress={() => setWalletMode('topup')}
                style={[styles.modeChip, walletMode === 'topup' && styles.modeOn]}
              >
                <Text style={styles.modeText}>Recharger</Text>
              </Pressable>
              <Pressable
                onPress={() => setWalletMode('withdraw')}
                style={[styles.modeChip, walletMode === 'withdraw' && styles.modeOn]}
              >
                <Text style={styles.modeText}>Retrait</Text>
              </Pressable>
              {onOpenVehicle ? (
                <Pressable
                  onPress={onOpenVehicle}
                  style={[styles.modeChip, styles.modeOn]}
                >
                  <Text style={styles.modeText}>Profil véhicule</Text>
                </Pressable>
              ) : null}
            </View>
            {walletMode === 'topup' ? (
              <PawapayTopupForm
                initialPhone={walletPhone || profile?.phone}
                onCredited={() => {
                  void refreshProfile();
                }}
              />
            ) : (
              <>
                <Text style={styles.fieldLabel}>Numéro Mobile Money</Text>
                <TextInput
                  value={walletPhone}
                  onChangeText={setWalletPhone}
                  keyboardType="phone-pad"
                  placeholder="+243…"
                  placeholderTextColor={colors.muted}
                  style={styles.phoneInput}
                />
                <Text style={styles.fieldLabel}>Montant retrait</Text>
                <View style={styles.withdrawRow}>
                  <TextInput
                    value={walletAmount}
                    onChangeText={setWalletAmount}
                    keyboardType="numeric"
                    placeholder="Ex: 5000"
                    placeholderTextColor={colors.muted}
                    style={styles.phoneInput}
                  />
                  <PrimaryButton
                    title="Retrait"
                    onPress={submitWithdraw}
                    loading={walletBusy}
                    style={{ width: 110 }}
                  />
                </View>
              </>
            )}
          </View>
        ) : !selectedRide ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.empty}>En attente de demandes…</Text>
            {onOpenVehicle ? (
              <PrimaryButton
                title="Profil véhicule"
                variant="ghost"
                onPress={onOpenVehicle}
              />
            ) : null}
          </View>
        ) : (
          <View style={styles.card}>
            {requests.length > 1 && (
              <FlatList
                horizontal
                data={requests}
                keyExtractor={(item) => item.id}
                showsHorizontalScrollIndicator={false}
                style={styles.reqTabs}
                contentContainerStyle={{ gap: 6 }}
                renderItem={({ item, index }) => (
                  <Pressable
                    onPress={() => setSelectedRideId(item.id)}
                    style={[
                      styles.reqTab,
                      selectedRide.id === item.id && styles.reqTabOn,
                    ]}
                  >
                    <Text
                      style={[
                        styles.reqTabText,
                        selectedRide.id === item.id && styles.reqTabTextOn,
                      ]}
                    >
                      #{index + 1} · {formatPrice(rideAgreedPrice(item))}
                    </Text>
                  </Pressable>
                )}
              />
            )}

            <View style={styles.cardHeader}>
              <Text style={styles.cardPrice}>
                {formatPrice(rideAgreedPrice(selectedRide))}
              </Text>
              <Text style={styles.cardMeta}>Prix client proposé</Text>
              {!!selectedRide.dispatch_expires_at && (
                <Text style={styles.ringHint}>
                  À vous · répondez avant la fin du délai admin
                </Text>
              )}
              <Text style={styles.cardMeta} numberOfLines={1}>
                {selectedRide.distance_km ?? '?'} km · ~{selectedRide.duration_min ?? '?'} min
                {selectedRide.for_third_party && selectedRide.passenger_name
                  ? ` · ${selectedRide.passenger_name}`
                  : ''}
              </Text>
            </View>

            <IdentityBadge
              lines={[
                {
                  label: 'ID client',
                  value: shortId(selectedRide.client_id),
                },
                {
                  label: 'Client',
                  value:
                    clientLabels[selectedRide.client_id]?.name ||
                    selectedRide.passenger_name ||
                    '—',
                },
                {
                  label: 'Tél.',
                  value:
                    clientLabels[selectedRide.client_id]?.phone ||
                    selectedRide.passenger_phone ||
                    '—',
                },
                {
                  label: 'ID course',
                  value: shortId(selectedRide.id),
                },
              ]}
            />

            <RideItinerary ride={selectedRide} compact showTypeBadge />

            <View style={styles.offerRow}>
              <PrimaryButton
                title="Accepter"
                loading={sendingId === selectedRide.id}
                onPress={() => sendOffer(selectedRide, true)}
                style={styles.btnSm}
              />
              <TextInput
                value={offerPrices[selectedRide.id] ?? ''}
                onChangeText={(t) =>
                  setOfferPrices((prev) => ({ ...prev, [selectedRide.id]: t }))
                }
                keyboardType="numeric"
                placeholder="Contre-offre"
                placeholderTextColor={colors.muted}
                style={styles.priceInput}
              />
              <PrimaryButton
                title="OK"
                variant="ghost"
                loading={sendingId === selectedRide.id}
                onPress={() => sendOffer(selectedRide, false)}
                style={styles.btnOk}
              />
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  map: { flex: 1 },
  header: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    backgroundColor: 'rgba(14,14,14,0.88)',
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  brandCol: { flexShrink: 1, gap: 2 },
  brand: { color: colors.yellow, fontWeight: '800', fontSize: 12 },
  vehicleLink: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.yellow,
    backgroundColor: 'rgba(255,204,0,0.14)',
  },
  vehicleLinkText: {
    color: colors.yellow,
    fontWeight: '800',
    fontSize: 11,
  },
  onlineRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  onlineLabel: { color: colors.muted, fontWeight: '600', fontSize: 11 },
  modeRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  modeChip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  modeOn: {
    borderColor: colors.yellow,
    backgroundColor: 'rgba(255,204,0,0.12)',
  },
  modeText: { color: colors.white, fontWeight: '700', fontSize: 11 },
  sheet: {
    backgroundColor: 'rgba(14,14,14,0.94)',
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  empty: { color: colors.muted, paddingVertical: 4, fontSize: 12 },
  walletHint: { color: colors.white, fontSize: 12, fontWeight: '700' },
  fieldLabel: {
    color: colors.yellow,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 2,
  },
  withdrawRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  phoneInput: {
    flex: 1,
    minHeight: 44,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.yellow,
    borderRadius: 10,
    color: colors.white,
    fontSize: 15,
    fontWeight: '700',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  withdrawInput: {
    flex: 1,
    height: 36,
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 9,
    color: colors.white,
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 0,
  },
  card: { gap: 6 },
  reqTabs: { maxHeight: 28, marginBottom: 0 },
  reqTab: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  reqTabOn: { borderColor: colors.yellow, backgroundColor: 'rgba(255,204,0,0.12)' },
  reqTabText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  reqTabTextOn: { color: colors.yellow },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 8,
  },
  cardPrice: {
    color: colors.yellow,
    fontWeight: '800',
    fontSize: 15,
  },
  cardMeta: { color: colors.muted, fontSize: 11, fontWeight: '600', flexShrink: 1 },
  ringHint: { color: colors.yellow, fontSize: 11, fontWeight: '800' },
  offerRow: { flexDirection: 'row', gap: 6, alignItems: 'center', marginTop: 2 },
  priceInput: {
    flex: 1,
    height: 36,
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 9,
    color: colors.white,
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 8,
    paddingVertical: 0,
  },
  btnSm: { flex: 1, height: 36, borderRadius: 9 },
  btnOk: { width: 48, height: 36, borderRadius: 9 },
});

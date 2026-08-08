import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
  Pressable,
  ActivityIndicator,
  FlatList,
  Keyboard,
} from 'react-native';
import MapView, { Polyline } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { FlagMarker } from '../../components/FlagMarker';
import { LogoutButton } from '../../components/LogoutButton';
import { PawapayTopupForm } from '../../components/PawapayTopupForm';
import { PrimaryButton } from '../../components/PrimaryButton';
import { ServiceMapView } from '../../components/ServiceMapView';
import { useAuth } from '../../context/AuthContext';
import { fetchActiveRideForClient, rememberActiveRide } from '../../lib/activeRide';
import {
  estimateDurationMin,
  formatPrice,
  haversineKm,
  LUBUMBASHI,
} from '../../lib/geo';
import {
  clearAddressHistory,
  loadAddressHistory,
  rememberAddress,
  type HistoryPlace,
} from '../../lib/addressHistory';
import { searchPlaces, type PlaceSuggestion } from '../../lib/places';
import { estimateFare, VEHICLE_OPTIONS } from '../../lib/pricing';
import { createClientRide } from '../../lib/createRide';
import { fetchDrivingRouteWaypoints } from '../../lib/routing';
import { isPointInActiveZone, loadServiceConfig } from '../../lib/serviceConfig';
import { colors, spacing } from '../../lib/theme';
import type { LatLng, PaymentMethod, Ride, RideStop, VehicleType } from '../../types';

type Props = {
  onRideCreated: (ride: Ride) => void;
  onResumeRide?: (ride: Ride) => void;
  onOpenHistory: () => void;
};

const PAY_OPTIONS: { id: PaymentMethod; label: string }[] = [
  { id: 'cash', label: 'Espèces' },
  { id: 'wallet', label: 'Wallet' },
  { id: 'orange_money', label: 'Orange' },
  { id: 'airtel_money', label: 'Airtel' },
];

type DestSlot = {
  label: string;
  coord: LatLng | null;
};

type LegMode = 1 | 2 | 3;

const LEG_OPTIONS: { id: LegMode; label: string }[] = [
  { id: 1, label: 'Simple' },
  { id: 2, label: 'Double' },
  { id: 3, label: 'Triple' },
];

function emptySlots(n: LegMode): DestSlot[] {
  return Array.from({ length: n }, () => ({ label: '', coord: null }));
}

function slotTitle(index: number, total: number) {
  if (total === 1) return 'Destination';
  if (index === total - 1) return 'Destination finale';
  return `Arrêt ${index + 1}`;
}

export function ClientHomeScreen({ onRideCreated, onResumeRide, onOpenHistory }: Props) {
  const { profile, refreshProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const [pickup, setPickup] = useState<LatLng>(LUBUMBASHI);
  const [legMode, setLegMode] = useState<LegMode>(1);
  const [slots, setSlots] = useState<DestSlot[]>(() => emptySlots(1));
  const [activeSlot, setActiveSlot] = useState(0);
  const [searchText, setSearchText] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('taxi');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [showWallet, setShowWallet] = useState(false);
  const [loading, setLoading] = useState(false);
  const [routing, setRouting] = useState(false);
  const [searching, setSearching] = useState(false);
  const [locReady, setLocReady] = useState(false);
  const [routeCoords, setRouteCoords] = useState<LatLng[]>([]);
  const [distanceKm, setDistanceKm] = useState<number | null>(null);
  const [durationMin, setDurationMin] = useState<number | null>(null);
  const [suggestedPrice, setSuggestedPrice] = useState<number | null>(null);
  const [proposedPrice, setProposedPrice] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [forThirdParty, setForThirdParty] = useState(false);
  const [passengerName, setPassengerName] = useState('');
  const [passengerPhone, setPassengerPhone] = useState('');
  const [searchEmpty, setSearchEmpty] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [addressHistory, setAddressHistory] = useState<HistoryPlace[]>([]);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const priceInputRef = useRef<TextInput>(null);
  const searchInputRef = useRef<TextInput>(null);

  /** Pendant la recherche d’adresse : on masque le panneau bas */
  const searchingUi =
    searchFocused || suggestions.length > 0 || searchText.trim().length >= 2;

  const filledCount = useMemo(
    () => slots.filter((s) => s.coord != null).length,
    [slots],
  );
  const allFilled = filledCount === legMode;
  const intermediateCount = Math.max(0, legMode - 1);

  useEffect(() => {
    void (async () => {
      await loadServiceConfig(true);
      const hist = await loadAddressHistory();
      setAddressHistory(hist);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocReady(true);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({});
      setPickup({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
      setLocReady(true);
    })();
  }, []);

  useEffect(() => {
    if (!profile?.id || !onResumeRide) return;
    let cancelled = false;
    (async () => {
      const ride = await fetchActiveRideForClient(profile.id);
      if (!cancelled && ride) onResumeRide(ride);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id]);

  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvt, (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener(hideEvt, () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const changeLegMode = (mode: LegMode) => {
    setLegMode(mode);
    setSlots((prev) => {
      const next = emptySlots(mode);
      for (let i = 0; i < mode; i++) {
        if (prev[i]) next[i] = prev[i];
      }
      return next;
    });
    setActiveSlot(0);
    setSearchText('');
    setSuggestions([]);
    setSearchEmpty(false);
  };

  const onChangeSearch = (text: string) => {
    setSearchText(text);
    setSearchEmpty(false);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (text.trim().length < 2) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      const results = await searchPlaces(text);
      setSuggestions(results);
      setSearchEmpty(results.length === 0);
      setSearching(false);
    }, 350);
  };

  const clearSearch = () => {
    setSearchText('');
    setSuggestions([]);
    setSearchEmpty(false);
    setSearching(false);
  };

  const fillSlot = (slotIndex: number, point: LatLng, label: string) => {
    if (!isPointInActiveZone(point)) {
      Alert.alert(
        'Hors zone',
        'Cette adresse est hors de la zone de service active (province / rayon admin).',
      );
      return;
    }
    setSlots((prev) => {
      const next = [...prev];
      next[slotIndex] = { label, coord: point };
      let nextIdx = slotIndex;
      for (let i = 0; i < legMode; i++) {
        const idx = (slotIndex + 1 + i) % legMode;
        if (!next[idx]?.coord) {
          nextIdx = idx;
          break;
        }
      }
      setActiveSlot(nextIdx);
      return next;
    });
    setSearchText('');
    setSuggestions([]);
    Keyboard.dismiss();
  };

  const selectPlace = (place: PlaceSuggestion) => {
    const point = { latitude: place.latitude, longitude: place.longitude };
    const label = place.label + (place.subtitle ? `, ${place.subtitle}` : '');
    fillSlot(activeSlot, point, label);
    void rememberAddress(place).then(setAddressHistory);
  };

  const computeRoute = async (from: LatLng, points: LatLng[], vehicle: VehicleType, stopsN: number) => {
    setRouting(true);
    const route = await fetchDrivingRouteWaypoints([from, ...points]);
    let dKm: number;
    let dMin: number;
    let coords: LatLng[];
    if (route) {
      coords = route.coordinates;
      dKm = route.distanceKm;
      dMin = route.durationMin;
    } else {
      coords = [from, ...points];
      dKm = 0;
      for (let i = 0; i < points.length; i++) {
        const a = i === 0 ? from : points[i - 1];
        dKm += haversineKm(a, points[i]);
      }
      dKm = Number(dKm.toFixed(2));
      dMin = estimateDurationMin(dKm);
    }
    setRouteCoords(coords);
    const price = estimateFare(vehicle, dKm, dMin, stopsN);
    setDistanceKm(dKm);
    setDurationMin(dMin);
    setSuggestedPrice(price);
    setProposedPrice(String(price));
    setRouting(false);

    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 160, right: 36, bottom: 220, left: 36 },
      animated: true,
    });
  };

  useEffect(() => {
    const points = slots.map((s) => s.coord).filter((c): c is LatLng => c != null);
    if (points.length !== legMode) {
      setRouteCoords([]);
      setDistanceKm(null);
      setDurationMin(null);
      setSuggestedPrice(null);
      return;
    }
    computeRoute(pickup, points, vehicleType, intermediateCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    legMode,
    intermediateCount,
    pickup.latitude,
    pickup.longitude,
    vehicleType,
    slots.map((s) =>
      s.coord ? `${s.coord.latitude},${s.coord.longitude}` : '',
    ).join('|'),
  ]);

  const requestRide = async () => {
    if (!profile?.id) return;
    if (!allFilled || distanceKm == null || durationMin == null) {
      Alert.alert(
        'Destination',
        legMode === 1
          ? 'Sélectionnez une adresse dans la liste de recherche.'
          : `Renseignez les ${legMode} adresses (arrêts + destination).`,
      );
      return;
    }
    const points = slots.map((s) => s.coord!);
    if (!isPointInActiveZone(pickup) || points.some((p) => !isPointInActiveZone(p))) {
      Alert.alert('Hors zone', 'Course hors de la zone de service active.');
      return;
    }
    if (forThirdParty) {
      if (!passengerName.trim() || passengerPhone.trim().length < 8) {
        Alert.alert(
          'Passager',
          'Indiquez le nom et le numéro du passager pour une course tierce.',
        );
        return;
      }
    }
    const offer = Number(String(proposedPrice).replace(/\s/g, '').replace(',', '.'));
    if (!offer || offer < 500) {
      Alert.alert('Prix', 'Proposez un prix valide (minimum 500 FC).');
      return;
    }
    if (paymentMethod !== 'cash') {
      const bal = Number(profile.wallet_balance ?? 0);
      if (bal < offer) {
        Alert.alert(
          'Solde insuffisant',
          `Rechargez votre portefeuille.\nSolde : ${formatPrice(bal)} · Course : ${formatPrice(offer)}`,
        );
        setShowWallet(true);
        return;
      }
    }

    const intermediate: RideStop[] = slots.slice(0, -1).map((s) => ({
      label: s.label || 'Arrêt',
      lat: s.coord!.latitude,
      lng: s.coord!.longitude,
    }));
    const final = slots[slots.length - 1];
    const dropLabel = final.label || 'Destination';

    setLoading(true);
    const { ride, error, degraded } = await createClientRide({
      clientId: profile.id,
      vehicleType,
      pickup: {
        lat: pickup.latitude,
        lng: pickup.longitude,
        address: 'Ma position',
      },
      dropoff: {
        lat: final.coord!.latitude,
        lng: final.coord!.longitude,
        address: dropLabel,
      },
      stops: intermediate,
      forThirdParty,
      passengerName: forThirdParty
        ? passengerName.trim()
        : profile.full_name || null,
      passengerPhone: forThirdParty
        ? passengerPhone.trim()
        : profile.phone || null,
      distanceKm,
      durationMin,
      estimatedPrice: offer,
      paymentMethod,
    });
    setLoading(false);

    if (error || !ride) {
      Alert.alert('Erreur course', error || 'Échec de la commande.');
      return;
    }
    if (degraded && (intermediate.length > 0 || forThirdParty)) {
      Alert.alert(
        'Course créée',
        'Astuce : exécutez migrate-stops-third-party.sql dans Supabase pour enregistrer les arrêts / passager correctement.',
      );
    }
    await rememberActiveRide(ride.id);
    onRideCreated(ride);
  };

  const activeTitle = slotTitle(activeSlot, legMode);

  return (
    <View style={styles.root}>
      <ServiceMapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={{
          ...pickup,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
        onLongPress={(e) => {
          const coord = e.nativeEvent.coordinate;
          const label = slots[activeSlot]?.label?.trim() || activeTitle;
          fillSlot(activeSlot, coord, label);
        }}
      >
        {/* Avant commande : uniquement la position client (+ destinations choisies) */}
        <FlagMarker coordinate={pickup} title="Ma position" variant="pickup" />
        {slots.map((s, i) =>
          s.coord ? (
            <FlagMarker
              key={`slot-${i}`}
              coordinate={s.coord}
              title={slotTitle(i, legMode)}
              variant={i === slots.length - 1 ? 'finish' : 'stop'}
              badge={i === slots.length - 1 ? undefined : String(i + 1)}
            />
          ) : null,
        )}
        {routeCoords.length > 1 && (
          <Polyline coordinates={routeCoords} strokeColor={colors.yellow} strokeWidth={5} />
        )}
      </ServiceMapView>

      <View style={[styles.topSearch, { top: Math.max(insets.top, 12) + 8 }]}>
        <View style={styles.searchHeader}>
          <Text style={styles.brand}>ClickPro Drive</Text>
          <View style={styles.headerLinks}>
            <Pressable onPress={() => setShowWallet((v) => !v)} hitSlop={8}>
              <Text style={styles.link}>
                {formatPrice(Number(profile?.wallet_balance ?? 0))}
              </Text>
            </Pressable>
            <Text style={styles.linkSep}>·</Text>
            <Pressable onPress={onOpenHistory} hitSlop={8}>
              <Text style={styles.link}>Hist.</Text>
            </Pressable>
            <LogoutButton compact style={{ marginLeft: 4 }} />
          </View>
        </View>
        {showWallet && (
          <View style={styles.walletBox}>
            <Text style={styles.walletMeta}>
              Solde : {formatPrice(Number(profile?.wallet_balance ?? 0))}
            </Text>
            <PawapayTopupForm
              initialPhone={profile?.phone}
              onCredited={() => {
                void refreshProfile();
              }}
            />
          </View>
        )}

        {legMode > 1 && (
          <View style={styles.slotTabs}>
            {slots.map((s, i) => (
              <Pressable
                key={i}
                onPress={() => {
                  setActiveSlot(i);
                  setSearchText('');
                  setSuggestions([]);
                  setSearchEmpty(false);
                }}
                style={[styles.slotTab, activeSlot === i && styles.slotTabOn]}
              >
                <Text
                  style={[styles.slotTabText, activeSlot === i && styles.slotTabTextOn]}
                  numberOfLines={1}
                >
                  {s.coord ? '✓ ' : ''}
                  {slotTitle(i, legMode)}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        <View style={[styles.searchCard, searchFocused && styles.searchCardOn]}>
          <View style={styles.searchPin}>
            <View style={styles.searchPinDot} />
          </View>
          <TextInput
            ref={searchInputRef}
            placeholder={
              locReady ? 'Où allez-vous ? (quartier, marché…)' : 'Localisation…'
            }
            placeholderTextColor={colors.muted}
            value={searchText}
            onChangeText={onChangeSearch}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            style={styles.destinationInput}
            returnKeyType="search"
            autoCorrect={false}
          />
          {searching ? (
            <ActivityIndicator color={colors.yellow} size="small" />
          ) : searchText.length > 0 ? (
            <Pressable
              onPress={() => {
                clearSearch();
                searchInputRef.current?.blur();
              }}
              hitSlop={8}
              style={styles.clearBtn}
            >
              <Text style={styles.clearBtnText}>✕</Text>
            </Pressable>
          ) : null}
        </View>

        {searchFocused &&
          searchText.trim().length < 2 &&
          suggestions.length === 0 &&
          !searching &&
          !searchEmpty && (
          <View style={styles.historyBox}>
            {addressHistory.length > 0 ? (
              <>
                <View style={styles.historyHeader}>
                  <Text style={styles.historyTitle}>Récentes</Text>
                  <Pressable
                    onPress={() => {
                      void clearAddressHistory().then(() => setAddressHistory([]));
                    }}
                    hitSlop={8}
                  >
                    <Text style={styles.historyClear}>Effacer</Text>
                  </Pressable>
                </View>
                {addressHistory.slice(0, 8).map((item) => (
                  <Pressable
                    key={item.id}
                    style={styles.suggestItem}
                    onPress={() => selectPlace(item)}
                  >
                    <View style={[styles.suggestIcon, styles.historyIcon]}>
                      <Text style={styles.historyIconText}>↻</Text>
                    </View>
                    <View style={styles.suggestTextCol}>
                      <Text style={styles.suggestTitle} numberOfLines={1}>
                        {item.label}
                      </Text>
                      {!!item.subtitle && (
                        <Text style={styles.suggestSub} numberOfLines={1}>
                          {item.subtitle}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                ))}
              </>
            ) : (
              <View style={styles.searchHintBox}>
                <Text style={styles.searchHintTitle}>Tapez une adresse</Text>
                <Text style={styles.searchHintSub}>
                  Ex. : Jambo Mart, Kin marché, Gare, Kenya…
                </Text>
              </View>
            )}
          </View>
        )}

        {slots.some((s) => s.coord) && suggestions.length === 0 && !searching && (
          <View style={styles.pickedList}>
            {slots.map((s, i) =>
              s.coord ? (
                <View key={`picked-${i}`} style={styles.pickedRow}>
                  <Text style={styles.pickedBadge}>
                    {i === slots.length - 1 ? '★' : String(i + 1)}
                  </Text>
                  <Text style={styles.pickedText} numberOfLines={1}>
                    {s.label}
                  </Text>
                  <Pressable
                    onPress={() => {
                      setSlots((prev) => {
                        const next = [...prev];
                        next[i] = { label: '', coord: null };
                        return next;
                      });
                      setActiveSlot(i);
                      clearSearch();
                    }}
                    hitSlop={8}
                  >
                    <Text style={styles.pickedClear}>modifier</Text>
                  </Pressable>
                </View>
              ) : null,
            )}
          </View>
        )}

        {(suggestions.length > 0 || (searchEmpty && searchText.trim().length >= 2)) && (
          <View style={styles.suggestList}>
            {searchEmpty && suggestions.length === 0 ? (
              <View style={styles.suggestEmpty}>
                <Text style={styles.suggestEmptyTitle}>Aucun lieu trouvé</Text>
                <Text style={styles.suggestEmptySub}>
                  Essayez un autre nom (quartier, marché, avenue…)
                </Text>
              </View>
            ) : (
              <FlatList
                keyboardShouldPersistTaps="handled"
                data={suggestions}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <Pressable
                    style={styles.suggestItem}
                    onPress={() => selectPlace(item)}
                  >
                    <View style={styles.suggestIcon}>
                      <View style={styles.suggestIconDot} />
                    </View>
                    <View style={styles.suggestTextCol}>
                      <Text style={styles.suggestTitle} numberOfLines={1}>
                        {item.label}
                      </Text>
                      {!!item.subtitle && (
                        <Text style={styles.suggestSub} numberOfLines={1}>
                          {item.subtitle}
                        </Text>
                      )}
                    </View>
                  </Pressable>
                )}
              />
            )}
          </View>
        )}
      </View>

      {/* Panneau options masqué pendant la recherche d’adresse */}
      {!searchingUi && (
        <View
          style={[
            styles.sheet,
            {
              paddingBottom: Math.max(insets.bottom, 10) + 6,
              bottom: keyboardHeight > 0 ? Math.min(keyboardHeight, 280) : 0,
            },
          ]}
        >
          <View style={styles.sheetContent}>
            <View style={styles.segRow}>
              {LEG_OPTIONS.map((o) => (
                <Pressable
                  key={o.id}
                  onPress={() => changeLegMode(o.id)}
                  style={[styles.seg, legMode === o.id && styles.segOn]}
                >
                  <Text style={[styles.segText, legMode === o.id && styles.segTextOn]}>
                    {o.label}
                  </Text>
                </Pressable>
              ))}
              <View style={styles.segDivider} />
              {VEHICLE_OPTIONS.map((v) => (
                <Pressable
                  key={v.id}
                  onPress={() => setVehicleType(v.id)}
                  style={[styles.seg, vehicleType === v.id && styles.segOn]}
                >
                  <Text style={[styles.segText, vehicleType === v.id && styles.segTextOn]}>
                    {v.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.payRow}>
              {PAY_OPTIONS.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => setPaymentMethod(p.id)}
                  style={[styles.payChip, paymentMethod === p.id && styles.payOn]}
                >
                  <Text
                    style={[styles.payText, paymentMethod === p.id && styles.payTextOn]}
                  >
                    {p.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Pressable onPress={() => setForThirdParty((v) => !v)} hitSlop={6}>
              <Text style={[styles.thirdLink, forThirdParty && styles.thirdLinkOn]}>
                {forThirdParty ? '✓ Pour un tiers' : 'Pour un tiers'}
              </Text>
            </Pressable>

            {forThirdParty && (
              <View style={styles.thirdFields}>
                <TextInput
                  value={passengerName}
                  onChangeText={setPassengerName}
                  placeholder="Nom"
                  placeholderTextColor={colors.muted}
                  style={styles.thirdInput}
                />
                <TextInput
                  value={passengerPhone}
                  onChangeText={setPassengerPhone}
                  placeholder="Tél."
                  placeholderTextColor={colors.muted}
                  keyboardType="phone-pad"
                  style={styles.thirdInput}
                />
              </View>
            )}

            {suggestedPrice != null ? (
              <View style={styles.priceRow}>
                <View style={styles.priceBlock}>
                  <Text style={styles.estimate}>
                    {distanceKm?.toFixed(1)} km · ~{durationMin} min
                    {intermediateCount > 0 ? ` · ${intermediateCount + 1} arrêts` : ''}
                  </Text>
                  <TextInput
                    ref={priceInputRef}
                    value={proposedPrice}
                    onChangeText={setProposedPrice}
                    keyboardType="numeric"
                    style={styles.priceInput}
                    placeholder="Prix FC"
                    placeholderTextColor={colors.muted}
                    selectTextOnFocus
                  />
                </View>
                <PrimaryButton
                  title="Commander"
                  onPress={() => {
                    Keyboard.dismiss();
                    requestRide();
                  }}
                  loading={loading}
                  style={styles.cmdBtn}
                />
              </View>
            ) : (
              <Pressable onPress={() => searchInputRef.current?.focus()}>
                <Text style={styles.hint}>
                  {routing
                    ? 'Calcul de l’itinéraire…'
                    : legMode === 1
                      ? 'Touchez la barre du haut pour chercher une adresse'
                      : `${filledCount}/${legMode} — cherchez chaque adresse en haut`}
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  topSearch: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    gap: 6,
    zIndex: 20,
  },
  searchHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 2,
  },
  brand: { color: colors.yellow, fontWeight: '800', fontSize: 13 },
  headerLinks: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  link: { color: colors.white, fontWeight: '600', fontSize: 12 },
  linkMuted: { color: colors.muted, fontWeight: '600', fontSize: 12 },
  walletBox: {
    marginTop: 8,
    padding: 10,
    borderRadius: 10,
    backgroundColor: colors.bgPanel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: 6,
  },
  walletTitle: { color: colors.yellow, fontWeight: '800', fontSize: 13 },
  walletMeta: { color: colors.muted, fontSize: 12 },
  walletRow: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  walletInput: {
    flex: 1,
    height: 36,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    color: colors.white,
    paddingHorizontal: 8,
    fontWeight: '700',
  },
  payRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  payChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  payOn: {
    borderColor: colors.yellow,
    backgroundColor: 'rgba(255,204,0,0.12)',
  },
  payText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  payTextOn: { color: colors.yellow },
  linkSep: { color: colors.muted, fontSize: 12 },
  slotTabs: { flexDirection: 'row', gap: 4 },
  slotTab: {
    flex: 1,
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: 'rgba(18,18,18,0.85)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  slotTabOn: { borderColor: colors.yellow, backgroundColor: 'rgba(255,204,0,0.14)' },
  slotTabText: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  slotTabTextOn: { color: colors.yellow },
  searchCard: {
    backgroundColor: 'rgba(18,18,18,0.94)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 4,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  searchCardOn: {
    borderColor: colors.yellow,
    backgroundColor: 'rgba(20,20,14,0.98)',
  },
  searchHintBox: {
    backgroundColor: 'rgba(14,14,14,0.95)',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 3,
  },
  searchHintTitle: { color: colors.white, fontWeight: '700', fontSize: 13 },
  searchHintSub: { color: colors.muted, fontSize: 12 },
  historyBox: {
    backgroundColor: 'rgba(14,14,14,0.95)',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    overflow: 'hidden',
    maxHeight: 280,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
  },
  historyTitle: { color: colors.yellow, fontWeight: '800', fontSize: 12 },
  historyClear: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  historyIcon: {
    backgroundColor: 'rgba(255,204,0,0.12)',
    borderColor: colors.yellow,
  },
  historyIconText: { color: colors.yellow, fontSize: 12, fontWeight: '800' },
  searchPin: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchPinDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.yellow,
  },
  destinationInput: {
    flex: 1,
    color: colors.white,
    fontSize: 15,
    fontWeight: '600',
    paddingVertical: 9,
  },
  clearBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearBtnText: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  pickedList: {
    backgroundColor: 'rgba(18,18,18,0.9)',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingVertical: 4,
    paddingHorizontal: 8,
    gap: 2,
  },
  pickedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 5,
  },
  pickedBadge: {
    width: 16,
    textAlign: 'center',
    color: colors.yellow,
    fontSize: 12,
    fontWeight: '800',
  },
  pickedText: { flex: 1, color: colors.white, fontSize: 12, fontWeight: '600' },
  pickedClear: { color: colors.muted, fontSize: 11, fontWeight: '600' },
  suggestList: {
    maxHeight: 220,
    backgroundColor: 'rgba(14,14,14,0.97)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  suggestEmpty: { paddingHorizontal: 14, paddingVertical: 16, gap: 4 },
  suggestEmptyTitle: { color: colors.white, fontWeight: '700', fontSize: 13 },
  suggestEmptySub: { color: colors.muted, fontSize: 12, lineHeight: 16 },
  suggestItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  suggestIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.bgElevated,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  suggestIconDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.yellow,
  },
  suggestTextCol: { flex: 1, gap: 2 },
  suggestTitle: { color: colors.white, fontWeight: '700', fontSize: 14 },
  suggestSub: { color: colors.muted, fontSize: 11 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(14,14,14,0.94)',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    zIndex: 30,
  },
  sheetContent: {
    paddingHorizontal: spacing.md,
    paddingTop: 10,
    paddingBottom: 4,
    gap: 8,
  },
  segRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    alignItems: 'center',
  },
  seg: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  segOn: { backgroundColor: colors.yellow, borderColor: colors.yellow },
  segText: { color: colors.muted, fontWeight: '700', fontSize: 11 },
  segTextOn: { color: '#111' },
  segDivider: {
    width: StyleSheet.hairlineWidth,
    height: 16,
    backgroundColor: colors.border,
    marginHorizontal: 2,
  },
  thirdLink: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  thirdLinkOn: { color: colors.yellow },
  thirdFields: { flexDirection: 'row', gap: 6 },
  thirdInput: {
    flex: 1,
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 9,
    color: colors.white,
    fontSize: 13,
    paddingHorizontal: 9,
    paddingVertical: 7,
  },
  hint: { color: colors.muted, fontSize: 12, textAlign: 'center', paddingVertical: 4 },
  estimate: { color: colors.muted, fontWeight: '600', fontSize: 11, marginBottom: 4 },
  priceRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  priceBlock: { flex: 1 },
  priceInput: {
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 10,
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  cmdBtn: { width: 118 },
});

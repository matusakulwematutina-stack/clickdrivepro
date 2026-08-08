import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AdminDriversMap } from '../../components/AdminDriversMap';
import { LogoutButton } from '../../components/LogoutButton';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useAuth } from '../../context/AuthContext';
import {
  fetchAdminStats,
  fetchDriversAdmin,
  fetchProvinces,
  fetchSosAlerts,
  fetchWithdrawals,
  resetDriverPassword,
  setDriverEnabled,
  setProvinceActive,
  updateAppSettings,
  updateSosStatus,
  updateWithdrawalStatus,
  fetchAppSettings,
} from '../../lib/adminApi';
import { formatPrice } from '../../lib/geo';
import {
  clearServiceConfigCache,
  loadServiceConfig,
} from '../../lib/serviceConfig';
import { colors, spacing } from '../../lib/theme';
import {
  adminApproveTopup,
  adminMarkWithdrawalPaid,
  adminRejectTopup,
  adminWaiveRideCommission,
  adminWalletAdjust,
  fetchAdminLedger,
  fetchAdminTopups,
  fetchRecentRidesAdmin,
} from '../../lib/walletApi';
import type {
  AppSettings,
  DriverAdminRow,
  ServiceProvince,
  SosAlert,
  WalletLedgerEntry,
  WalletTopup,
  Withdrawal,
} from '../../types';

type Tab =
  | 'home'
  | 'carte'
  | 'zone'
  | 'prix'
  | 'chauffeurs'
  | 'courses'
  | 'caisse'
  | 'sos'
  | 'retraits';

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: 'Accueil' },
  { id: 'carte', label: 'Carte' },
  { id: 'zone', label: 'Zone' },
  { id: 'prix', label: 'Tarifs' },
  { id: 'chauffeurs', label: 'Chauffeurs' },
  { id: 'courses', label: 'Courses' },
  { id: 'caisse', label: 'Caisse' },
  { id: 'sos', label: 'SOS' },
  { id: 'retraits', label: 'PawaPay' },
];

type Props = { onSignOut?: () => void };

export function AdminHomeScreen(_props: Props) {
  const { profile } = useAuth();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('home');
  const [refreshing, setRefreshing] = useState(false);
  const [stats, setStats] = useState({
    driversTotal: 0,
    driversOnline: 0,
    activeRides: 0,
    openSos: 0,
    pendingWithdrawals: 0,
  });
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [provinces, setProvinces] = useState<ServiceProvince[]>([]);
  const [drivers, setDrivers] = useState<DriverAdminRow[]>([]);
  const [sos, setSos] = useState<SosAlert[]>([]);
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([]);
  const [topups, setTopups] = useState<WalletTopup[]>([]);
  const [ledger, setLedger] = useState<WalletLedgerEntry[]>([]);
  const [ridesAdmin, setRidesAdmin] = useState<
    Array<{
      id: string;
      status: string;
      estimated_price: number | null;
      final_price: number | null;
      commission_amount: number | null;
      commission_waived: boolean | null;
      dropoff_address: string | null;
      created_at: string;
    }>
  >([]);
  const [radiusDraft, setRadiusDraft] = useState('');
  const [priceTaxi, setPriceTaxi] = useState('');
  const [priceMoto, setPriceMoto] = useState('');
  const [pricePickup, setPricePickup] = useState('');
  const [baseTaxi, setBaseTaxi] = useState('');
  const [baseMoto, setBaseMoto] = useState('');
  const [basePickup, setBasePickup] = useState('');
  const [commission, setCommission] = useState('');
  const [minDriverBal, setMinDriverBal] = useState('');
  const [driverRingSec, setDriverRingSec] = useState('30');
  const [clientResponseSec, setClientResponseSec] = useState('45');
  const [searchDurationSec, setSearchDurationSec] = useState('600');
  const [dispatchRadiusKm, setDispatchRadiusKm] = useState('3');
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustProfileId, setAdjustProfileId] = useState('');
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    setRefreshing(true);
    try {
      const [st, set, prov, drv, alerts, wd, tp, lg, rd] = await Promise.all([
        fetchAdminStats(),
        fetchAppSettings(),
        fetchProvinces(),
        fetchDriversAdmin(),
        fetchSosAlerts(),
        fetchWithdrawals(),
        fetchAdminTopups(),
        fetchAdminLedger(),
        fetchRecentRidesAdmin(),
      ]);
      setStats(st);
      setSettings(set);
      setProvinces(prov);
      setDrivers(drv);
      setSos(alerts);
      setWithdrawals(wd);
      setTopups(tp);
      setLedger(lg);
      setRidesAdmin(rd as typeof ridesAdmin);
      if (set) {
        setRadiusDraft(String(set.zone_radius_km));
        setPriceTaxi(String(set.price_per_km_taxi));
        setPriceMoto(String(set.price_per_km_moto));
        setPricePickup(String(set.price_per_km_pickup));
        setBaseTaxi(String(set.base_fare_taxi));
        setBaseMoto(String(set.base_fare_moto));
        setBasePickup(String(set.base_fare_pickup));
        setCommission(String(set.commission_percent));
        setMinDriverBal(String(set.min_driver_balance_fc ?? 5000));
        setDriverRingSec(String(set.driver_ring_seconds ?? 30));
        setClientResponseSec(String(set.client_response_seconds ?? 45));
        setSearchDurationSec(String(set.search_duration_seconds ?? 600));
        setDispatchRadiusKm(String(set.dispatch_radius_km ?? 3));
      }
      clearServiceConfigCache();
      await loadServiceConfig(true);
    } catch (e) {
      Alert.alert('Admin', e instanceof Error ? e.message : 'Erreur chargement');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const savePricing = async () => {
    setSaving(true);
    try {
      const next = await updateAppSettings({
        price_per_km_taxi: Number(priceTaxi),
        price_per_km_moto: Number(priceMoto),
        price_per_km_pickup: Number(pricePickup),
        base_fare_taxi: Number(baseTaxi),
        base_fare_moto: Number(baseMoto),
        base_fare_pickup: Number(basePickup),
        commission_percent: Number(commission),
        min_driver_balance_fc: Number(minDriverBal),
        driver_ring_seconds: Number(driverRingSec),
        client_response_seconds: Number(clientResponseSec),
        search_duration_seconds: Number(searchDurationSec),
        dispatch_radius_km: Number(dispatchRadiusKm),
      });
      setSettings(next);
      clearServiceConfigCache();
      await loadServiceConfig(true);
      Alert.alert(
        'OK',
        `Tarifs + dispatch enregistrés.\nRayon chauff.–client ${dispatchRadiusKm} km · Sonnerie ${driverRingSec}s · Réponse client ${clientResponseSec}s`,
      );
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Échec');
    } finally {
      setSaving(false);
    }
  };

  const saveRadius = async () => {
    setSaving(true);
    try {
      const next = await updateAppSettings({
        zone_radius_km: Number(radiusDraft),
      });
      setSettings(next);
      clearServiceConfigCache();
      await loadServiceConfig(true);
      Alert.alert('OK', `Rayon zone : ${radiusDraft} km — appliqué sur la carte & recherche`);
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Échec');
    } finally {
      setSaving(false);
    }
  };

  const activateProvince = async (code: string) => {
    setSaving(true);
    try {
      const p = provinces.find((x) => x.code === code);
      const next = await setProvinceActive(
        code,
        p ? Number(p.default_radius_km) : Number(radiusDraft) || 60,
      );
      setSettings(next);
      setRadiusDraft(String(next.zone_radius_km));
      const prov = await fetchProvinces();
      setProvinces(prov);
      clearServiceConfigCache();
      await loadServiceConfig(true);
      Alert.alert(
        'Zone',
        `Province active : ${p?.name || code}\nRayon ${next.zone_radius_km} km — appliqué clients & chauffeurs`,
      );
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Échec');
    } finally {
      setSaving(false);
    }
  };

  const toggleCommission = async (enabled: boolean) => {
    try {
      const next = await updateAppSettings({ commission_enabled: enabled });
      setSettings(next);
      clearServiceConfigCache();
      await loadServiceConfig(true);
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Échec');
    }
  };

  const togglePawapay = async (enabled: boolean) => {
    try {
      const next = await updateAppSettings({ pawapay_enabled: enabled });
      setSettings(next);
      clearServiceConfigCache();
      await loadServiceConfig(true);
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Échec');
    }
  };

  const onToggleDriver = (d: DriverAdminRow, enabled: boolean) => {
    Alert.alert(
      enabled ? 'Activer' : 'Désactiver',
      `${d.profiles?.full_name || 'Chauffeur'} — continuer ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Oui',
          onPress: async () => {
            try {
              await setDriverEnabled(d.id, enabled);
              await reload();
            } catch (e) {
              Alert.alert('Erreur', e instanceof Error ? e.message : 'Échec');
            }
          },
        },
      ],
    );
  };

  const onResetPassword = (d: DriverAdminRow) => {
    const fallback = `Click${Math.floor(1000 + Math.random() * 9000)}`;
    Alert.alert(
      'Réinit. mot de passe',
      `${d.profiles?.full_name || 'Chauffeur'}\n\nMot de passe temporaire :\n${fallback}\n\nCommuniquez-le au chauffeur.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Confirmer',
          onPress: async () => {
            try {
              await resetDriverPassword(d.profile_id, fallback);
              Alert.alert('OK', `Mot de passe : ${fallback}`);
            } catch (e) {
              Alert.alert('Erreur', e instanceof Error ? e.message : 'Échec');
            }
          },
        },
      ],
    );
  };

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top, 10) }]}>
      <View style={styles.header}>
        <View>
          <Text style={styles.brand}>ClickPro Admin</Text>
          <Text style={styles.sub}>{profile?.full_name || 'Administrateur'}</Text>
        </View>
        <LogoutButton />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabs}
        contentContainerStyle={{ gap: 6, paddingHorizontal: spacing.md }}
      >
        {TABS.map((t) => (
          <Pressable
            key={t.id}
            onPress={() => setTab(t.id)}
            style={[styles.tab, tab === t.id && styles.tabOn]}
          >
            <Text style={[styles.tabText, tab === t.id && styles.tabTextOn]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView
        style={styles.body}
        contentContainerStyle={{
          padding: spacing.md,
          paddingBottom: Math.max(insets.bottom, 16) + 20,
          gap: 10,
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={reload} tintColor={colors.yellow} />
        }
      >
        {tab === 'home' && (
          <>
            <View style={styles.statGrid}>
              <Stat label="Chauffeurs" value={String(stats.driversTotal)} />
              <Stat label="En ligne" value={String(stats.driversOnline)} />
              <Stat label="Courses" value={String(stats.activeRides)} />
              <Stat label="SOS ouverts" value={String(stats.openSos)} warn={stats.openSos > 0} />
              <Stat
                label="Retraits"
                value={String(stats.pendingWithdrawals)}
                warn={stats.pendingWithdrawals > 0}
              />
              <Stat
                label="Province"
                value={settings?.active_province_code || '—'}
              />
            </View>
            <Text style={styles.hint}>
              Zone : {settings?.active_province_code || '—'} ·{' '}
              {settings?.zone_radius_km ?? '—'} km · Taxi{' '}
              {settings?.base_fare_taxi}/{settings?.price_per_km_taxi}/km ·
              Commission{' '}
              {settings?.commission_enabled
                ? `${settings.commission_percent}%`
                : 'off'}{' '}
              · Solde min chauffeur {settings?.min_driver_balance_fc ?? '—'} FC
            </Text>
            <Text style={styles.hint}>
              Ces valeurs s’appliquent aux clients et chauffeurs après
              enregistrement (rechargez l’app si besoin).
            </Text>
          </>
        )}

        {tab === 'carte' && (
          <>
            <Text style={styles.sectionTitle}>Chauffeurs sur la carte</Text>
            <Text style={styles.hint}>
              Vert = en ligne · Jaune = en course · Gris = hors ligne · Rouge =
              bloqué. Mise à jour en direct.
            </Text>
            <AdminDriversMap
              drivers={drivers}
              height={420}
              onDriversPatch={setDrivers}
            />
          </>
        )}

        {tab === 'zone' && (
          <>
            <Text style={styles.sectionTitle}>Province de navigation (RDC)</Text>
            <Text style={styles.hint}>
              Choisissez la province où ClickPro Drive opère, puis réglez le rayon.
            </Text>
            {provinces.map((p) => (
              <Pressable
                key={p.code}
                style={[
                  styles.card,
                  (settings?.active_province_code === p.code || p.is_active) &&
                    styles.cardOn,
                ]}
                onPress={() => activateProvince(p.code)}
              >
                <Text style={styles.cardTitle}>{p.name}</Text>
                <Text style={styles.cardMeta}>
                  {p.code} · rayon défaut {p.default_radius_km} km
                  {settings?.active_province_code === p.code ? ' · ACTIVE' : ''}
                </Text>
              </Pressable>
            ))}
            <Text style={styles.sectionTitle}>Rayon zone (km)</Text>
            <View style={styles.row}>
              <TextInput
                value={radiusDraft}
                onChangeText={setRadiusDraft}
                keyboardType="numeric"
                style={styles.input}
                placeholder="60"
                placeholderTextColor={colors.muted}
              />
              <PrimaryButton title="Sauver" onPress={saveRadius} loading={saving} style={{ width: 100 }} />
            </View>
          </>
        )}

        {tab === 'prix' && (
          <>
            <Text style={styles.sectionTitle}>Prix de base (FC)</Text>
            <Field label="Base taxi" value={baseTaxi} onChange={setBaseTaxi} />
            <Field label="Base moto" value={baseMoto} onChange={setBaseMoto} />
            <Field label="Base pickup" value={basePickup} onChange={setBasePickup} />
            <Text style={styles.sectionTitle}>Prix par kilomètre (FC)</Text>
            <Field label="Taxi / km" value={priceTaxi} onChange={setPriceTaxi} />
            <Field label="Moto / km" value={priceMoto} onChange={setPriceMoto} />
            <Field label="Pickup / km" value={pricePickup} onChange={setPricePickup} />
            <Text style={styles.sectionTitle}>Commission par course</Text>
            <Field label="Pourcentage %" value={commission} onChange={setCommission} />
            <Field
              label="Solde min. chauffeur (FC)"
              value={minDriverBal}
              onChange={setMinDriverBal}
            />
            <Text style={styles.sectionTitle}>Dispatch (1 chauffeur à la fois)</Text>
            <Text style={styles.hint}>
              L’appel sonne d’abord chez le plus proche (dans le rayon), puis le suivant.
              Défaut recommandé : 2–3 km.
            </Text>
            <Field
              label="Distance max chauffeur–client (km)"
              value={dispatchRadiusKm}
              onChange={setDispatchRadiusKm}
            />
            <Field
              label="Sonnerie chez le chauffeur (sec)"
              value={driverRingSec}
              onChange={setDriverRingSec}
            />
            <Field
              label="Temps de réponse client (sec)"
              value={clientResponseSec}
              onChange={setClientResponseSec}
            />
            <Field
              label="Durée totale recherche (sec)"
              value={searchDurationSec}
              onChange={setSearchDurationSec}
            />
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>Commission activée</Text>
              <Switch
                value={!!settings?.commission_enabled}
                onValueChange={toggleCommission}
                trackColor={{ false: '#333', true: colors.yellowDim }}
                thumbColor={settings?.commission_enabled ? colors.yellow : '#888'}
              />
            </View>
            <PrimaryButton title="Enregistrer tarifs" onPress={savePricing} loading={saving} />
          </>
        )}

        {tab === 'chauffeurs' && (
          <>
            <Text style={styles.sectionTitle}>
              Suivi chauffeurs ({drivers.length})
            </Text>
            <AdminDriversMap
              drivers={drivers}
              height={260}
              onDriversPatch={setDrivers}
            />
            {drivers.map((d) => (
              <View key={d.id} style={styles.card}>
                <Text style={styles.cardTitle}>
                  {d.profiles?.full_name || 'Chauffeur'}
                  {!d.is_enabled ? ' · BLOQUÉ' : d.is_online ? ' · EN LIGNE' : ''}
                </Text>
                <Text style={styles.cardMeta}>
                  {d.profiles?.phone || '—'} · {d.vehicle_type} · {d.plate_number || 'N/A'}
                </Text>
                <Text style={styles.cardMeta}>
                  {[d.vehicle_brand, d.vehicle_model, d.vehicle_color]
                    .filter(Boolean)
                    .join(' · ') || 'Véhicule non renseigné'}
                </Text>
                <Text style={styles.cardMeta}>
                  Permis : {d.license_number || '—'} · Bord :{' '}
                  {d.board_document_ref || '—'}
                </Text>
                <Text style={styles.cardMeta}>
                  Solde : {formatPrice(Number(d.wallet_balance || 0))}
                  {d.lat != null ? ` · GPS ${d.lat.toFixed(3)}, ${d.lng?.toFixed(3)}` : ' · GPS off'}
                </Text>
                <View style={styles.row}>
                  <PrimaryButton
                    title={d.is_enabled ? 'Désactiver' : 'Activer'}
                    variant={d.is_enabled ? 'ghost' : 'primary'}
                    onPress={() => onToggleDriver(d, !d.is_enabled)}
                    style={{ flex: 1 }}
                  />
                  <PrimaryButton
                    title="Reset MDP"
                    variant="ghost"
                    onPress={() => onResetPassword(d)}
                    style={{ flex: 1 }}
                  />
                </View>
                <PrimaryButton
                  title="Crédit rapide +5000"
                  variant="ghost"
                  onPress={async () => {
                    try {
                      await adminWalletAdjust({
                        profileId: d.profile_id,
                        driverId: d.id,
                        direction: 'in',
                        amountFc: 5000,
                        note: 'Crédit admin rapide',
                      });
                      reload();
                    } catch (e) {
                      Alert.alert('Erreur', e instanceof Error ? e.message : 'Échec');
                    }
                  }}
                />
              </View>
            ))}
            {drivers.length === 0 && (
              <Text style={styles.hint}>Aucun chauffeur pour le moment.</Text>
            )}
          </>
        )}

        {tab === 'courses' && (
          <>
            <Text style={styles.sectionTitle}>Courses — sans commission</Text>
            <Text style={styles.hint}>
              Marquez une course comme sans commission (ex. promo / VIP).
            </Text>
            {ridesAdmin.map((r) => (
              <View key={r.id} style={styles.card}>
                <Text style={styles.cardTitle}>
                  {r.status} ·{' '}
                  {formatPrice(Number(r.final_price ?? r.estimated_price ?? 0))}
                  {r.commission_waived ? ' · SANS COMM.' : ''}
                </Text>
                <Text style={styles.cardMeta} numberOfLines={2}>
                  {r.dropoff_address || r.id}
                </Text>
                <Text style={styles.cardMeta}>
                  Comm. : {formatPrice(Number(r.commission_amount || 0))} ·{' '}
                  {new Date(r.created_at).toLocaleString('fr-FR')}
                </Text>
                {!r.commission_waived && (
                  <PrimaryButton
                    title="Sans commission"
                    variant="ghost"
                    onPress={async () => {
                      try {
                        await adminWaiveRideCommission(r.id);
                        reload();
                      } catch (e) {
                        Alert.alert(
                          'Erreur',
                          e instanceof Error ? e.message : 'Échec',
                        );
                      }
                    }}
                  />
                )}
              </View>
            ))}
            {ridesAdmin.length === 0 && (
              <Text style={styles.hint}>Aucune course récente.</Text>
            )}
          </>
        )}

        {tab === 'caisse' && (
          <>
            <Text style={styles.sectionTitle}>Recharges en attente</Text>
            {topups
              .filter((t) => t.status === 'pending')
              .map((t) => (
                <View key={t.id} style={styles.card}>
                  <Text style={styles.cardTitle}>
                    {formatPrice(Number(t.amount_fc))} ·{' '}
                    {t.profiles?.full_name || 'Compte'}
                  </Text>
                  <Text style={styles.cardMeta}>
                    {t.profiles?.role || '—'} · {t.phone || t.profiles?.phone || '—'} ·{' '}
                    {t.provider}
                  </Text>
                  <View style={styles.row}>
                    <PrimaryButton
                      title="Créditer"
                      onPress={async () => {
                        try {
                          await adminApproveTopup(t.id);
                          reload();
                        } catch (e) {
                          Alert.alert(
                            'Erreur',
                            e instanceof Error ? e.message : 'Échec',
                          );
                        }
                      }}
                      style={{ flex: 1 }}
                    />
                    <PrimaryButton
                      title="Refuser"
                      variant="ghost"
                      onPress={async () => {
                        try {
                          await adminRejectTopup(t.id);
                          reload();
                        } catch (e) {
                          Alert.alert(
                            'Erreur',
                            e instanceof Error ? e.message : 'Échec',
                          );
                        }
                      }}
                      style={{ flex: 1 }}
                    />
                  </View>
                </View>
              ))}
            {topups.filter((t) => t.status === 'pending').length === 0 && (
              <Text style={styles.hint}>Aucune recharge en attente.</Text>
            )}

            <Text style={styles.sectionTitle}>Ajustement manuel</Text>
            <Field
              label="Profile ID"
              value={adjustProfileId}
              onChange={setAdjustProfileId}
            />
            <Field label="Montant FC" value={adjustAmount} onChange={setAdjustAmount} />
            <View style={styles.row}>
              <PrimaryButton
                title="Entrée +"
                onPress={async () => {
                  try {
                    await adminWalletAdjust({
                      profileId: adjustProfileId.trim(),
                      direction: 'in',
                      amountFc: Number(adjustAmount),
                      note: 'Ajustement admin entrée',
                    });
                    setAdjustAmount('');
                    reload();
                  } catch (e) {
                    Alert.alert('Erreur', e instanceof Error ? e.message : 'Échec');
                  }
                }}
                style={{ flex: 1 }}
              />
              <PrimaryButton
                title="Sortie −"
                variant="ghost"
                onPress={async () => {
                  try {
                    await adminWalletAdjust({
                      profileId: adjustProfileId.trim(),
                      direction: 'out',
                      amountFc: Number(adjustAmount),
                      note: 'Ajustement admin sortie',
                    });
                    setAdjustAmount('');
                    reload();
                  } catch (e) {
                    Alert.alert('Erreur', e instanceof Error ? e.message : 'Échec');
                  }
                }}
                style={{ flex: 1 }}
              />
            </View>

            <Text style={styles.sectionTitle}>Mouvements (entrée / sortie)</Text>
            {ledger.map((e) => (
              <View key={e.id} style={styles.card}>
                <Text style={styles.cardTitle}>
                  {e.direction === 'in' ? '+' : '−'}
                  {formatPrice(Number(e.amount_fc))} · {e.kind}
                </Text>
                <Text style={styles.cardMeta}>
                  {e.profiles?.full_name || e.profile_id.slice(0, 8)} ·{' '}
                  {e.note || '—'}
                </Text>
                <Text style={styles.cardMeta}>
                  {new Date(e.created_at).toLocaleString('fr-FR')}
                  {e.balance_after != null
                    ? ` · solde ${formatPrice(Number(e.balance_after))}`
                    : ''}
                </Text>
              </View>
            ))}
          </>
        )}

        {tab === 'sos' && (
          <>
            <Text style={styles.sectionTitle}>Alertes SOS</Text>
            {sos.map((a) => (
              <View key={a.id} style={styles.card}>
                <Text style={styles.cardTitle}>
                  {a.status.toUpperCase()} · {a.reporter_role}
                </Text>
                <Text style={styles.cardMeta}>{a.message}</Text>
                <Text style={styles.cardMeta}>
                  {new Date(a.created_at).toLocaleString('fr-FR')}
                </Text>
                {(a.status === 'open' || a.status === 'acknowledged') && (
                  <View style={styles.row}>
                    {a.status === 'open' && (
                      <PrimaryButton
                        title="Prendre en charge"
                        onPress={async () => {
                          await updateSosStatus(a.id, 'acknowledged');
                          reload();
                        }}
                        style={{ flex: 1 }}
                      />
                    )}
                    <PrimaryButton
                      title="Clôturer"
                      variant="ghost"
                      onPress={async () => {
                        await updateSosStatus(a.id, 'resolved');
                        reload();
                      }}
                      style={{ flex: 1 }}
                    />
                  </View>
                )}
              </View>
            ))}
            {sos.length === 0 && <Text style={styles.hint}>Aucune alerte SOS.</Text>}
          </>
        )}

        {tab === 'retraits' && (
          <>
            <View style={styles.switchRow}>
              <Text style={styles.switchLabel}>PawaPay activé</Text>
              <Switch
                value={!!settings?.pawapay_enabled}
                onValueChange={togglePawapay}
                trackColor={{ false: '#333', true: colors.yellowDim }}
                thumbColor={settings?.pawapay_enabled ? colors.yellow : '#888'}
              />
            </View>
            <Text style={styles.sectionTitle}>Demandes de retrait</Text>
            {withdrawals.map((w) => (
              <View key={w.id} style={styles.card}>
                <Text style={styles.cardTitle}>
                  {formatPrice(Number(w.amount_fc))} · {w.status}
                </Text>
                <Text style={styles.cardMeta}>
                  {w.drivers?.profiles?.full_name || 'Chauffeur'} · {w.phone}
                </Text>
                <Text style={styles.cardMeta}>
                  {new Date(w.created_at).toLocaleString('fr-FR')} · {w.provider}
                </Text>
                {w.status === 'pending' && (
                  <View style={styles.row}>
                    <PrimaryButton
                      title="Approuver"
                      onPress={async () => {
                        await updateWithdrawalStatus(w.id, 'approved');
                        reload();
                      }}
                      style={{ flex: 1 }}
                    />
                    <PrimaryButton
                      title="Payé"
                      onPress={async () => {
                        try {
                          await adminMarkWithdrawalPaid(w.id, 'Payé via PawaPay');
                        } catch {
                          await updateWithdrawalStatus(
                            w.id,
                            'paid',
                            'Payé via PawaPay',
                          );
                        }
                        reload();
                      }}
                      style={{ flex: 1 }}
                    />
                    <PrimaryButton
                      title="Refuser"
                      variant="ghost"
                      onPress={async () => {
                        await updateWithdrawalStatus(w.id, 'rejected');
                        reload();
                      }}
                      style={{ flex: 1 }}
                    />
                  </View>
                )}
              </View>
            ))}
            {withdrawals.length === 0 && (
              <Text style={styles.hint}>Aucun retrait en attente.</Text>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <View style={[styles.stat, warn && styles.statWarn]}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (t: string) => void;
}) {
  const numeric = /FC|%|km|Montant|Pourcentage|Solde|Rayon|Taxi|Moto|Pickup/i.test(
    label,
  );
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        keyboardType={numeric ? 'numeric' : 'default'}
        autoCapitalize="none"
        style={styles.input}
        placeholderTextColor={colors.muted}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.md,
    paddingBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  brand: { color: colors.yellow, fontWeight: '800', fontSize: 16 },
  sub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  logout: { color: colors.muted, fontWeight: '600', fontSize: 12 },
  tabs: { maxHeight: 40, marginBottom: 4 },
  tab: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  tabOn: { backgroundColor: colors.yellow, borderColor: colors.yellow },
  tabText: { color: colors.muted, fontWeight: '700', fontSize: 12 },
  tabTextOn: { color: '#111' },
  body: { flex: 1 },
  sectionTitle: {
    color: colors.white,
    fontWeight: '800',
    fontSize: 14,
    marginTop: 4,
  },
  hint: { color: colors.muted, fontSize: 12, lineHeight: 16 },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: {
    width: '30%',
    flexGrow: 1,
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    padding: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  statWarn: { borderColor: colors.danger },
  statValue: { color: colors.yellow, fontWeight: '800', fontSize: 18 },
  statLabel: { color: colors.muted, fontSize: 11, marginTop: 2 },
  card: {
    backgroundColor: colors.bgElevated,
    borderRadius: 12,
    padding: 10,
    gap: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  cardOn: { borderColor: colors.yellow },
  cardTitle: { color: colors.white, fontWeight: '700', fontSize: 13 },
  cardMeta: { color: colors.muted, fontSize: 11 },
  row: { flexDirection: 'row', gap: 6, alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: colors.bgPanel,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 10,
    color: colors.white,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
    fontWeight: '600',
  },
  fieldLabel: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  switchRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  switchLabel: { color: colors.white, fontWeight: '600', fontSize: 13 },
});

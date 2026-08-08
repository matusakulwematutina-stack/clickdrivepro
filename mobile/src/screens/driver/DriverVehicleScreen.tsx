import React, { useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LogoutButton } from '../../components/LogoutButton';
import { PrimaryButton } from '../../components/PrimaryButton';
import { VehiclePreview } from '../../components/VehiclePreview';
import { useAuth } from '../../context/AuthContext';
import { VEHICLE_COLOR_OPTIONS } from '../../lib/vehicleColor';
import { updateDriverVehicle } from '../../lib/walletApi';
import { colors, spacing } from '../../lib/theme';
import type { VehicleType } from '../../types';

type Props = { onBack: () => void };

const VEHICLES: VehicleType[] = ['taxi', 'moto', 'pickup'];

export function DriverVehicleScreen({ onBack }: Props) {
  const { driver, refreshProfile } = useAuth();
  const insets = useSafeAreaInsets();
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [color, setColor] = useState('');
  const [plate, setPlate] = useState('');
  const [license, setLicense] = useState('');
  const [boardDoc, setBoardDoc] = useState('');
  const [vehicleType, setVehicleType] = useState<VehicleType>('taxi');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!driver) return;
    setBrand(driver.vehicle_brand || '');
    setModel(driver.vehicle_model || '');
    setColor(driver.vehicle_color || '');
    setPlate(driver.plate_number || '');
    setLicense(driver.license_number || '');
    setBoardDoc(driver.board_document_ref || '');
    setVehicleType(driver.vehicle_type || 'taxi');
  }, [driver]);

  const save = async () => {
    if (!driver?.id) return;
    if (!plate.trim()) {
      Alert.alert('Véhicule', 'La plaque est obligatoire.');
      return;
    }
    setSaving(true);
    try {
      await updateDriverVehicle(driver.id, {
        vehicle_brand: brand.trim() || null,
        vehicle_model: model.trim() || null,
        vehicle_color: color.trim() || null,
        plate_number: plate.trim(),
        license_number: license.trim() || null,
        board_document_ref: boardDoc.trim() || null,
        vehicle_type: vehicleType,
      });
      await refreshProfile();
      Alert.alert('OK', 'Profil véhicule enregistré.');
    } catch (e) {
      Alert.alert('Erreur', e instanceof Error ? e.message : 'Échec');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: Math.max(insets.top, 12) }]}>
      <View style={styles.header}>
        <Text style={styles.back} onPress={onBack}>
          ← Retour
        </Text>
        <LogoutButton compact />
      </View>
      <Text style={styles.title}>Profil véhicule</Text>
      <ScrollView
        contentContainerStyle={{
          padding: spacing.md,
          gap: 10,
          paddingBottom: Math.max(insets.bottom, 16) + 20,
        }}
      >
        <Text style={styles.hint}>
          Marque, modèle, couleur, plaque, permis et document de bord.
        </Text>
        <View style={styles.typeRow}>
          {VEHICLES.map((v) => (
            <Text
              key={v}
              onPress={() => setVehicleType(v)}
              style={[styles.typeChip, vehicleType === v && styles.typeOn]}
            >
              {v}
            </Text>
          ))}
        </View>

        <View style={styles.previewBox}>
          <VehiclePreview
            vehicleType={vehicleType}
            vehicleColor={color || 'Jaune'}
            size={96}
          />
          <Text style={styles.previewLabel}>
            Aperçu carte · {color.trim() || 'Jaune'}
          </Text>
        </View>

        <Field label="Marque" value={brand} onChange={setBrand} placeholder="Toyota" />
        <Field label="Modèle" value={model} onChange={setModel} placeholder="Corolla" />
        <Text style={styles.label}>Couleur (alignée sur la carte)</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.colorScroll}
        >
          {VEHICLE_COLOR_OPTIONS.map((c) => {
            const on = color.trim().toLowerCase() === c.value.toLowerCase();
            return (
              <Pressable
                key={c.value}
                onPress={() => setColor(c.value)}
                style={[styles.carChip, on && styles.carChipOn]}
              >
                <VehiclePreview
                  vehicleType={vehicleType}
                  vehicleColor={c.value}
                  size={56}
                />
                <Text style={[styles.colorText, on && styles.colorTextOn]}>
                  {c.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Field
          label="Couleur (autre)"
          value={color}
          onChange={setColor}
          placeholder="Blanc, Rouge…"
        />
        <Field label="Plaque" value={plate} onChange={setPlate} placeholder="AB1234CD" />
        <Field
          label="Permis de conduire"
          value={license}
          onChange={setLicense}
          placeholder="N° permis"
        />
        <Field
          label="Document de bord"
          value={boardDoc}
          onChange={setBoardDoc}
          placeholder="Carte rose / assurance / contrôle…"
        />
        <Text style={styles.hint}>
          La voiture sur la carte (vous + client) prend exactement cette couleur.
        </Text>
        <PrimaryButton title="Enregistrer" onPress={save} loading={saving} />
      </ScrollView>
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (t: string) => void;
  placeholder?: string;
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  back: { color: colors.yellow, fontWeight: '700', fontSize: 14 },
  title: {
    color: colors.white,
    fontWeight: '900',
    fontSize: 22,
    paddingHorizontal: spacing.md,
    marginTop: 8,
  },
  hint: { color: colors.muted, fontSize: 12 },
  typeRow: { flexDirection: 'row', gap: 8 },
  typeChip: {
    color: colors.muted,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    textTransform: 'capitalize',
    overflow: 'hidden',
  },
  typeOn: {
    color: colors.yellow,
    borderColor: colors.yellow,
    backgroundColor: 'rgba(255,204,0,0.12)',
    fontWeight: '800',
  },
  label: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  previewBox: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.bgElevated,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    gap: 4,
  },
  previewLabel: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  colorScroll: { gap: 8, paddingVertical: 4, paddingRight: 8 },
  carChip: {
    width: 76,
    alignItems: 'center',
    gap: 2,
    paddingVertical: 6,
    paddingHorizontal: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  carChipOn: {
    borderColor: colors.yellow,
    backgroundColor: 'rgba(255,204,0,0.14)',
  },
  colorText: { color: colors.muted, fontSize: 10, fontWeight: '700' },
  colorTextOn: { color: colors.yellow },
  input: {
    height: 42,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    color: colors.white,
    paddingHorizontal: 12,
    fontWeight: '600',
  },
});

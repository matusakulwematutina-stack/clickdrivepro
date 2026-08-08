import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { PrimaryButton } from '../components/PrimaryButton';
import { TextField } from '../components/TextField';
import { useAuth } from '../context/AuthContext';
import { isValidPhone, normalizePhone } from '../lib/phone';
import { colors, radii, spacing } from '../lib/theme';
import type { UserRole, VehicleType } from '../types';

type Props = {
  mode: 'login' | 'register';
  onBack: () => void;
  onSwitch: () => void;
};

export function AuthScreen({ mode, onBack, onSwitch }: Props) {
  const { signInWithPhone, signUpWithPhone, lookupPhone } = useAuth();
  const [phone, setPhone] = useState('+243');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<UserRole>('client');
  const [vehicleType, setVehicleType] = useState<VehicleType>('taxi');
  const [plateNumber, setPlateNumber] = useState('');
  const [loading, setLoading] = useState(false);
  const [existingHint, setExistingHint] = useState<string | null>(null);

  const onPhoneBlur = async () => {
    if (!isValidPhone(phone)) {
      setExistingHint(null);
      return;
    }
    const found = await lookupPhone(phone);
    if (found) {
      setExistingHint(
        `Profil trouvé en base (${found.role || 'client'}${
          found.full_name ? ` · ${found.full_name}` : ''
        }). ${
          mode === 'register'
            ? 'Choisissez un mot de passe pour activer ce compte.'
            : 'Connectez-vous avec votre mot de passe.'
        }`,
      );
      if (found.full_name && !fullName) setFullName(found.full_name);
      if (found.role === 'client' || found.role === 'driver') setRole(found.role);
    } else {
      setExistingHint(null);
    }
  };

  const submit = async () => {
    if (!isValidPhone(phone) || !password) {
      Alert.alert(
        'Champs requis',
        'Numéro de téléphone valide (ex: +243970000000) et mot de passe obligatoires.',
      );
      return;
    }
    if (mode === 'register' && !fullName.trim()) {
      Alert.alert('Nom requis', 'Indiquez votre nom complet.');
      return;
    }

    setLoading(true);
    const error =
      mode === 'login'
        ? await signInWithPhone(phone, password)
        : await signUpWithPhone({
            phone,
            password,
            fullName: fullName.trim(),
            role,
            vehicleType,
            plateNumber: plateNumber.trim() || undefined,
          });
    setLoading(false);
    if (error) Alert.alert('Erreur', error);
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable onPress={onBack}>
          <Text style={styles.back}>← Retour</Text>
        </Pressable>

        <Text style={styles.title}>{mode === 'login' ? 'Connexion' : 'Inscription'}</Text>
        <Text style={styles.sub}>Connectez-vous avec votre numéro</Text>

        {mode === 'register' && (
          <>
            <View style={styles.roleRow}>
              {(['client', 'driver'] as UserRole[]).map((r) => (
                <Pressable
                  key={r}
                  onPress={() => setRole(r)}
                  style={[styles.roleChip, role === r && styles.roleChipActive]}
                >
                  <Text style={[styles.roleText, role === r && styles.roleTextActive]}>
                    {r === 'client' ? 'Client' : 'Chauffeur'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <TextField label="Nom complet" value={fullName} onChangeText={setFullName} />
            {role === 'driver' && (
              <>
                <View style={styles.roleRow}>
                  {(['taxi', 'moto', 'pickup'] as VehicleType[]).map((v) => (
                    <Pressable
                      key={v}
                      onPress={() => setVehicleType(v)}
                      style={[styles.roleChip, vehicleType === v && styles.roleChipActive]}
                    >
                      <Text style={[styles.roleText, vehicleType === v && styles.roleTextActive]}>
                        {v}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <TextField
                  label="Plaque"
                  value={plateNumber}
                  onChangeText={setPlateNumber}
                  autoCapitalize="characters"
                />
              </>
            )}
          </>
        )}

        <TextField
          label="Téléphone"
          value={phone}
          onChangeText={(v) => {
            setPhone(v);
            setExistingHint(null);
          }}
          onBlur={onPhoneBlur}
          keyboardType="phone-pad"
          placeholder="+243970000000"
        />
        {!!phone && (
          <Text style={styles.normalized}>Format : {normalizePhone(phone) || '…'}</Text>
        )}
        {!!existingHint && <Text style={styles.hint}>{existingHint}</Text>}
        <TextField
          label="Mot de passe"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          keyboardType="default"
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="password"
          placeholder="Lettres et chiffres (ex: Drive2026)"
        />
        <Text style={styles.pwdHint}>Lettres, chiffres et symboles acceptés · 6 caractères min.</Text>

        <PrimaryButton
          title={mode === 'login' ? 'Entrer' : 'Créer mon compte'}
          onPress={submit}
          loading={loading}
          style={{ marginTop: 8 }}
        />

        <Pressable onPress={onSwitch} style={{ marginTop: 18 }}>
          <Text style={styles.switch}>
            {mode === 'login'
              ? "Pas encore de compte ? S'inscrire"
              : 'Déjà inscrit ? Se connecter'}
          </Text>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    padding: spacing.lg,
    paddingTop: 64,
    gap: 14,
  },
  back: { color: colors.yellow, fontWeight: '700', marginBottom: 8 },
  title: { color: colors.white, fontSize: 32, fontWeight: '900' },
  sub: { color: colors.muted, marginBottom: 8 },
  normalized: { color: colors.yellow, fontSize: 12, marginTop: -6 },
  hint: {
    color: colors.success,
    fontSize: 13,
    lineHeight: 18,
    marginTop: -4,
  },
  pwdHint: {
    color: colors.muted,
    fontSize: 12,
    marginTop: -8,
  },
  roleRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  roleChip: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radii.sm,
  },
  roleChipActive: {
    backgroundColor: colors.yellow,
    borderColor: colors.yellow,
  },
  roleText: { color: colors.white, fontWeight: '700', textTransform: 'capitalize' },
  roleTextActive: { color: '#111' },
  switch: { color: colors.muted, textAlign: 'center', fontWeight: '600' },
});

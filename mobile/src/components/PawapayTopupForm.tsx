import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  checkPawapayDeposit,
  minAmountForOperator,
  PAWAPAY_PROVIDERS,
  predictProviderFromPhone,
  startPawapayDeposit,
  waitPawapayDeposit,
  type PawapayOperator,
} from '../lib/pawapay';
import { colors } from '../lib/theme';
import { PrimaryButton } from './PrimaryButton';

type Props = {
  initialPhone?: string | null;
  onCredited?: () => void;
};

export function PawapayTopupForm({ initialPhone, onCredited }: Props) {
  const [phone, setPhone] = useState(initialPhone || '');
  const [amount, setAmount] = useState('');
  const [provider, setProvider] = useState<PawapayOperator>(
    predictProviderFromPhone(initialPhone || ''),
  );
  const [busy, setBusy] = useState(false);
  const [statusLine, setStatusLine] = useState('');

  useEffect(() => {
    if (initialPhone) {
      setPhone((p) => p || initialPhone);
      setProvider(predictProviderFromPhone(initialPhone));
    }
  }, [initialPhone]);

  const submit = async () => {
    const value = Number(String(amount).replace(/\s/g, '').replace(',', '.'));
    const minFc = minAmountForOperator(provider);
    if (!value || value < minFc) {
      Alert.alert(
        'PawaPay',
        provider === 'mpesa'
          ? `Montant minimum M-Pesa : ${minFc} FC`
          : `Montant minimum : ${minFc} FC`,
      );
      return;
    }
    if (phone.replace(/\D/g, '').length < 9) {
      Alert.alert('PawaPay', 'Indiquez le numéro Mobile Money');
      return;
    }

    setBusy(true);
    setStatusLine('Connexion à PawaPay…');
    try {
      const started = await startPawapayDeposit({
        amountFc: value,
        phone,
        provider,
      });
      if (!started.ok || !started.depositId) {
        throw new Error(started.error || 'Dépôt refusé');
      }

      Alert.alert(
        'PawaPay',
        'Validez le paiement avec votre PIN Mobile Money sur le téléphone.',
      );
      setStatusLine('En attente de validation PIN…');

      const final = await waitPawapayDeposit(started.depositId, (s) =>
        setStatusLine(`Statut PawaPay : ${s}`),
      );

      if (final.credited || final.status === 'COMPLETED') {
        setAmount('');
        setStatusLine('Solde crédité ✔');
        Alert.alert('OK', 'Recharge PawaPay réussie. Solde mis à jour.');
        onCredited?.();
      } else if (final.status === 'FAILED') {
        setStatusLine('Échec du paiement');
        Alert.alert('Échec', 'Le paiement PawaPay a échoué.');
      } else {
        setStatusLine(`En cours (${final.status || '…'}) — vous pouvez actualiser`);
        Alert.alert(
          'En cours',
          'Paiement encore en traitement. Appuyez sur « Vérifier » après validation PIN.',
        );
        // garde depositId dans statusLine pour check manuel
        setStatusLine(`deposit:${started.depositId}`);
      }
    } catch (e) {
      setStatusLine('');
      Alert.alert('PawaPay', e instanceof Error ? e.message : 'Échec');
    } finally {
      setBusy(false);
    }
  };

  const verifyPending = async () => {
    const m = statusLine.match(/deposit:([0-9a-f-]{36})/i);
    if (!m) {
      Alert.alert('PawaPay', 'Aucune recharge en attente à vérifier.');
      return;
    }
    setBusy(true);
    try {
      const r = await checkPawapayDeposit(m[1]);
      if (r.credited || r.status === 'COMPLETED') {
        setStatusLine('Solde crédité ✔');
        Alert.alert('OK', 'Recharge confirmée.');
        onCredited?.();
      } else {
        setStatusLine(`deposit:${m[1]} · ${r.status || '…'}`);
        Alert.alert('Statut', r.status || 'En cours');
      }
    } catch (e) {
      Alert.alert('PawaPay', e instanceof Error ? e.message : 'Échec');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.box}>
      <Text style={styles.title}>Recharge PawaPay</Text>
      <Text style={styles.hint}>
        Paiement direct Mobile Money (même PawaPay que Taxi des affaires).
        Min. 100 FC · M-Pesa 500 FC.
      </Text>

      <Text style={styles.label}>Opérateur</Text>
      <View style={styles.row}>
        {PAWAPAY_PROVIDERS.map((p) => (
          <Pressable
            key={p.id}
            onPress={() => setProvider(p.id)}
            style={[styles.chip, provider === p.id && styles.chipOn]}
          >
            <Text style={[styles.chipText, provider === p.id && styles.chipTextOn]}>
              {p.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Numéro Mobile Money</Text>
      <TextInput
        value={phone}
        onChangeText={(t) => {
          setPhone(t);
          setProvider(predictProviderFromPhone(t));
        }}
        keyboardType="phone-pad"
        placeholder="+243…"
        placeholderTextColor={colors.muted}
        style={styles.input}
      />

      <Text style={styles.label}>Montant (FC)</Text>
      <TextInput
        value={amount}
        onChangeText={setAmount}
        keyboardType="numeric"
        placeholder="Ex: 5000"
        placeholderTextColor={colors.muted}
        style={styles.input}
      />

      <PrimaryButton
        title="Payer avec PawaPay"
        onPress={submit}
        loading={busy}
      />

      {!!statusLine && (
        <View style={styles.statusRow}>
          {busy ? <ActivityIndicator color={colors.yellow} /> : null}
          <Text style={styles.status}>{statusLine.replace(/^deposit:[^\s]+/, 'En attente')}</Text>
        </View>
      )}

      {statusLine.startsWith('deposit:') && (
        <PrimaryButton
          title="Vérifier le paiement"
          variant="ghost"
          onPress={verifyPending}
          loading={busy}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 8 },
  title: { color: colors.yellow, fontWeight: '800', fontSize: 14 },
  hint: { color: colors.muted, fontSize: 11, lineHeight: 15 },
  label: { color: colors.yellow, fontSize: 11, fontWeight: '800' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bgElevated,
  },
  chipOn: {
    borderColor: colors.yellow,
    backgroundColor: 'rgba(255,204,0,0.14)',
  },
  chipText: { color: colors.muted, fontWeight: '700', fontSize: 11 },
  chipTextOn: { color: colors.yellow },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.yellow,
    borderRadius: 10,
    backgroundColor: colors.bgElevated,
    color: colors.white,
    fontWeight: '700',
    fontSize: 15,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  status: { color: colors.muted, fontSize: 11, flex: 1 },
});

import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase';

/** Opérateurs alignés sur Taxi des affaires / Edge Function pawapay-deposit */
export type PawapayOperator = 'airtel_money' | 'mpesa' | 'orange_money';

export const PAWAPAY_PROVIDERS: {
  id: PawapayOperator;
  label: string;
  minFc: number;
}[] = [
  { id: 'orange_money', label: 'Orange Money', minFc: 100 },
  { id: 'airtel_money', label: 'Airtel Money', minFc: 100 },
  { id: 'mpesa', label: 'M-Pesa', minFc: 500 },
];

export function predictProviderFromPhone(phone: string): PawapayOperator {
  const digits = phone.replace(/\D/g, '');
  const local = digits.startsWith('243')
    ? digits.slice(3)
    : digits.replace(/^0/, '');
  if (/^(81|82|83)/.test(local)) return 'mpesa';
  if (/^(97|99|90)/.test(local)) return 'airtel_money';
  return 'orange_money';
}

export function minAmountForOperator(op: PawapayOperator): number {
  return PAWAPAY_PROVIDERS.find((p) => p.id === op)?.minFc ?? 100;
}

export type DepositResult = {
  ok: boolean;
  depositId?: string;
  deposit_id?: string;
  topupId?: string;
  provider?: string;
  phone?: string;
  status?: string;
  message?: string;
  error?: string;
  credited?: boolean;
  topupStatus?: string;
  pawapayBody?: unknown;
  kind?: string;
};

async function readFunctionError(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = await error.context.json();
      if (body?.error) return String(body.error);
      if (body?.message) return String(body.message);
      return JSON.stringify(body);
    } catch {
      try {
        return await error.context.text();
      } catch {
        return error.message;
      }
    }
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: string }).message);
  }
  return 'Erreur Edge Function';
}

async function invokePawapay(
  name: 'pawapay-deposit' | 'pawapay-status',
  body: Record<string, unknown>,
): Promise<DepositResult> {
  const { data, error } = await supabase.functions.invoke(name, { body });

  if (error) {
    const detail = await readFunctionError(error);
    throw new Error(
      detail.includes('Failed to send') || detail.includes('not found')
        ? `${detail}\nDéployez: .\\scripts\\deploy-pawapay.ps1 -SetSecrets`
        : detail,
    );
  }

  const result = (data || {}) as DepositResult;
  if ((result.ok === false || result.error) && !result.depositId && !result.deposit_id) {
    throw new Error(result.error || 'Échec PawaPay');
  }
  // Normalise depositId (contrat Taxi = deposit_id)
  if (!result.depositId && result.deposit_id) {
    result.depositId = result.deposit_id;
  }
  return result;
}

/** Lance un dépôt PawaPay (PIN sur le téléphone) — contrat Taxi des affaires. */
export async function startPawapayDeposit(input: {
  amountFc: number;
  phone: string;
  provider?: PawapayOperator;
}): Promise<DepositResult> {
  const operator = input.provider || predictProviderFromPhone(input.phone);
  return invokePawapay('pawapay-deposit', {
    amount_cents: Math.round(input.amountFc),
    phone: input.phone,
    payer_phone: input.phone,
    operator,
  });
}

/** Vérifie le statut et crédite le solde ClickPro si COMPLETED. */
export async function checkPawapayDeposit(
  depositId: string,
): Promise<DepositResult> {
  return invokePawapay('pawapay-status', { depositId });
}

/** Poll jusqu’à COMPLETED / FAILED (max ~2 min). */
export async function waitPawapayDeposit(
  depositId: string,
  onTick?: (status: string) => void,
): Promise<DepositResult> {
  const delays = [3000, 4000, 5000, 6000, 8000, 10000, 12000, 15000, 15000];
  let last: DepositResult = { ok: true, status: 'ACCEPTED' };
  for (const ms of delays) {
    await new Promise((r) => setTimeout(r, ms));
    last = await checkPawapayDeposit(depositId);
    onTick?.(last.status || '…');
    if (last.status === 'COMPLETED' || last.credited) return last;
    if (last.status === 'FAILED') return last;
  }
  return last;
}

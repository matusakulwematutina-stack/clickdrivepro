/**
 * Helpers PawaPay RDC (COD) — alignés sur Taxi des affaires.
 * Doc: https://docs.pawapay.io/v2/docs/providers
 */

export type MmOperator = 'airtel_money' | 'mpesa' | 'orange_money';

export const PROVIDER_MAP: Record<MmOperator, string> = {
  airtel_money: 'AIRTEL_COD',
  mpesa: 'VODACOM_MPESA_COD',
  orange_money: 'ORANGE_COD',
};

const AMOUNT_DECIMALS: Record<MmOperator, number> = {
  airtel_money: 2,
  mpesa: 0,
  orange_money: 2,
};

export const DEPOSIT_MIN_CDF: Record<MmOperator, number> = {
  airtel_money: 100,
  mpesa: 500,
  orange_money: 100,
};

export function isValidOperator(op: string): op is MmOperator {
  return op in PROVIDER_MAP;
}

export function normalizePhone(raw: string): string {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('0') && digits.length >= 9) {
    digits = `243${digits.slice(1)}`;
  }
  if (digits.length === 9) digits = `243${digits}`;
  return digits;
}

export function formatAmountCdf(cents: number, operator: MmOperator): string {
  const n = Math.round(cents);
  return AMOUNT_DECIMALS[operator] === 2 ? n.toFixed(2) : String(n);
}

export function failureMessage(
  pp: Record<string, unknown>,
  fallback = 'PawaPay a rejeté l’opération',
): string {
  const fr = pp.failureReason as Record<string, unknown> | undefined;
  const code = String(fr?.failureCode ?? pp.failureCode ?? '').trim();
  const msg = String(fr?.failureMessage ?? pp.failureMessage ?? '').trim();

  switch (code) {
    case 'AUTHENTICATION_ERROR':
    case 'NO_AUTHENTICATION':
      return 'Token API PawaPay invalide ou manquant.';
    case 'AUTHORISATION_ERROR':
      return 'Token PawaPay non autorisé pour cette opération.';
    case 'DEPOSITS_NOT_ALLOWED':
      return 'Dépôts non activés sur le compte PawaPay pour cet opérateur.';
    case 'AMOUNT_OUT_OF_BOUNDS':
      return msg ||
        'Montant hors limites pour cet opérateur (ex. M-Pesa dépôt min. 500 FC).';
    case 'INVALID_AMOUNT':
      return 'Format de montant invalide pour cet opérateur.';
    case 'INVALID_PHONE_NUMBER':
      return 'Numéro Mobile Money invalide (format MSISDN 243…).';
    case 'PAYER_NOT_FOUND':
      return 'Ce numéro n’appartient pas à l’opérateur choisi.';
    case 'PAYMENT_NOT_APPROVED':
      return 'Paiement non approuvé (PIN non saisi ou refusé).';
    case 'INSUFFICIENT_BALANCE':
      return 'Solde Mobile Money client insuffisant.';
    case 'PROVIDER_TEMPORARILY_UNAVAILABLE':
      return 'Opérateur temporairement indisponible. Réessaie plus tard.';
    default:
      break;
  }
  if (code && msg) return `${code}: ${msg}`;
  if (msg) return msg;
  if (code) return code;
  return fallback;
}

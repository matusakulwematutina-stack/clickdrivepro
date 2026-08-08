/** Normalise un numéro RDC / international pour login. */
export function normalizePhone(input: string): string {
  let raw = input.trim().replace(/[\s\-().]/g, '');
  if (!raw) return '';

  if (raw.startsWith('00')) raw = `+${raw.slice(2)}`;
  if (raw.startsWith('+')) {
    return `+${raw.slice(1).replace(/\D/g, '')}`;
  }

  const digits = raw.replace(/\D/g, '');
  // Local Congo : 099... → +24399...
  if (digits.startsWith('0') && digits.length >= 9) {
    return `+243${digits.slice(1)}`;
  }
  if (digits.startsWith('243')) {
    return `+${digits}`;
  }
  return `+${digits}`;
}

/** Email technique Supabase dérivé du téléphone (auth email/password). */
export function phoneToAuthEmail(phone: string): string {
  const normalized = normalizePhone(phone).replace(/\+/g, '');
  // Domaine déjà utilisé en base pour les comptes existants
  return `${normalized}@phone.clickdrive.app`;
}

/** Variantes d'email à tenter (anciens + nouveaux comptes). */
export function phoneAuthEmails(phone: string): string[] {
  const digits = normalizePhone(phone).replace(/\+/g, '');
  return [
    `${digits}@phone.clickdrive.app`,
    `${digits}@phone.clickpro.drive`,
  ];
}

export function isValidPhone(phone: string): boolean {
  const n = normalizePhone(phone);
  return /^\+\d{8,15}$/.test(n);
}

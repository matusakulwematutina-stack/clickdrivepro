/** Résout une couleur saisie (FR/EN/hex) en code hex pour la carte. */
const NAMED: Record<string, string> = {
  blanc: '#EEEEEE',
  blanche: '#EEEEEE',
  white: '#EEEEEE',
  noir: '#222222',
  noire: '#222222',
  black: '#222222',
  gris: '#9CA3AF',
  grise: '#9CA3AF',
  gray: '#9CA3AF',
  grey: '#9CA3AF',
  argent: '#B0B0B0',
  silver: '#B0B0B0',
  rouge: '#E53935',
  red: '#E53935',
  bleu: '#1E88E5',
  bleue: '#1E88E5',
  blue: '#1E88E5',
  vert: '#43A047',
  verte: '#43A047',
  green: '#43A047',
  jaune: '#FDD835',
  yellow: '#FDD835',
  orange: '#FB8C00',
  marron: '#6D4C41',
  brown: '#6D4C41',
  beige: '#D7CCC8',
  rose: '#EC407A',
  pink: '#EC407A',
  violet: '#8E24AA',
  purple: '#8E24AA',
  dore: '#D4AF37',
  gold: '#D4AF37',
  bordeaux: '#880E4F',
  // variantes fréquentes RDC / FR
  bleunuit: '#1565C0',
  'bleu nuit': '#1565C0',
  rougevin: '#880E4F',
  champagne: '#F7E7CE',
};

/** Couleurs avec vrai PNG taxi dédié (même style vue du dessus). */
export const VEHICLE_COLOR_OPTIONS: { label: string; value: string; hex: string }[] = [
  { label: 'Jaune', value: 'Jaune', hex: '#FDD835' },
  { label: 'Blanc', value: 'Blanc', hex: '#F5F5F5' },
  { label: 'Noir', value: 'Noir', hex: '#1A1A1A' },
  { label: 'Gris', value: 'Gris', hex: '#9CA3AF' },
  { label: 'Argent', value: 'Argent', hex: '#C0C0C0' },
  { label: 'Rouge', value: 'Rouge', hex: '#E53935' },
  { label: 'Bleu', value: 'Bleu', hex: '#1E88E5' },
  { label: 'Vert', value: 'Vert', hex: '#43A047' },
  { label: 'Orange', value: 'Orange', hex: '#FB8C00' },
  { label: 'Marron', value: 'Marron', hex: '#6D4C41' },
  { label: 'Beige', value: 'Beige', hex: '#D7CCC8' },
];

export function resolveVehicleColor(input?: string | null): string | null {
  if (!input) return null;
  const raw = input.trim();
  if (!raw) return null;
  if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(raw)) {
    return raw.length === 4
      ? `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`
      : raw;
  }
  const key = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  if (NAMED[key]) return NAMED[key];
  // "bleu nuit", "rouge métallisé" → premier mot
  const first = key.split(/[\s/-]+/)[0];
  return NAMED[first] ?? null;
}

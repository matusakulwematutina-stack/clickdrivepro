/** Affiche un ID court lisible (8 premiers caractères). */
export function shortId(id?: string | null): string {
  if (!id) return '—';
  return id.replace(/-/g, '').slice(0, 8).toUpperCase();
}

/** ID véhicule : plaque si dispo, sinon id chauffeur raccourci. */
export function vehiclePublicId(input: {
  plate?: string | null;
  driverId?: string | null;
  vehicleId?: string | null;
}): string {
  const plate = input.plate?.trim();
  if (plate && plate.toUpperCase() !== 'N/A') return plate.toUpperCase();
  if (input.vehicleId) return `VH-${shortId(input.vehicleId)}`;
  if (input.driverId) return `VH-${shortId(input.driverId)}`;
  return '—';
}

import { haversineKm } from './geo';
import {
  getServiceCenter,
  getServiceViewBox,
  isPointInActiveZone,
  loadServiceConfig,
} from './serviceConfig';

export type PlaceSuggestion = {
  id: string;
  label: string;
  subtitle: string;
  latitude: number;
  longitude: number;
};

type NominatimRow = {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  importance?: number;
  address?: {
    amenity?: string;
    shop?: string;
    building?: string;
    road?: string;
    pedestrian?: string;
    neighbourhood?: string;
    suburb?: string;
    city_district?: string;
    city?: string;
    town?: string;
    village?: string;
  };
};

/** Lieux fréquents Lubumbashi — boost si le texte correspond */
const LOCAL_POIS: PlaceSuggestion[] = [
  {
    id: 'local-jambo-mart',
    label: 'Jambo Mart',
    subtitle: 'Boulevard de la Katuba · Mampala · Lubumbashi',
    latitude: -11.6895,
    longitude: 27.4828,
  },
  {
    id: 'local-gare',
    label: 'Gare de Lubumbashi',
    subtitle: 'Centre-ville · Lubumbashi',
    latitude: -11.6645,
    longitude: 27.4794,
  },
  {
    id: 'local-aeroport',
    label: 'Aéroport international de Lubumbashi',
    subtitle: 'Luano · Lubumbashi',
    latitude: -11.5913,
    longitude: 27.5309,
  },
  {
    id: 'local-kenya',
    label: 'Marché Kenya',
    subtitle: 'Kenya · Lubumbashi',
    latitude: -11.6708,
    longitude: 27.4652,
  },
  {
    id: 'local-zoo',
    label: 'Zoo de Lubumbashi',
    subtitle: 'Lubumbashi',
    latitude: -11.6669,
    longitude: 27.4765,
  },
  {
    id: 'local-mazembe',
    label: 'Stade TP Mazembe',
    subtitle: 'Lubumbashi',
    latitude: -11.6612,
    longitude: 27.4809,
  },
];

function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Variantes de requête (market/mart, avec/sans ville) */
function queryVariants(raw: string): string[] {
  const q = raw.trim();
  const n = normalize(q);
  const variants = new Set<string>([q, `${q}, Lubumbashi`]);

  if (/\bmarket\b/i.test(q)) {
    variants.add(q.replace(/\bmarket\b/gi, 'Mart'));
    variants.add(q.replace(/\bmarket\b/gi, 'marché'));
  }
  if (/\bmart\b/i.test(q)) {
    variants.add(q.replace(/\bmart\b/gi, 'Market'));
    variants.add(q.replace(/\bmart\b/gi, 'marché'));
  }
  if (/\bmarch[eé]\b/i.test(q)) {
    variants.add(q.replace(/\bmarch[eé]\b/gi, 'Market'));
    variants.add(q.replace(/\bmarch[eé]\b/gi, 'Mart'));
  }

  // Sans "Lubumbashi" en trop si déjà présent
  for (const v of [...variants]) {
    variants.add(`${v}, RDC`);
  }

  // Toujours garder la forme normalisée courte
  if (n.length >= 2) variants.add(n);

  return [...variants].slice(0, 6);
}

function onlyInServiceArea(list: PlaceSuggestion[]): PlaceSuggestion[] {
  return list.filter((p) =>
    isPointInActiveZone({ latitude: p.latitude, longitude: p.longitude }),
  );
}

function dedupePlaces(list: PlaceSuggestion[]): PlaceSuggestion[] {
  const seen = new Set<string>();
  const out: PlaceSuggestion[] = [];
  for (const p of list) {
    const key = `${normalize(p.label)}|${p.latitude.toFixed(4)}|${p.longitude.toFixed(4)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

/** Score de pertinence : plus haut = mieux */
function relevanceScore(place: PlaceSuggestion, query: string): number {
  const q = normalize(query);
  const label = normalize(place.label);
  const sub = normalize(place.subtitle || '');
  const full = `${label} ${sub}`;
  const tokens = q.split(' ').filter((t) => t.length > 1);

  let score = 0;
  if (label === q) score += 120;
  if (label.startsWith(q)) score += 80;
  if (label.includes(q)) score += 50;
  if (full.includes(q)) score += 20;

  for (const t of tokens) {
    if (label.includes(t)) score += 18;
    else if (sub.includes(t)) score += 8;
  }

  // Synonymes market/mart/marché
  const syn =
    (/\b(jambo)\b/.test(q) && /\bjambo\b/.test(label) ? 40 : 0) +
    ((/\b(market|mart|marche)\b/.test(q) &&
      /\b(market|mart|marche)\b/.test(full))
      ? 25
      : 0);
  score += syn;

  // Plus proche du centre zone admin = léger bonus
  const dist = haversineKm(getServiceCenter(), {
    latitude: place.latitude,
    longitude: place.longitude,
  });
  score += Math.max(0, 15 - dist);

  return score;
}

function rankPlaces(list: PlaceSuggestion[], query: string): PlaceSuggestion[] {
  return [...list].sort(
    (a, b) => relevanceScore(b, query) - relevanceScore(a, query),
  );
}

function matchLocalPois(query: string): PlaceSuggestion[] {
  const q = normalize(query);
  if (q.length < 2) return [];
  return LOCAL_POIS.filter((p) => {
    if (
      !isPointInActiveZone({
        latitude: p.latitude,
        longitude: p.longitude,
      })
    ) {
      return false;
    }
    const label = normalize(p.label);
    const sub = normalize(p.subtitle);
    const tokens = q.split(' ').filter((t) => t.length > 1);
    if (label.includes(q) || q.includes(label.replace(/\s/g, ''))) return true;
    const hit = tokens.filter((t) => label.includes(t) || sub.includes(t));
    if (hit.length >= Math.min(2, tokens.length)) return true;
    if (
      tokens.includes('jambo') &&
      (label.includes('jambo') ||
        tokens.some((t) => ['market', 'mart', 'marche'].includes(t)))
    ) {
      return label.includes('jambo');
    }
    return tokens.some((t) => t.length >= 4 && label.includes(t));
  });
}

function formatNominatim(r: NominatimRow): PlaceSuggestion {
  const a = r.address || {};
  const label =
    a.amenity ||
    a.shop ||
    a.building ||
    a.road ||
    a.pedestrian ||
    r.display_name.split(',')[0]?.trim() ||
    'Lieu';

  const area = [
    a.neighbourhood || a.suburb || a.city_district,
    a.road && a.road !== label ? a.road : null,
    a.city || a.town || a.village || 'Lubumbashi',
  ]
    .filter(Boolean)
    .filter((x, i, arr) => arr.indexOf(x) === i && x !== label);

  const parts = r.display_name.split(',').map((s) => s.trim());
  const subtitle =
    area.length > 0
      ? area.slice(0, 3).join(' · ')
      : parts.slice(1, 3).join(' · ');

  return {
    id: `n-${r.place_id}`,
    label,
    subtitle,
    latitude: Number(r.lat),
    longitude: Number(r.lon),
  };
}

async function searchNominatimOnce(
  q: string,
  bounded: boolean,
): Promise<PlaceSuggestion[]> {
  const box = getServiceViewBox();
  const params = new URLSearchParams({
    q,
    format: 'json',
    addressdetails: '1',
    limit: '12',
    countrycodes: 'cd',
    'accept-language': 'fr',
    viewbox: `${box.west},${box.north},${box.east},${box.south}`,
  });
  if (bounded) params.set('bounded', '1');

  const res = await fetch(
    `https://nominatim.openstreetmap.org/search?${params.toString()}`,
    {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ClickProDrive/1.0',
      },
    },
  );
  if (!res.ok) return [];
  const rows = (await res.json()) as NominatimRow[];
  return onlyInServiceArea(rows.map(formatNominatim));
}

async function searchNominatim(q: string): Promise<PlaceSuggestion[]> {
  const variants = queryVariants(q);
  const batches = await Promise.all(
    variants.slice(0, 3).flatMap((v) => [
      searchNominatimOnce(v, true).catch(() => [] as PlaceSuggestion[]),
      searchNominatimOnce(v, false).catch(() => [] as PlaceSuggestion[]),
    ]),
  );
  return dedupePlaces(batches.flat());
}

async function searchPhoton(q: string): Promise<PlaceSuggestion[]> {
  const variants = queryVariants(q).slice(0, 2);
  const batches = await Promise.all(
    variants.map(async (v) => {
      const params = new URLSearchParams({
        q: v,
        limit: '12',
        lang: 'fr',
      });
      const center = getServiceCenter();
      params.set('lat', String(center.latitude));
      params.set('lon', String(center.longitude));

      const res = await fetch(
        `https://photon.komoot.io/api/?${params.toString()}`,
      );
      if (!res.ok) return [] as PlaceSuggestion[];
      const json = await res.json();
      const features = (json?.features || []) as Array<{
        properties?: {
          osm_id?: number;
          name?: string;
          street?: string;
          district?: string;
          suburb?: string;
          city?: string;
        };
        geometry?: { coordinates?: [number, number] };
      }>;

      return onlyInServiceArea(
        features
          .filter((f) => f.geometry?.coordinates)
          .map((f, i) => {
            const p = f.properties || {};
            const [lng, lat] = f.geometry!.coordinates!;
            const label = p.name || p.street || 'Lieu';
            const subtitle = [
              p.street && p.street !== label ? p.street : null,
              p.district || p.suburb,
              p.city || 'Lubumbashi',
            ]
              .filter(Boolean)
              .join(' · ');
            return {
              id: `p-${p.osm_id ?? i}-${lat}-${lng}`,
              label,
              subtitle,
              latitude: lat,
              longitude: lng,
            };
          }),
      );
    }),
  );
  return dedupePlaces(batches.flat());
}

/** Autocomplétion Lubumbashi — multi-sources + classement par pertinence. */
export async function searchPlaces(query: string): Promise<PlaceSuggestion[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  await loadServiceConfig();

  const local = matchLocalPois(q);

  const [nominatim, photon] = await Promise.all([
    searchNominatim(q).catch(() => [] as PlaceSuggestion[]),
    searchPhoton(q).catch(() => [] as PlaceSuggestion[]),
  ]);

  const merged = dedupePlaces([...local, ...nominatim, ...photon]);
  return rankPlaces(merged, q).slice(0, 12);
}

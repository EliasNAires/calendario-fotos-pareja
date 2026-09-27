// Modelo puro de los lugares: agrupación por radio y datos de las vistas. Sin DOM.
import { photosByDay } from './calendar.js';

const UNNAMED_PLACE = 'Lugar sin nombre';

export const mapsUrl = (lat, lng) => `https://www.google.com/maps?q=${lat},${lng}`;

const EARTH_RADIUS_METERS = 6_371_000;
const ID_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

export const hasGps = (photo) => typeof photo.lat === 'number' && typeof photo.lng === 'number';

const byTime = (a, b) => a.time.localeCompare(b.time);

/** Nombre para mostrar: el del lugar o "Lugar sin nombre". */
export const placeLabel = (place) => place.name?.trim() || UNNAMED_PLACE;

/** Distancia en metros entre dos puntos { lat, lng } (haversine). */
function distanceMeters(a, b) {
  const rad = (deg) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(h));
}

/** 'p_' + 8 caracteres aleatorios. */
function newPlaceId() {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `p_${Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join('')}`;
}

/**
 * Asigna un lugar a cada foto con GPS que todavía no tenga (o cuyo lugar no esté en el álbum), en
 * orden cronológico: el lugar más cercano dentro de `radiusMeters`, o uno nuevo con las coordenadas
 * de la foto. No modifica `album`.
 * @returns {{ newPlaces: Record<string, { name: string, lat: number, lng: number }>, assignments: Record<string, string> }}
 */
export function assignPlaces(photos, album, radiusMeters) {
  const places = { ...album.places };
  /** @type {Record<string, { name: string, lat: number, lng: number }>} */
  const newPlaces = {};
  /** @type {Record<string, string>} */
  const assignments = {};
  const pending = photos.filter((p) => hasGps(p) && !album.places[album.photos[p.id]?.placeId]);
  pending.sort(byTime);

  for (const photo of pending) {
    let nearest = null;
    let nearestDistance = Infinity;
    for (const [id, place] of Object.entries(places)) {
      const d = distanceMeters(photo, place);
      if (d < nearestDistance) [nearest, nearestDistance] = [id, d];
    }
    if (nearestDistance > radiusMeters) {
      nearest = newPlaceId();
      places[nearest] = newPlaces[nearest] = { name: '', lat: photo.lat, lng: photo.lng };
    }
    assignments[photo.id] = nearest;
  }
  return { newPlaces, assignments };
}

/**
 * Fotos agrupadas por su lugar del álbum, cada grupo ordenado por hora y los grupos con la visita
 * más reciente primero. `unlocated`: las que no tienen lugar (sin GPS).
 * @returns {{ places: { id: string, name: string, lat: number, lng: number, photos: object[] }[], unlocated: object[] }}
 */
export function placeGroups(photos, album) {
  const groups = new Map();
  const unlocated = [];
  for (const photo of [...photos].sort(byTime)) {
    const id = album.photos[photo.id]?.placeId;
    const place = album.places[id];
    if (!place) {
      unlocated.push(photo);
      continue;
    }
    if (!groups.has(id)) groups.set(id, { id, ...place, photos: [] });
    groups.get(id).photos.push(photo);
  }
  const places = [...groups.values()].sort((a, b) => byTime(b.photos.at(-1), a.photos.at(-1)));
  return { places, unlocated };
}

/** Una visita por día, la más reciente primero; cada una con sus fotos por hora. */
export function visits(photos) {
  return [...photosByDay(photos)]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, dayPhotos]) => ({ date, photos: dayPhotos }));
}

const shortMonth = new Intl.DateTimeFormat('es-AR', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const monthOf = (photo) => shortMonth.format(new Date(`${photo.time.slice(0, 7)}-01T00:00:00Z`));

/** "mar 2025 – ene 2026", o "sept 2026" si todas las fotos son del mismo mes. */
export function dateRange(photos) {
  const sorted = [...photos].sort(byTime);
  const [first, last] = [monthOf(sorted[0]), monthOf(sorted.at(-1))];
  return first === last ? first : `${first} – ${last}`;
}

/**
 * Indicador del calendario: el lugar con nombre que tiene más fotos entre `dayPhotos`
 * (a igual cantidad, el de la primera foto). Sin lugares con nombre, null.
 * @returns {{ id: string, name: string } | null}
 */
export function dayPlace(dayPhotos, album) {
  const counts = new Map();
  for (const photo of dayPhotos) {
    const id = album.photos[photo.id]?.placeId;
    if (album.places[id]?.name?.trim()) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  let best = null;
  for (const [id, count] of counts) if (!best || count > counts.get(best)) best = id;
  return best && { id: best, name: placeLabel(album.places[best]) };
}

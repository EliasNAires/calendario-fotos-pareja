// Modelo puro del visor de fotos: gestos, teclado y textos. Sin DOM.
import { mapsUrl, placeLabel, hasGps } from './places.js';

const SWIPE_THRESHOLD_PX = 50;

/**
 * Desplazamiento de un toque → 1 (siguiente), -1 (anterior) o 0. Solo cuenta si es largo y más
 * horizontal que vertical, para no robarle el gesto al scroll.
 */
export function swipeDirection(dx, dy) {
  if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) <= Math.abs(dy)) return 0;
  return dx < 0 ? 1 : -1;
}

const TEXT_FIELDS = new Set(['TEXTAREA', 'INPUT', 'SELECT']);
const ARROWS = { ArrowLeft: -1, ArrowRight: 1 };

/**
 * Tecla → 1 (siguiente), -1 (anterior) o 0, como `swipeDirection`. `target` es el elemento con el
 * foco: en un campo de texto las flechas son del cursor.
 * @param {string} key
 * @param {{ tagName: string, isContentEditable?: boolean }} target
 */
export function keyAction(key, target) {
  if (TEXT_FIELDS.has(target.tagName) || target.isContentEditable) return 0;
  return ARROWS[key] ?? 0;
}

/** Índice de la foto vecina en un día de `length` fotos. En los extremos se queda donde está. */
export function stepIndex(index, delta, length) {
  return Math.min(Math.max(index + delta, 0), length - 1);
}

/** Texto alternativo: el caption si hay; si no, "Foto del 14 de marzo a las 17:42". */
export function photoAlt(caption, dateText, hour) {
  return caption.trim() || `Foto del ${dateText} a las ${hour}`;
}

/**
 * Lugar de la foto para el visor: su lugar del álbum (lleva al detalle) si tiene uno; si no, sus
 * coordenadas en Google Maps.
 * @returns {{ label: string, placeId: string } | { label: string, href: string } | null}
 */
export function placeLink(photo, album) {
  const placeId = album.photos[photo.id]?.placeId;
  const place = album.places[placeId];
  if (place) return { label: placeLabel(place), placeId };
  if (hasGps(photo)) {
    return { label: 'Ver en el mapa', href: mapsUrl(photo.lat, photo.lng) };
  }
  return null;
}

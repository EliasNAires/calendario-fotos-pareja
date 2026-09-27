// Modelo puro del calendario: sin DOM, sin fuente de datos.
import { hashString } from './hash.js';

const pad = (n) => String(n).padStart(2, '0');

/** Fecha UTC → 'YYYY-MM-DD'. Se usa UTC para que la zona del navegador no mueva los días. */
const isoDate = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/**
 * Semanas de lunes a domingo que cubren el mes (month: 1–12).
 * @returns {{ date: string, day: number, inMonth: boolean }[][]}
 */
export function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7; // lunes = 0
  const cursor = new Date(Date.UTC(year, month - 1, 1 - offset));
  const weeks = [];
  do {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push({
        date: isoDate(cursor),
        day: cursor.getUTCDate(),
        inMonth: cursor.getUTCMonth() === month - 1,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  } while (cursor.getUTCMonth() === month - 1);
  return weeks;
}

/**
 * Agrupa por 'YYYY-MM-DD' (prefijo de `time`, que es hora local de la cámara) y ordena cada día por hora.
 * @returns {Map<string, object[]>}
 */
export function photosByDay(photos) {
  const byDay = new Map();
  for (const photo of photos) {
    const day = photo.time.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(photo);
  }
  for (const list of byDay.values()) list.sort((a, b) => a.time.localeCompare(b.time));
  return byDay;
}

/** Meses que tienen al menos una foto, en orden cronológico (month: 1–12). */
export function monthsWithPhotos(photos) {
  const keys = [...new Set(photos.map((p) => p.time.slice(0, 7)))].sort();
  return keys.map((k) => ({ year: Number(k.slice(0, 4)), month: Number(k.slice(5, 7)) }));
}

/** Rotación en grados, entre -4 y 4, derivada del id: la misma foto siempre cae igual. */
export function rotationFor(id) {
  return ((hashString(id) % 801) - 400) / 100;
}

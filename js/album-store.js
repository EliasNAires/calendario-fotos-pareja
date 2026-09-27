// AlbumStore: el álbum en memoria y su autoguardado en la fuente de datos.
// Cada setter marca su clave como modificada; al guardar se relee el remoto, se aplican
// encima solo esas claves (mergeAlbum) y se escribe.
import { emptyAlbum, mergeAlbum } from './album.js';

const DEBOUNCE_MS = 1500;
const RETRY_MS = [2000, 5000, 15000, 30000]; // la última se repite

/** @typedef {'idle' | 'saving' | 'saved' | 'error'} SaveStatus */

export function createAlbumStore(source) {
  let album = emptyAlbum();
  /** clave → revisión de su última edición */
  const dirty = new Map();
  let revision = 0;
  let timer = null;
  let saving = false;
  let failures = 0;
  /** @type {SaveStatus} */
  let status = 'idle';
  const listeners = new Set();

  const publish = (next) => {
    status = next;
    for (const listener of listeners) listener(status);
  };

  const schedule = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(save, ms);
  };

  async function save() {
    if (saving) return; // al terminar se reprograma si quedó algo
    saving = true;
    publish('saving');
    const written = new Map(dirty);
    try {
      const merged = mergeAlbum(await source.readAlbum(), album, [...written.keys()]);
      await source.writeAlbum(merged);
      // Solo se limpia lo escrito: una clave editada durante el guardado sigue sucia.
      for (const [key, rev] of written) if (dirty.get(key) === rev) dirty.delete(key);
      album = mergeAlbum(merged, album, [...dirty.keys()]);
      failures = 0;
      saving = false;
      // Si llegó otra edición mientras tanto, sigue "guardando" hasta escribirla también.
      if (dirty.size) schedule(DEBOUNCE_MS);
      else publish('saved');
    } catch (err) {
      console.error('No se pudo guardar album.json', err);
      saving = false;
      publish('error');
      schedule(RETRY_MS[Math.min(failures++, RETRY_MS.length - 1)]);
    }
  }

  const edit = (key, apply) => {
    apply();
    dirty.set(key, ++revision);
    // Con un error, el reintento ya programado se lleva también esta edición.
    if (status !== 'error') schedule(DEBOUNCE_MS);
  };

  return {
    async load() {
      album = await source.readAlbum();
    },

    get: () => album,

    /** Llama a `listener(status)` ya con el estado actual y en cada cambio. Devuelve la baja. */
    subscribe(listener) {
      listeners.add(listener);
      listener(status);
      return () => listeners.delete(listener);
    },

    hasUnsavedChanges: () => dirty.size > 0,

    setDayNote(date, note) {
      edit(`days.${date}`, () => (album.days[date] = { ...album.days[date], note }));
    },

    setCaption(fileId, caption) {
      edit(`photos.${fileId}`, () => (album.photos[fileId] = { placeId: null, ...album.photos[fileId], caption }));
    },

    setPhotoPlace(fileId, placeId) {
      edit(`photos.${fileId}`, () => (album.photos[fileId] = { caption: '', ...album.photos[fileId], placeId }));
    },

    /** Crea o actualiza un lugar: `fields` se aplica sobre lo que ya tenga ({ name, lat, lng }). */
    setPlace(placeId, fields) {
      edit(`places.${placeId}`, () => (album.places[placeId] = { ...album.places[placeId], ...fields }));
    },
  };
}

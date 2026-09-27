// Forma de album.json (ver PRD). Se agregan claves y nunca se borra nada.

export const DEFAULT_CLUSTER_RADIUS_METERS = 300;

export function emptyAlbum() {
  return {
    version: 1,
    places: {},
    days: {},
    photos: {},
    settings: { clusterRadiusMeters: DEFAULT_CLUSTER_RADIUS_METERS },
  };
}

/**
 * Aplica sobre `remote` solo las claves modificadas localmente ('days.2026-09-12', 'photos.<id>',
 * 'places.<id>' o 'settings'). En la misma clave gana `local`. No modifica los argumentos.
 */
export function mergeAlbum(remote, local, dirtyKeys) {
  const merged = structuredClone(remote);
  for (const key of dirtyKeys) {
    const dot = key.indexOf('.');
    if (dot === -1) {
      merged[key] = structuredClone(local[key]);
    } else {
      const section = key.slice(0, dot);
      merged[section] ??= {};
      merged[section][key.slice(dot + 1)] = structuredClone(local[section][key.slice(dot + 1)]);
    }
  }
  return merged;
}

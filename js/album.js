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

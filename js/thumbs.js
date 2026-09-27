// Miniaturas: una sola promesa por (id, tamaño) en memoria, y <img> polaroid con carga diferida.

export function createThumbnails(source) {
  const cache = new Map();

  const url = (photo, size) => {
    const key = `${photo.id}|${size}`;
    if (!cache.has(key)) {
      const pending = source.thumbnailUrl(photo, size);
      pending.catch(() => cache.delete(key)); // que un error no quede cacheado
      cache.set(key, pending);
    }
    return cache.get(key);
  };

  /** Crea el <img> ya; la URL llega cuando la fuente la resuelve. */
  const img = (photo, size, alt) => {
    const el = document.createElement('img');
    el.className = 'polaroid';
    el.loading = 'lazy';
    el.decoding = 'async';
    el.alt = alt;
    el.width = size;
    el.height = size;
    url(photo, size).then(
      (src) => (el.src = src),
      () => el.classList.add('is-broken'),
    );
    return el;
  };

  return { url, img };
}

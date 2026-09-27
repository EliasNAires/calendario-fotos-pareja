import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createDemoSource } from '../js/sources/demo.js';

/** Almacenamiento en memoria con la misma forma que localStorage. */
function memoryStorage() {
  const items = new Map();
  return {
    getItem: (k) => (items.has(k) ? items.get(k) : null),
    setItem: (k, v) => items.set(k, String(v)),
  };
}

const demo = (storage = memoryStorage()) => createDemoSource({ storage });

test('signIn resuelve en el acto y deja la sesión iniciada', async () => {
  const source = demo();
  assert.equal(source.isSignedIn(), false);
  await source.signIn();
  assert.equal(source.isSignedIn(), true);
});

test('listPhotos da unas 300 fotos con ids únicos repartidas en unos 14 meses', async () => {
  const photos = await demo().listPhotos();
  assert.ok(photos.length >= 280 && photos.length <= 320, `hay ${photos.length} fotos`);
  assert.equal(new Set(photos.map((p) => p.id)).size, photos.length);
  for (const p of photos) {
    assert.match(p.time, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    assert.equal(typeof p.name, 'string');
  }
  const months = new Set(photos.map((p) => p.time.slice(0, 7)));
  assert.ok(months.size >= 13 && months.size <= 15, `hay ${months.size} meses`);
  const times = photos.map((p) => p.time).sort();
  assert.ok(times.at(-1) >= '2026-09-01' && times.at(-1) <= '2026-09-27T23:59:59', 'el álbum termina en septiembre de 2026');
});

test('hay varios días con 10 o más fotos', async () => {
  const perDay = new Map();
  for (const p of await demo().listPhotos()) perDay.set(p.time.slice(0, 10), (perDay.get(p.time.slice(0, 10)) ?? 0) + 1);
  const bigDays = [...perDay.values()].filter((n) => n >= 10).length;
  assert.ok(bigDays >= 3, `hay ${bigDays} días grandes`);
});

/** Distancia en metros entre dos puntos (haversine). */
function meters(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

test('alrededor del 15% no tiene GPS y el resto cae en 5 o 6 zonas, algunas a menos de 300 m entre sí', async () => {
  const photos = await demo().listPhotos();
  const withGps = photos.filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number');
  const noGpsRate = 1 - withGps.length / photos.length;
  assert.ok(noGpsRate >= 0.1 && noGpsRate <= 0.2, `sin GPS: ${(noGpsRate * 100).toFixed(1)}%`);
  for (const p of photos.filter((p) => !withGps.includes(p))) {
    assert.ok(!('lat' in p) && !('lng' in p), 'las fotos sin GPS no traen lat/lng');
  }

  // Zonas: grupos de fotos a menos de 100 m de la primera foto del grupo.
  const zones = [];
  for (const p of withGps) {
    if (!zones.some((z) => meters(z, p) < 100)) zones.push(p);
  }
  assert.ok(zones.length >= 5 && zones.length <= 6, `hay ${zones.length} zonas`);
  const closePair = zones.some((a, i) => zones.slice(i + 1).some((b) => meters(a, b) < 300));
  assert.ok(closePair, 'algún par de zonas está a menos de 300 m');
});

test('las fotos son las mismas en cada recarga, aunque se abra otro día', async () => {
  // Las notas y captions se guardan por día y por id: si las fotos se corrieran, quedarían huérfanas.
  const openedOn = async (date) => {
    mock.timers.enable({ apis: ['Date'], now: date });
    try {
      return await demo().listPhotos();
    } finally {
      mock.timers.reset();
    }
  };
  assert.deepEqual(await openedOn(new Date(2026, 9, 28)), await openedOn(new Date(2026, 8, 27)));
});

test('thumbnailUrl da un SVG como data URL, estable por foto y de color distinto entre fotos', async () => {
  const source = demo();
  const [a, b] = await source.listPhotos();
  const urlA = await source.thumbnailUrl(a, 200);
  assert.match(urlA, /^data:image\/svg\+xml,/);
  assert.equal(await demo().thumbnailUrl(a, 200), urlA);
  assert.notEqual(await source.thumbnailUrl(b, 200), urlA);
  const svg = decodeURIComponent(urlA.slice(urlA.indexOf(',') + 1));
  assert.match(svg, /<svg[^>]*width="200"/);
});

test('readAlbum crea un álbum vacío si no hay nada guardado', async () => {
  assert.deepEqual(await demo().readAlbum(), {
    version: 1,
    places: {},
    days: {},
    photos: {},
    settings: { clusterRadiusMeters: 300 },
  });
});

test('lo que escribe writeAlbum se lee después, aun desde otra instancia (recarga)', async () => {
  const storage = memoryStorage();
  const album = await demo(storage).readAlbum();
  album.days['2026-09-12'] = { note: 'Picnic en el rosedal' };
  await demo(storage).writeAlbum(album);
  const reloaded = await demo(storage).readAlbum();
  assert.equal(reloaded.days['2026-09-12'].note, 'Picnic en el rosedal');
});

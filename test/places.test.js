import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyAlbum } from '../js/album.js';
import { assignPlaces, placeGroups, visits, dateRange, dayPlace, placeLabel } from '../js/places.js';

// La plaza y el bar de Palermo están a ~220 m; San Telmo, a varios km.
const PLAZA = { lat: -34.578, lng: -58.427 };
const BAR = { lat: -34.5795, lng: -58.4255 };
const SAN_TELMO = { lat: -34.6212, lng: -58.3731 };

const photo = (id, time, coords) => ({ id, name: `${id}.jpg`, time, ...coords });

test('dos fotos a menos de 300 m caen en el mismo lugar, creado con las coordenadas de la primera', () => {
  const photos = [photo('b', '2026-03-14T18:00:00', BAR), photo('a', '2026-03-14T17:00:00', PLAZA)];
  const { newPlaces, assignments } = assignPlaces(photos, emptyAlbum(), 300);

  const ids = Object.keys(newPlaces);
  assert.equal(ids.length, 1);
  assert.match(ids[0], /^p_[a-z0-9]{8}$/);
  assert.deepEqual(newPlaces[ids[0]], { name: '', ...PLAZA });
  assert.deepEqual(assignments, { a: ids[0], b: ids[0] });
});

test('una foto lejos de todos los lugares crea uno propio; con un radio chico, la plaza y el bar se separan', () => {
  const photos = [photo('a', '2026-03-14T17:00:00', PLAZA), photo('b', '2026-03-14T18:00:00', BAR)];
  photos.push(photo('c', '2026-04-01T12:00:00', SAN_TELMO));
  assert.equal(Object.keys(assignPlaces(photos, emptyAlbum(), 300).newPlaces).length, 2);
  assert.equal(Object.keys(assignPlaces(photos, emptyAlbum(), 100).newPlaces).length, 3);
});

test('al recargar no se recrea nada: las fotos asignadas se respetan y las nuevas van a los lugares existentes', () => {
  const album = emptyAlbum();
  album.places.p_plaza123 = { name: 'La plaza', ...PLAZA };
  album.photos.a = { caption: '', placeId: 'p_plaza123' };
  album.photos.b = { caption: 'sin lugar todavía', placeId: null };
  const photos = [photo('a', '2026-03-14T17:00:00', PLAZA), photo('b', '2026-03-15T10:00:00', BAR)];

  const { newPlaces, assignments } = assignPlaces(photos, album, 300);
  assert.deepEqual(newPlaces, {});
  assert.deepEqual(assignments, { b: 'p_plaza123' });
  assert.deepEqual(assignPlaces([photo('a', '2026-03-14T17:00:00', PLAZA)], album, 300), { newPlaces: {}, assignments: {} });
});

test('las fotos sin GPS no se asignan a ningún lugar', () => {
  assert.deepEqual(assignPlaces([photo('a', '2026-03-14T17:00:00', {})], emptyAlbum(), 300), {
    newPlaces: {},
    assignments: {},
  });
});

test('tarjetas: una por lugar con sus fotos por hora, la visita más reciente primero, y aparte las sin ubicación', () => {
  const album = emptyAlbum();
  album.places.p_plaza123 = { name: 'La plaza', ...PLAZA };
  album.places.p_telmo123 = { name: '', ...SAN_TELMO };
  album.photos.a = { caption: '', placeId: 'p_plaza123' };
  album.photos.b = { caption: '', placeId: 'p_telmo123' };
  album.photos.c = { caption: '', placeId: 'p_plaza123' };
  const photos = [
    photo('c', '2026-05-02T10:00:00', PLAZA),
    photo('a', '2025-03-14T17:00:00', PLAZA),
    photo('b', '2026-01-10T12:00:00', SAN_TELMO),
    photo('x', '2026-02-01T09:00:00', {}),
  ];

  const { places, unlocated } = placeGroups(photos, album);
  assert.deepEqual(
    places.map((g) => [g.id, g.name, g.photos.map((p) => p.id)]),
    [
      ['p_plaza123', 'La plaza', ['a', 'c']],
      ['p_telmo123', '', ['b']],
    ],
  );
  assert.deepEqual(unlocated.map((p) => p.id), ['x']);
});

test('visitas: una sección por día, la más reciente primero, cada una ordenada por hora', () => {
  const photos = [
    photo('a', '2026-03-14T17:00:00', PLAZA),
    photo('b', '2026-05-02T10:00:00', PLAZA),
    photo('c', '2026-03-14T09:00:00', PLAZA),
  ];
  assert.deepEqual(
    visits(photos).map((v) => [v.date, v.photos.map((p) => p.id)]),
    [
      ['2026-05-02', ['b']],
      ['2026-03-14', ['c', 'a']],
    ],
  );
});

test('rango de fechas: "mar 2025 – ene 2026", o un solo mes si todas son del mismo', () => {
  const at = (time) => photo(time, time, PLAZA);
  assert.equal(dateRange([at('2025-03-14T10:00:00'), at('2026-01-02T10:00:00')]), 'mar 2025 – ene 2026');
  assert.equal(dateRange([at('2026-09-01T10:00:00'), at('2026-09-27T10:00:00')]), 'sept 2026');
});

test('indicador del día: el lugar con nombre con más fotos ese día; sin lugares con nombre, ninguno', () => {
  const album = emptyAlbum();
  album.places.p_plaza123 = { name: 'La plaza', ...PLAZA };
  album.places.p_bar12345 = { name: 'El bar', ...BAR };
  album.places.p_telmo123 = { name: '', ...SAN_TELMO };
  const day = ['p_plaza123', 'p_bar12345', 'p_bar12345', 'p_telmo123', 'p_telmo123', 'p_telmo123'].map((placeId, i) => {
    album.photos[`f${i}`] = { caption: '', placeId };
    return photo(`f${i}`, `2026-03-14T1${i}:00:00`, PLAZA);
  });

  assert.deepEqual(dayPlace(day, album), { id: 'p_bar12345', name: 'El bar' });
  assert.equal(dayPlace(day.slice(3), album), null);
  assert.equal(dayPlace([photo('x', '2026-03-14T10:00:00', {})], album), null);
});

test('un nombre de solo espacios cuenta como sin nombre', () => {
  const album = emptyAlbum();
  album.places.p_plaza123 = { name: '   ', ...PLAZA };
  album.photos.a = { caption: '', placeId: 'p_plaza123' };
  assert.equal(dayPlace([photo('a', '2026-03-14T10:00:00', PLAZA)], album), null);
});

test('una foto con GPS cuyo lugar no está en el álbum se vuelve a asignar', () => {
  const album = emptyAlbum();
  album.photos.a = { caption: '', placeId: 'p_perdido1' };
  const { newPlaces, assignments } = assignPlaces([photo('a', '2026-03-14T17:00:00', PLAZA)], album, 300);
  assert.deepEqual(assignments, { a: Object.keys(newPlaces)[0] });
});

test('un lugar sin campo name cuenta como sin nombre', () => {
  const album = emptyAlbum();
  album.places.p_plaza123 = { lat: PLAZA.lat, lng: PLAZA.lng };
  album.photos.a = { caption: '', placeId: 'p_plaza123' };
  assert.equal(dayPlace([photo('a', '2026-03-14T10:00:00', PLAZA)], album), null);
  assert.equal(placeLabel(album.places.p_plaza123), 'Lugar sin nombre');
  assert.equal(placeLabel({ name: ' La plaza ', ...PLAZA }), 'La plaza');
});

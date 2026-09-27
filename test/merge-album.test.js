import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyAlbum, mergeAlbum } from '../js/album.js';

test('dos ediciones a claves distintas sobre la misma base conservan las dos', () => {
  const base = emptyAlbum();

  // El otro usuario ya guardó una nota; acá se editó un caption.
  const remote = structuredClone(base);
  remote.days['2026-09-12'] = { note: 'Picnic en el rosedal' };
  const local = structuredClone(base);
  local.photos.f1 = { caption: 'La torta', placeId: null };

  const merged = mergeAlbum(remote, local, ['photos.f1']);

  assert.deepEqual(merged.days['2026-09-12'], { note: 'Picnic en el rosedal' });
  assert.deepEqual(merged.photos.f1, { caption: 'La torta', placeId: null });
});

test('en la misma clave gana la local; las claves no tocadas quedan como en el remoto', () => {
  const remote = emptyAlbum();
  remote.days['2026-09-12'] = { note: 'Versión del otro' };
  remote.days['2026-09-13'] = { note: 'Nota nueva del otro' };
  remote.settings = { clusterRadiusMeters: 500 };
  const local = emptyAlbum();
  local.days['2026-09-12'] = { note: 'Versión mía' };
  local.days['2026-09-13'] = { note: 'Nota vieja' }; // no está sucia: no se escribe

  const merged = mergeAlbum(remote, local, ['days.2026-09-12']);

  assert.equal(merged.days['2026-09-12'].note, 'Versión mía');
  assert.equal(merged.days['2026-09-13'].note, 'Nota nueva del otro');
  assert.deepEqual(merged.settings, { clusterRadiusMeters: 500 });
  assert.equal(remote.days['2026-09-12'].note, 'Versión del otro', 'no modifica el remoto');
});

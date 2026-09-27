import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSource } from '../js/sources/index.js';

const storage = { getItem: () => null, setItem: () => {} };

test('con ?demo se usa la fuente simulada', async () => {
  const source = pickSource('?demo', { storage });
  await source.signIn();
  assert.equal(source.isSignedIn(), true);
  assert.ok((await source.listPhotos()).length > 0);
});

test('sin ?demo se usa Drive, que todavía no está implementado', async () => {
  const source = pickSource('', { storage });
  assert.equal(source.isSignedIn(), false);
  await assert.rejects(source.signIn(), /no implementado/i);
  await assert.rejects(source.listPhotos(), /no implementado/i);
});

test('con ?demo&fail las primeras escrituras del álbum fallan y después vuelven a andar', async () => {
  const source = pickSource('?demo&fail', { storage });
  const album = await source.readAlbum();
  await assert.rejects(source.writeAlbum(album), /simulad/i);
  await assert.rejects(source.writeAlbum(album), /simulad/i);
  await source.writeAlbum(album);
});

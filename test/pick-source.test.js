import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSource } from '../js/sources/index.js';
import { AuthError } from '../js/sources/errors.js';

const storage = { getItem: () => null, setItem: () => {} };

test('con ?demo se usa la fuente simulada', async () => {
  const source = pickSource('?demo', { storage });
  await source.signIn();
  assert.equal(source.isSignedIn(), true);
  assert.ok((await source.listPhotos()).length > 0);
});

test('sin ?demo se usa Drive: arranca sin sesión y, sin config.js completo, avisa qué falta', async () => {
  const session = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const source = pickSource('', { storage, session });
  assert.equal(source.isSignedIn(), false);
  await assert.rejects(source.listPhotos(), AuthError);
  await assert.rejects(source.signIn(), /config\.js/);
});

test('con ?demo&fail las primeras escrituras del álbum fallan y después vuelven a andar', async () => {
  const source = pickSource('?demo&fail', { storage });
  const album = await source.readAlbum();
  await assert.rejects(source.writeAlbum(album), /simulad/i);
  await assert.rejects(source.writeAlbum(album), /simulad/i);
  await source.writeAlbum(album);
});

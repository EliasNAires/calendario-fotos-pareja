import { test, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createAlbumStore } from '../js/album-store.js';
import { emptyAlbum } from '../js/album.js';

/**
 * Fuente con album.json en memoria. `failNext` hace fallar las próximas escrituras;
 * si `gate` es una promesa, las escrituras la esperan (escritura lenta).
 */
function fakeSource() {
  const source = {
    remote: emptyAlbum(),
    writes: 0,
    failNext: 0,
    gate: null,
    async readAlbum() {
      return structuredClone(source.remote);
    },
    async writeAlbum(album) {
      await source.gate;
      if (source.failNext > 0) {
        source.failNext--;
        throw new Error('sin conexión');
      }
      source.writes++;
      source.remote = structuredClone(album);
    },
  };
  return source;
}

/** Deja correr las promesas pendientes (setImmediate no está simulado). */
const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

/** Avanza el reloj simulado dejando correr las promesas en el medio. */
const advance = async (ms) => {
  mock.timers.tick(ms);
  await flush();
};

beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
afterEach(() => mock.timers.reset());

async function loadedStore(source = fakeSource()) {
  const store = createAlbumStore(source);
  await store.load();
  return { store, source };
}

test('las ediciones se guardan juntas a los 1,5 s de la última, sobre lo que haya en el remoto', async () => {
  const { store, source } = await loadedStore();
  source.remote.days['2026-01-01'] = { note: 'Del otro' }; // llegó después de cargar

  store.setDayNote('2026-09-12', 'Pic');
  await advance(1000);
  store.setDayNote('2026-09-12', 'Picnic');
  await advance(1400);
  assert.equal(source.writes, 0, 'todavía no pasó 1,5 s desde la última edición');

  await advance(100);
  assert.equal(source.writes, 1);
  assert.equal(source.remote.days['2026-09-12'].note, 'Picnic');
  assert.equal(source.remote.days['2026-01-01'].note, 'Del otro');
  assert.equal(store.get().days['2026-01-01'].note, 'Del otro', 'lo del otro también se ve acá');
});

test('lo que se edita mientras se guarda queda pendiente y se guarda después', async () => {
  const { store, source } = await loadedStore();
  let finishWrite;
  source.gate = new Promise((resolve) => (finishWrite = resolve));

  store.setDayNote('2026-09-12', 'Primera');
  await advance(1500); // arranca el guardado y queda esperando
  store.setDayNote('2026-09-12', 'Segunda');
  store.setCaption('f1', 'La torta');
  finishWrite();
  await flush();

  assert.equal(source.remote.days['2026-09-12'].note, 'Primera');
  assert.equal(store.get().days['2026-09-12'].note, 'Segunda', 'la edición nueva no se pisa con lo guardado');
  assert.equal(store.hasUnsavedChanges(), true);

  source.gate = null;
  await advance(1500);
  assert.equal(source.remote.days['2026-09-12'].note, 'Segunda');
  assert.deepEqual(source.remote.photos.f1, { caption: 'La torta', placeId: null });
  assert.equal(store.hasUnsavedChanges(), false);
});

test('publica el estado del guardado a quien se suscriba: saving → saved', async () => {
  const { store } = await loadedStore();
  const seen = [];
  store.subscribe((status) => seen.push(status));
  assert.deepEqual(seen, ['idle'], 'al suscribirse recibe el estado actual');

  store.setDayNote('2026-09-12', 'Hola');
  await advance(1500);
  assert.deepEqual(seen, ['idle', 'saving', 'saved']);
});

test('si la escritura falla avisa el error y reintenta a los 2 s, 5 s, 15 s y después cada 30 s', async () => {
  mock.method(console, 'error', () => {});
  const { store, source } = await loadedStore();
  const seen = [];
  store.subscribe((status) => seen.push(status));
  source.failNext = 5;

  store.setDayNote('2026-09-12', 'Hola');
  await advance(1500);
  assert.equal(seen.at(-1), 'error');

  const attemptsAfter = async (ms) => {
    const before = seen.filter((s) => s === 'saving').length;
    await advance(ms - 1);
    assert.equal(seen.filter((s) => s === 'saving').length, before, `no reintenta antes de ${ms} ms`);
    await advance(1);
    assert.equal(seen.filter((s) => s === 'saving').length, before + 1, `reintenta a los ${ms} ms`);
  };
  await attemptsAfter(2000);
  await attemptsAfter(5000);
  await attemptsAfter(15000);
  await attemptsAfter(30000);
  assert.equal(seen.at(-1), 'error');
  assert.equal(store.hasUnsavedChanges(), true);

  await attemptsAfter(30000); // se acabaron las fallas
  assert.equal(seen.at(-1), 'saved');
  assert.equal(source.remote.days['2026-09-12'].note, 'Hola');
  assert.equal(store.hasUnsavedChanges(), false);
});

test('si se edita durante un guardado, no dice "Guardado" hasta guardar también eso', async () => {
  const { store, source } = await loadedStore();
  const seen = [];
  store.subscribe((status) => seen.push(status));
  let finishWrite;
  source.gate = new Promise((resolve) => (finishWrite = resolve));

  store.setDayNote('2026-09-12', 'Primera');
  await advance(1500);
  store.setDayNote('2026-09-12', 'Segunda');
  finishWrite();
  await flush();
  assert.notEqual(seen.at(-1), 'saved');

  source.gate = null;
  await advance(1500);
  assert.equal(seen.at(-1), 'saved');
});

test('editar mientras hay un error no adelanta ni posterga el reintento', async () => {
  mock.method(console, 'error', () => {});
  const { store, source } = await loadedStore();
  source.failNext = 1;
  store.setDayNote('2026-09-12', 'Hola');
  await advance(1500); // falla; reintento a los 2 s

  await advance(1000);
  store.setDayNote('2026-09-12', 'Hola de nuevo');
  await advance(999);
  assert.equal(source.writes, 0);
  await advance(1);
  assert.equal(source.writes, 1, 'reintenta a los 2 s del error, con la última edición');
  assert.equal(source.remote.days['2026-09-12'].note, 'Hola de nuevo');
});

test('retryNow reintenta ya el guardado que falló (p. ej. después de volver a entrar)', async () => {
  const { store, source } = await loadedStore();
  source.failNext = 1;
  store.setDayNote('2026-09-12', 'Picnic');
  await advance(1500);
  assert.equal(source.writes, 0);

  store.retryNow();
  await flush();
  assert.equal(source.writes, 1);
  assert.equal(source.remote.days['2026-09-12'].note, 'Picnic');

  await advance(30000);
  assert.equal(source.writes, 1, 'no queda un reintento viejo programado');
});

test('retryNow sin nada pendiente no escribe', async () => {
  const { store, source } = await loadedStore();
  store.retryNow();
  await flush();
  assert.equal(source.writes, 0);
});

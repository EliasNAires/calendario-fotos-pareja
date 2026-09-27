process.env.TZ = 'America/Argentina/Buenos_Aires'; // createdTime viene en UTC y se pasa a hora local

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDriveSource } from '../js/sources/drive.js';
import { AuthError, NoAccessError } from '../js/sources/errors.js';
import { emptyAlbum } from '../js/album.js';

const FOLDER = 'carpeta-raiz';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const PAGE_SIZE = 2; // el Drive falso pagina de a 2 para ejercitar pageToken

function memoryStorage() {
  const data = new Map();
  return {
    data,
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  };
}

/**
 * Drive v3 en memoria detrás de un `fetch` falso. Entiende lo que usa DriveSource y registra
 * cada pedido en `requests`. `files` son { id, name, mimeType, parents, ... } como los da la API.
 */
function fakeDrive({ files = [], email = 'ana@example.com', folderStatus = 200 } = {}) {
  const drive = {
    files: files.map((f) => ({ ...f })),
    contents: new Map(),
    requests: [],
    validToken: 'token-1',
    /** status forzado para el próximo pedido a la API */
    failNext: null,
    thumbnails: new Map(), // url → { status, body }
  };
  let created = 0;

  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

  drive.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const auth = new Headers(init.headers).get('Authorization');
    drive.requests.push({ method, url, auth, body: init.body });

    if (drive.thumbnails.has(url.href) || url.host !== 'www.googleapis.com') {
      const thumb = drive.thumbnails.get(url.href) ?? { status: 404, body: '' };
      if (auth !== `Bearer ${drive.validToken}`) return new Response('', { status: 403 });
      return new Response(thumb.body, { status: thumb.status });
    }
    if (drive.failNext) {
      const status = drive.failNext;
      drive.failNext = null;
      return json({ error: { code: status } }, status);
    }
    if (auth !== `Bearer ${drive.validToken}`) return json({ error: { code: 401 } }, 401);

    const path = url.pathname;
    if (path === '/drive/v3/about') return json({ user: { emailAddress: email } });

    if (path === '/drive/v3/files' && method === 'GET') {
      const q = url.searchParams.get('q') ?? '';
      const parent = q.match(/'([^']+)' in parents/)?.[1];
      const name = q.match(/name='([^']+)'/)?.[1];
      const matches = drive.files.filter(
        (f) => f.parents?.includes(parent) && !f.trashed && (name === undefined || f.name === name),
      );
      const start = Number(url.searchParams.get('pageToken') ?? 0);
      const page = matches.slice(start, start + PAGE_SIZE);
      const body = { files: page };
      if (start + PAGE_SIZE < matches.length) body.nextPageToken = String(start + PAGE_SIZE);
      return json(body);
    }

    const fileMatch = path.match(/^\/drive\/v3\/files\/([^/]+)$/);
    if (fileMatch && method === 'GET') {
      const id = decodeURIComponent(fileMatch[1]);
      if (id === FOLDER) return folderStatus === 200 ? json({ id, name: 'Álbum' }) : json({}, folderStatus);
      const file = drive.files.find((f) => f.id === id);
      if (!file) return json({}, 404);
      if (url.searchParams.get('alt') === 'media') return new Response(drive.contents.get(id));
      return json(file);
    }

    const uploadMatch = path.match(/^\/upload\/drive\/v3\/files(?:\/([^/]+))?$/);
    if (uploadMatch && method === 'PATCH') {
      const id = decodeURIComponent(uploadMatch[1]);
      if (!drive.files.some((f) => f.id === id)) return json({}, 404);
      drive.contents.set(id, init.body);
      return json({ id });
    }
    if (uploadMatch && method === 'POST' && !uploadMatch[1]) {
      // multipart/related: [--límite, tipo, '', metadata, --límite, tipo, '', contenido, --límite--]
      const lines = String(init.body).split('\r\n');
      const metadata = JSON.parse(lines[3]);
      const content = lines[7];
      const id = `nuevo-${++created}`;
      drive.files.push({ id, name: metadata.name, mimeType: metadata.mimeType, parents: metadata.parents });
      drive.contents.set(id, content);
      return json({ id });
    }
    return json({ error: 'ruta desconocida' }, 400);
  };

  return drive;
}

/** GIS falso: cada pedido de token contesta con `next()` (por defecto, el token válido del Drive falso). */
function fakeGis(drive) {
  const gis = { requests: [], next: () => ({ access_token: drive.validToken, expires_in: 3599 }) };
  gis.load = async () => ({
    accounts: {
      oauth2: {
        initTokenClient(config) {
          return {
            requestAccessToken(overrides = {}) {
              gis.requests.push({ ...config, ...overrides });
              const response = gis.next();
              queueMicrotask(() =>
                response.type ? config.error_callback?.(response) : config.callback(response),
              );
            },
          };
        },
      },
    },
  });
  return gis;
}

/** Reloj y timers simulados: `advance(ms)` corre los timers vencidos. */
function fakeClock(start = 1_000_000) {
  const clock = { now: start, timers: [] };
  clock.setTimeout = (fn, ms) => {
    const timer = { at: clock.now + ms, fn };
    clock.timers.push(timer);
    return timer;
  };
  clock.clearTimeout = (timer) => (clock.timers = clock.timers.filter((t) => t !== timer));
  clock.advance = async (ms) => {
    clock.now += ms;
    const due = clock.timers.filter((t) => t.at <= clock.now);
    clock.timers = clock.timers.filter((t) => t.at > clock.now);
    for (const t of due) t.fn();
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
  };
  return clock;
}

function setup({ drive = fakeDrive(), storage = memoryStorage(), session = memoryStorage(), ...rest } = {}) {
  const gis = fakeGis(drive);
  const clock = fakeClock();
  const make = (overrides = {}) =>
    createDriveSource({
      clientId: 'cliente.apps.googleusercontent.com',
      folderId: FOLDER,
      fetch: drive.fetch,
      loadGis: gis.load,
      storage,
      session,
      now: () => clock.now,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      probeImage: async () => false,
      createObjectURL: (blob) => `blob:${blob.size}`,
      ...rest,
      ...overrides,
    });
  return { drive, gis, clock, storage, session, source: make(), make };
}

const image = (id, parent, extra = {}) => ({ id, name: `${id}.jpg`, mimeType: 'image/jpeg', parents: [parent], ...extra });
const folder = (id, parent) => ({ id, name: id, mimeType: FOLDER_MIME, parents: [parent] });

test('lista las fotos de la carpeta y de sus subcarpetas, página por página', async () => {
  const drive = fakeDrive({
    files: [
      image('a', FOLDER, { imageMediaMetadata: { time: '2026:03:14 21:05:09' } }),
      folder('viaje', FOLDER),
      image('b', 'viaje', { imageMediaMetadata: { time: '2026:03:15 10:00:00' } }),
      folder('dia-2', 'viaje'),
      image('c', 'dia-2', { imageMediaMetadata: { time: '2026:03:16 08:30:00' } }),
      image('d', 'dia-2', { imageMediaMetadata: { time: '2026:03:16 09:30:00' } }),
      image('e', 'dia-2', { imageMediaMetadata: { time: '2026:03:16 10:30:00' } }),
      { id: 'video', name: 'v.mov', mimeType: 'video/quicktime', parents: [FOLDER] },
      { id: 'album', name: 'album.json', mimeType: 'application/json', parents: [FOLDER] },
      image('borrada', FOLDER, { trashed: true }),
    ],
  });
  const { source } = setup({ drive });
  await source.signIn();

  const photos = await source.listPhotos();

  assert.deepEqual(photos.map((p) => p.id).sort(), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(photos.find((p) => p.id === 'a'), { id: 'a', name: 'a.jpg', time: '2026-03-14T21:05:09' });
});

test('toma la ubicación de la foto y, si no tiene hora de cámara, la fecha de subida en hora local', async () => {
  const drive = fakeDrive({
    files: [
      image('con-gps', FOLDER, {
        imageMediaMetadata: { time: '2026:03:14 21:05:09', location: { latitude: -34.578, longitude: -58.427 } },
      }),
      image('sin-exif', FOLDER, { createdTime: '2026-03-15T01:30:00.000Z' }),
    ],
  });
  const { source } = setup({ drive });
  await source.signIn();

  const photos = await source.listPhotos();

  assert.deepEqual(photos.find((p) => p.id === 'con-gps'), {
    id: 'con-gps',
    name: 'con-gps.jpg',
    time: '2026-03-14T21:05:09',
    lat: -34.578,
    lng: -58.427,
  });
  assert.equal(photos.find((p) => p.id === 'sin-exif').time, '2026-03-14T22:30:00');
});

test('sin album.json lee un álbum vacío, la primera escritura lo crea en la carpeta y las siguientes lo pisan', async () => {
  const { source, drive } = setup();
  await source.signIn();

  const album = await source.readAlbum();
  assert.deepEqual(album, emptyAlbum());
  assert.equal(drive.files.length, 0, 'leer no crea nada');

  album.days['2026-03-14'] = { note: 'la plaza' };
  await source.writeAlbum(album);
  assert.deepEqual(
    drive.files.map((f) => ({ name: f.name, parents: f.parents })),
    [{ name: 'album.json', parents: [FOLDER] }],
  );

  album.days['2026-03-15'] = { note: 'el bar' };
  await source.writeAlbum(album);
  assert.equal(drive.files.length, 1, 'no se crea un segundo album.json');
  assert.deepEqual(await source.readAlbum(), album);

  // Otra sesión (el otro usuario) encuentra el mismo archivo.
  const other = setup({ drive }).source;
  await other.signIn();
  assert.deepEqual(await other.readAlbum(), album);
});

for (const status of [403, 404]) {
  test(`si la carpeta del álbum devuelve ${status}, la cuenta no tiene acceso y se informa su email`, async () => {
    const { source } = setup({ drive: fakeDrive({ email: 'otra@example.com', folderStatus: status }) });

    await assert.rejects(source.signIn(), (err) => err instanceof NoAccessError && err.email === 'otra@example.com');
  });
}

test('recuerda el email para sugerir la misma cuenta la próxima vez, salvo al cambiar de cuenta', async () => {
  const { gis, make } = setup({ drive: fakeDrive({ email: 'ana@example.com' }) });
  await make().signIn();
  assert.equal(gis.requests[0].login_hint, undefined);

  await make({ session: memoryStorage() }).signIn(); // otra visita: sessionStorage nuevo, mismo localStorage
  assert.equal(gis.requests.at(-1).login_hint, 'ana@example.com');

  await make({ session: memoryStorage() }).signIn({ selectAccount: true });
  assert.equal(gis.requests.at(-1).login_hint, undefined);
  assert.equal(gis.requests.at(-1).prompt, 'select_account');
});

test('al recargar la página sigue la sesión mientras el token no venza', async () => {
  const { make, clock, gis } = setup();
  const first = make();
  assert.equal(first.isSignedIn(), false);
  await assert.rejects(first.listPhotos(), AuthError);
  await first.signIn();

  const reloaded = make();
  assert.equal(reloaded.isSignedIn(), true);
  await reloaded.listPhotos();

  clock.now += 3600 * 1000;
  assert.equal(make().isSignedIn(), false);
  assert.equal(gis.requests.length, 1);
});

test('si Drive contesta 401 se pierde la sesión, se avisa y la acción falla con AuthError', async () => {
  const { source, drive } = setup();
  const signedOut = [];
  source.onSignedOut(() => signedOut.push(true));
  await source.signIn();

  drive.validToken = 'token-2'; // el token de la sesión ya no sirve
  await assert.rejects(source.readAlbum(), AuthError);
  assert.equal(source.isSignedIn(), false);
  assert.equal(signedOut.length, 1);

  await source.signIn(); // un toque en "Entrar con Google" y se reintenta
  assert.deepEqual(await source.readAlbum(), emptyAlbum());
});

test('antes de que venza el token se renueva sin preguntar, con la cuenta recordada', async () => {
  const { source, drive, gis, clock } = setup();
  await source.signIn();

  drive.validToken = 'token-2';
  await clock.advance(55 * 60 * 1000);

  assert.deepEqual(
    { prompt: gis.requests.at(-1).prompt, hint: gis.requests.at(-1).login_hint },
    { prompt: '', hint: 'ana@example.com' },
  );
  await clock.advance(10 * 60 * 1000); // el token original ya venció
  assert.equal(source.isSignedIn(), true);
  await source.listPhotos();
});

test('si la renovación silenciosa falla, se pierde la sesión y se avisa', async () => {
  const { source, gis, clock } = setup();
  const signedOut = [];
  source.onSignedOut(() => signedOut.push(true));
  await source.signIn();

  gis.next = () => ({ type: 'popup_failed_to_open' });
  await clock.advance(55 * 60 * 1000);

  assert.equal(source.isSignedIn(), false);
  assert.equal(signedOut.length, 1);
});

test('una sesión recuperada al recargar también se renueva', async () => {
  const { make, drive, clock } = setup();
  await make().signIn();
  const reloaded = make();

  drive.validToken = 'token-2';
  await clock.advance(65 * 60 * 1000);

  assert.equal(reloaded.isSignedIn(), true);
  await reloaded.listPhotos();
});

const LINK = 'https://lh3.googleusercontent.com/drive-storage/abc=s220';

test('la miniatura usa el thumbnailLink con el tamaño pedido si el <img> la puede cargar directo', async () => {
  const drive = fakeDrive({ files: [image('a', FOLDER, { thumbnailLink: LINK })] });
  const probed = [];
  const { source } = setup({ drive, probeImage: async (url) => (probed.push(url), true) });
  await source.signIn();
  const [photo] = await source.listPhotos();

  assert.equal(await source.thumbnailUrl(photo, 640), 'https://lh3.googleusercontent.com/drive-storage/abc=s640');
  assert.deepEqual(probed, ['https://lh3.googleusercontent.com/drive-storage/abc=s640']);
});

test('si el <img> no la puede cargar, la miniatura se baja con el token y se usa como blob', async () => {
  const drive = fakeDrive({ files: [image('a', FOLDER, { thumbnailLink: LINK })] });
  drive.thumbnails.set('https://lh3.googleusercontent.com/drive-storage/abc=s320', { status: 200, body: 'jpeg!' });
  const { source } = setup({ drive });
  await source.signIn();
  const [photo] = await source.listPhotos();

  assert.equal(await source.thumbnailUrl(photo, 320), 'blob:5');
});

test('si el thumbnailLink venció, se pide uno nuevo a Drive', async () => {
  const drive = fakeDrive({ files: [image('a', FOLDER, { thumbnailLink: LINK })] });
  const { source } = setup({ drive });
  await source.signIn();
  const [photo] = await source.listPhotos();

  const fresh = 'https://lh3.googleusercontent.com/drive-storage/nuevo=s220';
  drive.files[0].thumbnailLink = fresh;
  drive.thumbnails.set('https://lh3.googleusercontent.com/drive-storage/nuevo=s320', { status: 200, body: 'jpeg!!' });

  assert.equal(await source.thumbnailUrl(photo, 320), 'blob:6');
});

test('con una sesión vigente, entrar no vuelve a pedir token (no abre el login sin un toque)', async () => {
  const { make, gis } = setup();
  await make().signIn();

  await make().signIn();

  assert.equal(gis.requests.length, 1);
});

test('si alguien borra album.json, la próxima escritura lo vuelve a crear', async () => {
  const { source, drive } = setup();
  await source.signIn();
  await source.writeAlbum(emptyAlbum());
  drive.files[0].trashed = true;

  const album = await source.readAlbum();
  album.days['2026-03-14'] = { note: 'de nuevo' };
  await source.writeAlbum(album);

  const live = drive.files.filter((f) => !f.trashed);
  assert.equal(live.length, 1);
  assert.equal(JSON.parse(drive.contents.get(live[0].id)).days['2026-03-14'].note, 'de nuevo');
});

test('escribir sin releer antes tampoco pisa un album.json que se borró: crea uno nuevo', async () => {
  const { source, drive } = setup();
  await source.signIn();
  await source.writeAlbum(emptyAlbum());
  drive.files[0].trashed = true;

  await source.writeAlbum({ ...emptyAlbum(), days: { '2026-03-14': { note: 'otra vez' } } });

  const live = drive.files.filter((f) => !f.trashed);
  assert.equal(live.length, 1);
  assert.equal(JSON.parse(drive.contents.get(live[0].id)).days['2026-03-14'].note, 'otra vez');
});

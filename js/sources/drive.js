// DriveSource: Google Drive con Google Identity Services (token client) y la API REST v3 con fetch.
import { AuthError, NoAccessError } from './errors.js';
import { emptyAlbum } from '../album.js';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const ALBUM_FILE = 'album.json';
const SCOPE = 'https://www.googleapis.com/auth/drive';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const LIST_FIELDS = 'nextPageToken,files(id,name,mimeType,createdTime,thumbnailLink,imageMediaMetadata(time,location))';

// Por si la carpeta está en una unidad compartida.
const ALL_DRIVES = { supportsAllDrives: true, includeItemsFromAllDrives: true };

const EMAIL_KEY = 'calendario-fotos-pareja:email';
const TOKEN_KEY = 'calendario-fotos-pareja:token';
// El token dura una hora: se renueva a los ~55 minutos.
const RENEW_BEFORE_MS = 5 * 60 * 1000;

/** Drive contestó con un error que no es de sesión. */
class DriveError extends Error {
  constructor(status) {
    super(`Drive respondió ${status}`);
    this.status = status;
  }
}

/** El thumbnailLink termina en `=s220`: se pide el tamaño que hace falta. */
const sizedLink = (link, size) => (/=s\d+$/.test(link) ? link.replace(/=s\d+$/, `=s${size}`) : `${link}=s${size}`);

/** ¿Un <img> puede cargar esta URL tal cual (con las cookies de Google del navegador)? */
function canLoadDirectly(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';

/** Carga el script de Google Identity Services y devuelve `window.google`. */
function loadGisScript() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = GIS_SRC;
    script.async = true;
    script.onload = () => resolve(/** @type {any} */ (globalThis).google);
    script.onerror = () => reject(new Error('No se pudo cargar el login de Google. Revisá la conexión.'));
    document.head.append(script);
  });
}

const pad = (n) => String(n).padStart(2, '0');

/** "YYYY:MM:DD HH:MM:SS" de la cámara → "YYYY-MM-DDTHH:mm:ss", sin tocar la zona. */
function photoTime(file) {
  const exif = file.imageMediaMetadata?.time?.match(/^(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
  if (exif) return `${exif[1]}-${exif[2]}-${exif[3]}T${exif[4]}:${exif[5]}:${exif[6]}`;
  const d = new Date(file.createdTime);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function toPhoto(file) {
  const photo = { id: file.id, name: file.name, time: photoTime(file) };
  const { latitude, longitude } = file.imageMediaMetadata?.location ?? {};
  if (typeof latitude === 'number' && typeof longitude === 'number') {
    photo.lat = latitude;
    photo.lng = longitude;
  }
  return photo;
}

export function createDriveSource({
  clientId,
  folderId,
  fetch = globalThis.fetch.bind(globalThis),
  loadGis = loadGisScript,
  storage = globalThis.localStorage,
  session = globalThis.sessionStorage,
  now = Date.now,
  setTimeout = globalThis.setTimeout,
  clearTimeout = globalThis.clearTimeout,
  probeImage = canLoadDirectly,
  createObjectURL = (blob) => URL.createObjectURL(blob),
}) {
  const configured = ![clientId, folderId].some((value) => !value || value.includes('REEMPLAZAR'));
  // El script se carga ya: si se esperara al toque en "Entrar", Safari bloquearía el popup del login.
  let google = null;
  const gisReady = configured ? loadGis().then((loaded) => (google = loaded)) : Promise.resolve();
  gisReady.catch(() => {}); // el error se muestra al intentar entrar

  /** @type {{ value: string, expiresAt: number } | null} */
  let token = readSavedToken();
  const signedOutListeners = new Set();
  let renewTimer = null;
  /** id de foto → thumbnailLink (vienen con el listado y se renuevan si vencen) */
  const thumbnailLinks = new Map();

  function readSavedToken() {
    try {
      return JSON.parse(session.getItem(TOKEN_KEY) ?? 'null');
    } catch {
      return null;
    }
  }

  const hasToken = () => Boolean(token && now() < token.expiresAt);

  function saveToken({ access_token, expires_in }) {
    token = { value: access_token, expiresAt: now() + Number(expires_in) * 1000 };
    session.setItem(TOKEN_KEY, JSON.stringify(token));
    scheduleRenewal();
  }

  function dropToken() {
    clearTimeout(renewTimer);
    token = null;
    session.removeItem(TOKEN_KEY);
    for (const listener of signedOutListeners) listener();
  }

  /** Renovación silenciosa con la cuenta recordada; si falla, se pierde la sesión. */
  function scheduleRenewal() {
    clearTimeout(renewTimer);
    const renew = () =>
      requestToken({ hint: storage.getItem(EMAIL_KEY) ?? undefined, prompt: '' }).then(saveToken, dropToken);
    renewTimer = setTimeout(renew, Math.max(0, token.expiresAt - RENEW_BEFORE_MS - now()));
  }

  if (hasToken()) scheduleRenewal();

  /** `hint`: email para `login_hint`; `prompt`: '' (sin preguntar si se puede) o 'select_account'. */
  async function requestToken({ hint, prompt }) {
    // Si el script ya está, el popup se abre en el mismo toque, sin esperas en el medio.
    if (!google) await gisReady;
    return new Promise((resolve, reject) => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: SCOPE,
        ...(hint && { login_hint: hint }),
        callback: (response) => (response.error ? reject(new AuthError()) : resolve(response)),
        error_callback: () => reject(new AuthError()),
      });
      client.requestAccessToken(prompt === undefined ? {} : { prompt });
    });
  }

  /** Pedido autenticado a Drive. */
  async function request(url, init = {}) {
    if (!hasToken()) throw new AuthError();
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token.value}`);
    const response = await fetch(url, { ...init, headers });
    if (response.status === 401) {
      dropToken();
      throw new AuthError();
    }
    if (!response.ok) throw new DriveError(response.status);
    return response;
  }

  const withParams = (base, params) => {
    const url = new URL(base);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
    return url;
  };

  /** GET a la API de Drive. */
  const api = (path, params = {}) => request(withParams(`${API}/${path}`, params));

  /** id de album.json en la raíz del álbum, o null si todavía no existe. Se busca siempre por nombre. */
  async function findAlbumFile() {
    const { files } = await (
      await api('files', {
        q: `name='${ALBUM_FILE}' and '${folderId}' in parents and trashed=false`,
        orderBy: 'createdTime',
        fields: 'files(id)',
        ...ALL_DRIVES,
      })
    ).json();
    return files[0]?.id ?? null;
  }

  /**
   * Guardrail R7: la ÚNICA escritura a Drive de toda la app. No recibe ningún id: busca album.json
   * por nombre en la raíz del álbum y lo pisa, o lo crea ahí si no existe. Ninguna foto puede ser el destino.
   */
  async function writeAlbumFile(album) {
    const fileId = await findAlbumFile();
    const content = JSON.stringify(album, null, 2);
    if (fileId) {
      const url = `${UPLOAD_API}/files/${encodeURIComponent(fileId)}`;
      await request(withParams(url, { uploadType: 'media', supportsAllDrives: true }), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: content,
      });
      return;
    }
    const boundary = `album-${Math.random().toString(36).slice(2)}`;
    const metadata = { name: ALBUM_FILE, mimeType: 'application/json', parents: [folderId] };
    const body = [
      `--${boundary}`,
      'Content-Type: application/json; charset=UTF-8',
      '',
      JSON.stringify(metadata),
      `--${boundary}`,
      'Content-Type: application/json',
      '',
      content,
      `--${boundary}--`,
    ].join('\r\n');
    const url = withParams(`${UPLOAD_API}/files`, { uploadType: 'multipart', supportsAllDrives: true });
    await request(url, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
  }

  async function freshThumbnailLink(fileId) {
    const { thumbnailLink } = await (
      await api(`files/${encodeURIComponent(fileId)}`, { fields: 'thumbnailLink', supportsAllDrives: true })
    ).json();
    if (!thumbnailLink) throw new Error('Drive todavía no tiene miniatura de esta foto');
    thumbnailLinks.set(fileId, thumbnailLink);
    return thumbnailLink;
  }

  /** Baja la miniatura con el token (sin tocar la sesión si ese host no lo acepta) → blob URL. */
  async function authorizedBlob(url) {
    if (!hasToken()) throw new AuthError();
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token.value}` } });
    if (!response.ok) throw new DriveError(response.status);
    return createObjectURL(await response.blob());
  }

  /**
   * Estrategia de miniaturas, aislada para poder cambiarla si Safari lo exige: primero el link
   * directo en <img>; si no carga, fetch con el token → blob; si eso falla, el link venció y se pide otro.
   */
  async function loadThumbnail(fileId, size) {
    const link = thumbnailLinks.get(fileId) ?? (await freshThumbnailLink(fileId));
    const direct = sizedLink(link, size);
    if (await probeImage(direct)) return direct;
    try {
      return await authorizedBlob(direct);
    } catch (err) {
      if (err instanceof AuthError) throw err;
      return authorizedBlob(sizedLink(await freshThumbnailLink(fileId), size));
    }
  }

  /** Todos los archivos (no borrados) que tienen a `parent` como carpeta, siguiendo la paginación. */
  async function children(parent) {
    const files = [];
    let pageToken;
    do {
      const page = await (
        await api('files', {
          q: `'${parent}' in parents and trashed=false`,
          pageSize: 1000,
          fields: LIST_FIELDS,
          ...ALL_DRIVES,
          ...(pageToken ? { pageToken } : {}),
        })
      ).json();
      files.push(...page.files);
      pageToken = page.nextPageToken;
    } while (pageToken);
    return files;
  }

  return {
    /** `selectAccount`: pedir otra cuenta en lugar de la recordada. */
    async signIn({ selectAccount = false } = {}) {
      if (!configured) throw new Error('Falta completar CLIENT_ID y FOLDER_ID en config.js.');
      // Con una sesión vigente (recargar la página) no se pide token: sin un toque, el popup se bloquea.
      if (selectAccount || !hasToken()) {
        const hint = selectAccount ? undefined : storage.getItem(EMAIL_KEY) ?? undefined;
        saveToken(await requestToken({ hint, prompt: selectAccount ? 'select_account' : hint && '' }));
      }

      const { user } = await (await api('about', { fields: 'user(emailAddress)' })).json();
      storage.setItem(EMAIL_KEY, user.emailAddress);
      try {
        await api(`files/${encodeURIComponent(folderId)}`, { fields: 'id,name', supportsAllDrives: true });
      } catch (err) {
        if (err instanceof DriveError && (err.status === 403 || err.status === 404)) {
          throw new NoAccessError(user.emailAddress);
        }
        throw err;
      }
    },

    isSignedIn: hasToken,

    /** Avisa cuando se pierde la sesión (401 o renovación fallida). Devuelve la baja. */
    onSignedOut(listener) {
      signedOutListeners.add(listener);
      return () => signedOutListeners.delete(listener);
    },

    async listPhotos() {
      const photos = [];
      const queue = [folderId];
      while (queue.length) {
        for (const file of await children(queue.shift())) {
          if (file.mimeType === FOLDER_MIME) queue.push(file.id);
          else if (file.mimeType?.startsWith('image/')) {
            photos.push(toPhoto(file));
            if (file.thumbnailLink) thumbnailLinks.set(file.id, file.thumbnailLink);
          }
        }
      }
      return photos;
    },

    thumbnailUrl: (photo, size) => loadThumbnail(photo.id, size),

    /** Si album.json no existe, un álbum vacío: se crea en el primer `writeAlbum`. */
    async readAlbum() {
      const fileId = await findAlbumFile();
      if (!fileId) return emptyAlbum();
      const saved = await (await api(`files/${encodeURIComponent(fileId)}`, { alt: 'media', supportsAllDrives: true })).json();
      return { ...emptyAlbum(), ...saved };
    },

    writeAlbum: (album) => writeAlbumFile(album),
  };
}

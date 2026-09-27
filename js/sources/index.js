// Fuente de datos: la interfaz común a DemoSource y DriveSource.
//   signIn() / isSignedIn() / onSignedOut(listener)
//   listPhotos()               → [{ id, name, time: 'YYYY-MM-DDTHH:mm:ss', lat?, lng? }]
//   thumbnailUrl(photo, size)  → Promise<string> utilizable en <img>
//   readAlbum()                → album (lo crea vacío si no existe)
//   writeAlbum(album)
import { CLIENT_ID, FOLDER_ID } from '../../config.js';
import { createDemoSource } from './demo.js';
import { createDriveSource } from './drive.js';

export const isDemo = (search) => new URLSearchParams(search).has('demo');

// Con `?demo&fail`, las primeras escrituras fallan: alcanza para ver el error y un reintento fallido.
const SIMULATED_WRITE_FAILURES = 2;

/** `?demo` en la URL → DemoSource (`&fail` simula errores al guardar); si no, DriveSource. */
export function pickSource(search, options = {}) {
  if (!isDemo(search)) return createDriveSource({ clientId: CLIENT_ID, folderId: FOLDER_ID, ...options });
  const failWrites = new URLSearchParams(search).has('fail') ? SIMULATED_WRITE_FAILURES : 0;
  return createDemoSource({ failWrites, ...options });
}

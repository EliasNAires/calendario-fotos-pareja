// Fuente de datos: la interfaz común a DemoSource y DriveSource.
//   signIn() / isSignedIn()
//   listPhotos()               → [{ id, name, time: 'YYYY-MM-DDTHH:mm:ss', lat?, lng? }]
//   thumbnailUrl(photo, size)  → Promise<string> utilizable en <img>
//   readAlbum()                → album (lo crea vacío si no existe)
//   writeAlbum(album)
import { createDemoSource } from './demo.js';
import { createDriveSource } from './drive.js';

export const isDemo = (search) => new URLSearchParams(search).has('demo');

/** `?demo` en la URL → DemoSource; si no, DriveSource. */
export function pickSource(search, options = {}) {
  return isDemo(search) ? createDemoSource(options) : createDriveSource();
}

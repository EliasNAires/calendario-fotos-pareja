// DemoSource: fuente de datos simulada para `?demo`. Fotos generadas, álbum en localStorage.
import { hashString } from '../hash.js';
import { emptyAlbum } from '../album.js';

const ALBUM_KEY = 'calendario-fotos-pareja:demo-album';

const TOTAL_PHOTOS = 300;
const MONTHS = 14;
const BIG_DAYS = 8; // días con 10 o más fotos
const NO_GPS_RATE = 0.15;
// Fecha fija, no "hoy": si las fotos se corrieran con el reloj, las notas y captions guardadas
// por día e id quedarían apuntando a otras fotos.
const LAST_DAY = new Date(2026, 8, 27);

// Zonas con GPS. Las dos de Palermo están a ~220 m entre sí, a propósito.
const ZONES = [
  { lat: -34.578, lng: -58.427 }, // Palermo, plaza
  { lat: -34.5795, lng: -58.4255 }, // Palermo, bar de la esquina
  { lat: -34.6212, lng: -58.3731 }, // San Telmo
  { lat: -34.426, lng: -58.5796 }, // Tigre
  { lat: -38.0055, lng: -57.5426 }, // Mar del Plata
  { lat: -31.4201, lng: -64.1888 }, // Córdoba
];

/** PRNG determinista (mulberry32): mismas fotos en cada recarga. */
function seededRandom(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function generatePhotos() {
  const random = seededRandom(20240712);
  const int = (min, max) => min + Math.floor(random() * (max - min + 1));

  const end = LAST_DAY;
  const start = new Date(end.getFullYear(), end.getMonth() - (MONTHS - 1), 1);
  const spanDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  const randomDay = () => {
    const d = new Date(start);
    d.setDate(d.getDate() + int(0, spanDays));
    return localDate(d);
  };

  // Una salida: varias fotos seguidas el mismo día, en la misma zona.
  const outings = [];
  let count = 0;
  const addOuting = (day, size) => {
    outings.push({ day, size, zone: ZONES[int(0, ZONES.length - 1)], hour: int(9, 20) });
    count += size;
  };
  for (let i = 0; i < BIG_DAYS; i++) addOuting(randomDay(), int(10, 16));
  addOuting(localDate(end), int(3, 5)); // el último día siempre tiene fotos
  while (count < TOTAL_PHOTOS) addOuting(randomDay(), Math.min(int(1, 5), TOTAL_PHOTOS - count));

  const photos = [];
  for (const { day, size, zone, hour } of outings) {
    let minutes = hour * 60 + int(0, 59);
    for (let i = 0; i < size; i++) {
      minutes = Math.min(minutes + int(0, 12), 23 * 60 + 59);
      const photo = { time: `${day}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:${pad(int(0, 59))}` };
      if (random() >= NO_GPS_RATE) {
        photo.lat = zone.lat + (random() - 0.5) * 0.0004;
        photo.lng = zone.lng + (random() - 0.5) * 0.0004;
      }
      photos.push(photo);
    }
  }

  photos.sort((a, b) => a.time.localeCompare(b.time));
  return photos.map((p, i) => ({ id: `demo_${String(i).padStart(4, '0')}`, name: `IMG_${1000 + i}.JPG`, ...p }));
}

/** Placeholder SVG: un paisaje simple con colores apagados derivados del id y la fecha. */
function placeholderSvg(photo, size) {
  const h = hashString(`${photo.id}|${photo.time}`);
  const hue = h % 360;
  const sunX = 20 + ((h >>> 9) % 60);
  const ridge = 55 + ((h >>> 17) % 20);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">
<rect width="100" height="100" fill="hsl(${hue} 32% 72%)"/>
<circle cx="${sunX}" cy="30" r="10" fill="hsl(${(hue + 40) % 360} 45% 88%)"/>
<path d="M0 ${ridge} Q30 ${ridge - 18} 55 ${ridge} T100 ${ridge - 6} V100 H0Z" fill="hsl(${(hue + 190) % 360} 22% 48%)"/>
<text x="6" y="94" font-family="sans-serif" font-size="8" fill="hsl(0 0% 100% / .85)">${photo.time.slice(0, 10)}</text>
</svg>`;
}

export function createDemoSource({ storage = globalThis.localStorage } = {}) {
  let signedIn = false;
  let photos = null;
  const save = (album) => storage.setItem(ALBUM_KEY, JSON.stringify(album));

  return {
    async signIn() {
      signedIn = true;
    },
    isSignedIn: () => signedIn,

    async listPhotos() {
      photos ??= generatePhotos();
      return [...photos];
    },

    async thumbnailUrl(photo, size) {
      return `data:image/svg+xml,${encodeURIComponent(placeholderSvg(photo, size))}`;
    },

    async readAlbum() {
      const saved = storage.getItem(ALBUM_KEY);
      if (saved) return JSON.parse(saved);
      const album = emptyAlbum();
      save(album);
      return album;
    },

    async writeAlbum(album) {
      save(album);
    },
  };
}

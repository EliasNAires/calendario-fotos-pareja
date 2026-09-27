import { ALBUM_NAME } from '../config.js';
import { pickSource, isDemo } from './sources/index.js';
import { NoAccessError } from './sources/errors.js';
import { createThumbnails } from './thumbs.js';
import { createAlbumStore } from './album-store.js';
import { DEFAULT_CLUSTER_RADIUS_METERS } from './album.js';
import { monthGrid, photosByDay, monthsWithPhotos, rotationFor } from './calendar.js';
import { assignPlaces, placeGroups, visits, dateRange, dayPlace, mapsUrl, placeLabel } from './places.js';
import { swipeDirection, keyAction, stepIndex, photoAlt, placeLink } from './viewer.js';

const MAX_STACK = 3; // si cambia, ajustar .pila en styles.css; en el celular el CSS deja ver solo la primera
const THUMB_SIZE = 160; // px pedidos a la fuente; se muestran más chicas (pantallas retina)
const PANEL_THUMB_SIZE = 320; // el panel las muestra a ~200px de ancho; el visor la usa de placeholder
const CARD_THUMB_SIZE = 240;
const VIEWER_SIZE = 1600;

const $ = (id) => document.getElementById(id);

const source = pickSource(location.search);
const thumbnails = createThumbnails(source);
const store = createAlbumStore(source);

const monthTitle = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayLabel = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
const longDayLabel = new Intl.DateTimeFormat('es-AR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
// "sábado, 14 de marzo de 2026" → "sábado 14 de marzo de 2026"
const dayTitle = (date) => longDayLabel.format(dayFromIso(date)).replace(',', '');
const utc = (year, month, day = 1) => new Date(Date.UTC(year, month - 1, day));
const dayFromIso = (iso) => utc(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10)));
const monthKey = ({ year, month }) => `${year}-${String(month).padStart(2, '0')}`;

const state = {
  photos: [],
  byDay: new Map(),
  months: [],
  current: null, // { year, month }
};

// Entrada

document.title = ALBUM_NAME;
document.querySelector('[data-album-name]').textContent = ALBUM_NAME;
$('entrada-demo').hidden = !isDemo(location.search);
$('entrar').addEventListener('click', () => enter());
$('cambiar-cuenta').addEventListener('click', () => enter({ selectAccount: true }));

// Con una sesión todavía válida (recargar la página) se entra sin tocar nada.
if (source.isSignedIn()) enter();

/** `selectAccount`: entrar con otra cuenta de Google, no con la recordada. */
async function enter({ selectAccount = false } = {}) {
  const buttons = /** @type {HTMLButtonElement[]} */ ([$('entrar'), $('cambiar-cuenta')]);
  const error = $('entrada-error');
  const noAccess = $('sin-acceso');
  for (const button of buttons) button.disabled = true;
  error.hidden = true;
  noAccess.hidden = true;
  $('entrar').hidden = false;
  try {
    await source.signIn({ selectAccount });
    const [photos] = await Promise.all([source.listPhotos(), store.load()]);
    assignNewPhotos(photos);
    state.photos = photos;
    state.byDay = photosByDay(photos);
    state.months = monthsWithPhotos(photos);
    const now = new Date();
    state.current = state.months.at(-1) ?? { year: now.getFullYear(), month: now.getMonth() + 1 };
    $('entrada').hidden = true;
    $('app').hidden = false;
    renderMonthPicker();
    showView('calendario');
  } catch (err) {
    if (err instanceof NoAccessError) {
      $('sin-acceso-email').textContent = err.email;
      noAccess.hidden = false;
      $('entrar').hidden = true;
    } else {
      error.textContent = err instanceof Error ? err.message : String(err);
      error.hidden = false;
    }
  } finally {
    for (const button of buttons) button.disabled = false;
  }
}

// Sesión perdida con la app abierta (401 o renovación fallida)

const relogin = /** @type {HTMLDialogElement} */ ($('reingreso'));

source.onSignedOut(() => {
  if (!$('app').hidden && !relogin.open) relogin.showModal();
});
// Sin sesión no se puede hacer nada: Esc no lo cierra.
relogin.addEventListener('cancel', (event) => event.preventDefault());

$('reingresar').addEventListener('click', async () => {
  const button = /** @type {HTMLButtonElement} */ ($('reingresar'));
  const error = $('reingreso-error');
  button.disabled = true;
  error.hidden = true;
  try {
    await source.signIn();
    relogin.close();
    store.retryNow();
  } catch (err) {
    if (err instanceof NoAccessError) error.textContent = `${err.message} (${err.email})`;
    else error.textContent = err instanceof Error ? err.message : String(err);
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
});

/** Lleva a su lugar (o a uno nuevo) cada foto con GPS que todavía no tiene. Se guarda con el resto. */
function assignNewPhotos(photos) {
  const album = store.get();
  const radius = album.settings?.clusterRadiusMeters ?? DEFAULT_CLUSTER_RADIUS_METERS;
  const { newPlaces, assignments } = assignPlaces(photos, album, radius);
  for (const [placeId, place] of Object.entries(newPlaces)) store.setPlace(placeId, place);
  for (const [fileId, placeId] of Object.entries(assignments)) store.setPhotoPlace(fileId, placeId);
}

// Vistas: calendario, lugares y detalle de un lugar (dentro de la pestaña "Lugares")

/** Vista → cómo redibujarla al mostrarla. El detalle lo dibuja `openPlace` antes de mostrarlo. */
const VIEWS = { calendario: () => renderMonth(), lugares: () => renderPlaces(), lugar: () => {} };

for (const tab of document.querySelectorAll('.pestana')) {
  tab.addEventListener('click', () => showView(/** @type {HTMLElement} */ (tab).dataset.vista));
}

/** Muestra una vista y la vuelve a dibujar: un nombre de lugar editado se ve en todas. */
function showView(name) {
  for (const view of Object.keys(VIEWS)) $(`vista-${view}`).hidden = view !== name;
  const tabName = name === 'lugar' ? 'lugares' : name;
  for (const tab of document.querySelectorAll('.pestana')) {
    if (/** @type {HTMLElement} */ (tab).dataset.vista === tabName) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
  VIEWS[name]();
  scrollTo(0, 0);
}

// Guardado

const SAVE_LABELS = {
  idle: '',
  saving: 'Guardando…',
  saved: 'Guardado',
  error: 'No se pudo guardar, reintentando',
};

store.subscribe((status) => {
  for (const indicator of document.querySelectorAll('.guardado')) {
    indicator.textContent = SAVE_LABELS[status];
    /** @type {HTMLElement} */ (indicator).dataset.status = status;
  }
});

addEventListener('beforeunload', (event) => {
  if (!store.hasUnsavedChanges()) return;
  event.preventDefault();
  event.returnValue = ''; // Safari todavía lo necesita para mostrar el aviso
});

// Calendario

$('mes-anterior').addEventListener('click', () => moveMonth(-1));
$('mes-siguiente').addEventListener('click', () => moveMonth(1));
$('mes-selector').addEventListener('change', (event) => {
  const [year, month] = /** @type {HTMLSelectElement} */ (event.target).value.split('-').map(Number);
  if (year && month) {
    state.current = { year, month };
    renderMonth();
  }
});

function moveMonth(delta) {
  const d = utc(state.current.year, state.current.month + delta);
  state.current = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  renderMonth();
}

function renderMonthPicker() {
  const select = $('mes-selector');
  const placeholder = new Option('Ir a un mes con fotos…', '');
  placeholder.disabled = true;
  const options = [...state.months].reverse().map((m) => new Option(monthTitle.format(utc(m.year, m.month)), monthKey(m)));
  select.replaceChildren(placeholder, ...options);
}

function renderMonth() {
  const { year, month } = state.current;
  $('mes-titulo').textContent = monthTitle.format(utc(year, month));

  const select = /** @type {HTMLSelectElement} */ ($('mes-selector'));
  const key = monthKey(state.current);
  select.value = state.months.some((m) => monthKey(m) === key) ? key : '';

  const weeks = monthGrid(year, month).map((week) => {
    const row = document.createElement('div');
    row.className = 'cal-semana';
    row.setAttribute('role', 'row');
    row.append(...week.map(renderDay));
    return row;
  });
  $('semanas').replaceChildren(...weeks);
}

function renderDay({ date, day, inMonth }) {
  const cell = document.createElement('div');
  cell.setAttribute('role', 'gridcell');
  cell.dataset.date = date;
  const photos = inMonth ? state.byDay.get(date) ?? [] : [];
  cell.className = `dia ${!inMonth ? 'fuera' : photos.length ? 'con-fotos' : 'sin-fotos'}`;
  if (!inMonth) return cell;

  const label = dayLabel.format(dayFromIso(date));
  if (!photos.length) cell.setAttribute('aria-label', `${label}, sin fotos`);

  const number = document.createElement('span');
  number.className = 'dia-numero';
  number.setAttribute('aria-hidden', 'true');
  number.textContent = day;
  cell.append(number);

  if (photos.length) {
    const stack = document.createElement('div');
    stack.className = 'pila';
    // La primera foto del día queda arriba: se agrega última.
    for (const photo of photos.slice(0, MAX_STACK).reverse()) {
      const img = thumbnails.img(photo, THUMB_SIZE, `Foto del ${label}`);
      img.style.setProperty('--rot', `${rotationFor(photo.id)}deg`);
      stack.append(img);
    }
    stack.setAttribute('aria-hidden', 'true');
    cell.append(stack);
    cell.append(...counters(photos.length));

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'dia-abrir';
    open.setAttribute('aria-label', `${label}, ${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'}`);
    open.addEventListener('click', () => openDay(date));
    cell.append(open);
    renderCellNote(cell);
    renderCellPlace(cell, photos);
  }
  return cell;
}

/** Indicador del lugar con nombre con más fotos del día. */
function renderCellPlace(cell, photos) {
  const place = dayPlace(photos, store.get());
  if (!place) return;
  const el = document.createElement('span');
  el.className = 'dia-lugar';
  el.textContent = place.name;
  cell.append(el);
  cell.classList.add('con-lugar');
}

/** Primera línea de la nota del día, truncada por CSS. */
function renderCellNote(cell) {
  const firstLine = store.get().days[cell.dataset.date]?.note?.trim().split('\n')[0] ?? '';
  let el = cell.querySelector('.dia-nota');
  if (!firstLine) {
    el?.remove();
    cell.classList.remove('con-nota');
    return;
  }
  if (!el) {
    el = document.createElement('span');
    el.className = 'dia-nota';
    cell.append(el);
  }
  el.textContent = firstLine;
  cell.classList.add('con-nota');
}

/** "+N" de las fotos que no se ven: distinto en escritorio (3 visibles) y en el celular (1 visible). */
function counters(total) {
  const make = (hidden, className) => {
    const el = document.createElement('span');
    el.className = `contador ${className}`;
    el.setAttribute('aria-hidden', 'true');
    el.textContent = `+${hidden}`;
    return el;
  };
  const result = [];
  if (total > MAX_STACK) result.push(make(total - MAX_STACK, 'solo-escritorio'));
  if (total > 1) result.push(make(total - 1, 'solo-celular'));
  return result;
}

// Panel del día

const panel = /** @type {HTMLDialogElement} */ ($('panel-dia'));
const noteInput = /** @type {HTMLTextAreaElement} */ ($('panel-nota'));
const hourLabel = (photo) => photo.time.slice(11, 16);
const altFor = (photo) =>
  photoAlt(store.get().photos[photo.id]?.caption ?? '', dayLabel.format(dayFromIso(photo.time)), hourLabel(photo));

$('panel-cerrar').addEventListener('click', () => panel.close());

noteInput.addEventListener('input', () => {
  const date = panel.dataset.date;
  store.setDayNote(date, noteInput.value);
  const cell = document.querySelector(`.dia[data-date="${date}"]`);
  if (cell) renderCellNote(cell);
});

function openDay(date) {
  panel.dataset.date = date;
  $('panel-titulo').textContent = dayTitle(date);
  noteInput.value = store.get().days[date]?.note ?? '';

  $('panel-fotos').replaceChildren(...photoFigures(state.byDay.get(date) ?? []));
  panel.showModal();
  panel.scrollTop = 0;
}

/** Miniaturas con su hora; al tocar una se abre el visor, que navega entre `photos`. */
function photoFigures(photos) {
  const buttons = photos.map((photo, index) => {
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'panel-foto-abrir';
    open.append(thumbnails.img(photo, PANEL_THUMB_SIZE, altFor(photo)));
    open.addEventListener('click', () => openViewer(photos, index, buttons));
    return open;
  });
  return buttons.map((open, index) => {
    const figure = document.createElement('figure');
    figure.className = 'panel-foto';
    const caption = document.createElement('figcaption');
    caption.textContent = hourLabel(photos[index]);
    figure.append(open, caption);
    return figure;
  });
}

// Lugares

const placeName = /** @type {HTMLInputElement} */ ($('lugar-nombre'));
const placeSummary = (photos) => `${dateRange(photos)} · ${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'}`;

$('lugar-volver').addEventListener('click', () => showView('lugares'));

placeName.addEventListener('input', () => store.setPlace(placeName.dataset.placeId, { name: placeName.value }));
placeName.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') placeName.blur();
});

function renderPlaces() {
  const { places, unlocated } = placeGroups(state.photos, store.get());
  const cards = places.map((place) =>
    placeCard(placeLabel(place), place.photos, () => openPlace(place.id)),
  );
  if (unlocated.length) {
    const card = placeCard('Sin ubicación', unlocated, () => openPlace(null));
    card.classList.add('sin-ubicacion');
    cards.push(card);
  }
  $('lugares-lista').replaceChildren(...cards);
}

/** Tarjeta con las últimas fotos apiladas, el nombre, el rango de fechas y la cantidad. */
function placeCard(name, photos, onOpen) {
  const item = document.createElement('li');
  item.className = 'lugar-tarjeta';
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'lugar-tarjeta-abrir';
  open.addEventListener('click', onOpen);

  const stack = document.createElement('div');
  stack.className = 'lugar-pila';
  stack.setAttribute('aria-hidden', 'true');
  // La foto más reciente queda arriba: se agrega última.
  for (const photo of photos.slice(-MAX_STACK)) {
    const img = thumbnails.img(photo, CARD_THUMB_SIZE, '');
    img.style.setProperty('--rot', `${rotationFor(photo.id)}deg`);
    stack.append(img);
  }
  const title = document.createElement('span');
  title.className = 'lugar-tarjeta-nombre';
  title.textContent = name;
  const details = document.createElement('span');
  details.className = 'lugar-tarjeta-datos';
  details.textContent = placeSummary(photos);

  open.append(stack, title, details);
  item.append(open);
  return item;
}

/** Detalle de un lugar, o de las fotos sin ubicación si `placeId` es null. */
function openPlace(placeId) {
  const { places, unlocated } = placeGroups(state.photos, store.get());
  const place = places.find((p) => p.id === placeId);
  const photos = place?.photos ?? unlocated;

  $('lugar-nombre-campo').hidden = !place;
  $('lugar-sin-ubicacion').hidden = Boolean(place);
  placeName.dataset.placeId = placeId ?? '';
  placeName.value = place?.name ?? '';
  const mapLink = /** @type {HTMLAnchorElement} */ ($('lugar-mapa'));
  mapLink.hidden = !place;
  if (place) mapLink.href = mapsUrl(place.lat, place.lng);
  $('lugar-resumen').textContent = photos.length ? placeSummary(photos) : '';

  const sections = visits(photos).map((visit) => {
    const section = document.createElement('section');
    section.className = 'visita';
    const heading = document.createElement('h3');
    heading.className = 'visita-titulo';
    heading.textContent = dayTitle(visit.date);
    const grid = document.createElement('div');
    grid.className = 'panel-fotos';
    grid.append(...photoFigures(visit.photos));
    section.append(heading, grid);
    return section;
  });
  $('lugar-visitas').replaceChildren(...sections);
  showView('lugar');
  $('lugar-volver').focus();
}

// Visor de foto

const viewer = /** @type {HTMLDialogElement} */ ($('visor'));
const viewerImage = /** @type {HTMLImageElement} */ ($('visor-imagen'));
const captionInput = /** @type {HTMLTextAreaElement} */ ($('visor-caption'));
const placeAnchor = /** @type {HTMLAnchorElement} */ ($('visor-lugar'));
const prevButton = /** @type {HTMLButtonElement} */ ($('visor-anterior'));
const nextButton = /** @type {HTMLButtonElement} */ ($('visor-siguiente'));
const viewerState = {
  photos: [],
  index: 0,
  /** Miniaturas del panel, para devolverles el foco y actualizar su alt. */
  buttons: /** @type {HTMLButtonElement[]} */ ([]),
  /** Se incrementa en cada foto: las URLs que llegan tarde de una foto anterior se descartan. */
  shown: 0,
};

$('visor-cerrar').addEventListener('click', () => viewer.close());

// El lugar de la foto lleva a su detalle: se cierran el visor y el panel del día.
placeAnchor.addEventListener('click', (event) => {
  const { placeId } = placeAnchor.dataset;
  if (!placeId) return; // link a Google Maps
  event.preventDefault();
  viewer.close();
  panel.close();
  openPlace(placeId);
});
prevButton.addEventListener('click', () => moveViewer(-1));
nextButton.addEventListener('click', () => moveViewer(1));

// En document y no en el visor: al tocar la foto o al deshabilitarse "Foto siguiente" el foco cae en <body>.
document.addEventListener('keydown', (event) => {
  if (!viewer.open) return;
  const delta = keyAction(event.key, /** @type {HTMLElement} */ (event.target));
  if (!delta) return;
  event.preventDefault();
  moveViewer(delta);
});

// Al cerrar, el foco vuelve a la miniatura de la foto que se estaba viendo (no a la que abrió el visor).
viewer.addEventListener('close', () => viewerState.buttons[viewerState.index]?.focus());

// touch-action: pan-y en el escenario deja el scroll vertical al navegador; acá solo se mira el horizontal.
let touchStart = null;
const stage = $('visor-escenario');
stage.addEventListener(
  'touchstart',
  (event) => {
    touchStart = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
  },
  { passive: true },
);
stage.addEventListener(
  'touchend',
  (event) => {
    if (!touchStart) return;
    const touch = event.changedTouches[0];
    const direction = swipeDirection(touch.clientX - touchStart.x, touch.clientY - touchStart.y);
    touchStart = null;
    if (direction) moveViewer(direction);
  },
  { passive: true },
);

captionInput.addEventListener('input', () => {
  const photo = viewerState.photos[viewerState.index];
  store.setCaption(photo.id, captionInput.value);
  viewerImage.alt = altFor(photo);
  const thumb = viewerState.buttons[viewerState.index]?.querySelector('img');
  if (thumb) thumb.alt = viewerImage.alt;
});

// La proporción de la foto define el tamaño del marco; la chica y la grande tienen la misma.
viewerImage.addEventListener('load', () => {
  viewerImage.style.setProperty('--ratio', String(viewerImage.naturalWidth / viewerImage.naturalHeight));
});

function openViewer(photos, index, buttons) {
  Object.assign(viewerState, { photos, buttons });
  showPhoto(index, 0);
  viewer.showModal();
}

function moveViewer(delta) {
  const next = stepIndex(viewerState.index, delta, viewerState.photos.length);
  if (next !== viewerState.index) showPhoto(next, delta);
}

/** `direction`: -1 o 1 según de qué lado entra la foto, 0 al abrir. */
function showPhoto(index, direction) {
  viewerState.index = index;
  const photo = viewerState.photos[index];
  const { length } = viewerState.photos;

  $('visor-hora').textContent = hourLabel(photo);
  viewerImage.alt = altFor(photo);
  captionInput.value = store.get().photos[photo.id]?.caption ?? '';
  const place = placeLink(photo, store.get());
  placeAnchor.hidden = !place;
  if (place) {
    placeAnchor.textContent = place.label;
    if ('placeId' in place) {
      placeAnchor.href = `#${place.placeId}`;
      placeAnchor.removeAttribute('target');
      placeAnchor.dataset.placeId = place.placeId;
    } else {
      placeAnchor.href = place.href;
      placeAnchor.target = '_blank';
      delete placeAnchor.dataset.placeId;
    }
  }
  prevButton.disabled = index === 0;
  nextButton.disabled = index === length - 1;

  viewerImage.dataset.enter = String(direction);
  viewerImage.classList.remove('entra');
  void viewerImage.offsetWidth; // reinicia la animación
  viewerImage.classList.add('entra');

  loadViewerImage(photo);
}

/** Muestra enseguida la miniatura del panel (ya en caché) y la cambia por la grande cuando está lista. */
async function loadViewerImage(photo) {
  const token = ++viewerState.shown;
  let big = false;
  // Nunca queda a la vista la foto anterior con la hora y el caption de la nueva.
  viewerImage.removeAttribute('src');
  viewerImage.classList.remove('is-broken');
  thumbnails.url(photo, PANEL_THUMB_SIZE).then(
    (src) => {
      if (token === viewerState.shown && !big) viewerImage.src = src;
    },
    () => {
      if (token === viewerState.shown && !big) viewerImage.classList.add('is-broken');
    },
  );
  try {
    const src = await thumbnails.url(photo, VIEWER_SIZE);
    const preload = new Image();
    preload.src = src;
    await preload.decode();
    if (token !== viewerState.shown) return;
    big = true;
    viewerImage.classList.remove('is-broken');
    viewerImage.src = src;
  } catch (err) {
    console.warn('No se pudo cargar la foto grande; queda la miniatura', err);
  }
}

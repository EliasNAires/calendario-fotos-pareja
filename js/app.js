import { ALBUM_NAME } from '../config.js';
import { pickSource, isDemo } from './sources/index.js';
import { createThumbnails } from './thumbs.js';
import { createAlbumStore } from './album-store.js';
import { monthGrid, photosByDay, monthsWithPhotos, rotationFor } from './calendar.js';
import { swipeDirection, keyAction, stepIndex, photoAlt, placeLink } from './viewer.js';

const MAX_STACK = 3; // si cambia, ajustar .pila en styles.css; en el celular el CSS deja ver solo la primera
const THUMB_SIZE = 160; // px pedidos a la fuente; se muestran más chicas (pantallas retina)
const PANEL_THUMB_SIZE = 320; // el panel las muestra a ~200px de ancho; el visor la usa de placeholder
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
const utc = (year, month, day = 1) => new Date(Date.UTC(year, month - 1, day));
const dayFromIso = (iso) => utc(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), Number(iso.slice(8, 10)));
const monthKey = ({ year, month }) => `${year}-${String(month).padStart(2, '0')}`;

const state = {
  byDay: new Map(),
  months: [],
  current: null, // { year, month }
};

// Entrada

document.title = ALBUM_NAME;
document.querySelector('[data-album-name]').textContent = ALBUM_NAME;
$('entrada-demo').hidden = !isDemo(location.search);
$('entrar').addEventListener('click', enter);

async function enter() {
  const button = /** @type {HTMLButtonElement} */ ($('entrar'));
  const error = $('entrada-error');
  button.disabled = true;
  error.hidden = true;
  try {
    await source.signIn();
    const [photos] = await Promise.all([source.listPhotos(), store.load()]);
    state.byDay = photosByDay(photos);
    state.months = monthsWithPhotos(photos);
    const now = new Date();
    state.current = state.months.at(-1) ?? { year: now.getFullYear(), month: now.getMonth() + 1 };
    $('entrada').hidden = true;
    $('calendario').hidden = false;
    renderMonthPicker();
    renderMonth();
  } catch (err) {
    error.textContent = err instanceof Error ? err.message : String(err);
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
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
  }
  return cell;
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
  // "sábado, 14 de marzo de 2026" → "sábado 14 de marzo de 2026"
  $('panel-titulo').textContent = longDayLabel.format(dayFromIso(date)).replace(',', '');
  noteInput.value = store.get().days[date]?.note ?? '';

  const photos = state.byDay.get(date) ?? [];
  const buttons = photos.map((photo, index) => {
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'panel-foto-abrir';
    open.append(thumbnails.img(photo, PANEL_THUMB_SIZE, altFor(photo)));
    open.addEventListener('click', () => openViewer(photos, index, buttons));
    return open;
  });
  const figures = buttons.map((open, index) => {
    const figure = document.createElement('figure');
    figure.className = 'panel-foto';
    const caption = document.createElement('figcaption');
    caption.textContent = hourLabel(photos[index]);
    figure.append(open, caption);
    return figure;
  });
  $('panel-fotos').replaceChildren(...figures);
  panel.showModal();
  panel.scrollTop = 0;
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
    placeAnchor.href = place.href;
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

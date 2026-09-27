import { ALBUM_NAME } from '../config.js';
import { pickSource, isDemo } from './sources/index.js';
import { createThumbnails } from './thumbs.js';
import { monthGrid, photosByDay, monthsWithPhotos, rotationFor } from './calendar.js';

const MAX_STACK = 3; // si cambia, ajustar .pila en styles.css; en el celular el CSS deja ver solo la primera
const THUMB_SIZE = 160; // px pedidos a la fuente; se muestran más chicas (pantallas retina)

const $ = (id) => document.getElementById(id);

const source = pickSource(location.search);
const thumbnails = createThumbnails(source);

const monthTitle = new Intl.DateTimeFormat('es-AR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayLabel = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
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
    const photos = await source.listPhotos();
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
  const photos = inMonth ? state.byDay.get(date) ?? [] : [];
  cell.className = `dia ${!inMonth ? 'fuera' : photos.length ? 'con-fotos' : 'sin-fotos'}`;
  if (!inMonth) return cell;

  const label = dayLabel.format(dayFromIso(date));
  cell.setAttribute(
    'aria-label',
    photos.length ? `${label}, ${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'}` : `${label}, sin fotos`,
  );

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
  }
  return cell;
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

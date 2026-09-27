import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monthGrid, photosByDay, monthsWithPhotos, rotationFor } from '../js/calendar.js';

test('la grilla de septiembre 2026 empieza el lunes 31 de agosto y termina el domingo 4 de octubre', () => {
  const weeks = monthGrid(2026, 9);
  assert.equal(weeks.length, 5);
  assert.ok(weeks.every((w) => w.length === 7));
  assert.deepEqual(weeks[0][0], { date: '2026-08-31', day: 31, inMonth: false });
  assert.deepEqual(weeks[0][1], { date: '2026-09-01', day: 1, inMonth: true });
  assert.deepEqual(weeks[4][6], { date: '2026-10-04', day: 4, inMonth: false });
});

test('febrero 2027 arranca lunes y termina domingo: 4 semanas sin días de otros meses', () => {
  const weeks = monthGrid(2027, 2);
  assert.equal(weeks.length, 4);
  assert.equal(weeks[0][0].date, '2027-02-01');
  assert.equal(weeks[3][6].date, '2027-02-28');
  assert.ok(weeks.flat().every((c) => c.inMonth));
});

test('las fotos se agrupan por el día de su hora local de cámara, ordenadas por hora', () => {
  const photos = [
    { id: 'b', name: 'b.jpg', time: '2026-09-12T18:30:00' },
    { id: 'c', name: 'c.jpg', time: '2026-09-13T00:05:00' },
    { id: 'a', name: 'a.jpg', time: '2026-09-12T09:00:00' },
  ];
  const byDay = photosByDay(photos);
  assert.deepEqual([...byDay.keys()].sort(), ['2026-09-12', '2026-09-13']);
  assert.deepEqual(byDay.get('2026-09-12').map((p) => p.id), ['a', 'b']);
  assert.deepEqual(byDay.get('2026-09-13').map((p) => p.id), ['c']);
});

test('meses con fotos: únicos y en orden cronológico; el último es el mes con que abre el calendario', () => {
  const photos = [
    { id: '1', name: '', time: '2026-03-02T10:00:00' },
    { id: '2', name: '', time: '2025-11-30T10:00:00' },
    { id: '3', name: '', time: '2026-03-20T10:00:00' },
    { id: '4', name: '', time: '2026-01-01T00:00:00' },
  ];
  assert.deepEqual(monthsWithPhotos(photos), [
    { year: 2025, month: 11 },
    { year: 2026, month: 1 },
    { year: 2026, month: 3 },
  ]);
  assert.deepEqual(monthsWithPhotos([]), []);
});

test('la rotación de una foto depende solo de su id y queda entre -4° y 4°', () => {
  const ids = Array.from({ length: 500 }, (_, i) => `foto_${i}`);
  const first = ids.map(rotationFor);
  const again = ids.map(rotationFor);
  assert.deepEqual(again, first);
  assert.ok(first.every((deg) => deg >= -4 && deg <= 4));
  // No es constante: las fotos apiladas se ven desparejas.
  assert.ok(new Set(first.map((d) => Math.round(d))).size >= 5);
  assert.ok(first.some((d) => d < 0) && first.some((d) => d > 0));
});

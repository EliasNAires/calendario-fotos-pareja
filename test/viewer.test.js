import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyAlbum } from '../js/album.js';
import { swipeDirection, keyAction, stepIndex, photoAlt, placeLink } from '../js/viewer.js';

test('deslizar hacia la izquierda pasa a la siguiente foto y hacia la derecha a la anterior', () => {
  assert.equal(swipeDirection(-80, 10), 1);
  assert.equal(swipeDirection(80, -10), -1);
});

test('un deslizamiento corto o mayormente vertical (scroll) no cambia de foto', () => {
  assert.equal(swipeDirection(-40, 0), 0);
  assert.equal(swipeDirection(-70, 90), 0);
  assert.equal(swipeDirection(0, 0), 0);
});

test('← y → pasan de foto', () => {
  const body = { tagName: 'BODY' };
  assert.equal(keyAction('ArrowLeft', body), -1);
  assert.equal(keyAction('ArrowRight', body), 1);
  assert.equal(keyAction('Enter', body), 0);
});

test('mientras se escribe el caption, las flechas mueven el cursor y no cambian de foto', () => {
  assert.equal(keyAction('ArrowLeft', { tagName: 'TEXTAREA' }), 0);
  assert.equal(keyAction('ArrowRight', { tagName: 'INPUT' }), 0);
});

test('se avanza y retrocede dentro del día sin dar la vuelta', () => {
  assert.equal(stepIndex(0, 1, 4), 1);
  assert.equal(stepIndex(2, -1, 4), 1);
  assert.equal(stepIndex(3, 1, 4), 3);
  assert.equal(stepIndex(0, -1, 4), 0);
});

test('el alt es el caption; sin caption, la fecha y la hora', () => {
  assert.equal(photoAlt('  El mate en la plaza ', '14 de marzo', '17:42'), 'El mate en la plaza');
  assert.equal(photoAlt('', '14 de marzo', '17:42'), 'Foto del 14 de marzo a las 17:42');
  assert.equal(photoAlt('   ', '14 de marzo', '17:42'), 'Foto del 14 de marzo a las 17:42');
});

test('una foto en un lugar muestra su nombre con link a Google Maps en las coordenadas del lugar', () => {
  const album = emptyAlbum();
  album.places.p_abc12345 = { name: 'La plaza', lat: -34.578, lng: -58.427 };
  album.photos.f1 = { caption: '', placeId: 'p_abc12345' };
  assert.deepEqual(placeLink({ id: 'f1', lat: -34.5781, lng: -58.4271 }, album), {
    label: 'La plaza',
    href: 'https://www.google.com/maps?q=-34.578,-58.427',
  });
});

test('un lugar sin nombre se muestra como "Lugar sin nombre"', () => {
  const album = emptyAlbum();
  album.places.p_abc12345 = { name: '', lat: -34.578, lng: -58.427 };
  album.photos.f1 = { caption: '', placeId: 'p_abc12345' };
  assert.equal(placeLink({ id: 'f1', lat: -34.578, lng: -58.427 }, album)?.label, 'Lugar sin nombre');
});

test('una foto con GPS pero sin lugar asignado linkea a sus propias coordenadas', () => {
  assert.deepEqual(placeLink({ id: 'f1', lat: -38.0055, lng: -57.5426 }, emptyAlbum()), {
    label: 'Ver en el mapa',
    href: 'https://www.google.com/maps?q=-38.0055,-57.5426',
  });
});

test('una foto sin GPS no tiene lugar', () => {
  assert.equal(placeLink({ id: 'f1' }, emptyAlbum()), null);
});

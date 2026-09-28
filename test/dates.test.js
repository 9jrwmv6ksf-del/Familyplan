import { test } from 'node:test';
import assert from 'node:assert/strict';
import { occursOn, addDays, startOfWeek, describeRepeat, nextOccurrence } from '../public/js/dates.js';

test('einmalige Termine finden nur an ihrem Tag statt', () => {
  const e = { date: '2026-03-10', repeat: 'none' };
  assert.equal(occursOn(e, '2026-03-10'), true);
  assert.equal(occursOn(e, '2026-03-11'), false);
});

test('tägliche Wiederholung mit Enddatum', () => {
  const e = { date: '2026-03-10', repeat: 'daily', until: '2026-03-12' };
  assert.equal(occursOn(e, '2026-03-09'), false);
  assert.equal(occursOn(e, '2026-03-12'), true);
  assert.equal(occursOn(e, '2026-03-13'), false);
});

test('wöchentlich an ausgewählten Wochentagen', () => {
  // 2026-03-09 ist ein Montag
  const e = { date: '2026-03-09', repeat: 'weekly', weekdays: [1, 3] };
  assert.equal(occursOn(e, '2026-03-09'), true);
  assert.equal(occursOn(e, '2026-03-10'), false);
  assert.equal(occursOn(e, '2026-03-11'), true);
  assert.equal(occursOn(e, '2026-03-16'), true);
  assert.equal(describeRepeat(e), 'Jeden Mo, Mi');
});

test('wöchentlich ohne Tage = Wochentag des Startdatums', () => {
  const e = { date: '2026-03-12', repeat: 'weekly', weekdays: [] };
  assert.equal(occursOn(e, '2026-03-19'), true);
  assert.equal(occursOn(e, '2026-03-20'), false);
});

test('monatlich und jährlich', () => {
  assert.equal(occursOn({ date: '2026-01-31', repeat: 'monthly' }, '2026-03-31'), true);
  assert.equal(occursOn({ date: '2026-01-31', repeat: 'monthly' }, '2026-02-28'), false);
  assert.equal(occursOn({ date: '2020-05-04', repeat: 'yearly' }, '2026-05-04'), true);
  assert.equal(occursOn({ date: '2020-05-04', repeat: 'yearly' }, '2026-06-04'), false);
});

test('ausgelassene Tage einer Serie', () => {
  const e = { date: '2026-03-10', repeat: 'daily', skip: ['2026-03-11'] };
  assert.equal(occursOn(e, '2026-03-11'), false);
  assert.equal(nextOccurrence(e, '2026-03-11'), '2026-03-12');
});

test('Datumsrechnung über Monats- und Zeitumstellungsgrenzen', () => {
  assert.equal(addDays('2026-03-28', 2), '2026-03-30');
  assert.equal(addDays('2026-10-24', 7), '2026-10-31');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(startOfWeek('2026-03-15'), '2026-03-09'); // Sonntag → Montag davor
  assert.equal(startOfWeek('2026-03-09'), '2026-03-09');
});

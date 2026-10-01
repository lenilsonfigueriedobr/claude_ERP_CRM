import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeEnd, conflictsWith, findConflicts, datesSpanned, suggestStart, durationProblem, toMinutes, isValidDateTime,
} from '../src/lib/eventRules.js';

const ev = (id, start, end, status = 'confirmado') => ({ id, start_at: start, end_at: end, status });

test('horário final é calculado a partir do início e da duração', () => {
  assert.equal(computeEnd('2026-10-10T14:00', 4 * 60), '2026-10-10T18:00');
  assert.equal(computeEnd('2026-10-10T19:00', 6 * 60), '2026-10-11T01:00');
  assert.equal(computeEnd('2026-12-31T22:30', 5 * 60), '2027-01-01T03:30');
});

test('durações válidas: presets e personalizadas em blocos de 15 min', () => {
  for (const h of [4, 5, 6]) assert.equal(durationProblem(h * 60), null);
  assert.equal(durationProblem(7 * 60 + 30), null);
  assert.match(durationProblem(30), /pelo menos 1 hora/);
  assert.match(durationProblem(25 * 60), /no máximo 24/);
  assert.match(durationProblem(4 * 60 + 10), /15 minutos/);
});

test('mesmo horário na mesma unidade é conflito', () => {
  assert.ok(conflictsWith(ev(1, '2026-10-10T14:00', '2026-10-10T18:00'), ev(2, '2026-10-10T14:00', '2026-10-10T18:00')));
});

test('exige intervalo mínimo de 2h entre eventos', () => {
  const a = ev(1, '2026-10-10T12:00', '2026-10-10T16:00');
  // terminou 16h: 17h59 não pode, 18h pode
  assert.ok(conflictsWith(a, ev(2, '2026-10-10T17:59', '2026-10-10T21:59')));
  assert.ok(conflictsWith(a, ev(2, '2026-10-10T17:00', '2026-10-10T21:00')));
  assert.equal(conflictsWith(a, ev(2, '2026-10-10T18:00', '2026-10-10T22:00')), false);
  // e no sentido contrário: evento antes precisa terminar 2h antes do início
  assert.ok(conflictsWith(a, ev(3, '2026-10-10T06:00', '2026-10-10T10:30')));
  assert.equal(conflictsWith(a, ev(3, '2026-10-10T06:00', '2026-10-10T10:00')), false);
});

test('eventos cancelados não bloqueiam a agenda', () => {
  const candidate = ev(null, '2026-10-10T14:00', '2026-10-10T18:00');
  assert.equal(findConflicts(candidate, [ev(9, '2026-10-10T14:00', '2026-10-10T18:00', 'cancelado')]).length, 0);
});

test('o próprio evento é ignorado ao editar', () => {
  const candidate = ev(5, '2026-10-10T15:00', '2026-10-10T19:00');
  assert.equal(findConflicts(candidate, [ev(5, '2026-10-10T14:00', '2026-10-10T18:00')]).length, 0);
});

test('dias ocupados: evento que vira a noite ocupa os dois dias', () => {
  assert.deepEqual(datesSpanned('2026-10-10T20:00', '2026-10-11T02:00'), ['2026-10-10', '2026-10-11']);
  assert.deepEqual(datesSpanned('2026-10-10T18:00', '2026-10-11T00:00'), ['2026-10-10']);
});

test('sugere o próximo horário livre respeitando o intervalo', () => {
  const existing = [ev(1, '2026-10-10T10:00', '2026-10-10T14:00'), ev(2, '2026-10-10T16:00', '2026-10-10T20:00')];
  const candidate = ev(null, '2026-10-10T11:00', '2026-10-10T15:00');
  assert.equal(suggestStart(candidate, existing), '2026-10-10T22:00');
});

test('valida formato de data e hora', () => {
  assert.ok(isValidDateTime('2026-02-28T10:00'));
  assert.equal(isValidDateTime('2026-02-30T10:00'), false);
  assert.equal(isValidDateTime('2026-02-10T24:00'), false);
  assert.ok(Number.isNaN(toMinutes('bobagem')));
});

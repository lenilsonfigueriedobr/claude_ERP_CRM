import {
  computeEnd, datesSpanned, durationProblem, findConflicts, searchWindow, suggestStart, isValidDateTime,
  MIN_GAP_MINUTES, fromMinutes, toMinutes,
} from './eventRules.js';
import { badRequest, conflict } from './errors.js';
import { dateBR } from './format.js';

const hm = (v) => v.slice(11, 16);

// Verifica a agenda sem lançar erro: devolve bloqueios, conflitos e sugestão de horário.
export function checkSchedule(db, { unitId, startAt, durationMinutes, excludeId = null, guests = null }) {
  if (!isValidDateTime(startAt)) throw badRequest('Data e horário de início inválidos.');
  const problem = durationProblem(durationMinutes);
  if (problem) throw badRequest(problem);
  const unit = db.prepare('SELECT * FROM units WHERE id = ?').get(unitId);
  if (!unit) throw badRequest('Unidade não encontrada.');

  const endAt = computeEnd(startAt, durationMinutes);
  const days = datesSpanned(startAt, endAt);
  const blocks = db.prepare(`SELECT b.*, u.name AS unit_name FROM blocked_dates b LEFT JOIN units u ON u.id = b.unit_id
    WHERE b.date IN (${days.map(() => '?').join(',')}) AND (b.unit_id IS NULL OR b.unit_id = ?)`).all(...days, unitId);

  const loadNear = (from, to) => db.prepare(`SELECT id, title, start_at, end_at, status FROM events
    WHERE unit_id = ? AND status <> 'cancelado' AND start_at < ? AND end_at > ? AND id <> ?`).all(unitId, to, from, excludeId ?? 0);

  const { from, to } = searchWindow(startAt, endAt);
  const candidate = { id: excludeId, start_at: startAt, end_at: endAt };
  const conflicts = findConflicts(candidate, loadNear(from, to));

  let suggestion = null;
  if (conflicts.length) {
    const dayStart = toMinutes(`${startAt.slice(0, 10)}T00:00`);
    const sameDay = loadNear(fromMinutes(dayStart - MIN_GAP_MINUTES), fromMinutes(dayStart + 2 * 1440 + MIN_GAP_MINUTES));
    suggestion = suggestStart(candidate, sameDay);
    if (suggestion) {
      const sEnd = computeEnd(suggestion, durationMinutes);
      const sDays = datesSpanned(suggestion, sEnd);
      const blocked = db.prepare(`SELECT COUNT(*) AS n FROM blocked_dates WHERE date IN (${sDays.map(() => '?').join(',')})
        AND (unit_id IS NULL OR unit_id = ?)`).get(...sDays, unitId).n;
      if (blocked) suggestion = null;
    }
  }

  const capacityIssue = guests && guests > unit.capacity
    ? `A unidade ${unit.name} comporta no máximo ${unit.capacity} pessoas (informado: ${guests}).`
    : null;

  return { endAt, unit, blocks, conflicts, suggestion, capacityIssue, ok: !blocks.length && !conflicts.length && !capacityIssue };
}

export function describeConflict(result) {
  if (result.blocks.length) {
    const b = result.blocks[0];
    const scope = b.unit_id ? `para a unidade ${b.unit_name}` : 'para todas as unidades';
    return `A data ${dateBR(b.date)} está bloqueada ${scope}${b.reason ? ` (${b.reason})` : ''}. Não é possível agendar eventos nela.`;
  }
  if (result.conflicts.length) {
    const c = result.conflicts[0];
    let msg = `Conflito com o evento "${c.title}" em ${dateBR(c.start_at)}, das ${hm(c.start_at)} às ${hm(c.end_at)}, nesta unidade. `
      + 'É obrigatório um intervalo mínimo de 2 horas entre o fim de um evento e o início do próximo.';
    if (result.suggestion) msg += ` Próximo horário disponível no dia: ${hm(result.suggestion)}.`;
    return msg;
  }
  return result.capacityIssue;
}

export function assertSchedule(db, args) {
  const result = checkSchedule(db, args);
  if (result.blocks.length || result.conflicts.length) {
    throw conflict(describeConflict(result), { conflicts: result.conflicts, suggestion: result.suggestion });
  }
  if (result.capacityIssue) throw badRequest(result.capacityIssue);
  return result;
}

// Eventos ativos que ocupam um determinado dia (em uma unidade ou em todas).
export function eventsOnDate(db, date, unitId = null) {
  const next = fromMinutes(toMinutes(`${date}T00:00`) + 1440);
  return db.prepare(`SELECT e.id, e.title, e.start_at, e.end_at, u.name AS unit_name FROM events e JOIN units u ON u.id = e.unit_id
    WHERE e.status IN ('pre_reserva','confirmado') AND e.start_at < ? AND e.end_at > ? AND (? IS NULL OR e.unit_id = ?)
    ORDER BY e.start_at`).all(next, `${date}T00:00`, unitId, unitId);
}

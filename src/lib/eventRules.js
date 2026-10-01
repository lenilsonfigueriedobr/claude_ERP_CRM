// Regras de agenda. Datas são tratadas como horário local da casa de eventos no formato
// "YYYY-MM-DDTHH:MM", sem fuso. Internamente tudo vira minutos desde 1970 (via Date.UTC),
// o que evita surpresas com horário de verão ou fuso do servidor.

export const MIN_GAP_MINUTES = 120; // intervalo obrigatório entre o fim de um evento e o início do próximo
export const DURATION_PRESETS_HOURS = [4, 5, 6];
export const MIN_DURATION_MINUTES = 60;
export const MAX_DURATION_MINUTES = 24 * 60;
export const DURATION_STEP_MINUTES = 15;

const DATETIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDate(value) {
  const m = DATE_RE.exec(value || '');
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

export function toMinutes(value) {
  const m = DATETIME_RE.exec(value || '');
  if (!m) return NaN;
  const [, y, mo, d, h, mi] = m.map(Number);
  if (h > 23 || mi > 59 || !isValidDate(value.slice(0, 10))) return NaN;
  return Date.UTC(y, mo - 1, d, h, mi) / 60000;
}

export function fromMinutes(minutes) {
  const d = new Date(minutes * 60000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function isValidDateTime(value) {
  return Number.isFinite(toMinutes(value));
}

export function durationProblem(durationMinutes) {
  if (!Number.isInteger(durationMinutes)) return 'A duração do evento é inválida.';
  if (durationMinutes < MIN_DURATION_MINUTES) return 'O evento precisa durar pelo menos 1 hora.';
  if (durationMinutes > MAX_DURATION_MINUTES) return 'O evento pode durar no máximo 24 horas.';
  if (durationMinutes % DURATION_STEP_MINUTES !== 0) return 'A duração deve ser em blocos de 15 minutos.';
  return null;
}

// O horário final é sempre calculado a partir do início + duração.
export function computeEnd(startAt, durationMinutes) {
  const start = toMinutes(startAt);
  if (!Number.isFinite(start)) throw new Error('Horário de início inválido');
  return fromMinutes(start + durationMinutes);
}

// Dois eventos conflitam se, contando 2h de folga, os intervalos se tocam.
// Ex.: evento A termina 16:00 -> o próximo pode começar a partir de 18:00 (inclusive).
export function conflictsWith(a, b, gap = MIN_GAP_MINUTES) {
  const aStart = toMinutes(a.start_at);
  const aEnd = toMinutes(a.end_at);
  const bStart = toMinutes(b.start_at);
  const bEnd = toMinutes(b.end_at);
  return aStart < bEnd + gap && bStart < aEnd + gap;
}

export function findConflicts(candidate, existing, gap = MIN_GAP_MINUTES) {
  return existing.filter((e) => e.id !== candidate.id && e.status !== 'cancelado' && conflictsWith(candidate, e, gap));
}

// Janela de busca no banco: qualquer evento que termine depois de (início - gap)
// e comece antes de (fim + gap) é candidato a conflito.
export function searchWindow(startAt, endAt, gap = MIN_GAP_MINUTES) {
  return {
    from: fromMinutes(toMinutes(startAt) - gap),
    to: fromMinutes(toMinutes(endAt) + gap),
  };
}

// Dias de calendário ocupados pelo evento. Um evento que termina exatamente à meia-noite
// não ocupa o dia seguinte.
export function datesSpanned(startAt, endAt) {
  const start = toMinutes(startAt);
  const end = toMinutes(endAt) - 1;
  const days = [];
  for (let day = Math.floor(start / 1440); day <= Math.floor(end / 1440); day += 1) {
    days.push(fromMinutes(day * 1440).slice(0, 10));
  }
  return days;
}

// Sugere o primeiro horário livre no mesmo dia, depois dos conflitos, respeitando a folga.
export function suggestStart(candidate, existing, gap = MIN_GAP_MINUTES) {
  const duration = toMinutes(candidate.end_at) - toMinutes(candidate.start_at);
  const dayEnd = (Math.floor(toMinutes(candidate.start_at) / 1440) + 1) * 1440;
  let start = toMinutes(candidate.start_at);
  for (let i = 0; i < 50; i += 1) {
    const probe = { id: candidate.id, start_at: fromMinutes(start), end_at: fromMinutes(start + duration) };
    const hits = findConflicts(probe, existing, gap);
    if (!hits.length) return start < dayEnd ? probe.start_at : null;
    start = Math.max(...hits.map((h) => toMinutes(h.end_at))) + gap;
    if (start >= dayEnd) return null;
  }
  return null;
}

export function formatHourMinute(value) {
  return value.slice(11, 16);
}

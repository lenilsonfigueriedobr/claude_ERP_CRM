const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const WEEKDAYS = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
export const WEEKDAYS_SHORT = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export const pad = (n) => String(n).padStart(2, '0');

export function brl(cents) {
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export function brlShort(cents) {
  const v = Number(cents || 0) / 100;
  if (Math.abs(v) >= 1e6) return `R$ ${(v / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (Math.abs(v) >= 1e3) return `R$ ${(v / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return brl(cents);
}

// "1.234,56" -> 123456 (centavos)
export function parseMoney(text) {
  if (typeof text === 'number') return Math.round(text * 100);
  const clean = String(text || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(clean);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function moneyInputValue(cents) {
  return (Number(cents || 0) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function dateBR(value) {
  if (!value) return '';
  const [y, m, d] = value.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function dateTimeBR(value) {
  if (!value) return '';
  // Datas do SQLite (UTC, "YYYY-MM-DD HH:MM:SS") viram horário local.
  if (value.length >= 19 && value[10] === ' ') {
    const d = new Date(`${value.replace(' ', 'T')}Z`);
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return `${dateBR(value)} ${value.slice(11, 16)}`;
}

export const hm = (value) => (value ? value.slice(11, 16) : '');

export function timeRange(start, end) {
  const nextDay = end.slice(0, 10) !== start.slice(0, 10);
  return `${hm(start)} às ${hm(end)}${nextDay ? ' (+1 dia)' : ''}`;
}

export function longDate(iso) {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  const wd = new Date(y, m - 1, d).getDay();
  const w = WEEKDAYS[wd];
  return `${w[0].toUpperCase()}${w.slice(1)}, ${d} de ${MONTHS[m - 1]}`;
}

export const monthName = (m) => MONTHS[m];
export const monthShort = (m) => MONTHS_SHORT[m];

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return dt.toISOString().slice(0, 10);
}

export function addMinutes(dateTime, minutes) {
  const [date, time] = dateTime.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, h, mi + minutes));
  return dt.toISOString().slice(0, 16);
}

export function durationLabel(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h${pad(m)}` : `${h}h`;
}

export function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();
}

export function phoneBR(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return raw || '';
}

export function docBR(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return raw || '';
}

export const EVENT_STATUS = {
  pre_reserva: { label: 'Pré-reserva', tone: 'amber' },
  confirmado: { label: 'Confirmado', tone: 'green' },
  realizado: { label: 'Realizado', tone: 'blue' },
  cancelado: { label: 'Cancelado', tone: 'gray' },
};

export const CONTRACT_STATUS = {
  rascunho: { label: 'Rascunho', tone: 'gray' },
  enviado: { label: 'Enviado', tone: 'blue' },
  assinado: { label: 'Assinado', tone: 'green' },
  cancelado: { label: 'Cancelado', tone: 'red' },
};

export const DEAL_STAGES = [
  { key: 'novo', label: 'Novo lead', color: '#8f84c9' },
  { key: 'contato', label: 'Primeiro contato', color: '#6d5bd0' },
  { key: 'visita', label: 'Visita agendada', color: '#2a78d6' },
  { key: 'proposta', label: 'Proposta enviada', color: '#b8913f' },
  { key: 'negociacao', label: 'Negociação', color: '#d07a2e' },
  { key: 'ganho', label: 'Ganho', color: '#17885d' },
  { key: 'perdido', label: 'Perdido', color: '#c63d4f' },
];

export const EVENT_TYPES = ['Casamento', 'Aniversário', '15 anos', 'Formatura', 'Corporativo', 'Confraternização', 'Batizado', 'Chá de bebê', 'Bodas', 'Outro'];
export const LEAD_SOURCES = ['Instagram', 'Indicação', 'Site', 'Google', 'WhatsApp', 'Facebook', 'Feira/evento', 'Outro'];
export const PAYMENT_METHODS = ['PIX', 'Boleto', 'Cartão de crédito', 'Cartão de débito', 'Transferência', 'Dinheiro'];

import { Router } from 'express';
import { z, parse, text, optText, id, optId, money, dateTime, date } from '../lib/validate.js';
import { badRequest, notFound, conflict } from '../lib/errors.js';
import { requirePerm } from '../middleware/auth.js';
import { checkSchedule, assertSchedule, describeConflict, eventsOnDate } from '../lib/schedule.js';
import { DURATION_PRESETS_HOURS, MIN_GAP_MINUTES, isValidDate, toMinutes, fromMinutes } from '../lib/eventRules.js';
import { moveStock } from '../lib/stock.js';
import { audit } from '../lib/audit.js';
import { dateBR } from '../lib/format.js';

export const EVENT_STATUSES = ['pre_reserva', 'confirmado', 'realizado', 'cancelado'];

const itemSchema = z.object({
  product_id: optId,
  description: text('Descrição do item', 200),
  quantity: z.coerce.number({ error: 'Quantidade inválida.' }).positive('A quantidade precisa ser maior que zero.').max(1e6),
  unit_price_cents: money('Preço do item'),
});

const eventSchema = z.object({
  title: text('Nome do evento', 150),
  client_id: id('Cliente'),
  unit_id: id('Unidade'),
  deal_id: optId,
  event_type: optText(60),
  start_at: dateTime('Início do evento'),
  duration_minutes: z.coerce.number({ error: 'Duração inválida.' }).int('Duração inválida.'),
  guests: z.union([z.coerce.number().int().min(0).max(100000), z.literal(''), z.null()]).optional()
    .transform((v) => (v === '' || v === undefined ? null : v)),
  status: z.enum(['pre_reserva', 'confirmado', 'realizado']).optional().default('pre_reserva'),
  discount_cents: money('Desconto').optional().default(0),
  notes: optText(4000),
  items: z.array(itemSchema).max(200).optional().default([]),
});

const itemsTotal = (items) => items.reduce((sum, i) => sum + Math.round(i.quantity * i.unit_price_cents), 0);

export function eventsRouter({ db }) {
  const r = Router();

  const loadEvent = async (eventId) => (await db.get(`SELECT e.*, c.name AS client_name, c.whatsapp AS client_whatsapp, c.phone AS client_phone,
      c.email AS client_email, u.name AS unit_name, u.location AS unit_location, u.capacity AS unit_capacity, u.color AS unit_color,
      us.name AS created_by_name
    FROM events e JOIN clients c ON c.id = e.client_id JOIN units u ON u.id = e.unit_id
    LEFT JOIN users us ON us.id = e.created_by WHERE e.id = ?`, eventId));

  const validateRefs = async (b) => {
    if (!(await db.get('SELECT id FROM clients WHERE id = ?', b.client_id))) throw badRequest('Cliente não encontrado.');
    const unit = (await db.get('SELECT active FROM units WHERE id = ?', b.unit_id));
    if (!unit) throw badRequest('Unidade não encontrada.');
    if (!unit.active) throw badRequest('Esta unidade está inativa.');
    if (b.deal_id && !(await db.get('SELECT id FROM deals WHERE id = ?', b.deal_id))) throw badRequest('Negociação não encontrada.');
    for (const item of b.items) {
      if (item.product_id && !(await db.get('SELECT id FROM products WHERE id = ?', item.product_id))) {
        throw badRequest(`Item "${item.description}" não encontrado no cadastro.`);
      }
    }
    const total = itemsTotal(b.items);
    if (b.discount_cents > total) throw badRequest('O desconto não pode ser maior que o valor dos itens.');
    return total - b.discount_cents;
  };

  const saveItems = async (tx, eventId, items) => {
    await tx.run('DELETE FROM event_items WHERE event_id = ?', eventId);
    for (const i of items) {
      await tx.run('INSERT INTO event_items (event_id, product_id, description, quantity, unit_price_cents) VALUES (?, ?, ?, ?, ?)',
        eventId, i.product_id, i.description, i.quantity, i.unit_price_cents);
    }
  };

  r.get('/events/rules', requirePerm('events', 'r'), async (req, res) => {
    res.json({ durationPresetsHours: DURATION_PRESETS_HOURS, minGapMinutes: MIN_GAP_MINUTES, statuses: EVENT_STATUSES });
  });

  r.get('/events', requirePerm('events', 'r'), async (req, res) => {
    const from = isValidDate(req.query.from) ? `${req.query.from}T00:00` : '';
    const to = isValidDate(req.query.to) ? `${req.query.to}T23:59` : '';
    const unitId = Number(req.query.unit_id) || 0;
    const clientId = Number(req.query.client_id) || 0;
    const status = EVENT_STATUSES.includes(req.query.status) ? req.query.status : '';
    const q = String(req.query.q || '').trim().slice(0, 100);
    res.json((await db.all(`SELECT e.id, e.title, e.event_type, e.start_at, e.end_at, e.duration_minutes, e.guests, e.status, e.total_cents,
        e.client_id, c.name AS client_name, c.whatsapp AS client_whatsapp, c.phone AS client_phone,
        e.unit_id, u.name AS unit_name, u.color AS unit_color,
        (SELECT COUNT(*) FROM contracts ct WHERE ct.event_id = e.id AND ct.status <> 'cancelado') AS contracts_count
      FROM events e JOIN clients c ON c.id = e.client_id JOIN units u ON u.id = e.unit_id
      WHERE (? = '' OR e.end_at >= ?) AND (? = '' OR e.start_at <= ?) AND (? = 0 OR e.unit_id = ?) AND (? = 0 OR e.client_id = ?)
        AND (? = '' OR e.status = ?) AND (? = '' OR e.title LIKE ? OR c.name LIKE ?)
      ORDER BY e.start_at LIMIT 1000`, from, from, to, to, unitId, unitId, clientId, clientId, status, status, q, `%${q}%`, `%${q}%`)));
  });

  r.get('/events/:id', requirePerm('events', 'r'), async (req, res) => {
    const eventId = Number(req.params.id);
    const event = await loadEvent(eventId);
    if (!event) throw notFound('Evento não encontrado.');
    event.items = (await db.all(`SELECT i.*, p.type AS product_type, p.unit_measure FROM event_items i
      LEFT JOIN products p ON p.id = i.product_id WHERE i.event_id = ? ORDER BY i.id`, eventId));
    event.contracts = (await db.all('SELECT id, number, status, public_token, accepted_at, sent_at, created_at FROM contracts WHERE event_id = ? ORDER BY id DESC', eventId));
    event.transactions = (await db.all("SELECT * FROM transactions WHERE event_id = ? AND type = 'receber' ORDER BY due_date", eventId));
    event.forms = (await db.all('SELECT id, type, status, response, created_at, responded_at FROM forms WHERE event_id = ? ORDER BY id DESC', eventId))
      .map((f) => ({ ...f, response: f.response ? JSON.parse(f.response) : null }));
    res.json(event);
  });

  // Consulta de disponibilidade usada pelo formulário antes de salvar.
  r.post('/events/availability', requirePerm('events', 'r'), async (req, res) => {
    const b = parse(z.object({
      unit_id: id('Unidade'),
      start_at: dateTime('Início do evento'),
      duration_minutes: z.coerce.number().int(),
      exclude_id: optId,
      guests: z.coerce.number().int().min(0).optional().nullable(),
    }), req.body);
    const result = await checkSchedule(db, { unitId: b.unit_id, startAt: b.start_at, durationMinutes: b.duration_minutes, excludeId: b.exclude_id, guests: b.guests });
    res.json({
      ok: result.ok,
      end_at: result.endAt,
      message: result.ok ? 'Horário disponível.' : describeConflict(result),
      suggestion: result.suggestion,
      conflicts: result.conflicts,
    });
  });

  r.post('/events', requirePerm('events', 'w'), async (req, res) => {
    const b = parse(eventSchema, req.body);
    const total = await validateRefs(b);
    const eventId = await db.transaction(async (tx) => {
      const { endAt } = await assertSchedule(tx, { unitId: b.unit_id, startAt: b.start_at, durationMinutes: b.duration_minutes, guests: b.guests });
      const info = (await tx.run(`INSERT INTO events (title, client_id, unit_id, deal_id, event_type, start_at, end_at, duration_minutes, guests,
          status, discount_cents, total_cents, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, b.title, b.client_id, b.unit_id, b.deal_id, b.event_type, b.start_at, endAt, b.duration_minutes, b.guests,
          b.status, b.discount_cents, total, b.notes, req.user.id));
      const newId = Number(info.lastInsertRowid);
      await saveItems(tx, newId, b.items);
      if (b.deal_id) {
        (await tx.run("UPDATE deals SET stage = 'ganho', closed_at = COALESCE(closed_at, datetime('now')), updated_at = datetime('now') WHERE id = ?", b.deal_id));
      }
      return newId;
    });
    await audit(db, req, 'criou', 'events', eventId, { start_at: b.start_at, unit_id: b.unit_id });
    res.status(201).json(await loadEvent(eventId));
  });

  r.put('/events/:id', requirePerm('events', 'w'), async (req, res) => {
    const eventId = Number(req.params.id);
    const current = (await db.get('SELECT * FROM events WHERE id = ?', eventId));
    if (!current) throw notFound('Evento não encontrado.');
    if (current.status === 'cancelado') throw badRequest('Evento cancelado não pode ser editado. Reative-o primeiro.');
    const b = parse(eventSchema, req.body);
    const total = await validateRefs(b);
    if (current.stock_consumed) {
      const before = (await db.all('SELECT product_id, quantity FROM event_items WHERE event_id = ? ORDER BY id', eventId))
        .map((i) => `${i.product_id}:${i.quantity}`).join('|');
      const after = b.items.map((i) => `${i.product_id}:${i.quantity}`).join('|');
      if (before !== after) throw badRequest('O estoque deste evento já foi baixado. Os itens e quantidades não podem mais ser alterados.');
    }
    await db.transaction(async (tx) => {
      const { endAt } = await assertSchedule(tx, { unitId: b.unit_id, startAt: b.start_at, durationMinutes: b.duration_minutes, excludeId: eventId, guests: b.guests });
      (await tx.run(`UPDATE events SET title = ?, client_id = ?, unit_id = ?, deal_id = ?, event_type = ?, start_at = ?, end_at = ?,
          duration_minutes = ?, guests = ?, status = ?, discount_cents = ?, total_cents = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`, b.title, b.client_id, b.unit_id, b.deal_id, b.event_type, b.start_at, endAt, b.duration_minutes, b.guests,
          b.status, b.discount_cents, total, b.notes, eventId));
      await saveItems(tx, eventId, b.items);
    });
    await audit(db, req, 'alterou', 'events', eventId, { start_at: b.start_at, unit_id: b.unit_id, status: b.status });
    res.json(await loadEvent(eventId));
  });

  r.post('/events/:id/status', requirePerm('events', 'w'), async (req, res) => {
    const eventId = Number(req.params.id);
    const b = parse(z.object({ status: z.enum(EVENT_STATUSES), cancel_reason: optText(500) }), req.body);
    const ev = (await db.get('SELECT * FROM events WHERE id = ?', eventId));
    if (!ev) throw notFound('Evento não encontrado.');
    if (b.status === ev.status) return res.json(await loadEvent(eventId));
    if (b.status === 'cancelado' && !b.cancel_reason) throw badRequest('Informe o motivo do cancelamento.');
    await db.transaction(async (tx) => {
      if (ev.status === 'cancelado') {
        // Reativação: o horário pode ter sido ocupado nesse meio tempo.
        await assertSchedule(tx, { unitId: ev.unit_id, startAt: ev.start_at, durationMinutes: ev.duration_minutes, excludeId: eventId, guests: ev.guests });
      }
      (await tx.run(`UPDATE events SET status = ?, cancel_reason = ?, updated_at = datetime('now') WHERE id = ?`, b.status, b.status === 'cancelado' ? b.cancel_reason : null, eventId));
      if (b.status === 'cancelado') {
        (await tx.run("UPDATE contracts SET status = 'cancelado', updated_at = datetime('now') WHERE event_id = ? AND status <> 'assinado'", eventId));
      }
    });
    await audit(db, req, `status_${b.status}`, 'events', eventId, { reason: b.cancel_reason });
    res.json(await loadEvent(eventId));
  });

  // Gera as parcelas a receber do evento, dividindo o saldo ainda não lançado.
  r.post('/events/:id/receivables', requirePerm('finance', 'w'), async (req, res) => {
    const eventId = Number(req.params.id);
    const b = parse(z.object({
      installments: z.coerce.number().int().min(1, 'Mínimo de 1 parcela.').max(36, 'Máximo de 36 parcelas.'),
      first_due_date: date('Data do primeiro vencimento'),
      interval_days: z.coerce.number().int().min(1).max(365).optional().default(30),
      payment_method: optText(40),
    }), req.body);
    const ev = (await db.get('SELECT * FROM events WHERE id = ?', eventId));
    if (!ev) throw notFound('Evento não encontrado.');
    if (ev.status === 'cancelado') throw badRequest('Evento cancelado não gera cobranças.');
    const launched = (await db.get("SELECT COALESCE(SUM(amount_cents), 0) AS s FROM transactions WHERE event_id = ? AND type = 'receber' AND status <> 'cancelado'", eventId)).s;
    const remaining = ev.total_cents - launched;
    if (remaining <= 0) throw badRequest('O valor total do evento já está lançado no contas a receber.');
    const base = Math.floor(remaining / b.installments);
    const rest = remaining - base * b.installments;
    await db.transaction(async (tx) => {

      const firstDay = toMinutes(`${b.first_due_date}T00:00`);
      for (let i = 0; i < b.installments; i += 1) {
        const due = fromMinutes(firstDay + i * b.interval_days * 1440).slice(0, 10);
        const amount = base + (i === 0 ? rest : 0);
        await tx.run(`INSERT INTO transactions (type, description, category, amount_cents, due_date, client_id, event_id, installment, payment_method, created_by)
          VALUES ('receber', ?, 'Eventos', ?, ?, ?, ?, ?, ?, ?)`,
        `${ev.title} - parcela ${i + 1}/${b.installments}`, amount, due, ev.client_id, eventId, `${i + 1}/${b.installments}`, b.payment_method, req.user.id);
      }
    });
    await audit(db, req, 'gerou_cobrancas', 'events', eventId, { installments: b.installments, amount: remaining });
    res.status(201).json({ ok: true, amount_cents: remaining });
  });

  // Baixa no estoque da unidade os produtos usados no evento.
  r.post('/events/:id/consume-stock', requirePerm('stock', 'w'), async (req, res) => {
    const eventId = Number(req.params.id);
    const ev = (await db.get('SELECT * FROM events WHERE id = ?', eventId));
    if (!ev) throw notFound('Evento não encontrado.');
    if (ev.status === 'cancelado') throw badRequest('Evento cancelado.');
    if (ev.stock_consumed) throw conflict('O estoque deste evento já foi baixado.');
    const items = (await db.all(`SELECT i.product_id, i.quantity, i.description FROM event_items i JOIN products p ON p.id = i.product_id
      WHERE i.event_id = ? AND p.type = 'produto'`, eventId));
    if (!items.length) throw badRequest('Este evento não tem produtos com controle de estoque.');
    await db.transaction(async (tx) => {
      for (const i of items) {
        await moveStock(tx, { productId: i.product_id, unitId: ev.unit_id, delta: -i.quantity, type: 'consumo_evento',
          reason: `Evento "${ev.title}" em ${dateBR(ev.start_at)}`, eventId, userId: req.user.id });
      }
      (await tx.run("UPDATE events SET stock_consumed = 1, updated_at = datetime('now') WHERE id = ?", eventId));
    });
    await audit(db, req, 'baixou_estoque', 'events', eventId);
    res.json({ ok: true });
  });

  // ---------- Calendário e bloqueios ----------
  r.get('/calendar', requirePerm('events', 'r'), async (req, res) => {
    if (!isValidDate(req.query.from) || !isValidDate(req.query.to)) throw badRequest('Período inválido.');
    const unitId = Number(req.query.unit_id) || 0;
    const events = (await db.all(`SELECT e.id, e.title, e.start_at, e.end_at, e.status, e.guests, e.event_type, e.unit_id, u.name AS unit_name,
        u.color AS unit_color, c.name AS client_name, c.id AS client_id
      FROM events e JOIN units u ON u.id = e.unit_id JOIN clients c ON c.id = e.client_id
      WHERE e.start_at <= ? AND e.end_at >= ? AND (? = 0 OR e.unit_id = ?) ORDER BY e.start_at`, `${req.query.to}T23:59`, `${req.query.from}T00:00`, unitId, unitId));
    const blocks = (await db.all(`SELECT b.*, u.name AS unit_name, us.name AS created_by_name FROM blocked_dates b
      LEFT JOIN units u ON u.id = b.unit_id LEFT JOIN users us ON us.id = b.created_by
      WHERE b.date BETWEEN ? AND ? AND (? = 0 OR b.unit_id IS NULL OR b.unit_id = ?) ORDER BY b.date`, req.query.from, req.query.to, unitId, unitId));
    res.json({ events, blocks });
  });

  r.get('/blocks', requirePerm('events', 'r'), async (req, res) => {
    res.json((await db.all(`SELECT b.*, u.name AS unit_name, us.name AS created_by_name FROM blocked_dates b
      LEFT JOIN units u ON u.id = b.unit_id LEFT JOIN users us ON us.id = b.created_by
      WHERE b.date >= date('now', '-30 days') ORDER BY b.date`)));
  });

  r.post('/blocks', requirePerm('blocks', 'w'), async (req, res) => {
    const b = parse(z.object({
      date: date('Data'),
      end_date: z.union([date('Data final'), z.literal(''), z.null()]).optional().transform((v) => v || null),
      unit_id: optId,
      reason: optText(300),
    }), req.body);
    const last = b.end_date || b.date;
    if (last < b.date) throw badRequest('A data final precisa ser igual ou posterior à inicial.');
    const days = [];
    for (let m = toMinutes(`${b.date}T00:00`); m <= toMinutes(`${last}T00:00`); m += 1440) days.push(fromMinutes(m).slice(0, 10));
    if (days.length > 366) throw badRequest('O período máximo de bloqueio é de 1 ano.');
    if (b.unit_id && !(await db.get('SELECT id FROM units WHERE id = ?', b.unit_id))) throw badRequest('Unidade não encontrada.');

    for (const day of days) {
      const busy = await eventsOnDate(db, day, b.unit_id);
      if (busy.length) {
        throw conflict(`Não é possível bloquear ${dateBR(day)}: já existe o evento "${busy[0].title}" (${busy[0].unit_name}). `
          + 'Remarque ou cancele o evento antes de bloquear a data.', { events: busy });
      }
    }
    const created = await db.transaction(async (tx) => {

      let n = 0;
      for (const day of days) {
        n += (await tx.run('INSERT INTO blocked_dates (date, unit_id, reason, created_by) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING',
          day, b.unit_id, b.reason, req.user.id)).changes;
      }
      return n;
    });
    await audit(db, req, 'bloqueou_datas', 'blocked_dates', null, { from: b.date, to: last, unit_id: b.unit_id });
    res.status(201).json({ ok: true, created });
  });

  r.delete('/blocks/:id', requirePerm('blocks', 'w'), async (req, res) => {
    const blockId = Number(req.params.id);
    const block = (await db.get('SELECT * FROM blocked_dates WHERE id = ?', blockId));
    if (!block) throw notFound('Bloqueio não encontrado.');
    (await db.run('DELETE FROM blocked_dates WHERE id = ?', blockId));
    await audit(db, req, 'desbloqueou_data', 'blocked_dates', blockId, { date: block.date, unit_id: block.unit_id });
    res.json({ ok: true });
  });

  return r;
}

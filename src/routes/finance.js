import { Router } from 'express';
import { z, parse, text, optText, optId, money, date } from '../lib/validate.js';
import { badRequest, notFound } from '../lib/errors.js';
import { requirePerm } from '../middleware/auth.js';
import { isValidDate, toMinutes, fromMinutes } from '../lib/eventRules.js';
import { today } from '../lib/format.js';
import { audit } from '../lib/audit.js';

const schema = z.object({
  type: z.enum(['receber', 'pagar'], { error: 'Tipo inválido.' }),
  description: text('Descrição', 200),
  category: optText(60),
  amount_cents: money('Valor').refine((v) => v > 0, 'O valor precisa ser maior que zero.'),
  due_date: date('Data de vencimento'),
  payment_method: optText(40),
  client_id: optId,
  event_id: optId,
  supplier: optText(150),
  document_number: optText(60),
  notes: optText(1000),
});

export function financeRouter({ db }) {
  const r = Router();

  const load = (txId) => db.prepare(`SELECT t.*, c.name AS client_name, e.title AS event_title FROM transactions t
    LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN events e ON e.id = t.event_id WHERE t.id = ?`).get(txId);

  r.get('/finance/transactions', requirePerm('finance', 'r'), (req, res) => {
    const type = ['receber', 'pagar'].includes(req.query.type) ? req.query.type : '';
    const status = ['pendente', 'pago', 'cancelado', 'vencido'].includes(req.query.status) ? req.query.status : '';
    const from = isValidDate(req.query.from) ? req.query.from : '';
    const to = isValidDate(req.query.to) ? req.query.to : '';
    const q = String(req.query.q || '').trim().slice(0, 100);
    const t = today();
    const rows = db.prepare(`SELECT t.*, c.name AS client_name, c.whatsapp AS client_whatsapp, c.phone AS client_phone, e.title AS event_title,
        CASE WHEN t.status = 'pendente' AND t.due_date < ? THEN 1 ELSE 0 END AS overdue
      FROM transactions t LEFT JOIN clients c ON c.id = t.client_id LEFT JOIN events e ON e.id = t.event_id
      WHERE (? = '' OR t.type = ?)
        AND (? = '' OR (? = 'vencido' AND t.status = 'pendente' AND t.due_date < ?) OR (? <> 'vencido' AND t.status = ?))
        AND (? = '' OR t.due_date >= ?) AND (? = '' OR t.due_date <= ?)
        AND (? = '' OR t.description LIKE ? OR t.supplier LIKE ? OR c.name LIKE ? OR t.category LIKE ?)
      ORDER BY t.due_date, t.id LIMIT 2000`)
      .all(t, type, type, status, status, t, status, status, from, from, to, to, q, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
    res.json(rows);
  });

  r.post('/finance/transactions', requirePerm('finance', 'w'), (req, res) => {
    const b = parse(schema, req.body);
    const info = db.prepare(`INSERT INTO transactions (type, description, category, amount_cents, due_date, payment_method, client_id, event_id,
        supplier, document_number, notes, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(b.type, b.description, b.category, b.amount_cents, b.due_date, b.payment_method, b.client_id, b.event_id, b.supplier,
        b.document_number, b.notes, req.user.id);
    audit(db, req, 'criou', 'transactions', Number(info.lastInsertRowid), { type: b.type, amount: b.amount_cents });
    res.status(201).json(load(Number(info.lastInsertRowid)));
  });

  r.put('/finance/transactions/:id', requirePerm('finance', 'w'), (req, res) => {
    const txId = Number(req.params.id);
    const current = db.prepare('SELECT status FROM transactions WHERE id = ?').get(txId);
    if (!current) throw notFound('Lançamento não encontrado.');
    if (current.status !== 'pendente') throw badRequest('Apenas lançamentos pendentes podem ser editados. Estorne o pagamento antes.');
    const b = parse(schema, req.body);
    db.prepare(`UPDATE transactions SET type = ?, description = ?, category = ?, amount_cents = ?, due_date = ?, payment_method = ?, client_id = ?,
        event_id = ?, supplier = ?, document_number = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(b.type, b.description, b.category, b.amount_cents, b.due_date, b.payment_method, b.client_id, b.event_id, b.supplier,
        b.document_number, b.notes, txId);
    audit(db, req, 'alterou', 'transactions', txId);
    res.json(load(txId));
  });

  r.post('/finance/transactions/:id/pay', requirePerm('finance', 'w'), (req, res) => {
    const txId = Number(req.params.id);
    const b = parse(z.object({
      paid_at: date('Data do pagamento'),
      paid_amount_cents: money('Valor pago').refine((v) => v > 0, 'O valor pago precisa ser maior que zero.'),
      payment_method: optText(40),
    }), req.body);
    const tx = db.prepare('SELECT status FROM transactions WHERE id = ?').get(txId);
    if (!tx) throw notFound('Lançamento não encontrado.');
    if (tx.status !== 'pendente') throw badRequest('Este lançamento não está pendente.');
    db.prepare(`UPDATE transactions SET status = 'pago', paid_at = ?, paid_amount_cents = ?, payment_method = COALESCE(?, payment_method),
      updated_at = datetime('now') WHERE id = ?`).run(b.paid_at, b.paid_amount_cents, b.payment_method, txId);
    audit(db, req, 'baixou', 'transactions', txId, b);
    res.json(load(txId));
  });

  r.post('/finance/transactions/:id/reopen', requirePerm('finance', 'w'), (req, res) => {
    const txId = Number(req.params.id);
    const info = db.prepare(`UPDATE transactions SET status = 'pendente', paid_at = NULL, paid_amount_cents = NULL, updated_at = datetime('now')
      WHERE id = ? AND status IN ('pago','cancelado')`).run(txId);
    if (!info.changes) throw badRequest('Lançamento não pode ser reaberto.');
    audit(db, req, 'reabriu', 'transactions', txId);
    res.json(load(txId));
  });

  r.post('/finance/transactions/:id/cancel', requirePerm('finance', 'w'), (req, res) => {
    const txId = Number(req.params.id);
    const info = db.prepare("UPDATE transactions SET status = 'cancelado', updated_at = datetime('now') WHERE id = ? AND status = 'pendente'").run(txId);
    if (!info.changes) throw badRequest('Apenas lançamentos pendentes podem ser cancelados.');
    audit(db, req, 'cancelou', 'transactions', txId);
    res.json(load(txId));
  });

  r.delete('/finance/transactions/:id', requirePerm('finance', 'w'), (req, res) => {
    const txId = Number(req.params.id);
    const tx = db.prepare('SELECT status FROM transactions WHERE id = ?').get(txId);
    if (!tx) throw notFound('Lançamento não encontrado.');
    if (tx.status === 'pago') throw badRequest('Lançamentos pagos não podem ser excluídos. Estorne o pagamento antes.');
    db.prepare('DELETE FROM transactions WHERE id = ?').run(txId);
    audit(db, req, 'excluiu', 'transactions', txId);
    res.json({ ok: true });
  });

  r.get('/finance/summary', requirePerm('finance', 'r'), (req, res) => {
    res.json(financeSummary(db));
  });

  // Fluxo de caixa: realizado (pagos) e previsto (pendentes), agrupado por dia ou mês.
  r.get('/finance/cashflow', requirePerm('finance', 'r'), (req, res) => {
    const from = isValidDate(req.query.from) ? req.query.from : `${today().slice(0, 8)}01`;
    const to = isValidDate(req.query.to) ? req.query.to : fromMinutes(toMinutes(`${from}T00:00`) + 31 * 1440 - 1).slice(0, 10);
    if (to < from) throw badRequest('Período inválido.');
    const days = (toMinutes(`${to}T00:00`) - toMinutes(`${from}T00:00`)) / 1440 + 1;
    if (days > 800) throw badRequest('O período máximo é de 2 anos.');
    const byMonth = req.query.group === 'month' || (req.query.group !== 'day' && days > 62);
    const len = byMonth ? 7 : 10;

    const opening = db.prepare(`SELECT COALESCE(SUM(CASE WHEN type = 'receber' THEN paid_amount_cents ELSE -paid_amount_cents END), 0) AS v
      FROM transactions WHERE status = 'pago' AND paid_at < ?`).get(from).v;
    const realized = db.prepare(`SELECT substr(paid_at, 1, ${len}) AS period,
        SUM(CASE WHEN type = 'receber' THEN paid_amount_cents ELSE 0 END) AS inflow,
        SUM(CASE WHEN type = 'pagar' THEN paid_amount_cents ELSE 0 END) AS outflow
      FROM transactions WHERE status = 'pago' AND paid_at BETWEEN ? AND ? GROUP BY period`).all(from, to);
    const projected = db.prepare(`SELECT substr(due_date, 1, ${len}) AS period,
        SUM(CASE WHEN type = 'receber' THEN amount_cents ELSE 0 END) AS inflow,
        SUM(CASE WHEN type = 'pagar' THEN amount_cents ELSE 0 END) AS outflow
      FROM transactions WHERE status = 'pendente' AND due_date BETWEEN ? AND ? GROUP BY period`).all(from, to);

    const periods = [];
    if (byMonth) {
      let [y, m] = from.split('-').map(Number);
      const end = to.slice(0, 7);
      for (;;) {
        const key = `${y}-${String(m).padStart(2, '0')}`;
        periods.push(key);
        if (key >= end) break;
        m += 1; if (m > 12) { m = 1; y += 1; }
      }
    } else {
      for (let i = 0; i < days; i += 1) periods.push(fromMinutes(toMinutes(`${from}T00:00`) + i * 1440).slice(0, 10));
    }
    const rmap = new Map(realized.map((x) => [x.period, x]));
    const pmap = new Map(projected.map((x) => [x.period, x]));
    let balance = opening;
    let projectedBalance = opening;
    const rows = periods.map((period) => {
      const rr = rmap.get(period) || { inflow: 0, outflow: 0 };
      const pp = pmap.get(period) || { inflow: 0, outflow: 0 };
      balance += rr.inflow - rr.outflow;
      projectedBalance += rr.inflow - rr.outflow + pp.inflow - pp.outflow;
      return {
        period, realized_in: rr.inflow, realized_out: rr.outflow, projected_in: pp.inflow, projected_out: pp.outflow,
        balance, projected_balance: projectedBalance,
      };
    });
    res.json({ from, to, group: byMonth ? 'month' : 'day', opening_balance: opening, rows });
  });

  return r;
}

export function financeSummary(db) {
  const t = today();
  const monthStart = `${t.slice(0, 8)}01`;
  const sum = (sql, ...args) => db.prepare(sql).get(...args).v;
  return {
    receivable_pending: sum("SELECT COALESCE(SUM(amount_cents),0) v FROM transactions WHERE type='receber' AND status='pendente'"),
    receivable_overdue: sum("SELECT COALESCE(SUM(amount_cents),0) v FROM transactions WHERE type='receber' AND status='pendente' AND due_date < ?", t),
    payable_pending: sum("SELECT COALESCE(SUM(amount_cents),0) v FROM transactions WHERE type='pagar' AND status='pendente'"),
    payable_overdue: sum("SELECT COALESCE(SUM(amount_cents),0) v FROM transactions WHERE type='pagar' AND status='pendente' AND due_date < ?", t),
    month_in: sum("SELECT COALESCE(SUM(paid_amount_cents),0) v FROM transactions WHERE type='receber' AND status='pago' AND paid_at >= ?", monthStart),
    month_out: sum("SELECT COALESCE(SUM(paid_amount_cents),0) v FROM transactions WHERE type='pagar' AND status='pago' AND paid_at >= ?", monthStart),
    balance: sum("SELECT COALESCE(SUM(CASE WHEN type='receber' THEN paid_amount_cents ELSE -paid_amount_cents END),0) v FROM transactions WHERE status='pago'"),
  };
}


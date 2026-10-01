import { Router } from 'express';
import { z, parse, text, optText, optId, optDate, email, phone, money, id } from '../lib/validate.js';
import { notFound, badRequest } from '../lib/errors.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

export const DEAL_STAGES = ['novo', 'contato', 'visita', 'proposta', 'negociacao', 'ganho', 'perdido'];
const INTERACTION_TYPES = ['nota', 'ligacao', 'whatsapp', 'email', 'visita', 'reuniao'];

const clientSchema = z.object({
  type: z.enum(['PF', 'PJ']).optional().default('PF'),
  name: text('Nome', 150),
  document: z.string().trim().max(20).optional().nullable().transform((v) => (v ? v.replace(/[^\dXx]/g, '') || null : null)),
  email,
  phone,
  whatsapp: phone,
  birth_date: optDate,
  address: optText(250),
  city: optText(100),
  state: optText(2),
  source: optText(60),
  notes: optText(2000),
});

const dealSchema = z.object({
  title: text('Título', 150),
  client_id: id('Cliente'),
  stage: z.enum(DEAL_STAGES).optional().default('novo'),
  value_cents: money('Valor').optional().default(0),
  event_type: optText(60),
  expected_date: optDate,
  guests: z.union([z.coerce.number().int().min(0), z.literal(''), z.null()]).optional().transform((v) => (v === '' ? null : v ?? null)),
  unit_id: optId,
  source: optText(60),
  owner_id: optId,
  lost_reason: optText(500),
  notes: optText(2000),
});

export function crmRouter({ db }) {
  const r = Router();

  // ---------- Clientes ----------
  r.get('/clients', requirePerm('crm', 'r'), (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const like = `%${q}%`;
    const rows = db.prepare(`SELECT c.*,
        (SELECT COUNT(*) FROM events e WHERE e.client_id = c.id AND e.status <> 'cancelado') AS events_count
      FROM clients c
      WHERE (? = '' OR c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ? OR c.whatsapp LIKE ? OR c.document LIKE ?)
      ORDER BY c.name LIMIT 500`).all(q, like, like, like, like, like);
    res.json(rows);
  });

  r.get('/clients/:id', requirePerm('crm', 'r'), (req, res) => {
    const clientId = Number(req.params.id);
    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId);
    if (!client) throw notFound('Cliente não encontrado.');
    client.deals = db.prepare('SELECT * FROM deals WHERE client_id = ? ORDER BY created_at DESC').all(clientId);
    client.events = db.prepare(`SELECT e.id, e.title, e.start_at, e.end_at, e.status, e.total_cents, u.name AS unit_name
      FROM events e JOIN units u ON u.id = e.unit_id WHERE e.client_id = ? ORDER BY e.start_at DESC`).all(clientId);
    client.interactions = db.prepare(`SELECT i.*, u.name AS user_name FROM interactions i
      LEFT JOIN users u ON u.id = i.user_id WHERE i.client_id = ? ORDER BY i.created_at DESC LIMIT 100`).all(clientId);
    client.forms = db.prepare('SELECT id, type, status, created_at, responded_at, response FROM forms WHERE client_id = ? ORDER BY created_at DESC').all(clientId)
      .map((f) => ({ ...f, response: f.response ? JSON.parse(f.response) : null }));
    res.json(client);
  });

  r.post('/clients', requirePerm('crm', 'w'), (req, res) => {
    const b = parse(clientSchema, req.body);
    const info = db.prepare(`INSERT INTO clients (type, name, document, email, phone, whatsapp, birth_date, address, city, state, source, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(b.type, b.name, b.document, b.email, b.phone, b.whatsapp, b.birth_date, b.address, b.city, b.state?.toUpperCase() ?? null, b.source, b.notes, req.user.id);
    audit(db, req, 'criou', 'clients', Number(info.lastInsertRowid));
    res.status(201).json(db.prepare('SELECT * FROM clients WHERE id = ?').get(info.lastInsertRowid));
  });

  r.put('/clients/:id', requirePerm('crm', 'w'), (req, res) => {
    const clientId = Number(req.params.id);
    const b = parse(clientSchema, req.body);
    const info = db.prepare(`UPDATE clients SET type = ?, name = ?, document = ?, email = ?, phone = ?, whatsapp = ?, birth_date = ?,
      address = ?, city = ?, state = ?, source = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(b.type, b.name, b.document, b.email, b.phone, b.whatsapp, b.birth_date, b.address, b.city, b.state?.toUpperCase() ?? null, b.source, b.notes, clientId);
    if (!info.changes) throw notFound('Cliente não encontrado.');
    audit(db, req, 'alterou', 'clients', clientId);
    res.json(db.prepare('SELECT * FROM clients WHERE id = ?').get(clientId));
  });

  r.delete('/clients/:id', requirePerm('crm', 'w'), (req, res) => {
    const clientId = Number(req.params.id);
    if (db.prepare('SELECT COUNT(*) AS n FROM events WHERE client_id = ?').get(clientId).n) {
      throw badRequest('Este cliente possui eventos e não pode ser excluído.');
    }
    const info = db.prepare('DELETE FROM clients WHERE id = ?').run(clientId);
    if (!info.changes) throw notFound('Cliente não encontrado.');
    audit(db, req, 'excluiu', 'clients', clientId);
    res.json({ ok: true });
  });

  r.post('/clients/:id/interactions', requirePerm('crm', 'w'), (req, res) => {
    const clientId = Number(req.params.id);
    if (!db.prepare('SELECT id FROM clients WHERE id = ?').get(clientId)) throw notFound('Cliente não encontrado.');
    const b = parse(z.object({
      type: z.enum(INTERACTION_TYPES),
      description: text('Descrição', 2000),
      deal_id: optId,
    }), req.body);
    const info = db.prepare('INSERT INTO interactions (client_id, deal_id, type, description, user_id) VALUES (?, ?, ?, ?, ?)')
      .run(clientId, b.deal_id, b.type, b.description, req.user.id);
    res.status(201).json(db.prepare('SELECT * FROM interactions WHERE id = ?').get(info.lastInsertRowid));
  });

  // ---------- Funil de vendas ----------
  r.get('/deals', requirePerm('crm', 'r'), (req, res) => {
    const rows = db.prepare(`SELECT d.*, c.name AS client_name, c.whatsapp AS client_whatsapp, c.phone AS client_phone,
        u.name AS owner_name, un.name AS unit_name
      FROM deals d JOIN clients c ON c.id = d.client_id
      LEFT JOIN users u ON u.id = d.owner_id
      LEFT JOIN units un ON un.id = d.unit_id
      WHERE (d.stage NOT IN ('ganho','perdido') OR d.closed_at >= date('now', '-90 days') OR d.closed_at IS NULL)
      ORDER BY d.updated_at DESC`).all();
    res.json(rows);
  });

  const saveDeal = (b, dealId) => {
    if (!db.prepare('SELECT id FROM clients WHERE id = ?').get(b.client_id)) throw badRequest('Cliente não encontrado.');
    const closed = b.stage === 'ganho' || b.stage === 'perdido';
    if (b.stage === 'perdido' && !b.lost_reason) throw badRequest('Informe o motivo da perda.');
    const values = [b.title, b.client_id, b.stage, b.value_cents, b.event_type, b.expected_date, b.guests, b.unit_id, b.source,
      b.owner_id, b.lost_reason, b.notes];
    if (dealId) {
      const info = db.prepare(`UPDATE deals SET title = ?, client_id = ?, stage = ?, value_cents = ?, event_type = ?, expected_date = ?,
        guests = ?, unit_id = ?, source = ?, owner_id = ?, lost_reason = ?, notes = ?,
        closed_at = CASE WHEN ? THEN COALESCE(closed_at, datetime('now')) ELSE NULL END, updated_at = datetime('now') WHERE id = ?`)
        .run(...values, closed ? 1 : 0, dealId);
      if (!info.changes) throw notFound('Negociação não encontrada.');
      return dealId;
    }
    const info = db.prepare(`INSERT INTO deals (title, client_id, stage, value_cents, event_type, expected_date, guests, unit_id, source,
      owner_id, lost_reason, notes, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${closed ? "datetime('now')" : 'NULL'})`)
      .run(...values);
    return Number(info.lastInsertRowid);
  };

  r.post('/deals', requirePerm('crm', 'w'), (req, res) => {
    const b = parse(dealSchema, req.body);
    if (!b.owner_id) b.owner_id = req.user.id;
    const dealId = saveDeal(b);
    audit(db, req, 'criou', 'deals', dealId);
    res.status(201).json(db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId));
  });

  r.put('/deals/:id', requirePerm('crm', 'w'), (req, res) => {
    const dealId = saveDeal(parse(dealSchema, req.body), Number(req.params.id));
    audit(db, req, 'alterou', 'deals', dealId);
    res.json(db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId));
  });

  r.patch('/deals/:id/stage', requirePerm('crm', 'w'), (req, res) => {
    const dealId = Number(req.params.id);
    const b = parse(z.object({ stage: z.enum(DEAL_STAGES), lost_reason: optText(500) }), req.body);
    const deal = db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId);
    if (!deal) throw notFound('Negociação não encontrada.');
    if (b.stage === 'perdido' && !b.lost_reason && !deal.lost_reason) throw badRequest('Informe o motivo da perda.');
    const closed = b.stage === 'ganho' || b.stage === 'perdido';
    db.prepare(`UPDATE deals SET stage = ?, lost_reason = COALESCE(?, lost_reason),
      closed_at = CASE WHEN ? THEN COALESCE(closed_at, datetime('now')) ELSE NULL END, updated_at = datetime('now') WHERE id = ?`)
      .run(b.stage, b.lost_reason, closed ? 1 : 0, dealId);
    db.prepare('INSERT INTO interactions (client_id, deal_id, type, description, user_id) VALUES (?, ?, ?, ?, ?)')
      .run(deal.client_id, dealId, 'nota', `Negociação "${deal.title}" movida para a etapa "${b.stage}".`, req.user.id);
    audit(db, req, 'mudou_etapa', 'deals', dealId, { stage: b.stage });
    res.json(db.prepare('SELECT * FROM deals WHERE id = ?').get(dealId));
  });

  r.delete('/deals/:id', requirePerm('crm', 'w'), (req, res) => {
    const info = db.prepare('DELETE FROM deals WHERE id = ?').run(Number(req.params.id));
    if (!info.changes) throw notFound('Negociação não encontrada.');
    audit(db, req, 'excluiu', 'deals', Number(req.params.id));
    res.json({ ok: true });
  });

  return r;
}

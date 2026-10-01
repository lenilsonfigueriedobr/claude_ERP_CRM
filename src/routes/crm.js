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
  r.get('/clients', requirePerm('crm', 'r'), async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const like = `%${q}%`;
    const rows = (await db.all(`SELECT c.*,
        (SELECT COUNT(*) FROM events e WHERE e.client_id = c.id AND e.status <> 'cancelado') AS events_count
      FROM clients c
      WHERE (? = '' OR c.name ILIKE ? OR c.email ILIKE ? OR c.phone ILIKE ? OR c.whatsapp ILIKE ? OR c.document ILIKE ?)
      ORDER BY c.name LIMIT 500`, q, like, like, like, like, like));
    res.json(rows);
  });

  r.get('/clients/:id', requirePerm('crm', 'r'), async (req, res) => {
    const clientId = Number(req.params.id);
    const client = (await db.get('SELECT * FROM clients WHERE id = ?', clientId));
    if (!client) throw notFound('Cliente não encontrado.');
    client.deals = (await db.all('SELECT * FROM deals WHERE client_id = ? ORDER BY created_at DESC', clientId));
    client.events = (await db.all(`SELECT e.id, e.title, e.start_at, e.end_at, e.status, e.total_cents, u.name AS unit_name
      FROM events e JOIN units u ON u.id = e.unit_id WHERE e.client_id = ? ORDER BY e.start_at DESC`, clientId));
    client.interactions = (await db.all(`SELECT i.*, u.name AS user_name FROM interactions i
      LEFT JOIN users u ON u.id = i.user_id WHERE i.client_id = ? ORDER BY i.created_at DESC LIMIT 100`, clientId));
    client.forms = (await db.all('SELECT id, type, status, created_at, responded_at, response FROM forms WHERE client_id = ? ORDER BY created_at DESC', clientId))
      .map((f) => ({ ...f, response: f.response ? JSON.parse(f.response) : null }));
    res.json(client);
  });

  r.post('/clients', requirePerm('crm', 'w'), async (req, res) => {
    const b = parse(clientSchema, req.body);
    const info = (await db.run(`INSERT INTO clients (type, name, document, email, phone, whatsapp, birth_date, address, city, state, source, notes, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, b.type, b.name, b.document, b.email, b.phone, b.whatsapp, b.birth_date, b.address, b.city, b.state?.toUpperCase() ?? null, b.source, b.notes, req.user.id));
    await audit(db, req, 'criou', 'clients', Number(info.lastInsertRowid));
    res.status(201).json((await db.get('SELECT * FROM clients WHERE id = ?', info.lastInsertRowid)));
  });

  r.put('/clients/:id', requirePerm('crm', 'w'), async (req, res) => {
    const clientId = Number(req.params.id);
    const b = parse(clientSchema, req.body);
    const info = (await db.run(`UPDATE clients SET type = ?, name = ?, document = ?, email = ?, phone = ?, whatsapp = ?, birth_date = ?,
      address = ?, city = ?, state = ?, source = ?, notes = ?, updated_at = now_text() WHERE id = ?`, b.type, b.name, b.document, b.email, b.phone, b.whatsapp, b.birth_date, b.address, b.city, b.state?.toUpperCase() ?? null, b.source, b.notes, clientId));
    if (!info.changes) throw notFound('Cliente não encontrado.');
    await audit(db, req, 'alterou', 'clients', clientId);
    res.json((await db.get('SELECT * FROM clients WHERE id = ?', clientId)));
  });

  r.delete('/clients/:id', requirePerm('crm', 'w'), async (req, res) => {
    const clientId = Number(req.params.id);
    if ((await db.get('SELECT COUNT(*) AS n FROM events WHERE client_id = ?', clientId)).n) {
      throw badRequest('Este cliente possui eventos e não pode ser excluído.');
    }
    const info = (await db.run('DELETE FROM clients WHERE id = ?', clientId));
    if (!info.changes) throw notFound('Cliente não encontrado.');
    await audit(db, req, 'excluiu', 'clients', clientId);
    res.json({ ok: true });
  });

  r.post('/clients/:id/interactions', requirePerm('crm', 'w'), async (req, res) => {
    const clientId = Number(req.params.id);
    if (!(await db.get('SELECT id FROM clients WHERE id = ?', clientId))) throw notFound('Cliente não encontrado.');
    const b = parse(z.object({
      type: z.enum(INTERACTION_TYPES),
      description: text('Descrição', 2000),
      deal_id: optId,
    }), req.body);
    const info = (await db.run('INSERT INTO interactions (client_id, deal_id, type, description, user_id) VALUES (?, ?, ?, ?, ?)', clientId, b.deal_id, b.type, b.description, req.user.id));
    res.status(201).json((await db.get('SELECT * FROM interactions WHERE id = ?', info.lastInsertRowid)));
  });

  // ---------- Funil de vendas ----------
  r.get('/deals', requirePerm('crm', 'r'), async (req, res) => {
    const rows = (await db.all(`SELECT d.*, c.name AS client_name, c.whatsapp AS client_whatsapp, c.phone AS client_phone,
        u.name AS owner_name, un.name AS unit_name
      FROM deals d JOIN clients c ON c.id = d.client_id
      LEFT JOIN users u ON u.id = d.owner_id
      LEFT JOIN units un ON un.id = d.unit_id
      WHERE (d.stage NOT IN ('ganho','perdido') OR d.closed_at >= days_ago_text(90) OR d.closed_at IS NULL)
      ORDER BY d.updated_at DESC`));
    res.json(rows);
  });

  const saveDeal = async (b, dealId) => {
    if (!(await db.get('SELECT id FROM clients WHERE id = ?', b.client_id))) throw badRequest('Cliente não encontrado.');
    const closed = b.stage === 'ganho' || b.stage === 'perdido';
    if (b.stage === 'perdido' && !b.lost_reason) throw badRequest('Informe o motivo da perda.');
    const values = [b.title, b.client_id, b.stage, b.value_cents, b.event_type, b.expected_date, b.guests, b.unit_id, b.source,
      b.owner_id, b.lost_reason, b.notes];
    if (dealId) {
      const info = (await db.run(`UPDATE deals SET title = ?, client_id = ?, stage = ?, value_cents = ?, event_type = ?, expected_date = ?,
        guests = ?, unit_id = ?, source = ?, owner_id = ?, lost_reason = ?, notes = ?,
        closed_at = CASE WHEN CAST(? AS INTEGER) = 1 THEN COALESCE(closed_at, now_text()) ELSE NULL END, updated_at = now_text() WHERE id = ?`, ...values, closed ? 1 : 0, dealId));
      if (!info.changes) throw notFound('Negociação não encontrada.');
      return dealId;
    }
    const info = (await db.run(`INSERT INTO deals (title, client_id, stage, value_cents, event_type, expected_date, guests, unit_id, source,
      owner_id, lost_reason, notes, closed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${closed ? "now_text()" : 'NULL'})`, ...values));
    return Number(info.lastInsertRowid);
  };

  r.post('/deals', requirePerm('crm', 'w'), async (req, res) => {
    const b = parse(dealSchema, req.body);
    if (!b.owner_id) b.owner_id = req.user.id;
    const dealId = await saveDeal(b);
    await audit(db, req, 'criou', 'deals', dealId);
    res.status(201).json((await db.get('SELECT * FROM deals WHERE id = ?', dealId)));
  });

  r.put('/deals/:id', requirePerm('crm', 'w'), async (req, res) => {
    const dealId = await saveDeal(parse(dealSchema, req.body), Number(req.params.id));
    await audit(db, req, 'alterou', 'deals', dealId);
    res.json((await db.get('SELECT * FROM deals WHERE id = ?', dealId)));
  });

  r.patch('/deals/:id/stage', requirePerm('crm', 'w'), async (req, res) => {
    const dealId = Number(req.params.id);
    const b = parse(z.object({ stage: z.enum(DEAL_STAGES), lost_reason: optText(500) }), req.body);
    const deal = (await db.get('SELECT * FROM deals WHERE id = ?', dealId));
    if (!deal) throw notFound('Negociação não encontrada.');
    if (b.stage === 'perdido' && !b.lost_reason && !deal.lost_reason) throw badRequest('Informe o motivo da perda.');
    const closed = b.stage === 'ganho' || b.stage === 'perdido';
    (await db.run(`UPDATE deals SET stage = ?, lost_reason = COALESCE(?, lost_reason),
      closed_at = CASE WHEN CAST(? AS INTEGER) = 1 THEN COALESCE(closed_at, now_text()) ELSE NULL END, updated_at = now_text() WHERE id = ?`, b.stage, b.lost_reason, closed ? 1 : 0, dealId));
    (await db.run('INSERT INTO interactions (client_id, deal_id, type, description, user_id) VALUES (?, ?, ?, ?, ?)', deal.client_id, dealId, 'nota', `Negociação "${deal.title}" movida para a etapa "${b.stage}".`, req.user.id));
    await audit(db, req, 'mudou_etapa', 'deals', dealId, { stage: b.stage });
    res.json((await db.get('SELECT * FROM deals WHERE id = ?', dealId)));
  });

  r.delete('/deals/:id', requirePerm('crm', 'w'), async (req, res) => {
    const info = (await db.run('DELETE FROM deals WHERE id = ?', Number(req.params.id)));
    if (!info.changes) throw notFound('Negociação não encontrada.');
    await audit(db, req, 'excluiu', 'deals', Number(req.params.id));
    res.json({ ok: true });
  });

  return r;
}

import { Router } from 'express';
import { z, parse, id, text, optText } from '../lib/validate.js';
import { badRequest, notFound } from '../lib/errors.js';
import { requirePerm } from '../middleware/auth.js';
import { buildContract } from '../lib/contracts.js';
import { audit } from '../lib/audit.js';

export function contractsRouter({ db, config }) {
  const r = Router();

  const withLink = (c) => c && ({ ...c, public_url: `${config.appUrl}/p/contrato/${c.public_token}` });
  const load = async (contractId) => withLink((await db.get(`SELECT ct.*, e.title AS event_title, e.start_at, e.status AS event_status,
      c.id AS client_id, c.name AS client_name, c.whatsapp AS client_whatsapp, c.phone AS client_phone, u.name AS unit_name
    FROM contracts ct JOIN events e ON e.id = ct.event_id JOIN clients c ON c.id = e.client_id JOIN units u ON u.id = e.unit_id
    WHERE ct.id = ?`, contractId)));

  r.get('/contracts', requirePerm('contracts', 'r'), async (req, res) => {
    const status = ['rascunho', 'enviado', 'assinado', 'cancelado'].includes(req.query.status) ? req.query.status : '';
    const q = String(req.query.q || '').trim().slice(0, 100);
    res.json((await db.all(`SELECT ct.id, ct.number, ct.status, ct.public_token, ct.sent_at, ct.accepted_at, ct.created_at,
        e.id AS event_id, e.title AS event_title, e.start_at, c.id AS client_id, c.name AS client_name, c.whatsapp AS client_whatsapp,
        c.phone AS client_phone, u.name AS unit_name
      FROM contracts ct JOIN events e ON e.id = ct.event_id JOIN clients c ON c.id = e.client_id JOIN units u ON u.id = e.unit_id
      WHERE (? = '' OR ct.status = ?) AND (? = '' OR ct.number LIKE ? OR e.title LIKE ? OR c.name LIKE ?)
      ORDER BY ct.id DESC LIMIT 500`, status, status, q, `%${q}%`, `%${q}%`, `%${q}%`)).map(withLink));
  });

  r.get('/contracts/:id', requirePerm('contracts', 'r'), async (req, res) => {
    const c = await load(Number(req.params.id));
    if (!c) throw notFound('Contrato não encontrado.');
    res.json(c);
  });

  r.post('/contracts', requirePerm('contracts', 'w'), async (req, res) => {
    const b = parse(z.object({ event_id: id('Evento') }), req.body);
    const ev = (await db.get('SELECT status FROM events WHERE id = ?', b.event_id));
    if (!ev) throw notFound('Evento não encontrado.');
    if (ev.status === 'cancelado') throw badRequest('Não é possível emitir contrato para evento cancelado.');
    const active = (await db.get("SELECT number FROM contracts WHERE event_id = ? AND status IN ('rascunho','enviado','assinado')", b.event_id));
    if (active) throw badRequest(`Este evento já tem o contrato ${active.number} ativo. Cancele-o antes de emitir outro.`);
    const { number, content, token } = await buildContract(db, b.event_id);
    const info = (await db.run('INSERT INTO contracts (event_id, number, content, public_token, created_by) VALUES (?, ?, ?, ?, ?)', b.event_id, number, content, token, req.user.id));
    await audit(db, req, 'emitiu', 'contracts', Number(info.lastInsertRowid), { number });
    res.status(201).json(await load(Number(info.lastInsertRowid)));
  });

  r.put('/contracts/:id', requirePerm('contracts', 'w'), async (req, res) => {
    const contractId = Number(req.params.id);
    const c = (await db.get('SELECT status FROM contracts WHERE id = ?', contractId));
    if (!c) throw notFound('Contrato não encontrado.');
    if (c.status !== 'rascunho') throw badRequest('Só é possível editar o texto de contratos em rascunho.');
    const b = parse(z.object({ content: text('Conteúdo do contrato', 60000) }), req.body);
    (await db.run("UPDATE contracts SET content = ?, updated_at = datetime('now') WHERE id = ?", b.content, contractId));
    await audit(db, req, 'editou', 'contracts', contractId);
    res.json(await load(contractId));
  });

  r.post('/contracts/:id/status', requirePerm('contracts', 'w'), async (req, res) => {
    const contractId = Number(req.params.id);
    const b = parse(z.object({ status: z.enum(['enviado', 'assinado', 'cancelado']), signer_name: optText(150) }), req.body);
    const c = (await db.get('SELECT * FROM contracts WHERE id = ?', contractId));
    if (!c) throw notFound('Contrato não encontrado.');
    if (c.status === 'cancelado') throw badRequest('Contrato cancelado não pode mudar de status.');
    if (c.status === 'assinado' && b.status !== 'cancelado') throw badRequest('Contrato já assinado.');
    if (b.status === 'enviado') {
      (await db.run("UPDATE contracts SET status = 'enviado', sent_at = COALESCE(sent_at, datetime('now')), updated_at = datetime('now') WHERE id = ?", contractId));
    } else if (b.status === 'assinado') {
      // Registro manual de assinatura física (contrato impresso).
      (await db.run(`UPDATE contracts SET status = 'assinado', accepted_name = ?, accepted_at = datetime('now'), accepted_ip = 'registro interno',
        updated_at = datetime('now') WHERE id = ?`, b.signer_name || 'Assinatura física registrada', contractId));
      (await db.run("UPDATE events SET status = 'confirmado', updated_at = datetime('now') WHERE id = ? AND status = 'pre_reserva'", c.event_id));
    } else {
      (await db.run("UPDATE contracts SET status = 'cancelado', updated_at = datetime('now') WHERE id = ?", contractId));
    }
    await audit(db, req, `contrato_${b.status}`, 'contracts', contractId);
    res.json(await load(contractId));
  });

  return r;
}

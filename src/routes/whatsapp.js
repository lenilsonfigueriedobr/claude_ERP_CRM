import { Router } from 'express';
import { z, parse, id, optId, optText } from '../lib/validate.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { requirePerm } from '../middleware/auth.js';
import { can } from '../lib/permissions.js';
import { normalizePhone, waLink, isApiConfigured, sendViaApi } from '../lib/whatsapp.js';
import { getSettings, fillTemplate } from '../lib/settings.js';
import { randomToken } from '../lib/security.js';
import { brl, dateBR } from '../lib/format.js';
import { audit } from '../lib/audit.js';

const FORM_TTL_DAYS = 15;

export function createForm(db, { type, clientId, eventId, userId }) {
  const token = randomToken();
  const expires = new Date(Date.now() + FORM_TTL_DAYS * 86400000).toISOString();
  const info = db.prepare('INSERT INTO forms (token, type, client_id, event_id, expires_at, created_by) VALUES (?, ?, ?, ?, ?, ?)')
    .run(token, type, clientId, eventId, expires, userId);
  return { id: Number(info.lastInsertRowid), token };
}

export function whatsappRouter({ db, config }) {
  const r = Router();

  r.get('/whatsapp/status', requirePerm('whatsapp', 'r'), (req, res) => {
    res.json({ api: isApiConfigured(config) });
  });

  r.get('/whatsapp/messages', requirePerm('whatsapp', 'r'), (req, res) => {
    const clientId = Number(req.query.client_id) || 0;
    res.json(db.prepare(`SELECT w.*, c.name AS client_name, u.name AS user_name FROM whatsapp_messages w
      LEFT JOIN clients c ON c.id = w.client_id LEFT JOIN users u ON u.id = w.user_id
      WHERE (? = 0 OR w.client_id = ?) ORDER BY w.id DESC LIMIT 200`).all(clientId, clientId));
  });

  // Gera um link de formulário sem enviar (para copiar e mandar por outro canal).
  r.post('/forms', requirePerm('crm', 'w'), (req, res) => {
    const b = parse(z.object({ type: z.enum(['cadastro', 'briefing']), client_id: id('Cliente'), event_id: optId }), req.body);
    if (!db.prepare('SELECT id FROM clients WHERE id = ?').get(b.client_id)) throw notFound('Cliente não encontrado.');
    const form = createForm(db, { type: b.type, clientId: b.client_id, eventId: b.event_id, userId: req.user.id });
    res.status(201).json({ ...form, url: `${config.appUrl}/p/formulario/${form.token}` });
  });

  r.post('/whatsapp/send', requirePerm('whatsapp', 'w'), async (req, res) => {
    const b = parse(z.object({
      client_id: id('Cliente'),
      kind: z.enum(['mensagem', 'contrato', 'formulario', 'cobranca']),
      message: optText(4000),
      contract_id: optId,
      transaction_id: optId,
      event_id: optId,
      form_type: z.enum(['cadastro', 'briefing']).optional().default('cadastro'),
    }), req.body);

    const client = db.prepare('SELECT * FROM clients WHERE id = ?').get(b.client_id);
    if (!client) throw notFound('Cliente não encontrado.');
    const phone = normalizePhone(client.whatsapp || client.phone);
    if (!phone) throw badRequest('O cliente não tem um número de WhatsApp válido cadastrado.');

    const s = getSettings(db);
    const vars = { 'cliente.nome': client.name.split(' ')[0], 'empresa.nome': s.company_name };
    let message = b.message;
    let afterSend = () => {};

    if (b.kind === 'contrato') {
      if (!can(req.user.role, 'contracts', 'r')) throw forbidden();
      const contract = db.prepare(`SELECT ct.*, e.title, e.client_id FROM contracts ct JOIN events e ON e.id = ct.event_id WHERE ct.id = ?`).get(b.contract_id ?? 0);
      if (!contract || contract.client_id !== client.id) throw notFound('Contrato não encontrado para este cliente.');
      if (contract.status === 'cancelado') throw badRequest('Este contrato está cancelado.');
      vars['evento.titulo'] = contract.title;
      vars.link = `${config.appUrl}/p/contrato/${contract.public_token}`;
      message = message ? `${message}\n\n${vars.link}` : fillTemplate(s.whatsapp_contract_message, vars);
      afterSend = () => db.prepare(`UPDATE contracts SET status = CASE WHEN status = 'rascunho' THEN 'enviado' ELSE status END,
        sent_at = COALESCE(sent_at, datetime('now')), updated_at = datetime('now') WHERE id = ?`).run(contract.id);
    } else if (b.kind === 'formulario') {
      if (!can(req.user.role, 'crm', 'w')) throw forbidden();
      if (b.event_id) {
        const ev = db.prepare('SELECT client_id FROM events WHERE id = ?').get(b.event_id);
        if (!ev || ev.client_id !== client.id) throw notFound('Evento não encontrado para este cliente.');
      }
      const form = createForm(db, { type: b.form_type, clientId: client.id, eventId: b.event_id, userId: req.user.id });
      vars.link = `${config.appUrl}/p/formulario/${form.token}`;
      message = message ? `${message}\n\n${vars.link}` : fillTemplate(s.whatsapp_form_message, vars);
    } else if (b.kind === 'cobranca') {
      if (!can(req.user.role, 'finance', 'r')) throw forbidden();
      const tx = db.prepare("SELECT * FROM transactions WHERE id = ? AND type = 'receber'").get(b.transaction_id ?? 0);
      if (!tx || tx.client_id !== client.id) throw notFound('Lançamento não encontrado para este cliente.');
      message = message || `${fillTemplate(s.whatsapp_greeting, vars)} Passando para lembrar da parcela "${tx.description}" no valor de ${brl(tx.amount_cents)}, com vencimento em ${dateBR(tx.due_date)}. Qualquer dúvida, estamos à disposição.`;
    } else {
      message = message || fillTemplate(s.whatsapp_greeting, vars);
    }

    const log = db.prepare(`INSERT INTO whatsapp_messages (client_id, phone, kind, body, mode, status, provider_id, error, user_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const interaction = () => db.prepare("INSERT INTO interactions (client_id, type, description, user_id) VALUES (?, 'whatsapp', ?, ?)")
      .run(client.id, `WhatsApp (${b.kind}): ${message.slice(0, 500)}`, req.user.id);

    if (isApiConfigured(config)) {
      try {
        const providerId = await sendViaApi(config, phone, message);
        log.run(client.id, phone, b.kind, message, 'api', 'enviado', providerId, null, req.user.id);
        afterSend();
        interaction();
        audit(db, req, 'whatsapp_api', 'clients', client.id, { kind: b.kind });
        return res.json({ mode: 'api', status: 'enviado', message });
      } catch (err) {
        // Se a API falhar, devolvemos o link para o usuário enviar manualmente.
        log.run(client.id, phone, b.kind, message, 'api', 'falhou', null, String(err.message).slice(0, 500), req.user.id);
        return res.json({ mode: 'link', status: 'falha_api', error: 'Não foi possível enviar pela API do WhatsApp. Use o link para enviar manualmente.', url: waLink(phone, message), message });
      }
    }
    log.run(client.id, phone, b.kind, message, 'link', 'link_gerado', null, null, req.user.id);
    afterSend();
    interaction();
    audit(db, req, 'whatsapp_link', 'clients', client.id, { kind: b.kind });
    res.json({ mode: 'link', status: 'link_gerado', url: waLink(phone, message), message });
  });

  return r;
}

import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z, parse, text, optText, email, phone, optDate } from '../lib/validate.js';
import { badRequest, notFound, AppError } from '../lib/errors.js';
import { getSettings } from '../lib/settings.js';
import { dateBR } from '../lib/format.js';

const TOKEN_RE = /^[A-Za-z0-9_-]{40,60}$/;

// Rotas acessadas pelo cliente final, sem login, via link com token aleatório de 256 bits.
export function publicRouter({ db, config }) {
  const r = Router();
  if (config.rateLimit) {
    r.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false,
      message: { error: 'Muitas requisições. Aguarde alguns minutos.' } }));
  }
  r.param('token', (req, res, next, token) => (TOKEN_RE.test(token) ? next() : next(notFound('Link inválido ou expirado.'))));

  const company = async () => {
    const s = (await getSettings(db));
    return { name: s.company_name, phone: s.company_phone, email: s.company_email };
  };

  // ---------- Contrato ----------
  r.get('/contracts/:token', async (req, res) => {
    const c = (await db.get(`SELECT ct.number, ct.content, ct.status, ct.accepted_name, ct.accepted_at, e.title AS event_title, e.start_at
      FROM contracts ct JOIN events e ON e.id = ct.event_id WHERE ct.public_token = ?`, req.params.token));
    if (!c) throw notFound('Contrato não encontrado.');
    res.json({ ...c, company: await company() });
  });

  r.post('/contracts/:token/accept', async (req, res) => {
    const b = parse(z.object({
      name: text('Nome completo', 150),
      document: text('CPF/CNPJ', 20).transform((v) => v.replace(/\D/g, '')).refine((v) => v.length === 11 || v.length === 14, 'Informe um CPF ou CNPJ válido.'),
      agree: z.literal(true, { error: 'É preciso concordar com os termos do contrato.' }),
    }), req.body);
    const c = (await db.get('SELECT * FROM contracts WHERE public_token = ?', req.params.token));
    if (!c) throw notFound('Contrato não encontrado.');
    if (c.status === 'assinado') throw new AppError(409, 'Este contrato já foi aceito.');
    if (c.status === 'cancelado') throw badRequest('Este contrato foi cancelado.');
    await db.transaction(async (tx) => {
      // Só grava se o contrato ainda estiver aberto: dois aceites simultâneos não passam.
      const accepted = await tx.run(`UPDATE contracts SET status = 'assinado', accepted_name = ?, accepted_document = ?, accepted_ip = ?,
        accepted_at = now_text(), updated_at = now_text() WHERE id = ? AND status IN ('rascunho','enviado')`, b.name, b.document, req.ip ?? null, c.id);
      if (!accepted.changes) throw new AppError(409, 'Este contrato já foi aceito.');
      (await tx.run("UPDATE events SET status = 'confirmado', updated_at = now_text() WHERE id = ? AND status = 'pre_reserva'", c.event_id));
      (await tx.run('INSERT INTO audit_log (action, entity, entity_id, details, ip) VALUES (?, ?, ?, ?, ?)', 'aceite_cliente', 'contracts', c.id, JSON.stringify({ name: b.name }), req.ip ?? null));
    });
    res.json({ ok: true });
  });

  // ---------- Formulários ----------
  // Marca como respondido só se ainda estiver pendente: o formulário aceita uma única resposta.
  const markAnswered = async (tx, formId, response) => {
    const r = await tx.run("UPDATE forms SET status = 'respondido', response = ?, responded_at = now_text() WHERE id = ? AND status = 'pendente'",
      JSON.stringify(response), formId);
    if (!r.changes) throw new AppError(409, 'Este formulário já foi respondido. Obrigado!');
  };

  const loadForm = async (token) => {
    const f = (await db.get(`SELECT f.*, c.name AS client_name, c.email, c.phone, c.whatsapp, c.document, c.birth_date, c.address, c.city, c.state,
        e.title AS event_title, e.start_at, e.guests
      FROM forms f JOIN clients c ON c.id = f.client_id LEFT JOIN events e ON e.id = f.event_id WHERE f.token = ?`, token));
    if (!f || Date.parse(f.expires_at) < Date.now()) throw notFound('Link inválido ou expirado.');
    return f;
  };

  r.get('/forms/:token', async (req, res) => {
    const f = await loadForm(req.params.token);
    const base = { type: f.type, status: f.status, company: await company(), event: f.event_title ? { title: f.event_title, date: dateBR(f.start_at) } : null };
    if (f.status === 'respondido') return res.json(base);
    // Pré-preenche apenas os campos de cadastro do próprio cliente dono do link.
    const prefill = f.type === 'cadastro'
      ? { name: f.client_name, email: f.email, phone: f.phone, whatsapp: f.whatsapp, document: f.document, birth_date: f.birth_date,
        address: f.address, city: f.city, state: f.state }
      : { name: f.client_name, guests: f.guests };
    res.json({ ...base, prefill });
  });

  r.post('/forms/:token', async (req, res) => {
    const f = await loadForm(req.params.token);
    if (f.status === 'respondido') throw new AppError(409, 'Este formulário já foi respondido. Obrigado!');
    if (f.type === 'cadastro') {
      const b = parse(z.object({
        name: text('Nome', 150),
        document: z.string().trim().max(20).optional().nullable().transform((v) => (v ? v.replace(/\D/g, '') || null : null)),
        email, phone, whatsapp: phone, birth_date: optDate,
        address: optText(250), city: optText(100), state: optText(2),
      }), req.body);
      await db.transaction(async (tx) => {
        await markAnswered(tx, f.id, b);
        (await tx.run(`UPDATE clients SET name = ?, document = COALESCE(?, document), email = COALESCE(?, email), phone = COALESCE(?, phone),
          whatsapp = COALESCE(?, whatsapp), birth_date = COALESCE(?, birth_date), address = COALESCE(?, address), city = COALESCE(?, city),
          state = COALESCE(?, state), updated_at = now_text() WHERE id = ?`, b.name, b.document, b.email, b.phone, b.whatsapp, b.birth_date, b.address, b.city, b.state?.toUpperCase() ?? null, f.client_id));

        (await tx.run("INSERT INTO interactions (client_id, type, description) VALUES (?, 'nota', ?)", f.client_id, 'Cliente atualizou o cadastro pelo formulário online.'));
      });
    } else {
      const b = parse(z.object({
        guests: z.coerce.number().int().min(0).max(100000).optional().nullable(),
        theme: optText(300),
        menu_preferences: optText(2000),
        dietary_restrictions: optText(1000),
        music: optText(1000),
        schedule: optText(2000),
        contact_on_day: optText(200),
        notes: optText(2000),
      }), req.body);
      await db.transaction(async (tx) => {
        await markAnswered(tx, f.id, b);
        (await tx.run("INSERT INTO interactions (client_id, type, description) VALUES (?, 'nota', ?)", f.client_id, `Cliente respondeu o briefing do evento${f.event_title ? ` "${f.event_title}"` : ''}.`));
      });
    }
    res.json({ ok: true });
  });

  return r;
}

import { Router } from 'express';
import { z, parse } from '../lib/validate.js';
import { requirePerm } from '../middleware/auth.js';
import { getSettings, saveSettings, DEFAULT_CONTRACT_TEMPLATE } from '../lib/settings.js';
import { MATRIX, MODULES, ROLE_LABELS } from '../lib/permissions.js';
import { audit } from '../lib/audit.js';

export function settingsRouter({ db }) {
  const r = Router();
  const s = (max) => z.string().trim().max(max).optional();

  r.get('/settings', requirePerm('settings', 'r'), (req, res) => {
    res.json({ ...getSettings(db), default_contract_template: DEFAULT_CONTRACT_TEMPLATE });
  });

  r.put('/settings', requirePerm('settings', 'w'), (req, res) => {
    const b = parse(z.object({
      company_name: z.string().trim().min(1, 'Informe o nome da empresa.').max(150),
      company_document: s(20),
      company_address: s(250),
      company_city: s(100),
      company_phone: s(20),
      company_email: s(160),
      contract_template: z.string().min(50, 'O modelo de contrato está muito curto.').max(60000),
      whatsapp_contract_message: s(1000),
      whatsapp_form_message: s(1000),
      whatsapp_greeting: s(500),
    }), req.body);
    saveSettings(db, b);
    audit(db, req, 'alterou', 'settings');
    res.json(getSettings(db));
  });

  r.get('/permissions', requirePerm('users', 'r'), (req, res) => {
    res.json({ matrix: MATRIX, modules: MODULES, roles: ROLE_LABELS });
  });

  r.get('/audit', requirePerm('audit', 'r'), (req, res) => {
    res.json(db.prepare(`SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
      ORDER BY a.id DESC LIMIT 300`).all());
  });

  return r;
}

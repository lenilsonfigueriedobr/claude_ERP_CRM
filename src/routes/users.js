import { Router } from 'express';
import { z, parse, text, phone } from '../lib/validate.js';
import { hashPassword, passwordProblem, generatePassword } from '../lib/security.js';
import { ROLES } from '../lib/permissions.js';
import { badRequest, notFound } from '../lib/errors.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

const COLUMNS = 'id, name, email, phone, role, active, last_login_at, must_change_password, created_at';

export function usersRouter({ db }) {
  const r = Router();

  const schema = z.object({
    name: text('Nome', 120),
    email: z.email('E-mail inválido.').max(160).transform((v) => v.toLowerCase()),
    phone,
    role: z.enum(ROLES, { error: 'Perfil inválido.' }),
    active: z.boolean().optional().default(true),
  });

  const activeAdmins = (exceptId) =>
    db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?").get(exceptId).n;

  r.get('/users', requirePerm('users', 'r'), (req, res) => {
    res.json(db.prepare(`SELECT ${COLUMNS} FROM users ORDER BY name`).all());
  });

  r.post('/users', requirePerm('users', 'w'), (req, res) => {
    const body = parse(schema.extend({ password: z.string().max(128).optional() }), req.body);
    const password = body.password || generatePassword();
    const problem = passwordProblem(password);
    if (problem) throw badRequest(problem);
    const info = db.prepare(`INSERT INTO users (name, email, phone, role, active, password_hash, must_change_password)
      VALUES (?, ?, ?, ?, ?, ?, 1)`)
      .run(body.name, body.email, body.phone, body.role, body.active ? 1 : 0, hashPassword(password));
    audit(db, req, 'criou', 'users', Number(info.lastInsertRowid), { role: body.role });
    res.status(201).json({
      user: db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).get(info.lastInsertRowid),
      temporaryPassword: body.password ? undefined : password,
    });
  });

  r.put('/users/:id', requirePerm('users', 'w'), (req, res) => {
    const userId = Number(req.params.id);
    const current = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!current) throw notFound('Usuário não encontrado.');
    const body = parse(schema, req.body);
    const losingAdmin = current.role === 'admin' && current.active && (body.role !== 'admin' || !body.active);
    if (losingAdmin && activeAdmins(userId) === 0) throw badRequest('O sistema precisa de pelo menos um administrador ativo.');
    if (userId === req.user.id && (!body.active || body.role !== current.role)) {
      throw badRequest('Você não pode alterar o próprio perfil ou desativar a própria conta.');
    }
    db.prepare(`UPDATE users SET name = ?, email = ?, phone = ?, role = ?, active = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(body.name, body.email, body.phone, body.role, body.active ? 1 : 0, userId);
    if (!body.active || body.role !== current.role) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    audit(db, req, 'alterou', 'users', userId, { role: body.role, active: body.active });
    res.json(db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).get(userId));
  });

  r.post('/users/:id/reset-password', requirePerm('users', 'w'), (req, res) => {
    const userId = Number(req.params.id);
    if (!db.prepare('SELECT id FROM users WHERE id = ?').get(userId)) throw notFound('Usuário não encontrado.');
    const password = generatePassword();
    db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL,
      updated_at = datetime('now') WHERE id = ?`).run(hashPassword(password), userId);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    audit(db, req, 'resetou_senha', 'users', userId);
    res.json({ temporaryPassword: password });
  });

  return r;
}

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

  const activeAdmins = async (exceptId) =>
    (await db.get("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id <> ?", exceptId)).n;

  r.get('/users', requirePerm('users', 'r'), async (req, res) => {
    res.json((await db.all(`SELECT ${COLUMNS} FROM users ORDER BY name`)));
  });

  r.post('/users', requirePerm('users', 'w'), async (req, res) => {
    const body = parse(schema.extend({ password: z.string().max(128).optional() }), req.body);
    const password = body.password || generatePassword();
    const problem = passwordProblem(password);
    if (problem) throw badRequest(problem);
    const info = (await db.run(`INSERT INTO users (name, email, phone, role, active, password_hash, must_change_password)
      VALUES (?, ?, ?, ?, ?, ?, 1)`, body.name, body.email, body.phone, body.role, body.active ? 1 : 0, hashPassword(password)));
    await audit(db, req, 'criou', 'users', Number(info.lastInsertRowid), { role: body.role });
    res.status(201).json({
      user: (await db.get(`SELECT ${COLUMNS} FROM users WHERE id = ?`, info.lastInsertRowid)),
      temporaryPassword: body.password ? undefined : password,
    });
  });

  r.put('/users/:id', requirePerm('users', 'w'), async (req, res) => {
    const userId = Number(req.params.id);
    const current = (await db.get('SELECT * FROM users WHERE id = ?', userId));
    if (!current) throw notFound('Usuário não encontrado.');
    const body = parse(schema, req.body);
    const losingAdmin = current.role === 'admin' && current.active && (body.role !== 'admin' || !body.active);
    if (losingAdmin && (await activeAdmins(userId)) === 0) throw badRequest('O sistema precisa de pelo menos um administrador ativo.');
    if (userId === req.user.id && (!body.active || body.role !== current.role)) {
      throw badRequest('Você não pode alterar o próprio perfil ou desativar a própria conta.');
    }
    (await db.run(`UPDATE users SET name = ?, email = ?, phone = ?, role = ?, active = ?, updated_at = datetime('now') WHERE id = ?`, body.name, body.email, body.phone, body.role, body.active ? 1 : 0, userId));
    if (!body.active || body.role !== current.role) (await db.run('DELETE FROM sessions WHERE user_id = ?', userId));
    await audit(db, req, 'alterou', 'users', userId, { role: body.role, active: body.active });
    res.json((await db.get(`SELECT ${COLUMNS} FROM users WHERE id = ?`, userId)));
  });

  r.post('/users/:id/reset-password', requirePerm('users', 'w'), async (req, res) => {
    const userId = Number(req.params.id);
    if (!(await db.get('SELECT id FROM users WHERE id = ?', userId))) throw notFound('Usuário não encontrado.');
    const password = generatePassword();
    (await db.run(`UPDATE users SET password_hash = ?, must_change_password = 1, failed_attempts = 0, locked_until = NULL,
      updated_at = datetime('now') WHERE id = ?`, hashPassword(password), userId));
    (await db.run('DELETE FROM sessions WHERE user_id = ?', userId));
    await audit(db, req, 'resetou_senha', 'users', userId);
    res.json({ temporaryPassword: password });
  });

  return r;
}

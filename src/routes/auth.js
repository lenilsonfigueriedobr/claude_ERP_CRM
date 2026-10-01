import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z, parse } from '../lib/validate.js';
import { verifyPassword, hashPassword, DUMMY_HASH, randomToken, sha256, passwordProblem } from '../lib/security.js';
import { permissionsFor, ROLE_LABELS, MODULES } from '../lib/permissions.js';
import { AppError, badRequest, unauthorized } from '../lib/errors.js';
import { cookieName, cookieOptions } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';
import { getSettings } from '../lib/settings.js';
import { isApiConfigured } from '../lib/whatsapp.js';

const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export function authRouter({ db, config, requireAuth }) {
  const r = Router();

  const loginLimiter = config.rateLimit
    ? rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false,
      message: { error: 'Muitas tentativas de login. Aguarde 15 minutos.' } })
    : (req, res, next) => next();

  const mePayload = (user, csrf) => ({
    user,
    csrf,
    permissions: permissionsFor(user.role),
    roles: ROLE_LABELS,
    modules: MODULES,
    company: getSettings(db).company_name,
    whatsappApi: isApiConfigured(config),
  });

  r.post('/auth/login', loginLimiter, (req, res) => {
    const body = parse(z.object({
      email: z.string().trim().toLowerCase().max(160),
      password: z.string().max(128),
    }), req.body);

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email);
    const now = Date.now();
    if (user?.locked_until && Date.parse(user.locked_until) > now) {
      verifyPassword(body.password, DUMMY_HASH);
      throw new AppError(423, `Conta bloqueada temporariamente por excesso de tentativas. Tente novamente em ${LOCK_MINUTES} minutos.`);
    }
    const ok = verifyPassword(body.password, user?.password_hash || DUMMY_HASH);
    if (!user || !ok || !user.active) {
      if (user) {
        const attempts = user.failed_attempts + 1;
        const lockedUntil = attempts >= MAX_ATTEMPTS ? new Date(now + LOCK_MINUTES * 60000).toISOString() : null;
        db.prepare('UPDATE users SET failed_attempts = ?, locked_until = ? WHERE id = ?')
          .run(lockedUntil ? 0 : attempts, lockedUntil, user.id);
        audit(db, { ...req, user }, 'login_falhou', 'users', user.id);
      }
      throw unauthorized('E-mail ou senha incorretos.');
    }

    db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(new Date(now).toISOString());
    db.prepare("UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = datetime('now') WHERE id = ?").run(user.id);

    const token = randomToken();
    const csrf = randomToken();
    db.prepare('INSERT INTO sessions (id, user_id, csrf_token, ip, user_agent, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sha256(token), user.id, csrf, req.ip ?? null, String(req.get('user-agent') || '').slice(0, 300),
        new Date(now + config.sessionTtlHours * 3600 * 1000).toISOString());
    res.cookie(cookieName(config), token, cookieOptions(config));
    const safeUser = { id: user.id, name: user.name, email: user.email, role: user.role, mustChangePassword: !!user.must_change_password };
    audit(db, { ...req, user: safeUser }, 'login', 'users', user.id);
    res.json(mePayload(safeUser, csrf));
  });

  r.post('/auth/logout', (req, res) => {
    if (req.session) db.prepare('DELETE FROM sessions WHERE id = ?').run(req.session.id);
    res.clearCookie(cookieName(config), { path: '/' });
    res.json({ ok: true });
  });

  r.get('/auth/me', requireAuth, (req, res) => {
    res.json(mePayload(req.user, req.session.csrf));
  });

  r.post('/auth/change-password', requireAuth, (req, res) => {
    const body = parse(z.object({ current: z.string().max(128), password: z.string().max(128) }), req.body);
    const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(body.current, user.password_hash)) throw badRequest('Senha atual incorreta.');
    const problem = passwordProblem(body.password);
    if (problem) throw badRequest(problem);
    if (body.current === body.password) throw badRequest('A nova senha precisa ser diferente da atual.');
    db.prepare("UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?")
      .run(hashPassword(body.password), req.user.id);
    // Encerra as outras sessões do usuário
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?').run(req.user.id, req.session.id);
    audit(db, req, 'trocou_senha', 'users', req.user.id);
    res.json({ ok: true });
  });

  return r;
}

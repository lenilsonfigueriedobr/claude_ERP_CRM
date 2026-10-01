import { sha256, safeEqual } from '../lib/security.js';
import { can } from '../lib/permissions.js';
import { unauthorized, forbidden } from '../lib/errors.js';

export function cookieName(config) {
  // O prefixo __Host- obriga cookie Secure, sem Domain e com Path=/ (só em HTTPS).
  return config.isProduction ? '__Host-sid' : 'sid';
}

export function cookieOptions(config) {
  return {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.isProduction,
    path: '/',
    maxAge: config.sessionTtlHours * 3600 * 1000,
  };
}

export function sessionMiddleware(db, config) {
  const findSession = db.prepare(`
    SELECT s.id AS session_id, s.csrf_token, s.expires_at,
           u.id, u.name, u.email, u.role, u.active, u.must_change_password
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ?`);
  const touch = db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?');
  const drop = db.prepare('DELETE FROM sessions WHERE id = ?');
  const name = cookieName(config);

  return (req, res, next) => {
    const token = req.cookies?.[name];
    if (!token || typeof token !== 'string' || token.length > 200) return next();
    const row = findSession.get(sha256(token));
    const now = Date.now();
    if (!row || Date.parse(row.expires_at) < now || !row.active) {
      if (row) drop.run(row.session_id);
      res.clearCookie(name, { path: '/' });
      return next();
    }
    // Expiração deslizante: cada requisição renova o prazo de inatividade.
    const ttl = config.sessionTtlHours * 3600 * 1000;
    if (Date.parse(row.expires_at) - now < ttl - 60_000) {
      touch.run(new Date(now + ttl).toISOString(), row.session_id);
      res.cookie(name, token, cookieOptions(config));
    }
    req.user = { id: row.id, name: row.name, email: row.email, role: row.role, mustChangePassword: !!row.must_change_password };
    req.session = { id: row.session_id, csrf: row.csrf_token };
    next();
  };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Proteção CSRF: requisições que alteram dados precisam vir da mesma origem e,
// quando autenticadas, trazer o token da sessão no cabeçalho X-CSRF-Token.
export function csrfProtection() {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get('origin');
    if (origin) {
      let host;
      try { host = new URL(origin).host; } catch { host = null; }
      if (host !== req.get('host')) return next(forbidden('Origem da requisição não permitida.'));
    }
    if (req.body && Object.keys(req.body).length && !req.is('application/json')) {
      return next(forbidden('Formato de requisição não suportado.'));
    }
    // Rotas públicas (links do cliente) não usam a sessão, então não exigem o token.
    if (req.session && !req.path.startsWith('/public/') && !safeEqual(req.get('x-csrf-token') || '', req.session.csrf)) {
      return next(forbidden('Sessão inválida. Recarregue a página.'));
    }
    next();
  };
}

export function requireAuth(req, res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requirePerm(module, action = 'r') {
  return (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!can(req.user.role, module, action)) return next(forbidden());
    next();
  };
}

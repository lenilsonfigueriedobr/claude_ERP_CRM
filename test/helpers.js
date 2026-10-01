import { boot } from '../src/boot.js';

export async function startServer() {
  const { app, db, config } = await boot({ db: { url: process.env.TEST_DATABASE_URL || '', maxConnections: 5 }, env: 'test', isProduction: false, logRequests: false, rateLimit: false,
    admin: { name: 'Admin', email: 'admin@teste.com', password: 'Senha1234' }, whatsapp: { token: '', phoneNumberId: '' } });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  config.appUrl = base;
  return { db, config, base, close: () => new Promise((r) => server.close(r)) };
}

// Cliente HTTP simples que guarda o cookie de sessão e o token CSRF.
export function client(base) {
  let cookie = '';
  let csrf = '';
  const call = async (method, path, body, extraHeaders = {}) => {
    const headers = { ...extraHeaders };
    if (cookie) headers.cookie = cookie;
    if (csrf && method !== 'GET') headers['x-csrf-token'] = csrf;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json().catch(() => null);
    return { status: res.status, data };
  };
  return {
    get: (p) => call('GET', p),
    post: (p, b, h) => call('POST', p, b ?? {}, h),
    put: (p, b) => call('PUT', p, b),
    patch: (p, b) => call('PATCH', p, b),
    del: (p) => call('DELETE', p),
    async login(email, password) {
      const r = await call('POST', '/api/auth/login', { email, password });
      if (r.status === 200) csrf = r.data.csrf;
      return r;
    },
    setCsrf(v) { csrf = v; },
  };
}

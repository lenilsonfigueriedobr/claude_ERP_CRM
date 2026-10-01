import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function publicUrl(env, port) {
  if (env.APP_URL) return env.APP_URL;
  // No Vercel: produção usa o domínio principal; prévias usam o endereço do próprio deploy.
  if (env.VERCEL_ENV === 'production' && env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return `http://localhost:${port}`;
}

export function loadConfig(overrides = {}) {
  const env = process.env;
  const port = Number(env.PORT) || 3000;
  const onVercel = Boolean(env.VERCEL);
  const config = {
    root,
    onVercel,
    env: env.NODE_ENV || (onVercel ? 'production' : 'development'),
    port,
    db: {
      // Turso (libsql://...) em produção; arquivo SQLite local no desenvolvimento.
      url: env.TURSO_DATABASE_URL || env.DATABASE_URL || `file:${path.resolve(root, env.DB_PATH || 'data/erp.db')}`,
      authToken: env.TURSO_AUTH_TOKEN || env.DATABASE_AUTH_TOKEN || '',
    },
    appUrl: publicUrl(env, port).replace(/\/+$/, ''),
    sessionTtlHours: Number(env.SESSION_TTL_HOURS) || 8,
    trustProxy: env.TRUST_PROXY === '1' || onVercel,
    admin: {
      name: env.ADMIN_NAME || 'Administrador',
      email: env.ADMIN_EMAIL || 'admin@empresa.com.br',
      password: env.ADMIN_PASSWORD || '',
    },
    whatsapp: {
      token: env.WHATSAPP_TOKEN || '',
      phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID || '',
      apiVersion: env.WHATSAPP_API_VERSION || 'v21.0',
    },
    rateLimit: true,
    logRequests: env.NODE_ENV !== 'test',
    ...overrides,
  };
  config.isProduction = config.env === 'production';
  if (config.onVercel && config.db.url.startsWith('file:')) {
    // O disco das funções do Vercel é temporário: um arquivo SQLite perderia todos os dados.
    throw new Error('No Vercel é obrigatório configurar TURSO_DATABASE_URL e TURSO_AUTH_TOKEN (banco Turso). Veja o README.');
  }
  return config;
}

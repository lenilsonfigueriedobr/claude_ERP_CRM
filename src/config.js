import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig(overrides = {}) {
  const env = process.env;
  const port = Number(env.PORT) || 3000;
  const config = {
    root,
    env: env.NODE_ENV || 'development',
    port,
    dbPath: env.DB_PATH ? path.resolve(root, env.DB_PATH) : path.join(root, 'data', 'erp.db'),
    appUrl: (env.APP_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
    sessionTtlHours: Number(env.SESSION_TTL_HOURS) || 8,
    trustProxy: env.TRUST_PROXY === '1',
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
  return config;
}

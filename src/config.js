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
      // Supabase/Postgres em produção. Sem DATABASE_URL, usa o PGlite (Postgres embutido) na pasta local.
      url: env.DATABASE_URL || '',
      caCert: env.DATABASE_CA_CERT ? env.DATABASE_CA_CERT.replace(/\\n/g, '\n') : '',
      dataDir: path.resolve(root, env.PGLITE_DIR || 'data/pgdata'),
      // Em serverless cada instância atende uma requisição por vez: poucas conexões bastam.
      maxConnections: Number(env.DATABASE_POOL_MAX) || (onVercel ? 2 : 5),
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
  if (config.onVercel && !config.db.url) {
    // O disco das funções do Vercel é temporário: um banco local perderia todos os dados.
    throw new Error('No Vercel é obrigatório configurar DATABASE_URL com a conexão do Supabase. Veja o README.');
  }
  return config;
}

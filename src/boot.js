import { loadConfig } from './config.js';
import { openDb } from './db/index.js';
import { ensureAdmin } from './db/bootstrap.js';
import { createApp } from './app.js';

// Abre o banco, aplica as migrações, garante o administrador e monta o app.
// Usado tanto pelo servidor local quanto pela função do Vercel.
export async function boot(overrides = {}) {
  const config = loadConfig(overrides);
  const db = await openDb(config.db);
  await ensureAdmin(db, config);
  const app = createApp({ db, config });
  return { app, db, config };
}

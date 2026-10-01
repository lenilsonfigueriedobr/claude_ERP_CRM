import { Router } from 'express';
import { authRouter } from './auth.js';
import { usersRouter } from './users.js';
import { unitsRouter } from './units.js';
import { crmRouter } from './crm.js';
import { productsRouter } from './products.js';
import { stockRouter } from './stock.js';
import { eventsRouter } from './events.js';
import { contractsRouter } from './contracts.js';
import { financeRouter } from './finance.js';
import { dashboardRouter } from './dashboard.js';
import { whatsappRouter } from './whatsapp.js';
import { settingsRouter } from './settings.js';

export function apiRouter(ctx) {
  const r = Router();
  r.get('/health', (req, res) => res.json({ ok: true }));
  r.use(authRouter(ctx));
  // Tudo abaixo exige login; cada rota ainda checa a permissão do módulo.
  r.use(ctx.requireAuth);
  for (const make of [usersRouter, unitsRouter, crmRouter, productsRouter, stockRouter, eventsRouter, contractsRouter,
    financeRouter, dashboardRouter, whatsappRouter, settingsRouter]) {
    r.use(make(ctx));
  }
  return r;
}

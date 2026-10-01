import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { can } from '../lib/permissions.js';
import { financeSummary } from './finance.js';
import { today } from '../lib/format.js';
import { fromMinutes, toMinutes } from '../lib/eventRules.js';

export function dashboardRouter({ db }) {
  const r = Router();

  r.get('/dashboard', requireAuth, async (req, res) => {
    const role = req.user.role;
    const t = today();
    const monthStart = `${t.slice(0, 8)}01`;
    const [y, m] = t.split('-').map(Number);
    const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const in7 = fromMinutes(toMinutes(`${t}T00:00`) + 8 * 1440).slice(0, 10);
    const out = {};

    if (can(role, 'events', 'r')) {
      out.events_month = (await db.get(`SELECT COUNT(*) AS n FROM events WHERE status <> 'cancelado' AND start_at >= ? AND start_at < ?`, monthStart, nextMonth)).n;
      out.events_confirmed_month = (await db.get(`SELECT COUNT(*) AS n FROM events WHERE status IN ('confirmado','realizado') AND start_at >= ? AND start_at < ?`, monthStart, nextMonth)).n;
      out.revenue_month = (await db.get(`SELECT COALESCE(SUM(total_cents),0) AS v FROM events WHERE status IN ('confirmado','realizado') AND start_at >= ? AND start_at < ?`, monthStart, nextMonth)).v;
      out.upcoming = (await db.all(`SELECT e.id, e.title, e.start_at, e.end_at, e.status, e.guests, u.name AS unit_name, u.color AS unit_color, c.name AS client_name
        FROM events e JOIN units u ON u.id = e.unit_id JOIN clients c ON c.id = e.client_id
        WHERE e.status IN ('pre_reserva','confirmado') AND e.start_at >= ? AND e.start_at < ? ORDER BY e.start_at LIMIT 10`, `${t}T00:00`, in7));
      out.units = (await db.all(`SELECT u.id, u.name, u.color, u.capacity,
          (SELECT COUNT(*) FROM events e WHERE e.unit_id = u.id AND e.status <> 'cancelado' AND e.start_at >= ? AND e.start_at < ?) AS events
        FROM units u WHERE u.active = 1 ORDER BY u.name`, monthStart, nextMonth));
    }
    if (can(role, 'crm', 'r')) {
      out.funnel = (await db.all(`SELECT stage, COUNT(*) AS n, COALESCE(SUM(value_cents),0) AS value FROM deals
        WHERE stage NOT IN ('ganho','perdido') GROUP BY stage`));
      out.won_month = (await db.get(`SELECT COUNT(*) AS n, COALESCE(SUM(value_cents),0) AS value FROM deals WHERE stage = 'ganho' AND closed_at >= ?`, monthStart));
    }
    if (can(role, 'finance', 'r')) out.finance = await financeSummary(db);
    if (can(role, 'stock', 'r')) {
      out.low_stock = (await db.all(`SELECT p.id, p.name, p.unit_measure, p.min_stock, u.name AS unit_name, COALESCE(s.quantity, 0) AS quantity
        FROM products p CROSS JOIN units u LEFT JOIN stock s ON s.product_id = p.id AND s.unit_id = u.id
        WHERE p.type = 'produto' AND p.active = 1 AND u.active = 1 AND p.min_stock > 0 AND COALESCE(s.quantity, 0) < p.min_stock
        ORDER BY p.name LIMIT 10`));
    }
    res.json(out);
  });

  return r;
}

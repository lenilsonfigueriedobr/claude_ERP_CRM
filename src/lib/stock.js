import { badRequest } from './errors.js';

// Aplica uma variação de estoque (positiva ou negativa) e registra a movimentação.
// Deve ser chamada dentro de uma transação.
export function moveStock(db, { productId, unitId, delta, type, reason = null, eventId = null, userId = null, allowNegative = false }) {
  db.prepare('INSERT INTO stock (product_id, unit_id, quantity) VALUES (?, ?, 0) ON CONFLICT DO NOTHING').run(productId, unitId);
  const current = db.prepare('SELECT quantity FROM stock WHERE product_id = ? AND unit_id = ?').get(productId, unitId).quantity;
  const next = Math.round((current + delta) * 1000) / 1000;
  if (next < 0 && !allowNegative) {
    const p = db.prepare('SELECT name FROM products WHERE id = ?').get(productId);
    const u = db.prepare('SELECT name FROM units WHERE id = ?').get(unitId);
    throw badRequest(`Estoque insuficiente de "${p?.name}" na unidade ${u?.name}. Disponível: ${current}.`);
  }
  db.prepare("UPDATE stock SET quantity = ?, updated_at = datetime('now') WHERE product_id = ? AND unit_id = ?").run(next, productId, unitId);
  db.prepare(`INSERT INTO stock_movements (product_id, unit_id, type, quantity, balance_after, reason, event_id, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(productId, unitId, type, delta, next, reason, eventId, userId);
  return next;
}

import { badRequest } from './errors.js';

// Aplica uma variação de estoque (positiva ou negativa) e registra a movimentação.
// Deve ser chamada dentro de uma transação.
export async function moveStock(db, { productId, unitId, delta, type, reason = null, eventId = null, userId = null, allowNegative = false }) {
  (await db.run('INSERT INTO stock (product_id, unit_id, quantity) VALUES (?, ?, 0) ON CONFLICT DO NOTHING', productId, unitId));
  const current = (await db.get('SELECT quantity FROM stock WHERE product_id = ? AND unit_id = ?', productId, unitId)).quantity;
  const next = Math.round((current + delta) * 1000) / 1000;
  if (next < 0 && !allowNegative) {
    const p = (await db.get('SELECT name FROM products WHERE id = ?', productId));
    const u = (await db.get('SELECT name FROM units WHERE id = ?', unitId));
    throw badRequest(`Estoque insuficiente de "${p?.name}" na unidade ${u?.name}. Disponível: ${current}.`);
  }
  (await db.run("UPDATE stock SET quantity = ?, updated_at = datetime('now') WHERE product_id = ? AND unit_id = ?", next, productId, unitId));
  (await db.run(`INSERT INTO stock_movements (product_id, unit_id, type, quantity, balance_after, reason, event_id, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, productId, unitId, type, delta, next, reason, eventId, userId));
  return next;
}

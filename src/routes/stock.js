import { Router } from 'express';
import { z, parse, id, optText } from '../lib/validate.js';
import { badRequest } from '../lib/errors.js';
import { requirePerm } from '../middleware/auth.js';
import { transaction } from '../db/index.js';
import { moveStock } from '../lib/stock.js';
import { audit } from '../lib/audit.js';

export function stockRouter({ db }) {
  const r = Router();

  const assertStockable = (productId, unitId) => {
    const product = db.prepare('SELECT type, active FROM products WHERE id = ?').get(productId);
    if (!product || !product.active) throw badRequest('Produto não encontrado.');
    if (product.type !== 'produto') throw badRequest('Serviços não têm controle de estoque.');
    if (!db.prepare('SELECT id FROM units WHERE id = ?').get(unitId)) throw badRequest('Unidade não encontrada.');
  };

  // Posição de estoque: um registro por produto x unidade.
  r.get('/stock', requirePerm('stock', 'r'), (req, res) => {
    const unitId = Number(req.query.unit_id) || 0;
    const q = String(req.query.q || '').trim().slice(0, 100);
    const rows = db.prepare(`SELECT p.id AS product_id, p.name, p.sku, p.category, p.unit_measure, p.min_stock, p.cost_cents,
        u.id AS unit_id, u.name AS unit_name, COALESCE(s.quantity, 0) AS quantity
      FROM products p CROSS JOIN units u
      LEFT JOIN stock s ON s.product_id = p.id AND s.unit_id = u.id
      WHERE p.type = 'produto' AND p.active = 1 AND u.active = 1
        AND (? = 0 OR u.id = ?) AND (? = '' OR p.name LIKE ? OR p.sku LIKE ? OR p.category LIKE ?)
      ORDER BY p.name, u.name`).all(unitId, unitId, q, `%${q}%`, `%${q}%`, `%${q}%`);
    res.json(rows);
  });

  r.get('/stock/movements', requirePerm('stock', 'r'), (req, res) => {
    const productId = Number(req.query.product_id) || 0;
    const unitId = Number(req.query.unit_id) || 0;
    res.json(db.prepare(`SELECT m.*, p.name AS product_name, p.unit_measure, u.name AS unit_name, us.name AS user_name, e.title AS event_title
      FROM stock_movements m
      JOIN products p ON p.id = m.product_id
      JOIN units u ON u.id = m.unit_id
      LEFT JOIN users us ON us.id = m.user_id
      LEFT JOIN events e ON e.id = m.event_id
      WHERE (? = 0 OR m.product_id = ?) AND (? = 0 OR m.unit_id = ?)
      ORDER BY m.id DESC LIMIT 300`).all(productId, productId, unitId, unitId));
  });

  r.post('/stock/movements', requirePerm('stock', 'w'), (req, res) => {
    const b = parse(z.object({
      product_id: id('Produto'),
      unit_id: id('Unidade'),
      type: z.enum(['entrada', 'saida', 'ajuste'], { error: 'Tipo de movimentação inválido.' }),
      quantity: z.coerce.number({ error: 'Quantidade inválida.' }).min(0, 'Quantidade inválida.').max(1e7),
      reason: optText(300),
    }), req.body);
    assertStockable(b.product_id, b.unit_id);
    if (b.type !== 'ajuste' && b.quantity <= 0) throw badRequest('A quantidade precisa ser maior que zero.');
    const balance = transaction(db, () => {
      let delta = b.quantity;
      if (b.type === 'saida') delta = -b.quantity;
      if (b.type === 'ajuste') {
        // No ajuste, a quantidade informada é o novo saldo (inventário).
        const row = db.prepare('SELECT quantity FROM stock WHERE product_id = ? AND unit_id = ?').get(b.product_id, b.unit_id);
        delta = b.quantity - (row?.quantity ?? 0);
      }
      return moveStock(db, { productId: b.product_id, unitId: b.unit_id, delta, type: b.type, reason: b.reason, userId: req.user.id });
    });
    audit(db, req, `estoque_${b.type}`, 'products', b.product_id, { unit_id: b.unit_id, quantity: b.quantity });
    res.status(201).json({ balance });
  });

  r.post('/stock/transfer', requirePerm('stock', 'w'), (req, res) => {
    const b = parse(z.object({
      product_id: id('Produto'),
      from_unit_id: id('Unidade de origem'),
      to_unit_id: id('Unidade de destino'),
      quantity: z.coerce.number({ error: 'Quantidade inválida.' }).positive('A quantidade precisa ser maior que zero.').max(1e7),
      reason: optText(300),
    }), req.body);
    if (b.from_unit_id === b.to_unit_id) throw badRequest('Escolha unidades diferentes para a transferência.');
    assertStockable(b.product_id, b.from_unit_id);
    assertStockable(b.product_id, b.to_unit_id);
    transaction(db, () => {
      moveStock(db, { productId: b.product_id, unitId: b.from_unit_id, delta: -b.quantity, type: 'transferencia_saida', reason: b.reason, userId: req.user.id });
      moveStock(db, { productId: b.product_id, unitId: b.to_unit_id, delta: b.quantity, type: 'transferencia_entrada', reason: b.reason, userId: req.user.id });
    });
    audit(db, req, 'estoque_transferencia', 'products', b.product_id, b);
    res.status(201).json({ ok: true });
  });

  return r;
}

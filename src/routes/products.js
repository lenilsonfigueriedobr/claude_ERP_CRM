import { Router } from 'express';
import { z, parse, text, optText, money } from '../lib/validate.js';
import { notFound } from '../lib/errors.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

export function productsRouter({ db }) {
  const r = Router();
  const schema = z.object({
    type: z.enum(['produto', 'servico'], { error: 'Tipo inválido.' }),
    name: text('Nome', 150),
    sku: z.string().trim().max(60).optional().nullable().transform((v) => (v ? v : null)),
    category: optText(60),
    unit_measure: z.string().trim().max(10).optional().default('un').transform((v) => v || 'un'),
    price_cents: money('Preço'),
    cost_cents: money('Custo').optional().default(0),
    min_stock: z.coerce.number().min(0).optional().default(0),
    description: optText(1000),
    active: z.boolean().optional().default(true),
  });

  r.get('/products', requirePerm('products', 'r'), (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const type = ['produto', 'servico'].includes(req.query.type) ? req.query.type : '';
    const all = req.query.all === '1';
    res.json(db.prepare(`SELECT p.*, (SELECT COALESCE(SUM(quantity), 0) FROM stock s WHERE s.product_id = p.id) AS stock_total
      FROM products p
      WHERE (? = '' OR p.name LIKE ? OR p.sku LIKE ? OR p.category LIKE ?) AND (? = '' OR p.type = ?) ${all ? '' : 'AND p.active = 1'}
      ORDER BY p.type, p.name`).all(q, `%${q}%`, `%${q}%`, `%${q}%`, type, type));
  });

  r.post('/products', requirePerm('products', 'w'), (req, res) => {
    const b = parse(schema, req.body);
    const info = db.prepare(`INSERT INTO products (type, name, sku, category, unit_measure, price_cents, cost_cents, min_stock, description, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(b.type, b.name, b.sku, b.category, b.unit_measure, b.price_cents, b.cost_cents, b.type === 'produto' ? b.min_stock : 0, b.description, b.active ? 1 : 0);
    audit(db, req, 'criou', 'products', Number(info.lastInsertRowid));
    res.status(201).json(db.prepare('SELECT * FROM products WHERE id = ?').get(info.lastInsertRowid));
  });

  r.put('/products/:id', requirePerm('products', 'w'), (req, res) => {
    const productId = Number(req.params.id);
    const b = parse(schema, req.body);
    const info = db.prepare(`UPDATE products SET type = ?, name = ?, sku = ?, category = ?, unit_measure = ?, price_cents = ?, cost_cents = ?,
      min_stock = ?, description = ?, active = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(b.type, b.name, b.sku, b.category, b.unit_measure, b.price_cents, b.cost_cents, b.type === 'produto' ? b.min_stock : 0, b.description, b.active ? 1 : 0, productId);
    if (!info.changes) throw notFound('Item não encontrado.');
    audit(db, req, 'alterou', 'products', productId);
    res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(productId));
  });

  r.delete('/products/:id', requirePerm('products', 'w'), (req, res) => {
    // Exclusão lógica: o item some dos cadastros, mas continua nos eventos e movimentações antigas.
    const info = db.prepare("UPDATE products SET active = 0, updated_at = datetime('now') WHERE id = ?").run(Number(req.params.id));
    if (!info.changes) throw notFound('Item não encontrado.');
    audit(db, req, 'desativou', 'products', Number(req.params.id));
    res.json({ ok: true });
  });

  return r;
}

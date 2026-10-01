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

  r.get('/products', requirePerm('products', 'r'), async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 100);
    const type = ['produto', 'servico'].includes(req.query.type) ? req.query.type : '';
    const all = req.query.all === '1';
    res.json((await db.all(`SELECT p.*, (SELECT COALESCE(SUM(quantity), 0) FROM stock s WHERE s.product_id = p.id) AS stock_total
      FROM products p
      WHERE (? = '' OR p.name ILIKE ? OR p.sku ILIKE ? OR p.category ILIKE ?) AND (? = '' OR p.type = ?) ${all ? '' : 'AND p.active = 1'}
      ORDER BY p.type, p.name`, q, `%${q}%`, `%${q}%`, `%${q}%`, type, type)));
  });

  r.post('/products', requirePerm('products', 'w'), async (req, res) => {
    const b = parse(schema, req.body);
    const info = (await db.run(`INSERT INTO products (type, name, sku, category, unit_measure, price_cents, cost_cents, min_stock, description, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, b.type, b.name, b.sku, b.category, b.unit_measure, b.price_cents, b.cost_cents, b.type === 'produto' ? b.min_stock : 0, b.description, b.active ? 1 : 0));
    await audit(db, req, 'criou', 'products', Number(info.lastInsertRowid));
    res.status(201).json((await db.get('SELECT * FROM products WHERE id = ?', info.lastInsertRowid)));
  });

  r.put('/products/:id', requirePerm('products', 'w'), async (req, res) => {
    const productId = Number(req.params.id);
    const b = parse(schema, req.body);
    const info = (await db.run(`UPDATE products SET type = ?, name = ?, sku = ?, category = ?, unit_measure = ?, price_cents = ?, cost_cents = ?,
      min_stock = ?, description = ?, active = ?, updated_at = now_text() WHERE id = ?`, b.type, b.name, b.sku, b.category, b.unit_measure, b.price_cents, b.cost_cents, b.type === 'produto' ? b.min_stock : 0, b.description, b.active ? 1 : 0, productId));
    if (!info.changes) throw notFound('Item não encontrado.');
    await audit(db, req, 'alterou', 'products', productId);
    res.json((await db.get('SELECT * FROM products WHERE id = ?', productId)));
  });

  r.delete('/products/:id', requirePerm('products', 'w'), async (req, res) => {
    // Exclusão lógica: o item some dos cadastros, mas continua nos eventos e movimentações antigas.
    const info = (await db.run("UPDATE products SET active = 0, updated_at = now_text() WHERE id = ?", Number(req.params.id)));
    if (!info.changes) throw notFound('Item não encontrado.');
    await audit(db, req, 'desativou', 'products', Number(req.params.id));
    res.json({ ok: true });
  });

  return r;
}

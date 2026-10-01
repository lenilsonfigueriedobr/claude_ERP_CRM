import { Router } from 'express';
import { z, parse, text, optText } from '../lib/validate.js';
import { badRequest, notFound } from '../lib/errors.js';
import { requirePerm } from '../middleware/auth.js';
import { audit } from '../lib/audit.js';

export function unitsRouter({ db }) {
  const r = Router();
  const schema = z.object({
    name: text('Nome', 100),
    location: text('Local', 250),
    capacity: z.coerce.number({ error: 'Capacidade inválida.' }).int('Capacidade inválida.').min(1, 'A capacidade precisa ser maior que zero.').max(100000),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Cor inválida.').optional().default('#6d5bd0'),
    notes: optText(1000),
    active: z.boolean().optional().default(true),
  });

  r.get('/units', requirePerm('units', 'r'), async (req, res) => {
    const all = req.query.all === '1';
    res.json((await db.all(`SELECT u.*,
        (SELECT COUNT(*) FROM events e WHERE e.unit_id = u.id AND e.status <> 'cancelado' AND e.start_at >= date('now')) AS upcoming_events
      FROM units u ${all ? '' : 'WHERE u.active = 1'} ORDER BY u.name`)));
  });

  r.post('/units', requirePerm('units', 'w'), async (req, res) => {
    const b = parse(schema, req.body);
    const info = (await db.run('INSERT INTO units (name, location, capacity, color, notes, active) VALUES (?, ?, ?, ?, ?, ?)', b.name, b.location, b.capacity, b.color, b.notes, b.active ? 1 : 0));
    await audit(db, req, 'criou', 'units', Number(info.lastInsertRowid));
    res.status(201).json((await db.get('SELECT * FROM units WHERE id = ?', info.lastInsertRowid)));
  });

  r.put('/units/:id', requirePerm('units', 'w'), async (req, res) => {
    const unitId = Number(req.params.id);
    if (!(await db.get('SELECT id FROM units WHERE id = ?', unitId))) throw notFound('Unidade não encontrada.');
    const b = parse(schema, req.body);
    const maxGuests = (await db.get(`SELECT MAX(guests) AS g FROM events WHERE unit_id = ? AND status IN ('pre_reserva','confirmado')
      AND start_at >= date('now')`, unitId)).g;
    if (maxGuests && b.capacity < maxGuests) {
      throw badRequest(`Há evento futuro nesta unidade com ${maxGuests} convidados. A capacidade não pode ficar abaixo disso.`);
    }
    (await db.run(`UPDATE units SET name = ?, location = ?, capacity = ?, color = ?, notes = ?, active = ?, updated_at = datetime('now') WHERE id = ?`, b.name, b.location, b.capacity, b.color, b.notes, b.active ? 1 : 0, unitId));
    await audit(db, req, 'alterou', 'units', unitId);
    res.json((await db.get('SELECT * FROM units WHERE id = ?', unitId)));
  });

  r.delete('/units/:id', requirePerm('units', 'w'), async (req, res) => {
    const unitId = Number(req.params.id);
    const used = (await db.get('SELECT COUNT(*) AS n FROM events WHERE unit_id = ?', unitId)).n;
    if (used) {
      // Unidade com histórico: apenas desativa para preservar os eventos passados.
      (await db.run("UPDATE units SET active = 0, updated_at = datetime('now') WHERE id = ?", unitId));
      await audit(db, req, 'desativou', 'units', unitId);
      return res.json({ ok: true, deactivated: true });
    }
    const info = (await db.run('DELETE FROM units WHERE id = ?', unitId));
    if (!info.changes) throw notFound('Unidade não encontrada.');
    await audit(db, req, 'excluiu', 'units', unitId);
    res.json({ ok: true });
  });

  return r;
}

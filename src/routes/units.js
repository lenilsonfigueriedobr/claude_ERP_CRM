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

  r.get('/units', requirePerm('units', 'r'), (req, res) => {
    const all = req.query.all === '1';
    res.json(db.prepare(`SELECT u.*,
        (SELECT COUNT(*) FROM events e WHERE e.unit_id = u.id AND e.status <> 'cancelado' AND e.start_at >= date('now')) AS upcoming_events
      FROM units u ${all ? '' : 'WHERE u.active = 1'} ORDER BY u.name`).all());
  });

  r.post('/units', requirePerm('units', 'w'), (req, res) => {
    const b = parse(schema, req.body);
    const info = db.prepare('INSERT INTO units (name, location, capacity, color, notes, active) VALUES (?, ?, ?, ?, ?, ?)')
      .run(b.name, b.location, b.capacity, b.color, b.notes, b.active ? 1 : 0);
    audit(db, req, 'criou', 'units', Number(info.lastInsertRowid));
    res.status(201).json(db.prepare('SELECT * FROM units WHERE id = ?').get(info.lastInsertRowid));
  });

  r.put('/units/:id', requirePerm('units', 'w'), (req, res) => {
    const unitId = Number(req.params.id);
    if (!db.prepare('SELECT id FROM units WHERE id = ?').get(unitId)) throw notFound('Unidade não encontrada.');
    const b = parse(schema, req.body);
    const maxGuests = db.prepare(`SELECT MAX(guests) AS g FROM events WHERE unit_id = ? AND status IN ('pre_reserva','confirmado')
      AND start_at >= date('now')`).get(unitId).g;
    if (maxGuests && b.capacity < maxGuests) {
      throw badRequest(`Há evento futuro nesta unidade com ${maxGuests} convidados. A capacidade não pode ficar abaixo disso.`);
    }
    db.prepare(`UPDATE units SET name = ?, location = ?, capacity = ?, color = ?, notes = ?, active = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(b.name, b.location, b.capacity, b.color, b.notes, b.active ? 1 : 0, unitId);
    audit(db, req, 'alterou', 'units', unitId);
    res.json(db.prepare('SELECT * FROM units WHERE id = ?').get(unitId));
  });

  r.delete('/units/:id', requirePerm('units', 'w'), (req, res) => {
    const unitId = Number(req.params.id);
    const used = db.prepare('SELECT COUNT(*) AS n FROM events WHERE unit_id = ?').get(unitId).n;
    if (used) {
      // Unidade com histórico: apenas desativa para preservar os eventos passados.
      db.prepare("UPDATE units SET active = 0, updated_at = datetime('now') WHERE id = ?").run(unitId);
      audit(db, req, 'desativou', 'units', unitId);
      return res.json({ ok: true, deactivated: true });
    }
    const info = db.prepare('DELETE FROM units WHERE id = ?').run(unitId);
    if (!info.changes) throw notFound('Unidade não encontrada.');
    audit(db, req, 'excluiu', 'units', unitId);
    res.json({ ok: true });
  });

  return r;
}

export async function audit(db, req, action, entity, entityId = null, details = null) {
  (await db.run('INSERT INTO audit_log (user_id, action, entity, entity_id, details, ip) VALUES (?, ?, ?, ?, ?, ?)', req.user?.id ?? null, action, entity, entityId ?? null, details ? JSON.stringify(details).slice(0, 2000) : null, req.ip ?? null));
}

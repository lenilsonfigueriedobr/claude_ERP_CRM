import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db/index.js';

test('transação desfaz tudo quando dá erro', async () => {
  const db = await openDb({ url: ':memory:' });
  await assert.rejects(db.transaction(async (tx) => {
    await tx.run("INSERT INTO units (name, location, capacity) VALUES ('A', 'x', 10)");
    throw new Error('falhou');
  }));
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM units')).n, 0);
  db.close();
});

test('usar "db" dentro da transação gera erro em vez de travar', async () => {
  const db = await openDb({ url: ':memory:' });
  await assert.rejects(db.transaction(async () => { await db.get('SELECT 1'); }), /Use o objeto "tx"/);
  assert.equal((await db.get('SELECT 1 AS v')).v, 1);
  db.close();
});

test('consultas de fora esperam a transação terminar', async () => {
  const db = await openDb({ url: ':memory:' });
  const order = [];
  let started;
  const inside = new Promise((r) => { started = r; });
  const tx = db.transaction(async (t) => {
    await t.run("INSERT INTO units (name, location, capacity) VALUES ('B', 'x', 10)");
    started();
    await new Promise((r) => setTimeout(r, 30));
    order.push('tx');
  });
  await inside;
  const n = await db.get('SELECT COUNT(*) AS n FROM units').then((r) => { order.push('read'); return r.n; });
  await tx;
  assert.deepEqual(order, ['tx', 'read']);
  assert.equal(n, 1);
  db.close();
});

test('abrir o mesmo banco de novo não reaplica migrações', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-'));
  const url = `file:${path.join(dir, 'x.db')}`;
  (await openDb({ url })).close();
  const db = await openDb({ url });
  assert.equal((await db.all('SELECT version FROM schema_migrations')).length, 1);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

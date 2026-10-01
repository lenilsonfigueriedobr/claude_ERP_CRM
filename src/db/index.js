import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { migrations } from './migrations.js';

// Adaptador do banco. Usa libSQL, que fala o mesmo SQL do SQLite e funciona em três modos:
// arquivo local (desenvolvimento), memória (testes) e Turso hospedado (Vercel/produção).
// Todas as consultas são assíncronas: await db.get(sql, ...args), db.all, db.run.

const clean = (args) => args.map((v) => {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
});

const toRows = (rs) => rs.rows.map((row) => Object.fromEntries(rs.columns.map((c, i) => [c, row[i]])));

// Operações sobre um executor (cliente ou transação).
function api(exec, runMultiple) {
  const execute = (sql, args) => exec({ sql, args: clean(args) });
  const self = {
    async get(sql, ...args) { return toRows(await execute(sql, args))[0]; },
    async all(sql, ...args) { return toRows(await execute(sql, args)); },
    async run(sql, ...args) {
      const rs = await execute(sql, args);
      return { changes: rs.rowsAffected, lastInsertRowid: rs.lastInsertRowid === undefined ? null : Number(rs.lastInsertRowid) };
    },
    exec: (sql) => runMultiple(sql),
  };
  return self;
}

// Divide um script SQL em comandos (as migrações não têm ";" dentro de textos).
const splitSql = (sql) => sql.split(/;\s*(?:\n|$)/).map((s) => s.trim()).filter(Boolean);

export class Database {
  #client;
  #txActive = null;
  #insideTx = new AsyncLocalStorage();

  constructor(client) {
    this.#client = client;
    const base = api((stmt) => this.#client.execute(stmt), (sql) => this.#client.executeMultiple(sql));
    // Enquanto uma transação está aberta, as outras operações esperam. Isso evita que consultas
    // de outra requisição caiam dentro da transação (ou falhem, no banco em memória).
    for (const name of ['get', 'all', 'run', 'exec']) {
      this[name] = async (...a) => { await this.#idle(); return base[name](...a); };
    }
  }

  async #idle() {
    // Usar "db" dentro da própria transação esperaria por ela mesma para sempre.
    if (this.#insideTx.getStore()) {
      throw new Error('Consulta feita com "db" dentro de uma transação. Use o objeto "tx" recebido pela transação.');
    }
    while (this.#txActive) await this.#txActive;
  }

  // Executa fn dentro de uma transação de escrita. fn recebe um objeto com get/all/run.
  async transaction(fn) {
    await this.#idle();
    let release;
    this.#txActive = new Promise((r) => { release = r; });
    let tx;
    try {
      tx = await this.#client.transaction('write');
      const handle = api((stmt) => tx.execute(stmt), async (sql) => { for (const s of splitSql(sql)) await tx.execute(s); });
      handle.transaction = (inner) => inner(handle); // chamadas aninhadas reaproveitam a mesma transação
      const result = await this.#insideTx.run(true, () => fn(handle));
      await tx.commit();
      return result;
    } catch (err) {
      if (tx) await tx.rollback().catch(() => {});
      throw err;
    } finally {
      tx?.close();
      this.#txActive = null;
      release();
    }
  }

  close() {
    this.#client.close();
  }
}

export async function openDb({ url, authToken } = {}) {
  const local = url === ':memory:' || url.startsWith('file:');
  if (url.startsWith('file:')) fs.mkdirSync(path.dirname(url.slice(5)), { recursive: true });
  // Banco remoto (Turso) usa o cliente HTTP puro em JavaScript: sem binário nativo, a função
  // serverless sobe mais rápido. Arquivo e memória precisam do cliente completo.
  const { createClient } = local ? await import('@libsql/client') : await import('@libsql/client/web');
  const client = createClient({ url, authToken: authToken || undefined, intMode: 'number' });
  const db = new Database(client);
  if (url.startsWith('file:')) await db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  await migrate(db);
  return db;
}

async function migrate(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  for (const m of migrations) {
    // A checagem fica dentro da transação: se duas instâncias sobem juntas (comum em serverless),
    // a segunda espera a primeira e encontra a migração já aplicada.
    await db.transaction(async (tx) => {
      if (await tx.get('SELECT version FROM schema_migrations WHERE version = ?', m.version)) return;
      for (const stmt of splitSql(m.sql)) await tx.run(stmt);
      await tx.run('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', m.version, m.name);
    });
  }
}

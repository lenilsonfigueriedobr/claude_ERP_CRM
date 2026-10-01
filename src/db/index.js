import fs from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { migrations } from './migrations.js';

// Acesso ao banco Postgres. Dois motores, mesma interface:
// - Supabase (ou qualquer Postgres) via driver "pg", quando DATABASE_URL está definida;
// - PGlite (Postgres embutido, sem instalar nada) no desenvolvimento local e nos testes.
//
// Interface: await db.get(sql, ...args), db.all, db.run, db.exec(sqlSemParametros) e
// db.transaction(async (tx) => ...). As consultas usam "?" como marcador de parâmetro.

const clean = (args) => args.map((v) => {
  if (v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return v;
});

// Troca cada "?" fora de textos entre aspas por $1, $2... (formato do Postgres).
export function toPositional(sql) {
  let out = '';
  let n = 0;
  let quote = null;
  for (let i = 0; i < sql.length; i += 1) {
    const c = sql[i];
    if (quote) {
      if (c === quote) quote = null;
      out += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      out += c;
    } else if (c === '?') {
      n += 1;
      out += `$${n}`;
    } else {
      out += c;
    }
  }
  return out;
}

const isInsert = (sql) => /^\s*INSERT\s/i.test(sql) && !/\bRETURNING\b/i.test(sql);

// Operações sobre um executor de consultas (pool ou transação).
function api(query, execMultiple) {
  const run = async (sql, args) => {
    // Em INSERT, pedimos a linha de volta para saber o id gerado (equivalente ao lastInsertRowid).
    const text = toPositional(isInsert(sql) ? `${sql} RETURNING *` : sql);
    return query(text, clean(args));
  };
  return {
    async get(sql, ...args) { return (await run(sql, args)).rows[0]; },
    async all(sql, ...args) { return (await run(sql, args)).rows; },
    async run(sql, ...args) {
      const r = await run(sql, args);
      return { changes: r.rowCount ?? 0, lastInsertRowid: r.rows?.[0]?.id ?? null };
    },
    exec: (sql) => execMultiple(sql),
    // Trava exclusiva até o fim da transação (pg_advisory_xact_lock). Serializa operações
    // que precisam "ler e depois gravar" sem que outra requisição passe no meio.
    async lock(name) { await query('SELECT pg_advisory_xact_lock(hashtext($1))', [name]); },
  };
}

export class Database {
  #driver;
  #insideTx = new AsyncLocalStorage();

  constructor(driver) {
    this.#driver = driver;
    const base = api((t, a) => driver.query(t, a), (sql) => driver.exec(sql));
    for (const name of ['get', 'all', 'run', 'exec']) {
      this[name] = (...a) => { this.#guard(); return base[name](...a); };
    }
    this.kind = driver.kind;
  }

  // Usar "db" dentro de uma transação rodaria fora dela (pg) ou esperaria por ela para sempre (PGlite).
  #guard() {
    if (this.#insideTx.getStore()) {
      throw new Error('Consulta feita com "db" dentro de uma transação. Use o objeto "tx" recebido pela transação.');
    }
  }

  async transaction(fn) {
    this.#guard();
    return this.#driver.transaction((query, exec) => {
      const handle = api(query, exec);
      handle.transaction = (inner) => inner(handle); // chamadas aninhadas reaproveitam a mesma transação
      return this.#insideTx.run(true, () => fn(handle));
    });
  }

  close() {
    return this.#driver.close();
  }
}

// ---------- Motor: Postgres via "pg" (Supabase) ----------
async function pgDriver({ url, caCert, maxConnections }) {
  const { default: pg } = await import('pg');
  // BIGINT (contagens, ids, somas) e NUMERIC chegam como texto no driver; aqui viram número.
  const types = {
    getTypeParser: (oid, format) => {
      if (oid === 20 || oid === 1700) return (v) => (v === null ? null : Number(v));
      return pg.types.getTypeParser(oid, format);
    },
  };
  const connection = new URL(url);
  const local = ['localhost', '127.0.0.1'].includes(connection.hostname);
  // O certificado do Supabase não é de uma autoridade pública. Com a CA do projeto (DATABASE_CA_CERT)
  // o servidor é verificado; sem ela, a conexão continua criptografada, mas sem verificação.
  let ssl = false;
  if (!local || caCert) ssl = caCert ? { ca: caCert, rejectUnauthorized: true } : { rejectUnauthorized: false };
  connection.searchParams.delete('sslmode');
  const pool = new pg.Pool({
    connectionString: connection.toString(),
    ssl,
    types,
    max: maxConnections,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => console.error('Erro na conexão com o banco:', err.message));

  return {
    kind: 'postgres',
    query: (text, args) => pool.query(text, args),
    exec: (sql) => pool.query(sql),
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn((t, a) => client.query(t, a), (sql) => client.query(sql));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

// ---------- Motor: PGlite (Postgres embutido) ----------
async function pgliteDriver({ dataDir }) {
  const { PGlite, types } = await import('@electric-sql/pglite');
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const pglite = await PGlite.create(dataDir || undefined, {
    parsers: { [types.INT8]: (v) => Number(v), [types.NUMERIC]: (v) => Number(v) },
  });
  const wrap = (r) => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length });
  return {
    kind: 'pglite',
    query: async (text, args) => wrap(await pglite.query(text, args)),
    exec: (sql) => pglite.exec(sql),
    // O PGlite tem uma conexão só e enfileira as demais consultas enquanto a transação está aberta.
    transaction: (fn) => pglite.transaction((tx) => fn(async (t, a) => wrap(await tx.query(t, a)), (sql) => tx.exec(sql))),
    close: () => pglite.close(),
  };
}

export async function openDb(options = {}) {
  const driver = options.url
    ? await pgDriver({ url: options.url, caCert: options.caCert, maxConnections: options.maxConnections || 5 })
    : await pgliteDriver({ dataDir: options.dataDir });
  const db = new Database(driver);
  await migrate(db);
  return db;
}

async function migrate(db) {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  const applied = new Set((await db.all('SELECT version FROM schema_migrations')).map((r) => r.version));
  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    // A trava garante que, se duas instâncias sobem juntas (comum em serverless), só uma migra;
    // a outra espera e encontra a migração já aplicada.
    await db.transaction(async (tx) => {
      await tx.lock('erp:migrations');
      if (await tx.get('SELECT version FROM schema_migrations WHERE version = ?', m.version)) return;
      await tx.exec(m.sql);
      await tx.run('INSERT INTO schema_migrations (version, name) VALUES (?, ?)', m.version, m.name);
    });
  }
}

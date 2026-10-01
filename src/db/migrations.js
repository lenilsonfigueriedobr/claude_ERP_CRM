// Cada migração roda uma única vez, em ordem. Nunca altere uma migração já publicada:
// crie uma nova no fim da lista.
export const migrations = [
  {
    version: 1,
    name: 'schema inicial',
    sql: `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        phone TEXT,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin','gerente','financeiro','comercial','operador')),
        active INTEGER NOT NULL DEFAULT 1,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        must_change_password INTEGER NOT NULL DEFAULT 0,
        last_login_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        csrf_token TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL
      );
      CREATE INDEX idx_sessions_user ON sessions(user_id);

      CREATE TABLE units (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE,
        location TEXT NOT NULL,
        capacity INTEGER NOT NULL CHECK (capacity > 0),
        color TEXT NOT NULL DEFAULT '#6d5bd0',
        notes TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE clients (
        id INTEGER PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'PF' CHECK (type IN ('PF','PJ')),
        name TEXT NOT NULL,
        document TEXT,
        email TEXT,
        phone TEXT,
        whatsapp TEXT,
        birth_date TEXT,
        address TEXT,
        city TEXT,
        state TEXT,
        source TEXT,
        notes TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_clients_name ON clients(name);

      CREATE TABLE deals (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        stage TEXT NOT NULL DEFAULT 'novo'
          CHECK (stage IN ('novo','contato','visita','proposta','negociacao','ganho','perdido')),
        value_cents INTEGER NOT NULL DEFAULT 0 CHECK (value_cents >= 0),
        event_type TEXT,
        expected_date TEXT,
        guests INTEGER,
        unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
        source TEXT,
        owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        lost_reason TEXT,
        notes TEXT,
        closed_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_deals_stage ON deals(stage);

      CREATE TABLE interactions (
        id INTEGER PRIMARY KEY,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
        type TEXT NOT NULL CHECK (type IN ('nota','ligacao','whatsapp','email','visita','reuniao')),
        description TEXT NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_interactions_client ON interactions(client_id);

      CREATE TABLE products (
        id INTEGER PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('produto','servico')),
        name TEXT NOT NULL,
        sku TEXT UNIQUE,
        category TEXT,
        unit_measure TEXT NOT NULL DEFAULT 'un',
        price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
        cost_cents INTEGER NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
        min_stock REAL NOT NULL DEFAULT 0,
        description TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE stock (
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
        quantity REAL NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (product_id, unit_id)
      );

      CREATE TABLE stock_movements (
        id INTEGER PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
        unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('entrada','saida','ajuste','transferencia_entrada','transferencia_saida','consumo_evento')),
        quantity REAL NOT NULL,
        balance_after REAL NOT NULL,
        reason TEXT,
        event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_movements_product ON stock_movements(product_id, unit_id);

      CREATE TABLE events (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
        unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE RESTRICT,
        deal_id INTEGER REFERENCES deals(id) ON DELETE SET NULL,
        event_type TEXT,
        start_at TEXT NOT NULL,
        end_at TEXT NOT NULL,
        duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0),
        guests INTEGER,
        status TEXT NOT NULL DEFAULT 'pre_reserva'
          CHECK (status IN ('pre_reserva','confirmado','realizado','cancelado')),
        discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
        total_cents INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        stock_consumed INTEGER NOT NULL DEFAULT 0,
        cancel_reason TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (end_at > start_at)
      );
      CREATE INDEX idx_events_unit_time ON events(unit_id, start_at, end_at);
      CREATE INDEX idx_events_start ON events(start_at);

      CREATE TABLE event_items (
        id INTEGER PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
        description TEXT NOT NULL,
        quantity REAL NOT NULL CHECK (quantity > 0),
        unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0)
      );
      CREATE INDEX idx_event_items_event ON event_items(event_id);

      CREATE TABLE blocked_dates (
        id INTEGER PRIMARY KEY,
        date TEXT NOT NULL,
        unit_id INTEGER REFERENCES units(id) ON DELETE CASCADE,
        reason TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE UNIQUE INDEX idx_blocked_unique ON blocked_dates(date, IFNULL(unit_id, 0));

      CREATE TABLE contracts (
        id INTEGER PRIMARY KEY,
        event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        number TEXT NOT NULL UNIQUE,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'rascunho'
          CHECK (status IN ('rascunho','enviado','assinado','cancelado')),
        public_token TEXT NOT NULL UNIQUE,
        accepted_name TEXT,
        accepted_document TEXT,
        accepted_ip TEXT,
        accepted_at TEXT,
        sent_at TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_contracts_event ON contracts(event_id);

      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('receber','pagar')),
        description TEXT NOT NULL,
        category TEXT,
        amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
        due_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','pago','cancelado')),
        paid_at TEXT,
        paid_amount_cents INTEGER,
        payment_method TEXT,
        client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        event_id INTEGER REFERENCES events(id) ON DELETE SET NULL,
        supplier TEXT,
        document_number TEXT,
        installment TEXT,
        notes TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_transactions_due ON transactions(type, status, due_date);
      CREATE INDEX idx_transactions_paid ON transactions(status, paid_at);

      CREATE TABLE forms (
        id INTEGER PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL CHECK (type IN ('cadastro','briefing')),
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        event_id INTEGER REFERENCES events(id) ON DELETE CASCADE,
        status TEXT NOT NULL DEFAULT 'pendente' CHECK (status IN ('pendente','respondido')),
        response TEXT,
        expires_at TEXT NOT NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        responded_at TEXT
      );

      CREATE TABLE whatsapp_messages (
        id INTEGER PRIMARY KEY,
        client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
        phone TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('mensagem','contrato','formulario','cobranca')),
        body TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('link','api')),
        status TEXT NOT NULL,
        provider_id TEXT,
        error TEXT,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        entity TEXT NOT NULL,
        entity_id INTEGER,
        details TEXT,
        ip TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX idx_audit_created ON audit_log(created_at);
    `,
  },
];

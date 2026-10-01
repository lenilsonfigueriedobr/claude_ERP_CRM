// Popula o banco com dados de exemplo. Uso: npm run seed:demo
import { loadConfig } from '../config.js';
import { openDb } from './index.js';
import { ensureAdmin } from './bootstrap.js';
import { hashPassword } from '../lib/security.js';
import { computeEnd, fromMinutes, toMinutes } from '../lib/eventRules.js';
import { assertSchedule } from '../lib/schedule.js';
import { moveStock } from '../lib/stock.js';
import { saveSettings } from '../lib/settings.js';
import { today } from '../lib/format.js';

const DEMO_PASSWORD = 'Demo12345';

export async function seedDemo(db) {
  if ((await db.get('SELECT COUNT(*) AS n FROM units')).n) {
    console.log('O banco já tem dados. Nada foi alterado.');
    return false;
  }
  const t = today();
  const day = (offset) => fromMinutes(toMinutes(`${t}T00:00`) + offset * 1440).slice(0, 10);

  await db.transaction(async (tx) => {
    const ins = async (sql, ...args) => (await tx.run(sql, ...args)).lastInsertRowid;
    const seq = async (list, fn) => { const out = []; for (const item of list) out.push(await fn(item)); return out; };
    await saveSettings(tx, {
      company_name: 'Villa Aurora Eventos', company_document: '12.345.678/0001-90',
      company_address: 'Rua das Palmeiras, 200 - Jardim Europa', company_city: 'São Paulo', company_phone: '(11) 3333-4444',
      company_email: 'contato@villaaurora.com.br',
    });

    for (const [name, email, role] of [
      ['Gabriela Gerente', 'gerente@demo.com', 'gerente'], ['Fábio Financeiro', 'financeiro@demo.com', 'financeiro'],
      ['Carla Comercial', 'comercial@demo.com', 'comercial'], ['Oscar Operador', 'operador@demo.com', 'operador'],
    ]) {
      await ins('INSERT INTO users (name, email, role, password_hash) VALUES (?, ?, ?, ?)', name, email, role, hashPassword(DEMO_PASSWORD));
    }
    const userId = (await tx.get("SELECT id FROM users WHERE role = 'comercial'")).id;

    const units = await seq([
      ['Salão Jardim', 'Rua das Palmeiras, 200 - Térreo', 250, '#6d5bd0'],
      ['Espaço Lago', 'Av. do Lago, 1500', 120, '#2a78d6'],
      ['Rooftop Aurora', 'Rua das Palmeiras, 200 - Cobertura', 80, '#b8913f'],
    ], ([n, l, c, color]) => ins('INSERT INTO units (name, location, capacity, color) VALUES (?, ?, ?, ?)', n, l, c, color));

    const clients = await seq([
      ['Ana Beatriz Lima', '11987654321', 'ana.lima@email.com', 'Instagram'],
      ['Ricardo Mendes', '11976543210', 'ricardo@email.com', 'Indicação'],
      ['Tech Solutions Ltda', '11965432109', 'eventos@techsolutions.com', 'Site', 'PJ'],
      ['Juliana Costa', '11954321098', 'ju.costa@email.com', 'Google'],
      ['Marcos e Paula', '11943210987', 'marcospaula@email.com', 'Indicação'],
      ['Colégio Horizonte', '11932109876', 'formatura@horizonte.edu.br', 'WhatsApp', 'PJ'],
    ], ([n, w, e, s, type = 'PF']) => ins('INSERT INTO clients (type, name, whatsapp, email, source, city, state, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      type, n, w, e, s, 'São Paulo', 'SP', userId));

    const p = (type, name, price, measure = 'un', min = 0, category = null) =>
      ins('INSERT INTO products (type, name, price_cents, cost_cents, unit_measure, min_stock, category) VALUES (?, ?, ?, ?, ?, ?, ?)',
        type, name, price, Math.round(price * 0.45), measure, min, category);
    const buffet = await p('servico', 'Buffet completo', 9500, 'pessoa', 0, 'Buffet');
    const coquetel = await p('servico', 'Coquetel volante', 6000, 'pessoa', 0, 'Buffet');
    const dj = await p('servico', 'DJ com som e iluminação', 250000, 'un', 0, 'Atrações');
    const decor = await p('servico', 'Decoração temática', 380000, 'un', 0, 'Decoração');
    const espaco = await p('servico', 'Locação do espaço', 600000, 'un', 0, 'Locação');
    const refri = await p('produto', 'Refrigerante 2L', 1200, 'un', 40, 'Bebidas');
    const agua = await p('produto', 'Água mineral 500ml', 350, 'un', 100, 'Bebidas');
    const espumante = await p('produto', 'Espumante brut', 6900, 'un', 24, 'Bebidas');
    await p('produto', 'Toalha de mesa redonda', 4500, 'un', 30, 'Enxoval');

    for (const [i, u] of units.entries()) {
      await moveStock(tx, { productId: refri, unitId: u, delta: 120 - i * 50, type: 'entrada', reason: 'Estoque inicial' });
      await moveStock(tx, { productId: agua, unitId: u, delta: 300 - i * 120, type: 'entrada', reason: 'Estoque inicial' });
      await moveStock(tx, { productId: espumante, unitId: u, delta: 48 - i * 20, type: 'entrada', reason: 'Estoque inicial' });
    }

    const events = [
      [0, 3, '19:00', 360, 'Casamento Ana e Pedro', 'Casamento', 180, 'confirmado', [[espaco, 1], [buffet, 180], [dj, 1], [decor, 1], [espumante, 30]]],
      [2, 3, '12:00', 240, 'Confraternização Tech Solutions', 'Corporativo', 90, 'confirmado', [[espaco, 1], [coquetel, 90]]],
      [1, 5, '20:00', 300, 'Aniversário 40 anos Ricardo', 'Aniversário', 100, 'pre_reserva', [[buffet, 100], [dj, 1]]],
      [3, 8, '18:00', 300, '15 anos da Juliana', '15 anos', 70, 'confirmado', [[buffet, 70], [decor, 1], [refri, 20]]],
      [0, 12, '21:00', 360, 'Formatura Colégio Horizonte', 'Formatura', 240, 'confirmado', [[espaco, 1], [buffet, 240], [dj, 1]]],
      [4, 15, '13:00', 240, 'Bodas de prata Marcos e Paula', 'Bodas', 60, 'pre_reserva', [[coquetel, 60], [espumante, 12]]],
      [1, -6, '19:00', 300, 'Chá revelação Juliana', 'Chá de bebê', 50, 'realizado', [[coquetel, 50]]],
      [0, 22, '12:00', 300, 'Almoço corporativo Tech', 'Corporativo', 120, 'pre_reserva', [[buffet, 120]]],
      [0, 22, '19:00', 300, 'Aniversário infantil Ricardo Jr.', 'Aniversário', 80, 'pre_reserva', [[buffet, 80]]],
    ];
    const prices = Object.fromEntries((await tx.all('SELECT id, price_cents, name FROM products')).map((r) => [r.id, r]));
    const eventIds = [];
    for (const [ci, offset, time, dur, title, type, guests, status, items] of events) {
      const unitId = units[guests > 120 ? 0 : guests > 80 ? 1 : 2];
      const start = `${day(offset)}T${time}`;
      await assertSchedule(tx, { unitId, startAt: start, durationMinutes: dur, guests });
      const total = items.reduce((s, [pid, q]) => s + prices[pid].price_cents * q, 0);
      const evId = await ins(`INSERT INTO events (title, client_id, unit_id, event_type, start_at, end_at, duration_minutes, guests, status, total_cents, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, title, clients[ci], unitId, type, start, computeEnd(start, dur), dur, guests, status, total, userId);
      for (const [pid, q] of items) {
        await ins('INSERT INTO event_items (event_id, product_id, description, quantity, unit_price_cents) VALUES (?, ?, ?, ?, ?)', evId, pid, prices[pid].name, q, prices[pid].price_cents);
      }
      eventIds.push([evId, total, clients[ci], title, offset]);
    }

    // Parcelas: entrada já paga + saldo pendente
    for (const [evId, total, clientId, title, offset] of eventIds.slice(0, 5)) {
      const half = Math.round(total / 2);
      await ins(`INSERT INTO transactions (type, description, category, amount_cents, due_date, status, paid_at, paid_amount_cents, payment_method, client_id, event_id, installment)
        VALUES ('receber', ?, 'Eventos', ?, ?, 'pago', ?, ?, 'PIX', ?, ?, '1/2')`, `${title} - parcela 1/2`, half, day(offset - 30), day(offset - 30), half, clientId, evId);
      await ins(`INSERT INTO transactions (type, description, category, amount_cents, due_date, client_id, event_id, installment, payment_method)
        VALUES ('receber', ?, 'Eventos', ?, ?, ?, ?, '2/2', 'PIX')`, `${title} - parcela 2/2`, total - half, day(offset - 2), clientId, evId);
    }
    const bills = [
      ['Aluguel do galpão', 'Aluguel', 850000, -20, true], ['Folha de pagamento', 'Folha de pagamento', 2400000, -25, true],
      ['Energia elétrica', 'Energia/Água', 182000, -3, false], ['Fornecedor de bebidas', 'Fornecedores', 640000, 5, false],
      ['Floricultura Bella Flor', 'Fornecedores', 310000, 10, false], ['Anúncios Instagram', 'Marketing', 150000, 18, false],
    ];
    for (const [desc, cat, amount, offset, paid] of bills) {
      await ins(`INSERT INTO transactions (type, description, category, amount_cents, due_date, status, paid_at, paid_amount_cents, supplier)
        VALUES ('pagar', ?, ?, ?, ?, ?, ?, ?, ?)`, desc, cat, amount, day(offset), paid ? 'pago' : 'pendente', paid ? day(offset) : null, paid ? amount : null, desc);
    }

    const deals = [
      [3, 'Casamento Juliana e Rafael', 'proposta', 4800000, 'Casamento', 60, 200],
      [1, 'Festa de fim de ano empresa do Ricardo', 'negociacao', 2200000, 'Corporativo', 75, 120],
      [4, 'Batizado do neto', 'contato', 900000, 'Batizado', 40, 60],
      [0, 'Aniversário 1 ano da Sofia', 'novo', 1100000, 'Aniversário', 90, 80],
      [5, 'Formatura 2027', 'visita', 9000000, 'Formatura', 300, 240],
    ];
    for (const [ci, title, stage, value, type, offset, guests] of deals) {
      await ins('INSERT INTO deals (title, client_id, stage, value_cents, event_type, expected_date, guests, owner_id, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        title, clients[ci], stage, value, type, day(offset), guests, userId, 'Instagram');
    }
    await ins('INSERT INTO blocked_dates (date, unit_id, reason) VALUES (?, NULL, ?)', day(26), 'Manutenção geral das unidades');
  });
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const db = await openDb(config.db);
  await ensureAdmin(db, config);
  if (await seedDemo(db)) {
    console.log('Dados de demonstração criados.');
    console.log(`Usuários de teste (senha ${DEMO_PASSWORD}): gerente@demo.com, financeiro@demo.com, comercial@demo.com, operador@demo.com`);
  }
  db.close();
}

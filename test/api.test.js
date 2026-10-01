import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client } from './helpers.js';

let srv;
let admin;
const ids = {};

before(async () => {
  srv = await startServer();
  admin = client(srv.base);
  const r = await admin.login('admin@teste.com', 'Senha1234');
  assert.equal(r.status, 200);

  const unit = await admin.post('/api/units', { name: 'Salão Jardim', location: 'Rua das Flores, 100', capacity: 200 });
  assert.equal(unit.status, 201);
  ids.unit = unit.data.id;
  const unit2 = await admin.post('/api/units', { name: 'Espaço Lago', location: 'Av. do Lago, 50', capacity: 80 });
  ids.unit2 = unit2.data.id;
  const cl = await admin.post('/api/clients', { name: 'Maria Souza', whatsapp: '(11) 98888-7777', email: 'maria@ex.com' });
  assert.equal(cl.status, 201);
  ids.client = cl.data.id;
  const prod = await admin.post('/api/products', { type: 'produto', name: 'Refrigerante 2L', price_cents: 1200, min_stock: 10 });
  ids.product = prod.data.id;
  const serv = await admin.post('/api/products', { type: 'servico', name: 'Buffet completo', price_cents: 8000 });
  ids.service = serv.data.id;

  for (const [role, email] of [['gerente', 'ger@teste.com'], ['comercial', 'com@teste.com'], ['operador', 'op@teste.com'], ['financeiro', 'fin@teste.com']]) {
    const u = await admin.post('/api/users', { name: role, email, role, password: 'Senha1234' });
    assert.equal(u.status, 201);
  }
});

after(() => srv.close());

const newEvent = (over = {}) => ({
  title: 'Aniversário', client_id: ids.client, unit_id: ids.unit, start_at: '2030-05-10T12:00', duration_minutes: 240, guests: 100,
  items: [{ product_id: ids.service, description: 'Buffet completo', quantity: 100, unit_price_cents: 8000 }], ...over,
});

test('rotas protegidas exigem login', async () => {
  const anon = client(srv.base);
  assert.equal((await anon.get('/api/events')).status, 401);
});

test('requisições que alteram dados exigem token CSRF', async () => {
  const c = client(srv.base);
  await c.login('admin@teste.com', 'Senha1234');
  c.setCsrf('token-errado');
  const r = await c.post('/api/units', { name: 'X', location: 'Y', capacity: 10 });
  assert.equal(r.status, 403);
});

test('origem diferente é recusada', async () => {
  const r = await admin.post('/api/units', { name: 'X', location: 'Y', capacity: 10 }, { origin: 'https://site-malicioso.com' });
  assert.equal(r.status, 403);
});

test('cria evento e calcula horário final e total automaticamente', async () => {
  const r = await admin.post('/api/events', newEvent());
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.end_at, '2030-05-10T16:00');
  assert.equal(r.data.total_cents, 800000);
  ids.event = r.data.id;
});

test('bloqueia evento no mesmo horário e sem intervalo de 2h', async () => {
  const same = await admin.post('/api/events', newEvent());
  assert.equal(same.status, 409);
  const tooSoon = await admin.post('/api/events', newEvent({ start_at: '2030-05-10T17:30' }));
  assert.equal(tooSoon.status, 409);
  assert.match(tooSoon.data.error, /2 horas/);
  assert.match(tooSoon.data.error, /18:00/);
  const otherUnit = await admin.post('/api/events', newEvent({ unit_id: ids.unit2, guests: 50 }));
  assert.equal(otherUnit.status, 201, 'outra unidade no mesmo horário é permitido');
  const ok = await admin.post('/api/events', newEvent({ start_at: '2030-05-10T18:00', duration_minutes: 300, title: 'Festa noite' }));
  assert.equal(ok.status, 201);
  assert.equal(ok.data.end_at, '2030-05-10T23:00');
});

test('consulta de disponibilidade devolve sugestão', async () => {
  const r = await admin.post('/api/events/availability', { unit_id: ids.unit, start_at: '2030-05-10T13:00', duration_minutes: 240 });
  assert.equal(r.status, 200);
  assert.equal(r.data.ok, false);
  assert.equal(r.data.end_at, '2030-05-10T17:00');
});

test('respeita a capacidade da unidade', async () => {
  const r = await admin.post('/api/events', newEvent({ start_at: '2030-06-01T12:00', unit_id: ids.unit2, guests: 500 }));
  assert.equal(r.status, 400);
  assert.match(r.data.error, /comporta no máximo 80/);
});

test('duração personalizada é aceita, fora do padrão é recusada', async () => {
  const ok = await admin.post('/api/events', newEvent({ start_at: '2030-07-01T10:00', duration_minutes: 450 }));
  assert.equal(ok.status, 201);
  assert.equal(ok.data.end_at, '2030-07-01T17:30');
  const bad = await admin.post('/api/events', newEvent({ start_at: '2030-07-02T10:00', duration_minutes: 20 }));
  assert.equal(bad.status, 400);
});

test('somente admin e gerente bloqueiam datas', async () => {
  const com = client(srv.base);
  await com.login('com@teste.com', 'Senha1234');
  assert.equal((await com.post('/api/blocks', { date: '2030-08-15' })).status, 403);

  const ger = client(srv.base);
  await ger.login('ger@teste.com', 'Senha1234');
  const r = await ger.post('/api/blocks', { date: '2030-08-15', reason: 'Manutenção' });
  assert.equal(r.status, 201);

  const ev = await com.post('/api/events', newEvent({ start_at: '2030-08-15T14:00' }));
  assert.equal(ev.status, 409);
  assert.match(ev.data.error, /bloqueada/);
  // Evento que começa na véspera e termina no dia bloqueado também é recusado
  const night = await com.post('/api/events', newEvent({ start_at: '2030-08-14T21:00', duration_minutes: 360 }));
  assert.equal(night.status, 409);
});

test('não bloqueia data que já tem evento', async () => {
  const r = await admin.post('/api/blocks', { date: '2030-05-10' });
  assert.equal(r.status, 409);
  assert.match(r.data.error, /Aniversário|Festa noite/);
});

test('perfil operador não cria eventos nem vê financeiro', async () => {
  const op = client(srv.base);
  await op.login('op@teste.com', 'Senha1234');
  assert.equal((await op.post('/api/events', newEvent({ start_at: '2031-01-01T10:00' }))).status, 403);
  assert.equal((await op.get('/api/finance/transactions')).status, 403);
  assert.equal((await op.get('/api/stock')).status, 200);
});

test('contrato: emissão, aceite público e confirmação do evento', async () => {
  const c = await admin.post('/api/contracts', { event_id: ids.event });
  assert.equal(c.status, 201);
  assert.match(c.data.content, /Maria Souza/);
  assert.match(c.data.content, /12:00 às 16:00/);
  const dup = await admin.post('/api/contracts', { event_id: ids.event });
  assert.equal(dup.status, 400);

  const anon = client(srv.base);
  const pub = await anon.get(`/api/public/contracts/${c.data.public_token}`);
  assert.equal(pub.status, 200);
  const accept = await anon.post(`/api/public/contracts/${c.data.public_token}/accept`, { name: 'Maria Souza', document: '123.456.789-09', agree: true });
  assert.equal(accept.status, 200);
  const ev = await admin.get(`/api/events/${ids.event}`);
  assert.equal(ev.data.status, 'confirmado');
  assert.equal((await anon.get('/api/public/contracts/tokeninvalido')).status, 404);
});

test('financeiro: parcelas do evento, baixa e fluxo de caixa', async () => {
  const r = await admin.post(`/api/events/${ids.event}/receivables`, { installments: 3, first_due_date: '2030-01-10' });
  assert.equal(r.status, 201);
  const list = await admin.get(`/api/finance/transactions?type=receber`);
  const parcels = list.data.filter((t) => t.event_id === ids.event);
  assert.equal(parcels.length, 3);
  assert.equal(parcels.reduce((s, t) => s + t.amount_cents, 0), 800000);
  const again = await admin.post(`/api/events/${ids.event}/receivables`, { installments: 1, first_due_date: '2030-01-10' });
  assert.equal(again.status, 400);

  const pay = await admin.post(`/api/finance/transactions/${parcels[0].id}/pay`, { paid_at: '2030-01-10', paid_amount_cents: parcels[0].amount_cents });
  assert.equal(pay.status, 200);
  const expense = await admin.post('/api/finance/transactions', { type: 'pagar', description: 'Decoração', amount_cents: 50000, due_date: '2030-01-15' });
  assert.equal(expense.status, 201);
  await admin.post(`/api/finance/transactions/${expense.data.id}/pay`, { paid_at: '2030-01-15', paid_amount_cents: 50000 });

  const flow = await admin.get('/api/finance/cashflow?from=2030-01-01&to=2030-03-31&group=month');
  assert.equal(flow.status, 200);
  const jan = flow.data.rows.find((x) => x.period === '2030-01');
  assert.equal(jan.realized_in, parcels[0].amount_cents);
  assert.equal(jan.realized_out, 50000);
  assert.equal(flow.data.rows.at(-1).projected_balance, 800000 - 50000);
});

test('estoque: entrada, saída sem saldo e baixa pelo evento', async () => {
  const entrada = await admin.post('/api/stock/movements', { product_id: ids.product, unit_id: ids.unit, type: 'entrada', quantity: 30 });
  assert.equal(entrada.status, 201);
  assert.equal(entrada.data.balance, 30);
  const saida = await admin.post('/api/stock/movements', { product_id: ids.product, unit_id: ids.unit, type: 'saida', quantity: 100 });
  assert.equal(saida.status, 400);
  const tr = await admin.post('/api/stock/transfer', { product_id: ids.product, from_unit_id: ids.unit, to_unit_id: ids.unit2, quantity: 5 });
  assert.equal(tr.status, 201);

  const ev = await admin.post('/api/events', newEvent({
    start_at: '2030-09-01T12:00',
    items: [{ product_id: ids.product, description: 'Refrigerante 2L', quantity: 20, unit_price_cents: 1200 }],
  }));
  assert.equal(ev.status, 201);
  assert.equal((await admin.post(`/api/events/${ev.data.id}/consume-stock`)).status, 200);
  assert.equal((await admin.post(`/api/events/${ev.data.id}/consume-stock`)).status, 409);
  const stock = await admin.get(`/api/stock?unit_id=${ids.unit}`);
  assert.equal(stock.data.find((s) => s.product_id === ids.product).quantity, 5);
});

test('WhatsApp sem API configurada gera link wa.me e formulário público funciona', async () => {
  const r = await admin.post('/api/whatsapp/send', { client_id: ids.client, kind: 'formulario', form_type: 'cadastro' });
  assert.equal(r.status, 200);
  assert.equal(r.data.mode, 'link');
  assert.match(r.data.url, /^https:\/\/wa\.me\/5511988887777\?text=/);
  const token = decodeURIComponent(r.data.url).match(/formulario\/([\w-]+)/)[1];
  const anon = client(srv.base);
  const form = await anon.get(`/api/public/forms/${token}`);
  assert.equal(form.data.prefill.name, 'Maria Souza');
  const sent = await anon.post(`/api/public/forms/${token}`, { name: 'Maria Souza Lima', city: 'São Paulo', state: 'sp' });
  assert.equal(sent.status, 200);
  assert.equal((await anon.post(`/api/public/forms/${token}`, { name: 'x' })).status, 409);
  const cl = await admin.get(`/api/clients/${ids.client}`);
  assert.equal(cl.data.name, 'Maria Souza Lima');
  assert.equal(cl.data.state, 'SP');
});

test('cancelar evento libera o horário', async () => {
  const ev = await admin.post('/api/events', newEvent({ start_at: '2030-10-01T12:00' }));
  assert.equal((await admin.post(`/api/events/${ev.data.id}/status`, { status: 'cancelado' })).status, 400);
  assert.equal((await admin.post(`/api/events/${ev.data.id}/status`, { status: 'cancelado', cancel_reason: 'Desistência' })).status, 200);
  const again = await admin.post('/api/events', newEvent({ start_at: '2030-10-01T12:00' }));
  assert.equal(again.status, 201);
  // reativar o cancelado agora conflita
  assert.equal((await admin.post(`/api/events/${ev.data.id}/status`, { status: 'pre_reserva' })).status, 409);
});

test('conta é bloqueada após 5 senhas erradas', async () => {
  const c = client(srv.base);
  for (let i = 0; i < 5; i += 1) assert.equal((await c.login('fin@teste.com', 'errada123')).status, 401);
  assert.equal((await c.login('fin@teste.com', 'Senha1234')).status, 423);
});

test('não permite remover o último administrador', async () => {
  const me = await admin.get('/api/auth/me');
  const r = await admin.put(`/api/users/${me.data.user.id}`, { name: 'Admin', email: 'admin@teste.com', role: 'gerente', active: true });
  assert.equal(r.status, 400);
});

import {
  h, mount, btn, badge, input, select, textarea, moneyInput, field, formModal, table, tabs, loading, toast, toastError, confirmDialog, dropdown, debounce, ic,
} from '../ui.js';
import { get, post, put, del, qs } from '../api.js';
import { can } from '../store.js';
import { brl, brlShort, dateBR, todayISO, addDays, monthShort, PAYMENT_METHODS } from '../format.js';
import { openWhatsApp } from '../components/whatsapp.js';

const CATEGORIES = {
  receber: ['Eventos', 'Locação', 'Serviços extras', 'Outros'],
  pagar: ['Fornecedores', 'Folha de pagamento', 'Aluguel', 'Energia/Água', 'Manutenção', 'Marketing', 'Impostos', 'Outros'],
};

export async function render(root, { query }) {
  let tab = ['receber', 'pagar'].includes(query.get('tab')) ? query.get('tab') : 'geral';
  const tabBox = h('div');
  const box = h('div');

  const draw = () => {
    mount(tabBox, tabs([
      { key: 'geral', label: 'Fluxo de caixa' },
      { key: 'receber', label: 'Contas a receber' },
      { key: 'pagar', label: 'Contas a pagar' },
    ], tab, (k) => { tab = k; draw(); }));
    if (tab === 'geral') overview(box); else accounts(box, tab);
  };

  mount(root,
    h('div', { class: 'page-head' }, h('div', h('h1', 'Financeiro'), h('p', 'Contas a pagar, contas a receber e fluxo de caixa.')),
      can('finance', 'w') ? h('div', { class: 'btn-group' },
        btn('Conta a pagar', { icon: 'arrowUp', onClick: () => txForm({ type: 'pagar' }, draw) }),
        btn('Conta a receber', { icon: 'arrowDown', variant: 'primary', onClick: () => txForm({ type: 'receber' }, draw) })) : null),
    tabBox, box);
  draw();
}

// ---------- Visão geral / fluxo de caixa ----------
async function overview(box) {
  const t = todayISO();
  let range = 'semestre';
  const ranges = {
    mes: () => ({ from: `${t.slice(0, 8)}01`, to: monthEnd(t, 0), group: 'day' }),
    semestre: () => ({ from: `${addDays(`${t.slice(0, 8)}01`, -1).slice(0, 8)}01`, to: monthEnd(t, 4), group: 'month' }),
    ano: () => ({ from: `${t.slice(0, 4)}-01-01`, to: `${t.slice(0, 4)}-12-31`, group: 'month' }),
  };
  const body = h('div');

  const load = async () => {
    const r = ranges[range]();
    mount(body, loading());
    try {
      const [summary, flow] = await Promise.all([get('/finance/summary'), get(`/finance/cashflow${qs(r)}`)]);
      mount(body,
        h('div', { class: 'grid grid-4' },
          kpi('Saldo em caixa', 'wallet', brl(summary.balance)),
          kpi('A receber (pendente)', 'arrowDown', brl(summary.receivable_pending), summary.receivable_overdue ? `${brl(summary.receivable_overdue)} vencido` : 'nada vencido', summary.receivable_overdue > 0),
          kpi('A pagar (pendente)', 'arrowUp', brl(summary.payable_pending), summary.payable_overdue ? `${brl(summary.payable_overdue)} vencido` : 'nada vencido', summary.payable_overdue > 0),
          kpi('Resultado do mês', 'chart', brl(summary.month_in - summary.month_out), `Entrou ${brlShort(summary.month_in)} · saiu ${brlShort(summary.month_out)}`)),
        h('div', { class: 'card mt' },
          h('div', { class: 'card-head' }, h('h3', 'Fluxo de caixa'), h('span', { class: 'muted small' }, `Saldo inicial do período: ${brl(flow.opening_balance)}`)),
          h('div', { class: 'card-body' }, cashflowChart(flow))),
        h('div', { class: 'card mt' },
          h('div', { class: 'card-head' }, h('h3', 'Detalhamento')),
          table([
            { label: 'Período', primary: true, render: (r) => h('b', periodLabel(r.period, flow.group)) },
            { label: 'Entradas', num: true, render: (r) => brl(r.realized_in) },
            { label: 'Saídas', num: true, render: (r) => brl(r.realized_out) },
            { label: 'A receber', num: true, render: (r) => h('span', { class: 'muted' }, brl(r.projected_in)) },
            { label: 'A pagar', num: true, render: (r) => h('span', { class: 'muted' }, brl(r.projected_out)) },
            { label: 'Saldo realizado', num: true, render: (r) => h('b', brl(r.balance)) },
            { label: 'Saldo previsto', num: true, render: (r) => brl(r.projected_balance) },
          ], flow.rows.filter((r) => flow.group === 'month' || r.realized_in || r.realized_out || r.projected_in || r.projected_out), { emptyText: 'Sem movimentação no período.' })));
    } catch (err) { toastError(err); }
  };

  const rangeSel = select('range', [{ value: 'mes', label: 'Este mês (por dia)' }, { value: 'semestre', label: 'Mês anterior + 4 meses' }, { value: 'ano', label: 'Ano atual' }], range);
  rangeSel.style.width = 'auto';
  rangeSel.addEventListener('change', () => { range = rangeSel.value; load(); });
  mount(box, h('div', { class: 'toolbar' }, h('span', { class: 'label' }, 'Período'), rangeSel), body);
  await load();
}

function monthEnd(iso, plusMonths) {
  let [y, m] = iso.split('-').map(Number);
  m += plusMonths + 1;
  while (m > 12) { m -= 12; y += 1; }
  return addDays(`${y}-${String(m).padStart(2, '0')}-01`, -1);
}

function periodLabel(p, group) {
  if (group === 'month') return `${monthShort(Number(p.slice(5, 7)) - 1)}/${p.slice(0, 4)}`;
  return dateBR(p);
}

function kpi(label, iconName, value, foot, bad) {
  return h('div', { class: 'card kpi' }, h('div', { class: 'kpi-label' }, ic(iconName), label), h('div', { class: 'kpi-value' }, value),
    foot ? h('div', { class: `kpi-foot ${bad ? 'bad' : ''}` }, foot) : null);
}

// Barras de entradas e saídas (realizado + previsto) e linha do saldo previsto, num único eixo em R$.
function cashflowChart(flow) {
  const rows = flow.rows;
  if (!rows.length) return h('div', { class: 'muted' }, 'Sem dados.');
  const W = 900; const H = 280; const padL = 64; const padR = 12; const padT = 12; const padB = 30;
  const values = rows.flatMap((r) => [r.realized_in + r.projected_in, r.realized_out + r.projected_out, r.projected_balance, 0]);
  let max = Math.max(...values); let min = Math.min(...values);
  if (max === min) max = min + 100;
  const span = max - min; max += span * 0.08; if (min < 0) min -= span * 0.08;
  const y = (v) => padT + (H - padT - padB) * (1 - (v - min) / (max - min));
  const slot = (W - padL - padR) / rows.length;
  const barW = Math.max(3, Math.min(22, slot * 0.32));
  const NS = 'http://www.w3.org/2000/svg';
  const s = (tag, attrs) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
  const svg = s('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Gráfico de fluxo de caixa: entradas, saídas e saldo previsto por período' });

  for (let i = 0; i <= 4; i += 1) {
    const v = min + ((max - min) * i) / 4;
    svg.append(s('line', { x1: padL, x2: W - padR, y1: y(v), y2: y(v), class: 'grid-line' }));
    const tx = s('text', { x: padL - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'axis-label' });
    tx.textContent = brlShort(Math.round(v));
    svg.append(tx);
  }
  const zero = y(0);
  svg.append(s('line', { x1: padL, x2: W - padR, y1: zero, y2: zero, stroke: 'var(--border-strong)', 'stroke-width': 1 }));

  const wrap = h('div', { class: 'chart' });
  const tip = h('div', { class: 'tooltip hidden' });
  const bar = (x, v, color, faded) => {
    const top = Math.min(y(v), zero); const height = Math.max(0, Math.abs(zero - y(v)));
    if (!height) return null;
    return s('path', { d: roundedTop(x, top, barW, height, Math.min(4, height)), fill: color, 'fill-opacity': faded ? 0.38 : 1 });
  };
  const points = [];
  const labelEvery = Math.ceil(rows.length / 12);
  rows.forEach((r, i) => {
    const cx = padL + slot * i + slot / 2;
    const g = s('g', {});
    const xIn = cx - barW - 1; const xOut = cx + 1; // 2px de respiro entre as barras
    [bar(xIn, r.realized_in, 'var(--series-in)'), bar(xIn, r.realized_in + r.projected_in, 'var(--series-in)', true),
      bar(xOut, r.realized_out, 'var(--series-out)'), bar(xOut, r.realized_out + r.projected_out, 'var(--series-out)', true)]
      .forEach((el) => el && g.append(el));
    const hit = s('rect', { x: padL + slot * i, y: padT, width: slot, height: H - padT - padB, fill: 'transparent' });
    hit.addEventListener('mouseenter', () => {
      mount(tip, h('b', periodLabel(r.period, flow.group)),
        h('div', `Entradas: ${brl(r.realized_in)}${r.projected_in ? ` (+${brl(r.projected_in)} previsto)` : ''}`),
        h('div', `Saídas: ${brl(r.realized_out)}${r.projected_out ? ` (+${brl(r.projected_out)} previsto)` : ''}`),
        h('div', `Saldo previsto: ${brl(r.projected_balance)}`));
      tip.classList.remove('hidden');
      tip.style.left = `${(cx / W) * 100}%`;
      tip.style.top = `${(Math.min(y(r.projected_balance), y(r.realized_in + r.projected_in)) / H) * 100}%`;
    });
    hit.addEventListener('mouseleave', () => tip.classList.add('hidden'));
    g.append(hit);
    svg.append(g);
    points.push([cx, y(r.projected_balance)]);
    if (i % labelEvery === 0) {
      const tx = s('text', { x: cx, y: H - 10, 'text-anchor': 'middle', class: 'axis-label' });
      tx.textContent = flow.group === 'month' ? periodLabel(r.period, 'month') : r.period.slice(8, 10);
      svg.append(tx);
    }
  });
  svg.append(s('polyline', { points: points.map((p) => p.join(',')).join(' '), fill: 'none', stroke: 'var(--text)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'pointer-events': 'none' }));
  if (points.length <= 31) {
    points.forEach(([px, py]) => svg.append(s('circle', { cx: px, cy: py, r: 4, fill: 'var(--text)', stroke: 'var(--surface)', 'stroke-width': 2, 'pointer-events': 'none' })));
  }

  const sw = (cls, color) => { const e = h('i', { class: cls }); e.style.background = color; return e; };
  const faded = (color) => { const e = sw('swatch', color); e.style.opacity = '.38'; return e; };
  wrap.append(svg, tip);
  return h('div',
    h('div', { class: 'chart-legend' },
      h('span', sw('swatch', 'var(--series-in)'), 'Entradas'), h('span', sw('swatch', 'var(--series-out)'), 'Saídas'),
      h('span', faded('var(--series-in)'), faded('var(--series-out)'), 'Previsto (pendente)'),
      h('span', sw('swatch line', 'var(--text)'), 'Saldo previsto')),
    wrap);
}

function roundedTop(x, yTop, w, height, r) {
  return `M${x},${yTop + height} L${x},${yTop + r} Q${x},${yTop} ${x + r},${yTop} L${x + w - r},${yTop} Q${x + w},${yTop} ${x + w},${yTop + r} L${x + w},${yTop + height} Z`;
}

// ---------- Contas a pagar / receber ----------
async function accounts(box, type) {
  const status = select('status', [
    { value: 'pendente', label: 'Pendentes' }, { value: 'vencido', label: 'Vencidos' }, { value: 'pago', label: 'Pagos' },
    { value: 'cancelado', label: 'Cancelados' }, { value: '', label: 'Todos' },
  ], 'pendente');
  const from = input('from', '', { type: 'date', 'aria-label': 'Vencimento de' });
  const to = input('to', '', { type: 'date', 'aria-label': 'Vencimento até' });
  const q = input('q', '', { type: 'search', placeholder: 'Descrição, cliente, fornecedor', 'aria-label': 'Buscar' });
  const list = h('div', { class: 'card' });
  const totals = h('div', { class: 'row muted small mb' });

  const reload = async () => {
    mount(list, loading());
    try {
      const rows = await get(`/finance/transactions${qs({ type, status: status.value, from: from.value, to: to.value, q: q.value.trim() })}`);
      const sum = rows.reduce((s, r) => s + (r.status === 'pago' ? r.paid_amount_cents : r.amount_cents), 0);
      mount(totals, `${rows.length} lançamento(s) · total ${brl(sum)}`);
      mount(list, table([
        { label: 'Vencimento', render: (r) => h('div', h('b', { class: 'nowrap' }, dateBR(r.due_date)), r.installment ? h('div', { class: 'cell-sub' }, `Parcela ${r.installment}`) : null) },
        { label: 'Descrição', primary: true, render: (r) => h('div', h('div', { class: 'cell-title' }, r.description),
          h('div', { class: 'cell-sub' }, [r.category, type === 'receber' ? r.client_name : r.supplier, r.event_title ? `Evento: ${r.event_title}` : null].filter(Boolean).join(' · '))) },
        { label: 'Valor', num: true, render: (r) => h('b', brl(r.amount_cents)) },
        { label: 'Status', render: (r) => statusBadge(r) },
        { label: 'Pagamento', render: (r) => (r.status === 'pago' ? h('span', { class: 'small' }, `${dateBR(r.paid_at)} · ${brl(r.paid_amount_cents)}${r.payment_method ? ` · ${r.payment_method}` : ''}`) : h('span', { class: 'muted small' }, r.payment_method || '-')) },
        { label: '', actions: true, render: (r) => rowActions(r) },
      ], rows, { emptyText: type === 'receber' ? 'Nenhuma conta a receber neste filtro.' : 'Nenhuma conta a pagar neste filtro.', emptyIcon: 'wallet' }));
    } catch (err) { toastError(err); }
  };

  function rowActions(r) {
    const w = can('finance', 'w');
    const group = h('div', { class: 'btn-group', style: { justifyContent: 'flex-end' } });
    if (w && r.status === 'pendente') group.append(btn(type === 'receber' ? 'Receber' : 'Pagar', { icon: 'check', size: 'sm', onClick: () => payForm(r, reload) }));
    const items = [];
    if (w && r.status === 'pendente') items.push({ label: 'Editar', icon: 'edit', onClick: () => txForm(r, reload) });
    if (type === 'receber' && r.status === 'pendente' && r.client_id && can('whatsapp', 'w')) {
      items.push({ label: 'Lembrete por WhatsApp', icon: 'whatsapp', onClick: () => openWhatsApp({
        client: { id: r.client_id, name: r.client_name, whatsapp: r.client_whatsapp, phone: r.client_phone }, kinds: ['cobranca'], transactionId: r.id }) });
    }
    if (w && r.status === 'pendente') items.push({ label: 'Cancelar lançamento', icon: 'x', onClick: () => act(r, 'cancel', 'Lançamento cancelado.') });
    if (w && r.status !== 'pendente') items.push({ label: r.status === 'pago' ? 'Estornar pagamento' : 'Reabrir', icon: 'refresh', onClick: () => act(r, 'reopen', 'Lançamento reaberto.') });
    if (w && r.status !== 'pago') items.push('-', { label: 'Excluir', icon: 'trash', danger: true, onClick: async () => {
      if (!(await confirmDialog(`Excluir "${r.description}"?`, { danger: true, confirmLabel: 'Excluir' }))) return;
      try { await del(`/finance/transactions/${r.id}`); toast('Lançamento excluído.'); reload(); } catch (err) { toastError(err); }
    } });
    if (items.length) group.append(dropdown(btn('', { icon: 'more', size: 'sm', variant: 'ghost', title: 'Mais ações' }), items));
    return group;
  }

  async function act(r, action, msg) {
    try { await post(`/finance/transactions/${r.id}/${action}`); toast(msg); reload(); } catch (err) { toastError(err); }
  }

  for (const el of [status, from, to]) el.addEventListener('change', reload);
  q.addEventListener('input', debounce(reload, 300));
  mount(box, h('div', { class: 'toolbar' }, h('div', { class: 'search-wrap' }, ic('search'), q), status, from, to), totals, list);
  await reload();
}

function statusBadge(r) {
  if (r.status === 'pago') return badge('Pago', 'green');
  if (r.status === 'cancelado') return badge('Cancelado', 'gray');
  return r.overdue ? badge('Vencido', 'red') : badge('Pendente', 'amber');
}

function payForm(r, onDone) {
  formModal({
    title: r.type === 'receber' ? 'Registrar recebimento' : 'Registrar pagamento',
    submitLabel: 'Confirmar',
    fields: [
      h('div', { class: 'field' }, h('b', r.description), h('div', { class: 'muted small' }, `Valor original ${brl(r.amount_cents)} · vence ${dateBR(r.due_date)}`)),
      field('Data do pagamento', input('paid_at', todayISO(), { type: 'date' }), { span: 6, required: true }),
      field('Valor pago (R$)', moneyInput('paid_amount_cents', r.amount_cents), { span: 6, required: true, hint: 'Ajuste se houve juros ou desconto.' }),
      field('Forma de pagamento', select('payment_method', ['', ...PAYMENT_METHODS].map((p) => ({ value: p, label: p || 'Selecione' })), r.payment_method || '')),
    ],
    onSubmit: async (data, m) => {
      await post(`/finance/transactions/${r.id}/pay`, { ...data, payment_method: data.payment_method || null });
      m.close();
      toast('Baixa registrada.');
      onDone();
    },
  });
}

async function txForm(tx, onDone) {
  const isEdit = !!tx.id;
  const type = tx.type;
  const clients = type === 'receber' && can('crm') ? await get('/clients').catch(() => []) : [];
  const categoryList = h('datalist', { id: `cat-${type}` }, CATEGORIES[type].map((c) => h('option', { value: c })));
  formModal({
    title: isEdit ? 'Editar lançamento' : type === 'receber' ? 'Nova conta a receber' : 'Nova conta a pagar',
    size: 'lg',
    fields: [
      h('input', { type: 'hidden', name: 'type', value: type }),
      field('Descrição', input('description', tx.description, { maxlength: 200 }), { span: 8, required: true }),
      field('Categoria', input('category', tx.category || CATEGORIES[type][0], { maxlength: 60, list: `cat-${type}` }), { span: 4 }),
      categoryList,
      field('Valor (R$)', moneyInput('amount_cents', tx.amount_cents || 0), { span: 4, required: true }),
      field('Vencimento', input('due_date', tx.due_date || todayISO(), { type: 'date' }), { span: 4, required: true }),
      field('Forma de pagamento', select('payment_method', ['', ...PAYMENT_METHODS].map((p) => ({ value: p, label: p || 'Selecione' })), tx.payment_method || ''), { span: 4 }),
      type === 'receber'
        ? field('Cliente', select('client_id', [{ value: '', label: 'Nenhum' }, ...clients.map((c) => ({ value: c.id, label: c.name }))], tx.client_id || ''), { span: 8 })
        : field('Fornecedor', input('supplier', tx.supplier, { maxlength: 150 }), { span: 8 }),
      field('Nº documento / NF', input('document_number', tx.document_number, { maxlength: 60 }), { span: 4 }),
      field('Observações', textarea('notes', tx.notes, { maxlength: 1000 })),
    ],
    onSubmit: async (data, m) => {
      const body = { ...data, client_id: data.client_id || null, event_id: tx.event_id || null, payment_method: data.payment_method || null };
      if (isEdit) await put(`/finance/transactions/${tx.id}`, body); else await post('/finance/transactions', body);
      m.close();
      toast('Lançamento salvo.');
      onDone();
    },
  });
}

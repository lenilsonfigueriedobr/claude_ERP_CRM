import { h, mount, btn, badge, input, select, field, formModal, table, tabs, loading, toast, toastError, debounce, ic, alertBox } from '../ui.js';
import { get, post, qs } from '../api.js';
import { can, loadUnits } from '../store.js';
import { dateTimeBR } from '../format.js';

const MOVE_LABEL = {
  entrada: ['Entrada', 'green'], saida: ['Saída', 'red'], ajuste: ['Ajuste', 'amber'],
  transferencia_entrada: ['Transferência (entrada)', 'blue'], transferencia_saida: ['Transferência (saída)', 'blue'], consumo_evento: ['Consumo em evento', 'violet'],
};

export async function render(root) {
  const units = await loadUnits();
  let tab = 'posicao';
  const box = h('div');
  const tabBox = h('div');
  const unitSel = select('unit_id', [{ value: '', label: 'Todas as unidades' }, ...units.map((u) => ({ value: u.id, label: u.name }))]);
  const q = input('q', '', { type: 'search', placeholder: 'Buscar produto', 'aria-label': 'Buscar' });

  const reload = async () => {
    mount(tabBox, tabs([{ key: 'posicao', label: 'Posição de estoque' }, { key: 'movimentos', label: 'Movimentações' }], tab, (k) => { tab = k; reload(); }));
    mount(box, h('div', { class: 'card' }, loading()));
    try {
      if (tab === 'posicao') {
        const rows = await get(`/stock${qs({ unit_id: unitSel.value, q: q.value.trim() })}`);
        mount(box, h('div', { class: 'card' }, table([
          { label: 'Produto', primary: true, render: (r) => h('div', h('div', { class: 'cell-title' }, r.name), h('div', { class: 'cell-sub' }, [r.sku, r.category].filter(Boolean).join(' · '))) },
          { label: 'Unidade', key: 'unit_name' },
          { label: 'Quantidade', num: true, render: (r) => h('b', `${r.quantity} ${r.unit_measure}`) },
          { label: 'Mínimo', num: true, render: (r) => (r.min_stock ? `${r.min_stock} ${r.unit_measure}` : '-') },
          { label: 'Situação', render: (r) => (r.min_stock && r.quantity < r.min_stock ? badge('Abaixo do mínimo', 'red') : r.quantity > 0 ? badge('Ok', 'green') : badge('Zerado', 'gray')) },
          { label: '', actions: true, render: (r) => (can('stock', 'w') ? h('div', { class: 'btn-group', style: { justifyContent: 'flex-end' } },
            btn('', { icon: 'arrowDown', size: 'sm', variant: 'ghost', title: 'Entrada', onClick: () => moveForm('entrada', r) }),
            btn('', { icon: 'arrowUp', size: 'sm', variant: 'ghost', title: 'Saída', onClick: () => moveForm('saida', r) }),
            btn('', { icon: 'swap', size: 'sm', variant: 'ghost', title: 'Transferir', onClick: () => transferForm(r) })) : null) },
        ], rows, { emptyText: 'Nenhum produto com controle de estoque. Cadastre produtos do tipo "Produto".', emptyIcon: 'box' })));
      } else {
        const rows = await get(`/stock/movements${qs({ unit_id: unitSel.value })}`);
        mount(box, h('div', { class: 'card' }, table([
          { label: 'Data', render: (m) => h('span', { class: 'nowrap' }, dateTimeBR(m.created_at)) },
          { label: 'Produto', primary: true, render: (m) => h('div', h('div', { class: 'cell-title' }, m.product_name), h('div', { class: 'cell-sub' }, m.unit_name)) },
          { label: 'Tipo', render: (m) => badge(...MOVE_LABEL[m.type]) },
          { label: 'Quantidade', num: true, render: (m) => h('b', { style: { color: m.quantity < 0 ? 'var(--danger)' : 'var(--success)' } }, `${m.quantity > 0 ? '+' : ''}${m.quantity} ${m.unit_measure}`) },
          { label: 'Saldo', num: true, render: (m) => `${m.balance_after}` },
          { label: 'Motivo', render: (m) => h('span', { class: 'small' }, m.event_title ? `Evento: ${m.event_title}` : (m.reason || '-')) },
          { label: 'Usuário', render: (m) => m.user_name || '-' },
        ], rows, { emptyText: 'Nenhuma movimentação.', emptyIcon: 'history' })));
      }
    } catch (err) { toastError(err); }
  };

  async function pickProducts() {
    const products = await get('/products?type=produto');
    if (!products.length) throw new Error('Cadastre produtos do tipo "Produto" primeiro.');
    return products;
  }

  async function moveForm(type, row = null) {
    let products;
    try { products = await pickProducts(); } catch (err) { toastError(err); return; }
    const titles = { entrada: 'Entrada de estoque', saida: 'Saída de estoque', ajuste: 'Ajuste de inventário' };
    formModal({
      title: titles[type],
      submitLabel: 'Registrar',
      fields: [
        type === 'ajuste' ? h('div', { class: 'field' }, alertBox('Informe a quantidade contada. O sistema ajusta o saldo para esse valor.', 'info')) : null,
        field('Produto', select('product_id', products.map((p) => ({ value: p.id, label: `${p.name} (${p.unit_measure})` })), row?.product_id || products[0].id), { required: true }),
        field('Unidade', select('unit_id', units.map((u) => ({ value: u.id, label: u.name })), row?.unit_id || unitSel.value || units[0]?.id), { span: 6, required: true }),
        field(type === 'ajuste' ? 'Quantidade contada' : 'Quantidade', input('quantity', '', { type: 'number', min: 0, step: 'any', inputmode: 'decimal' }), { span: 6, required: true }),
        field('Motivo / observação', input('reason', '', { maxlength: 300, placeholder: type === 'entrada' ? 'Ex.: compra NF 1234' : '' })),
      ],
      onSubmit: async (data, m) => {
        const r = await post('/stock/movements', { ...data, type, product_id: Number(data.product_id), unit_id: Number(data.unit_id), quantity: Number(data.quantity) });
        m.close();
        toast(`Movimentação registrada. Saldo atual: ${r.balance}.`);
        reload();
      },
    });
  }

  async function transferForm(row = null) {
    let products;
    try { products = await pickProducts(); } catch (err) { toastError(err); return; }
    if (units.length < 2) { toastError(new Error('É preciso ter pelo menos duas unidades para transferir.')); return; }
    const from = row?.unit_id || units[0].id;
    formModal({
      title: 'Transferir entre unidades',
      submitLabel: 'Transferir',
      fields: [
        field('Produto', select('product_id', products.map((p) => ({ value: p.id, label: `${p.name} (${p.unit_measure})` })), row?.product_id || products[0].id), { required: true }),
        field('De', select('from_unit_id', units.map((u) => ({ value: u.id, label: u.name })), from), { span: 6, required: true }),
        field('Para', select('to_unit_id', units.map((u) => ({ value: u.id, label: u.name })), units.find((u) => u.id !== from)?.id), { span: 6, required: true }),
        field('Quantidade', input('quantity', '', { type: 'number', min: 0, step: 'any' }), { span: 6, required: true }),
        field('Motivo', input('reason', '', { maxlength: 300 }), { span: 6 }),
      ],
      onSubmit: async (data, m) => {
        await post('/stock/transfer', { product_id: Number(data.product_id), from_unit_id: Number(data.from_unit_id), to_unit_id: Number(data.to_unit_id), quantity: Number(data.quantity), reason: data.reason || null });
        m.close();
        toast('Transferência registrada.');
        reload();
      },
    });
  }

  q.addEventListener('input', debounce(reload, 300));
  unitSel.addEventListener('change', reload);

  mount(root,
    h('div', { class: 'page-head' }, h('div', h('h1', 'Estoque'), h('p', 'Quantidade de cada produto por unidade.')),
      can('stock', 'w') ? h('div', { class: 'btn-group' },
        btn('Ajuste', { icon: 'refresh', onClick: () => moveForm('ajuste') }),
        btn('Transferir', { icon: 'swap', onClick: () => transferForm() }),
        btn('Saída', { icon: 'arrowUp', onClick: () => moveForm('saida') }),
        btn('Entrada', { icon: 'arrowDown', variant: 'primary', onClick: () => moveForm('entrada') })) : null),
    tabBox,
    h('div', { class: 'toolbar' }, h('div', { class: 'search-wrap' }, ic('search'), q), unitSel),
    box);
  await reload();
}

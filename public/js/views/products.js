import { h, mount, btn, badge, input, select, textarea, moneyInput, field, formModal, table, tabs, loading, toast, toastError, confirmDialog, debounce, ic, checkbox } from '../ui.js';
import { get, post, put, del, qs } from '../api.js';
import { can } from '../store.js';
import { brl } from '../format.js';

const MEASURES = ['un', 'pessoa', 'hora', 'kg', 'l', 'cx', 'pct', 'm'];

export async function render(root) {
  let type = '';
  const listBox = h('div', { class: 'card' });
  const tabBox = h('div');
  const q = input('q', '', { type: 'search', placeholder: 'Nome, código ou categoria', 'aria-label': 'Buscar' });

  const reload = async () => {
    mount(tabBox, tabs([{ key: '', label: 'Todos' }, { key: 'produto', label: 'Produtos' }, { key: 'servico', label: 'Serviços' }], type, (k) => { type = k; reload(); }));
    mount(listBox, loading());
    try {
      const rows = await get(`/products${qs({ q: q.value.trim(), type, all: '1' })}`);
      mount(listBox, table([
        { label: 'Item', primary: true, render: (p) => h('div', h('div', { class: 'cell-title' }, p.name), h('div', { class: 'cell-sub' }, [p.sku, p.category].filter(Boolean).join(' · '))) },
        { label: 'Tipo', render: (p) => badge(p.type === 'servico' ? 'Serviço' : 'Produto', p.type === 'servico' ? 'blue' : 'violet', true) },
        { label: 'Preço', num: true, render: (p) => `${brl(p.price_cents)} / ${p.unit_measure}` },
        { label: 'Custo', num: true, render: (p) => brl(p.cost_cents) },
        { label: 'Estoque', num: true, render: (p) => (p.type === 'produto' ? h('span', { class: p.min_stock && p.stock_total < p.min_stock ? 'badge red plain' : '' }, `${p.stock_total} ${p.unit_measure}`) : '-') },
        { label: 'Situação', render: (p) => (p.active ? badge('Ativo', 'green') : badge('Inativo', 'gray')) },
        { label: '', actions: true, render: (p) => (can('products', 'w') ? h('div', { class: 'btn-group', style: { justifyContent: 'flex-end' } },
          btn('', { icon: 'edit', size: 'sm', variant: 'ghost', title: 'Editar', onClick: () => openForm(p) }),
          p.active ? btn('', { icon: 'trash', size: 'sm', variant: 'ghost', title: 'Desativar', onClick: () => remove(p) }) : null) : null) },
      ], rows, { onRowClick: can('products', 'w') ? openForm : null, emptyText: 'Nenhum item cadastrado.', emptyIcon: 'tag' }));
    } catch (err) { toastError(err); }
  };
  q.addEventListener('input', debounce(reload, 300));

  function openForm(p = null) {
    const item = p || { type: type || 'produto', unit_measure: 'un', active: 1 };
    const typeSel = select('type', [{ value: 'produto', label: 'Produto (controla estoque)' }, { value: 'servico', label: 'Serviço' }], item.type);
    const minField = field('Estoque mínimo', input('min_stock', item.min_stock ?? 0, { type: 'number', min: 0, step: 'any' }), { span: 4, hint: 'Alerta no painel quando ficar abaixo.' });
    const sync = () => minField.classList.toggle('hidden', typeSel.value !== 'produto');
    typeSel.addEventListener('change', sync);
    formModal({
      title: p ? 'Editar item' : 'Novo produto ou serviço',
      size: 'lg',
      fields: [
        field('Tipo', typeSel, { span: 4, required: true }),
        field('Nome', input('name', item.name, { maxlength: 150 }), { span: 8, required: true }),
        field('Código (SKU)', input('sku', item.sku, { maxlength: 60 }), { span: 4 }),
        field('Categoria', input('category', item.category, { maxlength: 60, placeholder: 'Ex.: Bebidas, Decoração, Buffet' }), { span: 4 }),
        field('Unidade de medida', select('unit_measure', MEASURES.map((m) => ({ value: m, label: m })), item.unit_measure), { span: 4, hint: '"pessoa" multiplica pelo número de convidados.' }),
        field('Preço de venda (R$)', moneyInput('price_cents', item.price_cents || 0), { span: 4, required: true }),
        field('Custo (R$)', moneyInput('cost_cents', item.cost_cents || 0), { span: 4 }),
        minField,
        field('Descrição', textarea('description', item.description, { maxlength: 1000 })),
        p ? h('div', { class: 'field' }, checkbox('active', item.active, 'Item ativo')) : null,
      ],
      onSubmit: async (data, m) => {
        const body = { ...data, min_stock: Number(data.min_stock || 0), active: p ? data.active : true };
        if (p) await put(`/products/${p.id}`, body); else await post('/products', body);
        m.close();
        toast(p ? 'Item atualizado.' : 'Item cadastrado.');
        reload();
      },
    });
    sync();
  }

  async function remove(p) {
    if (!(await confirmDialog(`Desativar "${p.name}"? Ele continua no histórico dos eventos.`, { danger: true, confirmLabel: 'Desativar' }))) return;
    try { await del(`/products/${p.id}`); toast('Item desativado.'); reload(); } catch (err) { toastError(err); }
  }

  mount(root,
    h('div', { class: 'page-head' }, h('div', h('h1', 'Produtos e serviços'), h('p', 'Itens que compõem o orçamento dos eventos.')),
      can('products', 'w') ? h('div', { class: 'btn-group' }, btn('Novo item', { variant: 'primary', icon: 'plus', onClick: () => openForm() })) : null),
    tabBox,
    h('div', { class: 'toolbar' }, h('div', { class: 'search-wrap' }, ic('search'), q)),
    listBox);
  await reload();
}

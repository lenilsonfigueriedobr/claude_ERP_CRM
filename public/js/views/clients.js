import { h, mount, btn, input, table, loading, toastError, debounce, ic, badge } from '../ui.js';
import { get, qs } from '../api.js';
import { can } from '../store.js';
import { phoneBR, docBR } from '../format.js';
import { navigate } from '../app.js';
import { openClientForm } from '../components/clientForm.js';
import { openWhatsApp } from '../components/whatsapp.js';

export async function render(root) {
  const listBox = h('div', { class: 'card' });
  const q = input('q', '', { type: 'search', placeholder: 'Nome, telefone, e-mail ou documento', 'aria-label': 'Buscar' });

  const reload = async () => {
    mount(listBox, loading());
    try {
      const rows = await get(`/clients${qs({ q: q.value.trim() })}`);
      mount(listBox, table([
        { label: 'Cliente', primary: true, render: (c) => h('div', h('div', { class: 'cell-title' }, c.name), h('div', { class: 'cell-sub' }, [c.type === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física', docBR(c.document)].filter(Boolean).join(' · '))) },
        { label: 'WhatsApp', render: (c) => phoneBR(c.whatsapp || c.phone) || '-' },
        { label: 'E-mail', render: (c) => c.email || '-' },
        { label: 'Cidade', render: (c) => [c.city, c.state].filter(Boolean).join('/') || '-' },
        { label: 'Eventos', num: true, render: (c) => (c.events_count ? badge(String(c.events_count), 'violet', true) : '0') },
        { label: '', actions: true, render: (c) => h('div', { class: 'btn-group', style: { justifyContent: 'flex-end' } },
          can('whatsapp', 'w') && (c.whatsapp || c.phone) ? btn('', { icon: 'whatsapp', size: 'sm', variant: 'ghost', title: 'Chamar no WhatsApp', onClick: () => openWhatsApp({ client: c }) }) : null,
          btn('', { icon: 'chevronRight', size: 'sm', variant: 'ghost', title: 'Abrir', onClick: () => navigate(`/clientes/${c.id}`) })) },
      ], rows, { onRowClick: (c) => navigate(`/clientes/${c.id}`), emptyText: 'Nenhum cliente encontrado.', emptyIcon: 'users' }));
    } catch (err) { toastError(err); }
  };
  q.addEventListener('input', debounce(reload, 300));

  mount(root,
    h('div', { class: 'page-head' }, h('div', h('h1', 'Clientes'), h('p', 'Cadastro de clientes, histórico de contatos e eventos.')),
      can('crm', 'w') ? h('div', { class: 'btn-group' }, btn('Novo cliente', { variant: 'primary', icon: 'plus', onClick: () => openClientForm(null, (c) => navigate(`/clientes/${c.id}`)) })) : null),
    h('div', { class: 'toolbar' }, h('div', { class: 'search-wrap' }, ic('search'), q)),
    listBox);
  await reload();
}

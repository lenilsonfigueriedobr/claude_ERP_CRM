import { h, mount, btn, badge, input, select, table, loading, toastError, debounce, ic } from '../ui.js';
import { get, qs } from '../api.js';
import { can, loadUnits } from '../store.js';
import { brl, dateBR, timeRange, todayISO, addDays, EVENT_STATUS, phoneBR } from '../format.js';
import { navigate } from '../app.js';
import { openEventForm } from '../components/eventForm.js';
import { openWhatsApp } from '../components/whatsapp.js';

export async function render(root) {
  const units = await loadUnits();
  const t = todayISO();
  const filters = { q: '', unit_id: '', status: '', from: t, to: addDays(t, 365) };

  const listBox = h('div', { class: 'card' });
  const q = input('q', '', { type: 'search', placeholder: 'Buscar por evento ou cliente', 'aria-label': 'Buscar' });
  const unit = select('unit_id', [{ value: '', label: 'Todas as unidades' }, ...units.map((u) => ({ value: u.id, label: u.name }))]);
  const status = select('status', [{ value: '', label: 'Todos os status' }, ...Object.entries(EVENT_STATUS).map(([value, s]) => ({ value, label: s.label }))]);
  const from = input('from', filters.from, { type: 'date', 'aria-label': 'De' });
  const to = input('to', filters.to, { type: 'date', 'aria-label': 'Até' });

  const reload = async () => {
    Object.assign(filters, { q: q.value.trim(), unit_id: unit.value, status: status.value, from: from.value, to: to.value });
    mount(listBox, loading());
    try {
      const rows = await get(`/events${qs(filters)}`);
      mount(listBox, table([
        { label: 'Data', render: (e) => h('div', h('div', { class: 'cell-title nowrap' }, dateBR(e.start_at)), h('div', { class: 'cell-sub nowrap' }, timeRange(e.start_at, e.end_at))) },
        { label: 'Evento', primary: true, render: (e) => h('div', h('div', { class: 'cell-title' }, e.title), h('div', { class: 'cell-sub' }, [e.event_type, e.guests ? `${e.guests} convidados` : null].filter(Boolean).join(' · '))) },
        { label: 'Cliente', render: (e) => h('div', h('div', e.client_name), h('div', { class: 'cell-sub' }, phoneBR(e.client_whatsapp || e.client_phone))) },
        { label: 'Unidade', render: (e) => { const d = h('span', { class: 'dot' }); d.style.background = e.unit_color; return h('span', { class: 'row', style: { gap: '8px', flexWrap: 'nowrap' } }, d, e.unit_name); } },
        { label: 'Status', render: (e) => badge(EVENT_STATUS[e.status].label, EVENT_STATUS[e.status].tone) },
        { label: 'Valor', num: true, render: (e) => brl(e.total_cents) },
        { label: '', actions: true, render: (e) => h('div', { class: 'btn-group', style: { justifyContent: 'flex-end' } },
          can('whatsapp', 'w') ? btn('', { icon: 'whatsapp', size: 'sm', variant: 'ghost', title: 'WhatsApp do cliente',
            onClick: () => openWhatsApp({ client: { id: e.client_id, name: e.client_name, whatsapp: e.client_whatsapp, phone: e.client_phone }, kinds: ['mensagem', 'formulario'], eventId: e.id }) }) : null,
          btn('', { icon: 'chevronRight', size: 'sm', variant: 'ghost', title: 'Abrir', onClick: () => navigate(`/eventos/${e.id}`) })) },
      ], rows, { onRowClick: (e) => navigate(`/eventos/${e.id}`), emptyText: 'Nenhum evento no período.', emptyIcon: 'calendar' }));
    } catch (err) {
      toastError(err);
    }
  };

  q.addEventListener('input', debounce(reload, 300));
  for (const el of [unit, status, from, to]) el.addEventListener('change', reload);

  mount(root,
    h('div', { class: 'page-head' },
      h('div', h('h1', 'Eventos'), h('p', 'Agenda completa de eventos de todas as unidades.')),
      can('events', 'w') ? h('div', { class: 'btn-group' }, btn('Novo evento', { variant: 'primary', icon: 'plus', onClick: async () => {
        try { await openEventForm({ onSaved: (ev) => navigate(`/eventos/${ev.id}`) }); } catch (err) { toastError(err); }
      } })) : null),
    h('div', { class: 'toolbar' }, h('div', { class: 'search-wrap' }, ic('search'), q), unit, status, from, to),
    listBox);
  await reload();
}

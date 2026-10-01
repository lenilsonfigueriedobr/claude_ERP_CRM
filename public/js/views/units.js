import { h, mount, btn, badge, input, textarea, field, formModal, toast, toastError, confirmDialog, empty, checkbox, ic } from '../ui.js';
import { get, post, put, del } from '../api.js';
import { can, invalidateUnits } from '../store.js';

const COLORS = ['#6d5bd0', '#2a78d6', '#17885d', '#b8913f', '#d07a2e', '#c63d4f', '#8f6ac9', '#1f9aa6'];

export async function render(root) {
  const grid = h('div', { class: 'cards-auto' });
  const reload = async () => {
    const units = await get('/units?all=1');
    invalidateUnits();
    if (!units.length) {
      mount(grid, h('div', { class: 'card', style: { gridColumn: '1 / -1' } }, empty('Nenhuma unidade cadastrada. Cadastre o primeiro espaço de eventos.', 'building')));
      return;
    }
    mount(grid, units.map((u) => {
      const stripe = h('div', { style: { height: '6px', borderRadius: '14px 14px 0 0' } });
      stripe.style.background = u.color;
      return h('div', { class: 'card' }, stripe,
        h('div', { class: 'card-body stack' },
          h('div', { class: 'row between' }, h('h3', u.name), u.active ? badge('Ativa', 'green') : badge('Inativa', 'gray')),
          h('div', { class: 'row muted small', style: { gap: '6px' } }, ic('pin'), u.location),
          h('div', { class: 'row', style: { gap: '20px' } },
            h('div', h('div', { class: 'kpi-value', style: { fontSize: '1.3rem' } }, u.capacity), h('div', { class: 'muted small' }, 'pessoas')),
            h('div', h('div', { class: 'kpi-value', style: { fontSize: '1.3rem' } }, u.upcoming_events), h('div', { class: 'muted small' }, 'eventos futuros'))),
          u.notes ? h('p', { class: 'small muted pre' }, u.notes) : null,
          can('units', 'w') ? h('div', { class: 'btn-group' },
            btn('Editar', { icon: 'edit', size: 'sm', onClick: () => openForm(u) }),
            u.active ? btn('Desativar', { size: 'sm', variant: 'danger', onClick: () => remove(u) }) : null) : null));
    }));
  };

  function openForm(u = null) {
    const unit = u || { color: COLORS[0], active: 1 };
    const color = input('color', unit.color, { type: 'color' });
    color.style.height = '40px';
    color.style.padding = '4px';
    formModal({
      title: u ? 'Editar unidade' : 'Nova unidade',
      fields: [
        field('Nome', input('name', unit.name, { maxlength: 100, placeholder: 'Ex.: Salão Jardim' }), { required: true }),
        field('Local / endereço', input('location', unit.location, { maxlength: 250 }), { required: true }),
        field('Capacidade (pessoas)', input('capacity', unit.capacity, { type: 'number', min: 1 }), { span: 6, required: true }),
        field('Cor na agenda', color, { span: 6 }),
        field('Observações', textarea('notes', unit.notes, { maxlength: 1000 })),
        u ? h('div', { class: 'field' }, checkbox('active', unit.active, 'Unidade ativa')) : null,
      ],
      onSubmit: async (data, m) => {
        const body = { ...data, capacity: Number(data.capacity), active: u ? data.active : true };
        if (u) await put(`/units/${u.id}`, body); else await post('/units', body);
        m.close();
        toast(u ? 'Unidade atualizada.' : 'Unidade cadastrada.');
        reload();
      },
    });
  }

  async function remove(u) {
    if (!(await confirmDialog(`Desativar a unidade ${u.name}? Ela deixa de aparecer para novos eventos. Unidades sem histórico são excluídas.`, { danger: true, confirmLabel: 'Desativar' }))) return;
    try { await del(`/units/${u.id}`); toast('Unidade removida.'); reload(); } catch (err) { toastError(err); }
  }

  mount(root,
    h('div', { class: 'page-head' }, h('div', h('h1', 'Unidades'), h('p', 'Espaços onde os eventos acontecem, com local e capacidade.')),
      can('units', 'w') ? h('div', { class: 'btn-group' }, btn('Nova unidade', { variant: 'primary', icon: 'plus', onClick: () => openForm() })) : null),
    grid);
  await reload();
}

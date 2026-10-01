import { h, mount, btn, input, select, textarea, moneyInput, field, formModal, toast, toastError, promptDialog, confirmDialog, dropdown, ic } from '../ui.js';
import { get, post, put, patch, del } from '../api.js';
import { can, loadUnits } from '../store.js';
import { brl, dateBR, DEAL_STAGES, EVENT_TYPES, LEAD_SOURCES } from '../format.js';
import { navigate } from '../app.js';
import { openEventForm } from '../components/eventForm.js';
import { openWhatsApp } from '../components/whatsapp.js';
import { openClientForm } from '../components/clientForm.js';

export async function render(root) {
  const board = h('div', { class: 'kanban' });
  let deals = [];

  const reload = async () => {
    deals = await get('/deals');
    draw();
  };

  async function moveTo(deal, stage) {
    if (deal.stage === stage) return;
    let lostReason = null;
    if (stage === 'perdido') {
      lostReason = await promptDialog('Entender por que perdemos ajuda a vender melhor.', { title: 'Negociação perdida', label: 'Motivo da perda' });
      if (!lostReason) return;
    }
    try {
      await patch(`/deals/${deal.id}/stage`, { stage, lost_reason: lostReason });
      await reload();
      if (stage === 'ganho' && can('events', 'w')) {
        if (await confirmDialog(`"${deal.title}" foi ganha. Deseja agendar o evento agora?`, { title: 'Negociação ganha', confirmLabel: 'Agendar evento' })) {
          await openEventForm({ deal, onSaved: (ev) => navigate(`/eventos/${ev.id}`) });
        }
      }
    } catch (err) { toastError(err); }
  }

  function card(d) {
    const el = h('div', { class: 'kcard', draggable: can('crm', 'w') ? 'true' : null, dataset: { id: d.id } },
      h('div', { class: 'row between', style: { flexWrap: 'nowrap', alignItems: 'flex-start' } },
        h('div', { class: 'kcard-title' }, d.title),
        can('crm', 'w') ? dropdown(btn('', { icon: 'more', size: 'sm', variant: 'ghost', title: 'Ações' }), [
          { label: 'Editar', icon: 'edit', onClick: () => openDealForm(d, reload) },
          can('whatsapp', 'w') ? { label: 'Chamar no WhatsApp', icon: 'whatsapp', onClick: () => openWhatsApp({ client: { id: d.client_id, name: d.client_name, whatsapp: d.client_whatsapp, phone: d.client_phone } }) } : null,
          can('events', 'w') ? { label: 'Agendar evento', icon: 'calendar', onClick: async () => { try { await openEventForm({ deal: d, onSaved: (ev) => navigate(`/eventos/${ev.id}`) }); } catch (err) { toastError(err); } } } : null,
          '-',
          ...DEAL_STAGES.filter((s) => s.key !== d.stage).map((s) => ({ label: `Mover para: ${s.label}`, icon: 'chevronRight', onClick: () => moveTo(d, s.key) })),
          '-',
          { label: 'Excluir', icon: 'trash', danger: true, onClick: async () => {
            if (!(await confirmDialog(`Excluir a negociação "${d.title}"?`, { danger: true, confirmLabel: 'Excluir' }))) return;
            try { await del(`/deals/${d.id}`); toast('Negociação excluída.'); reload(); } catch (err) { toastError(err); }
          } },
        ]) : null),
      h('div', { class: 'cell-sub' }, d.client_name),
      d.event_type || d.guests ? h('div', { class: 'cell-sub' }, [d.event_type, d.guests ? `${d.guests} convidados` : null].filter(Boolean).join(' · ')) : null,
      d.stage === 'perdido' && d.lost_reason ? h('div', { class: 'cell-sub', style: { color: 'var(--danger)' } }, d.lost_reason) : null,
      h('div', { class: 'kcard-meta' },
        h('span', { class: 'row', style: { gap: '4px' } }, d.expected_date ? [ic('calendar'), dateBR(d.expected_date)] : (d.owner_name || '')),
        h('span', { class: 'kcard-value' }, brl(d.value_cents))));
    el.querySelector('.kcard-meta svg')?.setAttribute('width', '14');
    el.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', String(d.id)); el.classList.add('dragging'); });
    el.addEventListener('dragend', () => el.classList.remove('dragging'));
    el.addEventListener('dblclick', () => can('crm', 'w') && openDealForm(d, reload));
    return el;
  }

  function draw() {
    mount(board, DEAL_STAGES.map((s) => {
      const items = deals.filter((d) => d.stage === s.key);
      const total = items.reduce((a, d) => a + d.value_cents, 0);
      const dot = h('span', { class: 'dot' });
      dot.style.background = s.color;
      const list = h('div', { class: 'kcol-list' }, items.map(card));
      const col = h('section', { class: 'kcol', 'aria-label': s.label },
        h('div', { class: 'kcol-head' }, h('b', dot, s.label, h('span', { class: 'count' }, items.length)), h('span', { class: 'small muted mono' }, brl(total))),
        list);
      col.addEventListener('dragover', (e) => { e.preventDefault(); col.classList.add('drag-over'); });
      col.addEventListener('dragleave', (e) => { if (!col.contains(e.relatedTarget)) col.classList.remove('drag-over'); });
      col.addEventListener('drop', (e) => {
        e.preventDefault();
        col.classList.remove('drag-over');
        const deal = deals.find((d) => String(d.id) === e.dataTransfer.getData('text/plain'));
        if (deal) moveTo(deal, s.key);
      });
      return col;
    }));
  }

  mount(root,
    h('div', { class: 'page-head' },
      h('div', h('h1', 'Funil de vendas'), h('p', 'Arraste os cartões entre as etapas. No celular, use o menu de cada cartão.')),
      can('crm', 'w') ? h('div', { class: 'btn-group' }, btn('Nova negociação', { variant: 'primary', icon: 'plus', onClick: () => openDealForm(null, reload) })) : null),
    board);
  await reload();
}

export async function openDealForm(deal, onSaved) {
  const [clients, units] = await Promise.all([get('/clients'), loadUnits()]);
  const d = deal || {};
  const isEdit = !!d.id;
  const clientSel = select('client_id', [{ value: '', label: 'Selecione o cliente' }, ...clients.map((c) => ({ value: c.id, label: c.name }))], d.client_id || '');
  const newClient = btn('Novo', { icon: 'plus', size: 'sm', variant: 'ghost', onClick: () => openClientForm(null, (c) => {
    clientSel.append(h('option', { value: c.id }, c.name));
    clientSel.value = c.id;
  }) });
  newClient.style.minHeight = '22px';
  const clientField = field('Cliente', clientSel, { span: 6, required: true, action: newClient });

  formModal({
    title: isEdit ? 'Editar negociação' : 'Nova negociação',
    size: 'lg',
    fields: [
      field('Título', input('title', d.title, { maxlength: 150, placeholder: 'Ex.: Casamento 200 convidados' }), { span: 6, required: true }),
      clientField,
      field('Etapa', select('stage', DEAL_STAGES.map((s) => ({ value: s.key, label: s.label })), d.stage || 'novo'), { span: 4 }),
      field('Valor estimado (R$)', moneyInput('value_cents', d.value_cents || 0), { span: 4 }),
      field('Origem', select('source', ['', ...LEAD_SOURCES].map((s) => ({ value: s, label: s || 'Selecione' })), d.source || ''), { span: 4 }),
      field('Tipo de evento', select('event_type', ['', ...EVENT_TYPES].map((s) => ({ value: s, label: s || 'Selecione' })), d.event_type || ''), { span: 4 }),
      field('Data prevista do evento', input('expected_date', d.expected_date, { type: 'date' }), { span: 4 }),
      field('Convidados', input('guests', d.guests ?? '', { type: 'number', min: 0 }), { span: 4 }),
      field('Unidade de interesse', select('unit_id', [{ value: '', label: 'Indiferente' }, ...units.map((u) => ({ value: u.id, label: u.name }))], d.unit_id || '')),
      field('Motivo da perda', input('lost_reason', d.lost_reason, { maxlength: 500 }), { hint: 'Obrigatório se a etapa for "Perdido".' }),
      field('Observações', textarea('notes', d.notes, { maxlength: 2000 })),
    ],
    onSubmit: async (data, m) => {
      const body = { ...data, client_id: Number(data.client_id), unit_id: data.unit_id || null, guests: data.guests === '' ? null : Number(data.guests), owner_id: d.owner_id || null };
      if (isEdit) await put(`/deals/${d.id}`, body); else await post('/deals', body);
      m.close();
      toast(isEdit ? 'Negociação atualizada.' : 'Negociação criada.');
      onSaved?.();
    },
  });
}

import { h, mount, btn, field, input, select, textarea, moneyInput, formModal, alertBox, toast, ic, debounce } from '../ui.js';
import { get, post, put } from '../api.js';
import { loadUnits, can } from '../store.js';
import { brl, addMinutes, dateBR, hm, durationLabel, parseMoney, moneyInputValue, EVENT_TYPES, todayISO } from '../format.js';
import { openClientForm } from './clientForm.js';

const PRESETS = [240, 300, 360]; // 4h, 5h e 6h

// Formulário de evento. O horário final é sempre calculado: início + duração.
export async function openEventForm({ event = null, date = null, unitId = null, deal = null, onSaved } = {}) {
  const [units, clients, products] = await Promise.all([
    loadUnits(),
    get('/clients'),
    can('products') ? get('/products') : Promise.resolve([]),
  ]);
  const activeUnits = units.filter((u) => u.active || u.id === event?.unit_id);
  if (!activeUnits.length) throw new Error('Cadastre uma unidade antes de criar eventos.');
  if (!clients.length && !can('crm', 'w')) throw new Error('Não há clientes cadastrados.');

  const ev = event || {};
  const startDate = ev.start_at?.slice(0, 10) || date || deal?.expected_date || todayISO();
  const startTime = ev.start_at?.slice(11, 16) || '19:00';
  let duration = ev.duration_minutes || 300;
  let items = (ev.items || []).map((i) => ({ product_id: i.product_id, description: i.description, quantity: i.quantity, unit_price_cents: i.unit_price_cents }));

  // ---------- Campos ----------
  const title = input('title', ev.title || deal?.title || '', { maxlength: 150, placeholder: 'Ex.: Casamento Ana e Pedro' });
  const clientSel = select('client_id', [{ value: '', label: 'Selecione o cliente' }, ...clients.map((c) => ({ value: c.id, label: c.name }))],
    ev.client_id || deal?.client_id || '');
  const newClientBtn = can('crm', 'w') ? btn('Novo', { icon: 'plus', size: 'sm', variant: 'ghost', onClick: () => openClientForm(null, (c) => {
    clientSel.append(h('option', { value: c.id }, c.name));
    clientSel.value = c.id;
  }) }) : null;
  const unitSel = select('unit_id', activeUnits.map((u) => ({ value: u.id, label: `${u.name} (até ${u.capacity} pessoas)` })),
    ev.unit_id || unitId || deal?.unit_id || activeUnits[0].id);
  const typeSel = select('event_type', [{ value: '', label: 'Selecione' }, ...EVENT_TYPES.map((t) => ({ value: t, label: t }))], ev.event_type || deal?.event_type || '');
  const dateIn = input('date', startDate, { type: 'date' });
  const timeIn = input('time', startTime, { type: 'time', step: 300 });
  const guests = input('guests', ev.guests ?? deal?.guests ?? '', { type: 'number', min: 0, inputmode: 'numeric' });
  const statusSel = select('status', [
    { value: 'pre_reserva', label: 'Pré-reserva' },
    { value: 'confirmado', label: 'Confirmado' },
    { value: 'realizado', label: 'Realizado' },
  ], ev.status && ev.status !== 'cancelado' ? ev.status : 'pre_reserva');
  const notes = textarea('notes', ev.notes || deal?.notes || '', { maxlength: 4000 });
  const discount = moneyInput('discount_cents', ev.discount_cents || 0);

  // ---------- Duração ----------
  const customH = input('custom_h', '', { type: 'number', min: 1, max: 24, inputmode: 'numeric', 'aria-label': 'Horas' });
  const customM = select('custom_m', ['0', '15', '30', '45'].map((m) => ({ value: m, label: `${m} min` })), '0', { 'aria-label': 'Minutos' });
  customH.classList.add('sm'); customM.classList.add('sm');
  customH.style.width = '90px'; customM.style.width = '110px';
  const customBox = h('div', { class: 'row hidden' }, customH, h('span', { class: 'muted' }, 'horas e'), customM);
  const pills = h('div', { class: 'pills' });
  const isCustom = () => !PRESETS.includes(duration);
  let customMode = isCustom();

  const renderPills = () => {
    mount(pills,
      PRESETS.map((m) => h('button', { type: 'button', class: `pill ${!customMode && duration === m ? 'on' : ''}`,
        onClick: () => { customMode = false; duration = m; renderPills(); update(); } }, `${m / 60} horas`)),
      h('button', { type: 'button', class: `pill ${customMode ? 'on' : ''}`, onClick: () => {
        customMode = true;
        customH.value = Math.floor(duration / 60); customM.value = String(duration % 60);
        renderPills(); update(); customH.focus();
      } }, 'Outro tempo'));
    customBox.classList.toggle('hidden', !customMode);
  };
  const readCustom = () => {
    const hh = Number(customH.value) || 0;
    duration = hh * 60 + Number(customM.value);
  };
  customH.addEventListener('input', () => { readCustom(); update(); });
  customM.addEventListener('change', () => { readCustom(); update(); });
  if (customMode) { customH.value = Math.floor(duration / 60); customM.value = String(duration % 60); }

  // ---------- Término e disponibilidade ----------
  const endBox = h('div', { class: 'end-time' });
  const availBox = h('div');
  const startAt = () => (dateIn.value && timeIn.value ? `${dateIn.value}T${timeIn.value}` : null);

  const checkAvailability = debounce(async () => {
    const s = startAt();
    if (!s || duration < 60) return;
    const body = { unit_id: Number(unitSel.value), start_at: s, duration_minutes: duration, exclude_id: ev.id || null,
      guests: guests.value ? Number(guests.value) : null };
    try {
      const r = await post('/events/availability', body);
      if (startAt() !== s) return;
      if (r.ok) {
        mount(availBox, alertBox('Horário disponível nesta unidade.', 'ok'));
      } else {
        const useSuggestion = r.suggestion ? btn(`Usar ${hm(r.suggestion)}`, { size: 'sm', onClick: () => {
          dateIn.value = r.suggestion.slice(0, 10); timeIn.value = r.suggestion.slice(11, 16); update();
        } }) : null;
        mount(availBox, h('div', { class: 'alert err' }, ic('alert'), h('div', { class: 'stack' }, h('div', r.message), useSuggestion)));
      }
    } catch (err) {
      mount(availBox, alertBox(err.message, 'warn'));
    }
  }, 350);

  function update() {
    const s = startAt();
    if (!s || duration < 60 || duration % 15) {
      mount(endBox, ic('clock'), h('span', duration % 15 ? 'A duração deve ser em blocos de 15 minutos.' : 'Informe data, horário e duração.'));
      mount(availBox);
      return;
    }
    const end = addMinutes(s, duration);
    const nextDay = end.slice(0, 10) !== s.slice(0, 10);
    mount(endBox, ic('clock'), h('span', `Término automático: ${hm(end)}${nextDay ? ` do dia ${dateBR(end)}` : ''} (${durationLabel(duration)} de evento)`));
    checkAvailability();
  }
  for (const el of [dateIn, timeIn, unitSel]) el.addEventListener('change', update);
  timeIn.addEventListener('input', update);
  guests.addEventListener('change', update);

  // ---------- Itens ----------
  const itemsBox = h('div');
  const totalBox = h('div', { class: 'row between' });
  const productSel = select('add_product', [{ value: '', label: '+ Adicionar produto ou serviço' },
    ...products.map((p) => ({ value: p.id, label: `${p.type === 'servico' ? 'Serviço' : 'Produto'}: ${p.name} (${brl(p.price_cents)})` }))]);
  productSel.removeAttribute('name');
  productSel.addEventListener('change', () => {
    const p = products.find((x) => String(x.id) === productSel.value);
    if (p) items.push({ product_id: p.id, description: p.name, quantity: Number(guests.value) && p.unit_measure === 'pessoa' ? Number(guests.value) : 1, unit_price_cents: p.price_cents });
    productSel.value = '';
    renderItems();
  });
  const addFree = btn('Item avulso', { icon: 'plus', size: 'sm', onClick: () => {
    items.push({ product_id: null, description: 'Locação do espaço', quantity: 1, unit_price_cents: 0 });
    renderItems();
  } });

  const subtotal = () => items.reduce((s, i) => s + Math.round((Number(i.quantity) || 0) * (i.unit_price_cents || 0)), 0);
  const renderTotals = () => {
    const sub = subtotal();
    const total = Math.max(0, sub - parseMoney(discount.value));
    mount(totalBox, h('span', { class: 'muted' }, `Itens: ${brl(sub)}`), h('b', { class: 'kpi-value', style: { fontSize: '1.3rem' } }, `Total ${brl(total)}`));
  };
  discount.addEventListener('input', renderTotals);
  discount.addEventListener('blur', renderTotals);

  function renderItems() {
    if (!items.length) {
      mount(itemsBox, h('div', { class: 'muted small' }, 'Nenhum item. Adicione os produtos e serviços contratados para compor o valor do evento.'));
      renderTotals();
      return;
    }
    mount(itemsBox, h('div', { class: 'table-wrap' }, h('table', { class: 'table responsive' },
      h('thead', h('tr', h('th', 'Descrição'), h('th', 'Qtd.'), h('th', 'Valor unit.'), h('th', { class: 'num' }, 'Subtotal'), h('th', ''))),
      h('tbody', items.map((it, idx) => {
        const desc = h('input', { class: 'input sm', value: it.description, maxlength: 200, 'aria-label': 'Descrição',
          onInput: (e) => { it.description = e.target.value; } });
        const qty = h('input', { class: 'input sm', type: 'number', min: 0, step: 'any', value: it.quantity, 'aria-label': 'Quantidade',
          style: { width: '90px' }, onInput: (e) => { it.quantity = Number(e.target.value); renderTotalsRow(); } });
        const price = h('input', { class: 'input sm', inputmode: 'decimal', value: moneyInputValue(it.unit_price_cents), 'aria-label': 'Valor unitário',
          style: { width: '120px' }, onInput: (e) => { it.unit_price_cents = parseMoney(e.target.value); renderTotalsRow(); },
          onBlur: (e) => { e.target.value = moneyInputValue(it.unit_price_cents); } });
        const sub = h('span', { class: 'mono' });
        const renderTotalsRow = () => { sub.textContent = brl(Math.round((Number(it.quantity) || 0) * it.unit_price_cents)); renderTotals(); };
        renderTotalsRow();
        return h('tr',
          h('td', { 'data-label': 'Item', class: 'primary-cell' }, desc),
          h('td', { 'data-label': 'Qtd.' }, qty),
          h('td', { 'data-label': 'Valor unit.' }, price),
          h('td', { 'data-label': 'Subtotal', class: 'num' }, sub),
          h('td', { class: 'actions' }, btn('', { icon: 'trash', size: 'sm', variant: 'ghost', title: 'Remover item', onClick: () => { items.splice(idx, 1); renderItems(); } })));
      })))));
    renderTotals();
  }

  // ---------- Montagem ----------
  const clientField = field('Cliente', clientSel, { span: 6, required: true });
  if (newClientBtn) clientField.querySelector('label').append(' ', newClientBtn);
  clientField.querySelector('label').classList.add('row', 'between');

  formModal({
    title: event ? 'Editar evento' : 'Novo evento',
    size: 'xl',
    submitLabel: event ? 'Salvar alterações' : 'Agendar evento',
    fields: [
      field('Nome do evento', title, { span: 6, required: true }),
      clientField,
      field('Unidade', unitSel, { span: 6, required: true }),
      field('Tipo de evento', typeSel, { span: 3 }),
      field('Convidados', guests, { span: 3 }),
      field('Data', dateIn, { span: 3, required: true, cls: 'keep' }),
      field('Horário de início', timeIn, { span: 3, required: true, cls: 'keep' }),
      h('div', { class: 'field s6' }, h('span', { class: 'label' }, 'Duração'), pills, customBox),
      h('div', { class: 'field' }, endBox),
      h('div', { class: 'field' }, availBox),
      h('div', { class: 'field' }, h('div', { class: 'row between' }, h('span', { class: 'label' }, 'Produtos e serviços'), h('div', { class: 'row' }, productSel, addFree)), itemsBox),
      field('Desconto (R$)', discount, { span: 3 }),
      field('Status', statusSel, { span: 3 }),
      h('div', { class: 'field s6' }, h('span', { class: 'label' }, ' '), totalBox),
      field('Observações', notes),
    ],
    onSubmit: async (data, m) => {
      if (duration < 60 || duration % 15) throw new Error('Informe uma duração válida (mínimo 1 hora, em blocos de 15 minutos).');
      const payload = {
        title: data.title,
        client_id: Number(data.client_id),
        unit_id: Number(data.unit_id),
        deal_id: ev.deal_id || deal?.id || null,
        event_type: data.event_type || null,
        start_at: `${data.date}T${data.time}`,
        duration_minutes: duration,
        guests: data.guests === '' ? null : Number(data.guests),
        status: data.status,
        discount_cents: data.discount_cents,
        notes: data.notes || null,
        items: items.filter((i) => i.description && i.quantity > 0).map((i) => ({ ...i, quantity: Number(i.quantity) })),
      };
      const saved = event ? await put(`/events/${event.id}`, payload) : await post('/events', payload);
      m.close();
      toast(event ? 'Evento atualizado.' : 'Evento agendado.');
      onSaved?.(saved);
    },
  });
  productSel.classList.add('sm');
  productSel.style.width = 'auto';
  productSel.style.maxWidth = '320px';
  renderPills();
  renderItems();
  update();
}

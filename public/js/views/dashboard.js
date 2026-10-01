import { h, mount, btn, badge, ic, loading, empty, alertBox, toast, toastError, confirmDialog, formModal, field, input, select, textarea } from '../ui.js';
import { get, post, del, qs } from '../api.js';
import { store, can, loadUnits } from '../store.js';
import {
  brl, brlShort, dateBR, hm, timeRange, longDate, monthName, monthShort, todayISO, addDays, WEEKDAYS_SHORT, EVENT_STATUS, DEAL_STAGES,
} from '../format.js';
import { navigate } from '../app.js';
import { openEventForm } from '../components/eventForm.js';

export async function render(root) {
  const t = todayISO();
  const state = {
    year: Number(t.slice(0, 4)),
    month: Number(t.slice(5, 7)) - 1,
    unitId: '',
    selected: t,
    data: { events: [], blocks: [] },
  };

  const [summary, units] = await Promise.all([get('/dashboard'), loadUnits()]);

  const calCard = h('div', { class: 'card' });
  const dayPanel = h('div', { class: 'card day-panel' });
  const kpis = renderKpis(summary);

  mount(root,
    h('div', { class: 'page-head' },
      h('div', h('h1', `Olá, ${store.me.user.name.split(' ')[0]}`), h('p', `Hoje é ${longDate(t)}. Clique em um dia do calendário para ver ou criar eventos.`)),
      can('events', 'w') ? h('div', { class: 'btn-group' }, btn('Novo evento', { variant: 'primary', icon: 'plus', onClick: () => newEvent(state.selected) })) : null),
    kpis,
    h('div', { class: 'dash-grid mt' }, calCard, dayPanel),
    renderLower(summary));

  async function load() {
    const first = new Date(Date.UTC(state.year, state.month, 1));
    const gridStart = addDays(first.toISOString().slice(0, 10), -first.getUTCDay());
    const gridEnd = addDays(gridStart, 41);
    try {
      state.data = await get(`/calendar${qs({ from: gridStart, to: gridEnd, unit_id: state.unitId })}`);
    } catch (err) {
      toastError(err);
    }
    renderCalendar(gridStart);
    renderDay();
  }

  function eventsOn(day) {
    const next = addDays(day, 1);
    return state.data.events.filter((e) => e.start_at < `${next}T00:00` && e.end_at > `${day}T00:00`);
  }
  const blocksOn = (day) => state.data.blocks.filter((b) => b.date === day);

  function renderCalendar(gridStart) {
    const unitSel = select('unit', [{ value: '', label: 'Todas as unidades' }, ...units.map((u) => ({ value: u.id, label: u.name }))], state.unitId);
    unitSel.classList.add('sm');
    unitSel.style.width = 'auto';
    unitSel.addEventListener('change', () => { state.unitId = unitSel.value; load(); });
    const shift = (n) => {
      state.month += n;
      if (state.month < 0) { state.month = 11; state.year -= 1; }
      if (state.month > 11) { state.month = 0; state.year += 1; }
      load();
    };

    const cells = [];
    for (let i = 0; i < 42; i += 1) {
      const day = addDays(gridStart, i);
      const inMonth = Number(day.slice(5, 7)) - 1 === state.month;
      const evs = eventsOn(day).filter((e) => e.status !== 'cancelado');
      const blocks = blocksOn(day);
      const classes = ['cal-day', inMonth ? '' : 'other', day === t ? 'today' : '', day === state.selected ? 'selected' : '', blocks.length ? 'blocked' : ''];
      const label = `${dateBR(day)}: ${evs.length} evento(s)${blocks.length ? ', data bloqueada' : ''}`;
      cells.push(h('button', { type: 'button', class: classes.filter(Boolean).join(' '), 'aria-label': label, 'aria-pressed': String(day === state.selected),
        onClick: () => { state.selected = day; renderCalendar(gridStart); renderDay(); if (window.innerWidth < 1024) dayPanel.scrollIntoView({ behavior: 'smooth', block: 'start' }); } },
        h('div', { class: 'cal-num-row' },
          h('span', { class: 'cal-num' }, Number(day.slice(8))),
          blocks.length ? h('span', { class: 'cal-lock', title: blocks.map((b) => b.reason || 'Bloqueado').join(', ') }, ic('lock'), h('span', 'Bloqueado')) : null),
        evs.slice(0, 3).map((e) => {
          const chip = h('span', { class: `cal-ev ${e.status}`, title: `${timeRange(e.start_at, e.end_at)} · ${e.title} · ${e.unit_name}` },
            h('b', e.start_at.slice(0, 10) === day ? hm(e.start_at) : '↳'), ' ', e.title);
          chip.style.borderLeftColor = e.unit_color;
          return chip;
        }),
        evs.length > 3 ? h('span', { class: 'cal-more' }, `+${evs.length - 3} evento(s)`) : null,
        h('span', { class: 'cal-dots' }, evs.slice(0, 4).map((e) => { const d = h('span', { class: 'dot' }); d.style.background = e.unit_color; d.style.width = '6px'; d.style.height = '6px'; return d; }))));
    }

    mount(calCard,
      h('div', { class: 'cal-head' },
        h('div', { class: 'cal-title' }, `${monthName(state.month)} ${state.year}`),
        h('div', { class: 'btn-group' },
          btn('', { icon: 'chevronLeft', size: 'sm', title: 'Mês anterior', onClick: () => shift(-1) }),
          btn('Hoje', { size: 'sm', onClick: () => { state.year = Number(t.slice(0, 4)); state.month = Number(t.slice(5, 7)) - 1; state.selected = t; load(); } }),
          btn('', { icon: 'chevronRight', size: 'sm', title: 'Próximo mês', onClick: () => shift(1) })),
        h('div', { class: 'grow' }),
        unitSel),
      h('div', { class: 'cal-grid', role: 'grid' }, WEEKDAYS_SHORT.map((d) => h('div', { class: 'cal-dow', role: 'columnheader' }, d)), cells),
      h('div', { class: 'cal-legend' },
        units.map((u) => { const d = h('span', { class: 'dot' }); d.style.background = u.color; return h('span', d, u.name); }),
        h('span', h('i', { class: 'legend-pre' }), 'Pré-reserva'),
        h('span', h('i', { class: 'legend-blocked' }), 'Data bloqueada')));
  }

  function renderDay() {
    const day = state.selected;
    const evs = eventsOn(day);
    const blocks = blocksOn(day);
    const allUnitsBlocked = blocks.some((b) => !b.unit_id);
    const actions = [];
    if (can('events', 'w') && !allUnitsBlocked) actions.push(btn('Novo evento', { variant: 'primary', icon: 'plus', size: 'sm', onClick: () => newEvent(day) }));
    if (can('blocks', 'w')) actions.push(btn('Bloquear data', { icon: 'lock', size: 'sm', onClick: () => blockDate(day) }));

    mount(dayPanel,
      h('div', { class: 'card-head' }, h('div', h('div', { class: 'day-title' }, longDate(day)), h('div', { class: 'muted small' }, dateBR(day)))),
      h('div', { class: 'card-body stack' },
        blocks.map((b) => h('div', { class: 'block-box' }, ic('lock'),
          h('div', { class: 'grow' },
            h('b', b.unit_id ? `Bloqueado: ${b.unit_name}` : 'Data bloqueada em todas as unidades'),
            b.reason ? h('div', { class: 'small' }, b.reason) : null,
            h('div', { class: 'small' }, `Por ${b.created_by_name || 'sistema'}`)),
          can('blocks', 'w') ? btn('', { icon: 'unlock', size: 'sm', variant: 'ghost', title: 'Desbloquear', onClick: () => unblock(b) }) : null)),
        evs.length
          ? h('div', { class: 'day-list' }, evs.map((e) => {
            const bar = h('span', { class: 'bar' });
            bar.style.background = e.unit_color;
            const st = EVENT_STATUS[e.status];
            return h('button', { type: 'button', class: 'day-ev', onClick: () => navigate(`/eventos/${e.id}`) }, bar,
              h('div', { class: 'grow stack', style: { gap: '2px' } },
                h('div', { class: 'row between' }, h('span', { class: 'time' }, timeRange(e.start_at, e.end_at)), badge(st.label, st.tone)),
                h('b', e.title),
                h('span', { class: 'muted small' }, `${e.client_name} · ${e.unit_name}${e.guests ? ` · ${e.guests} convidados` : ''}`)));
          }))
          : (blocks.length ? null : empty('Nenhum evento neste dia.', 'calendar')),
        actions.length ? h('div', { class: 'btn-group' }, actions) : null));
  }

  async function newEvent(day) {
    try {
      await openEventForm({ date: day, unitId: state.unitId || null, onSaved: (ev) => { state.selected = ev.start_at.slice(0, 10); load(); } });
    } catch (err) { toastError(err); }
  }

  function blockDate(day) {
    formModal({
      title: 'Bloquear data',
      submitLabel: 'Bloquear',
      fields: [
        h('div', { class: 'field' }, alertBox('Com a data bloqueada, ninguém consegue agendar eventos nela. Datas que já têm eventos não podem ser bloqueadas.', 'info')),
        field('Data inicial', input('date', day, { type: 'date' }), { span: 6, required: true }),
        field('Data final (opcional)', input('end_date', '', { type: 'date' }), { span: 6, hint: 'Para bloquear um período inteiro.' }),
        field('Unidade', select('unit_id', [{ value: '', label: 'Todas as unidades' }, ...units.map((u) => ({ value: u.id, label: u.name }))], state.unitId)),
        field('Motivo', textarea('reason', '', { maxlength: 300, placeholder: 'Ex.: manutenção, feriado, evento interno' })),
      ],
      onSubmit: async (data, m) => {
        const r = await post('/blocks', { ...data, unit_id: data.unit_id || null });
        m.close();
        toast(r.created > 1 ? `${r.created} datas bloqueadas.` : 'Data bloqueada.');
        load();
      },
    });
  }

  async function unblock(b) {
    if (!(await confirmDialog(`Desbloquear ${dateBR(b.date)}${b.unit_name ? ` na unidade ${b.unit_name}` : ''}?`, { confirmLabel: 'Desbloquear' }))) return;
    try {
      await del(`/blocks/${b.id}`);
      toast('Data desbloqueada.');
      load();
    } catch (err) { toastError(err); }
  }

  mount(calCard, loading());
  mount(dayPanel, loading());
  await load();
}

function kpi(label, iconName, value, foot, footBad = false) {
  return h('div', { class: 'card kpi' },
    h('div', { class: 'kpi-label' }, ic(iconName), label),
    h('div', { class: 'kpi-value' }, value),
    foot ? h('div', { class: `kpi-foot ${footBad ? 'bad' : ''}` }, foot) : null);
}

function renderKpis(s) {
  const items = [];
  if (s.events_month !== undefined) {
    items.push(kpi('Eventos no mês', 'calendar', s.events_month, `${s.events_confirmed_month} confirmados`));
    items.push(kpi('Faturamento do mês', 'chart', brlShort(s.revenue_month), 'eventos confirmados e realizados'));
  }
  if (s.finance) {
    items.push(kpi('A receber', 'arrowDown', brlShort(s.finance.receivable_pending),
      s.finance.receivable_overdue ? `${brl(s.finance.receivable_overdue)} vencido` : 'nada vencido', !!s.finance.receivable_overdue));
    items.push(kpi('Saldo em caixa', 'wallet', brlShort(s.finance.balance), `A pagar: ${brl(s.finance.payable_pending)}`));
  } else if (s.funnel) {
    const open = s.funnel.reduce((a, f) => a + f.value, 0);
    items.push(kpi('Funil em aberto', 'funnel', brlShort(open), `${s.funnel.reduce((a, f) => a + f.n, 0)} negociações`));
    items.push(kpi('Ganhos no mês', 'star', brlShort(s.won_month.value), `${s.won_month.n} negociações`));
  } else if (s.low_stock) {
    items.push(kpi('Estoque baixo', 'box', s.low_stock.length, 'itens abaixo do mínimo', s.low_stock.length > 0));
  }
  return h('div', { class: 'grid grid-4' }, items);
}

function renderLower(s) {
  const cards = [];
  if (s.upcoming) {
    cards.push(h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', 'Próximos 7 dias'), btn('Ver agenda', { size: 'sm', variant: 'ghost', onClick: () => navigate('/eventos') })),
      s.upcoming.length ? h('ul', { class: 'list-plain' }, s.upcoming.map((e) => h('li', { class: 'clickable', style: { cursor: 'pointer' }, onClick: () => navigate(`/eventos/${e.id}`) },
        h('div', { class: 'date-tile' }, h('b', Number(e.start_at.slice(8, 10))), h('span', monthShort(Number(e.start_at.slice(5, 7)) - 1))),
        h('div', { class: 'grow' }, h('div', { class: 'cell-title' }, e.title), h('div', { class: 'cell-sub' }, `${timeRange(e.start_at, e.end_at)} · ${e.unit_name} · ${e.client_name}`)),
        badge(EVENT_STATUS[e.status].label, EVENT_STATUS[e.status].tone))))
        : empty('Nenhum evento nos próximos dias.', 'calendar')));
  }
  if (s.funnel) {
    const byStage = Object.fromEntries(s.funnel.map((f) => [f.stage, f]));
    const max = Math.max(1, ...s.funnel.map((f) => f.n));
    cards.push(h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', 'Funil de vendas'), btn('Abrir funil', { size: 'sm', variant: 'ghost', onClick: () => navigate('/funil') })),
      h('div', { class: 'card-body stack' }, DEAL_STAGES.filter((st) => !['ganho', 'perdido'].includes(st.key)).map((st) => {
        const f = byStage[st.key] || { n: 0, value: 0 };
        const bar = h('i');
        bar.style.width = `${(f.n / max) * 100}%`;
        bar.style.background = st.color;
        return h('div', h('div', { class: 'row between small' }, h('span', st.label), h('span', { class: 'muted mono' }, `${f.n} · ${brl(f.value)}`)), h('div', { class: 'meter' }, bar));
      }))));
  }
  if (s.units?.length) {
    const max = Math.max(1, ...s.units.map((u) => u.events));
    cards.push(h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', 'Eventos por unidade no mês')),
      h('div', { class: 'card-body stack' }, s.units.map((u) => {
        const bar = h('i');
        bar.style.width = `${(u.events / max) * 100}%`;
        bar.style.background = u.color;
        return h('div', h('div', { class: 'row between small' }, h('span', u.name), h('span', { class: 'muted mono' }, `${u.events} evento(s)`)), h('div', { class: 'meter' }, bar));
      }))));
  }
  if (s.low_stock?.length) {
    cards.push(h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', 'Estoque abaixo do mínimo'), btn('Ver estoque', { size: 'sm', variant: 'ghost', onClick: () => navigate('/estoque') })),
      h('ul', { class: 'list-plain' }, s.low_stock.map((p) => h('li', h('div', { class: 'grow' }, h('div', { class: 'cell-title' }, p.name), h('div', { class: 'cell-sub' }, p.unit_name)),
        badge(`${p.quantity} / mín. ${p.min_stock} ${p.unit_measure}`, 'red'))))));
  }
  return cards.length ? h('div', { class: 'grid grid-2 mt' }, cards) : null;
}


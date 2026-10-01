import {
  h, mount, btn, badge, table, toast, toastError, confirmDialog, promptDialog, dropdown, formModal, field, input, select, alertBox,
} from '../ui.js';
import { get, post } from '../api.js';
import { can } from '../store.js';
import { brl, dateBR, dateTimeBR, timeRange, longDate, durationLabel, phoneBR, todayISO, EVENT_STATUS, CONTRACT_STATUS, PAYMENT_METHODS } from '../format.js';
import { navigate, setTitle } from '../app.js';
import { openEventForm } from '../components/eventForm.js';
import { openWhatsApp } from '../components/whatsapp.js';
import { openContract } from './contracts.js';

const BRIEFING_LABELS = {
  guests: 'Convidados', theme: 'Tema / decoração', menu_preferences: 'Cardápio', dietary_restrictions: 'Restrições alimentares',
  music: 'Música', schedule: 'Roteiro do evento', contact_on_day: 'Contato no dia', notes: 'Observações',
};

export async function render(root, { params }) {
  const id = Number(params[0]);

  const load = async () => {
    const ev = await get(`/events/${id}`);
    setTitle(ev.title);
    draw(ev);
  };

  function draw(ev) {
    const st = EVENT_STATUS[ev.status];
    const client = { id: ev.client_id, name: ev.client_name, whatsapp: ev.client_whatsapp, phone: ev.client_phone };
    const editable = can('events', 'w') && ev.status !== 'cancelado';
    const activeContract = ev.contracts.find((c) => c.status !== 'cancelado');
    const launched = ev.transactions.filter((t) => t.status !== 'cancelado').reduce((s, t) => s + t.amount_cents, 0);
    const received = ev.transactions.filter((t) => t.status === 'pago').reduce((s, t) => s + (t.paid_amount_cents || 0), 0);
    const hasStockItems = ev.items.some((i) => i.product_type === 'produto');

    const statusMenu = can('events', 'w') ? dropdown(btn('Status', { icon: 'chevronDown' }), [
      ev.status !== 'pre_reserva' ? { label: ev.status === 'cancelado' ? 'Reativar como pré-reserva' : 'Voltar para pré-reserva', icon: 'refresh', onClick: () => changeStatus('pre_reserva') } : null,
      ev.status !== 'confirmado' && ev.status !== 'cancelado' ? { label: 'Confirmar evento', icon: 'check', onClick: () => changeStatus('confirmado') } : null,
      ev.status !== 'realizado' && ev.status !== 'cancelado' ? { label: 'Marcar como realizado', icon: 'checkCircle', onClick: () => changeStatus('realizado') } : null,
      ev.status !== 'cancelado' ? '-' : null,
      ev.status !== 'cancelado' ? { label: 'Cancelar evento', icon: 'x', danger: true, onClick: () => changeStatus('cancelado') } : null,
    ]) : null;

    const actions = [
      btn('Voltar', { icon: 'chevronLeft', variant: 'ghost', onClick: () => history.length > 1 ? history.back() : navigate('/eventos') }),
      can('whatsapp', 'w') ? btn('WhatsApp', { icon: 'whatsapp', variant: 'whatsapp', onClick: () => openWhatsApp({
        client, eventId: ev.id, contractId: activeContract?.id,
        kinds: ['mensagem', 'formulario', ...(activeContract ? ['contrato'] : [])], onSent: load,
      }) }) : null,
      statusMenu,
      editable ? btn('Editar', { icon: 'edit', variant: 'primary', onClick: async () => {
        try { await openEventForm({ event: ev, onSaved: load }); } catch (err) { toastError(err); }
      } }) : null,
    ];

    async function changeStatus(status) {
      let reason = null;
      if (status === 'cancelado') {
        reason = await promptDialog('O horário ficará livre para outros eventos. Contratos não assinados serão cancelados.', { title: 'Cancelar evento', label: 'Motivo do cancelamento', confirmLabel: 'Cancelar evento' });
        if (!reason) return;
      }
      try {
        await post(`/events/${ev.id}/status`, { status, cancel_reason: reason });
        toast('Status atualizado.');
        load();
      } catch (err) { toastError(err); }
    }

    const durationText = durationLabel(ev.duration_minutes);
    const info = h('dl', { class: 'info-list' },
      h('div', h('dt', 'Data'), h('dd', `${longDate(ev.start_at)}`)),
      h('div', h('dt', 'Horário'), h('dd', `${timeRange(ev.start_at, ev.end_at)} (${durationText})`)),
      h('div', h('dt', 'Unidade'), h('dd', ev.unit_name), h('div', { class: 'muted small' }, ev.unit_location)),
      h('div', h('dt', 'Convidados'), h('dd', ev.guests ? `${ev.guests} de ${ev.unit_capacity}` : 'A definir')),
      h('div', h('dt', 'Cliente'), h('dd', can('crm') ? h('a', { href: `#/clientes/${ev.client_id}` }, ev.client_name) : ev.client_name),
        h('div', { class: 'muted small' }, phoneBR(ev.client_whatsapp || ev.client_phone))),
      h('div', h('dt', 'Tipo'), h('dd', ev.event_type || '-')),
      h('div', h('dt', 'Criado por'), h('dd', ev.created_by_name || '-'), h('div', { class: 'muted small' }, dateTimeBR(ev.created_at))),
      h('div', h('dt', 'Estoque'), h('dd', ev.stock_consumed ? badge('Baixado', 'green') : badge(hasStockItems ? 'Pendente' : 'Sem produtos', 'gray'))));

    const itemsCard = h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', 'Produtos e serviços'),
        can('stock', 'w') && hasStockItems && !ev.stock_consumed && ev.status !== 'cancelado'
          ? btn('Baixar do estoque', { icon: 'box', size: 'sm', onClick: consumeStock }) : null),
      table([
        { label: 'Item', primary: true, render: (i) => h('div', h('div', { class: 'cell-title' }, i.description), i.product_type ? h('div', { class: 'cell-sub' }, i.product_type === 'servico' ? 'Serviço' : 'Produto') : null) },
        { label: 'Qtd.', num: true, render: (i) => `${i.quantity} ${i.unit_measure || ''}` },
        { label: 'Valor unit.', num: true, render: (i) => brl(i.unit_price_cents) },
        { label: 'Subtotal', num: true, render: (i) => brl(Math.round(i.quantity * i.unit_price_cents)) },
      ], ev.items, { emptyText: 'Nenhum item cadastrado.' }),
      h('div', { class: 'card-body stack', style: { borderTop: '1px solid var(--border)' } },
        ev.discount_cents ? h('div', { class: 'row between' }, h('span', { class: 'muted' }, 'Desconto'), h('span', { class: 'mono' }, `- ${brl(ev.discount_cents)}`)) : null,
        h('div', { class: 'row between' }, h('b', 'Valor total'), h('b', { class: 'mono', style: { fontSize: '1.2rem' } }, brl(ev.total_cents)))));

    async function consumeStock() {
      if (!(await confirmDialog(`Dar baixa dos produtos deste evento no estoque da unidade ${ev.unit_name}?`, { confirmLabel: 'Baixar estoque' }))) return;
      try { await post(`/events/${ev.id}/consume-stock`); toast('Estoque baixado.'); load(); } catch (err) { toastError(err); }
    }

    const financeCard = can('finance') || can('events') ? h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', 'Cobranças'),
        can('finance', 'w') && ev.status !== 'cancelado' && launched < ev.total_cents
          ? btn('Gerar parcelas', { icon: 'plus', size: 'sm', onClick: () => generateReceivables(ev, launched, load) }) : null),
      h('div', { class: 'card-body stack' },
        h('div', { class: 'row between small' }, h('span', { class: 'muted' }, 'Lançado'), h('span', { class: 'mono' }, `${brl(launched)} de ${brl(ev.total_cents)}`)),
        h('div', { class: 'row between small' }, h('span', { class: 'muted' }, 'Recebido'), h('span', { class: 'mono' }, brl(received))),
        ev.transactions.length ? h('ul', { class: 'list-plain', style: { margin: '0 -20px' } }, ev.transactions.map((t) => {
          const overdue = t.status === 'pendente' && t.due_date < todayISO();
          return h('li', h('div', { class: 'grow' }, h('div', { class: 'cell-title' }, `Parcela ${t.installment || ''}`), h('div', { class: 'cell-sub' }, `Vence ${dateBR(t.due_date)}`)),
            h('div', { class: 'right' }, h('div', { class: 'mono' }, brl(t.amount_cents)),
              badge(t.status === 'pago' ? 'Pago' : t.status === 'cancelado' ? 'Cancelado' : overdue ? 'Vencido' : 'Pendente',
                t.status === 'pago' ? 'green' : t.status === 'cancelado' ? 'gray' : overdue ? 'red' : 'amber')));
        })) : h('div', { class: 'muted small' }, 'Nenhuma parcela lançada.'))) : null;

    const contractsCard = can('contracts') ? h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', 'Contrato'),
        can('contracts', 'w') && !activeContract && ev.status !== 'cancelado'
          ? btn('Emitir contrato', { icon: 'file', size: 'sm', variant: 'primary', onClick: emitContract }) : null),
      h('div', { class: 'card-body stack' },
        ev.contracts.length ? ev.contracts.map((c) => h('div', { class: 'row between' },
          h('div', h('div', { class: 'cell-title' }, `Nº ${c.number}`), h('div', { class: 'cell-sub' },
            c.accepted_at ? `Assinado em ${dateTimeBR(c.accepted_at)}` : c.sent_at ? `Enviado em ${dateTimeBR(c.sent_at)}` : `Emitido em ${dateTimeBR(c.created_at)}`)),
          h('div', { class: 'row' }, badge(CONTRACT_STATUS[c.status].label, CONTRACT_STATUS[c.status].tone),
            btn('', { icon: 'file', size: 'sm', variant: 'ghost', title: 'Ver contrato', onClick: () => openContract(c.id, load) }))))
          : h('div', { class: 'muted small' }, 'Nenhum contrato emitido.'),
        !ev.transactions.length && !activeContract && can('contracts', 'w') ? h('div', { class: 'muted small' }, 'Dica: gere as parcelas antes de emitir o contrato para que elas apareçam na cláusula de pagamento.') : null)) : null;

    async function emitContract() {
      try {
        const c = await post('/contracts', { event_id: ev.id });
        toast(`Contrato ${c.number} emitido.`);
        await load();
        openContract(c.id, load);
      } catch (err) { toastError(err); }
    }

    const briefings = ev.forms.filter((f) => f.status === 'respondido' && f.type === 'briefing');
    const formsCard = ev.forms.length ? h('div', { class: 'card' },
      h('div', { class: 'card-head' }, h('h3', 'Formulários')),
      h('div', { class: 'card-body stack' },
        ev.forms.map((f) => h('div', { class: 'row between' }, h('span', `${f.type === 'briefing' ? 'Briefing' : 'Cadastro'} · ${dateTimeBR(f.created_at)}`),
          badge(f.status === 'respondido' ? 'Respondido' : 'Aguardando', f.status === 'respondido' ? 'green' : 'amber'))),
        briefings.map((f) => h('dl', { class: 'info-list', style: { gridTemplateColumns: '1fr' } },
          Object.entries(f.response || {}).filter(([, v]) => v !== null && v !== '').map(([k, v]) => h('div', h('dt', BRIEFING_LABELS[k] || k), h('dd', { class: 'pre' }, String(v)))))))) : null;

    mount(root,
      h('div', { class: 'page-head' },
        h('div', h('div', { class: 'row' }, h('h1', ev.title), badge(st.label, st.tone)),
          h('p', `${dateBR(ev.start_at)} · ${timeRange(ev.start_at, ev.end_at)} · ${ev.unit_name}`)),
        h('div', { class: 'btn-group' }, actions)),
      ev.status === 'cancelado' ? h('div', { class: 'mb' }, alertBox(`Evento cancelado. Motivo: ${ev.cancel_reason || 'não informado'}`, 'warn')) : null,
      h('div', { class: 'detail-grid' },
        h('div', { class: 'stack', style: { gap: '16px' } },
          h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', 'Informações')), h('div', { class: 'card-body' }, info,
            ev.notes ? h('div', { class: 'mt' }, h('div', { class: 'label' }, 'Observações'), h('p', { class: 'pre' }, ev.notes)) : null)),
          itemsCard, formsCard),
        h('div', { class: 'stack', style: { gap: '16px' } }, contractsCard, financeCard)));
  }

  await load();
}

function generateReceivables(ev, launched, onDone) {
  const remaining = ev.total_cents - launched;
  formModal({
    title: 'Gerar parcelas a receber',
    submitLabel: 'Gerar parcelas',
    fields: [
      h('div', { class: 'field' }, alertBox(`Valor a parcelar: ${brl(remaining)}`, 'info')),
      field('Número de parcelas', input('installments', '1', { type: 'number', min: 1, max: 36 }), { span: 6, required: true }),
      field('Intervalo entre parcelas (dias)', input('interval_days', '30', { type: 'number', min: 1, max: 365 }), { span: 6 }),
      field('Primeiro vencimento', input('first_due_date', todayISO(), { type: 'date' }), { span: 6, required: true }),
      field('Forma de pagamento', select('payment_method', ['', ...PAYMENT_METHODS].map((p) => ({ value: p, label: p || 'Selecione' }))), { span: 6 }),
    ],
    onSubmit: async (data, m) => {
      await post(`/events/${ev.id}/receivables`, { ...data, payment_method: data.payment_method || null });
      m.close();
      toast('Parcelas lançadas no contas a receber.');
      onDone();
    },
  });
}


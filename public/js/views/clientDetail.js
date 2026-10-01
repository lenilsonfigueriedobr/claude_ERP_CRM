import { h, mount, btn, badge, table, empty, tabs, toast, toastError, confirmDialog, select, textarea, alertBox, copyText } from '../ui.js';
import { get, post, del } from '../api.js';
import { can } from '../store.js';
import { brl, dateBR, dateTimeBR, timeRange, phoneBR, docBR, EVENT_STATUS, DEAL_STAGES } from '../format.js';
import { navigate, setTitle } from '../app.js';
import { openClientForm } from '../components/clientForm.js';
import { openWhatsApp } from '../components/whatsapp.js';
import { openEventForm } from '../components/eventForm.js';
import { openDealForm } from './funnel.js';

const INTERACTION = { nota: 'Nota', ligacao: 'Ligação', whatsapp: 'WhatsApp', email: 'E-mail', visita: 'Visita', reuniao: 'Reunião' };
const STAGE = Object.fromEntries(DEAL_STAGES.map((s) => [s.key, s]));

export async function render(root, { params }) {
  const id = Number(params[0]);
  let tab = 'historico';

  const load = async () => {
    const c = await get(`/clients/${id}`);
    setTitle(c.name);
    draw(c);
  };

  function draw(c) {
    const tabBox = h('div');
    const drawTab = () => {
      mount(tabBox, tabs([
        { key: 'historico', label: `Histórico (${c.interactions.length})` },
        { key: 'eventos', label: `Eventos (${c.events.length})` },
        { key: 'negocios', label: `Negociações (${c.deals.length})` },
        { key: 'formularios', label: `Formulários (${c.forms.length})` },
      ], tab, (k) => { tab = k; drawTab(); }), tabContent());
    };

    function tabContent() {
      if (tab === 'eventos') {
        return h('div', { class: 'card' }, table([
          { label: 'Data', render: (e) => h('div', h('b', dateBR(e.start_at)), h('div', { class: 'cell-sub' }, timeRange(e.start_at, e.end_at))) },
          { label: 'Evento', primary: true, render: (e) => h('div', { class: 'cell-title' }, e.title) },
          { label: 'Unidade', key: 'unit_name' },
          { label: 'Status', render: (e) => badge(EVENT_STATUS[e.status].label, EVENT_STATUS[e.status].tone) },
          { label: 'Valor', num: true, render: (e) => brl(e.total_cents) },
        ], c.events, { onRowClick: (e) => navigate(`/eventos/${e.id}`), emptyText: 'Nenhum evento para este cliente.', emptyIcon: 'calendar' }));
      }
      if (tab === 'negocios') {
        return h('div', { class: 'card' }, table([
          { label: 'Negociação', primary: true, render: (d) => h('div', h('div', { class: 'cell-title' }, d.title), h('div', { class: 'cell-sub' }, d.event_type || '')) },
          { label: 'Etapa', render: (d) => badge(STAGE[d.stage].label, d.stage === 'ganho' ? 'green' : d.stage === 'perdido' ? 'red' : 'violet') },
          { label: 'Data prevista', render: (d) => dateBR(d.expected_date) || '-' },
          { label: 'Valor', num: true, render: (d) => brl(d.value_cents) },
        ], c.deals, { onRowClick: can('crm', 'w') ? (d) => openDealForm(d, load) : null, emptyText: 'Nenhuma negociação.', emptyIcon: 'funnel' }));
      }
      if (tab === 'formularios') {
        return h('div', { class: 'stack' }, c.forms.length ? c.forms.map((f) => h('div', { class: 'card card-pad stack' },
          h('div', { class: 'row between' }, h('b', f.type === 'briefing' ? 'Briefing do evento' : 'Atualização de cadastro'),
            badge(f.status === 'respondido' ? `Respondido ${dateTimeBR(f.responded_at)}` : 'Aguardando resposta', f.status === 'respondido' ? 'green' : 'amber')),
          f.response ? h('dl', { class: 'info-list' }, Object.entries(f.response).filter(([, v]) => v !== null && v !== '')
            .map(([k, v]) => h('div', h('dt', k.replace(/_/g, ' ')), h('dd', { class: 'pre' }, String(v))))) : null))
          : h('div', { class: 'card' }, empty('Nenhum formulário enviado.', 'form')));
      }
      const type = select('type', Object.entries(INTERACTION).filter(([k]) => k !== 'whatsapp').map(([value, label]) => ({ value, label })), 'nota');
      const desc = textarea('description', '', { maxlength: 2000, placeholder: 'Registre uma ligação, visita, reunião ou anotação' });
      const add = btn('Registrar', { variant: 'primary', size: 'sm', onClick: async () => {
        if (!desc.value.trim()) return;
        try { await post(`/clients/${c.id}/interactions`, { type: type.value, description: desc.value.trim() }); toast('Registrado.'); tab = 'historico'; load(); } catch (err) { toastError(err); }
      } });
      type.style.width = 'auto';
      return h('div', { class: 'stack' },
        can('crm', 'w') ? h('div', { class: 'card card-pad stack' }, desc, h('div', { class: 'row between' }, type, add)) : null,
        h('div', { class: 'card card-pad' }, c.interactions.length
          ? h('ul', { class: 'timeline' }, c.interactions.map((i) => h('li',
            h('div', { class: 'row', style: { gap: '8px' } }, badge(INTERACTION[i.type], i.type === 'whatsapp' ? 'green' : 'violet', true), h('span', { class: 'muted small' }, `${dateTimeBR(i.created_at)} · ${i.user_name || 'Cliente'}`)),
            h('p', { class: 'pre', style: { margin: '6px 0 0' } }, i.description))))
          : empty('Nenhum registro ainda.', 'history')));
    }

    const actions = [
      btn('Voltar', { icon: 'chevronLeft', variant: 'ghost', onClick: () => navigate('/clientes') }),
      can('whatsapp', 'w') ? btn('WhatsApp', { icon: 'whatsapp', variant: 'whatsapp', onClick: () => openWhatsApp({ client: c, onSent: load }) }) : null,
      can('crm', 'w') ? btn('Formulário', { icon: 'link', onClick: async () => {
        try { const f = await post('/forms', { type: 'cadastro', client_id: c.id }); copyText(f.url); load(); } catch (err) { toastError(err); }
      }, title: 'Gerar link de atualização de cadastro' }) : null,
      can('crm', 'w') ? btn('Nova negociação', { icon: 'funnel', onClick: () => openDealForm({ client_id: c.id }, load) }) : null,
      can('events', 'w') ? btn('Novo evento', { icon: 'calendar', onClick: async () => {
        try { await openEventForm({ deal: { client_id: c.id }, onSaved: (ev) => navigate(`/eventos/${ev.id}`) }); } catch (err) { toastError(err); }
      } }) : null,
      can('crm', 'w') ? btn('Editar', { icon: 'edit', variant: 'primary', onClick: () => openClientForm(c, load) }) : null,
    ];

    mount(root,
      h('div', { class: 'page-head' }, h('div', h('h1', c.name), h('p', `${c.type === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física'}${c.source ? ` · origem: ${c.source}` : ''}`)),
        h('div', { class: 'btn-group' }, actions)),
      h('div', { class: 'detail-grid' },
        h('div', tabBox),
        h('div', { class: 'stack', style: { gap: '16px' } },
          h('div', { class: 'card' }, h('div', { class: 'card-head' }, h('h3', 'Dados do cliente')),
            h('div', { class: 'card-body' }, h('dl', { class: 'info-list', style: { gridTemplateColumns: '1fr' } },
              h('div', h('dt', 'WhatsApp'), h('dd', phoneBR(c.whatsapp) || '-')),
              h('div', h('dt', 'Telefone'), h('dd', phoneBR(c.phone) || '-')),
              h('div', h('dt', 'E-mail'), h('dd', c.email || '-')),
              h('div', h('dt', 'CPF / CNPJ'), h('dd', docBR(c.document) || '-')),
              h('div', h('dt', 'Nascimento'), h('dd', dateBR(c.birth_date) || '-')),
              h('div', h('dt', 'Endereço'), h('dd', [c.address, c.city, c.state].filter(Boolean).join(', ') || '-')),
              c.notes ? h('div', h('dt', 'Observações'), h('dd', { class: 'pre' }, c.notes)) : null),
            !c.whatsapp && !c.phone ? h('div', { class: 'mt' }, alertBox('Cadastre um WhatsApp para enviar mensagens, contratos e formulários.', 'warn')) : null,
            can('crm', 'w') && !c.events.length ? h('div', { class: 'mt' }, btn('Excluir cliente', { variant: 'danger', size: 'sm', icon: 'trash', onClick: async () => {
              if (!(await confirmDialog(`Excluir ${c.name}? As negociações e o histórico também serão apagados.`, { danger: true, confirmLabel: 'Excluir' }))) return;
              try { await del(`/clients/${c.id}`); toast('Cliente excluído.'); navigate('/clientes'); } catch (err) { toastError(err); }
            } })) : null)))));
    drawTab();
  }

  await load();
}


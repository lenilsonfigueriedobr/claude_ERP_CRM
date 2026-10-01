import { h, mount, btn, badge, input, select, table, loading, modal, toast, toastError, confirmDialog, promptDialog, debounce, ic, textarea, alertBox, copyText } from '../ui.js';
import { get, post, put, qs } from '../api.js';
import { can } from '../store.js';
import { dateBR, dateTimeBR, CONTRACT_STATUS } from '../format.js';
import { navigate } from '../app.js';
import { openWhatsApp } from '../components/whatsapp.js';

export async function render(root) {
  const listBox = h('div', { class: 'card' });
  const q = input('q', '', { type: 'search', placeholder: 'Número, evento ou cliente', 'aria-label': 'Buscar' });
  const status = select('status', [{ value: '', label: 'Todos os status' }, ...Object.entries(CONTRACT_STATUS).map(([value, s]) => ({ value, label: s.label }))]);

  const reload = async () => {
    mount(listBox, loading());
    try {
      const rows = await get(`/contracts${qs({ q: q.value.trim(), status: status.value })}`);
      mount(listBox, table([
        { label: 'Número', render: (c) => h('b', { class: 'mono' }, c.number) },
        { label: 'Evento', primary: true, render: (c) => h('div', h('div', { class: 'cell-title' }, c.event_title), h('div', { class: 'cell-sub' }, `${dateBR(c.start_at)} · ${c.unit_name}`)) },
        { label: 'Cliente', key: 'client_name' },
        { label: 'Status', render: (c) => badge(CONTRACT_STATUS[c.status].label, CONTRACT_STATUS[c.status].tone) },
        { label: 'Atualização', render: (c) => h('span', { class: 'small muted' }, c.accepted_at ? `Assinado ${dateTimeBR(c.accepted_at)}` : c.sent_at ? `Enviado ${dateTimeBR(c.sent_at)}` : `Emitido ${dateTimeBR(c.created_at)}`) },
        { label: '', actions: true, render: (c) => h('div', { class: 'btn-group', style: { justifyContent: 'flex-end' } },
          can('whatsapp', 'w') && c.status !== 'cancelado' ? btn('', { icon: 'whatsapp', size: 'sm', variant: 'ghost', title: 'Enviar pelo WhatsApp',
            onClick: () => openWhatsApp({ client: { id: c.client_id, name: c.client_name, whatsapp: c.client_whatsapp, phone: c.client_phone }, kinds: ['contrato'], contractId: c.id, onSent: reload }) }) : null,
          btn('', { icon: 'printer', size: 'sm', variant: 'ghost', title: 'Abrir para impressão', href: c.public_url, target: '_blank' }),
          btn('', { icon: 'file', size: 'sm', variant: 'ghost', title: 'Ver contrato', onClick: () => openContract(c.id, reload) })) },
      ], rows, { onRowClick: (c) => openContract(c.id, reload), emptyText: 'Nenhum contrato. Emita contratos pela tela do evento.', emptyIcon: 'file' }));
    } catch (err) { toastError(err); }
  };
  q.addEventListener('input', debounce(reload, 300));
  status.addEventListener('change', reload);

  mount(root,
    h('div', { class: 'page-head' }, h('div', h('h1', 'Contratos'), h('p', 'Contratos emitidos para os eventos. O cliente lê e dá o aceite online pelo link.'))),
    h('div', { class: 'toolbar' }, h('div', { class: 'search-wrap' }, ic('search'), q), status),
    listBox);
  await reload();
}

// Visualização do contrato com as ações disponíveis.
export async function openContract(id, onChange) {
  let c;
  try { c = await get(`/contracts/${id}`); } catch (err) { toastError(err); return; }
  const st = CONTRACT_STATUS[c.status];
  const paper = h('div', { class: 'contract-paper' }, c.content);
  const body = h('div', { class: 'stack' },
    h('div', { class: 'row between' },
      h('div', h('div', { class: 'cell-title' }, `${c.event_title} · ${c.client_name}`), h('div', { class: 'cell-sub' }, `Evento em ${dateBR(c.start_at)} · ${c.unit_name}`)),
      badge(st.label, st.tone)),
    c.accepted_at ? alertBox(`Aceito por ${c.accepted_name}${c.accepted_document ? ` (doc. ${c.accepted_document})` : ''} em ${dateTimeBR(c.accepted_at)}${c.accepted_ip ? ` · IP ${c.accepted_ip}` : ''}.`, 'ok') : null,
    paper);

  const writable = can('contracts', 'w');
  const changed = () => { m.close(); onChange?.(); };
  const footer = [
    btn('Copiar link', { icon: 'link', onClick: () => copyText(c.public_url) }),
    btn('Imprimir / PDF', { icon: 'printer', href: c.public_url, target: '_blank' }),
    h('div', { class: 'grow' }),
  ];
  if (writable && c.status === 'rascunho') {
    footer.push(btn('Editar texto', { icon: 'edit', onClick: () => {
      const ta = textarea('content', c.content, { maxlength: 60000 });
      ta.style.minHeight = '50vh';
      ta.style.fontFamily = 'var(--font-serif)';
      mount(body, alertBox('Edite o texto do contrato. Depois de enviado ao cliente, ele não pode mais ser alterado.', 'info'), ta);
      const save = btn('Salvar texto', { variant: 'primary', onClick: async () => {
        try { await put(`/contracts/${c.id}`, { content: ta.value }); toast('Contrato atualizado.'); changed(); } catch (err) { toastError(err); }
      } });
      mount(m.foot, btn('Cancelar', { onClick: m.close }), save);
    } }));
  }
  if (writable && ['rascunho', 'enviado'].includes(c.status)) {
    footer.push(btn('Registrar assinatura', { icon: 'check', onClick: async () => {
      const name = await promptDialog('Use quando o cliente assinar o contrato impresso.', { title: 'Assinatura física', label: 'Nome de quem assinou', multiline: false });
      if (!name) return;
      try { await post(`/contracts/${c.id}/status`, { status: 'assinado', signer_name: name }); toast('Assinatura registrada. Evento confirmado.'); changed(); } catch (err) { toastError(err); }
    } }));
  }
  if (writable && c.status !== 'cancelado') {
    footer.push(btn('Cancelar contrato', { variant: 'danger', onClick: async () => {
      if (!(await confirmDialog(`Cancelar o contrato ${c.number}? O link deixará de aceitar assinaturas.`, { danger: true, confirmLabel: 'Cancelar contrato' }))) return;
      try { await post(`/contracts/${c.id}/status`, { status: 'cancelado' }); toast('Contrato cancelado.'); changed(); } catch (err) { toastError(err); }
    } }));
  }
  if (can('whatsapp', 'w') && c.status !== 'cancelado') {
    footer.push(btn('Enviar', { icon: 'whatsapp', variant: 'whatsapp', onClick: () => openWhatsApp({
      client: { id: c.client_id, name: c.client_name, whatsapp: c.client_whatsapp, phone: c.client_phone }, kinds: ['contrato'], contractId: c.id, onSent: onChange,
    }) }));
  }
  footer.push(btn('Ver evento', { onClick: () => { m.close(); navigate(`/eventos/${c.event_id}`); } }));
  const m = modal({ title: `Contrato nº ${c.number}`, size: 'lg', body, footer });
}

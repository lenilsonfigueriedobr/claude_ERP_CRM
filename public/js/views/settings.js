import { h, mount, btn, badge, input, select, textarea, field, formModal, table, tabs, loading, toast, toastError, confirmDialog, modal, alertBox, checkbox, ic, copyText } from '../ui.js';
import { get, post, put } from '../api.js';
import { store, can } from '../store.js';
import { dateTimeBR, phoneBR } from '../format.js';

const PLACEHOLDERS = [
  'contrato.numero', 'contrato.data', 'empresa.nome', 'empresa.cnpj', 'empresa.endereco', 'empresa.cidade', 'cliente.nome', 'cliente.documento',
  'cliente.endereco', 'cliente.telefone', 'cliente.email', 'evento.titulo', 'evento.tipo', 'evento.data', 'evento.inicio', 'evento.fim',
  'evento.duracao', 'evento.convidados', 'evento.valor_total', 'evento.itens', 'unidade.nome', 'unidade.local', 'unidade.capacidade', 'financeiro.parcelas',
];

export async function render(root) {
  const available = [
    can('users') && { key: 'usuarios', label: 'Usuários' },
    can('users') && { key: 'permissoes', label: 'Perfis e permissões' },
    can('settings') && { key: 'empresa', label: 'Empresa e contrato' },
    can('settings') && { key: 'whatsapp', label: 'WhatsApp' },
    can('audit') && { key: 'auditoria', label: 'Auditoria' },
  ].filter(Boolean);
  let tab = available[0]?.key;
  const tabBox = h('div');
  const box = h('div');

  const draw = async () => {
    mount(tabBox, tabs(available, tab, (k) => { tab = k; draw(); }));
    mount(box, h('div', { class: 'card' }, loading()));
    try {
      if (tab === 'usuarios') await users(box);
      else if (tab === 'permissoes') await permissions(box);
      else if (tab === 'empresa') await company(box);
      else if (tab === 'whatsapp') await whatsapp(box);
      else if (tab === 'auditoria') await auditLog(box);
    } catch (err) { toastError(err); }
  };

  mount(root, h('div', { class: 'page-head' }, h('div', h('h1', 'Configurações'), h('p', 'Usuários, permissões e dados da empresa.'))), tabBox, box);
  await draw();
}

// ---------- Usuários ----------
async function users(box) {
  const rows = await get('/users');
  const roles = store.me.roles;
  const reload = () => users(box);
  const showPassword = (title, password) => {
    modal({ title, body: h('div', { class: 'stack' },
      alertBox('Anote e repasse a senha ao usuário por um canal seguro. Ela não será exibida novamente e precisa ser trocada no primeiro acesso.', 'warn'),
      h('div', { class: 'row' }, h('code', { class: 'contract-paper', style: { padding: '10px 14px', fontFamily: 'monospace' } }, password),
        btn('Copiar', { icon: 'copy', onClick: () => copyText(password) }))) });
  };

  const openForm = (u = null) => {
    formModal({
      title: u ? 'Editar usuário' : 'Novo usuário',
      fields: [
        field('Nome', input('name', u?.name, { maxlength: 120 }), { required: true }),
        field('E-mail (login)', input('email', u?.email, { type: 'email', maxlength: 160, autocomplete: 'off' }), { span: 6, required: true }),
        field('Telefone', input('phone', u?.phone, { maxlength: 20 }), { span: 6 }),
        field('Perfil', select('role', Object.entries(roles).map(([value, label]) => ({ value, label })), u?.role || 'comercial'), { required: true }),
        u ? h('div', { class: 'field' }, checkbox('active', u.active, 'Usuário ativo')) : null,
        !u ? h('div', { class: 'field' }, alertBox('Uma senha provisória será gerada. O usuário troca a senha no primeiro acesso.', 'info')) : null,
      ],
      onSubmit: async (data, m) => {
        if (u) {
          await put(`/users/${u.id}`, { ...data, active: data.active });
          m.close(); toast('Usuário atualizado.');
        } else {
          const r = await post('/users', { ...data, active: true });
          m.close(); showPassword('Usuário criado', r.temporaryPassword);
        }
        reload();
      },
    });
  };

  mount(box,
    h('div', { class: 'toolbar' }, h('div', { class: 'grow muted small' }, `${rows.length} usuário(s)`),
      can('users', 'w') ? btn('Novo usuário', { variant: 'primary', icon: 'plus', onClick: () => openForm() }) : null),
    h('div', { class: 'card' }, table([
      { label: 'Usuário', primary: true, render: (u) => h('div', h('div', { class: 'cell-title' }, u.name), h('div', { class: 'cell-sub' }, u.email)) },
      { label: 'Perfil', render: (u) => badge(roles[u.role], u.role === 'admin' ? 'violet' : 'blue', true) },
      { label: 'Telefone', render: (u) => phoneBR(u.phone) || '-' },
      { label: 'Último acesso', render: (u) => (u.last_login_at ? dateTimeBR(u.last_login_at) : 'Nunca') },
      { label: 'Situação', render: (u) => (u.active ? badge('Ativo', 'green') : badge('Inativo', 'gray')) },
      { label: '', actions: true, render: (u) => (can('users', 'w') ? h('div', { class: 'btn-group', style: { justifyContent: 'flex-end' } },
        btn('', { icon: 'key', size: 'sm', variant: 'ghost', title: 'Gerar nova senha', onClick: async () => {
          if (!(await confirmDialog(`Gerar uma nova senha provisória para ${u.name}? As sessões abertas dele serão encerradas.`, { confirmLabel: 'Gerar senha' }))) return;
          try { const r = await post(`/users/${u.id}/reset-password`); showPassword('Nova senha provisória', r.temporaryPassword); } catch (err) { toastError(err); }
        } }),
        btn('', { icon: 'edit', size: 'sm', variant: 'ghost', title: 'Editar', onClick: () => openForm(u) })) : null) },
    ], rows)));
}

// ---------- Matriz de permissões ----------
async function permissions(box) {
  const { matrix, modules, roles } = await get('/permissions');
  const cell = (level) => (level === 'w' ? badge('Editar', 'green', true) : level === 'r' ? badge('Ver', 'blue', true) : h('span', { class: 'muted' }, '-'));
  mount(box,
    h('div', { class: 'mb' }, alertBox('Cada usuário recebe um perfil. As permissões abaixo valem para todos os usuários do perfil e são checadas no servidor em cada requisição.', 'info')),
    h('div', { class: 'card' }, h('div', { class: 'table-wrap' }, h('table', { class: 'table perm-table' },
      h('thead', h('tr', h('th', 'Módulo'), Object.values(roles).map((r) => h('th', r)))),
      h('tbody', Object.entries(modules).map(([key, label]) => h('tr', h('td', h('b', label)), Object.keys(roles).map((r) => h('td', cell(matrix[r]?.[key]))))))))));
}

// ---------- Empresa e contrato ----------
async function company(box) {
  const s = await get('/settings');
  const w = can('settings', 'w');
  const tpl = textarea('contract_template', s.contract_template, { maxlength: 60000 });
  tpl.style.minHeight = '420px';
  tpl.style.fontFamily = 'var(--font-serif)';
  const errBox = h('div');
  const form = h('form', { class: 'form-grid', novalidate: true },
    field('Nome da empresa', input('company_name', s.company_name, { maxlength: 150 }), { span: 6, required: true }),
    field('CNPJ', input('company_document', s.company_document, { maxlength: 20 }), { span: 6 }),
    field('Endereço', input('company_address', s.company_address, { maxlength: 250 }), { span: 8 }),
    field('Cidade', input('company_city', s.company_city, { maxlength: 100 }), { span: 4 }),
    field('Telefone', input('company_phone', s.company_phone, { maxlength: 20 }), { span: 6 }),
    field('E-mail', input('company_email', s.company_email, { maxlength: 160 }), { span: 6 }),
    field('Modelo de contrato', tpl, { hint: 'Use os campos entre chaves duplas. Eles são preenchidos com os dados do evento quando o contrato é emitido.' }),
    h('div', { class: 'field' }, h('div', { class: 'pills' }, PLACEHOLDERS.map((p) => h('button', { type: 'button', class: 'pill small', disabled: !w, onClick: () => {
      const tag = `{{${p}}}`;
      const pos = tpl.selectionStart ?? tpl.value.length;
      tpl.setRangeText(tag, pos, tpl.selectionEnd ?? pos, 'end');
      tpl.focus();
    } }, `{{${p}}}`)))),
    h('input', { type: 'hidden', name: 'whatsapp_contract_message', value: s.whatsapp_contract_message }),
    h('input', { type: 'hidden', name: 'whatsapp_form_message', value: s.whatsapp_form_message }),
    h('input', { type: 'hidden', name: 'whatsapp_greeting', value: s.whatsapp_greeting }));
  if (!w) form.querySelectorAll('input, textarea').forEach((el) => { el.readOnly = true; });
  mount(box, h('div', { class: 'card card-pad stack' }, errBox, form,
    w ? h('div', { class: 'btn-group' },
      btn('Salvar', { variant: 'primary', onClick: () => saveSettings(form, errBox) }),
      btn('Restaurar modelo padrão', { onClick: () => { tpl.value = s.default_contract_template; } })) : null));
}

async function saveSettings(form, errBox) {
  mount(errBox);
  const data = Object.fromEntries([...form.querySelectorAll('[name]')].map((el) => [el.name, el.value]));
  try {
    const saved = await put('/settings', data);
    store.me.company = saved.company_name;
    toast('Configurações salvas.');
  } catch (err) { mount(errBox, alertBox(err.message, 'err')); }
}

// ---------- WhatsApp ----------
async function whatsapp(box) {
  const s = await get('/settings');
  const w = can('settings', 'w');
  const errBox = h('div');
  const vars = '{{cliente.nome}}, {{empresa.nome}}, {{evento.titulo}} e {{link}}';
  const form = h('form', { class: 'form-grid', novalidate: true },
    field('Saudação padrão', textarea('whatsapp_greeting', s.whatsapp_greeting, { maxlength: 500 }), { hint: `Variáveis: ${vars}` }),
    field('Mensagem de envio de contrato', textarea('whatsapp_contract_message', s.whatsapp_contract_message, { maxlength: 1000 })),
    field('Mensagem de envio de formulário', textarea('whatsapp_form_message', s.whatsapp_form_message, { maxlength: 1000 })),
    ...['company_name', 'company_document', 'company_address', 'company_city', 'company_phone', 'company_email', 'contract_template']
      .map((k) => h('input', { type: 'hidden', name: k, value: s[k] })));
  if (!w) form.querySelectorAll('textarea').forEach((el) => { el.readOnly = true; });
  mount(box, h('div', { class: 'stack' },
    store.me.whatsappApi
      ? alertBox('WhatsApp Cloud API configurada: as mensagens são enviadas direto pelo sistema.', 'ok')
      : h('div', { class: 'alert info' }, ic('info'), h('div',
        h('b', 'Modo link (wa.me) ativo. '),
        'As mensagens são montadas pelo sistema e abertas no WhatsApp de quem está usando. Para enviar automaticamente, configure WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID no servidor (veja o README).')),
    h('div', { class: 'card card-pad stack' }, errBox, form, w ? h('div', btn('Salvar mensagens', { variant: 'primary', onClick: () => saveSettings(form, errBox) })) : null)));
}

// ---------- Auditoria ----------
async function auditLog(box) {
  const rows = await get('/audit');
  mount(box, h('div', { class: 'card' }, table([
    { label: 'Data', render: (a) => h('span', { class: 'nowrap' }, dateTimeBR(a.created_at)) },
    { label: 'Usuário', primary: true, render: (a) => a.user_name || h('span', { class: 'muted' }, a.action === 'aceite_cliente' ? 'Cliente (link público)' : '-') },
    { label: 'Ação', render: (a) => h('b', a.action.replace(/_/g, ' ')) },
    { label: 'Registro', render: (a) => `${a.entity}${a.entity_id ? ` #${a.entity_id}` : ''}` },
    { label: 'IP', render: (a) => h('span', { class: 'small muted' }, a.ip || '-') },
  ], rows, { emptyText: 'Nenhum registro.' })));
}

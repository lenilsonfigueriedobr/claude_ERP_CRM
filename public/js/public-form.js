import { h, mount, btn, field, input, textarea, select, alertBox, ic, formData } from './ui.js';
import { get, post } from './api.js';

const root = document.getElementById('app');
const token = location.pathname.split('/').pop();
const UF = ['', 'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

function header(f, subtitle) {
  return h('div', { class: 'public-head' }, h('div', { class: 'brand-mark' }, ic('sparkle')),
    h('div', h('div', { class: 'brand-name' }, f.company.name), h('div', { class: 'muted small' }, subtitle)));
}

function thanks(f) {
  mount(root, header(f, 'Formulário'), h('div', { class: 'card card-pad stack' },
    h('h2', 'Recebemos suas respostas. Obrigado!'),
    h('p', { class: 'muted' }, 'Nossa equipe já tem acesso às informações e entra em contato se precisar de algo mais.')));
}

async function load() {
  let f;
  try {
    f = await get(`/public/forms/${encodeURIComponent(token)}`);
  } catch (err) {
    mount(root, alertBox(err.message, 'err'));
    return;
  }
  if (f.status === 'respondido') { thanks(f); return; }
  const p = f.prefill || {};
  const isCadastro = f.type === 'cadastro';
  document.title = `${isCadastro ? 'Cadastro' : 'Briefing do evento'} · ${f.company.name}`;

  const fields = isCadastro ? [
    field('Nome completo', input('name', p.name, { maxlength: 150, autocomplete: 'name' }), { required: true }),
    field('CPF ou CNPJ', input('document', p.document, { maxlength: 20, inputmode: 'numeric' }), { span: 6 }),
    field('Data de nascimento', input('birth_date', p.birth_date, { type: 'date' }), { span: 6 }),
    field('WhatsApp', input('whatsapp', p.whatsapp, { maxlength: 20, inputmode: 'tel', autocomplete: 'tel' }), { span: 6 }),
    field('E-mail', input('email', p.email, { type: 'email', maxlength: 160, autocomplete: 'email' }), { span: 6 }),
    field('Endereço', input('address', p.address, { maxlength: 250, autocomplete: 'street-address' })),
    field('Cidade', input('city', p.city, { maxlength: 100 }), { span: 8 }),
    field('UF', select('state', UF.map((u) => ({ value: u, label: u || '-' })), p.state || ''), { span: 4 }),
  ] : [
    field('Número de convidados', input('guests', p.guests ?? '', { type: 'number', min: 0 }), { span: 6 }),
    field('Tema / estilo da decoração', input('theme', '', { maxlength: 300 }), { span: 6 }),
    field('Preferências de cardápio', textarea('menu_preferences', '', { maxlength: 2000 })),
    field('Restrições alimentares', textarea('dietary_restrictions', '', { maxlength: 1000, placeholder: 'Ex.: 3 convidados veganos, 1 celíaco' })),
    field('Música e atrações', textarea('music', '', { maxlength: 1000 })),
    field('Roteiro do evento', textarea('schedule', '', { maxlength: 2000, placeholder: 'Ex.: 19h recepção, 20h cerimônia, 21h jantar...' })),
    field('Contato responsável no dia', input('contact_on_day', '', { maxlength: 200, placeholder: 'Nome e telefone' })),
    field('Outras observações', textarea('notes', '', { maxlength: 2000 })),
  ];

  const err = h('div');
  const form = h('form', { class: 'form-grid', novalidate: true }, fields);
  const send = btn('Enviar respostas', { variant: 'primary', icon: 'send', type: 'submit' });
  form.append(h('div', { class: 'field' }, err), h('div', { class: 'field' }, send));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    mount(err);
    const data = formData(form);
    if (isCadastro && !data.name) { mount(err, alertBox('Informe seu nome.', 'err')); return; }
    if (!isCadastro) data.guests = data.guests === '' ? null : Number(data.guests);
    send.disabled = true;
    try {
      await post(`/public/forms/${encodeURIComponent(token)}`, data);
      thanks(f);
    } catch (ex) {
      mount(err, alertBox(ex.message, 'err'));
      send.disabled = false;
    }
  });

  mount(root,
    header(f, isCadastro ? 'Atualização de cadastro' : `Briefing${f.event ? ` · ${f.event.title} (${f.event.date})` : ''}`),
    h('div', { class: 'card card-pad stack' },
      h('h2', isCadastro ? 'Confira e complete seus dados' : 'Conte pra gente como você imagina o evento'),
      h('p', { class: 'muted' }, 'Leva poucos minutos. As informações ficam guardadas com segurança e são usadas só para organizar o seu evento.'),
      form));
}

load();

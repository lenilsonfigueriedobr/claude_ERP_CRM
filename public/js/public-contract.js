import { h, mount, btn, field, input, checkbox, alertBox, badge, ic } from './ui.js';
import { get, post } from './api.js';
import { dateBR, dateTimeBR, CONTRACT_STATUS } from './format.js';

const root = document.getElementById('app');
const token = location.pathname.split('/').pop();

async function load() {
  let c;
  try {
    c = await get(`/public/contracts/${encodeURIComponent(token)}`);
  } catch (err) {
    mount(root, alertBox(err.message, 'err'));
    return;
  }
  document.title = `Contrato ${c.number} · ${c.company.name}`;
  const st = CONTRACT_STATUS[c.status];
  const err = h('div');
  const name = input('name', '', { maxlength: 150, autocomplete: 'name' });
  const doc = input('document', '', { maxlength: 20, inputmode: 'numeric', placeholder: 'Somente números' });
  const agreeBox = checkbox('agree', false, 'Li e concordo com todas as cláusulas deste contrato.');
  const submit = btn('Aceitar contrato', { variant: 'primary', icon: 'check' });

  submit.addEventListener('click', async () => {
    mount(err);
    submit.disabled = true;
    try {
      await post(`/public/contracts/${encodeURIComponent(token)}/accept`, {
        name: name.value.trim(), document: doc.value.trim(), agree: agreeBox.querySelector('input').checked,
      });
      await load();
    } catch (ex) {
      mount(err, alertBox(ex.message, 'err'));
    } finally {
      submit.disabled = false;
    }
  });

  const canAccept = ['rascunho', 'enviado'].includes(c.status);
  mount(root,
    h('div', { class: 'public-head' },
      h('div', { class: 'brand-mark' }, ic('sparkle')),
      h('div', { class: 'grow' }, h('div', { class: 'brand-name' }, c.company.name), h('div', { class: 'muted small' }, `Contrato nº ${c.number} · ${c.event_title} · ${dateBR(c.start_at)}`)),
      badge(st.label, st.tone)),
    c.status === 'assinado' ? h('div', { class: 'mb' }, alertBox(`Contrato aceito por ${c.accepted_name} em ${dateTimeBR(c.accepted_at)}. Obrigado!`, 'ok')) : null,
    c.status === 'cancelado' ? h('div', { class: 'mb' }, alertBox('Este contrato foi cancelado e não está mais válido.', 'warn')) : null,
    h('div', { class: 'contract-paper', style: { maxHeight: 'none' } }, c.content),
    h('div', { class: 'row mt no-print' }, btn('Imprimir ou salvar em PDF', { icon: 'printer', onClick: () => window.print() })),
    canAccept ? h('div', { class: 'card card-pad mt no-print stack' },
      h('h2', 'Aceite eletrônico'),
      h('p', { class: 'muted' }, 'Ao aceitar, registramos seu nome, documento, data, hora e endereço IP como comprovação do aceite.'),
      h('div', { class: 'form-grid' }, field('Nome completo', name, { span: 6, required: true }), field('CPF ou CNPJ', doc, { span: 6, required: true })),
      agreeBox, err, h('div', submit)) : null,
    h('p', { class: 'muted small mt' }, [c.company.phone, c.company.email].filter(Boolean).join(' · ')));
}

load();

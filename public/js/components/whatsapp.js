import { h, mount, btn, modal, field, select, textarea, alertBox, toast, ic } from '../ui.js';
import { post } from '../api.js';
import { store } from '../store.js';

const KIND_LABELS = {
  mensagem: 'Chamar o cliente (mensagem livre)',
  contrato: 'Enviar contrato',
  formulario: 'Enviar formulário',
  cobranca: 'Lembrete de cobrança',
};

// Janela de envio pelo WhatsApp. Com a Cloud API configurada, envia direto;
// sem ela, gera o link wa.me com a mensagem pronta para o usuário abrir.
export function openWhatsApp({ client, kinds = ['mensagem', 'formulario'], kind, contractId, eventId, transactionId, onSent } = {}) {
  const kindSel = select('kind', kinds.map((k) => ({ value: k, label: KIND_LABELS[k] })), kind || kinds[0]);
  const formType = select('form_type', [
    { value: 'cadastro', label: 'Atualização de cadastro' },
    { value: 'briefing', label: 'Briefing do evento' },
  ], eventId ? 'briefing' : 'cadastro');
  const formTypeField = field('Tipo de formulário', formType);
  const message = textarea('message', '', { maxlength: 4000, placeholder: 'Deixe em branco para usar a mensagem padrão configurada.' });
  const result = h('div');
  const send = btn(store.me.whatsappApi ? 'Enviar' : 'Gerar mensagem', { variant: 'whatsapp', icon: 'whatsapp' });
  const cancel = btn('Fechar');

  const sync = () => { formTypeField.classList.toggle('hidden', kindSel.value !== 'formulario'); };
  kindSel.addEventListener('change', sync);
  sync();

  const phone = client.whatsapp || client.phone;
  const m = modal({
    title: 'WhatsApp',
    body: h('div', { class: 'stack' },
      h('div', { class: 'row' }, h('span', { class: 'avatar' }, ic('whatsapp')), h('div', h('b', client.name), h('div', { class: 'muted small' }, phone || 'Sem telefone cadastrado'))),
      kinds.length > 1 ? field('O que deseja fazer?', kindSel) : null,
      formTypeField,
      field('Mensagem', message, { hint: 'Os links de contrato e formulário são incluídos automaticamente.' }),
      store.me.whatsappApi ? null : alertBox('A API do WhatsApp não está configurada. O sistema vai montar a mensagem e você abre o WhatsApp com um clique.', 'info'),
      result),
    footer: [cancel, send],
  });
  cancel.addEventListener('click', m.close);

  send.addEventListener('click', async () => {
    send.disabled = true;
    mount(result);
    try {
      const res = await post('/whatsapp/send', {
        client_id: client.id,
        kind: kindSel.value,
        message: message.value.trim() || null,
        contract_id: contractId,
        event_id: eventId,
        transaction_id: transactionId,
        form_type: formType.value,
      });
      if (res.mode === 'api') {
        toast('Mensagem enviada pelo WhatsApp.');
        m.close();
      } else {
        mount(result, h('div', { class: 'stack' },
          res.error ? alertBox(res.error, 'warn') : alertBox('Mensagem pronta. Clique para abrir o WhatsApp.', 'ok'),
          h('div', { class: 'contract-paper small' }, res.message),
          btn('Abrir no WhatsApp', { variant: 'whatsapp', icon: 'send', href: res.url, target: '_blank' })));
        send.classList.add('hidden');
      }
      onSent?.(res);
    } catch (err) {
      mount(result, alertBox(err.message, 'err'));
    } finally {
      send.disabled = false;
    }
  });
}

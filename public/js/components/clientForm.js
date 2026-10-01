import { field, input, select, textarea, formModal, toast } from '../ui.js';
import { post, put } from '../api.js';
import { LEAD_SOURCES } from '../format.js';

const UF = ['', 'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'];

export function openClientForm(client = null, onSaved) {
  const c = client || {};
  formModal({
    title: client ? 'Editar cliente' : 'Novo cliente',
    size: 'lg',
    fields: [
      field('Tipo', select('type', [{ value: 'PF', label: 'Pessoa física' }, { value: 'PJ', label: 'Pessoa jurídica' }], c.type || 'PF'), { span: 3 }),
      field('Nome / Razão social', input('name', c.name, { maxlength: 150, autocomplete: 'off' }), { span: 6, required: true }),
      field('CPF / CNPJ', input('document', c.document, { maxlength: 20, inputmode: 'numeric' }), { span: 3 }),
      field('WhatsApp', input('whatsapp', c.whatsapp, { maxlength: 20, inputmode: 'tel', placeholder: '(11) 99999-9999' }), { span: 4 }),
      field('Telefone', input('phone', c.phone, { maxlength: 20, inputmode: 'tel' }), { span: 4 }),
      field('E-mail', input('email', c.email, { type: 'email', maxlength: 160 }), { span: 4 }),
      field('Data de nascimento', input('birth_date', c.birth_date, { type: 'date' }), { span: 4 }),
      field('Origem', select('source', ['', ...LEAD_SOURCES].map((s) => ({ value: s, label: s || 'Selecione' })), c.source || ''), { span: 4 }),
      field('Cidade', input('city', c.city, { maxlength: 100 }), { span: 2 }),
      field('UF', select('state', UF.map((u) => ({ value: u, label: u || '-' })), c.state || ''), { span: 2 }),
      field('Endereço', input('address', c.address, { maxlength: 250 }), { span: 12 }),
      field('Observações', textarea('notes', c.notes, { maxlength: 2000 })),
    ],
    onSubmit: async (data, m) => {
      const saved = client ? await put(`/clients/${client.id}`, data) : await post('/clients', data);
      m.close();
      toast(client ? 'Cliente atualizado.' : 'Cliente cadastrado.');
      onSaved?.(saved);
    },
  });
}


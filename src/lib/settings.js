export const DEFAULT_CONTRACT_TEMPLATE = `CONTRATO DE PRESTAÇÃO DE SERVIÇOS PARA EVENTO Nº {{contrato.numero}}

CONTRATADA: {{empresa.nome}}, inscrita no CNPJ {{empresa.cnpj}}, com sede em {{empresa.endereco}}.

CONTRATANTE: {{cliente.nome}}, documento {{cliente.documento}}, residente/sediado em {{cliente.endereco}}, telefone {{cliente.telefone}}, e-mail {{cliente.email}}.

CLÁUSULA 1 - DO OBJETO
O presente contrato tem por objeto a realização do evento "{{evento.titulo}}" ({{evento.tipo}}), na unidade {{unidade.nome}}, localizada em {{unidade.local}}.

CLÁUSULA 2 - DATA E HORÁRIO
O evento será realizado em {{evento.data}}, das {{evento.inicio}} às {{evento.fim}}, totalizando {{evento.duracao}}. O número previsto de convidados é {{evento.convidados}}, respeitada a capacidade máxima da unidade de {{unidade.capacidade}} pessoas.

CLÁUSULA 3 - ITENS E SERVIÇOS CONTRATADOS
{{evento.itens}}

CLÁUSULA 4 - VALOR E PAGAMENTO
O valor total do evento é de {{evento.valor_total}}. As condições de pagamento são:
{{financeiro.parcelas}}

CLÁUSULA 5 - CANCELAMENTO
Em caso de cancelamento por parte da CONTRATANTE com menos de 30 dias de antecedência, os valores pagos não serão devolvidos, salvo acordo por escrito entre as partes.

CLÁUSULA 6 - RESPONSABILIDADES
A CONTRATANTE se responsabiliza por eventuais danos causados ao patrimônio da unidade por seus convidados durante o evento.

CLÁUSULA 7 - FORO
Fica eleito o foro da comarca da sede da CONTRATADA para dirimir quaisquer dúvidas oriundas deste contrato.

{{empresa.cidade}}, {{contrato.data}}.`;

export const DEFAULT_SETTINGS = {
  company_name: 'Minha Empresa de Eventos',
  company_document: '',
  company_address: '',
  company_city: '',
  company_phone: '',
  company_email: '',
  contract_template: DEFAULT_CONTRACT_TEMPLATE,
  whatsapp_contract_message: 'Olá, {{cliente.nome}}! Segue o contrato do seu evento "{{evento.titulo}}". Você pode ler e dar o aceite pelo link: {{link}}',
  whatsapp_form_message: 'Olá, {{cliente.nome}}! Para seguirmos com o seu evento, preencha este formulário rapidinho: {{link}}',
  whatsapp_greeting: 'Olá, {{cliente.nome}}! Aqui é da {{empresa.nome}}.',
};

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS);

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in out) out[r.key] = r.value ?? '';
  return out;
}

export function saveSettings(db, values) {
  const stmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  for (const key of SETTING_KEYS) if (key in values) stmt.run(key, values[key] ?? '');
}

export function fillTemplate(template, vars) {
  return String(template).replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => (key in vars ? String(vars[key] ?? '') : ''));
}

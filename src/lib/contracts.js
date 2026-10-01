import { getSettings, fillTemplate } from './settings.js';
import { brl, dateBR, durationLabel, today } from './format.js';
import { randomToken } from './security.js';

const EVENT_TYPES_LABEL = (t) => t || 'evento social';

export function contractVariables(db, eventId, number) {
  const s = getSettings(db);
  const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(eventId);
  const c = db.prepare('SELECT * FROM clients WHERE id = ?').get(ev.client_id);
  const u = db.prepare('SELECT * FROM units WHERE id = ?').get(ev.unit_id);
  const items = db.prepare('SELECT * FROM event_items WHERE event_id = ? ORDER BY id').all(eventId);
  const parcels = db.prepare("SELECT * FROM transactions WHERE event_id = ? AND type = 'receber' AND status <> 'cancelado' ORDER BY due_date").all(eventId);

  const itemsText = items.length
    ? items.map((i) => `- ${i.quantity} x ${i.description}: ${brl(Math.round(i.quantity * i.unit_price_cents))}`).join('\n')
      + (ev.discount_cents ? `\n- Desconto concedido: ${brl(ev.discount_cents)}` : '')
    : '- Locação do espaço conforme negociado.';
  const parcelsText = parcels.length
    ? parcels.map((t) => `- Parcela ${t.installment || ''} de ${brl(t.amount_cents)} com vencimento em ${dateBR(t.due_date)}`).join('\n')
    : '- Conforme negociado entre as partes.';
  const address = [c.address, c.city, c.state].filter(Boolean).join(', ');

  return {
    'contrato.numero': number,
    'contrato.data': dateBR(today()),
    'empresa.nome': s.company_name,
    'empresa.cnpj': s.company_document || '-',
    'empresa.endereco': s.company_address || '-',
    'empresa.cidade': s.company_city || '',
    'empresa.telefone': s.company_phone || '',
    'cliente.nome': c.name,
    'cliente.documento': c.document || '-',
    'cliente.endereco': address || '-',
    'cliente.telefone': c.whatsapp || c.phone || '-',
    'cliente.email': c.email || '-',
    'evento.titulo': ev.title,
    'evento.tipo': EVENT_TYPES_LABEL(ev.event_type),
    'evento.data': dateBR(ev.start_at),
    'evento.inicio': ev.start_at.slice(11, 16),
    'evento.fim': ev.end_at.slice(11, 16) + (ev.end_at.slice(0, 10) !== ev.start_at.slice(0, 10) ? ` do dia ${dateBR(ev.end_at)}` : ''),
    'evento.duracao': durationLabel(ev.duration_minutes),
    'evento.convidados': ev.guests ?? 'a definir',
    'evento.valor_total': brl(ev.total_cents),
    'evento.itens': itemsText,
    'unidade.nome': u.name,
    'unidade.local': u.location,
    'unidade.capacidade': u.capacity,
    'financeiro.parcelas': parcelsText,
  };
}

export function nextContractNumber(db) {
  const year = new Date().getFullYear();
  const row = db.prepare("SELECT number FROM contracts WHERE number LIKE ? ORDER BY id DESC LIMIT 1").get(`${year}-%`);
  const seq = row ? Number(row.number.split('-')[1]) + 1 : 1;
  return `${year}-${String(seq).padStart(4, '0')}`;
}

export function buildContract(db, eventId) {
  const number = nextContractNumber(db);
  const content = fillTemplate(getSettings(db).contract_template, contractVariables(db, eventId, number));
  return { number, content, token: randomToken() };
}

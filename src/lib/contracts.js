import { getSettings, fillTemplate } from './settings.js';
import { brl, dateBR, durationLabel, today } from './format.js';
import { randomToken } from './security.js';

const EVENT_TYPES_LABEL = (t) => t || 'evento social';

export async function contractVariables(db, eventId, number) {
  const s = await getSettings(db);
  const ev = (await db.get('SELECT * FROM events WHERE id = ?', eventId));
  const c = (await db.get('SELECT * FROM clients WHERE id = ?', ev.client_id));
  const u = (await db.get('SELECT * FROM units WHERE id = ?', ev.unit_id));
  const items = (await db.all('SELECT * FROM event_items WHERE event_id = ? ORDER BY id', eventId));
  const parcels = (await db.all("SELECT * FROM transactions WHERE event_id = ? AND type = 'receber' AND status <> 'cancelado' ORDER BY due_date", eventId));

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

export async function nextContractNumber(db) {
  const year = new Date().getFullYear();
  const row = (await db.get("SELECT number FROM contracts WHERE number ILIKE ? ORDER BY id DESC LIMIT 1", `${year}-%`));
  const seq = row ? Number(row.number.split('-')[1]) + 1 : 1;
  return `${year}-${String(seq).padStart(4, '0')}`;
}

export async function buildContract(db, eventId) {
  const number = await nextContractNumber(db);
  const { contract_template: template } = await getSettings(db);
  const content = fillTemplate(template, await contractVariables(db, eventId, number));
  return { number, content, token: randomToken() };
}

// Integração com WhatsApp em dois modos:
// - "api": envia direto pela WhatsApp Cloud API (Meta), quando WHATSAPP_TOKEN e
//   WHATSAPP_PHONE_NUMBER_ID estão configurados;
// - "link": gera um link wa.me com a mensagem pronta, que abre o WhatsApp do usuário.

export function normalizePhone(raw) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  digits = digits.replace(/^0+/, '');
  // Número brasileiro sem código do país (DDD + número)
  if (digits.length === 10 || digits.length === 11) digits = `55${digits}`;
  if (digits.length < 12 || digits.length > 15) return null;
  return digits;
}

export function waLink(phone, message) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export function isApiConfigured(config) {
  return Boolean(config.whatsapp.token && config.whatsapp.phoneNumberId);
}

export async function sendViaApi(config, phone, message, fetchImpl = fetch) {
  const { token, phoneNumberId, apiVersion } = config.whatsapp;
  const url = `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(phoneNumberId)}/messages`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: phone,
      type: 'text',
      text: { preview_url: true, body: message },
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(reason);
  }
  return data?.messages?.[0]?.id || null;
}

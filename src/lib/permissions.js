// Matriz de permissões por perfil. "r" = leitura, "w" = escrita (inclui leitura).
export const ROLES = ['admin', 'gerente', 'financeiro', 'comercial', 'operador'];

export const ROLE_LABELS = {
  admin: 'Administrador',
  gerente: 'Gerente',
  financeiro: 'Financeiro',
  comercial: 'Comercial',
  operador: 'Operador',
};

export const MODULES = {
  dashboard: 'Painel',
  events: 'Eventos',
  blocks: 'Bloqueio de datas',
  units: 'Unidades',
  crm: 'Vendas e CRM',
  contracts: 'Contratos',
  finance: 'Financeiro',
  stock: 'Estoque',
  products: 'Produtos e Serviços',
  whatsapp: 'WhatsApp',
  users: 'Usuários',
  settings: 'Configurações da empresa',
  audit: 'Auditoria',
};

const ALL_W = Object.fromEntries(Object.keys(MODULES).map((m) => [m, 'w']));

export const MATRIX = {
  admin: ALL_W,
  gerente: { ...ALL_W, users: null, settings: 'r', audit: null },
  financeiro: {
    dashboard: 'r', events: 'r', units: 'r', crm: 'r', contracts: 'r',
    finance: 'w', products: 'r', stock: 'r', whatsapp: 'w', settings: 'r',
  },
  comercial: {
    dashboard: 'r', events: 'w', units: 'r', crm: 'w', contracts: 'w',
    products: 'r', stock: 'r', whatsapp: 'w', settings: 'r',
  },
  operador: {
    dashboard: 'r', events: 'r', units: 'r', stock: 'w', products: 'r', settings: 'r',
  },
};

export function can(role, module, action = 'r') {
  const level = MATRIX[role]?.[module];
  if (!level) return false;
  return action === 'r' ? true : level === 'w';
}

export function permissionsFor(role) {
  const out = {};
  for (const m of Object.keys(MODULES)) {
    const level = MATRIX[role]?.[m];
    if (level) out[m] = level;
  }
  return out;
}

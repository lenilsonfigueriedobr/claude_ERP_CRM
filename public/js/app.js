import { h, mount, btn, ic, dropdown, toastError, loading, modal, alertBox, formModal, field, input, toast, closeAllModals } from './ui.js';
import { get, post, setCsrf, setUnauthorizedHandler } from './api.js';
import { store, can } from './store.js';
import { initials } from './format.js';

const NAV = [
  { group: 'Principal' },
  { path: '/', label: 'Painel', icon: 'home', perm: 'dashboard' },
  { path: '/eventos', label: 'Eventos', icon: 'calendar', perm: 'events' },
  { path: '/contratos', label: 'Contratos', icon: 'file', perm: 'contracts' },
  { group: 'Comercial' },
  { path: '/funil', label: 'Funil de vendas', icon: 'funnel', perm: 'crm' },
  { path: '/clientes', label: 'Clientes', icon: 'users', perm: 'crm' },
  { group: 'Gestão' },
  { path: '/financeiro', label: 'Financeiro', icon: 'wallet', perm: 'finance' },
  { path: '/estoque', label: 'Estoque', icon: 'box', perm: 'stock' },
  { path: '/produtos', label: 'Produtos e serviços', icon: 'tag', perm: 'products' },
  { path: '/unidades', label: 'Unidades', icon: 'building', perm: 'units' },
  { group: 'Sistema' },
  { path: '/config', label: 'Configurações', icon: 'settings', perm: 'users', alt: 'settings' },
];

// Cada tela é carregada sob demanda.
const ROUTES = [
  { re: /^\/$/, perm: 'dashboard', title: 'Painel', load: () => import('./views/dashboard.js') },
  { re: /^\/eventos\/(\d+)$/, perm: 'events', title: 'Evento', load: () => import('./views/eventDetail.js') },
  { re: /^\/eventos$/, perm: 'events', title: 'Eventos', load: () => import('./views/events.js') },
  { re: /^\/contratos$/, perm: 'contracts', title: 'Contratos', load: () => import('./views/contracts.js') },
  { re: /^\/funil$/, perm: 'crm', title: 'Funil de vendas', load: () => import('./views/funnel.js') },
  { re: /^\/clientes\/(\d+)$/, perm: 'crm', title: 'Cliente', load: () => import('./views/clientDetail.js') },
  { re: /^\/clientes$/, perm: 'crm', title: 'Clientes', load: () => import('./views/clients.js') },
  { re: /^\/financeiro$/, perm: 'finance', title: 'Financeiro', load: () => import('./views/finance.js') },
  { re: /^\/estoque$/, perm: 'stock', title: 'Estoque', load: () => import('./views/stock.js') },
  { re: /^\/produtos$/, perm: 'products', title: 'Produtos e serviços', load: () => import('./views/products.js') },
  { re: /^\/unidades$/, perm: 'units', title: 'Unidades', load: () => import('./views/units.js') },
  { re: /^\/config$/, perm: 'settings', title: 'Configurações', load: () => import('./views/settings.js') },
];

const root = document.getElementById('app');
let contentEl;
let titleEl;
let sidebarEl;
let scrimEl;
let renderToken = 0;

export function navigate(path) {
  if (location.hash === `#${path}`) route();
  else location.hash = path;
}

function currentPath() {
  return location.hash.replace(/^#/, '').split('?')[0] || '/';
}

export function queryParams() {
  return new URLSearchParams(location.hash.split('?')[1] || '');
}

function brand() {
  return h('div', { class: 'brand' },
    h('div', { class: 'brand-mark' }, ic('sparkle')),
    h('div', h('div', { class: 'brand-name' }, store.me.company || 'Eventos'), h('div', { class: 'brand-sub' }, 'Gestão de eventos')));
}

function closeSidebar() {
  sidebarEl.classList.remove('open');
  scrimEl.classList.remove('show');
}

function renderLayout() {
  const me = store.me;
  const navItems = [];
  let pendingGroup = null;
  for (const item of NAV) {
    if (item.group) { pendingGroup = item.group; continue; }
    if (!can(item.perm) && !(item.alt && can(item.alt))) continue;
    if (pendingGroup) { navItems.push(h('div', { class: 'nav-label' }, pendingGroup)); pendingGroup = null; }
    navItems.push(h('a', { href: `#${item.path}`, dataset: { path: item.path }, onClick: closeSidebar }, ic(item.icon), h('span', item.label)));
  }
  sidebarEl = h('aside', { class: 'sidebar', 'aria-label': 'Menu principal' }, brand(), h('nav', { class: 'nav' }, navItems));
  scrimEl = h('div', { class: 'scrim', onClick: closeSidebar });
  titleEl = h('div', { class: 'topbar-title' });

  const userChip = h('button', { type: 'button', class: 'user-chip', 'aria-label': 'Menu do usuário' },
    h('span', { class: 'avatar' }, initials(me.user.name)),
    h('span', { class: 'who' }, h('b', me.user.name), h('span', me.roles[me.user.role])),
    ic('chevronDown'));

  const topbar = h('header', { class: 'topbar' },
    btn('', { icon: 'menu', variant: 'ghost', title: 'Abrir menu', onClick: () => { sidebarEl.classList.add('open'); scrimEl.classList.add('show'); } }),
    titleEl,
    h('div', { class: 'grow' }),
    dropdown(userChip, [
      { label: 'Trocar senha', icon: 'key', onClick: () => changePassword() },
      '-',
      { label: 'Sair', icon: 'logout', danger: true, onClick: logout },
    ]));
  topbar.firstChild.classList.add('menu-btn');

  contentEl = h('main', { class: 'content', id: 'content' });
  mount(root, h('div', { class: 'layout' }, sidebarEl, scrimEl, h('div', { class: 'main' }, topbar, contentEl)));
  window.addEventListener('scroll', () => topbar.classList.toggle('scrolled', window.scrollY > 4), { passive: true });
}

async function route() {
  if (!store.me) return;
  const path = currentPath();
  const token = ++renderToken;
  closeAllModals();
  for (const a of sidebarEl.querySelectorAll('.nav a')) {
    const p = a.dataset.path;
    a.classList.toggle('active', p === '/' ? path === '/' : path.startsWith(p));
  }
  const match = ROUTES.map((r) => ({ r, m: path.match(r.re) })).find((x) => x.m);
  if (!match) return navigate(firstAllowedPath());
  const allowed = can(match.r.perm) || (match.r.perm === 'settings' && can('users'));
  if (!allowed) {
    mount(contentEl, alertBox('Você não tem permissão para acessar esta área.', 'warn'));
    return;
  }
  titleEl.textContent = match.r.title;
  document.title = `${match.r.title} · ${store.me.company}`;
  mount(contentEl, loading());
  window.scrollTo(0, 0);
  try {
    const mod = await match.r.load();
    if (token !== renderToken) return;
    const view = h('div');
    mount(contentEl, view);
    await mod.render(view, { params: match.m.slice(1), query: queryParams(), isCurrent: () => token === renderToken });
  } catch (err) {
    if (token !== renderToken) return;
    console.error(err);
    mount(contentEl, alertBox(err.message || 'Erro ao carregar a página.', 'err'));
  }
}

function firstAllowedPath() {
  const item = NAV.find((n) => n.path && (can(n.perm) || (n.alt && can(n.alt))));
  return item ? item.path : '/';
}

export function setTitle(text) {
  if (titleEl) titleEl.textContent = text;
}

// ---------- Login ----------
function renderLogin(message) {
  const err = h('div');
  if (message) mount(err, alertBox(message, 'info'));
  const email = input('email', '', { type: 'email', autocomplete: 'username', required: true, placeholder: 'voce@empresa.com.br' });
  const password = input('password', '', { type: 'password', autocomplete: 'current-password', required: true, placeholder: '••••••••' });
  const submit = btn('Entrar', { variant: 'primary', type: 'submit' });
  submit.style.width = '100%';
  const form = h('form', { class: 'stack', novalidate: true },
    field('E-mail', email), field('Senha', password), err, submit);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    mount(err);
    if (!email.value || !password.value) { mount(err, alertBox('Informe e-mail e senha.', 'err')); return; }
    submit.disabled = true;
    try {
      const me = await post('/auth/login', { email: email.value, password: password.value });
      await startSession(me);
    } catch (ex) {
      mount(err, alertBox(ex.message, 'err'));
      password.value = '';
      password.focus();
    } finally {
      submit.disabled = false;
    }
  });
  document.title = 'Entrar · Gestão de Eventos';
  mount(root, h('div', { class: 'login-page' },
    h('section', { class: 'login-art' },
      h('div', { class: 'brand' }, h('div', { class: 'brand-mark' }, ic('sparkle')), h('div', h('div', { class: 'brand-name' }, 'Gestão de Eventos'), h('div', { class: 'brand-sub' }, 'ERP + CRM'))),
      h('div', h('h1', 'Sua agenda, seus clientes e seu caixa no mesmo lugar.'),
        h('p', 'Controle unidades, contratos, estoque e o funil de vendas sem planilhas soltas. A agenda já impede choque de horário e respeita o intervalo entre eventos.')),
      h('div', { class: 'muted small' }, 'Acesso restrito a usuários cadastrados.')),
    h('section', { class: 'login-form-wrap' },
      h('div', { class: 'login-card' }, h('h2', 'Entrar'), h('p', { class: 'muted' }, 'Use o e-mail e a senha cadastrados pelo administrador.'), form))));
  setTimeout(() => email.focus(), 50);
}

async function startSession(me) {
  store.me = me;
  store.units = null;
  setCsrf(me.csrf);
  renderLayout();
  if (!location.hash) location.hash = firstAllowedPath();
  await route();
  if (me.user.mustChangePassword) changePassword(true);
}

async function logout() {
  try { await post('/auth/logout'); } catch { /* sessão já pode ter expirado */ }
  store.me = null;
  setCsrf('');
  renderLogin('Você saiu do sistema.');
}

export function changePassword(forced = false) {
  const m = formModal({
    title: forced ? 'Defina uma nova senha' : 'Trocar senha',
    fields: [
      forced ? h('div', { class: 'field' }, alertBox('Por segurança, troque a senha provisória antes de continuar.', 'warn')) : null,
      field('Senha atual', input('current', '', { type: 'password', autocomplete: 'current-password' }), { required: true }),
      field('Nova senha', input('password', '', { type: 'password', autocomplete: 'new-password' }), { required: true, hint: 'Mínimo de 8 caracteres, com letras e números.' }),
      field('Confirme a nova senha', input('confirm', '', { type: 'password', autocomplete: 'new-password' }), { required: true }),
    ],
    onSubmit: async (data, modalRef) => {
      if (data.password !== data.confirm) throw new Error('As senhas não conferem.');
      await post('/auth/change-password', { current: data.current, password: data.password });
      store.me.user.mustChangePassword = false;
      modalRef.close();
      toast('Senha alterada.');
    },
  });
  return m;
}

setUnauthorizedHandler(() => {
  if (!store.me) return;
  store.me = null;
  closeAllModals();
  renderLogin('Sua sessão expirou. Entre novamente.');
});

window.addEventListener('hashchange', route);

(async function boot() {
  try {
    const me = await get('/auth/me');
    await startSession(me);
  } catch (err) {
    if (err.status && err.status !== 401) toastError(err);
    renderLogin();
  }
}());

export { modal };

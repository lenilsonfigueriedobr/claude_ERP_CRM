import { icon } from './icons.js';
import { moneyInputValue, parseMoney } from './format.js';

// Construtor de elementos. Texto sempre entra como textContent, nunca como HTML,
// o que impede injeção de script (XSS) com dados vindos do banco.
const PROPS = new Set(['value', 'checked', 'selected', 'disabled', 'readOnly', 'required', 'multiple', 'hidden', 'indeterminate']);

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (PROPS.has(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false || c === true) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

export function mount(el, ...children) {
  clear(el);
  append(el, children);
  return el;
}

export const ic = icon;

export function btn(label, { icon: iconName, variant = '', size = '', onClick, type = 'button', title, disabled, href, target } = {}) {
  const cls = ['btn', variant, size, !label ? 'icon' : ''].filter(Boolean).join(' ');
  const content = [iconName ? icon(iconName) : null, label ? h('span', label) : null];
  if (href) return h('a', { class: cls, href, target, rel: target ? 'noopener noreferrer' : null, title, 'aria-label': !label ? title : null }, content);
  return h('button', { class: cls, type, onClick, title, disabled, 'aria-label': !label ? title : null }, content);
}

export function badge(label, tone = 'gray', plain = false) {
  return h('span', { class: `badge ${tone}${plain ? ' plain' : ''}` }, label);
}

export function loading() {
  return h('div', { class: 'loading-block' }, h('div', { class: 'spinner', role: 'status', 'aria-label': 'Carregando' }));
}

export function empty(text, iconName = 'list') {
  return h('div', { class: 'empty' }, icon(iconName), h('div', text));
}

export function alertBox(text, tone = 'info') {
  const iconName = { ok: 'checkCircle', err: 'alert', warn: 'alert', info: 'info' }[tone];
  return h('div', { class: `alert ${tone}`, role: tone === 'err' ? 'alert' : null }, icon(iconName), h('div', text));
}

export function pageHead(title, subtitle, actions = []) {
  return h('div', { class: 'page-head' },
    h('div', h('h1', title), subtitle ? h('p', subtitle) : null),
    actions.length ? h('div', { class: 'btn-group' }, actions) : null);
}

// ---------- Toast ----------
export function toast(message, tone = 'ok') {
  const box = document.getElementById('toasts');
  const el = h('div', { class: `toast ${tone}`, role: 'status' }, icon(tone === 'ok' ? 'checkCircle' : 'alert'), h('div', message));
  box.append(el);
  setTimeout(() => el.remove(), tone === 'ok' ? 3500 : 6000);
}

export function toastError(err) {
  toast(err?.message || 'Ocorreu um erro.', 'err');
}

// ---------- Modal ----------
let openModals = 0;

export function modal({ title, body, footer, size = '', onClose } = {}) {
  const previousFocus = document.activeElement;
  const closeBtn = btn('', { icon: 'x', variant: 'ghost', title: 'Fechar' });
  const bodyEl = h('div', { class: 'modal-body' }, body);
  const footEl = footer ? h('div', { class: 'modal-foot' }, footer) : null;
  const titleId = `m${Date.now()}`;
  const box = h('div', { class: `modal ${size}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId },
    h('div', { class: 'modal-head' }, h('h2', { id: titleId }, title), closeBtn), bodyEl, footEl);
  const backdrop = h('div', { class: 'modal-backdrop' }, box);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    openModals -= 1;
    if (!openModals) document.body.style.overflow = '';
    if (previousFocus?.focus) previousFocus.focus();
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && backdrop === document.querySelector('.modal-backdrop:last-of-type')) close();
  };
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  openModals += 1;
  document.body.style.overflow = 'hidden';
  setTimeout(() => {
    const first = box.querySelector('input:not([type=hidden]):not([readonly]), select, textarea');
    (first || closeBtn).focus();
  }, 30);
  return { close, body: bodyEl, foot: footEl, box };
}

export function confirmDialog(message, { title = 'Confirmar', confirmLabel = 'Confirmar', danger = false } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const ok = btn(confirmLabel, { variant: danger ? 'danger solid' : 'primary' });
    const cancel = btn('Voltar');
    const m = modal({ title, body: h('p', message), footer: [cancel, ok], onClose: () => { if (!answered) resolve(false); } });
    ok.addEventListener('click', () => { answered = true; m.close(); resolve(true); });
    cancel.addEventListener('click', () => { answered = true; m.close(); resolve(false); });
  });
}

export function promptDialog(message, { title = 'Informe', label = 'Motivo', required = true, confirmLabel = 'Confirmar', multiline = true } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const input = multiline ? h('textarea', { class: 'input', maxlength: 500 }) : h('input', { class: 'input', maxlength: 150 });
    const err = h('div');
    const ok = btn(confirmLabel, { variant: 'primary' });
    const cancel = btn('Voltar');
    const m = modal({
      title,
      body: h('div', { class: 'stack' }, message ? h('p', message) : null, field(label, input, { required }), err),
      footer: [cancel, ok],
      onClose: () => { if (!answered) resolve(null); },
    });
    ok.addEventListener('click', () => {
      const v = input.value.trim();
      if (required && !v) { mount(err, alertBox(`${label} é obrigatório.`, 'err')); return; }
      answered = true; m.close(); resolve(v);
    });
    cancel.addEventListener('click', () => { answered = true; m.close(); resolve(null); });
  });
}

// ---------- Formulários ----------
export function field(label, control, { hint, span = 12, required, cls = '' } = {}) {
  const id = control.id || `f${Math.random().toString(36).slice(2, 9)}`;
  control.id = id;
  if (required) control.required = true;
  return h('div', { class: `field ${span !== 12 ? `s${span}` : ''} ${cls}` },
    h('label', { for: id, class: required ? 'req' : null }, label), control, hint ? h('div', { class: 'hint' }, hint) : null);
}

export function input(name, value = '', attrs = {}) {
  return h('input', { class: 'input', name, value: value ?? '', ...attrs });
}

export function textarea(name, value = '', attrs = {}) {
  const el = h('textarea', { class: 'input', name, ...attrs });
  el.value = value ?? '';
  return el;
}

export function select(name, options, value = '', attrs = {}) {
  const el = h('select', { class: 'input', name, ...attrs },
    options.map((o) => {
      const opt = typeof o === 'object' ? o : { value: o, label: o };
      return h('option', { value: opt.value }, opt.label);
    }));
  el.value = value ?? '';
  return el;
}

export function moneyInput(name, cents = 0, attrs = {}) {
  const el = input(name, moneyInputValue(cents), { inputmode: 'decimal', autocomplete: 'off', ...attrs });
  el.dataset.money = '1';
  el.addEventListener('blur', () => { el.value = moneyInputValue(parseMoney(el.value)); });
  el.addEventListener('focus', () => el.select());
  return el;
}

export function checkbox(name, checked, label) {
  return h('label', { class: 'check' }, h('input', { type: 'checkbox', name, checked: !!checked }), label);
}

// Lê os campos do formulário. Campos de dinheiro viram centavos.
export function formData(form) {
  const out = {};
  for (const el of form.querySelectorAll('[name]')) {
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) out[el.name] = el.value; }
    else if (el.dataset.money) out[el.name] = parseMoney(el.value);
    else out[el.name] = el.value.trim();
  }
  return out;
}

// Modal de formulário padrão: cuida do botão salvar, erros e estado de envio.
export function formModal({ title, fields, onSubmit, submitLabel = 'Salvar', size = '', extraFooter = [] }) {
  const errBox = h('div');
  const form = h('form', { class: 'form-grid', novalidate: true }, fields);
  const save = btn(submitLabel, { variant: 'primary', type: 'submit' });
  const cancel = btn('Cancelar');
  const m = modal({ title, size, body: h('div', { class: 'stack' }, errBox, form), footer: [...extraFooter, h('div', { class: 'grow' }), cancel, save] });
  cancel.addEventListener('click', m.close);
  const submit = async (e) => {
    e?.preventDefault();
    mount(errBox);
    const invalid = [...form.querySelectorAll('[required]')].find((el) => !String(el.value).trim());
    if (invalid) {
      const label = form.querySelector(`label[for="${invalid.id}"]`)?.textContent || 'Campo';
      mount(errBox, alertBox(`${label} é obrigatório.`, 'err'));
      invalid.focus();
      return;
    }
    save.disabled = true;
    try {
      await onSubmit(formData(form), m, form);
    } catch (err) {
      mount(errBox, alertBox(err.message, 'err'));
      errBox.scrollIntoView({ block: 'nearest' });
    } finally {
      save.disabled = false;
    }
  };
  form.addEventListener('submit', submit);
  save.addEventListener('click', submit);
  return { ...m, form, errBox };
}

// ---------- Tabela (vira cartões no celular) ----------
export function table(columns, rows, { onRowClick, emptyText = 'Nenhum registro encontrado.', emptyIcon } = {}) {
  if (!rows.length) return empty(emptyText, emptyIcon);
  return h('div', { class: 'table-wrap' }, h('table', { class: 'table responsive' },
    h('thead', h('tr', columns.map((c) => h('th', { class: c.num ? 'num' : null }, c.label)))),
    h('tbody', rows.map((row) => h('tr', {
      class: onRowClick ? 'clickable' : null,
      onClick: onRowClick ? (e) => { if (!e.target.closest('button, a, input, select')) onRowClick(row); } : null,
    }, columns.map((c) => {
      const cls = [c.primary ? 'primary-cell' : '', c.num ? 'num' : '', c.actions ? 'actions' : '', c.cls || ''].filter(Boolean).join(' ');
      return h('td', { 'data-label': c.label, class: cls || null }, c.render ? c.render(row) : row[c.key]);
    }))))));
}

// ---------- Menu suspenso ----------
export function dropdown(trigger, items) {
  const wrap = h('div', { class: 'menu' }, trigger);
  let list = null;
  const close = () => { list?.remove(); list = null; document.removeEventListener('click', outside, true); };
  const outside = (e) => { if (!wrap.contains(e.target)) close(); };
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (list) return close();
    list = h('div', { class: 'menu-list', role: 'menu' }, items.filter(Boolean).map((it) => (it === '-' ? h('hr')
      : h('button', { type: 'button', role: 'menuitem', class: it.danger ? 'danger' : null, onClick: () => { close(); it.onClick(); } },
        it.icon ? icon(it.icon) : null, it.label))));
    wrap.append(list);
    document.addEventListener('click', outside, true);
  });
  return wrap;
}

export function tabs(items, active, onChange) {
  return h('div', { class: 'tabs', role: 'tablist' }, items.map((t) => h('button', {
    type: 'button', role: 'tab', class: `tab ${t.key === active ? 'on' : ''}`, 'aria-selected': String(t.key === active),
    onClick: () => onChange(t.key),
  }, t.label)));
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Link copiado.');
  } catch {
    promptCopy(text);
  }
}

function promptCopy(text) {
  const el = input('copy', text, { readonly: true });
  modal({ title: 'Copie o link', body: el });
  el.select();
}

import { get } from './api.js';

// Estado global simples da sessão.
export const store = {
  me: null,
  units: null,
};

export function can(module, action = 'r') {
  const level = store.me?.permissions?.[module];
  if (!level) return false;
  return action === 'r' || level === 'w';
}

export async function loadUnits(force = false) {
  if (!store.units || force) store.units = await get('/units');
  return store.units;
}

export function invalidateUnits() { store.units = null; }

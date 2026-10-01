import { z } from 'zod';
import { isValidDate, isValidDateTime } from './eventRules.js';

// Helpers de schema com mensagens em português.
export const text = (label, max = 200) =>
  z.string({ error: `${label} é obrigatório.` }).trim().min(1, `${label} é obrigatório.`).max(max, `${label} pode ter no máximo ${max} caracteres.`);

export const optText = (max = 2000) =>
  z.string().trim().max(max, `Texto pode ter no máximo ${max} caracteres.`).optional().nullable()
    .transform((v) => (v ? v : null));

export const id = (label) =>
  z.coerce.number({ error: `${label} é obrigatório.` }).int().positive(`${label} é obrigatório.`);

export const optId = z.union([z.coerce.number().int().positive(), z.literal(''), z.null()]).optional()
  .transform((v) => (v ? v : null));

export const money = (label) =>
  z.coerce.number({ error: `${label} inválido.` }).int(`${label} inválido.`).min(0, `${label} não pode ser negativo.`);

export const date = (label) =>
  z.string({ error: `${label} é obrigatória.` }).refine(isValidDate, `${label} inválida.`);

export const optDate = z.union([z.string().refine(isValidDate, 'Data inválida.'), z.literal(''), z.null()]).optional()
  .transform((v) => (v ? v : null));

export const dateTime = (label) =>
  z.string({ error: `${label} é obrigatório.` }).refine(isValidDateTime, `${label} inválido.`);

export const email = z.union([z.email('E-mail inválido.').max(160), z.literal(''), z.null()]).optional()
  .transform((v) => (v ? v.toLowerCase() : null));

export const phone = z.union([
  z.string().trim().regex(/^[\d\s()+-]{8,20}$/, 'Telefone inválido.'),
  z.literal(''), z.null(),
]).optional().transform((v) => (v ? v : null));

export const bool = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform((v) => (v ? 1 : 0));

export function parse(schema, data) {
  return schema.parse(data ?? {});
}

export function zodMessage(err) {
  const issue = err.issues?.[0];
  if (!issue) return 'Dados inválidos.';
  if (issue.message && !issue.message.startsWith('Invalid')) return issue.message;
  return `Campo inválido: ${issue.path.join('.') || 'dados'}.`;
}

export { z };

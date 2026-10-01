// Função serverless do Vercel. Atende todas as rotas /api/* com o mesmo app Express.
// A inicialização (conexão com o Turso, migrações e administrador) acontece uma vez por
// instância e é reaproveitada nas próximas requisições.
import { boot } from '../src/boot.js';

let ready = null;

export default async function handler(req, res) {
  if (!ready) {
    ready = boot().catch((err) => {
      ready = null; // tenta de novo na próxima requisição
      throw err;
    });
  }
  let app;
  try {
    ({ app } = await ready);
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'O sistema não conseguiu iniciar. Verifique as variáveis de ambiente no Vercel.' }));
    return;
  }
  return app(req, res);
}

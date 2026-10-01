import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { ZodError } from 'zod';
import { AppError, notFound } from './lib/errors.js';
import { zodMessage } from './lib/validate.js';
import { sessionMiddleware, csrfProtection, requireAuth } from './middleware/auth.js';
import { apiRouter } from './routes/index.js';
import { publicRouter } from './routes/public.js';

export function createApp({ db, config }) {
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'"],
        'img-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'font-src': ["'self'"],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'form-action': ["'self'"],
        'base-uri': ["'self'"],
        'upgrade-insecure-requests': config.isProduction ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    hsts: config.isProduction,
  }));
  app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  if (config.logRequests) {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        if (req.path.startsWith('/api')) {
          console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
        }
      });
      next();
    });
  }

  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  const api = express.Router();
  if (config.rateLimit) {
    api.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 1500, standardHeaders: 'draft-8', legacyHeaders: false,
      message: { error: 'Muitas requisições. Aguarde alguns minutos.' } }));
  }
  api.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(sessionMiddleware(db, config));
  api.use(csrfProtection());
  api.use('/public', publicRouter({ db, config }));
  api.use(apiRouter({ db, config, requireAuth }));
  api.use((req, res, next) => next(notFound('Rota não encontrada.')));
  app.use('/api', api);

  const pub = path.join(config.root, 'public');
  app.use(express.static(pub, { index: false, maxAge: config.isProduction ? '1h' : 0 }));
  app.get('/p/contrato/:token', (req, res) => res.sendFile(path.join(pub, 'contract.html')));
  app.get('/p/formulario/:token', (req, res) => res.sendFile(path.join(pub, 'form.html')));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(pub, 'index.html')));

  app.use((err, req, res, next) => {
    if (err instanceof ZodError) return res.status(400).json({ error: zodMessage(err) });
    if (err instanceof AppError) return res.status(err.status).json({ error: err.message, details: err.details });
    if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON inválido.' });
    if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'Conteúdo muito grande.' });
    const msg = String(err?.message || '');
    if (msg.includes('UNIQUE constraint failed')) return res.status(409).json({ error: 'Já existe um registro com esses dados.' });
    if (msg.includes('FOREIGN KEY constraint failed')) {
      return res.status(409).json({ error: 'Este registro está vinculado a outros dados e não pode ser alterado ou excluído.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Erro interno. Tente novamente.' });
  });

  return app;
}

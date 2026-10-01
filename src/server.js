import { loadConfig } from './config.js';
import { openDb } from './db/index.js';
import { ensureAdmin } from './db/bootstrap.js';
import { createApp } from './app.js';

const config = loadConfig();
const db = openDb(config.dbPath);
ensureAdmin(db, config);
const app = createApp({ db, config });

const server = app.listen(config.port, () => {
  console.log(`Sistema rodando em ${config.appUrl} (ambiente: ${config.env})`);
});

const shutdown = () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

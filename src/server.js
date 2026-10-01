import { boot } from './boot.js';

const { app, db, config } = await boot();

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

import { loadConfig } from './config.js';
import { createApp } from './app.js';

const config = loadConfig();
const app = createApp({ config });
const server = app.listen(config.port, '0.0.0.0', () => {
  console.log(`BlockRealm Insights backend listening on :${config.port}`);
});

const shutdown = () => server.close(() => process.exit(0));
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

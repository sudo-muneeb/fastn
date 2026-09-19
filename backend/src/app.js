import express from 'express';
import cors from 'cors';
import { Store } from './store.js';
import { errorHandler, notFound } from './lib/errors.js';
import { mockRoutes } from './routes/mock.js';
import { ingestRoutes } from './routes/ingest.js';
import { exportRoutes } from './routes/export.js';
import { dashboardRoutes } from './routes/dashboard.js';

export function createApp({ config, store = new Store(config.dataFile), now = () => new Date() }) {
  const ctx = { config, store, now };
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',') }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/', (req, res) => res.json({ service: 'blockrealm-insights-backend', status: 'ok', docs: 'see README.md' }));
  app.get('/health', (req, res) => res.json({ status: 'ok', time: now().toISOString() }));

  app.use('/mock', mockRoutes(ctx));
  app.use('/v1/export', exportRoutes(ctx));
  app.use('/v1', ingestRoutes(ctx));
  app.use('/v1', dashboardRoutes(ctx));

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

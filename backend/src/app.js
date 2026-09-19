import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { Store } from './store.js';
import { errorHandler, notFound } from './lib/errors.js';
import { mockRoutes } from './routes/mock.js';
import { ingestRoutes } from './routes/ingest.js';
import { exportRoutes } from './routes/export.js';
import { dashboardRoutes } from './routes/dashboard.js';

export function createApp({ config, store = new Store(config.dataFile, config.seedFile), now = () => new Date() }) {
  const ctx = { config, store, now };
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const started = process.hrtime.bigint();
    const path = req.originalUrl.split('?')[0];
    const receivedAt = now().toISOString();
    res.on('finish', () => {
      console.info(JSON.stringify({
        event: 'http_request',
        received_at: receivedAt,
        method: req.method,
        path,
        status: res.statusCode,
        duration_ms: Number(process.hrtime.bigint() - started) / 1e6,
      }));
    });
    next();
  });
  app.use(cors({ origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',') }));
  app.use(express.json({ limit: '1mb' }));

  app.get('/health', (req, res) => res.json({ status: 'ok', time: now().toISOString() }));

  app.use('/mock', mockRoutes(ctx));
  app.use('/v1/export', exportRoutes(ctx));
  app.use('/v1', ingestRoutes(ctx));
  app.use('/v1', dashboardRoutes(ctx));

  // Dashboard (same origin as the API, so no CORS setup is needed in production)
  const dir = config.frontendDir;
  if (dir && fs.existsSync(path.join(dir, 'index.html'))) {
    app.get('/config.js', (req, res) => {
      res.type('text/javascript').set('Cache-Control', 'no-store').send(`window.BR_CONFIG = ${JSON.stringify({ API_URL: config.publicApiUrl })};`);
    });
    app.use(express.static(dir));
  } else {
    app.get('/', (req, res) => res.json({ service: 'blockrealm-insights', status: 'ok', dashboard: 'not bundled' }));
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

import { Router } from 'express';
import { requireFastnKey } from '../lib/auth.js';
import { ApiError, validationError } from '../lib/errors.js';
import { ENUMS, validateClassified, validateQuestion, validateMeeting, validateReport } from '../lib/validate.js';

const MAX_BATCH = 50;

/** Generic idempotent batch writer: validate each item, skip existing ids, report per-item rejects. */
function batchHandler({ store, now }, { collection, idField, validate, decorate }) {
  return (req, res) => {
    const items = req.body?.items;
    if (!Array.isArray(items)) throw validationError('Body must be { "items": [...] }', [{ index: -1, field: 'items', issue: 'must be an array' }]);
    if (items.length === 0) throw validationError('items must not be empty', [{ index: -1, field: 'items', issue: 'must not be empty' }]);
    if (items.length > MAX_BATCH) throw validationError(`Max ${MAX_BATCH} items per batch`, [{ index: -1, field: 'items', issue: `got ${items.length}, max ${MAX_BATCH}` }]);

    let accepted = 0;
    let duplicates = 0;
    const rejected = [];
    const seen = new Set();
    items.forEach((item, index) => {
      const check = validate(item);
      if (!check.ok) return rejected.push({ index, error: check.message() });
      const id = item[idField];
      if (seen.has(id) || store.has(collection, id)) { duplicates++; return; }
      seen.add(id);
      const receivedAt = now().toISOString();
      store.set(collection, id, decorate(item, receivedAt));
      console.info(JSON.stringify({ event: 'data_ingested', collection, id, received_at: receivedAt, data: item }));
      accepted++;
    });
    console.info(JSON.stringify({ event: 'ingest_batch', collection, received: items.length, accepted, duplicates, rejected: rejected.length }));
    res.json({ accepted, duplicates, rejected });
  };
}

export function ingestRoutes(ctx) {
  const r = Router();
  const auth = requireFastnKey(ctx.config); // per-route: this router shares the /v1 prefix with public routes
  const routes = [
    ['/classified', { collection: 'processed_feedback', idField: 'feedback_id', validate: validateClassified, decorate: (i, ts) => ({ ...i, ingested_at: ts }) }],
    ['/interview-questions', { collection: 'interview_questions', idField: 'question_id', validate: validateQuestion, decorate: (i, ts) => ({ ...i, created_at: ts }) }],
    ['/meetings', { collection: 'meetings', idField: 'meeting_id', validate: validateMeeting, decorate: (i, ts) => ({ ...i, updated_at: ts }) }],
    ['/reports', { collection: 'reports', idField: 'report_id', validate: validateReport, decorate: (i) => i }],
  ];
  for (const [path, opts] of routes) r.post(`/ingest${path}`, auth, batchHandler(ctx, opts));

  // Update a bug/feature status (dashboard workflow), or a meeting status.
  r.patch('/clusters/:kind/:key', auth, (req, res) => {
    const { kind, key } = req.params;
    if (!['bugs', 'features'].includes(kind)) throw new ApiError(404, 'NOT_FOUND', 'kind must be bugs or features');
    const status = req.body?.status;
    if (!ENUMS.status.includes(status)) throw validationError('Invalid status', [{ index: 0, field: 'status', issue: `must be one of ${ENUMS.status.join('|')}` }]);
    ctx.store.set('cluster_status', `${kind}:${key}`, status);
    console.info(JSON.stringify({ event: 'cluster_status_updated', kind, key, status }));
    res.json({ cluster_key: key, status });
  });
  return r;
}

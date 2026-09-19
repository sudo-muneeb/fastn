import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

let s;
before(async () => { s = await startServer(); });
after(() => s.close());

test('health and root are public', async () => {
  assert.equal((await s.get('/health')).body.status, 'ok');
  assert.equal((await s.get('/')).status, 200);
});

test('unknown route returns NOT_FOUND error shape', async () => {
  const r = await s.get('/nope');
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, 'NOT_FOUND');
});

test('machine endpoints require X-API-Key', async () => {
  for (const r of [await s.get('/v1/export/summary'), await s.post('/v1/ingest/classified', { items: [] }), await s.get('/v1/export/summary', { 'X-API-Key': 'wrong' })]) {
    assert.equal(r.status, 401);
    assert.equal(r.body.error.code, 'UNAUTHORIZED');
  }
});

test('mock endpoints require X-Mock-Key (and reject the Fastn key)', async () => {
  assert.equal((await s.get('/mock/reddit/posts')).status, 401);
  assert.equal((await s.get('/mock/reddit/posts', s.fastn)).status, 401);
});

test('dashboard endpoint is public', async () => {
  assert.equal((await s.get('/v1/dashboard')).status, 200);
});

test('invalid JSON body -> 400 VALIDATION_ERROR', async () => {
  const r = await s.post('/v1/ingest/classified', '{bad', s.fastn);
  assert.equal(r.status, 400);
  assert.equal(r.body.error.code, 'VALIDATION_ERROR');
});

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';
import { REDDIT_COMMENTS, X_COMMENTS } from '../src/data/mockComments.js';

let s;
before(async () => { s = await startServer(); });
after(() => s.close());

test('reddit response matches the contract shape', async () => {
  const r = await s.get('/mock/reddit/posts?limit=2&peek=true', s.mock);
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 2);
  const keys = Object.keys(r.body.items[0]).sort();
  assert.deepEqual(keys, ['author', 'body', 'created_at', 'id', 'num_comments', 'score', 'subreddit', 'title', 'url']);
  assert.match(r.body.items[0].created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(r.body.next_since, r.body.items[1].created_at);
});

test('x response matches the contract shape', async () => {
  const r = await s.get('/mock/x/posts?limit=1&peek=true', s.mock);
  assert.deepEqual(Object.keys(r.body.items[0]).sort(), ['author_handle', 'created_at', 'id', 'likes', 'reposts', 'text', 'url']);
});

test('peek does not consume; normal requests never repeat comments', async () => {
  const seen = new Set();
  for (let i = 0; i < 100; i++) {
    const r = await s.get('/mock/reddit/posts?limit=5', s.mock);
    if (r.body.items.length === 0) break;
    for (const it of r.body.items) { assert.ok(!seen.has(it.id), `duplicate ${it.id}`); seen.add(it.id); }
  }
  assert.equal(seen.size, REDDIT_COMMENTS.length);
  assert.equal((await s.get('/mock/reddit/posts', s.mock)).body.items.length, 0);
});

test('sources are tracked independently; status + reset work', async () => {
  const xr = await s.get('/mock/x/posts', s.mock);
  assert.equal(xr.body.items.length, X_COMMENTS.length);
  const st = await s.get('/mock/status', s.mock);
  assert.equal(st.body.reddit.served, REDDIT_COMMENTS.length);
  assert.equal(st.body.x.served, X_COMMENTS.length);

  const rs = await s.post('/mock/reset?source=reddit', {}, s.mock);
  assert.equal(rs.body.reset, REDDIT_COMMENTS.length);
  assert.equal((await s.get('/mock/reddit/posts?limit=3', s.mock)).body.items.length, 3);
  assert.equal((await s.get('/mock/x/posts', s.mock)).body.items.length, 0);
});

test('items are returned oldest-first and honour since', async () => {
  await s.post('/mock/reset', {}, s.mock);
  const all = (await s.get('/mock/x/posts?peek=true', s.mock)).body.items;
  const times = all.map((i) => i.created_at);
  assert.deepEqual(times, [...times].sort());
  const after = (await s.get(`/mock/x/posts?peek=true&since=${all[5].created_at}`, s.mock)).body.items;
  assert.ok(after.every((i) => i.created_at > all[5].created_at));
  assert.equal(after.length, all.length - 6 - all.slice(6).filter((i) => i.created_at === all[5].created_at).length);
});

test('validates since and limit', async () => {
  assert.equal((await s.get('/mock/x/posts?since=yesterday', s.mock)).status, 400);
  assert.equal((await s.get('/mock/x/posts?limit=0', s.mock)).status, 400);
  assert.equal((await s.get('/mock/x/posts?limit=abc', s.mock)).status, 400);
});

test('MOCK_UNIQUE=false always returns everything', async () => {
  const s2 = await startServer({ mockUnique: false });
  const a = await s2.get('/mock/x/posts', s2.mock);
  const b = await s2.get('/mock/x/posts', s2.mock);
  assert.equal(a.body.items.length, b.body.items.length);
  assert.ok(a.body.items.length > 0);
  await s2.close();
});

test('never returns more than 50 per request; limit above 50 is clamped', async () => {
  await s.post('/mock/reset', {}, s.mock);
  const r = await s.get('/mock/reddit/posts?limit=100&peek=true', s.mock);
  assert.equal(r.status, 200);
  assert.ok(r.body.items.length <= 50);
  assert.equal((await s.get('/mock/reddit/posts?peek=true', s.mock)).body.items.length, 24); // default cap is 50
});

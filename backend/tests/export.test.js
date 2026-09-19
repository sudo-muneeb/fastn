import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, bugItem, featureItem, hoursAgo } from './helpers.js';

let s;
before(async () => {
  s = await startServer();
  const items = [
    // world-save-corruption: 4 in last 7d, 2 in previous 7d -> rising (+100%)
    bugItem('a1', 2), bugItem('a2', 30, { source: 'x', feedback_id: 'x_a2' }), bugItem('a3', 60), bugItem('a4', 100),
    bugItem('a5', 24 * 9), bugItem('a6', 24 * 10),
    // chunk-loading-crash: 1 in window, 4 in previous window -> falling
    bugItem('c1', 5, { categories: ['bug'], retention: [], bug: { cluster_key: 'chunk-loading-crash', title: 'Crash when loading chunks', severity: 'high', component: 'chunks', team: 'client' }, platform: 'console' }),
    ...[1, 2, 3, 4].map((n) => bugItem(`c${n + 1}`, 24 * (8 + n), { categories: ['bug'], retention: [], bug: { cluster_key: 'chunk-loading-crash', title: 'Crash when loading chunks', severity: 'medium', component: 'chunks', team: 'client' } })),
    // brand new bug: first mention in window
    bugItem('n1', 3, { categories: ['bug'], retention: [], bug: { cluster_key: 'brand-new-bug', title: 'Brand new', severity: 'low', component: 'ui', team: 'client' } }),
    featureItem('f1', 4), featureItem('f2', 20),
    // outside the 7d window and a future item (must be ignored for windows)
    bugItem('old', 24 * 20, { categories: ['praise'], bug: null, retention: [] }),
  ];
  await s.post('/v1/ingest/classified', { items }, s.fastn);
});
after(() => s.close());

test('summary has the contract shape', async () => {
  const r = await s.get('/v1/export/summary?window=7d', s.fastn);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body), ['window', 'generated_at', 'totals', 'bugs', 'features', 'retention', 'open_meetings']);
  assert.deepEqual(Object.keys(r.body.totals), ['feedback', 'by_source', 'by_category', 'avg_sentiment']);
  assert.deepEqual(Object.keys(r.body.bugs[0]).sort(), ['cluster_key', 'mention_count', 'mention_count_window', 'sample_excerpts', 'severity', 'sources', 'status', 'team', 'title', 'trend'].sort());
  assert.deepEqual(Object.keys(r.body.features[0]).sort(), ['area', 'cluster_key', 'mention_count', 'mention_count_window', 'sample_excerpts', 'sources', 'status', 'team', 'title', 'trend'].sort());
  assert.deepEqual(Object.keys(r.body.retention[0]).sort(), ['cluster_key', 'mention_count', 'mention_count_window', 'risk', 'sample_excerpts', 'signal', 'sources', 'trend', 'type'].sort());
  assert.equal(typeof r.body.bugs[0].sample_excerpts[0], 'string');
});

test('7d totals only include the window and list all categories', async () => {
  const { totals } = (await s.get('/v1/export/summary?window=7d', s.fastn)).body;
  assert.equal(totals.feedback, 4 + 1 + 1 + 2); // a1..a4, c1, n1, f1, f2
  assert.equal(totals.by_source.x, 3); // a2 + f1 + f2
  assert.equal(Object.keys(totals.by_category).length, 6);
  assert.equal(totals.by_category.praise, 0);
});

test('30d window includes older items', async () => {
  const { totals } = (await s.get('/v1/export/summary?window=30d', s.fastn)).body;
  assert.equal(totals.feedback, 4 + 2 + 5 + 1 + 2 + 1);
});

test('bug clusters sorted by window count, with severity, counts and trends', async () => {
  const { bugs } = (await s.get('/v1/export/summary?window=7d', s.fastn)).body;
  // tie on window count -> all-time count
  assert.deepEqual(bugs.map((b) => b.cluster_key), ['world-save-corruption', 'chunk-loading-crash', 'brand-new-bug']);
  const w = bugs[0];
  assert.equal(w.mention_count, 6);
  assert.equal(w.mention_count_window, 4);
  assert.equal(w.severity, 'critical');
  assert.equal(w.trend, 'rising');
  assert.deepEqual(w.sources, { reddit: 3, x: 1, forms: 0 });
  assert.equal(bugs[2].trend, 'new');
  assert.equal(bugs[1].trend, 'falling');
  assert.equal(bugs[1].severity, 'high'); // max severity seen
  assert.equal(w.status, 'open');
});

test('retention clusters: max risk, counts', async () => {
  const { retention } = (await s.get('/v1/export/summary?window=7d', s.fastn)).body;
  assert.equal(retention[0].cluster_key, 'abandon-world-after-corruption');
  assert.equal(retention[0].risk, 'high');
  assert.equal(retention[0].type, 'world');
  assert.equal(retention[0].mention_count_window, 4);
});

test('cluster lookup returns contract shape for each type', async () => {
  const bug = await s.get('/v1/export/clusters?type=bug', s.fastn);
  assert.equal(bug.body.type, 'bug');
  assert.deepEqual(bug.body.clusters[0], { cluster_key: 'world-save-corruption', title: 'Worlds fail to load after update', mention_count: 6 });
  const feat = await s.get('/v1/export/clusters?type=feature_request&limit=1', s.fastn);
  assert.equal(feat.body.clusters.length, 1);
  const ret = await s.get('/v1/export/clusters?type=retention', s.fastn);
  assert.equal(ret.body.clusters[0].cluster_key, 'abandon-world-after-corruption');
  assert.ok(ret.body.clusters[0].title);
});

test('export validates params', async () => {
  assert.equal((await s.get('/v1/export/clusters?type=nope', s.fastn)).status, 400);
  assert.equal((await s.get('/v1/export/clusters?type=bug&limit=201', s.fastn)).status, 400);
  assert.equal((await s.get('/v1/export/summary?window=1y', s.fastn)).status, 400);
});

test('open_meetings lists only scheduled, not-yet-finished meetings', async () => {
  const m = (id, start, end, status = 'scheduled') => ({ meeting_id: `qa_${id}`, team: 'qa', title: 't', trigger_reason: 'r', cluster_keys: ['k'], agenda: [{ item: 'i', context: 'c', duration_min: 5 }], discussion_points: ['d'], scheduled_start: start, scheduled_end: end, attendee_emails: [], status });
  await s.post('/v1/ingest/meetings', { items: [m('future', '2026-09-21T10:00:00Z', '2026-09-21T10:30:00Z'), m('past', '2026-09-10T10:00:00Z', '2026-09-10T10:30:00Z'), m('cancelled', '2026-09-21T10:00:00Z', '2026-09-21T10:30:00Z', 'cancelled')] }, s.fastn);
  const { open_meetings } = (await s.get('/v1/export/summary', s.fastn)).body;
  assert.deepEqual(open_meetings.map((x) => x.meeting_id), ['qa_future']);
});

test('dashboard returns analytics with a continuous daily series', async () => {
  const r = await s.get('/v1/dashboard?days=14');
  assert.equal(r.status, 200);
  assert.equal(r.body.window_days, 14);
  assert.equal(r.body.daily.length, 14);
  assert.equal(r.body.daily.at(-1).date, '2026-09-19');
  assert.equal(r.body.totals.feedback, r.body.daily.reduce((n, d) => n + d.feedback_count, 0));
  assert.equal(r.body.totals.critical_bugs, 1);
  assert.equal(r.body.by_platform.pc + r.body.by_platform.console, r.body.totals.feedback);
  assert.ok(r.body.top_topics.length > 0);
  assert.ok(Array.isArray(r.body.bugs) && Array.isArray(r.body.meetings) && Array.isArray(r.body.reports));
  assert.equal(JSON.stringify(r.body).includes('author_hash'), false);
});

test('dashboard validates days/portfolio and filters questions', async () => {
  assert.equal((await s.get('/v1/dashboard?days=5')).status, 400);
  assert.equal((await s.get('/v1/dashboard?portfolio=chef')).status, 400);
  const q = (id, portfolio) => ({ question_id: `${portfolio}_${id}`, portfolio, question: 'Q?', why_it_matters: 'w', type: 'technical', difficulty: 'junior', expected_signals: ['a'], source_cluster_keys: ['k'], generated_at: hoursAgo(1) });
  await s.post('/v1/ingest/interview-questions', { items: [q('aaaaaaaaaaaa', 'qa_tester'), q('bbbbbbbbbbbb', 'data_analyst')] }, s.fastn);
  const r = await s.get('/v1/dashboard?portfolio=qa_tester');
  assert.deepEqual(r.body.interview_questions.map((x) => x.portfolio), ['qa_tester']);
});

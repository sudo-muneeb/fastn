import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, classified, hoursAgo } from './helpers.js';

let s;
beforeEach(async () => { s = await startServer(); });
afterEach(() => s.close());
const post = (items, path = 'classified') => s.post(`/v1/ingest/${path}`, { items }, s.fastn);

test('accepts a valid item then reports it as duplicate (idempotent)', async () => {
  assert.deepEqual((await post([classified()])).body, { accepted: 1, duplicates: 0, rejected: [] });
  assert.deepEqual((await post([classified()])).body, { accepted: 0, duplicates: 1, rejected: [] });
});

test('duplicate ids inside one batch count once', async () => {
  assert.deepEqual((await post([classified(), classified()])).body, { accepted: 1, duplicates: 1, rejected: [] });
});

test('mixed batch: accepted + rejected with index', async () => {
  const bad = classified({ feedback_id: 'reddit_bad', sentiment: 3 });
  const r = await post([classified(), bad]);
  assert.equal(r.status, 200);
  assert.equal(r.body.accepted, 1);
  assert.equal(r.body.rejected[0].index, 1);
  assert.match(r.body.rejected[0].error, /sentiment/);
});

test('rejects >50 items, empty and non-array bodies with VALIDATION_ERROR', async () => {
  const many = Array.from({ length: 51 }, (_, i) => classified({ feedback_id: `reddit_${i}` }));
  for (const items of [many, [], 'x']) {
    const r = await post(items);
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'VALIDATION_ERROR');
  }
  assert.equal((await post(Array.from({ length: 50 }, (_, i) => classified({ feedback_id: `reddit_${i}` })))).body.accepted, 50);
});

const invalid = {
  'unknown field': { extra: 1 },
  'bad source': { source: 'tiktok' },
  'feedback_id prefix mismatch': { feedback_id: 'x_123' },
  'excerpt > 280': { excerpt: 'a'.repeat(281) },
  'sentiment out of range': { sentiment: -1.1 },
  'confidence out of range': { confidence: 1.5 },
  'bad platform': { platform: 'switch' },
  'bad timestamp': { created_at: '2026-09-19 10:00' },
  'negative engagement': { engagement: -1 },
  'bad cluster key': { bug: { cluster_key: 'Bad Key', title: 't', severity: 'low', component: 'c', team: 'qa' } },
  'bad severity': { bug: { cluster_key: 'ok-key', title: 't', severity: 'blocker', component: 'c', team: 'qa' } },
  'bug missing though category bug': { bug: null },
  'bug present without category': { categories: ['world_retention'] },
  'feature present without category': { feature: { cluster_key: 'k', title: 't', area: 'a', team: 'gameplay' } },
  'retention empty though retention category': { retention: [] },
  'retention non-empty without category': { categories: ['bug'] },
  'empty categories': { categories: [] },
  'duplicate categories': { categories: ['bug', 'bug', 'world_retention'] },
  'cluster key too long (9 words)': { bug: { cluster_key: 'a-b-c-d-e-f-g-h-i', title: 't', severity: 'low', component: 'c', team: 'qa' } },
};
for (const [name, override] of Object.entries(invalid)) {
  test(`classified rejects: ${name}`, async () => {
    const r = await post([classified(override)]);
    assert.equal(r.body.accepted, 0, JSON.stringify(r.body));
    assert.equal(r.body.rejected.length, 1);
  });
}

test('classified accepts praise-only, null game_version, and 8-word cluster keys', async () => {
  const praise = classified({ feedback_id: 'reddit_p', categories: ['praise'], bug: null, retention: [], game_version: null, sentiment: 0.9 });
  const long = classified({ feedback_id: 'reddit_l', bug: { ...classified().bug, cluster_key: 'a-b-c-d-e-f-g-h' } });
  assert.equal((await post([praise, long])).body.accepted, 2);
});

const question = () => ({ question_id: 'world_designer_3f2a9c1d7e4b', portfolio: 'world_designer', question: 'How would you design a recovery flow?', why_it_matters: 'Top risk (54 mentions).', type: 'scenario', difficulty: 'mid', expected_signals: ['backups', 'player trust'], source_cluster_keys: ['world-save-corruption'], generated_at: hoursAgo(1) });
test('interview questions: ok, duplicate, and id/portfolio mismatch', async () => {
  assert.equal((await post([question()], 'interview-questions')).body.accepted, 1);
  assert.equal((await post([question()], 'interview-questions')).body.duplicates, 1);
  const bad = await post([{ ...question(), question_id: 'qa_tester_3f2a9c1d7e4b' }], 'interview-questions');
  assert.equal(bad.body.rejected.length, 1);
});

const meeting = () => ({ meeting_id: 'world_engine_world-save-corruption_20260919', team: 'world_engine', title: 'Triage', trigger_reason: 'critical', cluster_keys: ['world-save-corruption'], agenda: [{ item: 'Review', context: '54 reports', duration_min: 10 }], discussion_points: ['Hotfix?'], scheduled_start: '2026-09-21T10:00:00Z', scheduled_end: '2026-09-21T10:30:00Z', attendee_emails: ['lead@studio.com'], calendar_event_id: 'abc', calendar_link: 'https://calendar.google.com/x', slack_message_url: 'https://slack.com/x', status: 'scheduled' });
test('meetings: ok, duplicate, end-before-start and bad email rejected', async () => {
  assert.equal((await post([meeting()], 'meetings')).body.accepted, 1);
  assert.equal((await post([meeting()], 'meetings')).body.duplicates, 1);
  const bad = await post([{ ...meeting(), meeting_id: 'world_engine_x_1', scheduled_end: '2026-09-21T09:00:00Z' }, { ...meeting(), meeting_id: 'world_engine_x_2', attendee_emails: ['nope'] }], 'meetings');
  assert.equal(bad.body.rejected.length, 2);
});

const report = () => ({ report_id: 'weekly_2026-09-19', period: 'weekly', period_start: '2026-09-13T00:00:00Z', period_end: '2026-09-19T23:59:59Z', headline: 'World corruption is #1', highlights: ['Bugs +40%'], risks: ['Retention risk'], recommendations: [{ action: 'Ship hotfix', team: 'world_engine', impact: 'high' }], generated_at: hoursAgo(0) });
test('reports: ok, duplicate, period/id mismatch and bad impact rejected', async () => {
  assert.equal((await post([report()], 'reports')).body.accepted, 1);
  assert.equal((await post([report()], 'reports')).body.duplicates, 1);
  const bad = await post([{ ...report(), report_id: 'daily_2026-09-19' }, { ...report(), report_id: 'weekly_2026-09-20', recommendations: [{ action: 'x', team: 'qa', impact: 'huge' }] }], 'reports');
  assert.equal(bad.body.rejected.length, 2);
});

test('PATCH cluster status validates input and is reflected in export', async () => {
  await post([classified()]);
  assert.equal((await s.patch('/v1/clusters/bugs/world-save-corruption', { status: 'in_progress' }, s.fastn)).status, 200);
  assert.equal((await s.patch('/v1/clusters/bugs/world-save-corruption', { status: 'nope' }, s.fastn)).status, 400);
  assert.equal((await s.patch('/v1/clusters/meetings/x', { status: 'open' }, s.fastn)).status, 404);
  const sum = await s.get('/v1/export/summary?window=7d', s.fastn);
  assert.equal(sum.body.bugs[0].status, 'in_progress');
});

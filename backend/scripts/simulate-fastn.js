#!/usr/bin/env node
// Stand-in for the Fastn flows, for local demos. It does what Fastn does in production:
// pulls the mock Reddit/X APIs, classifies (keyword rules instead of an LLM), and POSTs to /v1/ingest/*,
// then builds a meeting, interview questions and a weekly report from /v1/export/summary.
//
//   BACKEND_URL=http://localhost:3000 FASTN_API_KEY=blockrealm-fastn-key MOCK_API_KEY=blockrealm-mock-key npm run simulate
import crypto from 'node:crypto';

const BASE = (process.env.BACKEND_URL || 'http://localhost:3000').replace(/\/$/, '');
const FASTN = { 'X-API-Key': process.env.FASTN_API_KEY || 'blockrealm-fastn-key', 'content-type': 'application/json' };
const MOCK = { 'X-Mock-Key': process.env.MOCK_API_KEY || 'blockrealm-mock-key' };
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const sha1 = (s) => crypto.createHash('sha1').update(s).digest('hex');

async function http(method, path, headers, body) {
  const res = await fetch(BASE + path, { method, headers, body: body && JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const BUGS = [
  ['world-save-corruption', 'Worlds fail to load after update', 'critical', 'world_save', 'world_engine', /corrupt|won't load|save/i],
  ['chunk-loading-crash', 'Crash when loading chunks', 'high', 'chunks', 'client', /chunk/i],
  ['multiplayer-lag-desync', 'Multiplayer lag and desync', 'high', 'netcode', 'backend', /\blag|rubber|desync/i],
  ['inventory-item-loss', 'Items vanish from inventory', 'high', 'inventory', 'backend', /(items?|diamonds).*(disappear|vanish|lost)|vanish/i],
  ['console-controller-input', 'Controller input stops working', 'medium', 'input', 'client', /controller/i],
  ['mobile-touch-controls', 'Touch controls miss taps', 'medium', 'input', 'client', /touch/i],
  ['shader-texture-flicker', 'Textures flicker with shaders', 'low', 'rendering', 'client', /flicker/i],
];
const FEATURES = [
  ['pets-that-follow-player', 'Pets that follow the player', 'mobs', 'gameplay', /\bpets?\b/i],
  ['boats-with-storage', 'Boats with storage', 'vehicles', 'gameplay', /boats?/i],
  ['new-biomes', 'New biomes', 'world_gen', 'world_engine', /biomes?/i],
  ['official-mod-support', 'Official mod support', 'platform', 'backend', /\bmod support|plugin api/i],
  ['better-villager-trades', 'Better villager trades', 'economy', 'gameplay', /villager|trad(e|ing)/i],
  ['cross-play', 'Cross-play PC and console', 'multiplayer', 'backend', /cross-?play/i],
];
const NEGATIVE = /crash|corrupt|lag|lost|vanish|disappear|broken|unusable|annoying|frustrat|done|uninstall|quit|flicker|miss/i;
const POSITIVE = /love|best|great|amazing|thank/i;

function classify(fb) {
  const t = fb.text;
  const categories = [];
  const bugRule = BUGS.find((b) => b[5].test(t));
  const featRule = FEATURES.find((f) => f[4].test(t)) && /add|please|need|would|feature|want|give|when/i.test(t) ? FEATURES.find((f) => f[4].test(t)) : null;
  const abandon = /abandon|start over|restart in a new world|new world/i.test(t);
  const quit = /uninstall|refund|i'm done|i am done|stop playing|switching to/i.test(t);
  if (bugRule) categories.push('bug');
  if (featRule) categories.push('feature_request');
  if (quit) categories.push('user_retention');
  if (abandon) categories.push('world_retention');
  if (POSITIVE.test(t) && !bugRule) categories.push('praise');
  if (!categories.length) categories.push('other');

  const retention = [];
  if (quit) retention.push({ type: 'user', cluster_key: 'quit-game-over-instability', signal: 'Player says they will uninstall or stop playing', risk: 'high' });
  if (abandon) retention.push({ type: 'world', cluster_key: 'abandon-world-after-corruption', signal: 'Player abandons or restarts their world', risk: 'high' });

  const sentiment = POSITIVE.test(t) ? 0.8 : NEGATIVE.test(t) ? (quit || abandon ? -0.85 : -0.5) : 0.1;
  return {
    feedback_id: fb.feedback_id, source: fb.source, source_url: fb.source_url, created_at: fb.created_at,
    author_hash: fb.author_hash, engagement: fb.engagement, game_version: fb.game_version, platform: fb.platform,
    excerpt: t.replace(/\s+/g, ' ').slice(0, 280), sentiment, confidence: 0.8,
    topics: [bugRule?.[0], featRule?.[0]].filter(Boolean).concat(fb.game_version ? [`v${fb.game_version.replace(/\./g, '-')}`] : []),
    categories,
    bug: bugRule ? { cluster_key: bugRule[0], title: bugRule[1], severity: bugRule[2], component: bugRule[3], team: bugRule[4], repro_hint: null } : null,
    feature: featRule ? { cluster_key: featRule[0], title: featRule[1], area: featRule[2], team: featRule[3] } : null,
    retention,
  };
}

const version = (t) => t.match(/\bv?(\d+\.\d+(\.\d+)?)\b/)?.[1] ?? null;
const platform = (t) => (/\b(pc|steam|windows)\b/i.test(t) ? 'pc' : /\b(console|xbox|playstation|switch)\b/i.test(t) ? 'console' : /\b(mobile|phone|ios|android)\b/i.test(t) ? 'mobile' : 'unknown');

async function pull(source) {
  const items = [];
  const path = source === 'reddit' ? '/mock/reddit/posts' : '/mock/x/posts';
  for (;;) {
    const page = await http('GET', `${path}?since=1970-01-01T00:00:00Z&limit=50`, MOCK);
    items.push(...page.items);
    if (page.items.length === 0) break; // the mock API caps pages at 50 and never repeats comments
  }
  return items.map((p) => {
    const text = (source === 'reddit' ? `${p.title}\n${p.body}` : p.text).slice(0, 4000);
    return {
      feedback_id: `${source}_${p.id}`, source, source_url: p.url, created_at: p.created_at, text,
      author_hash: sha256(source === 'reddit' ? p.author : p.author_handle),
      engagement: source === 'reddit' ? p.score + p.num_comments : p.likes + p.reposts,
      game_version: version(text), platform: platform(text),
    };
  });
}

const stats = { fetched: 0, accepted: 0, duplicates: 0, rejected: 0 };
async function push(path, items) {
  for (let i = 0; i < items.length; i += 50) {
    const r = await http('POST', `/v1/ingest/${path}`, FASTN, { items: items.slice(i, i + 50) });
    stats.accepted += r.accepted; stats.duplicates += r.duplicates; stats.rejected += r.rejected.length;
    r.rejected.forEach((x) => console.warn('rejected', path, x));
  }
}

const day = (d) => d.toISOString().slice(0, 10);
async function main() {
  for (const source of ['reddit', 'x']) {
    const posts = await pull(source);
    stats.fetched += posts.length;
    console.log(`${source}: fetched ${posts.length} new comments`);
    await push('classified', posts.map(classify));
  }

  const now = new Date();
  const summary = await http('GET', '/v1/export/summary?window=30d', FASTN);
  const top = (list) => list.slice(0, 3);
  const ts = now.toISOString().replace(/\.\d{3}Z$/, 'Z');

  // Flow D: one meeting per team for the biggest bug
  const b = summary.bugs[0];
  if (b) {
    const next = new Date(now.getTime() + 24 * 3600000);
    next.setUTCHours(5, 0, 0, 0); // 10:00 Asia/Karachi
    const end = new Date(next.getTime() + 30 * 60000);
    const iso = (d) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    await push('meetings', [{
      meeting_id: `${b.team}_${b.cluster_key}_${day(now).replaceAll('-', '')}`, team: b.team,
      title: `Triage: ${b.title} (${b.severity}, ${b.trend})`,
      trigger_reason: `${b.severity} severity + ${b.mention_count_window} mentions in 30d`,
      cluster_keys: [b.cluster_key],
      agenda: [{ item: 'Review evidence', context: `${b.mention_count_window} reports`, duration_min: 10 }, { item: 'Decide fix path', context: 'Hotfix vs next patch', duration_min: 15 }, { item: 'Player comms', context: 'Community update', duration_min: 5 }],
      discussion_points: ['Hotfix or rollback?', 'What do we tell players?'],
      scheduled_start: iso(next), scheduled_end: iso(end), attendee_emails: ['lead@studio.example'], calendar_event_id: null, calendar_link: null, slack_message_url: null, status: 'scheduled',
    }]);
  }

  // Flow E: a few interview questions
  const mk = (portfolio, question, type, difficulty, why, keys, signals) => ({ question_id: `${portfolio}_${sha1(question).slice(0, 12)}`, portfolio, question, why_it_matters: why, type, difficulty, expected_signals: signals, source_cluster_keys: keys, generated_at: ts });
  if (b) {
    await push('interview-questions', [
      mk('world_designer', `Players abandon worlds after "${b.title}". How would you design a recovery flow?`, 'scenario', 'mid', `Top bug this month (${b.mention_count_window} mentions).`, [b.cluster_key], ['mentions backups/versioning', 'considers player trust']),
      mk('qa_tester', `Write a regression plan for "${b.title}".`, 'technical', 'senior', `${b.mention_count_window} reports in 30d.`, [b.cluster_key], ['repro steps', 'automated save-load tests']),
      mk('data_analyst', 'Which metrics would prove the fix reduced churn?', 'product', 'mid', 'Retention risk is rising.', top(summary.retention).map((r) => r.cluster_key).length ? top(summary.retention).map((r) => r.cluster_key) : [b.cluster_key], ['cohort retention', 'before/after comparison']),
    ]);
  }

  // Flow F: weekly report
  const start = new Date(now.getTime() - 6 * 24 * 3600000);
  await push('reports', [{
    report_id: `weekly_${day(now)}`, period: 'weekly', period_start: `${day(start)}T00:00:00Z`, period_end: `${day(now)}T23:59:59Z`,
    headline: b ? `${b.title} is the #1 issue this week` : 'No issues reported',
    highlights: [`${summary.totals.feedback} feedback items in 30d`, ...top(summary.features).map((f) => `${f.title}: ${f.mention_count_window} requests`)].slice(0, 5),
    risks: top(summary.retention).map((r) => `${r.signal} (${r.mention_count_window} mentions, risk ${r.risk})`).slice(0, 4),
    recommendations: top(summary.bugs).map((x) => ({ action: `Fix: ${x.title}`, team: x.team, impact: x.severity === 'critical' || x.severity === 'high' ? 'high' : 'medium' })),
    generated_at: ts,
  }]);

  console.log('done', stats);
}

main().catch((e) => { console.error(e.message); process.exit(1); });

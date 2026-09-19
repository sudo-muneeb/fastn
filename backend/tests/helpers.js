import { createApp } from '../src/app.js';
import { Store } from '../src/store.js';

export const NOW = new Date('2026-09-19T12:00:00Z');
export const KEYS = { fastn: 'test-fastn', mock: 'test-mock' };

export async function startServer({ mockUnique = true, now = NOW } = {}) {
  const config = { port: 0, fastnApiKey: KEYS.fastn, mockApiKey: KEYS.mock, corsOrigin: '*', dataFile: null, mockUnique, frontendDir: new URL('../../frontend/public', import.meta.url).pathname, publicApiUrl: '' };
  const app = createApp({ config, store: new Store(), now: () => now });
  const server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, path, { body, headers = {} } = {}) => {
    const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) });
    return { status: res.status, body: await res.json() };
  };
  const fastn = { 'X-API-Key': KEYS.fastn };
  const mock = { 'X-Mock-Key': KEYS.mock };
  return {
    base,
    close: () => new Promise((r) => server.close(r)),
    get: (p, h) => call('GET', p, { headers: h }),
    post: (p, body, h) => call('POST', p, { body, headers: h }),
    patch: (p, body, h) => call('PATCH', p, { body, headers: h }),
    fastn,
    mock,
  };
}

export const hoursAgo = (h) => new Date(NOW.getTime() - h * 3600000).toISOString().replace(/\.\d{3}Z$/, 'Z');

export function classified(overrides = {}) {
  return {
    feedback_id: 'reddit_t3_a1b2c3',
    source: 'reddit',
    source_url: 'https://reddit.com/r/BlockRealm/comments/a1b2c3',
    created_at: hoursAgo(2),
    author_hash: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    engagement: 179,
    game_version: '1.4.2',
    platform: 'pc',
    excerpt: "My survival world won't load since v1.4.2",
    sentiment: -0.72,
    confidence: 0.91,
    topics: ['world-save', 'update-1-4-2'],
    categories: ['bug', 'world_retention'],
    bug: { cluster_key: 'world-save-corruption', title: 'Worlds fail to load after update', severity: 'critical', component: 'world_save', team: 'world_engine', repro_hint: 'Open pre-1.4.2 survival world' },
    feature: null,
    retention: [{ type: 'world', cluster_key: 'abandon-world-after-corruption', signal: 'Player says they will stop playing this world', risk: 'high' }],
    ...overrides,
  };
}

export const bugItem = (id, hours, extra = {}) => classified({ feedback_id: `reddit_${id}`, created_at: hoursAgo(hours), ...extra });
export const featureItem = (id, hours) => classified({
  feedback_id: `x_${id}`, source: 'x', created_at: hoursAgo(hours), categories: ['feature_request'], bug: null, retention: [], sentiment: 0.4,
  feature: { cluster_key: 'pets-that-follow-player', title: 'Pets that follow the player', area: 'mobs', team: 'gameplay' },
});

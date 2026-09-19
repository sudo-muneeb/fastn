import { Router } from 'express';
import { requireMockKey } from '../lib/auth.js';
import { validationError } from '../lib/errors.js';
import { isIso } from '../lib/validate.js';
import { REDDIT_COMMENTS, X_COMMENTS } from '../data/mockComments.js';

const HOUR = 3600000;
const MAX_LIMIT = 50; // hard cap per request; larger `limit` values are clamped, not rejected

export function mockRoutes({ store, config, now }) {
  const r = Router();
  r.use(requireMockKey(config));
  const startedAt = now().getTime();
  const at = (h) => new Date(startedAt - h * HOUR).toISOString().replace(/\.\d{3}Z$/, 'Z');

  const sources = {
    reddit: {
      data: REDDIT_COMMENTS,
      shape: ({ hours_ago, ...c }) => ({ ...c, url: `https://reddit.com/r/${c.subreddit}/comments/${c.id.replace('t3_', '')}`, created_at: at(hours_ago) }),
    },
    x: {
      data: X_COMMENTS,
      shape: ({ hours_ago, ...c }) => ({ ...c, url: `https://x.com/${c.author_handle.replace('@', '')}/status/${c.id}`, created_at: at(hours_ago) }),
    },
  };

  function serve(name, req, res) {
    const { data, shape } = sources[name];
    const since = req.query.since ?? '1970-01-01T00:00:00Z';
    const limit = req.query.limit === undefined ? MAX_LIMIT : Number(req.query.limit);
    if (!isIso(since)) throw validationError('since must be an ISO-8601 UTC timestamp', [{ index: 0, field: 'since', issue: 'invalid timestamp' }]);
    if (!Number.isInteger(limit) || limit < 1) throw validationError('limit must be an integer >= 1', [{ index: 0, field: 'limit', issue: 'must be an integer >= 1 (values above 50 are capped at 50)' }]);
    const peek = req.query.peek === 'true';

    const items = data.map(shape)
      .filter((c) => c.created_at > since && !(config.mockUnique && store.has('mock_served', `${name}:${c.id}`)))
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .slice(0, Math.min(limit, MAX_LIMIT));

    if (config.mockUnique && !peek) for (const c of items) store.set('mock_served', `${name}:${c.id}`, true);
    res.json({ items, next_since: items.length ? items[items.length - 1].created_at : since });
  }

  r.get('/reddit/posts', (req, res) => serve('reddit', req, res));
  r.get('/x/posts', (req, res) => serve('x', req, res));

  // Make every comment available again (optionally only one source: ?source=reddit)
  r.post('/reset', (req, res) => {
    const only = req.query.source;
    let cleared = 0;
    for (const key of [...store.col('mock_served').keys()]) {
      if (!only || key.startsWith(`${only}:`)) { store.delete('mock_served', key); cleared++; }
    }
    res.json({ reset: cleared });
  });

  r.get('/status', (req, res) => {
    const served = (n) => [...store.col('mock_served').keys()].filter((k) => k.startsWith(`${n}:`)).length;
    res.json({
      unique_mode: config.mockUnique,
      reddit: { total: REDDIT_COMMENTS.length, served: served('reddit') },
      x: { total: X_COMMENTS.length, served: served('x') },
    });
  });
  return r;
}

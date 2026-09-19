import { Router } from 'express';
import { requireFastnKey } from '../lib/auth.js';
import { validationError } from '../lib/errors.js';
import { buildClusters, parseWindow, totalsOf, windowFeedback } from '../lib/aggregate.js';

const TYPE_TO_KIND = { bug: 'bugs', feature_request: 'features', retention: 'retention' };

export function exportRoutes({ store, now, config }) {
  const r = Router();
  r.use(requireFastnKey(config));
  const statuses = () => new Map([...store.col('cluster_status')]);

  r.get('/clusters', (req, res) => {
    const kind = TYPE_TO_KIND[req.query.type];
    if (!kind) throw validationError('type must be bug|feature_request|retention', [{ index: 0, field: 'type', issue: 'must be bug|feature_request|retention' }]);
    const limit = req.query.limit === undefined ? 200 : Number(req.query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw validationError('limit must be 1..200', [{ index: 0, field: 'limit', issue: 'must be 1..200' }]);
    const clusters = buildClusters(kind, store.values('processed_feedback'), statuses(), now(), 30)
      .sort((a, b) => b.mention_count - a.mention_count)
      .slice(0, limit)
      .map((c) => ({ cluster_key: c.cluster_key, title: c.title ?? c.signal, mention_count: c.mention_count }));
    res.json({ type: req.query.type, clusters });
  });

  r.get('/summary', (req, res) => {
    const w = req.query.window ?? '7d';
    if (!['7d', '30d'].includes(w)) throw validationError('window must be 7d|30d', [{ index: 0, field: 'window', issue: 'must be 7d|30d' }]);
    const days = parseWindow(w);
    const at = now();
    const all = store.values('processed_feedback');
    const totals = totalsOf(windowFeedback(all, at, days));
    const pick = (kind) => buildClusters(kind, all, statuses(), at, days).filter((c) => c.mention_count_window > 0).slice(0, 25);
    const strip = ({ first_seen_at, last_seen_at, game_versions, platforms, engagement_total, component, ...c }) => ({ ...c, sample_excerpts: c.sample_excerpts.map((s) => s.excerpt) });
    const open_meetings = store.values('meetings')
      .filter((m) => m.status === 'scheduled' && Date.parse(m.scheduled_end) >= at.getTime())
      .map(({ meeting_id, team, cluster_keys, scheduled_start }) => ({ meeting_id, team, cluster_keys, scheduled_start }));
    res.json({
      window: w,
      generated_at: at.toISOString(),
      totals: { feedback: totals.feedback, by_source: totals.by_source, by_category: totals.by_category, avg_sentiment: totals.avg_sentiment },
      bugs: pick('bugs').map(strip),
      features: pick('features').map(strip),
      retention: pick('retention').map(strip),
      open_meetings,
    });
  });
  return r;
}

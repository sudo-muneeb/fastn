import { Router } from 'express';
import { validationError } from '../lib/errors.js';
import { ENUMS } from '../lib/validate.js';
import { buildClusters, buildDaily, totalsOf, windowFeedback } from '../lib/aggregate.js';

const DAYS = [7, 14, 30, 90];

/** Public, read-only endpoint feeding the frontend. Never exposes raw feedback text beyond excerpts. */
export function dashboardRoutes({ store, now }) {
  const r = Router();
  r.get('/dashboard', (req, res) => {
    const days = req.query.days === undefined ? 30 : Number(req.query.days);
    if (!DAYS.includes(days)) throw validationError(`days must be one of ${DAYS.join('|')}`, [{ index: 0, field: 'days', issue: `must be one of ${DAYS.join('|')}` }]);
    const portfolio = req.query.portfolio;
    if (portfolio !== undefined && !ENUMS.portfolio.includes(portfolio)) throw validationError('Invalid portfolio', [{ index: 0, field: 'portfolio', issue: `must be one of ${ENUMS.portfolio.join('|')}` }]);

    const at = now();
    const all = store.values('processed_feedback');
    const statuses = new Map([...store.col('cluster_status')]);
    const totals = totalsOf(windowFeedback(all, at, days));
    const bugs = buildClusters('bugs', all, statuses, at, days).slice(0, 50);
    const features = buildClusters('features', all, statuses, at, days).slice(0, 50);
    const retention = buildClusters('retention', all, statuses, at, days).slice(0, 50);
    const byNewest = (field) => (a, b) => b[field].localeCompare(a[field]);
    const meetings = store.values('meetings').sort(byNewest('scheduled_start')).slice(0, 20);
    const questions = store.values('interview_questions').filter((q) => !portfolio || q.portfolio === portfolio).sort(byNewest('generated_at')).slice(0, 100);
    const reports = store.values('reports').sort(byNewest('period_end')).slice(0, 10);

    res.json({
      generated_at: at.toISOString(),
      window_days: days,
      totals: {
        feedback: totals.feedback,
        avg_sentiment: totals.avg_sentiment,
        open_bugs: bugs.filter((b) => b.status === 'open' && b.mention_count_window > 0).length,
        critical_bugs: bugs.filter((b) => b.severity === 'critical' && b.mention_count_window > 0).length,
        feature_requests: features.filter((f) => f.mention_count_window > 0).length,
        high_risk_retention: retention.filter((x) => x.risk === 'high' && x.mention_count_window > 0).length,
        upcoming_meetings: meetings.filter((m) => m.status === 'scheduled' && Date.parse(m.scheduled_end) >= at.getTime()).length,
      },
      by_source: totals.by_source,
      by_category: totals.by_category,
      by_platform: totals.by_platform,
      by_version: totals.by_version,
      top_topics: totals.top_topics,
      daily: buildDaily(all, at, days),
      bugs,
      features,
      retention,
      meetings,
      interview_questions: questions,
      reports,
    });
  });
  return r;
}

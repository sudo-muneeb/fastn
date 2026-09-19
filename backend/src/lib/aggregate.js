import { ENUMS, SEVERITY_RANK, RISK_RANK } from './validate.js';

const DAY = 86400000;
const zero = (keys) => Object.fromEntries(keys.map((k) => [k, 0]));
const bump = (obj, k, n = 1) => { obj[k] = (obj[k] || 0) + n; };
const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export const parseWindow = (w) => (w === '30d' ? 30 : 7);

export function trendOf(all, win, prev) {
  if (all === win) return 'new'; // nothing before this window
  if (prev === 0) return win > 0 ? 'rising' : 'stable';
  const change = (win - prev) / prev;
  if (change >= 0.25) return 'rising';
  if (change <= -0.25) return 'falling';
  return 'stable';
}

/**
 * Builds cluster docs (bugs | features | retention) from processed feedback.
 * Window stats are relative to `now` and `days`; trend compares against the previous equal window.
 */
export function buildClusters(kind, feedback, statuses, now, days) {
  const end = now.getTime();
  const start = end - days * DAY;
  const prevStart = start - days * DAY;
  const map = new Map();

  for (const fb of feedback) {
    const t = Date.parse(fb.created_at);
    if (t > end) continue;
    const entries = kind === 'bugs' ? (fb.bug ? [fb.bug] : []) : kind === 'features' ? (fb.feature ? [fb.feature] : []) : fb.retention;
    for (const e of entries) {
      let c = map.get(e.cluster_key);
      if (!c) {
        c = { cluster_key: e.cluster_key, mention_count: 0, mention_count_window: 0, _prev: 0, sources: zero(ENUMS.source), platforms: zero(ENUMS.platform), game_versions: {}, engagement_total: 0, _samples: [], first_seen_at: fb.created_at, last_seen_at: fb.created_at, _latest: -1 };
        map.set(e.cluster_key, c);
      }
      c.mention_count++;
      c.engagement_total += fb.engagement;
      if (fb.created_at < c.first_seen_at) c.first_seen_at = fb.created_at;
      if (fb.created_at > c.last_seen_at) c.last_seen_at = fb.created_at;
      if (t > c._latest) { // latest mention wins for descriptive fields
        c._latest = t;
        if (kind === 'retention') { c.type = e.type; c.signal = e.signal; } else { c.title = e.title; c.team = e.team; }
        if (kind === 'bugs') c.component = e.component;
        if (kind === 'features') c.area = e.area;
      }
      if (kind === 'bugs') c.severity = !c.severity || SEVERITY_RANK[e.severity] > SEVERITY_RANK[c.severity] ? e.severity : c.severity;
      if (kind === 'retention') c.risk = !c.risk || RISK_RANK[e.risk] > RISK_RANK[c.risk] ? e.risk : c.risk;

      if (t > start) {
        c.mention_count_window++;
        c.sources[fb.source]++;
        c.platforms[fb.platform]++;
        if (fb.game_version) bump(c.game_versions, fb.game_version);
        c._samples.push({ excerpt: fb.excerpt, source: fb.source, source_url: fb.source_url, created_at: fb.created_at });
      } else if (t > prevStart) c._prev++;
    }
  }

  const docs = [...map.values()].map((c) => {
    const { _prev, _samples, _latest, ...doc } = c;
    doc.trend = trendOf(c.mention_count, c.mention_count_window, _prev);
    doc.sample_excerpts = _samples.sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5);
    if (kind !== 'retention') doc.status = statuses.get(`${kind}:${c.cluster_key}`) || 'open';
    if (kind !== 'bugs') { delete doc.platforms; if (kind === 'retention') { delete doc.game_versions; delete doc.engagement_total; } }
    if (kind === 'features') delete doc.game_versions;
    return doc;
  });
  return docs.sort((a, b) => b.mention_count_window - a.mention_count_window || b.mention_count - a.mention_count);
}

/** Continuous per-day analytics (analytics_daily shape) for the last `days` days, oldest first. */
export function buildDaily(feedback, now, days) {
  const byDate = new Map();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now.getTime() - i * DAY).toISOString().slice(0, 10);
    byDate.set(date, { date, feedback_count: 0, by_source: zero(ENUMS.source), by_category: zero(ENUMS.category), sentiment_sum: 0, sentiment_avg: 0, _topics: {}, by_platform: zero(ENUMS.platform), by_version: {} });
  }
  for (const fb of feedback) {
    const d = byDate.get(fb.created_at.slice(0, 10));
    if (!d || Date.parse(fb.created_at) > now.getTime()) continue;
    d.feedback_count++;
    d.by_source[fb.source]++;
    for (const c of fb.categories) d.by_category[c]++;
    d.sentiment_sum += fb.sentiment;
    d.by_platform[fb.platform]++;
    if (fb.game_version) bump(d.by_version, fb.game_version);
    for (const t of fb.topics) bump(d._topics, t);
  }
  return [...byDate.values()].map(({ _topics, ...d }) => ({
    ...d,
    sentiment_sum: round(d.sentiment_sum),
    sentiment_avg: d.feedback_count ? round(d.sentiment_sum / d.feedback_count) : 0,
    top_topics: topTopics(_topics, 10),
  }));
}

export const topTopics = (counts, n) =>
  Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n).map(([topic, count]) => ({ topic, count }));

export function windowFeedback(feedback, now, days) {
  const end = now.getTime();
  const start = end - days * DAY;
  return feedback.filter((f) => { const t = Date.parse(f.created_at); return t > start && t <= end; });
}

export function totalsOf(items) {
  const by_source = zero(ENUMS.source);
  const by_category = zero(ENUMS.category);
  const by_platform = zero(ENUMS.platform);
  const by_version = {};
  const topics = {};
  let sum = 0;
  for (const f of items) {
    by_source[f.source]++;
    for (const c of f.categories) by_category[c]++;
    by_platform[f.platform]++;
    if (f.game_version) bump(by_version, f.game_version);
    for (const t of f.topics) bump(topics, t);
    sum += f.sentiment;
  }
  return { feedback: items.length, by_source, by_category, by_platform, by_version, avg_sentiment: items.length ? round(sum / items.length) : 0, top_topics: topTopics(topics, 10) };
}

/** Feedback inside the dashboard's calendar-day buckets (same range as buildDaily), so totals equal the sum of the daily chart. */
export function calendarWindowFeedback(feedback, now, days) {
  const d = new Date(now);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - (days - 1) * DAY;
  return feedback.filter((f) => { const t = Date.parse(f.created_at); return t >= start && t <= now.getTime(); });
}

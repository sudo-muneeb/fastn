export const ENUMS = {
  source: ['reddit', 'x', 'forms'],
  category: ['bug', 'feature_request', 'user_retention', 'world_retention', 'praise', 'other'],
  severity: ['low', 'medium', 'high', 'critical'],
  risk: ['low', 'medium', 'high'],
  retention_type: ['user', 'world'],
  platform: ['pc', 'console', 'mobile', 'unknown'],
  team: ['gameplay', 'world_engine', 'backend', 'client', 'community', 'qa'],
  portfolio: ['gameplay_designer', 'world_designer', 'backend_engineer', 'client_engineer', 'qa_tester', 'community_manager', 'data_analyst', 'product_manager'],
  difficulty: ['junior', 'mid', 'senior'],
  question_type: ['technical', 'product', 'scenario', 'behavioral'],
  status: ['open', 'in_progress', 'resolved', 'wont_fix'],
  meeting_status: ['scheduled', 'cancelled', 'done'],
  period: ['weekly', 'daily'],
};
export const CLUSTER_KEY_RE = /^[a-z0-9]+(-[a-z0-9]+){0,7}$/;
export const SEVERITY_RANK = { low: 1, medium: 2, high: 3, critical: 4 };
export const RISK_RANK = { low: 1, medium: 2, high: 3 };

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
export const isIso = (s) => typeof s === 'string' && ISO_RE.test(s) && !Number.isNaN(Date.parse(s));

/** Collects issues as { field, issue }. */
export class Checker {
  constructor() { this.issues = []; }
  add(field, issue) { this.issues.push({ field, issue }); }
  get ok() { return this.issues.length === 0; }
  message() { return this.issues.map((i) => `${i.field}: ${i.issue}`).join('; '); }

  object(v, field) {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) { this.add(field, 'must be an object'); return false; }
    return true;
  }
  noExtra(obj, allowed, prefix = '') {
    for (const k of Object.keys(obj)) if (!allowed.includes(k)) this.add(prefix + k, 'unknown field');
  }
  str(v, field, { max = 500, optional = false, nullable = false } = {}) {
    if (v === undefined && optional) return;
    if (v === null && nullable) return;
    if (typeof v !== 'string' || v.trim() === '') return this.add(field, 'must be a non-empty string');
    if (v.length > max) this.add(field, `must be at most ${max} chars`);
  }
  enum(v, values, field) {
    if (!values.includes(v)) this.add(field, `must be one of ${values.join('|')}`);
  }
  int(v, field, min = 0) {
    if (!Number.isInteger(v) || v < min) this.add(field, `must be an integer >= ${min}`);
  }
  num(v, field, min, max) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) this.add(field, `must be a number in [${min}, ${max}]`);
  }
  iso(v, field) { if (!isIso(v)) this.add(field, 'must be an ISO-8601 UTC timestamp like 2026-09-19T10:00:00Z'); }
  key(v, field) { if (typeof v !== 'string' || !CLUSTER_KEY_RE.test(v)) this.add(field, `must match ${CLUSTER_KEY_RE}`); }
  strArray(v, field, { min = 0, max = 50, itemMax = 300 } = {}) {
    if (!Array.isArray(v)) return this.add(field, 'must be an array of strings');
    if (v.length < min) this.add(field, `must have at least ${min} item(s)`);
    if (v.length > max) this.add(field, `must have at most ${max} item(s)`);
    v.forEach((s, i) => this.str(s, `${field}[${i}]`, { max: itemMax }));
  }
}

export function validateClassified(item) {
  const c = new Checker();
  if (!c.object(item, 'item')) return c;
  const top = ['feedback_id', 'source', 'source_url', 'created_at', 'author_hash', 'engagement', 'game_version', 'platform', 'excerpt', 'sentiment', 'confidence', 'topics', 'categories', 'bug', 'feature', 'retention'];
  c.noExtra(item, top);
  c.str(item.feedback_id, 'feedback_id', { max: 200 });
  c.enum(item.source, ENUMS.source, 'source');
  if (typeof item.feedback_id === 'string' && ENUMS.source.includes(item.source) && !item.feedback_id.startsWith(`${item.source}_`)) {
    c.add('feedback_id', `must start with "${item.source}_"`);
  }
  c.str(item.source_url, 'source_url', { max: 1000 });
  c.iso(item.created_at, 'created_at');
  c.str(item.author_hash, 'author_hash', { max: 128 });
  c.int(item.engagement, 'engagement');
  c.str(item.game_version, 'game_version', { max: 40, nullable: true });
  c.enum(item.platform, ENUMS.platform, 'platform');
  c.str(item.excerpt, 'excerpt', { max: 280 });
  c.num(item.sentiment, 'sentiment', -1, 1);
  c.num(item.confidence, 'confidence', 0, 1);
  c.strArray(item.topics, 'topics', { max: 20, itemMax: 80 });

  const cats = Array.isArray(item.categories) ? item.categories : null;
  if (!cats || cats.length === 0) c.add('categories', 'must be a non-empty array');
  else {
    cats.forEach((v, i) => c.enum(v, ENUMS.category, `categories[${i}]`));
    if (new Set(cats).size !== cats.length) c.add('categories', 'must not contain duplicates');
  }
  const has = (x) => !!cats?.includes(x);

  if (has('bug')) {
    if (c.object(item.bug, 'bug')) {
      c.noExtra(item.bug, ['cluster_key', 'title', 'severity', 'component', 'team', 'repro_hint'], 'bug.');
      c.key(item.bug.cluster_key, 'bug.cluster_key');
      c.str(item.bug.title, 'bug.title', { max: 200 });
      c.enum(item.bug.severity, ENUMS.severity, 'bug.severity');
      c.str(item.bug.component, 'bug.component', { max: 80 });
      c.enum(item.bug.team, ENUMS.team, 'bug.team');
      c.str(item.bug.repro_hint, 'bug.repro_hint', { max: 300, optional: true, nullable: true });
    }
  } else if (item.bug !== null) c.add('bug', 'must be null unless categories includes bug');

  if (has('feature_request')) {
    if (c.object(item.feature, 'feature')) {
      c.noExtra(item.feature, ['cluster_key', 'title', 'area', 'team'], 'feature.');
      c.key(item.feature.cluster_key, 'feature.cluster_key');
      c.str(item.feature.title, 'feature.title', { max: 200 });
      c.str(item.feature.area, 'feature.area', { max: 80 });
      c.enum(item.feature.team, ENUMS.team, 'feature.team');
    }
  } else if (item.feature !== null) c.add('feature', 'must be null unless categories includes feature_request');

  if (has('user_retention') || has('world_retention')) {
    if (!Array.isArray(item.retention) || item.retention.length === 0) c.add('retention', 'must be a non-empty array');
    else item.retention.forEach((r, i) => {
      const p = `retention[${i}]`;
      if (!c.object(r, p)) return;
      c.noExtra(r, ['type', 'cluster_key', 'signal', 'risk'], `${p}.`);
      c.enum(r.type, ENUMS.retention_type, `${p}.type`);
      c.key(r.cluster_key, `${p}.cluster_key`);
      c.str(r.signal, `${p}.signal`, { max: 300 });
      c.enum(r.risk, ENUMS.risk, `${p}.risk`);
    });
  } else if (!Array.isArray(item.retention) || item.retention.length !== 0) c.add('retention', 'must be [] unless categories includes user_retention/world_retention');
  return c;
}

export function validateQuestion(item) {
  const c = new Checker();
  if (!c.object(item, 'item')) return c;
  c.noExtra(item, ['question_id', 'portfolio', 'question', 'why_it_matters', 'type', 'difficulty', 'expected_signals', 'source_cluster_keys', 'generated_at']);
  c.enum(item.portfolio, ENUMS.portfolio, 'portfolio');
  if (typeof item.question_id !== 'string' || !new RegExp(`^${item.portfolio}_[0-9a-f]{12}$`).test(item.question_id)) c.add('question_id', 'must be {portfolio}_{12 hex chars}');
  c.str(item.question, 'question', { max: 1000 });
  c.str(item.why_it_matters, 'why_it_matters', { max: 600 });
  c.enum(item.type, ENUMS.question_type, 'type');
  c.enum(item.difficulty, ENUMS.difficulty, 'difficulty');
  c.strArray(item.expected_signals, 'expected_signals', { min: 1, max: 8 });
  if (!Array.isArray(item.source_cluster_keys)) c.add('source_cluster_keys', 'must be an array');
  else item.source_cluster_keys.forEach((k, i) => c.key(k, `source_cluster_keys[${i}]`));
  c.iso(item.generated_at, 'generated_at');
  return c;
}

export function validateMeeting(item) {
  const c = new Checker();
  if (!c.object(item, 'item')) return c;
  c.noExtra(item, ['meeting_id', 'team', 'title', 'trigger_reason', 'cluster_keys', 'agenda', 'discussion_points', 'scheduled_start', 'scheduled_end', 'attendee_emails', 'calendar_event_id', 'calendar_link', 'slack_message_url', 'status']);
  c.str(item.meeting_id, 'meeting_id', { max: 300 });
  c.enum(item.team, ENUMS.team, 'team');
  if (typeof item.meeting_id === 'string' && ENUMS.team.includes(item.team) && !item.meeting_id.startsWith(`${item.team}_`)) c.add('meeting_id', `must start with "${item.team}_"`);
  c.str(item.title, 'title', { max: 200 });
  c.str(item.trigger_reason, 'trigger_reason', { max: 500 });
  if (!Array.isArray(item.cluster_keys) || item.cluster_keys.length === 0) c.add('cluster_keys', 'must be a non-empty array');
  else item.cluster_keys.forEach((k, i) => c.key(k, `cluster_keys[${i}]`));
  if (!Array.isArray(item.agenda) || item.agenda.length === 0) c.add('agenda', 'must be a non-empty array');
  else item.agenda.forEach((a, i) => {
    const p = `agenda[${i}]`;
    if (!c.object(a, p)) return;
    c.noExtra(a, ['item', 'context', 'duration_min'], `${p}.`);
    c.str(a.item, `${p}.item`, { max: 200 });
    c.str(a.context, `${p}.context`, { max: 500 });
    c.int(a.duration_min, `${p}.duration_min`, 1);
  });
  c.strArray(item.discussion_points, 'discussion_points', { min: 1, max: 10, itemMax: 400 });
  c.iso(item.scheduled_start, 'scheduled_start');
  c.iso(item.scheduled_end, 'scheduled_end');
  if (isIso(item.scheduled_start) && isIso(item.scheduled_end) && Date.parse(item.scheduled_end) <= Date.parse(item.scheduled_start)) c.add('scheduled_end', 'must be after scheduled_start');
  c.strArray(item.attendee_emails, 'attendee_emails', { max: 100 });
  if (Array.isArray(item.attendee_emails)) item.attendee_emails.forEach((e, i) => { if (typeof e === 'string' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) c.add(`attendee_emails[${i}]`, 'must be an email'); });
  for (const f of ['calendar_event_id', 'calendar_link', 'slack_message_url']) c.str(item[f], f, { max: 1000, optional: true, nullable: true });
  c.enum(item.status, ENUMS.meeting_status, 'status');
  return c;
}

export function validateReport(item) {
  const c = new Checker();
  if (!c.object(item, 'item')) return c;
  c.noExtra(item, ['report_id', 'period', 'period_start', 'period_end', 'headline', 'highlights', 'risks', 'recommendations', 'generated_at']);
  c.enum(item.period, ENUMS.period, 'period');
  if (typeof item.report_id !== 'string' || !new RegExp(`^${item.period}_\\d{4}-\\d{2}-\\d{2}$`).test(item.report_id)) c.add('report_id', 'must be {period}_{YYYY-MM-DD}');
  c.iso(item.period_start, 'period_start');
  c.iso(item.period_end, 'period_end');
  c.str(item.headline, 'headline', { max: 300 });
  c.strArray(item.highlights, 'highlights', { min: 1, max: 10, itemMax: 500 });
  c.strArray(item.risks, 'risks', { max: 10, itemMax: 500 });
  if (!Array.isArray(item.recommendations)) c.add('recommendations', 'must be an array');
  else item.recommendations.forEach((r, i) => {
    const p = `recommendations[${i}]`;
    if (!c.object(r, p)) return;
    c.noExtra(r, ['action', 'team', 'impact'], `${p}.`);
    c.str(r.action, `${p}.action`, { max: 500 });
    c.enum(r.team, ENUMS.team, `${p}.team`);
    c.enum(r.impact, ENUMS.risk, `${p}.impact`);
  });
  c.iso(item.generated_at, 'generated_at');
  return c;
}

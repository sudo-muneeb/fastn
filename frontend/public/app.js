const API = (window.BR_CONFIG && window.BR_CONFIG.API_URL) || 'http://localhost:3000';
const $ = (s) => document.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const label = (s) => esc(String(s).replace(/_/g, ' '));
const safeUrl = (u) => (/^https?:\/\//i.test(u || '') ? esc(u) : '');
const fmtDate = (iso) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const SRC = { reddit: '#ff6a2b', x: '#e8e8e8', forms: '#7d5ba6' };
const CAT = { bug: '#d13b3b', feature_request: '#3e8be0', user_retention: '#e8892b', world_retention: '#9b5de5', praise: '#4fbf4f', other: '#7f7f7f' };
const PLAT = { pc: '#3e8be0', console: '#9b5de5', mobile: '#4fbf4f', unknown: '#7f7f7f' };

const TABS = [
  ['overview', '🗺️', 'Overview'], ['bugs', '👹', 'Bugs'], ['features', '📜', 'Features'], ['retention', '🍖', 'Retention'],
  ['meetings', '🔥', 'Meetings'], ['interviews', '🎓', 'Interviews'], ['reports', '📖', 'Reports'],
];
let state = { tab: location.hash.slice(1) || 'overview', data: null, portfolio: 'all', days: 30 };
if (!TABS.some((t) => t[0] === state.tab)) state.tab = 'overview';

/* ---------- reusable pieces ---------- */
const stat = (ico, val, lbl, cls = '') => `<div class="stat ${cls}"><span class="ico">${ico}</span><span class="val">${esc(val)}</span><span class="lbl">${esc(lbl)}</span></div>`;
const panel = (title, body) => `<section class="panel"><h2>${esc(title)}</h2>${body}</section>`;

function barRows(counts, colors) {
  const entries = Object.entries(counts).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '<p class="sub">No data in this range.</p>';
  const max = Math.max(...entries.map(([, n]) => n));
  return `<div class="rows">${entries.map(([k, n]) => `<div class="row"><span>${label(k)}</span><div class="bar" style="--c:${colors?.[k] || 'var(--green)'}"><i style="width:${(n / max) * 100}%"></i></div><span class="n">${n}</span></div>`).join('')}</div>`;
}

function hearts(avg) { // sentiment -1..1 -> 0..10 half-hearts
  const full = Math.round(((avg + 1) / 2) * 10);
  return `<span class="hearts" title="avg sentiment ${avg}" aria-label="sentiment ${avg}">${Array.from({ length: 10 }, (_, i) => `<span class="${i < full ? 'h-on' : 'h-off'}">♥</span>`).join('')}</span>`;
}

function dailyChart(daily, keys, colors, field) {
  const max = Math.max(1, ...daily.map((d) => d.feedback_count));
  const cols = daily.map((d) => {
    const segs = keys.map((k) => `<i style="height:${(d[field][k] / max) * 100}%;--c:${colors[k]}"></i>`).join('');
    const tip = `${d.date}: ${d.feedback_count} feedback` + keys.map((k) => ` · ${k} ${d[field][k]}`).join('');
    return `<div class="col" title="${esc(tip)}">${segs}</div>`;
  }).join('');
  const legend = keys.map((k) => `<span style="--c:${colors[k]}">${label(k)}</span>`).join('');
  return `<div class="chart" role="img" aria-label="Feedback per day">${cols}</div><div class="axis"><span>${esc(daily[0]?.date)}</span><span>max ${max}/day</span><span>${esc(daily.at(-1)?.date)}</span></div><div class="legend">${legend}</div>`;
}

const trendTag = (t) => `<span class="tag trend-${esc(t)}" style="--c:var(--c)">${esc(t === 'rising' ? '▲ rising' : t === 'falling' ? '▼ falling' : t)}</span>`;
const sourceTags = (s) => Object.entries(s).filter(([, n]) => n).map(([k, n]) => `<span class="tag" style="--c:${SRC[k]};${k === 'x' ? 'color:#111;text-shadow:none' : ''}">${esc(k)} ${n}</span>`).join('');
function excerpts(list) {
  if (!list?.length) return '';
  return `<details><summary>${list.length} player quote${list.length > 1 ? 's' : ''}</summary>${list.map((e) => `<blockquote class="quote">${esc(e.excerpt)} ${safeUrl(e.source_url) ? `<a href="${safeUrl(e.source_url)}" target="_blank" rel="noopener noreferrer">↗ ${esc(e.source)}</a>` : ''}</blockquote>`).join('')}</details>`;
}

/* ---------- views ---------- */
function overview(d) {
  const t = d.totals;
  return `
  <div class="grid g-stats">
    ${stat('💬', t.feedback, 'Feedback collected')}
    ${stat('👹', t.open_bugs, 'Open bug mobs', t.open_bugs ? 'warn' : 'good')}
    ${stat('💀', t.critical_bugs, 'Critical bugs', t.critical_bugs ? 'bad' : 'good')}
    ${stat('📜', t.feature_requests, 'Feature quests')}
    ${stat('🍖', t.high_risk_retention, 'High churn risks', t.high_risk_retention ? 'bad' : 'good')}
    ${stat('🔥', t.upcoming_meetings, 'Upcoming meetings')}
  </div>
  ${panel('Feedback per day', dailyChart(d.daily, Object.keys(SRC), SRC, 'by_source'))}
  <div class="grid g-2">
    ${panel('Player mood', `<p>${hearts(t.avg_sentiment)}</p><p class="sub">Average sentiment ${t.avg_sentiment} (−1 grumpy … +1 delighted)</p>`)}
    ${panel('By source', barRows(d.by_source, SRC))}
    ${panel('By category', barRows(d.by_category, CAT))}
    ${panel('By platform', barRows(d.by_platform, PLAT))}
    ${panel('Game versions', barRows(d.by_version))}
    ${panel('Top topics', barRows(Object.fromEntries(d.top_topics.map((x) => [x.topic, x.count]))))}
  </div>
  <div class="grid g-2">
    ${panel('Top bugs', miniList(d.bugs, (b) => `${b.title}`, 'severity'))}
    ${panel('Top requests', miniList(d.features, (f) => f.title))}
  </div>`;
}

function miniList(items, name, sevField) {
  const top = items.filter((i) => i.mention_count_window > 0).slice(0, 5);
  if (!top.length) return '<p class="sub">Nothing yet.</p>';
  const max = Math.max(...top.map((i) => i.mention_count_window));
  return `<div class="rows">${top.map((i) => `<div class="row"><span title="${esc(name(i))}">${esc(name(i))}</span><div class="bar sev-${esc(sevField ? i[sevField] : '')}" style="--c:${sevField ? '' : 'var(--blue)'}"><i style="width:${(i.mention_count_window / max) * 100}%"></i></div><span class="n">${i.mention_count_window}</span></div>`).join('')}</div>`;
}

function bugs(d) {
  if (!d.bugs.length) return empty('bugs');
  const max = Math.max(1, ...d.bugs.map((b) => b.mention_count_window));
  return panel(`Bug mobs · last ${d.window_days} days`, `<div class="cards">${d.bugs.map((b) => `
    <article class="card sev-${esc(b.severity)}">
      <h3>${esc(b.title)}</h3>
      <div class="tags"><span class="tag sev-${esc(b.severity)}">${esc(b.severity)}</span>${trendTag(b.trend)}<span class="tag plain">${label(b.status)}</span><span class="tag plain">team ${label(b.team)}</span></div>
      <div class="bar sev-${esc(b.severity)}" title="mob health = mentions"><i style="width:${(b.mention_count_window / max) * 100}%"></i></div>
      <div class="meta"><span>${b.mention_count_window} mentions in range</span><span>${b.mention_count} all time</span></div>
      <div class="tags">${sourceTags(b.sources)}${Object.entries(b.platforms).filter(([, n]) => n).map(([k, n]) => `<span class="tag plain">${esc(k)} ${n}</span>`).join('')}</div>
      ${excerpts(b.sample_excerpts)}
    </article>`).join('')}</div>`);
}

function features(d) {
  if (!d.features.length) return empty('feature requests');
  const max = Math.max(1, ...d.features.map((f) => f.mention_count_window));
  return panel(`Quest board · last ${d.window_days} days`, `<div class="cards">${d.features.map((f) => `
    <article class="card" style="--c:var(--blue)">
      <h3>${esc(f.title)}</h3>
      <div class="tags">${trendTag(f.trend)}<span class="tag plain">${label(f.status)}</span><span class="tag plain">area ${label(f.area)}</span><span class="tag plain">team ${label(f.team)}</span></div>
      <div class="bar" style="--c:var(--green)" title="XP = mentions"><i style="width:${(f.mention_count_window / max) * 100}%"></i></div>
      <div class="meta"><span>${f.mention_count_window} requests in range</span><span>${f.engagement_total} engagement</span></div>
      <div class="tags">${sourceTags(f.sources)}</div>
      ${excerpts(f.sample_excerpts)}
    </article>`).join('')}</div>`);
}

function retention(d) {
  if (!d.retention.length) return empty('retention signals');
  const max = Math.max(1, ...d.retention.map((r) => r.mention_count_window));
  return panel(`Hunger bar · churn risk · last ${d.window_days} days`, `<div class="cards">${d.retention.map((r) => `
    <article class="card risk-${esc(r.risk)}">
      <h3>${esc(r.signal)}</h3>
      <div class="tags"><span class="tag risk-${esc(r.risk)}">risk ${esc(r.risk)}</span><span class="tag plain">${esc(r.type)} retention</span>${trendTag(r.trend)}</div>
      <div class="bar risk-${esc(r.risk)}"><i style="width:${(r.mention_count_window / max) * 100}%"></i></div>
      <div class="meta"><span>${r.mention_count_window} in range</span><span>${r.mention_count} all time</span></div>
      <div class="tags">${sourceTags(r.sources)}</div>
      ${excerpts(r.sample_excerpts)}
    </article>`).join('')}</div>`);
}

function meetings(d) {
  if (!d.meetings.length) return empty('meetings');
  return panel('Campfire meetings', `<div class="cards">${d.meetings.map((m) => `
    <article class="card" style="--c:var(--orange)">
      <h3>${esc(m.title)}</h3>
      <div class="tags"><span class="tag plain">${label(m.status)}</span><span class="tag plain">team ${label(m.team)}</span></div>
      <div class="meta"><span>🕙 ${esc(fmtDate(m.scheduled_start))}</span></div>
      <p class="sub" style="margin:0">${esc(m.trigger_reason)}</p>
      <details><summary>Agenda (${m.agenda.reduce((n, a) => n + a.duration_min, 0)} min)</summary><ul class="plain">${m.agenda.map((a) => `<li><b>${esc(a.item)}</b> · ${a.duration_min}m<br><span class="sub">${esc(a.context)}</span></li>`).join('')}</ul></details>
      <details><summary>Decisions needed</summary><ul class="plain">${m.discussion_points.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></details>
      <div class="meta">${safeUrl(m.calendar_link) ? `<a href="${safeUrl(m.calendar_link)}" target="_blank" rel="noopener noreferrer">Calendar ↗</a>` : '<span></span>'}${safeUrl(m.slack_message_url) ? `<a href="${safeUrl(m.slack_message_url)}" target="_blank" rel="noopener noreferrer">Slack ↗</a>` : ''}</div>
    </article>`).join('')}</div>`);
}

function interviews(d) {
  const portfolios = [...new Set(d.interview_questions.map((q) => q.portfolio))];
  if (!d.interview_questions.length) return empty('interview questions');
  const shown = d.interview_questions.filter((q) => state.portfolio === 'all' || q.portfolio === state.portfolio);
  const filters = ['all', ...portfolios].map((p) => `<button class="btn" data-portfolio="${esc(p)}" aria-pressed="${state.portfolio === p}">${label(p)}</button>`).join('');
  return panel('Interview scrolls', `<div class="filters">${filters}</div><div class="list">${shown.map((q) => `
    <article class="card q" style="--c:var(--purple)">
      <div class="tags"><span class="tag plain">${label(q.portfolio)}</span><span class="tag" style="--c:var(--purple)">${esc(q.type)}</span><span class="tag" style="--c:var(--blue)">${esc(q.difficulty)}</span></div>
      <p>${esc(q.question)}</p>
      <div class="sub">${esc(q.why_it_matters)}</div>
      <details><summary>What a great answer shows</summary><ul class="plain">${q.expected_signals.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></details>
      <div class="tags">${q.source_cluster_keys.map((k) => `<span class="tag plain">${esc(k)}</span>`).join('')}</div>
    </article>`).join('')}</div>`);
}

function reports(d) {
  if (!d.reports.length) return empty('reports');
  return d.reports.map((r) => panel(`${r.period} report · ${r.period_start.slice(0, 10)} → ${r.period_end.slice(0, 10)}`, `
    <h3 style="line-height:1.6;margin-bottom:14px">${esc(r.headline)}</h3>
    <div class="grid g-3">
      <div><h3>✨ Highlights</h3><ul class="plain">${r.highlights.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div><h3>⚠️ Risks</h3><ul class="plain">${r.risks.map((x) => `<li>${esc(x)}</li>`).join('') || '<li>None</li>'}</ul></div>
      <div><h3>🛠️ Recommendations</h3><ul class="plain">${r.recommendations.map((x) => `<li>${esc(x.action)} <span class="tag risk-${esc(x.impact)}">${esc(x.impact)}</span> <span class="tag plain">${label(x.team)}</span></li>`).join('')}</ul></div>
    </div>`)).join('');
}

const empty = (what) => `<div class="panel empty"><h2>No ${esc(what)} yet</h2><p>Fastn hasn't sent any data. Run <code>npm run simulate</code> in the backend folder to load demo data.</p></div>`;

/* ---------- shell ---------- */
const VIEWS = { overview, bugs, features, retention, meetings, interviews, reports };

function renderTabs() {
  $('#tabs').innerHTML = TABS.map(([id, ico, name]) => `<button class="slot" role="tab" data-tab="${id}" aria-selected="${state.tab === id}"><span class="ico">${ico}</span>${name}</button>`).join('');
}
function render() {
  renderTabs();
  $('#view').innerHTML = state.data ? VIEWS[state.tab](state.data) : '';
}

async function load() {
  $('#view').innerHTML = '<div class="loading">Loading chunks…</div>';
  try {
    const res = await fetch(`${API}/v1/dashboard?days=${state.days}`);
    if (!res.ok) throw new Error(`API ${res.status}`);
    state.data = await res.json();
    $('#stamp').textContent = `Updated ${fmtDate(state.data.generated_at)}`;
    render();
  } catch (e) {
    $('#view').innerHTML = `<div class="panel"><h2>Connection lost</h2><p class="error">Could not reach the backend at ${esc(API)} (${esc(e.message)}).</p></div>`;
  }
}

document.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) { state.tab = tab.dataset.tab; location.hash = state.tab; return render(); }
  const p = e.target.closest('[data-portfolio]');
  if (p) { state.portfolio = p.dataset.portfolio; render(); }
});
$('#days').addEventListener('change', (e) => { state.days = Number(e.target.value); load(); });
$('#refresh').addEventListener('click', load);
$('#api').textContent = API;
renderTabs();
load();
setInterval(load, 60000);

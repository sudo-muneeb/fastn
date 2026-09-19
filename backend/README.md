# BlockRealm Insights — Backend

Node.js (Express) API for the BlockRealm Insights platform. It implements the shared API contract:

- **Mock Reddit and X APIs** that Fastn pulls from. The comments live in one editable file.
- **Ingest API** that Fastn pushes classified feedback, interview questions, meetings and reports to (validated, idempotent).
- **Export API** that Fastn reads (`clusters`, `summary`) to reuse clusters and drive its AI steps.
- **Dashboard API** (public, read-only) that feeds the frontend analytics.

The backend has no AI. It validates, stores and aggregates what Fastn sends.
There is no external database: data lives in memory and is optionally persisted to a JSON file (a Railway volume).

## Quick start
```bash
cd backend
npm install
npm run dev            # http://localhost:3000, dev keys: dev-fastn-key / dev-mock-key
npm run simulate       # optional: acts like Fastn and loads demo data
npm test               # 51 tests, no network needed
```

## Configuration
| Env var | Required | Default | Purpose |
|---|---|---|---|
| `FASTN_API_KEY` | yes (prod) | dev value only when `NODE_ENV` is `development` or `test` | Sent by Fastn as `X-API-Key` to `/v1/ingest/*` and `/v1/export/*` |
| `MOCK_API_KEY` | yes (prod) | same as above | Sent by Fastn as `X-Mock-Key` to `/mock/*` |
| `PORT` | no | `3000` | Railway sets this automatically |
| `CORS_ORIGIN` | no | `*` | Comma-separated allowed origins, e.g. your frontend URL |
| `DATA_FILE` | no | none (memory only) | JSON persistence path, e.g. `/data/db.json` on a Railway volume |
| `MOCK_UNIQUE` | no | `true` | `false` makes mock APIs return every comment on every call |

The server refuses to start in production without both keys.

## Deploy on Railway
1. Push the repo, then in Railway choose **New Project → Deploy from GitHub repo**.
2. Set the service **Root Directory** to `backend`. `railway.json` supplies the start command (`npm start`) and health check (`/health`).
3. In **Variables**, set `FASTN_API_KEY` and `MOCK_API_KEY` to long random strings, and `CORS_ORIGIN` to the frontend URL.
4. **Persistence (recommended):** add a **Volume** mounted at `/data` and set `DATA_FILE=/data/db.json`. Without it, data resets on every deploy or restart. Run a single instance only, since the store is in-process.
5. **Settings → Networking → Generate Domain.** That URL is Fastn's `BACKEND_URL`.
6. Check `https://<domain>/health`, which returns `{"status":"ok",...}`.

In Fastn, set `BACKEND_URL`, `FASTN_API_KEY` and `MOCK_API_KEY` to match.

## The mock comments (Reddit and X)
Edit **`src/data/mockComments.js`**. It exports two arrays, `REDDIT_COMMENTS` and `X_COMMENTS`, and you add or change entries there.
Each entry has the source's own fields plus `hours_ago` (how old it looks; it is turned into `created_at`).

**Unique output per request:** every call to `/mock/reddit/posts` or `/mock/x/posts` returns only comments **not returned before**, oldest first, up to `limit`.
Once they're all served the response is `{"items":[],"next_since":"<since>"}`.
Served state is kept per source and persisted when `DATA_FILE` is set.

| Call | Purpose |
|---|---|
| `GET /mock/reddit/posts?since=&limit=` | Next unseen Reddit comments (contract §2). Max **50** per request (default 50); a larger `limit` is capped at 50 |
| `GET /mock/x/posts?since=&limit=` | Next unseen X comments (contract §2) |
| `...&peek=true` | Look without marking them as served |
| `GET /mock/status` | `{ "unique_mode": true, "reddit": {"total":24,"served":10}, "x": {...} }` |
| `POST /mock/reset[?source=reddit\|x]` | Make comments available again → `{ "reset": 24 }` |

All `/mock/*` calls need header `X-Mock-Key`.

## API reference
All bodies are JSON, timestamps are ISO-8601 UTC, and field names are `snake_case`. Enums and field rules are exactly those of the shared API contract.

### Auth
| Routes | Header |
|---|---|
| `/v1/ingest/*`, `/v1/export/*`, `PATCH /v1/clusters/*` | `X-API-Key: <FASTN_API_KEY>` |
| `/mock/*` | `X-Mock-Key: <MOCK_API_KEY>` |
| `/`, `/health`, `/v1/dashboard` | none |

### Error response (any 4xx/5xx)
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Max 50 items per batch",
             "details": [ { "index": -1, "field": "items", "issue": "got 51, max 50" } ] } }
```
`code` is one of `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `NOT_FOUND` (404), `INTERNAL` (500).

### `GET /health`
```json
{ "status": "ok", "time": "2026-09-19T12:00:00.000Z" }
```

### Ingest: `POST /v1/ingest/{classified|interview-questions|meetings|reports}`
Body is `{ "items": [ ... ] }` with 1 to 50 items. Request items are exactly as in the contract (§5, §6, §7, §8).
Unknown fields are rejected.

Success response, HTTP 200 (always the same shape):
```json
{ "accepted": 3, "duplicates": 1, "rejected": [ { "index": 2, "error": "sentiment: must be a number in [-1, 1]" } ] }
```
- `accepted`: items stored.
- `duplicates`: items whose id already exists, or that repeat within the batch. They are ignored, so re-sending is safe.
- `rejected`: items that failed validation, with their index in the batch and every problem in `error`.
- A body that isn't `{items:[...]}`, is empty, or has more than 50 items gets a 400 `VALIDATION_ERROR`.

| Endpoint | Idempotent on | Extra rules beyond types and enums |
|---|---|---|
| `/classified` | `feedback_id` | must start with `{source}_`; `excerpt` ≤ 280; `bug`/`feature` non-null iff category present; `retention` non-empty iff `user_retention` or `world_retention`; `cluster_key` matches `^[a-z0-9]+(-[a-z0-9]+){0,7}$` |
| `/interview-questions` | `question_id` | `{portfolio}_{12 hex}` |
| `/meetings` | `meeting_id` | starts with `{team}_`; `scheduled_end` after `scheduled_start`; valid emails |
| `/reports` | `report_id` | `{period}_{YYYY-MM-DD}` |

### Update a status: `PATCH /v1/clusters/{bugs|features}/{cluster_key}`
Body `{ "status": "open|in_progress|resolved|wont_fix" }` → `{ "cluster_key": "world-save-corruption", "status": "in_progress" }`

### Export: `GET /v1/export/clusters?type=bug|feature_request|retention&limit=200`
```json
{ "type": "bug", "clusters": [ { "cluster_key": "world-save-corruption", "title": "Worlds fail to load after update", "mention_count": 54 } ] }
```
Sorted by all-time `mention_count`. For retention, `title` is the latest `signal`.

### Export: `GET /v1/export/summary?window=7d|30d` (default `7d`)
```json
{
  "window": "7d",
  "generated_at": "2026-09-19T12:00:00.000Z",
  "totals": {
    "feedback": 812,
    "by_source": { "reddit": 410, "x": 302, "forms": 100 },
    "by_category": { "bug": 300, "feature_request": 250, "user_retention": 90, "world_retention": 70, "praise": 60, "other": 42 },
    "avg_sentiment": -0.12
  },
  "bugs": [ {
    "cluster_key": "world-save-corruption", "title": "Worlds fail to load after update", "severity": "critical",
    "team": "world_engine", "status": "open", "mention_count": 120, "mention_count_window": 54, "trend": "rising",
    "sources": { "reddit": 30, "x": 14, "forms": 10 }, "sample_excerpts": ["My survival world won't load since v1.4.2"]
  } ],
  "features": [ {
    "cluster_key": "pets-that-follow-player", "title": "Pets that follow the player", "area": "mobs", "team": "gameplay",
    "status": "open", "mention_count": 80, "mention_count_window": 31, "trend": "stable",
    "sources": { "reddit": 20, "x": 9, "forms": 2 }, "sample_excerpts": ["..."]
  } ],
  "retention": [ {
    "cluster_key": "abandon-world-after-corruption", "type": "world", "signal": "Players stop playing a world after it breaks",
    "risk": "high", "mention_count": 40, "mention_count_window": 22, "trend": "rising", "sources": { "reddit": 12, "x": 10, "forms": 0 },
    "sample_excerpts": ["..."]
  } ],
  "open_meetings": [ { "meeting_id": "world_engine_world-save-corruption_20260919", "team": "world_engine", "cluster_keys": ["world-save-corruption"], "scheduled_start": "2026-09-21T05:00:00Z" } ]
}
```
- Lists are sorted by `mention_count_window` (ties by `mention_count`), max 25 each. Only clusters with window mentions are included.
- `severity` / `risk` are the **highest ever seen** for the cluster. `team`, `title`, `area` and `signal` come from the latest mention.
- `trend`: `new` if the cluster has no mentions before the window; otherwise the window is compared with the previous equal-length window: `rising` at ≥ +25%, `falling` at ≤ −25%, else `stable`. If the previous window had none but older mentions exist, `rising`.
- `open_meetings` are `scheduled` meetings whose `scheduled_end` is in the future.

### Dashboard: `GET /v1/dashboard?days=7|14|30|90&portfolio=<portfolio>` (public)
`days` defaults to 30. `portfolio` optionally filters `interview_questions`. Raw feedback and `author_hash` are never returned, only excerpts.
```json
{
  "generated_at": "2026-09-19T12:00:00.000Z",
  "window_days": 30,
  "totals": {
    "feedback": 48, "avg_sentiment": -0.23, "open_bugs": 7, "critical_bugs": 1,
    "feature_requests": 6, "high_risk_retention": 2, "upcoming_meetings": 1
  },
  "by_source":   { "reddit": 24, "x": 24, "forms": 0 },
  "by_category": { "bug": 27, "feature_request": 15, "user_retention": 4, "world_retention": 3, "praise": 5, "other": 2 },
  "by_platform": { "pc": 13, "console": 4, "mobile": 2, "unknown": 29 },
  "by_version":  { "1.4.2": 11, "1.3.9": 6 },
  "top_topics":  [ { "topic": "world-save-corruption", "count": 8 } ],
  "daily": [ {
    "date": "2026-09-19", "feedback_count": 15,
    "by_source": { "reddit": 8, "x": 7, "forms": 0 },
    "by_category": { "bug": 9, "feature_request": 3, "user_retention": 2, "world_retention": 1, "praise": 1, "other": 0 },
    "sentiment_sum": -4.1, "sentiment_avg": -0.27,
    "top_topics": [ { "topic": "v1-4-2", "count": 6 } ],
    "by_platform": { "pc": 4, "console": 1, "mobile": 0, "unknown": 10 },
    "by_version": { "1.4.2": 6 }
  } ],
  "bugs": [ {
    "cluster_key": "world-save-corruption", "title": "Worlds fail to load after update", "severity": "critical",
    "component": "world_save", "team": "world_engine", "status": "open", "trend": "rising",
    "mention_count": 120, "mention_count_window": 54, "engagement_total": 4210,
    "sources": { "reddit": 30, "x": 14, "forms": 10 },
    "platforms": { "pc": 40, "console": 5, "mobile": 1, "unknown": 8 },
    "game_versions": { "1.4.2": 44 },
    "sample_excerpts": [ { "excerpt": "...", "source": "reddit", "source_url": "https://...", "created_at": "2026-09-19T08:12:00Z" } ],
    "first_seen_at": "2026-08-30T10:00:00Z", "last_seen_at": "2026-09-19T08:12:00Z"
  } ],
  "features":  [ { "cluster_key": "...", "title": "...", "area": "mobs", "team": "gameplay", "status": "open", "trend": "stable",
                   "mention_count": 80, "mention_count_window": 31, "engagement_total": 900, "sources": {}, "game_versions": {},
                   "sample_excerpts": [], "first_seen_at": "...", "last_seen_at": "..." } ],
  "retention": [ { "cluster_key": "...", "type": "world", "signal": "...", "risk": "high", "trend": "rising",
                   "mention_count": 40, "mention_count_window": 22, "sources": {}, "sample_excerpts": [],
                   "first_seen_at": "...", "last_seen_at": "..." } ],
  "meetings": [ { "...": "the meeting as sent to /v1/ingest/meetings, plus updated_at" } ],
  "interview_questions": [ { "...": "the question as sent, plus created_at" } ],
  "reports": [ { "...": "the report as sent" } ]
}
```
- `daily` always has exactly `days` entries, oldest first, with zero days included.
- `bugs`/`features`/`retention` are sorted by `mention_count_window` and capped at 50. Each entry is the union of the fields shown above. Clusters with no window mentions still appear, with `mention_count_window: 0`.
- `meetings` (newest 20), `interview_questions` (newest 100) and `reports` (newest 10) are stored documents.

## Project layout
```
backend/
  src/
    server.js  app.js  config.js  store.js
    data/mockComments.js        <- edit the Reddit / X comments here
    routes/    mock.js  ingest.js  export.js  dashboard.js
    lib/       auth.js  errors.js  validate.js  aggregate.js
  scripts/simulate-fastn.js     <- stand-in for the Fastn flows (demo data)
  tests/                        <- node:test suites (unit-free, run against a real HTTP server)
  railway.json  .env.example
```

## Notes and trade-offs
- The contract's Firestore collections (§10) map to in-memory collections with the same names. Cluster and daily analytics are **derived on read** from `processed_feedback`, so they can't drift, and window counts and trends are always correct for the time you ask. This is fine for tens of thousands of items on one instance; for more, move the store to Postgres or Firestore.
- Ingest never overwrites: a second send of the same id is a duplicate, not an update.
- `/v1/dashboard` is public because the dashboard has no login. Put it behind auth (or a private network) if the data is sensitive.

## Tests
`npm test` starts the app on a random port and exercises it over HTTP (auth, mock uniqueness, validation and idempotency, export shapes and trends, dashboard analytics). Time is injected, so results are deterministic.

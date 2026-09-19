# What Fastn needs to know about the backend

This is the detailed reference for building the Fastn flows against this backend.
Request and response examples for every endpoint are in `backend/README.md`, and the contract itself is in `shared-api-contract.md`.
This document covers how the backend **behaves**, including the parts that catch people out.

**The backend has no AI and never calls Fastn.** Fastn starts every request. The backend validates, stores and aggregates.

## 1. Connection

| | |
|---|---|
| `BACKEND_URL` | your Railway domain, no trailing slash and no `/api` prefix (currently `https://blockrealm-production.up.railway.app`) |
| `X-API-Key` header | `FASTN_API_KEY`, for `/v1/ingest/*`, `/v1/export/*` and `PATCH /v1/clusters/*` |
| `X-Mock-Key` header | `MOCK_API_KEY`, for `/mock/*` |
| Body | JSON, UTF-8, `Content-Type: application/json` |

The two keys are not interchangeable: the Fastn key on a `/mock` route gets 401, and the mock key on `/v1/export` gets 401.
If the deployment sets `OPEN_ACCESS=true`, key checks are off and every endpoint works without headers (sending them is harmless). Keys are set in Railway Variables. The sample defaults (`blockrealm-fastn-key`, `blockrealm-mock-key`) apply only when the variables are unset.

## 2. Endpoint map

| Fastn flow | Method and path | Auth |
|---|---|---|
| A, B1 (pull) | `GET /mock/reddit/posts`, `GET /mock/x/posts` | `X-Mock-Key` |
| C (cluster lookup) | `GET /v1/export/clusters` | `X-API-Key` |
| C (push) | `POST /v1/ingest/classified` | `X-API-Key` |
| D, E, F (read) | `GET /v1/export/summary` | `X-API-Key` |
| D (push) | `POST /v1/ingest/meetings` | `X-API-Key` |
| E (push) | `POST /v1/ingest/interview-questions` | `X-API-Key` |
| F (push) | `POST /v1/ingest/reports` | `X-API-Key` |
| optional | `PATCH /v1/clusters/{bugs\|features}/{cluster_key}` | `X-API-Key` |
| B2 | none. The Google Forms webhook is received by Fastn, not the backend | |

Fastn does not need `/v1/dashboard` (the public route the web page uses), `/health` or `/mock/status`.

## 3. Rules that apply everywhere

- **Timestamps must be UTC with a `Z`:** `2026-09-19T10:00:00Z`, optionally with fractional seconds. An offset such as `+05:00` is **rejected**. Convert Karachi times to UTC first: 10:00 Asia/Karachi is `05:00:00Z`.
- **Field names are `snake_case`, and enums are exact lowercase strings.** Unknown fields are rejected, so don't add extras such as `author`, `raw_text` or `email`.
- **Enums:** `source` reddit|x|forms · `category` bug|feature_request|user_retention|world_retention|praise|other · `severity` low|medium|high|critical · `risk` and meeting/recommendation `impact` low|medium|high · `platform` pc|console|mobile|unknown · `team` gameplay|world_engine|backend|client|community|qa · `question_type` technical|product|scenario|behavioral · `difficulty` junior|mid|senior · `status` open|in_progress|resolved|wont_fix · meeting status scheduled|cancelled|done.
- **`cluster_key`:** `^[a-z0-9]+(-[a-z0-9]+){0,7}$`, so lowercase, hyphens, at most 8 words, no underscores or spaces.
- **Hashes:** `author_hash` is a lowercase hex sha256 string (the backend accepts any non-empty string up to 128 characters and does not check that it's a real hash, so that is Fastn's job). `question_id` uses the first 12 hex characters of sha1 of the question text.
- **No PII check.** The backend does not scan `excerpt` or any text for names, emails or handles. Never send raw authors, only `author_hash`.

## 4. Mock Reddit and X APIs (Flows A and B1)

`GET /mock/reddit/posts?since=<ISO>&limit=<n>` and `GET /mock/x/posts?since=<ISO>&limit=<n>`

- **Unique per request.** Each call returns only comments **not returned before**, oldest first. Once a comment is served it is never returned again, until `POST /mock/reset`. The served list is remembered per source, and it survives restarts when `DATA_FILE` is set.
- **At most 50 items per call.** `limit` defaults to 50, and a larger value (such as the prompt's `limit=100`) is silently capped at 50. A `limit` below 1 or not a number returns 400.
- **Paging:** loop until a call returns `items: []`. Do **not** loop "while the page has 100 items", because a page never has more than 50.
- **`since`:** must be an ISO `Z` timestamp (else 400), defaults to 1970, and is exclusive (`created_at > since`). Because served comments never repeat, the checkpoint is a safety net here, not a requirement.
- **`next_since`:** the last returned item's `created_at`, or the `since` you sent if the page was empty.
- **Data loss caveat:** a comment is marked served the moment the backend returns it. If Fastn fetches a page and then fails before ingesting it, those comments do not come back. Add `peek=true` to read without marking, or `POST /mock/reset?source=reddit|x` to replay everything. `reset` returns `{ "reset": <number cleared> }`.
- **Item shapes:** exactly as in the contract (section 2). Reddit: `id, subreddit, author, title, body, score, num_comments, url, created_at`. X: `id, author_handle, text, likes, reposts, url, created_at`.
- Comment content lives in `backend/src/data/mockComments.js`, and `created_at` values are relative to when the server started.

## 5. Ingest endpoints (all four behave the same way)

`POST /v1/ingest/{classified|interview-questions|meetings|reports}` with body `{ "items": [ ... ] }`.

**Batch handling**
- 1 to 50 items. An empty array, more than 50, a non-array `items`, or invalid JSON returns **400** `VALIDATION_ERROR` for the whole request, and nothing is stored.
- Otherwise the response is always HTTP 200: `{ "accepted": n, "duplicates": n, "rejected": [ { "index": i, "error": "..." } ] }`. Good items are stored even if others in the same batch are rejected.
- `index` is the item's position in your request. `error` lists every problem for that item, for example `sentiment: must be a number in [-1, 1]; bug: must be null unless categories includes bug`. **Feed this string back to the LLM** for its one retry.

**Idempotency: the first write wins**
- Each item has an id (`feedback_id`, `question_id`, `meeting_id`, `report_id`). If the id already exists, the item is counted in `duplicates` and **ignored, not updated**. The same id twice in one batch counts once as accepted and once as duplicate.
- Consequence: **you cannot correct or update an item after it is stored.** A meeting cannot be rescheduled or cancelled through the API, and a report cannot be regenerated under the same id. Use a new id (the id formats include the date for this reason).
- Retrying after a timeout or 5xx is always safe.

### `/v1/ingest/classified`
| Field | Rule |
|---|---|
| `feedback_id` | must start with `{source}_` (`reddit_t3_abc`, `x_1836...`, `forms_ACYD...`), max 200 |
| `source` | reddit\|x\|forms |
| `source_url` | **required** non-empty string, max 1000. Google Forms responses have no URL, so send a placeholder such as `https://forms.google.com/response/{response_id}` |
| `created_at` | ISO `Z` |
| `author_hash` | non-empty string, max 128 |
| `engagement` | integer >= 0 |
| `game_version` | string up to 40 characters, or `null` |
| `platform` | pc\|console\|mobile\|unknown |
| `excerpt` | non-empty, **max 280 characters**. The backend does not truncate, it rejects |
| `sentiment` | number in [-1, 1] |
| `confidence` | number in [0, 1] |
| `topics` | array of strings, up to 20, each 1 to 80 characters (may be empty) |
| `categories` | non-empty, no duplicates |
| `bug` | object **only if** `categories` includes `bug`, else must be `null`. Fields: `cluster_key, title (<=200), severity, component (<=80), team`, and optional `repro_hint` (<=300 or null) |
| `feature` | object **only if** `feature_request` is a category, else `null`. Fields: `cluster_key, title, area (<=80), team` |
| `retention` | non-empty array **only if** `user_retention` or `world_retention` is a category, else must be `[]`. Each: `type user\|world, cluster_key, signal (<=300), risk` |

The conditional rules are checked in both directions, so `bug: {...}` with no `bug` category is rejected, and so is a `bug` category with `bug: null`. The backend does not check that a retention item's `type` matches the category (`user_retention` vs `world_retention`).

### `/v1/ingest/interview-questions`
`question_id` = `{portfolio}_{12 hex}`, `portfolio`, `question` (<=1000), `why_it_matters` (<=600), `type`, `difficulty`, `expected_signals` (1 to 8 strings), `source_cluster_keys` (array of valid cluster keys), `generated_at` (ISO). The prompt asks for 2 to 4 signals, and the backend accepts 1 to 8.

### `/v1/ingest/meetings`
`meeting_id` must start with `{team}_` (contract: `{team}_{first cluster_key}_{YYYYMMDD}`), `team`, `title` (<=200), `trigger_reason` (<=500), `cluster_keys` (non-empty), `agenda` (non-empty; each `{item, context, duration_min >= 1}`), `discussion_points` (1 to 10), `scheduled_start`/`scheduled_end` (ISO `Z`, **end after start**), `attendee_emails` (valid emails, may be empty), `status`. `calendar_event_id`, `calendar_link`, `slack_message_url` are optional and may be `null`. The backend does not check that agenda minutes add up to 30.

### `/v1/ingest/reports`
`report_id` = `weekly_YYYY-MM-DD` or `daily_YYYY-MM-DD` and **must match `period`**, `period_start`, `period_end`, `headline` (<=300), `highlights` (1 to 10), `risks` (0 to 10), `recommendations` (array of `{action, team, impact}`, may be empty), `generated_at`.

## 6. Export endpoints (what the AI steps read)

### `GET /v1/export/clusters?type=bug|feature_request|retention&limit=1..200`
Returns `{ type, clusters: [ { cluster_key, title, mention_count } ] }`, sorted by all-time `mention_count`. For `retention`, `title` is the cluster's most recent `signal`. Call it once per run and pass the list to the classifier so it **reuses existing keys**. It includes every cluster ever stored, not just recent ones.

### `GET /v1/export/summary?window=7d|30d` (default 7d)
- **Rolling window:** the last 7 or 30 days counted back from the moment of the request.
- `totals`: `feedback`, `by_source`, `by_category`, `avg_sentiment` (rounded to 2 decimals). An item with two categories counts once in each, so `by_category` values can add up to more than `feedback`. `by_category` always lists all 6 categories.
- `bugs`, `features`, `retention`: only clusters with at least one mention in the window, sorted by `mention_count_window` (ties by all-time count), **max 25 each**.
  - `mention_count` is all-time, and `mention_count_window` is inside the window. `sources` counts are window-only.
  - `severity` (bugs) and `risk` (retention) are the **highest ever seen** for the cluster. `title`, `team`, `area` and `signal` come from the **latest** mention.
  - `status` starts as `open` and only changes through the PATCH endpoint.
  - `sample_excerpts` is up to 5 plain strings, newest first.
  - **`trend`:** `new` if the cluster had no mentions before the window. Otherwise compare the window to the previous equal-length window: `rising` at +25% or more, `falling` at -25% or less, else `stable`. If the previous window had zero but older mentions exist, it's `rising`.
- `open_meetings`: `scheduled` meetings whose `scheduled_end` is still in the future, each with `meeting_id, team, cluster_keys, scheduled_start`. Flow D uses `cluster_keys` here to skip clusters that already have a meeting.
- Feature entries have no `severity`, and retention entries have no `team`.

## 7. Optional: marking work done

`PATCH /v1/clusters/{bugs|features}/{cluster_key}` with `{ "status": "in_progress" }` (open, in_progress, resolved, wont_fix) returns `{ cluster_key, status }`. The status then appears in `/v1/export/summary` and on the dashboard. The backend does not check that the cluster exists, so a typo in the key silently creates a stray status. Any other `kind` returns 404.

## 8. Errors and retries

Every error is `{ "error": { "code", "message", "details": [] } }`.

| HTTP | code | Meaning | Fastn should |
|---|---|---|---|
| 200 | none | Processed (check `rejected[]`) | Log `accepted / duplicates / rejected`. Send `rejected[]` items and errors to the dead-letter log |
| 400 | `VALIDATION_ERROR` | Bad body or query (>50 items, bad JSON, bad `type`/`window`/`limit`/`since`) | Fix the request. Do not retry unchanged |
| 401 | `UNAUTHORIZED` | Missing or wrong key, or the wrong header for that route | Check the key and header name |
| 404 | `NOT_FOUND` | Unknown route | Check the path (no `/api` prefix) |
| 5xx | `INTERNAL` | Server error, or Railway restarting or redeploying | Retry with backoff (2 s, 8 s, 30 s). Safe because of idempotency |

There is no rate limiting. Save the `reddit_since` / `x_since` checkpoint only after an ingest call returns 200.

## 9. What the backend does NOT do

- No AI, classification, clustering or summarising (Fastn does all of it).
- No Google Calendar, Slack or email. It only records the ids and links Fastn sends.
- No updates or deletes of stored items (first write wins), and no way to list raw feedback.
- No content-based duplicate detection: two different ids with identical text are both stored.
- No check that the `cluster_key` you send was reused from the lookup. A new key is simply a new cluster.
- No per-user auth. Anyone with a key has full access.

## 10. Persistence and starting state

- Data is held in memory and saved to `DATA_FILE` when it is set (on Railway, `/data/db.json` on a volume). Keep one replica.
- **The store starts with sample data.** When `DATA_FILE` doesn't exist yet, the backend loads `backend/seed/db.json`: 700 keyword-classified feedback items, a meeting, 3 interview questions and a report. Once the file exists, the seed is no longer used.
- **The seed items use the same ids as the mock comments** (`reddit_t3_r001`, `x_1836...`). So when Fastn ingests the mock comments for the first time on a store that still holds the seed, **every item comes back as a duplicate** (`accepted: 0`), and the dashboard keeps the keyword-classified seed data, not Fastn's LLM results. Also, `/v1/export/clusters` will list the seed's clusters, which the LLM will reuse.
- **For a clean start with Fastn as the only source:** set `SEED_FILE=none` in Railway Variables and delete `/data/db.json` (or use a fresh volume), then call `POST /mock/reset`.

## 11. Suggested first run

1. `GET /health`, then `GET /mock/reddit/posts?limit=2&peek=true` with `X-Mock-Key` (peek so nothing is used up).
2. Run Flow A. Expect `accepted` equal to the number of items on a clean store, or `duplicates` on a seeded one (see section 10).
3. Run the same batch again. Expect `accepted: 0`, `duplicates` equal to the batch size.
4. Send one deliberately bad item (for example `sentiment: 3`). Expect it in `rejected[]` with an error naming `sentiment`.
5. `GET /v1/export/summary?window=30d`, and check that Flows D, E and F can read it.
6. Open the dashboard and confirm the numbers.

`INTEGRATION.md` has ready-made `curl` commands, and `tests/` has runnable Python checks.

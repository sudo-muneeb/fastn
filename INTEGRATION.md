# Integration guide: Railway, Fastn, Google Forms, frontend

How the pieces connect:

```
 Google Forms ──(Apps Script)──▶ Fastn webhook ─┐
 Mock Reddit / X  ◀──pull── Fastn (every 15 min) ├─ classify (LLM) ─▶ POST /v1/ingest/classified ─┐
                                                 │                                                 ▼
 Fastn meeting / interview / report flows ◀── GET /v1/export/summary            ONE RAILWAY SERVICE ──▶ GET /v1/dashboard ──▶ DASHBOARD (same service)
                        └────────────────────────▶ POST /v1/ingest/{meetings,interview-questions,reports}
```

Fastn does all the AI work. The backend only validates, stores and aggregates. The frontend only reads `/v1/dashboard`.

---

## 1. Keys

You choose the keys yourself, since nobody issues them. This sample project ships with simple ones, built in and committed to the repo:

| Key | Value | Header Fastn must send | Protects |
|---|---|---|---|
| `FASTN_API_KEY` | `blockrealm-fastn-key` | `X-API-Key` | `/v1/ingest/*`, `/v1/export/*`, `PATCH /v1/clusters/*` |
| `MOCK_API_KEY` | `blockrealm-mock-key` | `X-Mock-Key` | `/mock/*` (mock Reddit and X) |

Put the same two values in Fastn. They are the defaults when the backend has no env vars, so Railway needs no Variables for them.
Because they're public in the repo, use your own for anything real: set `FASTN_API_KEY` / `MOCK_API_KEY` in Railway Variables (for example `echo "fastn_$(openssl rand -hex 24)"`) and update Fastn to match.

---

## 2. Deploy on Railway (one service: API + dashboard)

1. Push this repo to GitHub, then in Railway choose **New Project → Deploy from GitHub repo**. Leave **Root Directory** empty: the repo root holds `package.json` and `railway.json`, and Railway builds and starts everything from there.
2. **Variables:** none are required (sample keys and sample data are built in). Optional: your own `FASTN_API_KEY` / `MOCK_API_KEY`.
3. **Optional persistence:** add a **Volume** mounted at `/data` and set `DATA_FILE=/data/db.json`, so data Fastn sends survives redeploys. Without it, the store resets to the sample seed data on each deploy. Keep a single replica.
4. **Settings → Networking → Generate Domain.** That one URL, for example `https://blockrealm.up.railway.app`, serves the dashboard at `/` and is your **`BACKEND_URL`** for Fastn. No CORS setup is needed, since both are on the same origin.
5. Verify:
   ```bash
   curl https://<DOMAIN>/health
   curl -H "X-Mock-Key: $MOCK_API_KEY" "https://<DOMAIN>/mock/reddit/posts?limit=2&peek=true"
   ```
   Note that `peek=true` reads without marking comments as served. Then open `https://<DOMAIN>/` in a browser.

## 4. Configure Fastn

Create these environment variables or connections in Fastn:

| Fastn variable | Value |
|---|---|
| `BACKEND_URL` | the Railway backend URL from §2 |
| `FASTN_API_KEY` | sent as `X-API-Key` |
| `MOCK_API_KEY` | sent as `X-Mock-Key` |
| LLM connection | OpenAI, Anthropic or Gemini |
| Google Calendar and Slack connections | for Flow D |
| `TEAM_ROSTER` | JSON: `{ "world_engine": { "attendee_emails": ["a@x.com"], "slack_channel": "#world" }, ... }` |

### How each flow calls the backend

| Fastn flow | Calls | Notes |
|---|---|---|
| **A** Reddit ingest (15 min) | `GET {BACKEND_URL}/mock/reddit/posts?since=…&limit=50` | header `X-Mock-Key` |
| **B1** X ingest (15 min) | `GET {BACKEND_URL}/mock/x/posts?since=…&limit=50` | header `X-Mock-Key` |
| **B2** Forms (webhook) | receives the Apps Script POST (§5), then goes to Subflow C | no backend call |
| **C** classify and push | `GET /v1/export/clusters?type=bug\|feature_request\|retention&limit=200`, then `POST /v1/ingest/classified` | header `X-API-Key`, ≤ 50 items per POST |
| **D** meetings (daily 09:00) | `GET /v1/export/summary?window=7d`, then `POST /v1/ingest/meetings` | |
| **E** interview questions (weekly) | `GET /v1/export/summary?window=30d`, then `POST /v1/ingest/interview-questions` | |
| **F** weekly report (Fri 17:00) | `GET /v1/export/summary?window=7d`, then `POST /v1/ingest/reports` | |

Behaviours to design around:

- **Mock APIs are "unique per request".** Each call returns only comments not returned before, oldest first, **at most 50**. A `limit` above 50 is capped at 50, not rejected. When they're all served you get `{ "items": [], "next_since": "<since>" }`. So Flow A/B1's "loop while 100 items" should loop **while the page is non-empty** (or while it returns 50), and it will pick up the rest next run. To replay comments, call `POST /mock/reset` (`?source=reddit|x`).
- **Ingest is idempotent.** Re-sending an id returns `duplicates`, so retries are safe. The response is always `{ "accepted": n, "duplicates": n, "rejected": [ { "index": i, "error": "…" } ] }`. Send `rejected[]` to your dead-letter log. Save the checkpoint only after HTTP 200.
- **Validation is strict.** Unknown fields, bad enums, `excerpt` > 280 chars, and `bug`/`feature`/`retention` that don't match `categories` are rejected per item with a readable `error`. Feed that message back to the LLM for its one retry.
- **Errors:** 401 `UNAUTHORIZED` means a wrong or missing key header. 400 `VALIDATION_ERROR` means a bad body or query (for example more than 50 items). Retry only 5xx, with backoff of 2 s, 8 s, 30 s.
- **Never send raw names, emails or handles.** Only `author_hash` (sha256).

Exact request and response JSON for every endpoint is in [`backend/README.md`](backend/README.md).

### Smoke test from any terminal (or Fastn's HTTP node)
```bash
export BACKEND_URL=https://<your-backend>
export FASTN_API_KEY=blockrealm-fastn-key   MOCK_API_KEY=blockrealm-mock-key

# 1. pull mock comments (Flow A)
curl -s -H "X-Mock-Key: $MOCK_API_KEY" "$BACKEND_URL/mock/reddit/posts?since=1970-01-01T00:00:00Z&limit=50"

# 2. push a classified item (Subflow C)
curl -s -X POST "$BACKEND_URL/v1/ingest/classified" \
  -H "X-API-Key: $FASTN_API_KEY" -H "content-type: application/json" \
  -d '{"items":[{"feedback_id":"reddit_t3_demo1","source":"reddit","source_url":"https://reddit.com/r/BlockRealm/comments/demo1","created_at":"2026-09-19T08:12:00Z","author_hash":"9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08","engagement":179,"game_version":"1.4.2","platform":"pc","excerpt":"My survival world will not load since v1.4.2","sentiment":-0.72,"confidence":0.91,"topics":["world-save"],"categories":["bug"],"bug":{"cluster_key":"world-save-corruption","title":"Worlds fail to load after update","severity":"critical","component":"world_save","team":"world_engine","repro_hint":null},"feature":null,"retention":[]}]}'
# → {"accepted":1,"duplicates":0,"rejected":[]}   (run it again → duplicates:1)

# 3. read what Fastn's AI steps read (Flows D, E, F)
curl -s -H "X-API-Key: $FASTN_API_KEY" "$BACKEND_URL/v1/export/summary?window=7d"

# 4. the dashboard's data
curl -s "$BACKEND_URL/v1/dashboard?days=30"
```
No Fastn yet? `BACKEND_URL=... FASTN_API_KEY=... MOCK_API_KEY=... npm run simulate` does the same pull → classify → push using keyword rules.

---

## 5. Google Forms → Fastn (Flow B2)

Fastn creates a webhook URL for Flow B2; call it `FASTN_FORMS_WEBHOOK`.
In the form, go to **Extensions → Apps Script**, paste this, then add a trigger: **Triggers → Add → `onFormSubmit` → From form → On form submit**.

```javascript
const WEBHOOK_URL = 'PASTE_FASTN_FORMS_WEBHOOK_URL';

function onFormSubmit(e) {
  const answers = {};
  e.response.getItemResponses().forEach((r) => {
    const v = r.getResponse();
    answers[r.getItem().getTitle()] = Array.isArray(v) ? v.join(', ') : String(v);
  });
  const payload = {
    response_id: e.response.getId(),
    submitted_at: e.response.getTimestamp().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    email: e.response.getRespondentEmail() || null,
    answers: answers,
  };
  UrlFetchApp.fetch(WEBHOOK_URL, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
}
```
Name the form questions **"Game version"** and **"Platform"** exactly, so Fastn can map them. Fastn hashes the email, and only `author_hash` reaches the backend.

---

## 6. Test checklist (before going live)

- [ ] `GET /health` returns `ok` on the Railway URL.
- [ ] A call with a wrong `X-API-Key` returns 401, and one with `X-Mock-Key` returns 200.
- [ ] Flow A fetches comments, and running it twice fetches 0 the second time.
- [ ] Ingesting the same batch twice gives `duplicates` = batch size on the second call.
- [ ] A deliberately bad item (for example `sentiment: 3`) lands in `rejected[]` and in the dead-letter log.
- [ ] `/v1/export/clusters?type=bug` lists clusters after the first ingest, and the LLM reuses those `cluster_key`s.
- [ ] Flow D creates a Calendar event and Slack message, and the meeting appears in the **Meetings** tab.
- [ ] Flows E and F results appear in **Interviews** and **Reports**.
- [ ] Opening the Railway domain in a browser shows the dashboard with data.
- [ ] A form submission arrives in the backend as a `forms_…` item.

## 7. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `401 UNAUTHORIZED` from Fastn | Wrong key, or the wrong header. Use `X-Mock-Key` for `/mock/*` and `X-API-Key` for everything else. |
| Mock returns `items: []` | All comments were already served. Call `POST /mock/reset`, or add comments in `backend/src/data/mockComments.js`. |
| Everything reset after a deploy | No volume. Add one at `/data` and set `DATA_FILE=/data/db.json`. Without one, the store restarts from the seed. |
| Dashboard says "Connection lost" | The backend is down or restarting. Check `/health` and the Railway logs. |
| `rejected[].error` mentions `unknown field` | Fastn sent a field the contract doesn't define. Remove it. |
| Dashboard is empty | The seed loaded but its dates have aged out of the window, or `SEED_FILE=none` / a fresh `DATA_FILE` is in use. Run Fastn (or `npm run simulate`), or pick a longer range. |

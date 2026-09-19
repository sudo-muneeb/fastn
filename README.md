# BlockRealm Insights

Player-feedback intelligence for a Minecraft-like game. **Fastn** ingests and classifies feedback. This repo is **one deployable service** that holds the API and the dashboard.

| Folder | What |
|---|---|
| [`backend/`](backend/README.md) | Express API: mock Reddit/X, Fastn ingest/export, dashboard analytics. Also serves the dashboard. |
| [`frontend/`](frontend/README.md) | Game-styled analytics dashboard (static files in `frontend/public`, served by the backend). |
| `package.json`, `railway.json` | Root config: Railway builds and starts everything from the repo root. |

## Run locally
```bash
npm install
npm start               # API + dashboard on http://localhost:3000 (no setup needed)
npm run simulate        # optional: pretend to be Fastn and push the mock comments (adds to the sample data)
npm test                # 54 backend tests
```
`npm run dev` restarts on file changes.

## Keys and sample data (this is a sample project)
| | Value |
|---|---|
| `FASTN_API_KEY` (header `X-API-Key`) | `blockrealm-fastn-key` |
| `MOCK_API_KEY` (header `X-Mock-Key`) | `blockrealm-mock-key` |

These are built-in defaults and are committed in `backend/.env` and `.env.example`, so nothing needs configuring. **Anyone with the repo knows them.** For real data, set your own `FASTN_API_KEY` / `MOCK_API_KEY` in Railway Variables.

The repo ships sample data in `backend/seed/db.json` (700 classified feedback items, a meeting, interview questions and a report), so the dashboard is filled on first start. It is loaded when `DATA_FILE` is unset or doesn't exist yet. Set `SEED_FILE=none` to start empty. The sample dates are around 2026-09-19, so the 7/14/30-day views empty out as time passes.

## Deploy on Railway (one service, root directory = repo root)
1. Push this repo to GitHub → Railway **New Project → Deploy from GitHub repo**. Leave **Root Directory** empty (the repo root).
2. **Variables:** none are required, because the sample keys and seed data are built in. Optional: your own `FASTN_API_KEY` / `MOCK_API_KEY`, and `DATA_FILE=/data/db.json` with a **Volume** mounted at `/data` so data Fastn sends survives deploys (without it, the store resets to the seed on each deploy). Keep one replica.
3. (Optional) the volume from step 2.
4. **Settings → Networking → Generate Domain.** That one URL serves everything:
   - `/` is the dashboard
   - `/v1/...` is the API (Fastn's `BACKEND_URL`)
   - `/mock/...` is the mock Reddit and X APIs
   - `/health` is the health check
5. Railway uses `railway.json` (build with Nixpacks, run `npm start`, health check `/health`) and sets `PORT` itself.

For real use, generate your own keys with `echo "fastn_$(openssl rand -hex 24)"` and `echo "mock_$(openssl rand -hex 24)"`.

**Connecting Fastn and Google Forms:** see [INTEGRATION.md](INTEGRATION.md).

**Docs:** [INTEGRATION.md](INTEGRATION.md) (Railway, Fastn, Forms setup) · [FASTN_BACKEND_GUIDE.md](FASTN_BACKEND_GUIDE.md) (how the backend behaves, for building the Fastn flows) · [tests/README.md](tests/README.md) (Python tests and checking the frontend)

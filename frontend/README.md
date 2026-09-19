# BlockRealm Insights: Frontend

A Minecraft-styled dashboard (pixel fonts, inventory panels, hearts for player mood, "bug mobs" with health bars).
Plain HTML/CSS/JS in `public/` with no build step. **The backend serves these files**, so there is nothing to deploy separately.

Tabs: **Overview** (KPIs, feedback per day, sentiment, source/category/platform/version/topics) · **Bugs** · **Features** · **Retention** · **Meetings** · **Interviews** · **Reports**.
It reads one public endpoint, `GET /v1/dashboard?days=7|14|30|90` (see `backend/README.md`), and refreshes every 60 s.

## Run
From the repo root: `npm run start:local` (or `npm run dev`), then open http://localhost:3000. Run `npm run simulate` to fill it with demo data.

## Hosting it separately (optional)
Serve `frontend/public` from any static host, and set the backend variable `PUBLIC_API_URL` to the API's URL (the dashboard reads it from `/config.js`).
That only works if the static host also serves `/config.js`, or you edit `config.js` yourself. Also set the backend's `CORS_ORIGIN` to the static host's URL. Set `FRONTEND_DIR=none` to make the backend API-only.

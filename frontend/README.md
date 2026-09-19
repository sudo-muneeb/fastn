# BlockRealm Insights — Frontend

A Minecraft-styled dashboard (pixel fonts, inventory panels, hearts for player mood, "bug mobs" with health bars).
Plain HTML/CSS/JS with no build step, served by a zero-dependency Node server.

Tabs: **Overview** (KPIs, feedback per day, sentiment, source/category/platform/version/topics) · **Bugs** · **Features** · **Retention** · **Meetings** · **Interviews** · **Reports**.
It reads one public endpoint, `GET {API_URL}/v1/dashboard?days=7|14|30|90` (see `backend/README.md`), and auto-refreshes every 60 s.

## Run locally
```bash
# terminal 1 – backend
cd backend && npm install && npm run dev
# terminal 2 – load demo data into the backend
cd backend && npm run simulate
# terminal 3 – frontend  (http://localhost:5173)
cd frontend && API_URL=http://localhost:3000 npm start
```

## Deploy on Railway
Create a second service with root directory `frontend` and set `API_URL` to the backend's public URL
(e.g. `https://blockrealm-backend.up.railway.app`). Then set `CORS_ORIGIN` on the backend to this frontend's URL.

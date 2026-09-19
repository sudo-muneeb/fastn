# BlockRealm Insights

Player-feedback intelligence for a Minecraft-like game. **Fastn** ingests and classifies feedback; this repo holds the two pieces around it.

| Folder | What | Docs |
|---|---|---|
| [`backend/`](backend/README.md) | Express API: mock Reddit/X, Fastn ingest/export, dashboard analytics. Deploys to Railway. | API + response JSON |
| [`frontend/`](frontend/README.md) | Game-styled analytics dashboard. Deploys to Railway. | run + deploy |

```bash
cd backend && npm install && npm test && npm run dev     # API on :3000
cd backend && npm run simulate                            # load demo data
cd frontend && npm start                                  # dashboard on :5173
```

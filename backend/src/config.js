import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/public');

// SAMPLE PROJECT: these keys are public defaults so the app works with zero setup.
// Override FASTN_API_KEY / MOCK_API_KEY in Railway Variables for anything real.
export const DEFAULT_FASTN_API_KEY = 'blockrealm-fastn-key';
export const DEFAULT_MOCK_API_KEY = 'blockrealm-mock-key';
const DEFAULT_SEED = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../seed/db.json');

export function loadConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 3000,
    fastnApiKey: env.FASTN_API_KEY || DEFAULT_FASTN_API_KEY,
    mockApiKey: env.MOCK_API_KEY || DEFAULT_MOCK_API_KEY,
    // OPEN_ACCESS=true turns off the key checks: anyone can call every endpoint (keys are still accepted)
    openAccess: env.OPEN_ACCESS === 'true',
    corsOrigin: env.CORS_ORIGIN || '*',
    // Optional JSON persistence file (point at a Railway volume, e.g. /data/db.json)
    dataFile: env.DATA_FILE || null,
    // Sample data loaded when DATA_FILE is unset or doesn't exist yet (SEED_FILE=none disables)
    seedFile: env.SEED_FILE === 'none' ? null : env.SEED_FILE || DEFAULT_SEED,
    // When true, each mock request only returns comments not served before
    mockUnique: env.MOCK_UNIQUE !== 'false',
    // Folder of static dashboard files served at / (set FRONTEND_DIR=none to serve the API only)
    frontendDir: env.FRONTEND_DIR === 'none' ? null : env.FRONTEND_DIR || DEFAULT_FRONTEND,
    // API base URL the dashboard calls. Empty = same origin (single deployment).
    publicApiUrl: (env.PUBLIC_API_URL || '').replace(/\/$/, ''),
  };
}

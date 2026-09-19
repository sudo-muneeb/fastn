export function loadConfig(env = process.env) {
  const devLike = ['development', 'test'].includes(env.NODE_ENV);
  const need = (name, devDefault) => {
    if (env[name]) return env[name];
    if (devLike) return devDefault;
    throw new Error(`Missing required env var ${name}`);
  };
  return {
    port: Number(env.PORT) || 3000,
    fastnApiKey: need('FASTN_API_KEY', 'dev-fastn-key'),
    mockApiKey: need('MOCK_API_KEY', 'dev-mock-key'),
    corsOrigin: env.CORS_ORIGIN || '*',
    // Optional JSON persistence file (point at a Railway volume, e.g. /data/db.json)
    dataFile: env.DATA_FILE || null,
    // When true, each mock request only returns comments not served before
    mockUnique: env.MOCK_UNIQUE !== 'false',
  };
}

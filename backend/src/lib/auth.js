import crypto from 'node:crypto';
import { ApiError } from './errors.js';

const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

const guard = (config, header, expected) => (req, res, next) =>
  config.openAccess || safeEqual(req.get(header), expected)
    ? next()
    : next(new ApiError(401, 'UNAUTHORIZED', `Missing or invalid ${header} header`));

export const requireFastnKey = (config) => guard(config, 'X-API-Key', config.fastnApiKey);
export const requireMockKey = (config) => guard(config, 'X-Mock-Key', config.mockApiKey);

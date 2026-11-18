import './types/express';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import { config } from './config';
import { errorHandler, notFoundHandler } from './middleware/errors';
import routes from './routes';
import { readUpload, UPLOAD_CACHE_CONTROL } from './services/storage';
import { AppError } from './utils/errors';

/** Drops keys that could be read as MongoDB operators ($gt, a.b) from JSON bodies. */
function stripOperators(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripOperators);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith('$') || k.includes('.')) continue;
      out[k] = stripOperators(v);
    }
    return out;
  }
  return value;
}

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin || !config.isProduction || config.corsOrigins.includes('*') || config.corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new AppError(403, 'Origin not allowed', 'CORS'));
      },
    }),
  );
  app.use(express.json({ limit: '200kb' }));
  app.use((req, _res, next) => {
    if (req.body && typeof req.body === 'object') req.body = stripOperators(req.body);
    next();
  });
  if (!config.isTest) app.use(morgan(config.isProduction ? 'combined' : 'dev'));

  app.get(['/health', '/api/v1/health'], (_req, res) => {
    res.json({ status: 'ok', service: 'genie-sevai-api', time: new Date().toISOString() });
  });

  // Uploaded pictures: public, immutable (random names), loadable from the web and admin origins.
  // They live in the R2 bucket when it is configured, otherwise in UPLOAD_DIR on this server.
  app.use(
    '/uploads',
    (_req, res, next) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      next();
    },
    async (req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      try {
        const file = await readUpload(req.path.slice(1));
        if (!file) return next();
        res.setHeader('Content-Type', file.type);
        res.setHeader('Cache-Control', UPLOAD_CACHE_CONTROL);
        if (file.length !== undefined) res.setHeader('Content-Length', String(file.length));
        if (file.etag) res.setHeader('ETag', file.etag);
        file.body.on('error', next).pipe(res);
      } catch (err) {
        next(err);
      }
    },
    express.static(config.uploads.dir, { index: false, dotfiles: 'deny', maxAge: '365d', immutable: true }),
  );

  app.use('/api/v1', routes);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

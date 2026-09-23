import express from 'express';
import { Pool } from 'pg';
import { ReportEngine, SchemaRegistry } from '../src/clinical';
import { requireAuth } from './auth';
import { errorHandler } from './http';
import { episodeRoutes } from './routes/episodes';
import { promRoutes } from './routes/proms';
import { referenceRoutes } from './routes/reference';
import { PartiesResolver, defaultPartiesResolver, reportRoutes, verifyRoutes } from './routes/reports';
import { surgeryRoutes } from './routes/surgeries';
import { toolRoutes } from './routes/tools';

export interface AppOptions {
  pool: Pool;
  jwtSecret: string;
  resolveParties?: PartiesResolver;
}

export function createApp(o: AppOptions): express.Express {
  const registry = new SchemaRegistry();
  const engine = new ReportEngine();
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '512kb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use(verifyRoutes(o.pool)); // pública

  const api = express.Router();
  api.use(requireAuth(o.jwtSecret));
  api.use(referenceRoutes(o.pool, registry));
  api.use(toolRoutes());
  api.use(episodeRoutes(o.pool));
  api.use(surgeryRoutes(o.pool, registry));
  api.use(reportRoutes(o.pool, registry, engine, o.resolveParties ?? defaultPartiesResolver));
  api.use(promRoutes(o.pool));
  api.use((_req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'Rota não encontrada.' }));
  app.use('/api', api);

  app.use(errorHandler);
  return app;
}

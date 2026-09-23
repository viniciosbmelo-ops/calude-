import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import express from 'express';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
import { ReportEngine, SchemaRegistry } from '../src/clinical';
import { requireAuth } from './auth';
import { badRequest, errorHandler, h } from './http';
import { assessmentRoutes } from './routes/assessments';
import { episodeRoutes } from './routes/episodes';
import { patientRoutes } from './routes/patients';
import { promRoutes, publicPromRoutes } from './routes/proms';
import { protocolRoutes } from './routes/protocols';
import { referenceRoutes } from './routes/reference';
import { PartiesResolver, defaultPartiesResolver, reportRoutes, verifyRoutes } from './routes/reports';
import { surgeryRoutes } from './routes/surgeries';
import { toolRoutes } from './routes/tools';

export interface AppOptions {
  pool: Pool;
  jwtSecret: string;
  resolveParties?: PartiesResolver;
  /** URL pública usada no QR e nos links de PROM (ex.: https://app.docsholder.com.br) */
  publicBaseUrl?: string;
  /** Login sem senha para desenvolvimento. NUNCA em produção (index.ts recusa). */
  devLogin?: boolean;
  supabase?: { url: string; anonKey: string };
  /** Diretório do frontend compilado (web/dist) */
  webDist?: string;
}

/** UUID determinístico a partir do e-mail (apenas login de desenvolvimento). */
export function devUserId(email: string): string {
  const h = createHash('sha256').update(`docsholder-dev:${email.toLowerCase()}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function createApp(o: AppOptions): express.Express {
  const registry = new SchemaRegistry();
  const engine = new ReportEngine();
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '512kb' }));
  app.use((_req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'no-referrer'); // links de PROM carregam token na URL
    res.set('X-Frame-Options', 'DENY');
    next();
  });

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use(verifyRoutes(o.pool)); // pública

  const pub = express.Router();
  pub.get('/public/config', (_req, res) =>
    res.json(o.supabase ? { auth: 'supabase', supabaseUrl: o.supabase.url, supabaseAnonKey: o.supabase.anonKey } : { auth: o.devLogin ? 'dev' : 'none' })
  );
  if (o.devLogin) {
    pub.post('/public/dev-login', h(async (req, res) => {
      const { email, full_name, crm } = req.body ?? {};
      if (typeof email !== 'string' || !/^[^@\s]+@[^@\s]+$/.test(email)) throw badRequest('E-mail inválido.');
      if (typeof full_name !== 'string' || full_name.trim().length < 3) throw badRequest('Nome completo obrigatório.');
      const sub = devUserId(email);
      const token = jwt.sign(
        { sub, role: 'authenticated', aud: 'authenticated', email, user_metadata: { full_name: full_name.trim(), crm: typeof crm === 'string' ? crm.trim() : undefined } },
        o.jwtSecret,
        { algorithm: 'HS256', expiresIn: '12h' }
      );
      res.json({ access_token: token, user_id: sub });
    }));
  }
  pub.use(publicPromRoutes(o.pool));
  app.use('/api', pub);

  const api = express.Router();
  api.use(requireAuth(o.jwtSecret));
  api.get('/me', (req, res) => {
    const c = req.user!.claims as Record<string, any>;
    res.json({ id: req.user!.id, email: c.email ?? null, full_name: c.user_metadata?.full_name ?? null, crm: c.user_metadata?.crm ?? null });
  });
  api.use(referenceRoutes(o.pool, registry));
  api.use(toolRoutes());
  api.use(patientRoutes(o.pool));
  api.use(episodeRoutes(o.pool));
  api.use(assessmentRoutes(o.pool, registry));
  api.use(surgeryRoutes(o.pool, registry));
  api.use(reportRoutes(o.pool, registry, engine, o.resolveParties ?? defaultPartiesResolver, o.publicBaseUrl));
  api.use(promRoutes(o.pool, o.publicBaseUrl));
  api.use(protocolRoutes(o.pool));
  api.use((_req, res) => res.status(404).json({ error: 'NOT_FOUND', message: 'Rota não encontrada.' }));
  app.use('/api', api);

  // Frontend (SPA) — qualquer GET fora de /api e /verify cai no index.html
  if (o.webDist && fs.existsSync(path.join(o.webDist, 'index.html'))) {
    app.use(express.static(o.webDist, { index: false, maxAge: '1h' }));
    app.get('*', (_req, res) => res.sendFile(path.join(o.webDist!, 'index.html')));
  }

  app.use(errorHandler);
  return app;
}

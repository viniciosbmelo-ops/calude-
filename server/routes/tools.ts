/** Cálculos puros do núcleo expostos via HTTP (sem banco). */
import { Router } from 'express';
import { evaluateInstabilityMetrics, parseGs1, scheduleTimepoints } from '../../src/clinical';
import { badRequest, h } from '../http';

export function toolRoutes(): Router {
  const r = Router();

  r.post('/gs1/parse', h(async (req, res) => {
    if (typeof req.body?.raw !== 'string' || req.body.raw.length === 0 || req.body.raw.length > 500) throw badRequest('Campo "raw" (string até 500 caracteres) obrigatório.');
    res.json(parseGs1(req.body.raw));
  }));

  r.post('/instability/metrics', h(async (req, res) => {
    const { bone = {}, isis = {} } = req.body ?? {};
    if (typeof bone !== 'object' || typeof isis !== 'object') throw badRequest('bone e isis devem ser objetos.');
    res.json(evaluateInstabilityMetrics(bone, isis));
  }));

  r.get('/proms/schedule', h(async (req, res) => {
    res.json(scheduleTimepoints(String(req.query.surgery_date ?? '')));
  }));

  return r;
}

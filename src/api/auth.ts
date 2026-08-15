import { timingSafeEqual } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

function equalSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.INTERNAL_RUNTIME_TOKEN;
  if (!expected) return res.status(503).json({ error: 'Runtime authentication is not configured' });
  const header = req.headers.authorization ?? '';
  const workerToken = req.header('x-ego-runtime-token') ?? '';
  const token = workerToken || (header.startsWith('Bearer ') ? header.slice(7) : '');
  if (!token || !equalSecret(token, expected)) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

export function humanDecisionMiddleware(req: Request, res: Response, next: NextFunction) {
  const expected = process.env.NIGMA_HUMAN_DECISION_TOKEN;
  const runtimeToken = process.env.INTERNAL_RUNTIME_TOKEN;
  if (!expected || expected.length < 32) {
    return res.status(503).json({ error: 'Human-decision authentication is not configured' });
  }
  if (runtimeToken && equalSecret(expected, runtimeToken)) {
    return res.status(503).json({ error: 'Human-decision credential must be independent' });
  }
  const actual = req.header('x-nigma-human-decision-token') ?? '';
  if (!actual || !equalSecret(actual, expected)) {
    return res.status(401).json({ error: 'Human decision unauthorized' });
  }
  next();
}

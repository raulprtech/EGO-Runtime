import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import cors from 'cors';
import runtimeRoutes from './src/api/routes/runtime';
import { createServer as createViteServer } from 'vite';

export async function createApp() {
  const app = express();
  const origins = (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean);
  app.disable('x-powered-by');
  app.use(cors({ origin: origins.length ? origins : false }));
  app.use(express.json({ limit: '256kb' }));
  app.get('/health', (_req, res) => res.json({ status: 'ok', runtime: 'ego-runtime', version: '0.2.0' }));
  app.use('/v1/runtime', runtimeRoutes);
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const dist = path.join(process.cwd(), 'dist');
    app.use(express.static(dist)); app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : 'Internal error';
    res.status(message.includes('validation') ? 400 : 500).json({ error: message });
  });
  return app;
}
if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT ?? 3000);
  createApp().then(app => app.listen(port, '0.0.0.0', () => console.log(`EGO Runtime listening on ${port}`)));
}

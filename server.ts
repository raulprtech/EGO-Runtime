import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import cors from 'cors';
import runtimeRoutes from './src/api/routes/runtime';
import { createServer as createViteServer } from 'vite';
import { ZodError } from 'zod';
import { TaskQueue } from './src/services/task_queue';

export async function createApp() {
  const app = express();
  const origins = (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean);
  app.disable('x-powered-by');
  app.use(cors({ origin: origins.length ? origins : false }));
  app.use(express.json({ limit: '256kb' }));
  app.get('/health', (_req, res) => res.json({
    status: 'ok', runtime: 'ego-runtime', version: '0.4.0',
    backend: process.env.RUNTIME_BACKEND ?? (process.env.NODE_ENV === 'production' ? 'cloud' : 'local'),
    model_provider: process.env.MODEL_PROVIDER ?? 'gemini-adk',
  }));
  app.use('/v1/runtime', runtimeRoutes);
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const dist = path.join(process.cwd(), 'dist');
    app.use(express.static(dist)); app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  void TaskQueue.recoverPendingLocal().catch(error => console.error('Local recovery failed', error));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : 'Internal error';
    res.status(error instanceof ZodError ? 400 : 500).json({ error: message });
  });
  return app;
}
if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT ?? 3000);
  createApp().then(app => app.listen(port, '0.0.0.0', () => console.log(`EGO Runtime listening on ${port}`)));
}

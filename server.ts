import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import express from 'express';
import path from 'node:path';
import cors from 'cors';
import runtimeRoutes from './src/api/routes/runtime';
import transcriptionRoutes from './src/api/routes/transcription';
import speechRoutes from './src/api/routes/speech';
import { createServer as createViteServer } from 'vite';
import { ZodError } from 'zod';
import { TaskQueue } from './src/services/task_queue';
import { isModelProviderConfigured } from './src/runtime/model_provider';

const instanceId = randomUUID();
const protocolVersion = 1;

function backend(): string {
  return process.env.RUNTIME_BACKEND ?? (process.env.NODE_ENV === 'production' ? 'cloud' : 'local');
}

function provider(): string {
  return process.env.MODEL_PROVIDER ?? 'gemini-adk';
}

export async function createApp() {
  const app = express();
  const origins = (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean);
  app.disable('x-powered-by');
  app.disable('etag');
  app.use(cors({
    origin: origins.length ? origins : false,
    exposedHeaders: [
      'X-Speech-Id', 'X-Speech-Provider', 'X-Audio-Sample-Rate',
      'X-Audio-Channels', 'X-Audio-Duration-Ms',
    ],
  }));
  app.use(express.json({ limit: '256kb' }));
  app.get('/health', (_req, res) => res.json({
    status: 'ok',
    runtime: 'ego-runtime',
    version: '0.6.0',
    protocol_version: protocolVersion,
    instance_id: instanceId,
    backend: backend(),
    model_provider: provider(),
    model_configured: isModelProviderConfigured(),
    active_jobs: TaskQueue.activeLocalCount(),
  }));
  app.use('/v1/runtime/transcriptions', transcriptionRoutes);
  app.use('/v1/runtime/speech', speechRoutes);
  app.use('/v1/runtime', runtimeRoutes);
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({ server: { middlewareMode: true }, appType: 'spa' });
    app.use(vite.middlewares);
  } else {
    const dist = path.join(process.cwd(), 'dist');
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
  void TaskQueue.recoverPendingLocal().catch(error => console.error('Local recovery failed', error));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : 'Internal error';
    const tooLarge = typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large';
    res.status(tooLarge ? 413 : error instanceof ZodError ? 400 : 500).json({ error: message });
  });
  return app;
}

export interface RuntimeServer {
  server: Server;
  baseUrl: string;
  instanceId: string;
  stop(reason?: string): Promise<{ drained: boolean; reason: string }>;
}

export async function startServer(options: { port?: number; host?: string; graceMs?: number } = {}): Promise<RuntimeServer> {
  const app = await createApp();
  const port = options.port ?? Number(process.env.PORT ?? 3000);
  const host = options.host ?? process.env.HOST ?? (backend() === 'local' ? '127.0.0.1' : '0.0.0.0');
  const graceMs = options.graceMs ?? Number(process.env.SHUTDOWN_GRACE_MS ?? 30_000);
  const server = app.listen(port, host);
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address() as AddressInfo;
  const publicHost = ['0.0.0.0', '::'].includes(address.address) ? '127.0.0.1' : address.address;
  const baseUrl = `http://${publicHost.includes(':') ? `[${publicHost}]` : publicHost}:${address.port}`;
  let stopping: Promise<{ drained: boolean; reason: string }> | undefined;

  return {
    server,
    baseUrl,
    instanceId,
    stop(reason = 'requested') {
      if (stopping) return stopping;
      stopping = (async () => {
        await new Promise<void>((resolve, reject) => {
          server.close(error => error ? reject(error) : resolve());
        });
        const drained = await TaskQueue.drainLocal(graceMs);
        return { drained, reason };
      })();
      return stopping;
    },
  };
}

if (process.env.NODE_ENV !== 'test') {
  startServer().then(runtime => {
    console.log(JSON.stringify({
      type: 'runtime.ready',
      protocol_version: protocolVersion,
      pid: process.pid,
      instance_id: runtime.instanceId,
      base_url: runtime.baseUrl,
      health_url: `${runtime.baseUrl}/health`,
      backend: backend(),
      model_provider: provider(),
      model_configured: isModelProviderConfigured(),
      shutdown: 'SIGTERM',
    }));

    const shutdown = (signal: NodeJS.Signals) => {
      void runtime.stop(signal).then(result => {
        console.log(JSON.stringify({ type: 'runtime.stopped', ...result }));
        process.exit(result.drained ? 0 : 2);
      }).catch(error => {
        console.error(JSON.stringify({ type: 'runtime.stop_failed', error: error instanceof Error ? error.message : String(error) }));
        process.exit(1);
      });
    };
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
  }).catch(error => {
    console.error(JSON.stringify({ type: 'runtime.start_failed', error: error instanceof Error ? error.message : String(error) }));
    process.exit(1);
  });
}

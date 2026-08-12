import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { startServer } from '../server';
import { resetRuntimeRepositoryForTests } from '../src/services/runtime_repository';

describe('local process protocol', () => {
  let directory = '';

  afterEach(async () => {
    resetRuntimeRepositoryForTests();
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  });

  it('announces health metadata and stops idempotently', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ego-protocol-'));
    process.env.RUNTIME_BACKEND = 'local';
    process.env.LOCAL_DATA_DIR = directory;
    process.env.LOCAL_INPUT_ROOT = directory;
    process.env.INTERNAL_RUNTIME_TOKEN = 'protocol-token';
    resetRuntimeRepositoryForTests();

    const runtime = await startServer({ port: 0, host: '127.0.0.1', graceMs: 500 });
    const health = await fetch(`${runtime.baseUrl}/health`);
    expect(health.ok).toBe(true);
    expect(await health.json()).toMatchObject({
      status: 'ok',
      runtime: 'ego-runtime',
      protocol_version: 1,
      instance_id: runtime.instanceId,
      backend: 'local',
      model_configured: Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY),
      active_jobs: 0,
    });

    const first = runtime.stop('test');
    const second = runtime.stop('ignored');
    expect(second).toBe(first);
    await expect(first).resolves.toEqual({ drained: true, reason: 'test' });
  });
});

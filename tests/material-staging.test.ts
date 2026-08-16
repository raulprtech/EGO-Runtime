import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../server';
import { MaterialStore, MaterialStoreError } from '../src/services/material_store';

const ENV_KEYS = [
  'RUNTIME_BACKEND', 'LOCAL_INPUT_ROOT', 'LOCAL_MATERIAL_STAGING_ROOT',
  'MAX_STAGED_MATERIAL_BYTES', 'INTERNAL_RUNTIME_TOKEN', 'NODE_ENV',
];

describe('runtime-owned material staging', () => {
  let directory = '';
  let oldEnvironment: Record<string, string | undefined> = {};

  beforeEach(async () => {
    oldEnvironment = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
    directory = await fs.mkdtemp('/tmp/ego-material-');
    process.env.RUNTIME_BACKEND = 'local';
    process.env.LOCAL_INPUT_ROOT = directory;
    process.env.INTERNAL_RUNTIME_TOKEN = 'material-runtime-token';
    process.env.NODE_ENV = 'test';
  });

  afterEach(async () => {
    for (const key of ENV_KEYS) {
      const value = oldEnvironment[key];
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await fs.rm(directory, { recursive: true, force: true });
  });

  const input = (bytes = Buffer.from('# Photosynthesis\nPlants store light energy.')) => ({
    bytes, name: '../lesson.md', mediaType: 'text/markdown',
    ownerRef: 'profile:aria', idempotencyKey: 'attachment-local-1',
  });

  it('stages owner-only content and recovers the exact record idempotently', async () => {
    const first = await MaterialStore.stage(input());
    const second = await MaterialStore.stage(input());
    const recovered = await MaterialStore.get(first.record.material_id, 'profile:aria');
    const target = fileURLToPath(first.record.uri);

    expect(first.disposition).toBe('staged');
    expect(second).toEqual({ record: first.record, disposition: 'already_staged' });
    expect(recovered).toEqual(first.record);
    expect(first.record).toMatchObject({
      protocol_version: 'ego.material-record/v1', name: 'lesson.md',
      media_type: 'text/markdown', size_bytes: input().bytes.length,
      permission: 'read:referenced-learning-materials', status: 'active',
      released_at: null,
    });
    expect(first.record.uri.startsWith('file://')).toBe(true);
    expect(JSON.stringify(first.record)).not.toContain('profile:aria');
    expect((await fs.stat(target)).mode & 0o777).toBe(0o600);
    expect((await fs.stat(path.join(path.dirname(target), 'record.json'))).mode & 0o777).toBe(0o600);
    expect(await fs.readFile(target, 'utf8')).toContain('Photosynthesis');
  });

  it('binds idempotency to bytes and owner while rejecting unsafe configuration', async () => {
    await MaterialStore.stage(input());
    await expect(MaterialStore.stage(input(Buffer.from('changed'))))
      .rejects.toMatchObject({ code: 'MATERIAL_IDEMPOTENCY_CONFLICT', status: 409 });
    const staged = await MaterialStore.stage({ ...input(), idempotencyKey: 'attachment-local-2' });
    await expect(MaterialStore.get(staged.record.material_id, 'profile:other'))
      .rejects.toMatchObject({ code: 'MATERIAL_OWNER_MISMATCH', status: 403 });

    process.env.LOCAL_MATERIAL_STAGING_ROOT = path.join(directory, '..', 'escaped-materials');
    await expect(MaterialStore.stage({ ...input(), idempotencyKey: 'attachment-local-3' }))
      .rejects.toMatchObject({ code: 'MATERIAL_ROOT_UNSAFE', status: 503 });
  });

  it('detects tampering and retains a restart-readable tombstone after release', async () => {
    const staged = await MaterialStore.stage(input());
    const target = fileURLToPath(staged.record.uri);
    await fs.writeFile(target, 'tampered');
    await expect(MaterialStore.get(staged.record.material_id, 'profile:aria'))
      .rejects.toMatchObject({ code: 'MATERIAL_CONTENT_INVALID', status: 500 });
    await fs.writeFile(target, input().bytes, { mode: 0o600 });

    const released = await MaterialStore.release(staged.record.material_id, 'profile:aria');
    const replay = await MaterialStore.release(staged.record.material_id, 'profile:aria');
    expect(released.status).toBe('released');
    expect(released.released_at).toBeTruthy();
    expect(replay).toEqual(released);
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await MaterialStore.get(staged.record.material_id, 'profile:aria')).toEqual(released);
  });

  it('exposes authenticated binary staging without approval or execution', async () => {
    const app = await createApp();
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server did not bind');
    const base = `http://127.0.0.1:${address.port}`;
    try {
      const unauthorized = await fetch(`${base}/v1/runtime/materials`, {
        method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body: input().bytes,
      });
      expect(unauthorized.status).toBe(401);

      const response = await fetch(`${base}/v1/runtime/materials`, {
        method: 'POST',
        headers: {
          authorization: 'Bearer material-runtime-token',
          'content-type': 'application/octet-stream',
          'x-material-name': encodeURIComponent('lesson.md'),
          'x-material-media-type': 'text/markdown',
          'x-material-owner': encodeURIComponent('profile:aria'),
          'idempotency-key': 'attachment-http-1',
        },
        body: input().bytes,
      });
      expect(response.status).toBe(201);
      const payload = await response.json() as Record<string, any>;
      expect(payload).toMatchObject({
        protocol_version: 'ego.material-staging/v1', disposition: 'staged',
        approval_granted: false, execution_performed: false,
        material: { status: 'active', permission: 'read:referenced-learning-materials' },
      });
      expect(JSON.stringify(payload)).not.toContain('material-runtime-token');
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });

  it('rejects unsupported formats, oversized content and cloud staging', async () => {
    await expect(MaterialStore.stage({ ...input(), name: 'lesson.docx', mediaType: 'application/msword' }))
      .rejects.toMatchObject({ code: 'MATERIAL_TYPE_UNSUPPORTED', status: 415 });
    process.env.MAX_STAGED_MATERIAL_BYTES = '4';
    await expect(MaterialStore.stage(input(Buffer.from('12345'))))
      .rejects.toMatchObject({ code: 'MATERIAL_SIZE_INVALID', status: 413 });
    process.env.RUNTIME_BACKEND = 'cloud';
    await expect(MaterialStore.stage({ ...input(), idempotencyKey: 'attachment-cloud-1' }))
      .rejects.toBeInstanceOf(MaterialStoreError);
  });
});

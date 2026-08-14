import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server';
import {
  NigmaAdapterPolicySchema,
  NigmaInvocationEnvelopeSchema,
  nigmaInvocationDigest,
  setNigmaAdapterPolicyForTests,
} from '../src/runtime/nigma_handoff';
import {
  NigmaHostRoutesSchema,
  setNigmaHostRoutesForTests,
} from '../src/runtime/nigma_host';
import { resetRuntimeRepositoryForTests } from '../src/services/runtime_repository';

async function listen(app: express.Express) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve())),
  };
}

async function fixture() {
  return JSON.parse(await fs.readFile(
    new URL('./fixtures/nigma-handoff-v1.json', import.meta.url), 'utf8',
  )) as { invocation: unknown; ego_policy: unknown };
}

describe('Nigma host feedback loop', () => {
  const closers: Array<() => Promise<void>> = [];
  let directory = '';

  afterEach(async () => {
    while (closers.length) await closers.pop()?.();
    setNigmaAdapterPolicyForTests(undefined);
    setNigmaHostRoutesForTests(undefined);
    resetRuntimeRepositoryForTests();
    for (const name of [
      'RUNTIME_BACKEND', 'LOCAL_INPUT_ROOT', 'LOCAL_DATA_DIR', 'INTERNAL_RUNTIME_TOKEN',
      'NIGMA_HANDOFF_ENABLED', 'NIGMA_CONTROL_PLANE_URL', 'NIGMA_CONTROL_PLANE_API_KEY',
      'NIGMA_HOST_TIMEOUT_MS', 'NIGMA_HOST_POLL_INTERVAL_MS', 'NIGMA_RUNTIME_TOKEN_EGO',
      'MODEL_PROVIDER',
    ]) delete process.env[name];
    if (directory) await fs.rm(directory, { recursive: true, force: true });
    directory = '';
  });

  it('transports an approved plan, executes it and posts the live receipt back exactly once', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ego-nigma-host-'));
    const inputRoot = path.join(directory, 'inputs');
    await fs.mkdir(inputRoot);
    const source = path.join(inputRoot, 'learning.md');
    await fs.writeFile(source, '# Spaced retrieval\nRetrieval improves durable learning.');

    const value = await fixture();
    const original = NigmaInvocationEnvelopeSchema.parse(value.invocation);
    const now = new Date();
    const changed = NigmaInvocationEnvelopeSchema.parse({
      ...original,
      input_references: [{ uri: pathToFileURL(source).href, media_type: 'text/markdown' }],
      created_at: now.toISOString(),
      must_start_before: new Date(now.getTime() + 60_000).toISOString(),
      digest: '0'.repeat(64),
    });
    const invocation = { ...changed, digest: nigmaInvocationDigest(changed) };
    let invocationRequests = 0;
    const receipts: unknown[] = [];
    const control = express();
    control.use(express.json({ limit: '256kb' }));
    control.post('/integration-plans/:plan_id/runtime-invocations', (req, res) => {
      expect(req.header('x-api-key')).toBe('control-test-key');
      expect(req.header('idempotency-key')).toBe('host-run-1');
      expect(req.params.plan_id).toBe(invocation.plan_id);
      invocationRequests += 1;
      res.json(invocation);
    });
    control.post('/runtime-invocations/:invocation_id/receipts', (req, res) => {
      expect(req.header('x-api-key')).toBe('control-test-key');
      expect(req.params.invocation_id).toBe(invocation.id);
      receipts.push(req.body);
      res.json({
        ...req.body,
        id: 'accepted-receipt-1',
        validation_evidence: ['host-loop:test'],
        digest: 'd'.repeat(64),
        accepted_at: new Date().toISOString(),
      });
    });
    const controlServer = await listen(control);
    closers.push(controlServer.close);

    process.env.RUNTIME_BACKEND = 'local';
    process.env.LOCAL_INPUT_ROOT = inputRoot;
    process.env.LOCAL_DATA_DIR = path.join(directory, 'data');
    process.env.INTERNAL_RUNTIME_TOKEN = 'runtime-test-token';
    process.env.NIGMA_RUNTIME_TOKEN_EGO = 'runtime-test-token';
    process.env.NIGMA_HANDOFF_ENABLED = 'true';
    process.env.NIGMA_CONTROL_PLANE_URL = controlServer.baseUrl;
    process.env.NIGMA_CONTROL_PLANE_API_KEY = 'control-test-key';
    process.env.NIGMA_HOST_TIMEOUT_MS = '5000';
    process.env.NIGMA_HOST_POLL_INTERVAL_MS = '10';
    process.env.MODEL_PROVIDER = 'deterministic-demo';
    setNigmaAdapterPolicyForTests(NigmaAdapterPolicySchema.parse(value.ego_policy));
    resetRuntimeRepositoryForTests();

    const runtime = await listen(await createApp());
    closers.push(runtime.close);
    setNigmaHostRoutesForTests(NigmaHostRoutesSchema.parse({
      protocol_version: 'nigma.host-routes/v1',
      routes: [{
        runtime_id: invocation.runtime_id,
        runtime_version: invocation.runtime_version,
        base_url: `${runtime.baseUrl}/v1/runtime`,
        credential_env: 'NIGMA_RUNTIME_TOKEN_EGO',
      }],
    }));

    const body = {
      plan_id: invocation.plan_id,
      learner_context: {
        user_id: 'learner_1', session_id: 'session_1', objective_id: 'objective_1',
      },
    };
    const headers = {
      Authorization: 'Bearer runtime-test-token',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'host-run-1',
    };
    const response = await fetch(`${runtime.baseUrl}/v1/runtime/nigma/host-runs`, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      protocol_version: 'nigma.host-run-result/v1',
      plan_id: invocation.plan_id,
      invocation_id: invocation.id,
      runtime_id: 'ego-runtime',
      runtime_version: '0.9.0',
      runtime_submission_status: 'accepted',
      receipt_id: 'accepted-receipt-1',
      status: 'succeeded',
      events: [
        { sequence: 1, kind: 'request_received' },
        { sequence: 2, kind: 'invocation_authorized' },
        { sequence: 3, kind: 'runtime_routed' },
        { sequence: 4, kind: 'runtime_accepted' },
        { sequence: 5, kind: 'runtime_terminal' },
        { sequence: 6, kind: 'receipt_observed' },
        { sequence: 7, kind: 'receipt_recorded' },
        { sequence: 8, kind: 'run_completed', status: 'succeeded' },
      ],
    });
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      invocation_id: invocation.id,
      invocation_digest: invocation.digest,
      status: 'succeeded',
      artifacts: expect.arrayContaining([
        expect.objectContaining({ uri: expect.stringContaining('study_plan.json') }),
        expect.objectContaining({ uri: expect.stringContaining('mastery_state.json') }),
      ]),
      mastery_refs: [expect.objectContaining({ uri: expect.stringContaining('mastery_state.json') })],
    });

    const replay = await fetch(`${runtime.baseUrl}/v1/runtime/nigma/host-runs`, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    await expect(replay.json()).resolves.toMatchObject({
      runtime_submission_status: 'already_accepted', receipt_id: 'accepted-receipt-1',
      events: expect.arrayContaining([
        expect.objectContaining({ kind: 'runtime_accepted', replayed: true }),
      ]),
    });
    expect(invocationRequests).toBe(2);
    expect(receipts).toHaveLength(2);
    expect(receipts[1]).toEqual(receipts[0]);
  });

  it('cannot proceed when Nigma has not issued an approved invocation', async () => {
    const control = express();
    control.use(express.json());
    control.post('/integration-plans/:plan_id/runtime-invocations', (_req, res) => {
      res.status(403).json({ error: { code: 'approval_required', message: 'approval required' } });
    });
    const controlServer = await listen(control);
    closers.push(controlServer.close);
    process.env.INTERNAL_RUNTIME_TOKEN = 'runtime-test-token';
    process.env.NIGMA_CONTROL_PLANE_URL = controlServer.baseUrl;
    process.env.NIGMA_CONTROL_PLANE_API_KEY = 'control-test-key';

    const runtime = await listen(await createApp());
    closers.push(runtime.close);
    const response = await fetch(`${runtime.baseUrl}/v1/runtime/nigma/host-runs`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer runtime-test-token',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'unapproved-run',
      },
      body: JSON.stringify({
        plan_id: 'unapproved-plan',
        learner_context: { user_id: 'u', session_id: 's', objective_id: 'o' },
      }),
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: 'NIGMA_HOST_UPSTREAM_REJECTED',
      message: expect.stringContaining('approval_required'),
    });
  });
});

import { createHash } from 'node:crypto';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server';
import {
  NigmaHostRoutesSchema,
  setNigmaHostRoutesForTests,
} from '../src/runtime/nigma_host';

async function listen(app: express.Express) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve())),
  };
}

const digest = (value: string) => value.repeat(64).slice(0, 64);

async function invocationFixture() {
  const value = JSON.parse(await fs.readFile(
    new URL('./fixtures/nigma-handoff-v1.json', import.meta.url), 'utf8',
  )) as { invocation: Record<string, unknown> };
  return value.invocation;
}

function replacementPreparation(objective: string) {
  const plan = { id: 'fallback-plan-1', digest: digest('1') };
  const plugin = { id: 'fallback-plugin-1', digest: digest('2') };
  const provider = { id: 'fallback-provider-1', digest: digest('3') };
  const route = { id: 'fallback-route-1', digest: digest('4') };
  return {
    protocol_version: 'nigma.educational-task-preparation/v1',
    status: 'awaiting_human_approval',
    capability_request: { id: 'fallback-request-1', objective },
    integration_plan: {
      ...plan,
      request_id: 'fallback-request-1',
      confidence: 0.7,
      risk_level: 'medium',
      runtime_selection: {
        id: 'fallback-selection-1',
        digest: digest('5'),
        selected_snapshot_id: 'hermes-runtime@0.20.0',
        selected_snapshot_digest: digest('6'),
        selected_runtime_id: 'hermes-runtime',
        selected_runtime_version: '0.20.0',
      },
    },
    plugin_selection: { ...plugin, status: 'selected' },
    provider_binding: { ...provider, status: 'ready' },
    agent_route: {
      ...route,
      plan_id: plan.id,
      plan_digest: plan.digest,
      runtime_selection_id: 'fallback-selection-1',
      runtime_selection_digest: digest('5'),
      plugin_selection_id: plugin.id,
      plugin_selection_digest: plugin.digest,
      provider_binding_id: provider.id,
      provider_binding_digest: provider.digest,
      runtime_id: 'hermes-runtime',
      runtime_version: '0.20.0',
      runtime_snapshot_id: 'hermes-runtime@0.20.0',
      runtime_snapshot_digest: digest('6'),
      status: 'ready',
      approval_granted: false,
      execution_performed: false,
    },
    approval_target: {
      scope: 'execute',
      plan_id: plan.id,
      plan_digest: plan.digest,
      agent_route_id: route.id,
      agent_route_digest: route.digest,
      plugin_selection_id: plugin.id,
      plugin_selection_digest: plugin.digest,
      provider_binding_id: provider.id,
      provider_binding_digest: provider.digest,
    },
    approval_granted: false,
    execution_performed: false,
  };
}

describe('Nigma host runtime fallback', () => {
  const closers: Array<() => Promise<void>> = [];
  let directory = '';

  afterEach(async () => {
    while (closers.length) await closers.pop()?.();
    setNigmaHostRoutesForTests(undefined);
    for (const name of [
      'INTERNAL_RUNTIME_TOKEN', 'LOCAL_DATA_DIR', 'NIGMA_CONTROL_PLANE_URL',
      'NIGMA_CONTROL_PLANE_API_KEY', 'NIGMA_HOST_TIMEOUT_MS',
      'NIGMA_HOST_POLL_INTERVAL_MS', 'NIGMA_RUNTIME_TOKEN_PRIMARY',
    ]) delete process.env[name];
    if (directory) await fs.rm(directory, { recursive: true, force: true });
    directory = '';
  });

  async function configuredHost(control: express.Express, runtimeBaseUrl: string) {
    const invocation = await invocationFixture();
    const controlServer = await listen(control);
    closers.push(controlServer.close);
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ego-g13-fallback-'));
    process.env.INTERNAL_RUNTIME_TOKEN = 'host-test-token';
    process.env.LOCAL_DATA_DIR = path.join(directory, 'data');
    process.env.NIGMA_CONTROL_PLANE_URL = controlServer.baseUrl;
    process.env.NIGMA_CONTROL_PLANE_API_KEY = 'control-test-key';
    process.env.NIGMA_RUNTIME_TOKEN_PRIMARY = 'runtime-test-token';
    process.env.NIGMA_HOST_TIMEOUT_MS = '1000';
    process.env.NIGMA_HOST_POLL_INTERVAL_MS = '10';
    setNigmaHostRoutesForTests(NigmaHostRoutesSchema.parse({
      protocol_version: 'nigma.host-routes/v1',
      routes: [{
        runtime_id: invocation.runtime_id,
        runtime_version: invocation.runtime_version,
        base_url: runtimeBaseUrl,
        credential_env: 'NIGMA_RUNTIME_TOKEN_PRIMARY',
      }],
    }));
    const host = await listen(await createApp());
    closers.push(host.close);
    return { host, invocation };
  }

  const auth = {
    Authorization: 'Bearer host-test-token',
    'Content-Type': 'application/json',
  };

  it('turns a sealed pre-acceptance transport failure into a new approval target', async () => {
    const invocation = await invocationFixture();
    const control = express();
    control.use(express.json());
    let fallbackCalls = 0;
    control.post('/integration-plans/:plan_id/runtime-invocations', (_req, res) => {
      res.json(invocation);
    });
    control.post('/runtime-invocations/:invocation_id/fallbacks', (req, res) => {
      fallbackCalls += 1;
      expect(req.params.invocation_id).toBe(invocation.id);
      expect(req.header('idempotency-key')).toBe('fallback-key-1');
      expect(req.body).toMatchObject({
        failure_code: 'runtime_unreachable',
        evidence_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
      });
      res.json({
        protocol_version: 'nigma.educational-runtime-fallback/v1',
        id: 'runtime-fallback-12345678',
        source_invocation_id: invocation.id,
        source_invocation_digest: invocation.digest,
        source_execution_id: invocation.execution_id,
        source_plan_id: invocation.plan_id,
        source_plan_digest: invocation.plan_digest,
        failed_runtime_id: invocation.runtime_id,
        failed_runtime_version: invocation.runtime_version,
        failed_runtime_snapshot_id: invocation.runtime_snapshot_id,
        failed_runtime_snapshot_digest: invocation.runtime_snapshot_digest,
        failure_code: req.body.failure_code,
        observed_at: req.body.observed_at,
        evidence_digest: req.body.evidence_digest,
        excluded_runtime_ids: [invocation.runtime_id],
        preparation: replacementPreparation(String(invocation.objective)),
        status: 'awaiting_human_approval',
        approval_granted: false,
        execution_performed: false,
        digest: digest('7'),
        created_at: new Date().toISOString(),
      });
    });
    const { host } = await configuredHost(control, 'http://127.0.0.1:1');
    const primaryKey = 'unreachable-primary-1';
    const failed = await fetch(`${host.baseUrl}/v1/runtime/nigma/host-runs`, {
      method: 'POST',
      headers: { ...auth, 'Idempotency-Key': primaryKey },
      body: JSON.stringify({
        plan_id: invocation.plan_id,
        learner_context: { user_id: 'u', session_id: 's', objective_id: 'o' },
      }),
    });
    expect(failed.status).toBe(502);
    await expect(failed.json()).resolves.toMatchObject({
      error: 'NIGMA_HOST_TRANSPORT_FAILED',
    });
    const hostRunId = `host-${createHash('sha256')
      .update(`${invocation.plan_id}:${primaryKey}`).digest('hex').slice(0, 32)}`;

    const response = await fetch(
      `${host.baseUrl}/v1/runtime/nigma/host-runs/${hostRunId}/fallbacks`,
      {
        method: 'POST',
        headers: { ...auth, 'Idempotency-Key': 'fallback-key-1' },
        body: '{}',
      },
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      protocol_version: 'nigma.host-fallback-preparation/v1',
      host_run_id: hostRunId,
      fallback_id: 'runtime-fallback-12345678',
      status: 'awaiting_human_approval',
      failure: { code: 'runtime_unreachable' },
      failed_runtime: { id: 'ego-runtime', version: '0.9.0' },
      replacement: {
        protocol_version: 'nigma.host-preparation/v1',
        status: 'awaiting_human_approval',
        runtime: { id: 'hermes-runtime', version: '0.20.0' },
        resume: { path: '/v1/runtime/nigma/host-runs', plan_id: 'fallback-plan-1' },
        approval_granted: false,
        execution_performed: false,
      },
      approval_granted: false,
      execution_performed: false,
    });
    expect(fallbackCalls).toBe(1);

    const bodyRejected = await fetch(
      `${host.baseUrl}/v1/runtime/nigma/host-runs/${hostRunId}/fallbacks`,
      {
        method: 'POST',
        headers: { ...auth, 'Idempotency-Key': 'fallback-key-2' },
        body: JSON.stringify({ failure_code: 'runtime_rejected' }),
      },
    );
    expect(bodyRejected.status).toBe(400);
    expect(fallbackCalls).toBe(1);
  });

  it('refuses fallback once a runtime accepted the invocation', async () => {
    const invocation = await invocationFixture();
    const selected = express();
    selected.use(express.json());
    selected.post('/nigma/invocations', (_req, res) => res.json({
      invocation_id: invocation.id,
      invocation_digest: invocation.digest,
      runtime_run_id: invocation.id,
      status: 'accepted',
    }));
    selected.get(`/${invocation.id}`, (_req, res) => res.json({
      request_id: invocation.id, status: 'running',
    }));
    const selectedServer = await listen(selected);
    closers.push(selectedServer.close);

    const control = express();
    control.use(express.json());
    let fallbackCalls = 0;
    control.post('/integration-plans/:plan_id/runtime-invocations', (_req, res) => {
      res.json(invocation);
    });
    control.post('/runtime-invocations/:invocation_id/fallbacks', (_req, res) => {
      fallbackCalls += 1;
      res.status(500).json({ error: 'must_not_be_called' });
    });
    const { host } = await configuredHost(control, selectedServer.baseUrl);
    const primaryKey = 'accepted-timeout-1';
    const failed = await fetch(`${host.baseUrl}/v1/runtime/nigma/host-runs`, {
      method: 'POST',
      headers: { ...auth, 'Idempotency-Key': primaryKey },
      body: JSON.stringify({
        plan_id: invocation.plan_id,
        learner_context: { user_id: 'u', session_id: 's', objective_id: 'o' },
      }),
    });
    expect(failed.status).toBe(504);
    const hostRunId = `host-${createHash('sha256')
      .update(`${invocation.plan_id}:${primaryKey}`).digest('hex').slice(0, 32)}`;
    const fallback = await fetch(
      `${host.baseUrl}/v1/runtime/nigma/host-runs/${hostRunId}/fallbacks`,
      {
        method: 'POST',
        headers: { ...auth, 'Idempotency-Key': 'unsafe-fallback' },
        body: '{}',
      },
    );
    expect(fallback.status).toBe(409);
    await expect(fallback.json()).resolves.toMatchObject({
      error: 'NIGMA_HOST_FALLBACK_NOT_ALLOWED',
    });
    expect(fallbackCalls).toBe(0);
  });
});

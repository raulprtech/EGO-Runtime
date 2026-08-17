import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server';
import {
  createHermesDecisionBinding,
  readHermesDecisionBindingFile,
  scanHermesDecisionBinding,
  scanHermesExecutionBinding,
  writeHermesDecisionBindingFile,
} from '../src/integrations/hermes_decision_adapter';
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
import { canonicalJson, sha256 } from '../src/runtime/integrity';
import { resetRuntimeRepositoryForTests } from '../src/services/runtime_repository';

const hex = (value: string) => value.repeat(64).slice(0, 64);
const runtimeToken = 'runtime-g116-golden-token';
const humanToken = 'human-g116-golden-token-that-is-independent';

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

async function fixture() {
  return JSON.parse(await fs.readFile(
    new URL('./fixtures/nigma-handoff-v1.json', import.meta.url), 'utf8',
  )) as { invocation: unknown; ego_policy: unknown };
}

function runtimeExplanation(invocation: any) {
  const factors = [{
    dimension: 'reliability',
    selected_weighted_score_ppm: 600_000,
    runner_up_weighted_score_ppm: null,
    delta_ppm: 600_000,
  }];
  const core = {
    protocol_version: 'nigma.runtime-decision-explanation/v1' as const,
    algorithm_version: 'runtime-decision-explanation-v1' as const,
    selection_id: invocation.runtime_selection_id,
    selection_digest: invocation.runtime_selection_digest,
    selected: {
      runtime_id: invocation.runtime_id,
      runtime_version: invocation.runtime_version,
      snapshot_id: invocation.runtime_snapshot_id,
      snapshot_digest: invocation.runtime_snapshot_digest,
      total_score_ppm: 600_000,
      evidence_basis: 'declared_only' as const,
    },
    runner_up: null,
    eligible_candidate_count: 1,
    excluded_candidate_count: 0,
    score_margin_ppm: 600_000,
    factors,
    reason_codes: [
      'highest_eligible_score',
      'all_hard_constraints_satisfied',
      'human_approval_required',
    ] as const,
    authority: 'human_approval_required' as const,
    approval_granted: false as const,
    execution_performed: false as const,
    created_at: '2026-08-15T18:00:00Z',
  };
  const digest = sha256(canonicalJson(core));
  return {
    ...core,
    id: `runtime-decision-explanation-${digest.slice(0, 16)}`,
    digest,
  };
}

function preparation(invocation: any, objective: string) {
  const route = invocation.agent_route;
  return {
    protocol_version: 'nigma.educational-task-preparation/v1',
    status: 'awaiting_human_approval',
    capability_request: { id: invocation.request_id, objective },
    integration_plan: {
      id: invocation.plan_id,
      digest: invocation.plan_digest,
      request_id: invocation.request_id,
      confidence: 1,
      risk_level: 'medium',
      runtime_selection: {
        id: invocation.runtime_selection_id,
        digest: invocation.runtime_selection_digest,
        selected_snapshot_id: invocation.runtime_snapshot_id,
        selected_snapshot_digest: invocation.runtime_snapshot_digest,
        selected_runtime_id: invocation.runtime_id,
        selected_runtime_version: invocation.runtime_version,
      },
    },
    runtime_explanation: runtimeExplanation(invocation),
    plugin_selection: {
      id: route.plugin_selection_id,
      digest: route.plugin_selection_digest,
      status: 'selected',
    },
    provider_binding: {
      id: route.provider_binding_id,
      digest: route.provider_binding_digest,
      status: 'ready',
    },
    agent_route: {
      id: route.agent_route_id,
      digest: route.agent_route_digest,
      plan_id: invocation.plan_id,
      plan_digest: invocation.plan_digest,
      runtime_selection_id: invocation.runtime_selection_id,
      runtime_selection_digest: invocation.runtime_selection_digest,
      plugin_selection_id: route.plugin_selection_id,
      plugin_selection_digest: route.plugin_selection_digest,
      provider_binding_id: route.provider_binding_id,
      provider_binding_digest: route.provider_binding_digest,
      runtime_id: invocation.runtime_id,
      runtime_version: invocation.runtime_version,
      runtime_snapshot_id: invocation.runtime_snapshot_id,
      runtime_snapshot_digest: invocation.runtime_snapshot_digest,
      status: 'ready',
      approval_granted: false,
      execution_performed: false,
    },
    approval_target: {
      scope: 'execute',
      plan_id: invocation.plan_id,
      plan_digest: invocation.plan_digest,
      agent_route_id: route.agent_route_id,
      agent_route_digest: route.agent_route_digest,
      plugin_selection_id: route.plugin_selection_id,
      plugin_selection_digest: route.plugin_selection_digest,
      provider_binding_id: route.provider_binding_id,
      provider_binding_digest: route.provider_binding_digest,
    },
    approval_granted: false,
    execution_performed: false,
  };
}

describe('G1.16 isolated Hermes execution golden', () => {
  const closers: Array<() => Promise<void>> = [];
  let directory = '';

  afterEach(async () => {
    while (closers.length) await closers.pop()?.();
    setNigmaAdapterPolicyForTests(undefined);
    setNigmaHostRoutesForTests(undefined);
    resetRuntimeRepositoryForTests();
    for (const name of [
      'RUNTIME_BACKEND', 'LOCAL_INPUT_ROOT', 'LOCAL_DATA_DIR',
      'INTERNAL_RUNTIME_TOKEN', 'NIGMA_HUMAN_DECISION_TOKEN',
      'NIGMA_HANDOFF_ENABLED', 'NIGMA_CONTROL_PLANE_URL',
      'NIGMA_CONTROL_PLANE_API_KEY', 'NIGMA_HOST_TIMEOUT_MS',
      'NIGMA_HOST_POLL_INTERVAL_MS', 'NIGMA_RUNTIME_TOKEN_EGO',
      'MODEL_PROVIDER',
    ]) delete process.env[name];
    if (directory) await fs.rm(directory, { recursive: true, force: true });
    directory = '';
  });

  it('runs one exact second turn through EGO and seals one terminal receipt', async () => {
    directory = await fs.mkdtemp(path.join('/tmp', 'ego-g116-golden-'));
    const inputRoot = path.join(directory, 'inputs');
    await fs.mkdir(inputRoot);
    const source = path.join(inputRoot, 'learning.md');
    await fs.writeFile(source, '# Retrieval practice\nActive recall improves retention.');

    const value = await fixture();
    const original = NigmaInvocationEnvelopeSchema.parse(value.invocation);
    const start = new Date();
    const approvalAt = new Date(start.getTime() + 1_000);
    const executionAt = new Date(start.getTime() + 2_000);
    const approvalExpiresAt = new Date(start.getTime() + 30 * 60_000).toISOString();
    const changed = NigmaInvocationEnvelopeSchema.parse({
      ...original,
      approval_id: 'approval-g116-golden-1',
      input_references: [{
        uri: pathToFileURL(source).href,
        media_type: 'text/markdown',
        schema_ref: 'schema://learning-material/v1',
      }],
      created_at: start.toISOString(),
      must_start_before: '2035-01-01T00:00:00Z',
      digest: hex('0'),
    });
    const invocation = { ...changed, digest: nigmaInvocationDigest(changed) };
    const objective = 'Crear un plan de estudio aislado desde una nota local';
    const prepared = preparation(invocation, objective);
    const approvals: unknown[] = [];
    const receipts: unknown[] = [];
    let invocationRequests = 0;

    const control = express();
    control.use(express.json({ limit: '256kb' }));
    control.post('/educational-tasks/prepare', (_req, res) => res.json(prepared));
    control.post('/integration-plans/:plan_id/approvals', (req, res) => {
      approvals.push(req.body);
      res.json({
        ...req.body,
        id: invocation.approval_id,
        plan_id: req.params.plan_id,
        created_at: approvalAt.toISOString(),
      });
    });
    control.post('/integration-plans/:plan_id/runtime-invocations', (req, res) => {
      expect(req.params.plan_id).toBe(invocation.plan_id);
      expect(req.header('idempotency-key'))
        .toMatch(/^conversation-execution-[a-f0-9]{40}$/);
      invocationRequests += 1;
      res.json(invocation);
    });
    control.post('/runtime-invocations/:invocation_id/receipts', (req, res) => {
      receipts.push(req.body);
      res.json({
        ...req.body,
        id: 'accepted-receipt-g116-1',
        digest: hex('e'),
        accepted_at: new Date(executionAt.getTime() + 2_000).toISOString(),
      });
    });
    const controlServer = await listen(control);
    closers.push(controlServer.close);

    process.env.RUNTIME_BACKEND = 'local';
    process.env.LOCAL_INPUT_ROOT = inputRoot;
    process.env.LOCAL_DATA_DIR = path.join(directory, 'data');
    process.env.INTERNAL_RUNTIME_TOKEN = runtimeToken;
    process.env.NIGMA_HUMAN_DECISION_TOKEN = humanToken;
    process.env.NIGMA_RUNTIME_TOKEN_EGO = runtimeToken;
    process.env.NIGMA_HANDOFF_ENABLED = 'true';
    process.env.NIGMA_CONTROL_PLANE_URL = controlServer.baseUrl;
    process.env.NIGMA_CONTROL_PLANE_API_KEY = 'control-g116-key';
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
    const headers = {
      Authorization: `Bearer ${runtimeToken}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': 'prepare-g116-golden-1',
    };
    const prepareResponse = await fetch(
      `${runtime.baseUrl}/v1/runtime/nigma/educational-tasks/prepare`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          objective,
          materials: [{
            uri: pathToFileURL(source).href,
            media_type: 'text/markdown',
            schema_ref: 'schema://learning-material/v1',
          }],
          project: 'g116-isolated',
          max_duration_seconds: 600,
          presentation_locale: 'es-MX',
          required_runtime_capabilities: ['educational_execution'],
        }),
      },
    );
    expect(prepareResponse.status).toBe(200);
    const hostPreparation = await prepareResponse.json() as any;
    const adapterConfig = {
      hermesBaseUrl: 'http://127.0.0.1:8642',
      hermesApiKey: 'hermes-g116-key',
      hermesProfile: 'aria',
      egoBaseUrl: runtime.baseUrl,
      egoRuntimeToken: runtimeToken,
      humanDecisionToken: humanToken,
    };
    const initial = createHermesDecisionBinding(
      hostPreparation,
      'aria-primary-g116',
      { data: [{ id: 'baseline-g116-1', role: 'user', content: 'Hola' }] },
      'local-owner',
      approvalExpiresAt,
      start,
      'aria',
      hex('f'),
    );
    const approved = await scanHermesDecisionBinding(
      initial,
      'aria-primary-g116',
      { data: [
        { id: 'baseline-g116-1', role: 'user', content: 'Hola' },
        {
          id: 'approval-g116-message-1',
          role: 'user',
          content: hostPreparation.interface_projection.approval_phrase,
        },
      ] },
      adapterConfig,
      approvalAt,
    );
    expect(approved.outcome).toBe('approval_recorded');
    if (approved.outcome !== 'approval_recorded') throw new Error('unreachable');
    expect(approvals).toHaveLength(1);
    expect(invocationRequests).toBe(0);
    expect(receipts).toHaveLength(0);

    const executed = await scanHermesExecutionBinding(
      approved.binding,
      'aria-primary-g116',
      { data: [
        {
          id: 'approval-g116-message-1',
          role: 'user',
          content: hostPreparation.interface_projection.approval_phrase,
        },
        {
          id: 'execution-g116-message-1',
          role: 'user',
          content: approved.approval.execution_authorization.phrase,
        },
      ] },
      adapterConfig,
      executionAt,
    );
    expect(executed.outcome).toBe('execution_recorded');
    if (executed.outcome !== 'execution_recorded') throw new Error('unreachable');
    expect(executed.binding).toMatchObject({
      state: 'executed',
      execution: {
        host_run_status: 'succeeded',
      },
    });
    expect(executed.execution).toMatchObject({
      approval_id: invocation.approval_id,
      host_run_status: 'succeeded',
      execution_performed: true,
    });
    expect(invocationRequests).toBe(1);
    expect(receipts).toHaveLength(1);

    const feed = await fetch(
      `${runtime.baseUrl}/v1/runtime/nigma/decision-events?profile=aria`,
      { headers: { Authorization: `Bearer ${runtimeToken}` } },
    );
    const feedBody = await feed.json() as any;
    expect(feedBody.events).toHaveLength(2);
    expect(feedBody.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ title: 'Ejecución finalizada' }),
      expect.objectContaining({
        title: 'Aprobación registrada',
        content: expect.stringContaining(
          approved.approval.execution_authorization.phrase,
        ),
      }),
    ]));

    const bindingFile = path.join(directory, 'binding.json');
    await writeHermesDecisionBindingFile(bindingFile, executed.binding);
    const restarted = await readHermesDecisionBindingFile(bindingFile);
    const replayCall = async () => {
      throw new Error('replay must not contact Hermes or EGO');
    };
    await expect(scanHermesExecutionBinding(
      restarted,
      'aria-primary-g116',
      [],
      adapterConfig,
      new Date(executionAt.getTime() + 1_000),
      replayCall as typeof fetch,
    )).resolves.toMatchObject({ outcome: 'already_executed' });
    expect(invocationRequests).toBe(1);
    expect(receipts).toHaveLength(1);

    const serialized = JSON.stringify(restarted);
    expect(serialized).not.toContain(
      approved.approval.execution_authorization.phrase,
    );
    expect(serialized).not.toContain('aria-primary-g116');
    expect(serialized).not.toContain('execution-g116-message-1');
    expect((await fs.stat(bindingFile)).mode & 0o777).toBe(0o600);
  });
});

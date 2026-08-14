import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AddressInfo } from 'node:net';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server';
import {
  NigmaAdapterPolicy,
  NigmaAdapterPolicySchema,
  NigmaHandoffError,
  NigmaInvocationEnvelope,
  NigmaInvocationEnvelopeSchema,
  nigmaInvocationDigest,
  setNigmaAdapterPolicyForTests,
  validateAndMapNigmaSubmission,
} from '../src/runtime/nigma_handoff';
import { resetRuntimeRepositoryForTests } from '../src/services/runtime_repository';

const pluginDigest = '1'.repeat(64);
const providerDigest = '2'.repeat(64);

function policy(): NigmaAdapterPolicy {
  return NigmaAdapterPolicySchema.parse({
    protocol_version: 'nigma.runtime-handoff/v1',
    runtime_id: 'ego-runtime',
    runtime_version: '0.7.0',
    allowed_nigma_capabilities: ['educational_execution'],
    allowed_permissions: [
      'execute:approved-tools',
      'read:controlled-inputs',
      'read:referenced-learning-materials',
    ],
    allowed_output_types: ['study_plan'],
    plugins: [{
      snapshot_id: 'nigma-study@0.1.0',
      snapshot_digest: pluginDigest,
      runtime_capabilities: ['artifacts', 'documents.text', 'education.study_plan'],
    }],
    providers: [{
      snapshot_id: 'local-files@1.0.0',
      snapshot_digest: providerDigest,
      uri_schemes: ['file'],
    }],
    bindings: [{
      plugin_snapshot_id: 'nigma-study@0.1.0',
      provider_snapshot_id: 'local-files@1.0.0',
      capability: 'learning_material_reader',
    }],
  });
}

function invocation(
  uri = 'file:///controlled/source.md',
  update: Record<string, unknown> = {},
): NigmaInvocationEnvelope {
  const now = new Date();
  const value = NigmaInvocationEnvelopeSchema.parse({
    id: 'nigma-invocation-001',
    execution_id: 'nigma-execution-001',
    request_id: 'nigma-request-001',
    request_digest: '3'.repeat(64),
    plan_id: 'nigma-plan-001',
    plan_digest: '4'.repeat(64),
    approval_id: 'nigma-approval-001',
    runtime_selection_id: 'nigma-runtime-selection-001',
    runtime_selection_digest: '5'.repeat(64),
    runtime_snapshot_id: 'ego-runtime@0.7.0',
    runtime_snapshot_digest: '6'.repeat(64),
    runtime_id: 'ego-runtime',
    runtime_version: '0.7.0',
    agent_route: {
      agent_route_id: 'agent-route-001',
      agent_route_digest: '7'.repeat(64),
      plugin_selection_id: 'plugin-selection-001',
      plugin_selection_digest: '8'.repeat(64),
      provider_binding_id: 'provider-binding-001',
      provider_binding_digest: '9'.repeat(64),
      selected_plugin_snapshot_ids: ['nigma-study@0.1.0'],
      selected_plugin_snapshot_digests: [pluginDigest],
      selected_provider_snapshot_ids: ['local-files@1.0.0'],
      selected_provider_snapshot_digests: [providerDigest],
      bindings: [{
        requirement_id: 'nigma-study@0.1.0:learning_material_reader:0',
        plugin_snapshot_id: 'nigma-study@0.1.0',
        plugin_snapshot_digest: pluginDigest,
        capability: 'learning_material_reader',
        provider_snapshot_id: 'local-files@1.0.0',
        provider_snapshot_digest: providerDigest,
        provider_id: 'local-files',
        provider_version: '1.0.0',
        permissions: ['read:referenced-learning-materials'],
        evidence: ['provider:local-files@1.0.0'],
      }],
      required_permissions: ['read:referenced-learning-materials'],
    },
    objective: 'Create a bounded study plan from the referenced material',
    input_references: [{ uri, media_type: 'text/markdown' }],
    expected_output: { type: 'study_plan' },
    steps: [],
    required_runtime_capabilities: ['educational_execution'],
    required_permissions: [
      'execute:approved-tools',
      'read:controlled-inputs',
      'read:referenced-learning-materials',
    ],
    max_duration_seconds: 600,
    must_start_before: new Date(now.getTime() + 60_000).toISOString(),
    digest: '0'.repeat(64),
    created_at: now.toISOString(),
    ...update,
  });
  return { ...value, digest: nigmaInvocationDigest(value) };
}

const learner = {
  user_id: 'learner_1',
  session_id: 'session_1',
  objective_id: 'objective_1',
};

describe('Nigma approved handoff', () => {
  let directory = '';
  let closeServer: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await closeServer?.();
    closeServer = undefined;
    setNigmaAdapterPolicyForTests(undefined);
    resetRuntimeRepositoryForTests();
    delete process.env.NIGMA_HANDOFF_ENABLED;
    delete process.env.NIGMA_ADAPTER_POLICY_FILE;
    delete process.env.INTERNAL_RUNTIME_TOKEN;
    delete process.env.MODEL_PROVIDER;
    if (directory) await fs.rm(directory, { recursive: true, force: true });
    directory = '';
  });

  it('maps only an intact, live and allowlisted route', () => {
    const valid = invocation();
    const mapped = validateAndMapNigmaSubmission(
      { invocation: valid, learner_context: learner }, policy(), new Date(),
    );
    expect(mapped).toMatchObject({
      request_id: valid.id,
      message: valid.objective,
      capabilities: ['artifacts', 'documents.text', 'education.study_plan'],
      attachments: [{ id: 'source_1', mime_type: 'text/markdown' }],
      metadata: { nigma: { invocation_digest: valid.digest, agent_route_id: 'agent-route-001' } },
    });

    const tampered = { ...valid, objective: 'Changed after approval' };
    expect(() => validateAndMapNigmaSubmission(
      { invocation: tampered, learner_context: learner }, policy(), new Date(),
    )).toThrowError(expect.objectContaining({ code: 'NIGMA_INVOCATION_INTEGRITY_FAILED' }));

    const changedPlugin = invocation(undefined, {
      agent_route: { ...valid.agent_route, selected_plugin_snapshot_digests: ['f'.repeat(64)] },
    });
    expect(() => validateAndMapNigmaSubmission(
      { invocation: changedPlugin, learner_context: learner }, policy(), new Date(),
    )).toThrowError(expect.objectContaining({ code: 'NIGMA_PLUGIN_NOT_ALLOWED' }));

    const remote = invocation('https://example.test/source.md');
    expect(() => validateAndMapNigmaSubmission(
      { invocation: remote, learner_context: learner }, policy(), new Date(),
    )).toThrowError(expect.objectContaining({ code: 'NIGMA_INPUT_SCHEME_UNSUPPORTED' }));
  });

  it('runs one complete local educational workflow and returns a Nigma receipt', async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ego-nigma-'));
    const inputRoot = path.join(directory, 'inputs');
    const dataRoot = path.join(directory, 'data');
    await fs.mkdir(inputRoot);
    const source = path.join(inputRoot, 'source.md');
    await fs.writeFile(source, '# Core idea\nA concise trusted learning source.');
    process.env.RUNTIME_BACKEND = 'local';
    process.env.LOCAL_INPUT_ROOT = inputRoot;
    process.env.LOCAL_DATA_DIR = dataRoot;
    process.env.INTERNAL_RUNTIME_TOKEN = 'nigma-test-token';
    process.env.NIGMA_HANDOFF_ENABLED = 'true';
    setNigmaAdapterPolicyForTests(policy());
    process.env.MODEL_PROVIDER = 'deterministic-demo';
    resetRuntimeRepositoryForTests();

    const app = await createApp();
    const server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/runtime`;
    const headers = {
      Authorization: 'Bearer nigma-test-token',
      'Content-Type': 'application/json',
    };
    const approved = invocation(pathToFileURL(source).href);
    const body = { invocation: approved, learner_context: learner };
    const accepted = await fetch(`${base}/nigma/invocations`, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    expect(accepted.status).toBe(202);
    await expect(accepted.json()).resolves.toMatchObject({
      invocation_id: approved.id,
      invocation_digest: approved.digest,
      status: 'accepted',
    });

    let job: Record<string, unknown> = {};
    for (let attempt = 0; attempt < 50; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 20));
      const response = await fetch(`${base}/${approved.id}`, { headers });
      job = await response.json() as Record<string, unknown>;
      if (['completed', 'failed'].includes(String(job.status))) break;
    }
    expect(job.status).toBe('completed');

    const receiptResponse = await fetch(`${base}/nigma/${approved.id}/receipt`, { headers });
    expect(receiptResponse.ok).toBe(true);
    const receipt = await receiptResponse.json() as Record<string, unknown>;
    expect(receipt).toMatchObject({
      invocation_id: approved.id,
      invocation_digest: approved.digest,
      execution_id: approved.execution_id,
      runtime_snapshot_id: approved.runtime_snapshot_id,
      runtime_snapshot_digest: approved.runtime_snapshot_digest,
      status: 'succeeded',
      runtime_run_id: approved.id,
      issues: [],
    });
    expect(receipt.artifacts).toHaveLength(4);
    expect(receipt.mastery_refs).toHaveLength(1);

    const replay = await fetch(`${base}/nigma/invocations`, {
      method: 'POST', headers, body: JSON.stringify(body),
    });
    await expect(replay.json()).resolves.toMatchObject({ status: 'already_accepted' });
    const changedLearner = await fetch(`${base}/nigma/invocations`, {
      method: 'POST', headers,
      body: JSON.stringify({ ...body, learner_context: { ...learner, user_id: 'other' } }),
    });
    expect(changedLearner.status).toBe(409);
    await expect(changedLearner.json()).resolves.toEqual({ error: 'IDEMPOTENCY_CONFLICT' });
  });

  it('keeps the integration closed when it is not explicitly enabled', async () => {
    process.env.RUNTIME_BACKEND = 'local';
    process.env.INTERNAL_RUNTIME_TOKEN = 'nigma-test-token';
    const app = await createApp();
    const server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    closeServer = () => new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()));
    const response = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/runtime/nigma/invocations`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer nigma-test-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ invocation: invocation(), learner_context: learner }),
      },
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: 'NIGMA_HANDOFF_DISABLED' });
  });
});

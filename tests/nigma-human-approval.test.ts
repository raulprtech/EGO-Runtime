import express from 'express';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server';
import { canonicalJson, sha256 } from '../src/runtime/integrity';

const hex = (value: string) => value.repeat(64).slice(0, 64);
const runtimeToken = 'runtime-approval-test-token-000001';
const humanToken = 'human-decision-test-token-0000001';

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

function educationalTask() {
  return {
    objective: 'Crear un plan de estudio acotado con mis notas locales',
    materials: [{
      uri: 'file:///controlled/course/notes.md',
      media_type: 'text/markdown',
      schema_ref: 'schema://learning-material/v1',
      sha256: hex('a'),
      size_bytes: 512,
    }],
    project: 'education-local',
    max_duration_seconds: 600,
    presentation_locale: 'es-MX',
    required_runtime_capabilities: ['educational_execution'],
  };
}

function runtimeExplanation() {
  const payload = {
    protocol_version: 'nigma.runtime-decision-explanation/v1',
    algorithm_version: 'runtime-decision-explanation-v1',
    selection_id: 'runtime-selection-approval',
    selection_digest: hex('8'),
    selected: {
      runtime_id: 'ego-runtime', runtime_version: '0.9.0',
      snapshot_id: 'ego-runtime@0.9.0', snapshot_digest: hex('f'),
      total_score_ppm: 200_000, evidence_basis: 'declared_only',
    },
    runner_up: {
      runtime_id: 'hermes-runtime', runtime_version: '0.20.0',
      snapshot_id: 'hermes-runtime@0.20.0', snapshot_digest: hex('7'),
      total_score_ppm: 190_000, evidence_basis: 'declared_only',
    },
    eligible_candidate_count: 2,
    excluded_candidate_count: 0,
    score_margin_ppm: 10_000,
    factors: [
      {
        dimension: 'reliability', selected_weighted_score_ppm: 200_000,
        runner_up_weighted_score_ppm: 180_000, delta_ppm: 20_000,
      },
      {
        dimension: 'cost', selected_weighted_score_ppm: 0,
        runner_up_weighted_score_ppm: 10_000, delta_ppm: -10_000,
      },
    ],
    reason_codes: [
      'highest_eligible_score', 'all_hard_constraints_satisfied',
      'human_approval_required',
    ],
    authority: 'human_approval_required',
    approval_granted: false,
    execution_performed: false,
    created_at: '2026-08-15T00:00:00Z',
  };
  const digest = sha256(canonicalJson(payload));
  return {
    ...payload,
    id: `runtime-decision-explanation-${digest.slice(0, 16)}`,
    digest,
  };
}

function upstreamPreparation() {
  const plan = { id: 'plan-approval-1', digest: hex('b') };
  const route = { id: 'agent-route-approval-1', digest: hex('e') };
  const plugin = { id: 'plugin-selection-approval-1', digest: hex('c') };
  const provider = { id: 'provider-binding-approval-1', digest: hex('d') };
  return {
    protocol_version: 'nigma.educational-task-preparation/v1',
    status: 'awaiting_human_approval',
    capability_request: { id: 'request-approval-1', objective: educationalTask().objective },
    integration_plan: {
      ...plan,
      request_id: 'request-approval-1', confidence: 0.75, risk_level: 'medium',
      runtime_selection: {
        id: 'runtime-selection-approval', digest: hex('8'),
        selected_snapshot_id: 'ego-runtime@0.9.0', selected_snapshot_digest: hex('f'),
        selected_runtime_id: 'ego-runtime', selected_runtime_version: '0.9.0',
      },
    },
    runtime_explanation: runtimeExplanation(),
    plugin_selection: { ...plugin, status: 'selected' },
    provider_binding: { ...provider, status: 'ready' },
    agent_route: {
      ...route,
      plan_id: plan.id, plan_digest: plan.digest,
      runtime_selection_id: 'runtime-selection-approval', runtime_selection_digest: hex('8'),
      plugin_selection_id: plugin.id, plugin_selection_digest: plugin.digest,
      provider_binding_id: provider.id, provider_binding_digest: provider.digest,
      runtime_id: 'ego-runtime', runtime_version: '0.9.0',
      runtime_snapshot_id: 'ego-runtime@0.9.0', runtime_snapshot_digest: hex('f'),
      status: 'ready', approval_granted: false, execution_performed: false,
    },
    approval_target: {
      scope: 'execute', plan_id: plan.id, plan_digest: plan.digest,
      agent_route_id: route.id, agent_route_digest: route.digest,
      plugin_selection_id: plugin.id, plugin_selection_digest: plugin.digest,
      provider_binding_id: provider.id, provider_binding_digest: provider.digest,
    },
    approval_granted: false,
    execution_performed: false,
  };
}

describe('trusted Nigma human approval bridge', () => {
  const closers: Array<() => Promise<void>> = [];
  const directories: string[] = [];

  afterEach(async () => {
    while (closers.length) await closers.pop()?.();
    while (directories.length) await fs.rm(directories.pop()!, { recursive: true, force: true });
    for (const name of [
      'INTERNAL_RUNTIME_TOKEN', 'NIGMA_HUMAN_DECISION_TOKEN',
      'NIGMA_CONTROL_PLANE_URL', 'NIGMA_CONTROL_PLANE_API_KEY',
      'NIGMA_HOST_TIMEOUT_MS', 'LOCAL_DATA_DIR',
    ]) delete process.env[name];
  });

  it('requires independent human authority and records only an exact sealed decision', async () => {
    const control = express();
    control.use(express.json());
    const approvalBodies: Array<Record<string, unknown>> = [];
    control.post('/educational-tasks/prepare', (_req, res) => res.json(upstreamPreparation()));
    control.post('/integration-plans/:plan_id/approvals', (req, res) => {
      approvalBodies.push(req.body);
      expect(req.header('x-api-key')).toBe('control-approval-key');
      expect(req.header('idempotency-key')).toBe('human-decision-1');
      res.json({
        ...req.body,
        id: 'approval-record-1',
        plan_id: req.params.plan_id,
        created_at: '2026-08-15T00:15:00Z',
      });
    });
    const controlServer = await listen(control);
    closers.push(controlServer.close);
    process.env.INTERNAL_RUNTIME_TOKEN = runtimeToken;
    process.env.NIGMA_HUMAN_DECISION_TOKEN = humanToken;
    process.env.NIGMA_CONTROL_PLANE_URL = controlServer.baseUrl;
    process.env.NIGMA_CONTROL_PLANE_API_KEY = 'control-approval-key';
    process.env.NIGMA_HOST_TIMEOUT_MS = '2000';
    const localData = await fs.mkdtemp(path.join('/tmp', 'ego-g18-human-'));
    directories.push(localData);
    process.env.LOCAL_DATA_DIR = localData;
    let host = await listen(await createApp());
    closers.push(host.close);

    const commonHeaders = {
      Authorization: `Bearer ${runtimeToken}`,
      'Content-Type': 'application/json',
    };
    const preparedResponse = await fetch(
      `${host.baseUrl}/v1/runtime/nigma/educational-tasks/prepare`,
      {
        method: 'POST',
        headers: { ...commonHeaders, 'Idempotency-Key': 'prepare-human-decision-1' },
        body: JSON.stringify(educationalTask()),
      },
    );
    const preparation = await preparedResponse.json();
    expect(preparedResponse.status, JSON.stringify(preparation)).toBe(200);
    const challengeDirectory = path.join(localData, 'nigma-human-approval-challenges');
    const challengeFiles = await fs.readdir(challengeDirectory);
    expect(challengeFiles).toHaveLength(1);
    const challengeFile = path.join(challengeDirectory, challengeFiles[0]);
    const challengeText = await fs.readFile(challengeFile, 'utf8');
    expect(challengeText).not.toContain(educationalTask().objective);
    expect(challengeText).not.toContain(preparation.interface_projection.approval_phrase);
    expect(challengeText).toContain(sha256(preparation.interface_projection.approval_phrase));
    expect((await fs.stat(challengeFile)).mode & 0o777).toBe(0o600);
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    const submission = {
      protocol_version: 'nigma.trusted-human-approval-submission/v1',
      host_preparation_id: preparation.host_preparation_id,
      interface_projection_id: preparation.interface_projection.id,
      interface_projection_digest: preparation.interface_projection.digest,
      approval_phrase: preparation.interface_projection.approval_phrase,
      approver: 'local-owner',
      expires_at: expiresAt,
    };
    let endpoint = `${host.baseUrl}/v1/runtime/nigma/human-approvals`;

    const missingHumanCredential = await fetch(endpoint, {
      method: 'POST',
      headers: { ...commonHeaders, 'Idempotency-Key': 'human-decision-1' },
      body: JSON.stringify(submission),
    });
    expect(missingHumanCredential.status).toBe(401);
    expect(approvalBodies).toHaveLength(0);

    process.env.NIGMA_HUMAN_DECISION_TOKEN = runtimeToken;
    const sharedCredential = await fetch(endpoint, {
      method: 'POST',
      headers: {
        ...commonHeaders,
        'X-Nigma-Human-Decision-Token': runtimeToken,
        'Idempotency-Key': 'human-decision-1',
      },
      body: JSON.stringify(submission),
    });
    expect(sharedCredential.status).toBe(503);
    expect(approvalBodies).toHaveLength(0);
    process.env.NIGMA_HUMAN_DECISION_TOKEN = humanToken;

    const wrongPhrase = await fetch(endpoint, {
      method: 'POST',
      headers: {
        ...commonHeaders,
        'X-Nigma-Human-Decision-Token': humanToken,
        'Idempotency-Key': 'human-decision-1',
      },
      body: JSON.stringify({ ...submission, approval_phrase: `${submission.approval_phrase} alterada` }),
    });
    expect(wrongPhrase.status).toBe(409);
    expect(approvalBodies).toHaveLength(0);

    const tampered = {
      ...submission,
      interface_projection_digest: hex('0'),
    };
    const tamperedProjection = await fetch(endpoint, {
      method: 'POST',
      headers: {
        ...commonHeaders,
        'X-Nigma-Human-Decision-Token': humanToken,
        'Idempotency-Key': 'human-decision-1',
      },
      body: JSON.stringify(tampered),
    });
    expect(tamperedProjection.status).toBe(409);
    expect(approvalBodies).toHaveLength(0);

    const missingIdempotency = await fetch(endpoint, {
      method: 'POST',
      headers: {
        ...commonHeaders,
        'X-Nigma-Human-Decision-Token': humanToken,
      },
      body: JSON.stringify(submission),
    });
    expect(missingIdempotency.status).toBe(400);
    expect(approvalBodies).toHaveLength(0);

    const shortExpiry = await fetch(endpoint, {
      method: 'POST',
      headers: {
        ...commonHeaders,
        'X-Nigma-Human-Decision-Token': humanToken,
        'Idempotency-Key': 'human-decision-short-expiry',
      },
      body: JSON.stringify({
        ...submission,
        expires_at: new Date(Date.now() + 30_000).toISOString(),
      }),
    });
    expect(shortExpiry.status).toBe(400);
    expect(approvalBodies).toHaveLength(0);

    await closers.pop()?.();
    host = await listen(await createApp());
    closers.push(host.close);
    endpoint = `${host.baseUrl}/v1/runtime/nigma/human-approvals`;

    const approved = await fetch(endpoint, {
      method: 'POST',
      headers: {
        ...commonHeaders,
        'X-Nigma-Human-Decision-Token': humanToken,
        'Idempotency-Key': 'human-decision-1',
      },
      body: JSON.stringify(submission),
    });
    const result = await approved.json();
    expect(approved.status, JSON.stringify(result)).toBe(200);
    expect(result).toMatchObject({
      protocol_version: 'nigma.trusted-human-approval-record/v1',
      approval_id: 'approval-record-1',
      plan_id: 'plan-approval-1',
      approver: 'local-owner',
      authority: 'trusted_human_adapter',
      approval_recorded: true,
      execution_performed: false,
    });
    const { digest, ...resultCore } = result;
    expect(digest).toBe(sha256(canonicalJson(resultCore)));
    expect(approvalBodies).toHaveLength(1);
    expect(approvalBodies[0]).toMatchObject({
      decision: 'approved', scope: 'execute', expires_at: expiresAt,
      plan_digest: hex('b'), agent_route_id: 'agent-route-approval-1',
      evidence: {
        protocol_version: 'nigma.trusted-human-decision-evidence/v1',
        channel: 'trusted_host_adapter',
        source_interface_projection_digest: preparation.interface_projection.digest,
        approval_phrase_sha256: sha256(submission.approval_phrase),
      },
    });
    expect(JSON.stringify(approvalBodies[0])).not.toContain(submission.approval_phrase);

    const replay = await fetch(endpoint, {
      method: 'POST',
      headers: {
        ...commonHeaders,
        'X-Nigma-Human-Decision-Token': humanToken,
        'Idempotency-Key': 'human-decision-1',
      },
      body: JSON.stringify(submission),
    });
    expect(replay.status).toBe(200);
    await expect(replay.json()).resolves.toEqual(result);
    expect(approvalBodies).toHaveLength(2);
    expect(approvalBodies[1]).toEqual(approvalBodies[0]);
  });
});

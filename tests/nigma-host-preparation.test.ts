import express from 'express';
import fs from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server';
import { canonicalJson, sha256 } from '../src/runtime/integrity';
import {
  NigmaAdapterPolicySchema, setNigmaAdapterPolicyForTests,
} from '../src/runtime/nigma_handoff';
import {
  NigmaHostRoutesSchema, setNigmaHostRoutesForTests,
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

function task(locale: 'es-MX' | 'en-US' = 'es-MX') {
  return {
    objective: 'Crear un plan de estudio acotado con mis notas locales',
    materials: [{
      uri: 'file:///controlled/course/notes.md',
      media_type: 'text/markdown',
      schema_ref: 'schema://learning-material/v1',
      sha256: digest('a'),
      size_bytes: 512,
    }],
    project: 'education-local',
    max_duration_seconds: 600,
    presentation_locale: locale,
    required_runtime_capabilities: ['educational_execution'],
  };
}

function runtimeExplanation() {
  const payload = {
    protocol_version: 'nigma.runtime-decision-explanation/v1' as const,
    algorithm_version: 'runtime-decision-explanation-v1' as const,
    selection_id: 'runtime-selection-1',
    selection_digest: digest('8'),
    selected: {
      runtime_id: 'ego-runtime', runtime_version: '0.9.0',
      snapshot_id: 'ego-runtime@0.9.0', snapshot_digest: digest('f'),
      total_score_ppm: 200_000, evidence_basis: 'declared_only' as const,
    },
    runner_up: {
      runtime_id: 'hermes-runtime', runtime_version: '0.20.0',
      snapshot_id: 'hermes-runtime@0.20.0', snapshot_digest: digest('7'),
      total_score_ppm: 190_000, evidence_basis: 'declared_only' as const,
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
    ] as const,
    authority: 'human_approval_required' as const,
    approval_granted: false as const,
    execution_performed: false as const,
    created_at: '2026-08-14T12:00:00Z',
  };
  const explanationDigest = sha256(canonicalJson(payload));
  return {
    ...payload,
    id: `runtime-decision-explanation-${explanationDigest.slice(0, 16)}`,
    digest: explanationDigest,
  };
}

function nigmaPreparation(includeExplanation = true) {
  const plan = { id: 'plan-1', digest: digest('b') };
  const plugin = { id: 'plugin-selection-1', digest: digest('c') };
  const provider = { id: 'provider-binding-1', digest: digest('d') };
  const route = { id: 'agent-route-1', digest: digest('e') };
  return {
    protocol_version: 'nigma.educational-task-preparation/v1',
    status: 'awaiting_human_approval',
    capability_request: { id: 'request-1', objective: task().objective },
    integration_plan: {
      ...plan,
      request_id: 'request-1',
      confidence: 0.75,
      risk_level: 'medium',
      runtime_selection: {
        id: 'runtime-selection-1',
        digest: digest('8'),
        selected_snapshot_id: 'ego-runtime@0.9.0',
        selected_snapshot_digest: digest('f'),
        selected_runtime_id: 'ego-runtime',
        selected_runtime_version: '0.9.0',
      },
    },
    ...(includeExplanation ? { runtime_explanation: runtimeExplanation() } : {}),
    plugin_selection: { ...plugin, status: 'selected' },
    provider_binding: { ...provider, status: 'ready' },
    agent_route: {
      ...route,
      plan_id: plan.id,
      plan_digest: plan.digest,
      runtime_selection_id: 'runtime-selection-1',
      runtime_selection_digest: digest('8'),
      plugin_selection_id: plugin.id,
      plugin_selection_digest: plugin.digest,
      provider_binding_id: provider.id,
      provider_binding_digest: provider.digest,
      runtime_id: 'ego-runtime',
      runtime_version: '0.9.0',
      runtime_snapshot_id: 'ego-runtime@0.9.0',
      runtime_snapshot_digest: digest('f'),
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

function adapterPolicy(capabilities: string[]) {
  return NigmaAdapterPolicySchema.parse({
    protocol_version: 'nigma.runtime-handoff/v1',
    runtime_id: 'ego-runtime',
    runtime_version: '0.9.0',
    allowed_nigma_capabilities: capabilities,
    allowed_permissions: [],
    allowed_output_types: ['study_plan'],
    plugins: [{
      snapshot_id: 'study-plugin@1.0.0',
      snapshot_digest: digest('6'),
      runtime_capabilities: ['education.study_plan'],
    }],
    providers: [],
    bindings: [],
  });
}

describe('Nigma educational host preparation', () => {
  const closers: Array<() => Promise<void>> = [];
  const directories: string[] = [];

  afterEach(async () => {
    while (closers.length) await closers.pop()?.();
    while (directories.length) await fs.rm(directories.pop()!, { recursive: true, force: true });
    for (const name of [
      'INTERNAL_RUNTIME_TOKEN', 'NIGMA_CONTROL_PLANE_URL',
      'NIGMA_CONTROL_PLANE_API_KEY', 'NIGMA_HOST_TIMEOUT_MS', 'LOCAL_DATA_DIR',
      'NIGMA_HANDOFF_ENABLED', 'NIGMA_RUNTIME_TOKEN_EGO',
    ]) delete process.env[name];
    setNigmaAdapterPolicyForTests(undefined);
    setNigmaHostRoutesForTests(undefined);
  });

  async function runtimeFor(control: express.Express) {
    const controlServer = await listen(control);
    closers.push(controlServer.close);
    process.env.INTERNAL_RUNTIME_TOKEN = 'host-test-token';
    process.env.NIGMA_CONTROL_PLANE_URL = controlServer.baseUrl;
    process.env.NIGMA_CONTROL_PLANE_API_KEY = 'control-test-key';
    process.env.NIGMA_HOST_TIMEOUT_MS = '2000';
    const localData = await fs.mkdtemp(path.join('/tmp', 'ego-host-preparation-'));
    directories.push(localData);
    process.env.LOCAL_DATA_DIR = localData;
    const runtime = await listen(await createApp());
    closers.push(runtime.close);
    return runtime;
  }

  const headers = {
    Authorization: 'Bearer host-test-token',
    'Content-Type': 'application/json',
    'Idempotency-Key': 'prepare-study-1',
  };

  it('projects a bounded human decision and creates no approval or execution', async () => {
    const control = express();
    control.use(express.json());
    let preparations = 0;
    control.post('/educational-tasks/prepare', (req, res) => {
      expect(req.header('x-api-key')).toBe('control-test-key');
      expect(req.header('idempotency-key')).toBe('prepare-study-1');
      const { presentation_locale: _locale, ...neutralTask } = task();
      expect(req.body).toEqual(neutralTask);
      preparations += 1;
      res.json(nigmaPreparation());
    });
    const runtime = await runtimeFor(control);

    const response = await fetch(
      `${runtime.baseUrl}/v1/runtime/nigma/educational-tasks/prepare`,
      { method: 'POST', headers, body: JSON.stringify(task()) },
    );
    const result = await response.json();
    expect(response.status, JSON.stringify(result)).toBe(200);
    expect(result).toMatchObject({
      protocol_version: 'nigma.host-preparation/v1',
      status: 'awaiting_human_approval',
      objective: task().objective,
      plan: { id: 'plan-1', digest: digest('b') },
      runtime: { id: 'ego-runtime', version: '0.9.0' },
      runtime_decision: {
        selection_id: 'runtime-selection-1',
        selection_digest: digest('8'),
        selected_score_ppm: 200_000,
        runner_up: { runtime_id: 'hermes-runtime', total_score_ppm: 190_000 },
        score_margin_ppm: 10_000,
        authority: 'human_approval_required',
        approval_granted: false,
        execution_performed: false,
        presentation: {
          locale: 'es-MX',
          title: 'ego-runtime@0.9.0 fue seleccionado',
          advantages: [{ dimension: 'reliability', delta_ppm: 20_000 }],
          tradeoffs: [{ dimension: 'cost', delta_ppm: -10_000 }],
          authority: 'informational_only',
          approval_granted: false,
          execution_performed: false,
        },
      },
      interface_projection: {
        protocol_version: 'nigma.host-preparation-interface/v1',
        interface: 'generic-sse',
        locale: 'es-MX',
        authority: 'human_decision_required',
        approval_recorded: false,
        execution_performed: false,
        events: [
          { event: 'tool.started', data: { tool_name: 'learning.plan', status: 'started' } },
          { event: 'tool.completed', data: { tool_name: 'learning.plan', status: 'completed' } },
          { event: 'assistant.completed', data: { completed: true } },
        ],
      },
      approval_target: {
        scope: 'execute',
        plan_id: 'plan-1',
        agent_route_id: 'agent-route-1',
      },
      resume: {
        method: 'POST',
        path: '/v1/runtime/nigma/host-runs',
        plan_id: 'plan-1',
      },
      approval_granted: false,
      execution_performed: false,
    });
    expect(preparations).toBe(1);
    const presentation = result.runtime_decision.presentation;
    const { id: presentationId, digest: presentationDigest, ...presentationPayload } = presentation;
    expect(presentationDigest).toBe(sha256(canonicalJson(presentationPayload)));
    expect(presentationId).toBe(
      `host-runtime-decision-presentation-${presentationDigest.slice(0, 16)}`,
    );
    const projection = result.interface_projection;
    const { id: projectionId, digest: projectionDigest, ...projectionPayload } = projection;
    expect(projectionDigest).toBe(sha256(canonicalJson(projectionPayload)));
    expect(projectionId).toBe(`host-preparation-interface-${projectionDigest.slice(0, 16)}`);
    expect(projection.source_host_preparation_id).toBe(result.host_preparation_id);
    expect(projection.source_presentation_digest).toBe(presentation.digest);
    expect(projection.events[2].data.content).toContain(projection.approval_phrase);
    expect(projection.approval_phrase).toBe('Confirmo el plan BBBBBB.');
    expect(projection.events[2].data.content).not.toContain('Nigma');
    expect(projection.events[2].data.content).not.toContain('plan-1');
    expect(projection.events[2].data.content).not.toContain(digest('b'));
  });

  it('renders a separate deterministic English presentation', async () => {
    const control = express();
    control.use(express.json());
    control.post('/educational-tasks/prepare', (req, res) => {
      const { presentation_locale: _locale, ...neutralTask } = task('en-US');
      expect(req.body).toEqual(neutralTask);
      res.json(nigmaPreparation());
    });
    const runtime = await runtimeFor(control);
    const localizedHeaders = { ...headers, 'Idempotency-Key': 'localized-view' };
    const spanishResponse = await fetch(
      `${runtime.baseUrl}/v1/runtime/nigma/educational-tasks/prepare`,
      { method: 'POST', headers: localizedHeaders, body: JSON.stringify(task('es-MX')) },
    );
    const response = await fetch(
      `${runtime.baseUrl}/v1/runtime/nigma/educational-tasks/prepare`,
      { method: 'POST', headers: localizedHeaders,
        body: JSON.stringify(task('en-US')) },
    );
    const spanish = await spanishResponse.json();
    const result = await response.json();
    expect(spanishResponse.status, JSON.stringify(spanish)).toBe(200);
    expect(response.status, JSON.stringify(result)).toBe(200);
    expect(result.runtime_decision.presentation).toMatchObject({
      locale: 'en-US',
      title: 'ego-runtime@0.9.0 was selected',
      advantages: [{ dimension: 'reliability', text: expect.stringContaining('points') }],
      tradeoffs: [{ dimension: 'cost', text: expect.stringContaining('points') }],
      authority: 'informational_only',
      approval_granted: false,
      execution_performed: false,
    });
    expect(result.runtime_decision.presentation.digest).not.toBe(
      runtimeExplanation().digest,
    );
    expect(result.plan).toEqual(spanish.plan);
    expect(result.runtime_decision.selection_digest).toBe(
      spanish.runtime_decision.selection_digest,
    );
    expect(result.runtime_decision.presentation.source_explanation_digest).toBe(
      spanish.runtime_decision.presentation.source_explanation_digest,
    );
    expect(result.host_preparation_id).not.toBe(spanish.host_preparation_id);
    expect(result.runtime_decision.presentation.id).not.toBe(
      spanish.runtime_decision.presentation.id,
    );
    expect(result.interface_projection.source_presentation_digest).toBe(
      result.runtime_decision.presentation.digest,
    );
    expect(result.interface_projection.id).not.toBe(spanish.interface_projection.id);
  });

  it('rejects a configured capability gap before creating a human challenge', async () => {
    const control = express();
    control.use(express.json());
    control.post('/educational-tasks/prepare', (_req, res) => res.json(nigmaPreparation()));
    process.env.NIGMA_HANDOFF_ENABLED = 'true';
    process.env.NIGMA_RUNTIME_TOKEN_EGO = 'preflight-runtime-token';
    setNigmaAdapterPolicyForTests(adapterPolicy(['educational_execution']));
    setNigmaHostRoutesForTests(NigmaHostRoutesSchema.parse({
      protocol_version: 'nigma.host-routes/v1',
      routes: [{
        runtime_id: 'ego-runtime',
        runtime_version: '0.9.0',
        base_url: 'http://127.0.0.1:9/v1/runtime',
        credential_env: 'NIGMA_RUNTIME_TOKEN_EGO',
      }],
    }));
    const runtime = await runtimeFor(control);
    const input = {
      ...task(),
      required_runtime_capabilities: ['educational_execution', 'assessment'],
    };
    const rejected = await fetch(
      `${runtime.baseUrl}/v1/runtime/nigma/educational-tasks/prepare`,
      { method: 'POST', headers, body: JSON.stringify(input) },
    );
    expect(rejected.status).toBe(422);
    await expect(rejected.json()).resolves.toMatchObject({
      error: 'NIGMA_PREFLIGHT_CAPABILITY_NOT_ALLOWED',
      message: expect.stringContaining('assessment'),
    });
    const challengeDirectory = path.join(
      directories.at(-1)!, 'nigma-human-approval-challenges',
    );
    await expect(fs.readdir(challengeDirectory)).rejects.toMatchObject({ code: 'ENOENT' });

    setNigmaAdapterPolicyForTests(adapterPolicy([
      'educational_execution', 'assessment',
    ]));
    const accepted = await fetch(
      `${runtime.baseUrl}/v1/runtime/nigma/educational-tasks/prepare`,
      {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': 'preflight-repaired' },
        body: JSON.stringify(input),
      },
    );
    expect(accepted.status, await accepted.clone().text()).toBe(200);
    expect(await fs.readdir(challengeDirectory)).toHaveLength(1);
  });

  it('renders the sealed preparation as generic SSE accepted by the ARIA parser contract', async () => {
    const control = express();
    control.use(express.json());
    control.post('/educational-tasks/prepare', (_req, res) => res.json(nigmaPreparation()));
    const runtime = await runtimeFor(control);
    const requestHeaders = {
      ...headers,
      Accept: 'text/event-stream',
      'Idempotency-Key': 'interface-sse-view',
    };
    const response = await fetch(
      `${runtime.baseUrl}/v1/runtime/nigma/educational-tasks/prepare`,
      { method: 'POST', headers: requestHeaders, body: JSON.stringify(task('en-US')) },
    );
    const rendered = await response.text();
    expect(response.status, rendered).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('x-nigma-projection-digest')).toMatch(/^[a-f0-9]{64}$/);
    const frames = rendered.trim().split('\n\n').map(frame => {
      const [eventLine, dataLine] = frame.split('\n');
      return {
        event: eventLine.replace('event: ', ''),
        data: JSON.parse(dataLine.replace('data: ', '')),
      };
    });
    expect(frames.map(frame => frame.event)).toEqual([
      'tool.started', 'tool.completed', 'assistant.completed',
    ]);
    expect(frames[0].data.tool_call_id).toBe(frames[1].data.tool_call_id);
    expect(frames[1].data.tool_name).toBe('learning.plan');
    expect(frames[2].data.completed).toBe(true);
    expect(frames[2].data.content).toContain('Plan ready for review');
    expect(frames[2].data.content).toContain('I confirm plan BBBBBB.');
    expect(frames[2].data.content).not.toContain('Nigma');
    expect(frames[2].data.content).not.toContain('plan-1');
  });

  it('accepts a historical preparation without the optional explanation', async () => {
    const control = express();
    control.use(express.json());
    control.post('/educational-tasks/prepare', (_req, res) => {
      res.json(nigmaPreparation(false));
    });
    const runtime = await runtimeFor(control);
    const response = await fetch(
      `${runtime.baseUrl}/v1/runtime/nigma/educational-tasks/prepare`,
      { method: 'POST', headers, body: JSON.stringify(task()) },
    );
    const result = await response.json() as {
      runtime_decision?: unknown; interface_projection?: unknown;
    };
    expect(response.status).toBe(200);
    expect(result.runtime_decision).toBeUndefined();
    expect(result.interface_projection).toBeUndefined();

    const sseResponse = await fetch(
      `${runtime.baseUrl}/v1/runtime/nigma/educational-tasks/prepare`,
      {
        method: 'POST',
        headers: {
          ...headers,
          Accept: 'text/event-stream',
          'Idempotency-Key': 'historical-sse-view',
        },
        body: JSON.stringify(task()),
      },
    );
    expect(sseResponse.status).toBe(406);
    await expect(sseResponse.json()).resolves.toMatchObject({
      error: 'NIGMA_INTERFACE_PROJECTION_UNAVAILABLE',
    });
  });

  it('requires auth and a bounded idempotency key before contacting Nigma', async () => {
    const control = express();
    control.use(express.json());
    let contacted = 0;
    control.post('/educational-tasks/prepare', (_req, res) => {
      contacted += 1;
      res.json(nigmaPreparation());
    });
    const runtime = await runtimeFor(control);
    const url = `${runtime.baseUrl}/v1/runtime/nigma/educational-tasks/prepare`;

    const unauthenticated = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(task()),
    });
    expect(unauthenticated.status).toBe(401);

    const noKey = await fetch(url, {
      method: 'POST',
      headers: { Authorization: headers.Authorization, 'Content-Type': 'application/json' },
      body: JSON.stringify(task()),
    });
    expect(noKey.status).toBe(400);
    await expect(noKey.json()).resolves.toMatchObject({
      error: 'NIGMA_HOST_IDEMPOTENCY_REQUIRED',
    });
    expect(contacted).toBe(0);

    const unsupported = await fetch(url, {
      method: 'POST', headers,
      body: JSON.stringify({ ...task(), presentation_locale: 'fr-FR' }),
    });
    expect(unsupported.status).toBe(400);
    expect(contacted).toBe(0);
  });

  it('rejects altered links or a preparation claiming authority', async () => {
    for (const changed of [
      { ...nigmaPreparation(), approval_target: {
        ...nigmaPreparation().approval_target, agent_route_digest: digest('9'),
      } },
      { ...nigmaPreparation(), approval_granted: true },
      { ...nigmaPreparation(), runtime_explanation: {
        ...runtimeExplanation(), digest: digest('9'),
      } },
      { ...nigmaPreparation(), runtime_explanation: {
        ...runtimeExplanation(), selection_id: 'another-selection',
      } },
      (() => {
        const value = runtimeExplanation();
        const { id: _id, digest: _digest, ...payload } = value;
        const changed = { ...payload, score_margin_ppm: 1 };
        const changedDigest = sha256(canonicalJson(changed));
        return { ...nigmaPreparation(), runtime_explanation: {
          ...changed,
          id: `runtime-decision-explanation-${changedDigest.slice(0, 16)}`,
          digest: changedDigest,
        } };
      })(),
    ]) {
      const control = express();
      control.use(express.json());
      control.post('/educational-tasks/prepare', (_req, res) => res.json(changed));
      const runtime = await runtimeFor(control);
      const response = await fetch(
        `${runtime.baseUrl}/v1/runtime/nigma/educational-tasks/prepare`,
        { method: 'POST', headers, body: JSON.stringify(task()) },
      );
      expect(response.status).toBe(502);
      const body = await response.json() as { error: string };
      expect([
        'NIGMA_PREPARATION_LINK_MISMATCH', 'NIGMA_HOST_UPSTREAM_INVALID',
        'NIGMA_RUNTIME_EXPLANATION_INVALID',
      ]).toContain(body.error);
      await closers.pop()?.();
      await closers.pop()?.();
    }
  });

  it('cannot resume when approval is absent or expired', async () => {
    for (const code of ['approval_required', 'approval_expired']) {
      const control = express();
      control.use(express.json());
      control.post('/integration-plans/:plan_id/runtime-invocations', (_req, res) => {
        res.status(403).json({ error: { code, message: code } });
      });
      const runtime = await runtimeFor(control);
      const response = await fetch(`${runtime.baseUrl}/v1/runtime/nigma/host-runs`, {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': `resume-${code}` },
        body: JSON.stringify({
          plan_id: 'plan-1',
          learner_context: { user_id: 'u', session_id: 's', objective_id: 'o' },
        }),
      });
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: 'NIGMA_HOST_UPSTREAM_REJECTED',
        message: expect.stringContaining(code),
      });
      await closers.pop()?.();
      await closers.pop()?.();
    }
  });
});

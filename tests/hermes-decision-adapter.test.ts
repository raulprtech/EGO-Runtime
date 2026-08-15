import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createHermesDecisionBinding,
  expireHermesDecisionBinding,
  fetchHermesDecisionMessages,
  inspectHermesDecisionMessages,
  parseWslUncBindingPath,
  probeHermesDecisionCompatibility,
  readHermesDecisionBindingFile,
  scanHermesDecisionBinding,
  superviseHermesDecisionBinding,
  verifyHermesDecisionBinding,
  writeHermesDecisionBindingFile,
} from '../src/integrations/hermes_decision_adapter';
import { canonicalJson, sha256 } from '../src/runtime/integrity';

const hex = (value: string) => value.repeat(64).slice(0, 64);
const phrase = `Apruebo plan plan-1 digest ${hex('a')}, ruta route-1 digest ${hex('b')}, alcance execute.`;
const now = new Date('2026-08-15T18:00:00Z');
const expiresAt = '2026-08-15T19:00:00Z';
const directories: string[] = [];

afterEach(async () => {
  while (directories.length) await fs.rm(directories.pop()!, { recursive: true, force: true });
});

function preparation() {
  const projectionCore = {
    protocol_version: 'nigma.host-preparation-interface/v1',
    interface: 'generic-sse',
    source_host_preparation_id: 'host-preparation-1',
    source_presentation_id: `host-runtime-decision-presentation-${hex('c').slice(0, 16)}`,
    source_presentation_digest: hex('c'),
    locale: 'es-MX',
    approval_phrase: phrase,
    events: [
      {
        event: 'tool.started',
        data: {
          tool_call_id: 'host-preparation-1', tool_name: 'nigma.plan', status: 'started',
          message: 'Preparando', plan_id: 'plan-1', plan_digest: hex('a'),
        },
      },
      {
        event: 'tool.completed',
        data: {
          tool_call_id: 'host-preparation-1', tool_name: 'nigma.plan', status: 'completed',
          message: 'Preparado', plan_id: 'plan-1', plan_digest: hex('a'),
        },
      },
      {
        event: 'assistant.completed',
        data: {
          content: `Revisa el plan.\n${phrase}`, completed: true,
          host_preparation_id: 'host-preparation-1', plan_id: 'plan-1',
        },
      },
    ],
    authority: 'human_decision_required',
    approval_recorded: false,
    execution_performed: false,
  };
  const digest = sha256(canonicalJson(projectionCore));
  return {
    protocol_version: 'nigma.host-preparation/v1',
    host_preparation_id: 'host-preparation-1',
    interface_projection: {
      ...projectionCore,
      id: `host-preparation-interface-${digest.slice(0, 16)}`,
      digest,
    },
    approval_granted: false,
    execution_performed: false,
  };
}

function config() {
  return {
    hermesBaseUrl: 'http://127.0.0.1:8642',
    hermesApiKey: 'hermes-key',
    hermesProfile: 'aria',
    egoBaseUrl: 'http://127.0.0.1:3000',
    egoRuntimeToken: 'ego-runtime-token',
    humanDecisionToken: 'human-decision-token-that-is-long-0001',
  };
}

function approvalResponse(body: Record<string, any>) {
  const approvalCore = {
    protocol_version: 'nigma.trusted-human-approval-record/v1',
    approval_id: 'approval-1',
    plan_id: 'plan-1',
    plan_digest: hex('a'),
    agent_route_id: 'route-1',
    agent_route_digest: hex('b'),
    approver: body.approver,
    decision: 'approved',
    created_at: body.turn.observed_at,
    expires_at: body.expires_at,
    source_host_preparation_id: body.host_preparation_id,
    source_interface_projection_id: body.interface_projection_id,
    source_interface_projection_digest: body.interface_projection_digest,
    approval_phrase_sha256: sha256(body.turn.content),
    authority: 'trusted_human_adapter',
    approval_recorded: true,
    execution_performed: false,
  };
  const approval = { ...approvalCore, digest: sha256(canonicalJson(approvalCore)) };
  const core = {
    protocol_version: 'nigma.trusted-conversation-decision-record/v1',
    source_conversation_ref_sha256: sha256(`conversation:${body.turn.conversation_ref}`),
    source_message_ref_sha256: sha256(`message:${body.turn.message_ref}`),
    observed_at: body.turn.observed_at,
    approval,
    authority: 'trusted_conversation_adapter',
    approval_recorded: true,
    execution_performed: false,
  };
  return { ...core, digest: sha256(canonicalJson(core)) };
}

function binding() {
  return createHermesDecisionBinding(
    preparation(),
    'hermes-session-1',
    { data: [{ id: 'old-message-1', role: 'user', content: 'Hola' }] },
    'raulprtech',
    expiresAt,
    now,
    'aria',
    hex('d'),
  );
}

describe('Hermes trusted-decision sidecar', () => {
  it('accepts only bounded WSL UNC binding paths for Windows supervision', () => {
    expect(parseWslUncBindingPath('\\\\wsl.localhost\\Ubuntu\\home\\raulprtech\\binding.json'))
      .toEqual({ distro: 'Ubuntu', linuxPath: '/home/raulprtech/binding.json' });
    expect(parseWslUncBindingPath('\\\\wsl$\\Ubuntu\\tmp\\binding.json'))
      .toEqual({ distro: 'Ubuntu', linuxPath: '/tmp/binding.json' });
    expect(parseWslUncBindingPath('C:\\Users\\raul_\\binding.json')).toBeNull();
    expect(parseWslUncBindingPath('\\\\wsl.localhost\\Ubuntu\\tmp\\..\\binding.json')).toBeNull();
    expect(parseWslUncBindingPath('\\\\server\\share\\binding.json')).toBeNull();
  });

  it('creates a sealed content-free baseline and persists it owner-only', async () => {
    const value = binding();
    const text = JSON.stringify(value);
    expect(value.state).toBe('pending');
    expect(value.baseline_message_ref_sha256).toEqual([
      sha256('message:old-message-1'),
    ]);
    expect(text).not.toContain(phrase);
    expect(text).not.toContain('hermes-session-1');
    expect(text).not.toContain('old-message-1');

    const directory = await fs.mkdtemp(path.join('/tmp', 'ego-g110-binding-'));
    directories.push(directory);
    const file = path.join(directory, 'binding.json');
    await writeHermesDecisionBindingFile(file, value);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
    await expect(readHermesDecisionBindingFile(file)).resolves.toEqual(value);
  });

  it('preserves the previous binding when atomic replacement fails', async () => {
    const directory = await fs.mkdtemp(path.join('/tmp', 'ego-g112-binding-'));
    directories.push(directory);
    const file = path.join(directory, 'binding.json');
    const value = binding();
    await writeHermesDecisionBindingFile(file, value);
    const rename = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('rename failed'));
    await expect(writeHermesDecisionBindingFile(file, value)).rejects.toThrow('rename failed');
    rename.mockRestore();
    await expect(readHermesDecisionBindingFile(file)).resolves.toEqual(value);
    expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
  });

  it('ignores baseline, model and decorated messages without contacting EGO', async () => {
    const call = vi.fn();
    const result = await scanHermesDecisionBinding(binding(), 'hermes-session-1', {
      data: [
        { id: 'old-message-1', role: 'user', content: phrase },
        { id: 'assistant-1', role: 'assistant', content: phrase },
        { id: 'user-2', role: 'user', content: `Por favor, ${phrase}` },
      ],
    }, config(), new Date('2026-08-15T18:05:00Z'), call as unknown as typeof fetch);
    expect(result.outcome).toBe('no_match');
    expect(call).not.toHaveBeenCalled();
  });

  it('records one exact new user message, seals the binding and cannot record twice', async () => {
    let submitted: Record<string, any> | undefined;
    let submittedHeaders: Record<string, string> | undefined;
    const call = vi.fn(async (_input: any, init?: RequestInit) => {
      submitted = JSON.parse(String(init?.body));
      submittedHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify(approvalResponse(submitted)), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const result = await scanHermesDecisionBinding(binding(), 'hermes-session-1', {
      data: [
        { id: 'old-message-1', role: 'user', content: 'Hola' },
        { id: 'new-message-1', role: 'user', content: phrase },
      ],
    }, config(), new Date('2026-08-15T18:05:00Z'), call as unknown as typeof fetch);
    expect(result.outcome).toBe('approval_recorded');
    if (result.outcome !== 'approval_recorded') throw new Error('unreachable');
    expect(result.binding).toMatchObject({
      state: 'recorded',
      decision: {
        source_message_ref_sha256: sha256('message:new-message-1'),
        approval_id: 'approval-1',
      },
    });
    expect(JSON.stringify(result.binding)).not.toContain(phrase);
    expect(JSON.stringify(result.binding)).not.toContain('new-message-1');
    expect(submitted).toMatchObject({
      protocol_version: 'nigma.trusted-conversation-decision/v1',
      turn: {
        role: 'user', origin: 'externally_authenticated_human',
        conversation_ref: 'hermes-session-1', message_ref: 'new-message-1',
        content: phrase,
      },
    });
    expect(submittedHeaders?.authorization).toBe('Bearer ego-runtime-token');
    expect(submittedHeaders?.['x-nigma-human-decision-token'])
      .toBe('human-decision-token-that-is-long-0001');
    expect(submittedHeaders?.['idempotency-key']).toMatch(/^hermes-decision-[a-f0-9]{40}$/);

    const noCall = vi.fn();
    const replay = await scanHermesDecisionBinding(
      result.binding, 'hermes-session-1', [], config(),
      new Date('2026-08-15T18:06:00Z'), noCall as unknown as typeof fetch,
    );
    expect(replay.outcome).toBe('already_recorded');
    expect(noCall).not.toHaveBeenCalled();
  });

  it('fails closed for ambiguous decisions, wrong session and modified binding', async () => {
    await expect(scanHermesDecisionBinding(binding(), 'hermes-session-1', { data: [
      { id: 'new-1', role: 'user', content: phrase },
      { id: 'new-2', role: 'user', content: phrase },
    ] }, config(), new Date('2026-08-15T18:05:00Z')))
      .rejects.toMatchObject({ code: 'AMBIGUOUS_HUMAN_DECISION' });
    await expect(scanHermesDecisionBinding(
      binding(), 'another-session', [], config(), new Date('2026-08-15T18:05:00Z'),
    )).rejects.toMatchObject({ code: 'SESSION_BINDING_MISMATCH' });
    const changed = { ...binding(), approver: 'other-owner' };
    expect(() => verifyHermesDecisionBinding(changed))
      .toThrow('Binding digest is invalid');
  });

  it('retrieves Hermes messages with host credentials and rejects unsafe URLs', async () => {
    const call = vi.fn(async (input: any, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:8642/api/sessions/session%2Fone/messages?limit=10000&order=oldest&profile=aria');
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer hermes-key');
      return new Response(JSON.stringify({ data: [] }), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
    await expect(fetchHermesDecisionMessages(
      config(), 'session/one', call as unknown as typeof fetch,
    )).resolves.toEqual({ data: [] });
    expect(inspectHermesDecisionMessages({
      object: 'list', session_id: 'session/one', data: [],
    })).toEqual({ message_count: 0 });
    await expect(fetchHermesDecisionMessages({
      ...config(), hermesBaseUrl: 'http://hermes.example',
    }, 'session-1')).rejects.toMatchObject({ code: 'ADAPTER_CONFIG_INVALID' });
  });

  it('probes the real Hermes 0.20 capability shape and binds the profile', async () => {
    const call = vi.fn(async (input: any, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:8642/v1/capabilities?profile=aria');
      expect((init?.headers as Record<string, string>).authorization).toBe('Bearer hermes-key');
      return new Response(JSON.stringify({
        object: 'hermes.api_server.capabilities',
        platform: 'hermes-agent',
        auth: { type: 'bearer', required: true },
        features: { session_resources: true },
        endpoints: {
          session_messages: {
            method: 'GET', path: '/api/sessions/{session_id}/messages',
          },
        },
      }), { headers: { 'Content-Type': 'application/json' } });
    });
    const compatibility = await probeHermesDecisionCompatibility(
      config(), call as unknown as typeof fetch,
    );
    expect(compatibility).toMatchObject({
      platform: 'hermes-agent', profile_sha256: sha256('profile:aria'),
    });
    expect(compatibility.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(binding()).toMatchObject({
      protocol_version: 'nigma.hermes-conversation-binding/v2',
      hermes_profile_sha256: sha256('profile:aria'),
      hermes_contract_digest: hex('d'),
    });
    await expect(scanHermesDecisionBinding(
      binding(), 'hermes-session-1', { data: [] },
      { ...config(), hermesProfile: 'other' }, new Date('2026-08-15T18:05:00Z'),
    )).rejects.toMatchObject({ code: 'PROFILE_BINDING_MISMATCH' });
  });

  it('supervises through one transient Hermes failure and seals one approval', async () => {
    let messageReads = 0;
    const call = vi.fn(async (input: any, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/messages?')) {
        messageReads += 1;
        if (messageReads === 1) return new Response('{}', { status: 503 });
        return new Response(JSON.stringify({ data: [
          { id: 'old-message-1', role: 'user', content: 'Hola' },
          { id: 'new-message-1', role: 'user', content: phrase },
        ] }), { headers: { 'Content-Type': 'application/json' } });
      }
      const body = JSON.parse(String(init?.body));
      return new Response(JSON.stringify(approvalResponse(body)), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const writes: unknown[] = [];
    const wait = vi.fn(async () => undefined);
    const result = await superviseHermesDecisionBinding({
      binding: binding(), sessionRef: 'hermes-session-1', config: config(),
      now: () => new Date('2026-08-15T18:05:00Z'), wait,
      fetchImpl: call as unknown as typeof fetch,
      onBinding: async value => { writes.push(value); },
    });
    expect(result).toMatchObject({
      outcome: 'approval_recorded', scans: 1, transient_errors: 1,
      binding: { state: 'recorded' },
    });
    expect(wait).toHaveBeenCalledOnce();
    expect(writes).toHaveLength(1);
    const replayCall = vi.fn();
    await expect(superviseHermesDecisionBinding({
      binding: result.binding, sessionRef: 'hermes-session-1', config: config(),
      fetchImpl: replayCall as unknown as typeof fetch,
    })).resolves.toMatchObject({ outcome: 'already_recorded', scans: 0 });
    expect(replayCall).not.toHaveBeenCalled();
  });

  it('stops after the configured transient error budget without changing binding', async () => {
    const call = vi.fn(async () => new Response('{}', { status: 503 }));
    const writes = vi.fn();
    await expect(superviseHermesDecisionBinding({
      binding: binding(), sessionRef: 'hermes-session-1', config: config(),
      now: () => new Date('2026-08-15T18:05:00Z'),
      wait: async () => undefined, maxTransientErrors: 1,
      fetchImpl: call as unknown as typeof fetch, onBinding: writes,
    })).rejects.toMatchObject({ code: 'TRANSIENT_ERROR_LIMIT' });
    expect(call).toHaveBeenCalledTimes(2);
    expect(writes).not.toHaveBeenCalled();
  });

  it('seals an expired supervisor window without reading Hermes or EGO', async () => {
    const call = vi.fn();
    const writes: unknown[] = [];
    const result = await superviseHermesDecisionBinding({
      binding: binding(), sessionRef: 'hermes-session-1', config: config(),
      now: () => new Date('2026-08-15T18:59:01Z'),
      fetchImpl: call as unknown as typeof fetch,
      onBinding: async value => { writes.push(value); },
    });
    expect(result).toMatchObject({
      outcome: 'approval_window_closed', scans: 0, transient_errors: 0,
      binding: { state: 'expired', decision: null },
    });
    expect(call).not.toHaveBeenCalled();
    expect(writes).toHaveLength(1);
    expect(expireHermesDecisionBinding(result.binding)).toEqual(result.binding);
  });
});

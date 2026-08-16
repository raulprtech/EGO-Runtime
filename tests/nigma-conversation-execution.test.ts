import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  authorizeNigmaConversationExecution,
  listNigmaDecisionEvents,
  recordNigmaConversationDecisionEvent,
  recordNigmaConversationExecutionEvent,
} from '../src/runtime/nigma_decision_events';
import { canonicalJson, sha256 } from '../src/runtime/integrity';
import type {
  NigmaHostRunResult,
  NigmaTrustedConversationDecisionResult,
} from '../src/runtime/nigma_host';

const hex = (value: string) => value.repeat(64).slice(0, 64);
const directories: string[] = [];

afterEach(async () => {
  delete process.env.LOCAL_DATA_DIR;
  while (directories.length) {
    await fs.rm(directories.pop()!, { recursive: true, force: true });
  }
});

function decision(): NigmaTrustedConversationDecisionResult {
  const approvalCore = {
    protocol_version: 'nigma.trusted-human-approval-record/v1' as const,
    approval_id: 'approval-execution-1',
    plan_id: 'plan-execution-1',
    plan_digest: hex('a'),
    agent_route_id: 'route-execution-1',
    agent_route_digest: hex('b'),
    approver: 'local-owner',
    decision: 'approved' as const,
    created_at: '2026-08-15T18:00:00Z',
    expires_at: '2026-08-15T19:00:00Z',
    source_host_preparation_id: 'host-preparation-execution-1',
    source_interface_projection_id: `host-preparation-interface-${hex('c').slice(0, 16)}`,
    source_interface_projection_digest: hex('c'),
    approval_phrase_sha256: hex('d'),
    authority: 'trusted_human_adapter' as const,
    approval_recorded: true as const,
    execution_performed: false as const,
  };
  const approval = {
    ...approvalCore,
    digest: sha256(canonicalJson(approvalCore)),
  };
  const phrase = `Ejecuta plan ${approval.plan_id} digest ${approval.plan_digest}, aprobación ${approval.approval_id} digest ${approval.digest}.`;
  const core = {
    protocol_version: 'nigma.trusted-conversation-decision-record/v1' as const,
    source_conversation_ref_sha256: sha256('conversation:aria-session-1'),
    source_message_ref_sha256: sha256('message:aria-approval-message-1'),
    observed_at: '2026-08-15T18:00:00Z',
    approval,
    authority: 'trusted_conversation_adapter' as const,
    approval_recorded: true as const,
    execution_performed: false as const,
    execution_authorization: {
      protocol_version: 'nigma.conversation-execution-authorization/v1' as const,
      phrase,
      phrase_sha256: sha256(phrase),
      plan_id: approval.plan_id,
      plan_digest: approval.plan_digest,
      approval_id: approval.approval_id,
      approval_digest: approval.digest,
      expires_at: approval.expires_at,
      human_action_required: true as const,
      execution_performed: false as const,
    },
  };
  return {
    ...core,
    digest: sha256(canonicalJson(core)),
  };
}

function hostResult(): NigmaHostRunResult {
  const occurredAt = '2026-08-15T18:05:01Z';
  return {
    protocol_version: 'nigma.host-run-result/v1',
    host_run_id: `host-${hex('1').slice(0, 32)}`,
    plan_id: 'plan-execution-1',
    invocation_id: 'invocation-execution-1',
    invocation_digest: hex('2'),
    runtime_id: 'ego-runtime',
    runtime_version: '0.9.0',
    runtime_run_id: 'invocation-execution-1',
    runtime_submission_status: 'accepted',
    receipt_id: 'receipt-execution-1',
    receipt_digest: hex('3'),
    status: 'succeeded',
    events: [{
      protocol_version: 'nigma.host-event/v1',
      host_run_id: `host-${hex('1').slice(0, 32)}`,
      plan_id: 'plan-execution-1',
      sequence: 1,
      kind: 'run_completed',
      occurred_at: occurredAt,
      attempt: 1,
      replayed: false,
      evidence: [],
    }],
  };
}

describe('trusted conversation execution authority', () => {
  it('continues to read sealed G1.13 decision events', async () => {
    const directory = await fs.mkdtemp(path.join('/tmp', 'ego-g115-legacy-'));
    directories.push(directory);
    process.env.LOCAL_DATA_DIR = directory;
    const core = {
      protocol_version: 'nigma.decision-event/v1' as const,
      id: 'nigma-approval:approval-legacy-1',
      interface_profile_sha256: sha256('profile:aria'),
      source_conversation_ref_sha256: hex('1'),
      approval_id: 'approval-legacy-1',
      approval_digest: hex('2'),
      conversation_record_digest: hex('3'),
      type: 'background' as const,
      title: 'Aprobación registrada' as const,
      content: 'Nigma registró tu aprobación. La ejecución no comenzó; requiere un paso separado.' as const,
      timestamp: Date.parse('2026-08-15T17:00:00Z'),
      execution_performed: false as const,
    };
    const event = { ...core, record_digest: sha256(canonicalJson(core)) };
    const eventDirectory = path.join(directory, 'nigma-decision-events');
    await fs.mkdir(eventDirectory, { recursive: true, mode: 0o700 });
    await fs.writeFile(
      path.join(eventDirectory, `${sha256(core.id)}.json`),
      JSON.stringify(event),
      { mode: 0o600 },
    );
    await expect(listNigmaDecisionEvents('aria')).resolves.toEqual([{
      id: core.id,
      type: core.type,
      title: core.title,
      content: core.content,
      timestamp: core.timestamp,
    }]);
  });

  it('requires the exact second human turn and projects one terminal receipt', async () => {
    const directory = await fs.mkdtemp(path.join('/tmp', 'ego-g115-execution-'));
    directories.push(directory);
    process.env.LOCAL_DATA_DIR = directory;
    const approved = decision();
    const approvalEvent = await recordNigmaConversationDecisionEvent(approved, 'aria');
    expect(approvalEvent.content).toContain(approved.execution_authorization.phrase);

    const request = {
      protocol_version: 'nigma.trusted-conversation-execution/v1',
      host_preparation_id: approved.approval.source_host_preparation_id,
      interface_projection_id: approved.approval.source_interface_projection_id,
      interface_projection_digest: approved.approval.source_interface_projection_digest,
      approval_id: approved.approval.approval_id,
      approval_digest: approved.approval.digest,
      turn: {
        role: 'user',
        origin: 'externally_authenticated_human',
        conversation_ref: 'aria-session-1',
        message_ref: 'aria-execution-message-1',
        observed_at: '2026-08-15T18:05:00Z',
        content: approved.execution_authorization.phrase,
      },
    };
    const authority = await authorizeNigmaConversationExecution(
      request, 'aria', new Date('2026-08-15T18:05:00Z'),
    );
    expect(authority).toMatchObject({
      challenge: {
        plan_id: approved.approval.plan_id,
        approval_id: approved.approval.approval_id,
      },
      learner_context: {
        objective_id: expect.stringMatching(/^plan-[a-f0-9]{32}$/),
      },
      idempotency_key: expect.stringMatching(/^conversation-execution-[a-f0-9]{40}$/),
    });
    await expect(authorizeNigmaConversationExecution(
      {
        ...request,
        turn: { ...request.turn, content: `${request.turn.content} ahora` },
      },
      'aria',
      new Date('2026-08-15T18:05:00Z'),
    )).rejects.toMatchObject({
      code: 'NIGMA_CONVERSATION_EXECUTION_INTEGRITY_MISMATCH',
    });
    await expect(authorizeNigmaConversationExecution(
      request, 'other-profile', new Date('2026-08-15T18:05:00Z'),
    )).rejects.toMatchObject({
      code: 'NIGMA_CONVERSATION_EXECUTION_INTEGRITY_MISMATCH',
    });

    const record = await recordNigmaConversationExecutionEvent(
      authority, hostResult(), 'aria',
    );
    expect(record).toMatchObject({
      approval_id: approved.approval.approval_id,
      host_run_status: 'succeeded',
      approval_recorded: true,
      execution_performed: true,
    });
    await expect(recordNigmaConversationExecutionEvent(
      authority, hostResult(), 'aria',
    )).resolves.toEqual(record);
    const events = await listNigmaDecisionEvents('aria');
    expect(events).toHaveLength(2);
    expect(events.map(event => event.title)).toEqual([
      'Ejecución finalizada',
      'Aprobación registrada',
    ]);

    const challengeNames = await fs.readdir(path.join(
      directory, 'nigma-execution-challenges',
    ));
    expect(challengeNames).toHaveLength(1);
    const challengeFile = path.join(
      directory, 'nigma-execution-challenges', challengeNames[0],
    );
    const challengeText = await fs.readFile(challengeFile, 'utf8');
    expect((await fs.stat(challengeFile)).mode & 0o777).toBe(0o600);
    expect(challengeText).not.toContain(approved.execution_authorization.phrase);
    expect(challengeText).not.toContain('aria-session-1');
  });
});

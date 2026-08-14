import fs from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  createNigmaRuntimeReceipt,
  NigmaAdapterPolicySchema,
  NigmaInvocationEnvelopeSchema,
  nigmaInvocationDigest,
  validateAndMapNigmaSubmission,
} from '../src/runtime/nigma_handoff';

async function fixture() {
  return JSON.parse(await fs.readFile(
    new URL('./fixtures/nigma-handoff-v1.json', import.meta.url), 'utf8',
  )) as { invocation: unknown; ego_policy: unknown };
}

describe('Nigma handoff hardening', () => {
  it('rejects ambiguous policy identities', async () => {
    const value = await fixture();
    const policy = value.ego_policy as { plugins: unknown[] };
    expect(() => NigmaAdapterPolicySchema.parse({
      ...policy,
      plugins: [...policy.plugins, policy.plugins[0]],
    })).toThrow(/plugin snapshot IDs cannot contain duplicates/);
  });

  it('rejects a resealed outer envelope with inconsistent nested binding hashes', async () => {
    const value = await fixture();
    const original = NigmaInvocationEnvelopeSchema.parse(value.invocation);
    const changed = NigmaInvocationEnvelopeSchema.parse({
      ...original,
      agent_route: {
        ...original.agent_route,
        bindings: original.agent_route.bindings.map((binding, index) => index ? binding : {
          ...binding,
          plugin_snapshot_digest: 'f'.repeat(64),
        }),
      },
      digest: '0'.repeat(64),
    });
    const resealed = { ...changed, digest: nigmaInvocationDigest(changed) };

    expect(() => validateAndMapNigmaSubmission({
      invocation: resealed,
      learner_context: {
        user_id: 'fixture_learner',
        session_id: 'fixture_session',
        objective_id: 'fixture_objective',
      },
    }, NigmaAdapterPolicySchema.parse(value.ego_policy), new Date('2026-08-14T07:00:00Z')))
      .toThrowError(expect.objectContaining({ code: 'NIGMA_ROUTE_INVALID' }));
  });

  it('refuses to emit a Nigma receipt with incomplete artifact evidence', () => {
    expect(() => createNigmaRuntimeReceipt({
      request_id: 'run_1',
      user_id: 'user_1',
      session_id: 'session_1',
      objective_id: 'objective_1',
      status: 'completed',
      created_at: '2026-08-14T06:00:00Z',
      completed_at: '2026-08-14T06:01:00Z',
      updated_at: '2026-08-14T06:01:00Z',
      request_payload: {
        metadata: {
          nigma: {
            invocation_id: 'invocation_1',
            invocation_digest: 'a'.repeat(64),
          },
        },
      },
      artifacts: [{
        id: 'artifact_1',
        name: 'study_plan.json',
        mime_type: 'application/json',
        uri: 'file:///controlled/output/study_plan.json',
      }],
    })).toThrowError(expect.objectContaining({ code: 'NIGMA_ARTIFACT_EVIDENCE_INCOMPLETE' }));
  });
});

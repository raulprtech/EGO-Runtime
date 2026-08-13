import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { ExecuteRequestSchema } from '../src/api/schemas/runtime_schemas';
import {
  approvalRequestDigest, canonicalJson, createResultReceipt, sha256, verifyExecutionApproval,
} from '../src/runtime/integrity';

describe('execution approval integrity', () => {
  afterEach(() => {
    delete process.env.REQUIRE_EXECUTION_APPROVAL;
    delete process.env.EXECUTION_APPROVAL_SECRET;
    delete process.env.RESULT_RECEIPT_SECRET;
  });

  it('requires approval before a job can be created when the gate is enabled', () => {
    process.env.REQUIRE_EXECUTION_APPROVAL = 'true';
    const input = ExecuteRequestSchema.parse({
      request_id: 'request_1', user_id: 'user_1', session_id: 'session_1',
      objective_id: 'objective_1', message: 'Master the source',
    });
    expect(verifyExecutionApproval(input)).toEqual({ ok: false, status: 428, error: 'APPROVAL_REQUIRED' });
  });

  it('accepts only a live signature bound to the normalized request', () => {
    process.env.REQUIRE_EXECUTION_APPROVAL = 'true';
    process.env.EXECUTION_APPROVAL_SECRET = 'approval-secret';
    const request = ExecuteRequestSchema.parse({
      request_id: 'request_1', user_id: 'user_1', session_id: 'session_1',
      objective_id: 'objective_1', message: 'Master the source',
    });
    const claims = {
      approval_id: 'approval_1', approved_by: 'user_1',
      approved_at: '2026-08-12T12:00:00.000Z', expires_at: '2026-08-12T13:00:00.000Z',
      request_digest: approvalRequestDigest(request),
    };
    const signature = createHmac('sha256', 'approval-secret').update(canonicalJson(claims)).digest('hex');
    const approved = ExecuteRequestSchema.parse({ ...request, approval: { ...claims, signature } });

    expect(verifyExecutionApproval(approved, new Date('2026-08-12T12:30:00.000Z'))).toEqual({ ok: true });
    expect(verifyExecutionApproval({ ...approved, approval: { ...approved.approval!, signature: '0'.repeat(64) } },
      new Date('2026-08-12T12:30:00.000Z'))).toEqual({
      ok: false, status: 403, error: 'INVALID_APPROVAL_SIGNATURE',
    });
    expect(verifyExecutionApproval(approved, new Date('2026-08-12T13:00:00.000Z'))).toEqual({
      ok: false, status: 403, error: 'APPROVAL_EXPIRED_OR_INVALID',
    });
    expect(verifyExecutionApproval({ ...approved, message: 'Changed after approval' },
      new Date('2026-08-12T12:30:00.000Z'))).toEqual({
      ok: false, status: 409, error: 'APPROVAL_REQUEST_MISMATCH',
    });
  });
});

describe('result receipt integrity', () => {
  afterEach(() => delete process.env.RESULT_RECEIPT_SECRET);

  it('creates a deterministic HMAC receipt for terminal output', () => {
    process.env.RESULT_RECEIPT_SECRET = 'receipt-secret';
    const job = {
      request_id: 'request_1', user_id: 'user_1', session_id: 'session_1', objective_id: 'objective_1',
      request_digest: 'a'.repeat(64), status: 'completed', completed_at: '2026-08-12T13:00:00.000Z',
      updated_at: '2026-08-12T13:00:00.000Z', artifacts: [{ id: 'artifact_1', sha256: 'b'.repeat(64) }],
    };
    const first = createResultReceipt(job);
    const second = createResultReceipt(job);
    expect(second).toEqual(first);
    expect(first.receipt_id).toMatch(/^rcpt_[a-f0-9]{32}$/);
    expect(first.signature).toMatch(/^[a-f0-9]{64}$/);
    const { receipt_id: _receiptId, payload_digest: payloadDigest, algorithm: _algorithm,
      signature: receiptSignature, ...payload } = first;
    expect(payloadDigest).toBe(sha256(canonicalJson(payload)));
    expect(receiptSignature).toBe(createHmac('sha256', 'receipt-secret')
      .update(canonicalJson(payload)).digest('hex'));
  });

  it('does not issue a receipt before execution reaches a terminal state', () => {
    process.env.RESULT_RECEIPT_SECRET = 'receipt-secret';
    expect(() => createResultReceipt({
      request_id: 'request_1', user_id: 'user_1', session_id: 'session_1', objective_id: 'objective_1',
      status: 'running', request_digest: 'a'.repeat(64), updated_at: '2026-08-12T13:00:00.000Z',
    })).toThrow('RESULT_NOT_TERMINAL');
  });
});

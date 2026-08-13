import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { ExecuteRequest } from '../api/schemas/runtime_schemas';
import type { JobRecord } from '../services/runtime_repository';
import { RUNTIME_ID, RUNTIME_VERSION } from './manifest';

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function approvalRequestDigest(input: ExecuteRequest): string {
  const { approval: _approval, ...request } = input;
  return sha256(canonicalJson(request));
}

function equalHex(actual: string, expected: string): boolean {
  const left = Buffer.from(actual, 'hex');
  const right = Buffer.from(expected, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export type ApprovalVerification =
  | { ok: true }
  | { ok: false; status: number; error: string };

export function verifyExecutionApproval(input: ExecuteRequest, now = new Date()): ApprovalVerification {
  const required = process.env.REQUIRE_EXECUTION_APPROVAL === 'true';
  if (!input.approval) return required
    ? { ok: false, status: 428, error: 'APPROVAL_REQUIRED' }
    : { ok: true };

  const secret = process.env.EXECUTION_APPROVAL_SECRET;
  if (!secret) return { ok: false, status: 503, error: 'APPROVAL_VERIFICATION_NOT_CONFIGURED' };
  if (input.approval.request_digest !== approvalRequestDigest(input)) {
    return { ok: false, status: 409, error: 'APPROVAL_REQUEST_MISMATCH' };
  }
  const approvedAt = Date.parse(input.approval.approved_at);
  const expiresAt = Date.parse(input.approval.expires_at);
  if (approvedAt > now.getTime() + 60_000 || expiresAt <= now.getTime() || expiresAt <= approvedAt) {
    return { ok: false, status: 403, error: 'APPROVAL_EXPIRED_OR_INVALID' };
  }
  const { signature, ...claims } = input.approval;
  const expected = createHmac('sha256', secret).update(canonicalJson(claims)).digest('hex');
  return equalHex(signature, expected)
    ? { ok: true }
    : { ok: false, status: 403, error: 'INVALID_APPROVAL_SIGNATURE' };
}

export interface ResultReceipt {
  receipt_version: '1.0';
  receipt_id: string;
  runtime_id: string;
  runtime_version: string;
  request_id: string;
  session_id: string;
  objective_id: string;
  request_digest: string;
  status: 'completed' | 'failed' | 'cancelled';
  artifacts: unknown[];
  finished_at: string;
  payload_digest: string;
  algorithm: 'hmac-sha256';
  signature: string;
}

export function createResultReceipt(job: JobRecord): ResultReceipt {
  const secret = process.env.RESULT_RECEIPT_SECRET;
  if (!secret) throw new Error('RESULT_RECEIPT_NOT_CONFIGURED');
  if (!['completed', 'failed', 'cancelled'].includes(job.status)) throw new Error('RESULT_NOT_TERMINAL');
  const payload = {
    receipt_version: '1.0' as const,
    runtime_id: RUNTIME_ID,
    runtime_version: RUNTIME_VERSION,
    request_id: job.request_id,
    session_id: job.session_id,
    objective_id: job.objective_id,
    request_digest: String(job.request_digest),
    status: job.status as 'completed' | 'failed' | 'cancelled',
    artifacts: Array.isArray(job.artifacts) ? job.artifacts : [],
    finished_at: String(job.completed_at ?? job.updated_at),
  };
  const serialized = canonicalJson(payload);
  const payloadDigest = sha256(serialized);
  return {
    ...payload,
    receipt_id: `rcpt_${payloadDigest.slice(0, 32)}`,
    payload_digest: payloadDigest,
    algorithm: 'hmac-sha256',
    signature: createHmac('sha256', secret).update(serialized).digest('hex'),
  };
}

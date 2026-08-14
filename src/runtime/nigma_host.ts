import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { z } from 'zod';
import {
  NigmaInvocationEnvelopeSchema,
  type NigmaInvocationEnvelope,
} from './nigma_handoff';

const BoundedId = z.string().min(1).max(300);
const Digest = z.string().regex(/^[a-f0-9]{64}$/);

const LearnerContextSchema = z.object({
  user_id: z.string().min(1).max(128),
  session_id: z.string().min(1).max(128),
  objective_id: z.string().min(1).max(128),
}).strict();

export const NigmaHostRunRequestSchema = z.object({
  plan_id: BoundedId,
  learner_context: LearnerContextSchema,
}).strict();
export type NigmaHostRunRequest = z.infer<typeof NigmaHostRunRequestSchema>;

const RuntimeRouteSchema = z.object({
  runtime_id: z.string().min(1).max(200),
  runtime_version: z.string().min(1).max(100),
  base_url: z.url(),
  credential_env: z.string().regex(/^NIGMA_RUNTIME_TOKEN_[A-Z0-9_]{1,80}$/),
}).strict();

export const NigmaHostRoutesSchema = z.object({
  protocol_version: z.literal('nigma.host-routes/v1'),
  routes: z.array(RuntimeRouteSchema).min(1).max(20),
}).strict().superRefine((value, context) => {
  const identities = value.routes.map(item => `${item.runtime_id}\u0000${item.runtime_version}`);
  if (new Set(identities).size !== identities.length) {
    context.addIssue({ code: 'custom', message: 'runtime route identities cannot repeat' });
  }
});
export type NigmaHostRoutes = z.infer<typeof NigmaHostRoutesSchema>;

const RuntimeSubmissionResponseSchema = z.object({
  invocation_id: BoundedId,
  invocation_digest: Digest,
  runtime_run_id: BoundedId,
  status: z.enum(['accepted', 'redispatched', 'already_accepted']),
}).strict();

const RuntimeJobSchema = z.object({
  request_id: BoundedId,
  status: z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']),
}).passthrough();

const ArtifactRefSchema = z.object({
  uri: z.string().min(3).max(2000),
  sha256: Digest,
  size_bytes: z.number().int().min(0).max(1_000_000_000),
  media_type: z.string().min(1).max(200),
}).strict();

export const NigmaReceiptPayloadSchema = z.object({
  invocation_id: BoundedId,
  invocation_digest: Digest,
  execution_id: BoundedId,
  runtime_snapshot_id: BoundedId,
  runtime_snapshot_digest: Digest,
  runtime_run_id: BoundedId,
  status: z.enum(['succeeded', 'failed', 'cancelled', 'timed_out']),
  started_at: z.iso.datetime(),
  completed_at: z.iso.datetime(),
  artifacts: z.array(ArtifactRefSchema).max(100),
  event_refs: z.array(ArtifactRefSchema).max(200),
  cancellation_ref: ArtifactRefSchema.nullable(),
  assessment_refs: z.array(ArtifactRefSchema).max(100),
  mastery_refs: z.array(ArtifactRefSchema).max(100),
  issues: z.array(z.object({
    category: z.enum(['failure', 'error']),
    code: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/).max(200),
    message: z.string().min(1).max(1000),
  }).strict()).max(100),
  cost: z.record(z.string(), z.unknown()),
  metrics: z.record(z.string(), z.unknown()),
  rollback: z.record(z.string(), z.unknown()).nullable(),
}).strict().superRefine((value, context) => {
  if (Date.parse(value.completed_at) < Date.parse(value.started_at)) {
    context.addIssue({ code: 'custom', message: 'receipt completion precedes start' });
  }
  if (value.status === 'succeeded' && value.issues.length) {
    context.addIssue({ code: 'custom', message: 'succeeded receipt cannot contain issues' });
  }
  if (value.status === 'failed' && !value.issues.length) {
    context.addIssue({ code: 'custom', message: 'failed receipt requires an issue' });
  }
  if (value.status === 'cancelled' && !value.cancellation_ref) {
    context.addIssue({ code: 'custom', message: 'cancelled receipt requires evidence' });
  }
});
export type NigmaReceiptPayload = z.infer<typeof NigmaReceiptPayloadSchema>;

const HostEventKindSchema = z.enum([
  'request_received', 'invocation_authorized', 'runtime_routed', 'runtime_accepted',
  'runtime_terminal', 'receipt_observed', 'receipt_recorded', 'run_completed',
]);

export const NigmaHostEventSchema = z.object({
  protocol_version: z.literal('nigma.host-event/v1'),
  host_run_id: BoundedId,
  plan_id: BoundedId,
  sequence: z.number().int().min(1).max(10_000),
  kind: HostEventKindSchema,
  occurred_at: z.iso.datetime(),
  invocation_id: BoundedId.optional(),
  invocation_digest: Digest.optional(),
  runtime_id: z.string().min(1).max(200).optional(),
  runtime_version: z.string().min(1).max(100).optional(),
  runtime_run_id: BoundedId.optional(),
  receipt_id: BoundedId.optional(),
  receipt_digest: Digest.optional(),
  status: z.string().min(1).max(100).optional(),
  attempt: z.number().int().min(1).max(100).default(1),
  replayed: z.boolean().default(false),
  evidence: z.array(z.string().min(1).max(500)).max(20).default([]),
}).strict();
export type NigmaHostEvent = z.infer<typeof NigmaHostEventSchema>;

const AcceptedReceiptSchema = z.object({
  id: BoundedId,
  invocation_id: BoundedId,
  status: z.enum(['succeeded', 'failed', 'cancelled', 'timed_out']),
  digest: Digest,
}).passthrough();

export const NigmaHostRunResultSchema = z.object({
  protocol_version: z.literal('nigma.host-run-result/v1'),
  host_run_id: BoundedId,
  plan_id: BoundedId,
  invocation_id: BoundedId,
  invocation_digest: Digest,
  runtime_id: z.string().min(1).max(200),
  runtime_version: z.string().min(1).max(100),
  runtime_run_id: BoundedId,
  runtime_submission_status: z.enum(['accepted', 'redispatched', 'already_accepted']),
  receipt_id: BoundedId,
  receipt_digest: Digest,
  status: z.enum(['succeeded', 'failed', 'cancelled', 'timed_out']),
  events: z.array(NigmaHostEventSchema).min(1).max(10_000),
}).strict();
export type NigmaHostRunResult = z.infer<typeof NigmaHostRunResultSchema>;

export class NigmaHostError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
  }
}

let routesOverride: NigmaHostRoutes | undefined;
let cachedRoutes: { file: string; value: NigmaHostRoutes } | undefined;

export function setNigmaHostRoutesForTests(routes?: NigmaHostRoutes): void {
  routesOverride = routes;
  cachedRoutes = undefined;
}

function boundedTimeout(): number {
  const configured = Number(process.env.NIGMA_HOST_TIMEOUT_MS ?? 30_000);
  return Number.isFinite(configured) ? Math.max(1_000, Math.min(120_000, configured)) : 30_000;
}

function pollInterval(): number {
  const configured = Number(process.env.NIGMA_HOST_POLL_INTERVAL_MS ?? 250);
  return Number.isFinite(configured) ? Math.max(10, Math.min(5_000, configured)) : 250;
}

function validateServiceUrl(raw: string, label: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new NigmaHostError('NIGMA_HOST_CONFIG_INVALID', 503, `${label} URL is invalid`);
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new NigmaHostError('NIGMA_HOST_CONFIG_INVALID', 503, `${label} URL contains forbidden parts`);
  }
  const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new NigmaHostError(
      'NIGMA_HOST_CONFIG_INVALID', 503, `${label} must use HTTPS or loopback HTTP`,
    );
  }
  return url.toString().replace(/\/$/, '');
}

async function loadRoutes(): Promise<NigmaHostRoutes> {
  if (routesOverride) return routesOverride;
  const file = process.env.NIGMA_HOST_ROUTES_FILE;
  if (!file) {
    throw new NigmaHostError('NIGMA_HOST_NOT_CONFIGURED', 503, 'Runtime routes are not configured');
  }
  if (cachedRoutes?.file === file) return cachedRoutes.value;
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    throw new NigmaHostError('NIGMA_HOST_ROUTES_UNAVAILABLE', 503, 'Runtime routes are unavailable');
  }
  const parsed = NigmaHostRoutesSchema.safeParse(value);
  if (!parsed.success) {
    throw new NigmaHostError('NIGMA_HOST_ROUTES_INVALID', 503, 'Runtime routes are invalid');
  }
  for (const route of parsed.data.routes) validateServiceUrl(route.base_url, 'Runtime');
  cachedRoutes = { file, value: parsed.data };
  return parsed.data;
}

function controlPlaneConfig(): { baseUrl: string; apiKey: string } {
  const rawUrl = process.env.NIGMA_CONTROL_PLANE_URL;
  const apiKey = process.env.NIGMA_CONTROL_PLANE_API_KEY;
  if (!rawUrl || !apiKey) {
    throw new NigmaHostError(
      'NIGMA_HOST_NOT_CONFIGURED', 503, 'Nigma control-plane connection is not configured',
    );
  }
  return { baseUrl: validateServiceUrl(rawUrl, 'Nigma control-plane'), apiKey };
}

function upstreamError(body: unknown): string {
  if (!body || typeof body !== 'object') return 'upstream request failed';
  const value = body as Record<string, unknown>;
  const detail = value.error ?? value.detail;
  if (detail && typeof detail === 'object' && 'code' in detail) return String(detail.code).slice(0, 200);
  if (typeof value.error === 'string') return value.error.slice(0, 200);
  return 'upstream request failed';
}

async function requestJson(url: string, init: RequestInit, label: string): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(boundedTimeout()) });
  } catch {
    throw new NigmaHostError('NIGMA_HOST_TRANSPORT_FAILED', 502, `${label} was unreachable`);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new NigmaHostError('NIGMA_HOST_UPSTREAM_INVALID', 502, `${label} returned invalid JSON`);
  }
  if (!response.ok) {
    throw new NigmaHostError(
      'NIGMA_HOST_UPSTREAM_REJECTED', response.status >= 500 ? 502 : response.status,
      `${label} rejected the request: ${upstreamError(body)}`,
    );
  }
  return body;
}

function runtimeRoute(invocation: NigmaInvocationEnvelope, routes: NigmaHostRoutes) {
  const route = routes.routes.find(item => item.runtime_id === invocation.runtime_id
    && item.runtime_version === invocation.runtime_version);
  if (!route) {
    throw new NigmaHostError(
      'NIGMA_SELECTED_RUNTIME_UNROUTABLE', 422,
      `No host route exists for ${invocation.runtime_id}@${invocation.runtime_version}`,
    );
  }
  const credential = process.env[route.credential_env];
  if (!credential) {
    throw new NigmaHostError(
      'NIGMA_RUNTIME_CREDENTIAL_UNAVAILABLE', 503, 'Selected runtime credential is unavailable',
    );
  }
  return { baseUrl: validateServiceUrl(route.base_url, 'Runtime'), credential };
}

function parseUpstream<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new NigmaHostError(
      'NIGMA_HOST_UPSTREAM_INVALID', 502, 'Upstream response violated its contract',
    );
  }
  return parsed.data;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

export async function runApprovedNigmaPlan(
  request: NigmaHostRunRequest,
  idempotencyKey: string,
): Promise<NigmaHostRunResult> {
  if (!idempotencyKey || idempotencyKey.length > 200) {
    throw new NigmaHostError(
      'NIGMA_HOST_IDEMPOTENCY_REQUIRED', 400, 'A bounded Idempotency-Key is required',
    );
  }
  const hostRunId = `host-${createHash('sha256')
    .update(`${request.plan_id}:${idempotencyKey}`).digest('hex').slice(0, 32)}`;
  const events: NigmaHostEvent[] = [];
  const emitEvent = (kind: z.infer<typeof HostEventKindSchema>, links: Partial<NigmaHostEvent> = {}) => {
    events.push(NigmaHostEventSchema.parse({
      protocol_version: 'nigma.host-event/v1', host_run_id: hostRunId,
      plan_id: request.plan_id, sequence: events.length + 1, kind,
      occurred_at: new Date().toISOString(), attempt: 1, replayed: false, evidence: [], ...links,
    }));
  };
  emitEvent('request_received');
  const control = controlPlaneConfig();
  const invocation = parseUpstream(NigmaInvocationEnvelopeSchema, await requestJson(
    `${control.baseUrl}/integration-plans/${encodeURIComponent(request.plan_id)}/runtime-invocations`,
    {
      method: 'POST',
      headers: { 'X-API-Key': control.apiKey, 'Idempotency-Key': idempotencyKey },
    },
    'Nigma invocation endpoint',
  ));
  if (invocation.plan_id !== request.plan_id) {
    throw new NigmaHostError('NIGMA_HOST_PLAN_MISMATCH', 409, 'Nigma returned another plan');
  }
  const invocationLinks = { invocation_id: invocation.id, invocation_digest: invocation.digest };
  emitEvent('invocation_authorized', invocationLinks);
  const route = runtimeRoute(invocation, await loadRoutes());
  const runtimeLinks = {
    ...invocationLinks, runtime_id: invocation.runtime_id, runtime_version: invocation.runtime_version,
  };
  emitEvent('runtime_routed', runtimeLinks);
  const submission = parseUpstream(RuntimeSubmissionResponseSchema, await requestJson(
    `${route.baseUrl}/nigma/invocations`,
    {
      method: 'POST', headers: authHeaders(route.credential),
      body: JSON.stringify({ invocation, learner_context: request.learner_context }),
    },
    'Selected runtime invocation endpoint',
  ));
  if (submission.invocation_id !== invocation.id
      || submission.invocation_digest !== invocation.digest
      || submission.runtime_run_id !== invocation.id) {
    throw new NigmaHostError(
      'NIGMA_RUNTIME_SUBMISSION_MISMATCH', 409, 'Runtime submission response changed sealed links',
    );
  }
  const submissionLinks = { ...runtimeLinks, runtime_run_id: submission.runtime_run_id };
  emitEvent('runtime_accepted', { ...submissionLinks, replayed: submission.status === 'already_accepted' });

  const deadline = Date.now() + Math.min(boundedTimeout(), invocation.max_duration_seconds * 1_000);
  let terminal = false;
  while (Date.now() < deadline) {
    const job = parseUpstream(RuntimeJobSchema, await requestJson(
      `${route.baseUrl}/${encodeURIComponent(submission.runtime_run_id)}`,
      { headers: authHeaders(route.credential) },
      'Selected runtime status endpoint',
    ));
    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      terminal = true;
      break;
    }
    await new Promise(resolve => setTimeout(resolve, pollInterval()));
  }
  if (!terminal) {
    throw new NigmaHostError('NIGMA_RUNTIME_WAIT_TIMEOUT', 504, 'Selected runtime did not finish in time');
  }
  emitEvent('runtime_terminal', submissionLinks);

  const receipt = parseUpstream(NigmaReceiptPayloadSchema, await requestJson(
    `${route.baseUrl}/nigma/${encodeURIComponent(invocation.id)}/receipt`,
    { headers: authHeaders(route.credential) },
    'Selected runtime receipt endpoint',
  ));
  if (receipt.invocation_id !== invocation.id || receipt.invocation_digest !== invocation.digest) {
    throw new NigmaHostError('NIGMA_RUNTIME_RECEIPT_MISMATCH', 409, 'Runtime receipt changed sealed links');
  }
  emitEvent('receipt_observed', { ...submissionLinks, status: receipt.status });
  const accepted = parseUpstream(AcceptedReceiptSchema, await requestJson(
    `${control.baseUrl}/runtime-invocations/${encodeURIComponent(invocation.id)}/receipts`,
    {
      method: 'POST', headers: { 'X-API-Key': control.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(receipt),
    },
    'Nigma receipt endpoint',
  ));
  if (accepted.invocation_id !== invocation.id || accepted.status !== receipt.status) {
    throw new NigmaHostError('NIGMA_RECEIPT_ACCEPTANCE_MISMATCH', 409, 'Nigma accepted different links');
  }
  const receiptLinks = {
    ...submissionLinks, receipt_id: accepted.id, receipt_digest: accepted.digest,
  };
  emitEvent('receipt_recorded', receiptLinks);
  emitEvent('run_completed', { ...receiptLinks, status: accepted.status });
  return NigmaHostRunResultSchema.parse({
    protocol_version: 'nigma.host-run-result/v1',
    host_run_id: hostRunId,
    plan_id: request.plan_id,
    invocation_id: invocation.id,
    invocation_digest: invocation.digest,
    runtime_id: invocation.runtime_id,
    runtime_version: invocation.runtime_version,
    runtime_run_id: submission.runtime_run_id,
    runtime_submission_status: submission.status,
    receipt_id: accepted.id,
    receipt_digest: accepted.digest,
    status: accepted.status,
    events,
  });
}

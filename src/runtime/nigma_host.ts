import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
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

const EducationalMaterialReferenceSchema = z.object({
  uri: z.string().min(8).max(2000),
  media_type: z.string().min(1).max(200).default('application/octet-stream'),
  schema_ref: z.string().min(3).max(500).default('schema://learning-material/v1'),
  sha256: Digest.optional(),
  size_bytes: z.number().int().min(0).max(2_000_000_000).optional(),
}).strict().superRefine((value, context) => {
  let parsed: URL;
  try { parsed = new URL(value.uri); } catch {
    context.addIssue({ code: 'custom', message: 'material URI is invalid' });
    return;
  }
  if (parsed.protocol !== 'file:' || !parsed.pathname) {
    context.addIssue({ code: 'custom', message: 'materials must use file:// references' });
  }
  if (parsed.hostname && parsed.hostname !== 'localhost') {
    context.addIssue({ code: 'custom', message: 'material file references must remain local' });
  }
  if (parsed.username || parsed.password) {
    context.addIssue({ code: 'custom', message: 'material references cannot contain credentials' });
  }
});

export const NigmaEducationalPreparationRequestSchema = z.object({
  objective: z.string().min(3).max(4000),
  materials: z.array(EducationalMaterialReferenceSchema).min(1).max(20),
  project: z.string().min(1).max(200).default('education'),
  max_duration_seconds: z.number().int().min(30).max(86_400).default(600),
  required_runtime_capabilities: z.array(z.enum([
    'educational_execution', 'assessment', 'mastery_tracking',
  ])).min(1).max(3).default(['educational_execution']),
}).strict().superRefine((value, context) => {
  if (!value.required_runtime_capabilities.includes('educational_execution')) {
    context.addIssue({ code: 'custom', message: 'educational_execution is always required' });
  }
  if (new Set(value.required_runtime_capabilities).size
      !== value.required_runtime_capabilities.length) {
    context.addIssue({ code: 'custom', message: 'runtime capabilities cannot repeat' });
  }
});
export type NigmaEducationalPreparationRequest = z.infer<
  typeof NigmaEducationalPreparationRequestSchema
>;

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

const NigmaHostRunRecordCoreSchema = z.object({
  protocol_version: z.literal('nigma.host-run-record/v1'),
  host_run_id: z.string().regex(/^host-[a-f0-9]{32}$/),
  plan_id: BoundedId,
  request_digest: Digest,
  idempotency_digest: Digest,
  status: z.enum(['running', 'succeeded', 'failed', 'cancelled', 'timed_out', 'error']),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
  events: z.array(NigmaHostEventSchema).max(10_000),
  artifact_refs: z.array(ArtifactRefSchema).max(500),
  result: NigmaHostRunResultSchema.optional(),
  error: z.object({
    code: z.string().regex(/^[A-Z0-9_]+$/).max(200),
    message: z.string().min(1).max(1000),
  }).strict().optional(),
}).strict();

export const NigmaHostRunRecordSchema = NigmaHostRunRecordCoreSchema.extend({
  record_digest: Digest,
}).strict();
export type NigmaHostRunRecord = z.infer<typeof NigmaHostRunRecordSchema>;

export const NigmaHostEventPageSchema = z.object({
  protocol_version: z.literal('nigma.host-event-page/v1'),
  host_run_id: z.string().regex(/^host-[a-f0-9]{32}$/),
  status: NigmaHostRunRecordCoreSchema.shape.status,
  after: z.number().int().min(0).max(10_000),
  next_cursor: z.number().int().min(0).max(10_000),
  events: z.array(NigmaHostEventSchema).max(10_000),
  record_digest: Digest,
}).strict();
export type NigmaHostEventPage = z.infer<typeof NigmaHostEventPageSchema>;

const PreparationApprovalTargetSchema = z.object({
  scope: z.literal('execute'),
  plan_id: BoundedId,
  plan_digest: Digest,
  agent_route_id: BoundedId,
  agent_route_digest: Digest,
  plugin_selection_id: BoundedId,
  plugin_selection_digest: Digest,
  provider_binding_id: BoundedId,
  provider_binding_digest: Digest,
}).strict();

const NigmaEducationalPreparationUpstreamSchema = z.object({
  protocol_version: z.literal('nigma.educational-task-preparation/v1'),
  status: z.literal('awaiting_human_approval'),
  capability_request: z.object({
    id: BoundedId,
    objective: z.string().min(3).max(4000),
  }).passthrough(),
  integration_plan: z.object({
    id: BoundedId,
    request_id: BoundedId,
    digest: Digest,
    confidence: z.number().min(0).max(1),
    risk_level: z.enum(['low', 'medium', 'high', 'critical']),
    runtime_selection: z.object({
      id: BoundedId,
      digest: Digest,
      selected_snapshot_id: BoundedId,
      selected_snapshot_digest: Digest,
      selected_runtime_id: z.string().min(1).max(200),
      selected_runtime_version: z.string().min(1).max(100),
    }).passthrough(),
  }).passthrough(),
  plugin_selection: z.object({
    id: BoundedId,
    digest: Digest,
    status: z.literal('selected'),
  }).passthrough(),
  provider_binding: z.object({
    id: BoundedId,
    digest: Digest,
    status: z.literal('ready'),
  }).passthrough(),
  agent_route: z.object({
    id: BoundedId,
    digest: Digest,
    plan_id: BoundedId,
    plan_digest: Digest,
    runtime_selection_id: BoundedId,
    runtime_selection_digest: Digest,
    plugin_selection_id: BoundedId,
    plugin_selection_digest: Digest,
    provider_binding_id: BoundedId,
    provider_binding_digest: Digest,
    runtime_id: z.string().min(1).max(200),
    runtime_version: z.string().min(1).max(100),
    runtime_snapshot_id: BoundedId,
    runtime_snapshot_digest: Digest,
    status: z.literal('ready'),
    approval_granted: z.literal(false),
    execution_performed: z.literal(false),
  }).passthrough(),
  approval_target: PreparationApprovalTargetSchema,
  approval_granted: z.literal(false),
  execution_performed: z.literal(false),
}).passthrough();

export const NigmaHostPreparationResultSchema = z.object({
  protocol_version: z.literal('nigma.host-preparation/v1'),
  host_preparation_id: BoundedId,
  status: z.literal('awaiting_human_approval'),
  objective: z.string().min(3).max(4000),
  plan: z.object({
    id: BoundedId,
    digest: Digest,
    confidence: z.number().min(0).max(1),
    risk_level: z.enum(['low', 'medium', 'high', 'critical']),
  }).strict(),
  runtime: z.object({
    id: z.string().min(1).max(200),
    version: z.string().min(1).max(100),
    snapshot_id: BoundedId,
    snapshot_digest: Digest,
  }).strict(),
  approval_target: PreparationApprovalTargetSchema,
  resume: z.object({
    method: z.literal('POST'),
    path: z.literal('/v1/runtime/nigma/host-runs'),
    plan_id: BoundedId,
  }).strict(),
  approval_granted: z.literal(false),
  execution_performed: z.literal(false),
  evidence: z.array(z.string().min(1).max(500)).min(1).max(20),
}).strict();
export type NigmaHostPreparationResult = z.infer<typeof NigmaHostPreparationResultSchema>;

const NigmaRuntimeFallbackUpstreamSchema = z.object({
  protocol_version: z.literal('nigma.educational-runtime-fallback/v1'),
  id: BoundedId,
  source_invocation_id: BoundedId,
  source_invocation_digest: Digest,
  source_execution_id: BoundedId,
  source_plan_id: BoundedId,
  source_plan_digest: Digest,
  failed_runtime_id: z.string().min(1).max(200),
  failed_runtime_version: z.string().min(1).max(100),
  failed_runtime_snapshot_id: BoundedId,
  failed_runtime_snapshot_digest: Digest,
  failure_code: z.enum([
    'runtime_unreachable', 'runtime_unavailable', 'runtime_rejected',
  ]),
  observed_at: z.iso.datetime(),
  evidence_digest: Digest,
  excluded_runtime_ids: z.array(z.string().min(1).max(200)).min(1).max(20),
  preparation: NigmaEducationalPreparationUpstreamSchema,
  status: z.literal('awaiting_human_approval'),
  approval_granted: z.literal(false),
  execution_performed: z.literal(false),
  digest: Digest,
  created_at: z.iso.datetime(),
}).strict();

export const NigmaHostFallbackPreparationSchema = z.object({
  protocol_version: z.literal('nigma.host-fallback-preparation/v1'),
  host_run_id: z.string().regex(/^host-[a-f0-9]{32}$/),
  fallback_id: BoundedId,
  fallback_digest: Digest,
  status: z.literal('awaiting_human_approval'),
  failure: z.object({
    code: z.enum(['runtime_unreachable', 'runtime_unavailable', 'runtime_rejected']),
    evidence_digest: Digest,
  }).strict(),
  failed_runtime: z.object({
    id: z.string().min(1).max(200),
    version: z.string().min(1).max(100),
    snapshot_id: BoundedId,
    snapshot_digest: Digest,
  }).strict(),
  replacement: NigmaHostPreparationResultSchema,
  approval_granted: z.literal(false),
  execution_performed: z.literal(false),
  evidence: z.array(z.string().min(1).max(500)).min(1).max(20),
}).strict();
export type NigmaHostFallbackPreparation = z.infer<
  typeof NigmaHostFallbackPreparationSchema
>;

export class NigmaHostError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
  }
}

type NigmaHostRunRecordCore = z.infer<typeof NigmaHostRunRecordCoreSchema>;

let hostRecordQueue: Promise<unknown> = Promise.resolve();

function hostRecordDirectory(): string {
  return path.resolve(process.env.LOCAL_DATA_DIR ?? '.ego-runtime', 'nigma-host-runs');
}

function hostRecordFile(hostRunId: string): string {
  if (!/^host-[a-f0-9]{32}$/.test(hostRunId)) {
    throw new NigmaHostError('NIGMA_HOST_RUN_ID_INVALID', 400, 'Host run id is invalid');
  }
  return path.join(hostRecordDirectory(), `${hostRunId}.json`);
}

function digestValue(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sealedHostRecord(core: NigmaHostRunRecordCore): NigmaHostRunRecord {
  const parsed = NigmaHostRunRecordCoreSchema.parse(core);
  return NigmaHostRunRecordSchema.parse({ ...parsed, record_digest: digestValue(parsed) });
}

async function readHostRecordOrNull(hostRunId: string): Promise<NigmaHostRunRecord | null> {
  const file = hostRecordFile(hostRunId);
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new NigmaHostError(
      'NIGMA_HOST_RECORD_INVALID', 500, 'Host run record is unreadable or invalid',
    );
  }
  const parsed = NigmaHostRunRecordSchema.safeParse(raw);
  if (!parsed.success) {
    throw new NigmaHostError('NIGMA_HOST_RECORD_INVALID', 500, 'Host run record is invalid');
  }
  const { record_digest: storedDigest, ...coreValue } = parsed.data;
  const core = NigmaHostRunRecordCoreSchema.parse(coreValue);
  if (digestValue(core) !== storedDigest) {
    throw new NigmaHostError(
      'NIGMA_HOST_RECORD_INTEGRITY_FAILED', 500, 'Host run record failed integrity validation',
    );
  }
  return parsed.data;
}

async function writeHostRecord(core: NigmaHostRunRecordCore): Promise<NigmaHostRunRecord> {
  const run = async () => {
    const record = sealedHostRecord(core);
    const directory = hostRecordDirectory();
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700);
    const file = hostRecordFile(record.host_run_id);
    const temporary = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(record, null, 2), { mode: 0o600 });
    await fs.rename(temporary, file);
    return record;
  };
  const result = hostRecordQueue.then(run, run);
  hostRecordQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function getNigmaHostRunRecord(hostRunId: string): Promise<NigmaHostRunRecord> {
  const record = await readHostRecordOrNull(hostRunId);
  if (!record) throw new NigmaHostError('NIGMA_HOST_RUN_NOT_FOUND', 404, 'Host run was not found');
  return record;
}

export async function getNigmaHostRunEvents(
  hostRunId: string, after: number,
): Promise<NigmaHostEventPage> {
  if (!Number.isInteger(after) || after < 0 || after > 10_000) {
    throw new NigmaHostError('NIGMA_HOST_EVENT_CURSOR_INVALID', 400, 'Event cursor is invalid');
  }
  const record = await getNigmaHostRunRecord(hostRunId);
  const events = record.events.filter(event => event.sequence > after);
  return NigmaHostEventPageSchema.parse({
    protocol_version: 'nigma.host-event-page/v1',
    host_run_id: hostRunId,
    status: record.status,
    after,
    next_cursor: events.at(-1)?.sequence ?? after,
    events,
    record_digest: record.record_digest,
  });
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


export async function prepareNigmaEducationalTask(
  request: NigmaEducationalPreparationRequest,
  idempotencyKey: string,
): Promise<NigmaHostPreparationResult> {
  if (!idempotencyKey || idempotencyKey.length > 200) {
    throw new NigmaHostError(
      'NIGMA_HOST_IDEMPOTENCY_REQUIRED', 400, 'A bounded Idempotency-Key is required',
    );
  }
  const control = controlPlaneConfig();
  const prepared = parseUpstream(NigmaEducationalPreparationUpstreamSchema, await requestJson(
    `${control.baseUrl}/educational-tasks/prepare`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': control.apiKey,
        'Idempotency-Key': idempotencyKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    },
    'Nigma educational preparation endpoint',
  ));
  const plan = prepared.integration_plan;
  const runtime = plan.runtime_selection;
  const route = prepared.agent_route;
  const approval = prepared.approval_target;
  const linksAgree = prepared.capability_request.objective === request.objective
    && plan.request_id === prepared.capability_request.id
    && approval.plan_id === plan.id
    && approval.plan_digest === plan.digest
    && approval.agent_route_id === route.id
    && approval.agent_route_digest === route.digest
    && approval.plugin_selection_id === prepared.plugin_selection.id
    && approval.plugin_selection_digest === prepared.plugin_selection.digest
    && approval.provider_binding_id === prepared.provider_binding.id
    && approval.provider_binding_digest === prepared.provider_binding.digest
    && route.plan_id === plan.id
    && route.plan_digest === plan.digest
    && route.runtime_selection_id === runtime.id
    && route.runtime_selection_digest === runtime.digest
    && route.plugin_selection_id === prepared.plugin_selection.id
    && route.plugin_selection_digest === prepared.plugin_selection.digest
    && route.provider_binding_id === prepared.provider_binding.id
    && route.provider_binding_digest === prepared.provider_binding.digest
    && route.runtime_id === runtime.selected_runtime_id
    && route.runtime_version === runtime.selected_runtime_version
    && route.runtime_snapshot_id === runtime.selected_snapshot_id
    && route.runtime_snapshot_digest === runtime.selected_snapshot_digest;
  if (!linksAgree) {
    throw new NigmaHostError(
      'NIGMA_PREPARATION_LINK_MISMATCH', 502,
      'Nigma preparation returned inconsistent sealed links',
    );
  }
  const hostPreparationId = `host-preparation-${createHash('sha256')
    .update(`${plan.id}:${plan.digest}:${route.id}:${route.digest}`)
    .digest('hex').slice(0, 32)}`;
  return NigmaHostPreparationResultSchema.parse({
    protocol_version: 'nigma.host-preparation/v1',
    host_preparation_id: hostPreparationId,
    status: 'awaiting_human_approval',
    objective: request.objective,
    plan: {
      id: plan.id,
      digest: plan.digest,
      confidence: plan.confidence,
      risk_level: plan.risk_level,
    },
    runtime: {
      id: runtime.selected_runtime_id,
      version: runtime.selected_runtime_version,
      snapshot_id: runtime.selected_snapshot_id,
      snapshot_digest: runtime.selected_snapshot_digest,
    },
    approval_target: approval,
    resume: {
      method: 'POST',
      path: '/v1/runtime/nigma/host-runs',
      plan_id: plan.id,
    },
    approval_granted: false,
    execution_performed: false,
    evidence: [
      `nigma_request:${prepared.capability_request.id}`,
      `plan:${plan.id}`,
      `plan_digest:${plan.digest}`,
      `agent_route:${route.id}`,
      `agent_route_digest:${route.digest}`,
    ],
  });
}

function fallbackFailure(record: NigmaHostRunRecord): {
  code: 'runtime_unreachable' | 'runtime_unavailable' | 'runtime_rejected';
  invocationId: string;
  invocationDigest: string;
} {
  if (record.status !== 'error' || !record.error) {
    throw new NigmaHostError(
      'NIGMA_HOST_FALLBACK_NOT_ALLOWED', 409,
      'Fallback requires a persisted pre-acceptance runtime failure',
    );
  }
  const accepted = record.events.some(event => event.kind === 'runtime_accepted');
  const invocationEvent = [...record.events].reverse().find(
    event => event.invocation_id && event.invocation_digest,
  );
  const last = record.events.at(-1);
  if (accepted || !invocationEvent?.invocation_id || !invocationEvent.invocation_digest || !last) {
    throw new NigmaHostError(
      'NIGMA_HOST_FALLBACK_NOT_ALLOWED', 409,
      'Fallback cannot replace an accepted or unidentified runtime attempt',
    );
  }
  let code: 'runtime_unreachable' | 'runtime_unavailable' | 'runtime_rejected';
  if (['NIGMA_SELECTED_RUNTIME_UNROUTABLE', 'NIGMA_RUNTIME_CREDENTIAL_UNAVAILABLE']
    .includes(record.error.code) && last.kind === 'invocation_authorized') {
    code = 'runtime_unavailable';
  } else if (record.error.code === 'NIGMA_HOST_TRANSPORT_FAILED'
      && last.kind === 'runtime_routed') {
    code = 'runtime_unreachable';
  } else if (record.error.code === 'NIGMA_HOST_UPSTREAM_REJECTED'
      && last.kind === 'runtime_routed') {
    code = 'runtime_rejected';
  } else {
    throw new NigmaHostError(
      'NIGMA_HOST_FALLBACK_NOT_ALLOWED', 409,
      'Persisted failure is not eligible for safe pre-acceptance fallback',
    );
  }
  return {
    code,
    invocationId: invocationEvent.invocation_id,
    invocationDigest: invocationEvent.invocation_digest,
  };
}

function projectFallbackPreparation(
  prepared: z.infer<typeof NigmaEducationalPreparationUpstreamSchema>,
): NigmaHostPreparationResult {
  const plan = prepared.integration_plan;
  const runtime = plan.runtime_selection;
  const route = prepared.agent_route;
  const approval = prepared.approval_target;
  const linksAgree = plan.request_id === prepared.capability_request.id
    && approval.plan_id === plan.id
    && approval.plan_digest === plan.digest
    && approval.agent_route_id === route.id
    && approval.agent_route_digest === route.digest
    && approval.plugin_selection_id === prepared.plugin_selection.id
    && approval.plugin_selection_digest === prepared.plugin_selection.digest
    && approval.provider_binding_id === prepared.provider_binding.id
    && approval.provider_binding_digest === prepared.provider_binding.digest
    && route.plan_id === plan.id
    && route.plan_digest === plan.digest
    && route.runtime_selection_id === runtime.id
    && route.runtime_selection_digest === runtime.digest
    && route.plugin_selection_id === prepared.plugin_selection.id
    && route.plugin_selection_digest === prepared.plugin_selection.digest
    && route.provider_binding_id === prepared.provider_binding.id
    && route.provider_binding_digest === prepared.provider_binding.digest
    && route.runtime_id === runtime.selected_runtime_id
    && route.runtime_version === runtime.selected_runtime_version
    && route.runtime_snapshot_id === runtime.selected_snapshot_id
    && route.runtime_snapshot_digest === runtime.selected_snapshot_digest;
  if (!linksAgree) {
    throw new NigmaHostError(
      'NIGMA_PREPARATION_LINK_MISMATCH', 502,
      'Nigma fallback returned inconsistent sealed replacement links',
    );
  }
  const hostPreparationId = `host-preparation-${createHash('sha256')
    .update(`${plan.id}:${plan.digest}:${route.id}:${route.digest}`)
    .digest('hex').slice(0, 32)}`;
  return NigmaHostPreparationResultSchema.parse({
    protocol_version: 'nigma.host-preparation/v1',
    host_preparation_id: hostPreparationId,
    status: 'awaiting_human_approval',
    objective: prepared.capability_request.objective,
    plan: {
      id: plan.id, digest: plan.digest,
      confidence: plan.confidence, risk_level: plan.risk_level,
    },
    runtime: {
      id: runtime.selected_runtime_id, version: runtime.selected_runtime_version,
      snapshot_id: runtime.selected_snapshot_id,
      snapshot_digest: runtime.selected_snapshot_digest,
    },
    approval_target: approval,
    resume: { method: 'POST', path: '/v1/runtime/nigma/host-runs', plan_id: plan.id },
    approval_granted: false,
    execution_performed: false,
    evidence: [
      `nigma_request:${prepared.capability_request.id}`,
      `plan:${plan.id}`, `plan_digest:${plan.digest}`,
      `agent_route:${route.id}`, `agent_route_digest:${route.digest}`,
    ],
  });
}

export async function prepareNigmaHostFallback(
  hostRunId: string, idempotencyKey: string,
): Promise<NigmaHostFallbackPreparation> {
  if (!idempotencyKey || idempotencyKey.length > 200) {
    throw new NigmaHostError(
      'NIGMA_HOST_IDEMPOTENCY_REQUIRED', 400, 'A bounded Idempotency-Key is required',
    );
  }
  const record = await getNigmaHostRunRecord(hostRunId);
  const failure = fallbackFailure(record);
  const control = controlPlaneConfig();
  const fallback = parseUpstream(NigmaRuntimeFallbackUpstreamSchema, await requestJson(
    `${control.baseUrl}/runtime-invocations/${encodeURIComponent(failure.invocationId)}/fallbacks`,
    {
      method: 'POST',
      headers: {
        'X-API-Key': control.apiKey,
        'Idempotency-Key': idempotencyKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        failure_code: failure.code,
        observed_at: record.updated_at,
        evidence_digest: record.record_digest,
      }),
    },
    'Nigma runtime fallback endpoint',
  ));
  if (fallback.source_invocation_id !== failure.invocationId
      || fallback.source_invocation_digest !== failure.invocationDigest
      || fallback.source_plan_id !== record.plan_id
      || fallback.failure_code !== failure.code
      || fallback.evidence_digest !== record.record_digest
      || !fallback.excluded_runtime_ids.includes(fallback.failed_runtime_id)) {
    throw new NigmaHostError(
      'NIGMA_HOST_FALLBACK_LINK_MISMATCH', 502,
      'Nigma fallback changed source failure or integrity evidence',
    );
  }
  const replacement = projectFallbackPreparation(fallback.preparation);
  if (replacement.runtime.id === fallback.failed_runtime_id) {
    throw new NigmaHostError(
      'NIGMA_HOST_FALLBACK_LINK_MISMATCH', 502,
      'Nigma fallback selected the failed runtime again',
    );
  }
  return NigmaHostFallbackPreparationSchema.parse({
    protocol_version: 'nigma.host-fallback-preparation/v1',
    host_run_id: hostRunId,
    fallback_id: fallback.id,
    fallback_digest: fallback.digest,
    status: 'awaiting_human_approval',
    failure: { code: fallback.failure_code, evidence_digest: fallback.evidence_digest },
    failed_runtime: {
      id: fallback.failed_runtime_id, version: fallback.failed_runtime_version,
      snapshot_id: fallback.failed_runtime_snapshot_id,
      snapshot_digest: fallback.failed_runtime_snapshot_digest,
    },
    replacement,
    approval_granted: false,
    execution_performed: false,
    evidence: [
      `source_host_run:${hostRunId}`,
      `source_record_digest:${record.record_digest}`,
      `source_invocation:${failure.invocationId}`,
      `fallback:${fallback.id}`,
      `fallback_digest:${fallback.digest}`,
    ],
  });
}

const activeHostRuns = new Map<string, {
  requestDigest: string;
  promise: Promise<NigmaHostRunResult>;
}>();

async function executeApprovedNigmaPlan(
  request: NigmaHostRunRequest, idempotencyKey: string, hostRunId: string,
  requestDigest: string, idempotencyDigest: string,
): Promise<NigmaHostRunResult> {
  const now = new Date().toISOString();
  const existing = await readHostRecordOrNull(hostRunId);
  if (existing && (existing.plan_id !== request.plan_id
      || existing.request_digest !== requestDigest
      || existing.idempotency_digest !== idempotencyDigest)) {
    throw new NigmaHostError(
      'NIGMA_HOST_IDEMPOTENCY_CONFLICT', 409,
      'Idempotency key is already bound to a different host request',
    );
  }
  const priorEvents = existing?.events ?? [];
  const attempt = (priorEvents.at(-1)?.attempt ?? 0) + 1;
  let record: NigmaHostRunRecordCore = NigmaHostRunRecordCoreSchema.parse({
    protocol_version: 'nigma.host-run-record/v1',
    host_run_id: hostRunId,
    plan_id: request.plan_id,
    request_digest: requestDigest,
    idempotency_digest: idempotencyDigest,
    status: 'running',
    created_at: existing?.created_at ?? now,
    updated_at: now,
    events: priorEvents,
    artifact_refs: [],
  });
  const persist = async () => {
    record.updated_at = new Date().toISOString();
    await writeHostRecord(record);
  };
  const emitEvent = async (
    kind: z.infer<typeof HostEventKindSchema>, links: Partial<NigmaHostEvent> = {},
  ) => {
    record.events.push(NigmaHostEventSchema.parse({
      protocol_version: 'nigma.host-event/v1', host_run_id: hostRunId,
      plan_id: request.plan_id, sequence: record.events.length + 1, kind,
      occurred_at: new Date().toISOString(), attempt, replayed: false, evidence: [], ...links,
    }));
    await persist();
  };

  await emitEvent('request_received');
  try {
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
    await emitEvent('invocation_authorized', invocationLinks);
    const route = runtimeRoute(invocation, await loadRoutes());
    const runtimeLinks = {
      ...invocationLinks, runtime_id: invocation.runtime_id, runtime_version: invocation.runtime_version,
    };
    await emitEvent('runtime_routed', runtimeLinks);
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
    await emitEvent('runtime_accepted', {
      ...submissionLinks, replayed: submission.status === 'already_accepted',
    });

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
      throw new NigmaHostError(
        'NIGMA_RUNTIME_WAIT_TIMEOUT', 504, 'Selected runtime did not finish in time',
      );
    }
    await emitEvent('runtime_terminal', submissionLinks);

    const receipt = parseUpstream(NigmaReceiptPayloadSchema, await requestJson(
      `${route.baseUrl}/nigma/${encodeURIComponent(invocation.id)}/receipt`,
      { headers: authHeaders(route.credential) },
      'Selected runtime receipt endpoint',
    ));
    if (receipt.invocation_id !== invocation.id || receipt.invocation_digest !== invocation.digest) {
      throw new NigmaHostError(
        'NIGMA_RUNTIME_RECEIPT_MISMATCH', 409, 'Runtime receipt changed sealed links',
      );
    }
    const references = [
      ...receipt.artifacts, ...receipt.event_refs, ...receipt.assessment_refs,
      ...receipt.mastery_refs, ...(receipt.cancellation_ref ? [receipt.cancellation_ref] : []),
    ];
    record.artifact_refs = [...new Map(references.map(reference => [
      `${reference.uri}\u0000${reference.sha256}`, reference,
    ])).values()];
    await emitEvent('receipt_observed', { ...submissionLinks, status: receipt.status });
    const accepted = parseUpstream(AcceptedReceiptSchema, await requestJson(
      `${control.baseUrl}/runtime-invocations/${encodeURIComponent(invocation.id)}/receipts`,
      {
        method: 'POST', headers: { 'X-API-Key': control.apiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify(receipt),
      },
      'Nigma receipt endpoint',
    ));
    if (accepted.invocation_id !== invocation.id || accepted.status !== receipt.status) {
      throw new NigmaHostError(
        'NIGMA_RECEIPT_ACCEPTANCE_MISMATCH', 409, 'Nigma accepted different links',
      );
    }
    const receiptLinks = {
      ...submissionLinks, receipt_id: accepted.id, receipt_digest: accepted.digest,
    };
    await emitEvent('receipt_recorded', receiptLinks);
    await emitEvent('run_completed', { ...receiptLinks, status: accepted.status });
    const result = NigmaHostRunResultSchema.parse({
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
      events: record.events,
    });
    record.status = accepted.status;
    record.result = result;
    delete record.error;
    await persist();
    return result;
  } catch (error) {
    const hostError = error instanceof NigmaHostError ? error : undefined;
    record.status = hostError?.code === 'NIGMA_RUNTIME_WAIT_TIMEOUT' ? 'timed_out' : 'error';
    record.error = {
      code: hostError?.code ?? 'NIGMA_HOST_INTERNAL_ERROR',
      message: hostError?.message ?? 'Host execution failed unexpectedly',
    };
    delete record.result;
    await persist();
    throw error;
  }
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
  const requestDigest = digestValue(NigmaHostRunRequestSchema.parse(request));
  const idempotencyDigest = digestValue(idempotencyKey);
  const active = activeHostRuns.get(hostRunId);
  if (active) {
    if (active.requestDigest !== requestDigest) {
      throw new NigmaHostError(
        'NIGMA_HOST_IDEMPOTENCY_CONFLICT', 409,
        'Idempotency key is already bound to a different host request',
      );
    }
    return active.promise;
  }
  const promise = executeApprovedNigmaPlan(
    request, idempotencyKey, hostRunId, requestDigest, idempotencyDigest,
  );
  activeHostRuns.set(hostRunId, { requestDigest, promise });
  try {
    return await promise;
  } finally {
    if (activeHostRuns.get(hostRunId)?.promise === promise) activeHostRuns.delete(hostRunId);
  }
}

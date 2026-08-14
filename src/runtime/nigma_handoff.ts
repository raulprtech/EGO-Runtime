import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { Artifact, ExecuteRequest, ExecuteRequestSchema } from '../api/schemas/runtime_schemas';
import type { JobRecord } from '../services/runtime_repository';
import { canonicalJson, sha256 } from './integrity';
import { RUNTIME_ID, RUNTIME_VERSION } from './manifest';

const DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const BoundedIdSchema = z.string().min(1).max(300);
const PermissionSchema = z.string().min(1).max(200);

const ProviderBindingSchema = z.object({
  requirement_id: z.string().min(1).max(500),
  plugin_snapshot_id: z.string().min(1).max(200),
  plugin_snapshot_digest: DigestSchema,
  capability: z.string().min(1).max(200),
  provider_snapshot_id: z.string().min(1).max(200),
  provider_snapshot_digest: DigestSchema,
  provider_id: z.string().min(1).max(200),
  provider_version: z.string().min(1).max(100),
  permissions: z.array(PermissionSchema).max(100),
  evidence: z.array(z.string().min(1).max(1000)).max(20),
}).strict();

const AgentRouteContextSchema = z.object({
  agent_route_id: BoundedIdSchema,
  agent_route_digest: DigestSchema,
  plugin_selection_id: BoundedIdSchema,
  plugin_selection_digest: DigestSchema,
  provider_binding_id: BoundedIdSchema,
  provider_binding_digest: DigestSchema,
  selected_plugin_snapshot_ids: z.array(BoundedIdSchema).min(1).max(12),
  selected_plugin_snapshot_digests: z.array(DigestSchema).min(1).max(12),
  selected_provider_snapshot_ids: z.array(BoundedIdSchema).max(12),
  selected_provider_snapshot_digests: z.array(DigestSchema).max(12),
  bindings: z.array(ProviderBindingSchema).max(100),
  required_permissions: z.array(PermissionSchema).max(200),
}).strict();

export const NigmaInvocationEnvelopeSchema = z.object({
  id: BoundedIdSchema,
  execution_id: BoundedIdSchema,
  request_id: BoundedIdSchema,
  request_digest: DigestSchema,
  plan_id: BoundedIdSchema,
  plan_digest: DigestSchema,
  approval_id: BoundedIdSchema,
  runtime_selection_id: BoundedIdSchema,
  runtime_selection_digest: DigestSchema,
  runtime_snapshot_id: BoundedIdSchema,
  runtime_snapshot_digest: DigestSchema,
  runtime_id: z.string().min(1).max(200),
  runtime_version: z.string().min(1).max(100),
  agent_route: AgentRouteContextSchema,
  objective: z.string().min(3).max(4_000),
  input_references: z.array(z.record(z.string(), z.unknown())).min(1).max(20),
  expected_output: z.record(z.string(), z.unknown()),
  steps: z.array(z.unknown()).max(200),
  required_runtime_capabilities: z.array(z.string().min(1).max(200)).max(200),
  required_permissions: z.array(PermissionSchema).max(200),
  max_duration_seconds: z.number().int().min(1).max(86_400),
  must_start_before: z.iso.datetime(),
  digest: DigestSchema,
  created_at: z.iso.datetime(),
}).strict();
export type NigmaInvocationEnvelope = z.infer<typeof NigmaInvocationEnvelopeSchema>;

const LearnerContextSchema = z.object({
  user_id: z.string().min(1).max(128),
  session_id: z.string().min(1).max(128),
  objective_id: z.string().min(1).max(128),
}).strict();

export const NigmaInvocationSubmissionSchema = z.object({
  invocation: NigmaInvocationEnvelopeSchema,
  learner_context: LearnerContextSchema,
}).strict();
export type NigmaInvocationSubmission = z.infer<typeof NigmaInvocationSubmissionSchema>;

const PolicyPluginSchema = z.object({
  snapshot_id: BoundedIdSchema,
  snapshot_digest: DigestSchema,
  runtime_capabilities: z.array(z.string().min(1).max(200)).min(1).max(50),
}).strict();

const PolicyProviderSchema = z.object({
  snapshot_id: BoundedIdSchema,
  snapshot_digest: DigestSchema,
  uri_schemes: z.array(z.enum(['file', 'gs'])).min(1).max(2),
}).strict();

const PolicyBindingSchema = z.object({
  plugin_snapshot_id: BoundedIdSchema,
  provider_snapshot_id: BoundedIdSchema,
  capability: z.string().min(1).max(200),
}).strict();

export const NigmaAdapterPolicySchema = z.object({
  protocol_version: z.literal('nigma.runtime-handoff/v1'),
  runtime_id: z.literal(RUNTIME_ID),
  runtime_version: z.literal(RUNTIME_VERSION),
  allowed_nigma_capabilities: z.array(z.string().min(1).max(200)).min(1).max(100),
  allowed_permissions: z.array(PermissionSchema).max(200),
  allowed_output_types: z.array(z.string().min(1).max(100)).min(1).max(50),
  plugins: z.array(PolicyPluginSchema).min(1).max(50),
  providers: z.array(PolicyProviderSchema).max(50),
  bindings: z.array(PolicyBindingSchema).max(200),
}).strict().superRefine((value, context) => {
  const groups: Array<[string, string[]]> = [
    ['allowed_nigma_capabilities', value.allowed_nigma_capabilities],
    ['allowed_permissions', value.allowed_permissions],
    ['allowed_output_types', value.allowed_output_types],
    ['plugin snapshot IDs', value.plugins.map(item => item.snapshot_id)],
    ['provider snapshot IDs', value.providers.map(item => item.snapshot_id)],
    ['bindings', value.bindings.map(item =>
      `${item.plugin_snapshot_id}\u0000${item.provider_snapshot_id}\u0000${item.capability}`)],
  ];
  for (const [label, items] of groups) {
    if (new Set(items).size !== items.length) {
      context.addIssue({ code: 'custom', message: `${label} cannot contain duplicates` });
    }
  }
  for (const plugin of value.plugins) {
    if (new Set(plugin.runtime_capabilities).size !== plugin.runtime_capabilities.length) {
      context.addIssue({ code: 'custom', message: 'plugin runtime capabilities cannot repeat' });
    }
  }
});
export type NigmaAdapterPolicy = z.infer<typeof NigmaAdapterPolicySchema>;

export class NigmaHandoffError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

let policyOverride: NigmaAdapterPolicy | undefined;
let cachedPolicy: { file: string; value: NigmaAdapterPolicy } | undefined;

export function setNigmaAdapterPolicyForTests(policy?: NigmaAdapterPolicy): void {
  policyOverride = policy;
  cachedPolicy = undefined;
}

export function isNigmaHandoffConfigured(): boolean {
  return process.env.NIGMA_HANDOFF_ENABLED === 'true'
    && Boolean(policyOverride || process.env.NIGMA_ADAPTER_POLICY_FILE);
}

export async function getNigmaAdapterPolicy(): Promise<NigmaAdapterPolicy> {
  if (process.env.NIGMA_HANDOFF_ENABLED !== 'true') {
    throw new NigmaHandoffError('NIGMA_HANDOFF_DISABLED', 404, 'Nigma handoff is disabled');
  }
  if (policyOverride) return policyOverride;
  const file = process.env.NIGMA_ADAPTER_POLICY_FILE;
  if (!file) {
    throw new NigmaHandoffError(
      'NIGMA_POLICY_NOT_CONFIGURED', 503, 'Nigma adapter policy is not configured',
    );
  }
  if (cachedPolicy?.file === file) return cachedPolicy.value;
  let raw: string;
  try {
    raw = await fs.readFile(path.resolve(file), 'utf8');
  } catch {
    throw new NigmaHandoffError('NIGMA_POLICY_UNAVAILABLE', 503, 'Nigma adapter policy is unavailable');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new NigmaHandoffError('NIGMA_POLICY_INVALID', 503, 'Nigma adapter policy is not valid JSON');
  }
  const result = NigmaAdapterPolicySchema.safeParse(parsed);
  if (!result.success) {
    throw new NigmaHandoffError('NIGMA_POLICY_INVALID', 503, 'Nigma adapter policy is invalid');
  }
  cachedPolicy = { file, value: result.data };
  return result.data;
}

function unique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) {
    throw new NigmaHandoffError('NIGMA_ROUTE_INVALID', 409, `${label} contains duplicates`);
  }
}

function exactPairs(
  identities: readonly string[], digests: readonly string[], label: string,
): Array<[string, string]> {
  if (identities.length !== digests.length) {
    throw new NigmaHandoffError('NIGMA_ROUTE_INVALID', 409, `${label} identities and digests disagree`);
  }
  unique(identities, `${label} identities`);
  return identities.map((identity, index) => [identity, digests[index]]);
}

function ensureSubset(
  requested: readonly string[], allowedValues: readonly string[], code: string, label: string,
): void {
  unique(requested, label);
  const allowed = new Set(allowedValues);
  const denied = requested.filter(value => !allowed.has(value));
  if (denied.length) {
    throw new NigmaHandoffError(code, 403, `${label} are not allowlisted: ${denied.join(', ')}`);
  }
}

export function nigmaInvocationDigest(invocation: NigmaInvocationEnvelope): string {
  const { digest: _digest, ...payload } = invocation;
  return sha256(canonicalJson(payload));
}

function referenceScheme(uri: string): 'file' | 'gs' {
  if (uri.startsWith('file://')) return 'file';
  if (uri.startsWith('gs://')) return 'gs';
  throw new NigmaHandoffError(
    'NIGMA_INPUT_SCHEME_UNSUPPORTED', 422, 'Input references must use file:// or gs://',
  );
}

function inferMimeType(reference: Record<string, unknown>, uri: string): Artifact['mime_type'] {
  const declared = reference.media_type ?? reference.mime_type;
  const supported = new Set<Artifact['mime_type']>([
    'application/pdf', 'text/plain', 'text/markdown', 'application/json',
  ]);
  if (typeof declared === 'string' && supported.has(declared as Artifact['mime_type'])) {
    return declared as Artifact['mime_type'];
  }
  const lower = uri.toLowerCase().split(/[?#]/, 1)[0];
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'text/markdown';
  if (lower.endsWith('.txt')) return 'text/plain';
  if (lower.endsWith('.json')) return 'application/json';
  throw new NigmaHandoffError(
    'NIGMA_INPUT_MEDIA_TYPE_UNSUPPORTED', 422, 'Input media type is missing or unsupported',
  );
}

function inferName(reference: Record<string, unknown>, uri: string, index: number): string {
  if (typeof reference.name === 'string' && reference.name.length > 0 && reference.name.length <= 255) {
    return reference.name;
  }
  const value = uri.split(/[?#]/, 1)[0].split('/').pop();
  if (value) {
    try {
      return decodeURIComponent(value).slice(0, 255);
    } catch {
      throw new NigmaHandoffError(
        'NIGMA_INPUT_REFERENCE_INVALID', 422, 'Input URI contains invalid encoding',
      );
    }
  }
  return `source_${index + 1}`;
}

function mapArtifact(
  reference: Record<string, unknown>, index: number, allowedSchemes: Set<string>,
): Artifact {
  const uri = reference.uri;
  if (typeof uri !== 'string') {
    throw new NigmaHandoffError('NIGMA_INPUT_REFERENCE_INVALID', 422, 'Every input needs a URI');
  }
  const scheme = referenceScheme(uri);
  if (!allowedSchemes.has(scheme)) {
    throw new NigmaHandoffError(
      'NIGMA_INPUT_PROVIDER_MISMATCH', 403, `Selected providers do not allow ${scheme} inputs`,
    );
  }
  const artifact: Artifact = {
    id: `source_${index + 1}`,
    name: inferName(reference, uri, index),
    mime_type: inferMimeType(reference, uri),
    uri,
  };
  if (typeof reference.sha256 === 'string') artifact.sha256 = reference.sha256;
  if (typeof reference.size_bytes === 'number') artifact.size_bytes = reference.size_bytes;
  return artifact;
}

export function validateAndMapNigmaSubmission(
  submission: NigmaInvocationSubmission,
  policy: NigmaAdapterPolicy,
  now = new Date(),
): ExecuteRequest {
  const invocation = submission.invocation;
  if (nigmaInvocationDigest(invocation) !== invocation.digest) {
    throw new NigmaHandoffError(
      'NIGMA_INVOCATION_INTEGRITY_FAILED', 409, 'Nigma invocation digest is invalid',
    );
  }
  if (Date.parse(invocation.created_at) > now.getTime() + 60_000
      || Date.parse(invocation.must_start_before) <= now.getTime()) {
    throw new NigmaHandoffError(
      'NIGMA_APPROVAL_EXPIRED_OR_INVALID', 403, 'Nigma approval window is invalid or expired',
    );
  }
  if (invocation.runtime_id !== RUNTIME_ID || invocation.runtime_version !== RUNTIME_VERSION
      || policy.runtime_id !== invocation.runtime_id
      || policy.runtime_version !== invocation.runtime_version) {
    throw new NigmaHandoffError(
      'NIGMA_RUNTIME_MISMATCH', 422, 'Invocation targets a different runtime identity or version',
    );
  }

  const route = invocation.agent_route;
  const pluginPairs = exactPairs(
    route.selected_plugin_snapshot_ids, route.selected_plugin_snapshot_digests, 'plugin snapshots',
  );
  const providerPairs = exactPairs(
    route.selected_provider_snapshot_ids, route.selected_provider_snapshot_digests, 'provider snapshots',
  );
  const selectedPluginDigests = new Map(pluginPairs);
  const selectedProviderDigests = new Map(providerPairs);
  const policyPlugins = new Map(policy.plugins.map(item => [item.snapshot_id, item]));
  const policyProviders = new Map(policy.providers.map(item => [item.snapshot_id, item]));
  for (const [identity, digest] of pluginPairs) {
    if (policyPlugins.get(identity)?.snapshot_digest !== digest) {
      throw new NigmaHandoffError(
        'NIGMA_PLUGIN_NOT_ALLOWED', 403, `Plugin snapshot is not allowlisted: ${identity}`,
      );
    }
  }
  for (const [identity, digest] of providerPairs) {
    if (policyProviders.get(identity)?.snapshot_digest !== digest) {
      throw new NigmaHandoffError(
        'NIGMA_PROVIDER_NOT_ALLOWED', 403, `Provider snapshot is not allowlisted: ${identity}`,
      );
    }
  }
  const policyBindings = new Set(policy.bindings.map(item =>
    `${item.plugin_snapshot_id}\u0000${item.provider_snapshot_id}\u0000${item.capability}`));
  unique(route.required_permissions, 'route permissions');
  unique(route.bindings.map(item => item.requirement_id), 'provider binding requirements');
  const routePermissions = new Set(route.required_permissions);
  const boundProviders = new Set<string>();
  for (const binding of route.bindings) {
    boundProviders.add(binding.provider_snapshot_id);
    if (!route.selected_plugin_snapshot_ids.includes(binding.plugin_snapshot_id)
        || !route.selected_provider_snapshot_ids.includes(binding.provider_snapshot_id)
        || !policyBindings.has(
          `${binding.plugin_snapshot_id}\u0000${binding.provider_snapshot_id}\u0000${binding.capability}`,
        )) {
      throw new NigmaHandoffError(
        'NIGMA_BINDING_NOT_ALLOWED', 403, `Provider binding is not allowlisted: ${binding.requirement_id}`,
      );
    }
    if (binding.plugin_snapshot_digest !== selectedPluginDigests.get(binding.plugin_snapshot_id)
        || binding.provider_snapshot_digest !== selectedProviderDigests.get(binding.provider_snapshot_id)
        || `${binding.provider_id}@${binding.provider_version}` !== binding.provider_snapshot_id) {
      throw new NigmaHandoffError(
        'NIGMA_ROUTE_INVALID', 409, 'Provider binding differs from selected snapshots',
      );
    }
    if (binding.permissions.some(permission => !routePermissions.has(permission))) {
      throw new NigmaHandoffError(
        'NIGMA_ROUTE_INVALID', 409, 'Binding permissions are missing from the sealed route',
      );
    }
  }
  if (boundProviders.size !== providerPairs.length
      || providerPairs.some(([identity]) => !boundProviders.has(identity))) {
    throw new NigmaHandoffError(
      'NIGMA_ROUTE_INVALID', 409, 'Selected providers and resolved bindings disagree',
    );
  }
  const invocationPermissions = new Set(invocation.required_permissions);
  if (route.required_permissions.some(permission => !invocationPermissions.has(permission))) {
    throw new NigmaHandoffError(
      'NIGMA_ROUTE_INVALID', 409, 'Route permissions are missing from the invocation',
    );
  }
  ensureSubset(
    invocation.required_runtime_capabilities,
    policy.allowed_nigma_capabilities,
    'NIGMA_CAPABILITY_NOT_ALLOWED',
    'Nigma runtime capabilities',
  );
  ensureSubset(
    route.required_permissions,
    policy.allowed_permissions,
    'NIGMA_PERMISSION_NOT_ALLOWED',
    'route permissions',
  );
  ensureSubset(
    invocation.required_permissions,
    policy.allowed_permissions,
    'NIGMA_PERMISSION_NOT_ALLOWED',
    'invocation permissions',
  );
  const outputType = invocation.expected_output.type;
  if (typeof outputType !== 'string' || !policy.allowed_output_types.includes(outputType)) {
    throw new NigmaHandoffError(
      'NIGMA_OUTPUT_NOT_ALLOWED', 422, 'Expected output type is not allowlisted',
    );
  }

  const allowedSchemes = new Set(providerPairs.flatMap(([identity]) =>
    policyProviders.get(identity)?.uri_schemes ?? []));
  const attachments = invocation.input_references.map((item, index) =>
    mapArtifact(item, index, allowedSchemes));
  const capabilities = [...new Set(pluginPairs.flatMap(([identity]) =>
    policyPlugins.get(identity)?.runtime_capabilities ?? []))].sort();
  return ExecuteRequestSchema.parse({
    request_id: invocation.id,
    ...submission.learner_context,
    message: invocation.objective,
    attachments,
    capabilities,
    metadata: {
      nigma: {
        protocol_version: policy.protocol_version,
        invocation_id: invocation.id,
        invocation_digest: invocation.digest,
        execution_id: invocation.execution_id,
        runtime_snapshot_id: invocation.runtime_snapshot_id,
        runtime_snapshot_digest: invocation.runtime_snapshot_digest,
        agent_route_id: route.agent_route_id,
        agent_route_digest: route.agent_route_digest,
        approval_id: invocation.approval_id,
        max_duration_seconds: invocation.max_duration_seconds,
      },
    },
  });
}

type NigmaReceiptStatus = 'succeeded' | 'failed' | 'cancelled';

function logicalRef(uri: string, content: string, mediaType: string) {
  return {
    uri,
    sha256: createHash('sha256').update(content).digest('hex'),
    size_bytes: Buffer.byteLength(content),
    media_type: mediaType,
  };
}

export function createNigmaRuntimeReceipt(job: JobRecord) {
  if (!['completed', 'failed', 'cancelled'].includes(job.status)) {
    throw new NigmaHandoffError('NIGMA_RESULT_NOT_TERMINAL', 409, 'Runtime job is not terminal');
  }
  if (job.status === 'cancelled' && !job.rollback) {
    throw new NigmaHandoffError(
      'NIGMA_CANCELLATION_NOT_DRAINED', 409,
      'Cancelled runtime work has not completed cooperative rollback',
    );
  }
  const request = job.request_payload as ExecuteRequest | undefined;
  const nigma = request?.metadata?.nigma as Record<string, unknown> | undefined;
  if (!nigma || typeof nigma.invocation_id !== 'string' || typeof nigma.invocation_digest !== 'string') {
    throw new NigmaHandoffError('NIGMA_JOB_LINK_MISSING', 409, 'Runtime job has no Nigma handoff link');
  }
  const status = ({ completed: 'succeeded', failed: 'failed', cancelled: 'cancelled' } as const)[
    job.status as 'completed' | 'failed' | 'cancelled'
  ] as NigmaReceiptStatus;
  const artifacts = (Array.isArray(job.artifacts) ? job.artifacts : []) as Artifact[];
  if (artifacts.some(item => !item.sha256 || item.size_bytes === undefined)) {
    throw new NigmaHandoffError(
      'NIGMA_ARTIFACT_EVIDENCE_INCOMPLETE', 409,
      'Every Nigma receipt artifact requires a digest and byte size',
    );
  }
  const artifactRefs = artifacts.map(item => ({
    uri: item.uri,
    sha256: item.sha256!,
    size_bytes: item.size_bytes!,
    media_type: item.mime_type,
  }));
  const cancellationContent = canonicalJson({
    cancellation_id: job.cancellation_id ?? null,
    cancellation_digest: job.cancellation_digest ?? null,
    invocation_id: nigma.invocation_id,
    status: 'cancelled',
    completed_at: job.completed_at ?? job.updated_at,
  });
  return {
    invocation_id: nigma.invocation_id,
    invocation_digest: nigma.invocation_digest,
    execution_id: nigma.execution_id,
    runtime_snapshot_id: nigma.runtime_snapshot_id,
    runtime_snapshot_digest: nigma.runtime_snapshot_digest,
    runtime_run_id: job.request_id,
    status,
    started_at: job.started_at ?? job.created_at,
    completed_at: job.completed_at ?? job.updated_at,
    artifacts: artifactRefs,
    event_refs: [],
    cancellation_ref: status === 'cancelled'
      ? logicalRef(
        job.cancellation_id
          ? `nigma-cancellation://${job.cancellation_id}`
          : `ego-event://${job.request_id}/cancelled`,
        cancellationContent, 'application/json',
      ) : null,
    rollback: status === 'cancelled' ? (job.rollback ?? null) : null,
    assessment_refs: [],
    mastery_refs: artifactRefs.filter(item => item.uri.endsWith('/mastery_state.json')),
    issues: status === 'failed' ? [{
      category: 'error',
      code: 'ego_runtime_failed',
      message: String(job.error ?? 'Runtime execution failed').slice(0, 1000),
    }] : [],
    cost: {},
    metrics: {
      artifact_count: artifactRefs.length,
      attempts: Number(job.attempts ?? 0),
    },
  };
}

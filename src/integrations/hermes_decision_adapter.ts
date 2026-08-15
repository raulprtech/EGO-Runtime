import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { canonicalJson, sha256 } from '../runtime/integrity';
import {
  NigmaTrustedConversationDecisionResultSchema,
  PreparationInterfaceProjectionSchema,
} from '../runtime/nigma_host';

const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const BoundedRef = z.string().min(1).max(300);

const BindingDecisionSchema = z.object({
  source_message_ref_sha256: Digest,
  approval_id: BoundedRef,
  approval_digest: Digest,
  conversation_record_digest: Digest,
  recorded_at: z.iso.datetime(),
}).strict();

const HermesDecisionBindingCoreSchema = z.object({
  protocol_version: z.literal('nigma.hermes-conversation-binding/v1'),
  state: z.enum(['pending', 'recorded']),
  source_host_preparation_id: BoundedRef,
  source_interface_projection_id: z.string().regex(/^host-preparation-interface-[a-f0-9]{16}$/),
  source_interface_projection_digest: Digest,
  approval_phrase_sha256: Digest,
  session_ref_sha256: Digest,
  baseline_message_ref_sha256: z.array(Digest).max(10_000),
  approver: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/),
  approval_expires_at: z.iso.datetime(),
  bound_at: z.iso.datetime(),
  decision: BindingDecisionSchema.nullable(),
}).strict().superRefine((value, context) => {
  if ((value.state === 'recorded') !== Boolean(value.decision)) {
    context.addIssue({ code: 'custom', message: 'recorded state and decision must agree' });
  }
  if (new Set(value.baseline_message_ref_sha256).size
      !== value.baseline_message_ref_sha256.length) {
    context.addIssue({ code: 'custom', message: 'baseline message hashes cannot repeat' });
  }
});

export const HermesDecisionBindingSchema = HermesDecisionBindingCoreSchema.extend({
  binding_digest: Digest,
}).strict();
export type HermesDecisionBinding = z.infer<typeof HermesDecisionBindingSchema>;

const PreparationForBindingSchema = z.object({
  protocol_version: z.literal('nigma.host-preparation/v1'),
  host_preparation_id: BoundedRef,
  interface_projection: PreparationInterfaceProjectionSchema,
  approval_granted: z.literal(false),
  execution_performed: z.literal(false),
}).passthrough();

const HermesMessageSchema = z.object({
  id: z.union([z.string().min(1).max(300), z.number().int().safe()]),
  role: z.enum(['user', 'assistant', 'system', 'tool']),
  content: z.unknown(),
}).passthrough();

type HermesMessage = z.infer<typeof HermesMessageSchema>;

export interface HermesDecisionAdapterConfig {
  hermesBaseUrl: string;
  hermesApiKey: string;
  egoBaseUrl: string;
  egoRuntimeToken: string;
  humanDecisionToken: string;
  timeoutMs?: number;
}

export type HermesDecisionScanResult =
  | { outcome: 'no_match'; binding: HermesDecisionBinding }
  | { outcome: 'already_recorded'; binding: HermesDecisionBinding }
  | {
    outcome: 'approval_recorded';
    binding: HermesDecisionBinding;
    approval: z.infer<typeof NigmaTrustedConversationDecisionResultSchema>;
  };

export class HermesDecisionAdapterError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'HermesDecisionAdapterError';
  }
}

function sealBinding(core: z.infer<typeof HermesDecisionBindingCoreSchema>): HermesDecisionBinding {
  const parsed = HermesDecisionBindingCoreSchema.parse(core);
  return HermesDecisionBindingSchema.parse({
    ...parsed,
    binding_digest: sha256(canonicalJson(parsed)),
  });
}

export function verifyHermesDecisionBinding(value: unknown): HermesDecisionBinding {
  const binding = HermesDecisionBindingSchema.parse(value);
  const { binding_digest: digest, ...core } = binding;
  if (sha256(canonicalJson(core)) !== digest) {
    throw new HermesDecisionAdapterError('BINDING_INTEGRITY_MISMATCH', 'Binding digest is invalid');
  }
  return binding;
}

export async function readHermesDecisionBindingFile(file: string): Promise<HermesDecisionBinding> {
  const resolved = path.resolve(file);
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isFile() || (stat.mode & 0o777) !== 0o600) {
    throw new HermesDecisionAdapterError(
      'BINDING_STORAGE_UNSAFE', 'Binding must be a regular owner-only 0600 file',
    );
  }
  let value: unknown;
  try { value = JSON.parse(await fs.readFile(resolved, 'utf8')); } catch {
    throw new HermesDecisionAdapterError('BINDING_FILE_INVALID', 'Binding is not valid JSON');
  }
  return verifyHermesDecisionBinding(value);
}

export async function writeHermesDecisionBindingFile(
  file: string,
  bindingValue: unknown,
): Promise<void> {
  const binding = verifyHermesDecisionBinding(bindingValue);
  const resolved = path.resolve(file);
  await fs.mkdir(path.dirname(resolved), { recursive: true, mode: 0o700 });
  const temporary = `${resolved}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(binding, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(temporary, 0o600);
  await fs.rename(temporary, resolved);
  await fs.chmod(resolved, 0o600);
  if (((await fs.stat(resolved)).mode & 0o777) !== 0o600) {
    await fs.unlink(resolved).catch(() => undefined);
    throw new HermesDecisionAdapterError(
      'BINDING_STORAGE_UNSAFE', 'Binding storage cannot enforce owner-only permissions',
    );
  }
}

function messageRef(message: HermesMessage): string {
  return String(message.id);
}

function messageRefHash(message: HermesMessage): string {
  return sha256(`message:${messageRef(message)}`);
}

function parseMessages(value: unknown): HermesMessage[] {
  const source = Array.isArray(value)
    ? value
    : value && typeof value === 'object'
      ? ((value as Record<string, unknown>).data
        ?? (value as Record<string, unknown>).messages)
      : undefined;
  const result = z.array(HermesMessageSchema).max(10_000).safeParse(source);
  if (!result.success) {
    throw new HermesDecisionAdapterError('HERMES_MESSAGES_INVALID', 'Hermes returned invalid messages');
  }
  return result.data;
}

function projectionCoreDigest(projection: z.infer<typeof PreparationInterfaceProjectionSchema>): string {
  const { id: _id, digest: _digest, ...core } = projection;
  return sha256(canonicalJson(core));
}

export function createHermesDecisionBinding(
  preparationValue: unknown,
  sessionRef: string,
  baselineValue: unknown,
  approver: string,
  approvalExpiresAt: string,
  now = new Date(),
): HermesDecisionBinding {
  const preparation = PreparationForBindingSchema.parse(preparationValue);
  const projection = preparation.interface_projection;
  if (projection.source_host_preparation_id !== preparation.host_preparation_id
      || projectionCoreDigest(projection) !== projection.digest
      || projection.id !== `host-preparation-interface-${projection.digest.slice(0, 16)}`) {
    throw new HermesDecisionAdapterError(
      'PREPARATION_INTEGRITY_MISMATCH', 'Preparation projection is not exactly sealed',
    );
  }
  const session = BoundedRef.parse(sessionRef);
  const expiry = Date.parse(z.iso.datetime().parse(approvalExpiresAt));
  if (expiry < now.getTime() + 60_000 || expiry > now.getTime() + 7_200_000) {
    throw new HermesDecisionAdapterError(
      'APPROVAL_EXPIRY_INVALID', 'Approval expiry must be one minute to two hours after binding',
    );
  }
  const messages = parseMessages(baselineValue);
  const baselineHashes = [...new Set(messages.map(messageRefHash))].sort();
  return sealBinding({
    protocol_version: 'nigma.hermes-conversation-binding/v1',
    state: 'pending',
    source_host_preparation_id: preparation.host_preparation_id,
    source_interface_projection_id: projection.id,
    source_interface_projection_digest: projection.digest,
    approval_phrase_sha256: sha256(projection.approval_phrase),
    session_ref_sha256: sha256(`conversation:${session}`),
    baseline_message_ref_sha256: baselineHashes,
    approver,
    approval_expires_at: new Date(expiry).toISOString(),
    bound_at: now.toISOString(),
    decision: null,
  });
}

function validateServiceUrl(raw: string, label: string): string {
  let url: URL;
  try { url = new URL(raw); } catch {
    throw new HermesDecisionAdapterError('ADAPTER_CONFIG_INVALID', `${label} URL is invalid`);
  }
  const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && local))
      || url.username || url.password || url.search || url.hash) {
    throw new HermesDecisionAdapterError(
      'ADAPTER_CONFIG_INVALID', `${label} must use HTTPS or loopback HTTP without credentials`,
    );
  }
  return url.toString().replace(/\/$/, '');
}

function checkedConfig(config: HermesDecisionAdapterConfig) {
  if (!config.hermesApiKey || !config.egoRuntimeToken
      || config.humanDecisionToken.length < 32
      || config.humanDecisionToken === config.egoRuntimeToken) {
    throw new HermesDecisionAdapterError(
      'ADAPTER_CONFIG_INVALID', 'Adapter credentials are missing or not independent',
    );
  }
  return {
    ...config,
    hermesBaseUrl: validateServiceUrl(config.hermesBaseUrl, 'Hermes'),
    egoBaseUrl: validateServiceUrl(config.egoBaseUrl, 'EGO'),
    timeoutMs: Math.max(1_000, Math.min(30_000, config.timeoutMs ?? 10_000)),
  };
}

async function responseJson(response: Response, label: string): Promise<unknown> {
  let body: unknown;
  try { body = await response.json(); } catch {
    throw new HermesDecisionAdapterError('UPSTREAM_RESPONSE_INVALID', `${label} returned invalid JSON`);
  }
  if (!response.ok) {
    const detail = body && typeof body === 'object'
      ? String((body as Record<string, unknown>).error ?? response.status)
      : String(response.status);
    throw new HermesDecisionAdapterError('UPSTREAM_REJECTED', `${label} rejected the request: ${detail}`);
  }
  return body;
}

export async function fetchHermesDecisionMessages(
  configValue: HermesDecisionAdapterConfig,
  sessionRef: string,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const config = checkedConfig(configValue);
  const session = BoundedRef.parse(sessionRef);
  const response = await fetchImpl(
    `${config.hermesBaseUrl}/api/sessions/${encodeURIComponent(session)}/messages`,
    {
      headers: { authorization: `Bearer ${config.hermesApiKey}`, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(config.timeoutMs),
    },
  );
  return responseJson(response, 'Hermes messages');
}

export async function scanHermesDecisionBinding(
  bindingValue: unknown,
  sessionRef: string,
  messagesValue: unknown,
  configValue: HermesDecisionAdapterConfig,
  now = new Date(),
  fetchImpl: typeof fetch = fetch,
): Promise<HermesDecisionScanResult> {
  const binding = verifyHermesDecisionBinding(bindingValue);
  const session = BoundedRef.parse(sessionRef);
  if (sha256(`conversation:${session}`) !== binding.session_ref_sha256) {
    throw new HermesDecisionAdapterError('SESSION_BINDING_MISMATCH', 'Session does not match binding');
  }
  if (binding.state === 'recorded') return { outcome: 'already_recorded', binding };
  if (Date.parse(binding.approval_expires_at) < now.getTime() + 60_000) {
    throw new HermesDecisionAdapterError('BINDING_EXPIRED', 'Binding approval window has expired');
  }
  const baseline = new Set(binding.baseline_message_ref_sha256);
  const candidates = parseMessages(messagesValue).filter(message => (
    message.role === 'user'
    && !baseline.has(messageRefHash(message))
    && typeof message.content === 'string'
    && sha256(message.content) === binding.approval_phrase_sha256
  ));
  if (!candidates.length) return { outcome: 'no_match', binding };
  if (candidates.length > 1) {
    throw new HermesDecisionAdapterError(
      'AMBIGUOUS_HUMAN_DECISION', 'More than one new exact human decision was found',
    );
  }
  const config = checkedConfig(configValue);
  const message = candidates[0];
  const messageHash = messageRefHash(message);
  const idempotencyKey = `hermes-decision-${sha256(`${binding.binding_digest}:${messageHash}`).slice(0, 40)}`;
  const observedAt = now.toISOString();
  const response = await fetchImpl(`${config.egoBaseUrl}/v1/runtime/nigma/conversation-decisions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.egoRuntimeToken}`,
      'x-nigma-human-decision-token': config.humanDecisionToken,
      'idempotency-key': idempotencyKey,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(config.timeoutMs),
    body: JSON.stringify({
      protocol_version: 'nigma.trusted-conversation-decision/v1',
      host_preparation_id: binding.source_host_preparation_id,
      interface_projection_id: binding.source_interface_projection_id,
      interface_projection_digest: binding.source_interface_projection_digest,
      turn: {
        role: 'user',
        origin: 'externally_authenticated_human',
        conversation_ref: session,
        message_ref: messageRef(message),
        observed_at: observedAt,
        content: message.content,
      },
      approver: binding.approver,
      expires_at: binding.approval_expires_at,
    }),
  });
  const approval = NigmaTrustedConversationDecisionResultSchema.parse(
    await responseJson(response, 'EGO conversation decision'),
  );
  if (approval.source_conversation_ref_sha256 !== binding.session_ref_sha256
      || approval.source_message_ref_sha256 !== messageHash
      || approval.observed_at !== observedAt
      || approval.approval.source_host_preparation_id !== binding.source_host_preparation_id
      || approval.approval.source_interface_projection_id !== binding.source_interface_projection_id
      || approval.approval.source_interface_projection_digest
        !== binding.source_interface_projection_digest
      || approval.execution_performed || approval.approval.execution_performed) {
    throw new HermesDecisionAdapterError(
      'EGO_DECISION_MISMATCH', 'EGO decision did not match the exact Hermes binding',
    );
  }
  const { binding_digest: _previousDigest, ...bindingCore } = binding;
  const recorded = sealBinding({
    ...bindingCore,
    state: 'recorded',
    decision: {
      source_message_ref_sha256: messageHash,
      approval_id: approval.approval.approval_id,
      approval_digest: approval.approval.digest,
      conversation_record_digest: approval.digest,
      recorded_at: observedAt,
    },
  });
  return { outcome: 'approval_recorded', binding: recorded, approval };
}

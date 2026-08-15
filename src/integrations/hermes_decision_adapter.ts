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
const HermesProfile = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);

const BindingDecisionSchema = z.object({
  source_message_ref_sha256: Digest,
  approval_id: BoundedRef,
  approval_digest: Digest,
  conversation_record_digest: Digest,
  recorded_at: z.iso.datetime(),
}).strict();

const HermesDecisionBindingCoreSchema = z.object({
  protocol_version: z.enum([
    'nigma.hermes-conversation-binding/v1',
    'nigma.hermes-conversation-binding/v2',
  ]),
  state: z.enum(['pending', 'recorded', 'expired']),
  source_host_preparation_id: BoundedRef,
  source_interface_projection_id: z.string().regex(/^host-preparation-interface-[a-f0-9]{16}$/),
  source_interface_projection_digest: Digest,
  approval_phrase_sha256: Digest,
  session_ref_sha256: Digest,
  baseline_message_ref_sha256: z.array(Digest).max(10_000),
  approver: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,127}$/),
  approval_expires_at: z.iso.datetime(),
  bound_at: z.iso.datetime(),
  hermes_profile_sha256: Digest.optional(),
  hermes_contract_digest: Digest.optional(),
  decision: BindingDecisionSchema.nullable(),
}).strict().superRefine((value, context) => {
  if ((value.state === 'recorded') !== Boolean(value.decision)) {
    context.addIssue({ code: 'custom', message: 'recorded state and decision must agree' });
  }
  if (new Set(value.baseline_message_ref_sha256).size
      !== value.baseline_message_ref_sha256.length) {
    context.addIssue({ code: 'custom', message: 'baseline message hashes cannot repeat' });
  }
  const v2 = value.protocol_version === 'nigma.hermes-conversation-binding/v2';
  if (v2 && (!value.hermes_profile_sha256 || !value.hermes_contract_digest)) {
    context.addIssue({ code: 'custom', message: 'v2 binding requires Hermes profile and contract' });
  }
  if (!v2 && (value.state === 'expired'
      || value.hermes_profile_sha256 || value.hermes_contract_digest)) {
    context.addIssue({ code: 'custom', message: 'v1 binding cannot carry v2 fields or expired state' });
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

const HermesCapabilitiesSchema = z.object({
  object: z.literal('hermes.api_server.capabilities'),
  platform: z.literal('hermes-agent'),
  auth: z.object({
    type: z.literal('bearer'),
    required: z.literal(true),
  }).passthrough(),
  features: z.object({ session_resources: z.literal(true) }).passthrough(),
  endpoints: z.object({
    session_messages: z.object({
      method: z.literal('GET'),
      path: z.literal('/api/sessions/{session_id}/messages'),
    }).strict(),
  }).passthrough(),
}).passthrough();

const HermesCompatibilityCoreSchema = z.object({
  protocol_version: z.literal('nigma.hermes-decision-compatibility/v1'),
  platform: z.literal('hermes-agent'),
  profile_sha256: Digest,
  authentication: z.literal('bearer-required'),
  session_messages_method: z.literal('GET'),
  session_messages_path: z.literal('/api/sessions/{session_id}/messages'),
}).strict();

export const HermesCompatibilitySchema = HermesCompatibilityCoreSchema.extend({
  digest: Digest,
}).strict();
export type HermesCompatibility = z.infer<typeof HermesCompatibilitySchema>;

export interface HermesConnectionConfig {
  hermesBaseUrl: string;
  hermesApiKey: string;
  hermesProfile?: string;
  timeoutMs?: number;
}

export interface HermesDecisionAdapterConfig extends HermesConnectionConfig {
  egoBaseUrl: string;
  egoRuntimeToken: string;
  humanDecisionToken: string;
}

export type HermesDecisionScanResult =
  | { outcome: 'no_match'; binding: HermesDecisionBinding }
  | { outcome: 'already_recorded'; binding: HermesDecisionBinding }
  | {
    outcome: 'approval_recorded';
    binding: HermesDecisionBinding;
    approval: z.infer<typeof NigmaTrustedConversationDecisionResultSchema>;
  };

export type HermesDecisionSupervisorResult = {
  outcome: 'approval_recorded' | 'already_recorded' | 'approval_window_closed';
  binding: HermesDecisionBinding;
  scans: number;
  transient_errors: number;
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

export function inspectHermesDecisionMessages(value: unknown): { message_count: number } {
  return { message_count: parseMessages(value).length };
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
  hermesProfile = 'default',
  hermesContractDigest?: string,
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
  const profile = HermesProfile.parse(hermesProfile);
  const contractDigest = Digest.parse(hermesContractDigest);
  const expiry = Date.parse(z.iso.datetime().parse(approvalExpiresAt));
  if (expiry < now.getTime() + 60_000 || expiry > now.getTime() + 7_200_000) {
    throw new HermesDecisionAdapterError(
      'APPROVAL_EXPIRY_INVALID', 'Approval expiry must be one minute to two hours after binding',
    );
  }
  const messages = parseMessages(baselineValue);
  const baselineHashes = [...new Set(messages.map(messageRefHash))].sort();
  return sealBinding({
    protocol_version: 'nigma.hermes-conversation-binding/v2',
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
    hermes_profile_sha256: sha256(`profile:${profile}`),
    hermes_contract_digest: contractDigest,
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

function checkedHermesConfig(config: HermesConnectionConfig) {
  if (!config.hermesApiKey) {
    throw new HermesDecisionAdapterError('ADAPTER_CONFIG_INVALID', 'Hermes credential is missing');
  }
  return {
    ...config,
    hermesBaseUrl: validateServiceUrl(config.hermesBaseUrl, 'Hermes'),
    hermesProfile: HermesProfile.parse(config.hermesProfile || 'default'),
    timeoutMs: Math.max(1_000, Math.min(30_000, config.timeoutMs ?? 10_000)),
  };
}

function checkedConfig(config: HermesDecisionAdapterConfig) {
  if (!config.egoRuntimeToken
      || config.humanDecisionToken.length < 32
      || config.humanDecisionToken === config.egoRuntimeToken) {
    throw new HermesDecisionAdapterError(
      'ADAPTER_CONFIG_INVALID', 'Adapter credentials are missing or not independent',
    );
  }
  return {
    ...checkedHermesConfig(config),
    egoBaseUrl: validateServiceUrl(config.egoBaseUrl, 'EGO'),
    egoRuntimeToken: config.egoRuntimeToken,
    humanDecisionToken: config.humanDecisionToken,
  };
}

async function responseJson(response: Response, label: string): Promise<unknown> {
  let body: unknown;
  try { body = await response.json(); } catch {
    throw new HermesDecisionAdapterError('UPSTREAM_RESPONSE_INVALID', `${label} returned invalid JSON`);
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new HermesDecisionAdapterError(
        'UPSTREAM_AUTH_FAILED', `${label} rejected the configured credential`,
      );
    }
    if (response.status === 429 || response.status >= 500) {
      throw new HermesDecisionAdapterError(
        'UPSTREAM_TRANSIENT', `${label} is temporarily unavailable (${response.status})`,
      );
    }
    const detail = body && typeof body === 'object'
      ? String((body as Record<string, unknown>).error ?? response.status)
      : String(response.status);
    throw new HermesDecisionAdapterError('UPSTREAM_REJECTED', `${label} rejected the request: ${detail}`);
  }
  return body;
}

function profileQuery(profile: string): string {
  const parameters = new URLSearchParams({ limit: '10000', order: 'oldest' });
  if (profile !== 'default') parameters.set('profile', profile);
  return parameters.toString();
}

export async function probeHermesDecisionCompatibility(
  configValue: HermesConnectionConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<HermesCompatibility> {
  const config = checkedHermesConfig(configValue);
  const parameters = config.hermesProfile === 'default'
    ? '' : `?profile=${encodeURIComponent(config.hermesProfile)}`;
  const response = await fetchImpl(`${config.hermesBaseUrl}/v1/capabilities${parameters}`, {
    headers: { authorization: `Bearer ${config.hermesApiKey}`, accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  const capabilities = HermesCapabilitiesSchema.safeParse(
    await responseJson(response, 'Hermes capabilities'),
  );
  if (!capabilities.success) {
    throw new HermesDecisionAdapterError(
      'HERMES_CONTRACT_INCOMPATIBLE', 'Hermes does not advertise the required session contract',
    );
  }
  const core = HermesCompatibilityCoreSchema.parse({
    protocol_version: 'nigma.hermes-decision-compatibility/v1',
    platform: capabilities.data.platform,
    profile_sha256: sha256(`profile:${config.hermesProfile}`),
    authentication: 'bearer-required',
    session_messages_method: capabilities.data.endpoints.session_messages.method,
    session_messages_path: capabilities.data.endpoints.session_messages.path,
  });
  return HermesCompatibilitySchema.parse({ ...core, digest: sha256(canonicalJson(core)) });
}

export async function fetchHermesDecisionMessages(
  configValue: HermesConnectionConfig,
  sessionRef: string,
  fetchImpl: typeof fetch = fetch,
): Promise<unknown> {
  const config = checkedHermesConfig(configValue);
  const session = BoundedRef.parse(sessionRef);
  const response = await fetchImpl(
    `${config.hermesBaseUrl}/api/sessions/${encodeURIComponent(session)}/messages?${profileQuery(config.hermesProfile)}`,
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
  const config = checkedConfig(configValue);
  if (sha256(`conversation:${session}`) !== binding.session_ref_sha256) {
    throw new HermesDecisionAdapterError('SESSION_BINDING_MISMATCH', 'Session does not match binding');
  }
  if (binding.state === 'recorded') return { outcome: 'already_recorded', binding };
  if (binding.state === 'expired') {
    throw new HermesDecisionAdapterError('BINDING_EXPIRED', 'Binding approval window has expired');
  }
  if (binding.protocol_version === 'nigma.hermes-conversation-binding/v2') {
    if (binding.hermes_profile_sha256 !== sha256(`profile:${config.hermesProfile}`)) {
      throw new HermesDecisionAdapterError(
        'PROFILE_BINDING_MISMATCH', 'Hermes profile does not match binding',
      );
    }
  } else if (config.hermesProfile !== 'default') {
    throw new HermesDecisionAdapterError(
      'PROFILE_BINDING_REQUIRED', 'Legacy binding is valid only for the default Hermes profile',
    );
  }
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

export function expireHermesDecisionBinding(
  bindingValue: unknown,
  now = new Date(),
): HermesDecisionBinding {
  const binding = verifyHermesDecisionBinding(bindingValue);
  if (binding.state !== 'pending') return binding;
  if (binding.protocol_version !== 'nigma.hermes-conversation-binding/v2') {
    throw new HermesDecisionAdapterError(
      'BINDING_VERSION_UNSUPPORTED', 'Legacy bindings cannot be sealed as expired',
    );
  }
  if (Date.parse(binding.approval_expires_at) >= now.getTime() + 60_000) {
    throw new HermesDecisionAdapterError('BINDING_NOT_EXPIRED', 'Binding window is still open');
  }
  const { binding_digest: _previousDigest, ...core } = binding;
  return sealBinding({ ...core, state: 'expired', decision: null });
}

function transientAdapterError(error: unknown): boolean {
  if (error instanceof HermesDecisionAdapterError) return error.code === 'UPSTREAM_TRANSIENT';
  return error instanceof TypeError
    || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name));
}

export async function superviseHermesDecisionBinding(options: {
  binding: HermesDecisionBinding;
  sessionRef: string;
  config: HermesDecisionAdapterConfig;
  pollMs?: number;
  maxTransientErrors?: number;
  now?: () => Date;
  wait?: (milliseconds: number) => Promise<void>;
  fetchImpl?: typeof fetch;
  onBinding?: (binding: HermesDecisionBinding) => Promise<void>;
}): Promise<HermesDecisionSupervisorResult> {
  let binding = verifyHermesDecisionBinding(options.binding);
  const pollMs = Math.max(250, Math.min(30_000, options.pollMs ?? 2_000));
  const maxTransientErrors = Math.max(0, Math.min(100, options.maxTransientErrors ?? 5));
  const clock = options.now ?? (() => new Date());
  const wait = options.wait ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const fetchImpl = options.fetchImpl ?? fetch;
  let scans = 0;
  let transientErrors = 0;
  while (true) {
    if (binding.state === 'recorded') {
      return { outcome: 'already_recorded', binding, scans, transient_errors: transientErrors };
    }
    if (binding.state === 'expired'
        || Date.parse(binding.approval_expires_at) < clock().getTime() + 60_000) {
      if (binding.state !== 'expired') {
        binding = expireHermesDecisionBinding(binding, clock());
        await options.onBinding?.(binding);
      }
      return {
        outcome: 'approval_window_closed', binding, scans, transient_errors: transientErrors,
      };
    }
    try {
      const messages = await fetchHermesDecisionMessages(
        options.config, options.sessionRef, fetchImpl,
      );
      scans += 1;
      const result = await scanHermesDecisionBinding(
        binding, options.sessionRef, messages, options.config, clock(), fetchImpl,
      );
      if (result.outcome === 'approval_recorded') {
        binding = result.binding;
        await options.onBinding?.(binding);
        return { outcome: result.outcome, binding, scans, transient_errors: transientErrors };
      }
      if (result.outcome === 'already_recorded') {
        return { outcome: result.outcome, binding: result.binding, scans, transient_errors: transientErrors };
      }
    } catch (error) {
      if (!transientAdapterError(error)) throw error;
      transientErrors += 1;
      if (transientErrors > maxTransientErrors) {
        throw new HermesDecisionAdapterError(
          'TRANSIENT_ERROR_LIMIT', 'Hermes supervision exceeded its transient error limit',
        );
      }
    }
    await wait(pollMs);
  }
}

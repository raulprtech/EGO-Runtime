import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { canonicalJson, sha256 } from './integrity';
import {
  NigmaTrustedConversationExecutionRequestSchema,
  type NigmaHostRunResult,
  type NigmaTrustedConversationDecisionResult,
  type NigmaTrustedConversationExecutionRequest,
} from './nigma_host';

const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const BoundedId = z.string().min(1).max(300);
const Profile = z.string().min(1).max(100).regex(/^[A-Za-z0-9._~-]+$/);

const LegacyDecisionEventCoreSchema = z.object({
  protocol_version: z.literal('nigma.decision-event/v1'),
  id: z.string().regex(/^nigma-approval:[A-Za-z0-9._~-]{1,200}$/),
  interface_profile_sha256: Digest,
  source_conversation_ref_sha256: Digest,
  approval_id: z.string().min(1).max(200),
  approval_digest: Digest,
  conversation_record_digest: Digest,
  type: z.literal('background'),
  title: z.literal('Aprobación registrada'),
  content: z.literal(
    'Nigma registró tu aprobación. La ejecución no comenzó; requiere un paso separado.',
  ),
  timestamp: z.number().int().nonnegative(),
  execution_performed: z.literal(false),
}).strict();

const DecisionEventCoreSchema = z.object({
  protocol_version: z.literal('nigma.decision-event/v2'),
  id: z.string().regex(/^nigma-approval:[A-Za-z0-9._~-]{1,200}$/),
  interface_profile_sha256: Digest,
  source_conversation_ref_sha256: Digest,
  approval_id: z.string().min(1).max(200),
  approval_digest: Digest,
  conversation_record_digest: Digest,
  execution_phrase_sha256: Digest,
  type: z.literal('background'),
  title: z.literal('Aprobación registrada'),
  content: z.string().min(1).max(1600),
  timestamp: z.number().int().nonnegative(),
  execution_performed: z.literal(false),
}).strict();

const ExecutionEventCoreSchema = z.object({
  protocol_version: z.literal('nigma.execution-event/v1'),
  id: z.string().regex(/^nigma-execution:host-[a-f0-9]{32}$/),
  interface_profile_sha256: Digest,
  source_conversation_ref_sha256: Digest,
  source_message_ref_sha256: Digest,
  approval_id: z.string().min(1).max(200),
  approval_digest: Digest,
  host_run_id: z.string().regex(/^host-[a-f0-9]{32}$/),
  host_run_status: z.enum(['succeeded', 'failed', 'cancelled', 'timed_out']),
  type: z.literal('background'),
  title: z.literal('Ejecución finalizada'),
  content: z.string().min(1).max(500),
  timestamp: z.number().int().nonnegative(),
  execution_performed: z.literal(true),
}).strict();

const AuthorityEventCoreSchema = z.discriminatedUnion('protocol_version', [
  LegacyDecisionEventCoreSchema,
  DecisionEventCoreSchema,
  ExecutionEventCoreSchema,
]);
const AuthorityEventSchema = z.discriminatedUnion('protocol_version', [
  LegacyDecisionEventCoreSchema.extend({ record_digest: Digest }).strict(),
  DecisionEventCoreSchema.extend({ record_digest: Digest }).strict(),
  ExecutionEventCoreSchema.extend({ record_digest: Digest }).strict(),
]);
type AuthorityEvent = z.infer<typeof AuthorityEventSchema>;
export type NigmaDecisionEventProjection = Pick<
  AuthorityEvent, 'id' | 'type' | 'title' | 'content' | 'timestamp'
>;

const ExecutionChallengeCoreSchema = z.object({
  protocol_version: z.literal('nigma.conversation-execution-challenge/v1'),
  host_preparation_id: BoundedId,
  interface_projection_id: z.string().regex(/^host-preparation-interface-[a-f0-9]{16}$/),
  interface_projection_digest: Digest,
  interface_profile_sha256: Digest,
  source_conversation_ref_sha256: Digest,
  approval_id: BoundedId,
  approval_digest: Digest,
  plan_id: BoundedId,
  plan_digest: Digest,
  execution_phrase_sha256: Digest,
  created_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
}).strict();
const ExecutionChallengeSchema = ExecutionChallengeCoreSchema.extend({
  record_digest: Digest,
}).strict();
type ExecutionChallenge = z.infer<typeof ExecutionChallengeSchema>;

export const NigmaTrustedConversationExecutionResultSchema = z.object({
  protocol_version: z.literal('nigma.trusted-conversation-execution-record/v1'),
  source_conversation_ref_sha256: Digest,
  source_message_ref_sha256: Digest,
  observed_at: z.iso.datetime(),
  approval_id: BoundedId,
  approval_digest: Digest,
  host_run_id: z.string().regex(/^host-[a-f0-9]{32}$/),
  host_run_status: z.enum(['succeeded', 'failed', 'cancelled', 'timed_out']),
  authority: z.literal('trusted_conversation_adapter'),
  approval_recorded: z.literal(true),
  execution_performed: z.literal(true),
  digest: Digest,
}).strict();
export type NigmaTrustedConversationExecutionResult = z.infer<
  typeof NigmaTrustedConversationExecutionResultSchema
>;

export class NigmaConversationExecutionError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
    this.name = 'NigmaConversationExecutionError';
  }
}

let eventQueue: Promise<unknown> = Promise.resolve();
let challengeQueue: Promise<unknown> = Promise.resolve();

function eventDirectory(): string {
  return path.resolve(process.env.LOCAL_DATA_DIR ?? '.ego-runtime', 'nigma-decision-events');
}

function challengeDirectory(): string {
  return path.resolve(process.env.LOCAL_DATA_DIR ?? '.ego-runtime', 'nigma-execution-challenges');
}

function profileHash(profile: string): string {
  return sha256(`profile:${Profile.parse(profile)}`);
}

function sealEvent(coreValue: unknown): AuthorityEvent {
  const core = AuthorityEventCoreSchema.parse(coreValue);
  return AuthorityEventSchema.parse({
    ...core,
    record_digest: sha256(canonicalJson(core)),
  });
}

function verifyEvent(value: unknown): AuthorityEvent {
  const parsed = AuthorityEventSchema.parse(value);
  const { record_digest: stored, ...core } = parsed;
  if (sha256(canonicalJson(core)) !== stored) {
    throw new Error('NIGMA_DECISION_EVENT_INTEGRITY_FAILED');
  }
  return parsed;
}

function sealChallenge(coreValue: unknown): ExecutionChallenge {
  const core = ExecutionChallengeCoreSchema.parse(coreValue);
  return ExecutionChallengeSchema.parse({
    ...core,
    record_digest: sha256(canonicalJson(core)),
  });
}

function verifyChallenge(value: unknown): ExecutionChallenge {
  const parsed = ExecutionChallengeSchema.parse(value);
  const { record_digest: stored, ...core } = parsed;
  if (sha256(canonicalJson(core)) !== stored) {
    throw new Error('NIGMA_EXECUTION_CHALLENGE_INTEGRITY_FAILED');
  }
  return parsed;
}

function hashedFile(directory: string, id: string): string {
  return path.join(directory, `${createHash('sha256').update(id).digest('hex')}.json`);
}

async function atomicOwnerOnlyWrite(file: string, value: unknown): Promise<void> {
  const directory = path.dirname(file);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  const temporary = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  await fs.chmod(temporary, 0o600);
  await fs.rename(temporary, file);
  await fs.chmod(file, 0o600);
}

async function writeEvent(event: AuthorityEvent): Promise<AuthorityEvent> {
  const run = async () => {
    const file = hashedFile(eventDirectory(), event.id);
    try {
      const existing = verifyEvent(JSON.parse(await fs.readFile(file, 'utf8')));
      if (existing.record_digest !== event.record_digest) {
        throw new Error('NIGMA_DECISION_EVENT_CONFLICT');
      }
      return existing;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await atomicOwnerOnlyWrite(file, event);
    return event;
  };
  const result = eventQueue.then(run, run);
  eventQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function writeChallenge(challenge: ExecutionChallenge): Promise<ExecutionChallenge> {
  const run = async () => {
    const file = hashedFile(challengeDirectory(), challenge.approval_id);
    try {
      const existing = verifyChallenge(JSON.parse(await fs.readFile(file, 'utf8')));
      if (existing.record_digest !== challenge.record_digest) {
        throw new Error('NIGMA_EXECUTION_CHALLENGE_CONFLICT');
      }
      return existing;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await atomicOwnerOnlyWrite(file, challenge);
    return challenge;
  };
  const result = challengeQueue.then(run, run);
  challengeQueue = result.then(() => undefined, () => undefined);
  return result;
}

async function readChallenge(approvalId: string): Promise<ExecutionChallenge> {
  try {
    return verifyChallenge(JSON.parse(await fs.readFile(
      hashedFile(challengeDirectory(), BoundedId.parse(approvalId)), 'utf8',
    )));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new NigmaConversationExecutionError(
        'NIGMA_EXECUTION_CHALLENGE_NOT_FOUND', 404,
        'Conversation execution challenge was not found',
      );
    }
    throw error;
  }
}

export async function recordNigmaConversationDecisionEvent(
  result: NigmaTrustedConversationDecisionResult,
  interfaceProfile: string,
): Promise<NigmaDecisionEventProjection> {
  const authorization = result.execution_authorization;
  await writeChallenge(sealChallenge({
    protocol_version: 'nigma.conversation-execution-challenge/v1',
    host_preparation_id: result.approval.source_host_preparation_id,
    interface_projection_id: result.approval.source_interface_projection_id,
    interface_projection_digest: result.approval.source_interface_projection_digest,
    interface_profile_sha256: profileHash(interfaceProfile),
    source_conversation_ref_sha256: result.source_conversation_ref_sha256,
    approval_id: result.approval.approval_id,
    approval_digest: result.approval.digest,
    plan_id: result.approval.plan_id,
    plan_digest: result.approval.plan_digest,
    execution_phrase_sha256: authorization.phrase_sha256,
    created_at: result.approval.created_at,
    expires_at: authorization.expires_at,
  }));
  const event = sealEvent({
    protocol_version: 'nigma.decision-event/v2',
    id: `nigma-approval:${result.approval.approval_id}`,
    interface_profile_sha256: profileHash(interfaceProfile),
    source_conversation_ref_sha256: result.source_conversation_ref_sha256,
    approval_id: result.approval.approval_id,
    approval_digest: result.approval.digest,
    conversation_record_digest: result.digest,
    execution_phrase_sha256: authorization.phrase_sha256,
    type: 'background',
    title: 'Aprobación registrada',
    content: `Nigma registró tu aprobación. La ejecución no comenzó. Para iniciarla envía exactamente: ${authorization.phrase}`,
    timestamp: Date.parse(result.approval.created_at),
    execution_performed: false,
  });
  return project(await writeEvent(event));
}

export async function authorizeNigmaConversationExecution(
  requestValue: unknown,
  interfaceProfile: string,
  now = new Date(),
): Promise<{
  request: NigmaTrustedConversationExecutionRequest;
  challenge: ExecutionChallenge;
  source_conversation_ref_sha256: string;
  source_message_ref_sha256: string;
  learner_context: { user_id: string; session_id: string; objective_id: string };
  idempotency_key: string;
}> {
  const request = NigmaTrustedConversationExecutionRequestSchema.parse(requestValue);
  const challenge = await readChallenge(request.approval_id);
  const conversationHash = sha256(`conversation:${request.turn.conversation_ref}`);
  const messageHash = sha256(`message:${request.turn.message_ref}`);
  const linksAgree = request.host_preparation_id === challenge.host_preparation_id
    && request.interface_projection_id === challenge.interface_projection_id
    && request.interface_projection_digest === challenge.interface_projection_digest
    && request.approval_digest === challenge.approval_digest
    && profileHash(interfaceProfile) === challenge.interface_profile_sha256
    && conversationHash === challenge.source_conversation_ref_sha256
    && sha256(request.turn.content) === challenge.execution_phrase_sha256;
  if (!linksAgree) {
    throw new NigmaConversationExecutionError(
      'NIGMA_CONVERSATION_EXECUTION_INTEGRITY_MISMATCH', 409,
      'Conversation execution does not match the exact approved challenge',
    );
  }
  const observed = Date.parse(request.turn.observed_at);
  if (observed < Date.parse(challenge.created_at) - 30_000
      || observed > now.getTime() + 30_000
      || observed > Date.parse(challenge.expires_at)
      || now.getTime() > Date.parse(challenge.expires_at)) {
    throw new NigmaConversationExecutionError(
      'NIGMA_CONVERSATION_EXECUTION_TIME_INVALID', 409,
      'Conversation execution was not observed within the approval window',
    );
  }
  return {
    request,
    challenge,
    source_conversation_ref_sha256: conversationHash,
    source_message_ref_sha256: messageHash,
    learner_context: {
      user_id: `human-${conversationHash.slice(0, 32)}`,
      session_id: `conversation-${conversationHash.slice(0, 32)}`,
      objective_id: `plan-${sha256(challenge.plan_id).slice(0, 32)}`,
    },
    idempotency_key: `conversation-execution-${sha256(challenge.record_digest).slice(0, 40)}`,
  };
}

export async function recordNigmaConversationExecutionEvent(
  authority: Awaited<ReturnType<typeof authorizeNigmaConversationExecution>>,
  result: NigmaHostRunResult,
  interfaceProfile: string,
): Promise<NigmaTrustedConversationExecutionResult> {
  if (result.plan_id !== authority.challenge.plan_id) {
    throw new NigmaConversationExecutionError(
      'NIGMA_CONVERSATION_EXECUTION_RESULT_MISMATCH', 409,
      'Host execution changed the approved plan',
    );
  }
  const observedAt = new Date(Date.parse(authority.request.turn.observed_at)).toISOString();
  const provisional = {
    protocol_version: 'nigma.trusted-conversation-execution-record/v1' as const,
    source_conversation_ref_sha256: authority.source_conversation_ref_sha256,
    source_message_ref_sha256: authority.source_message_ref_sha256,
    observed_at: observedAt,
    approval_id: authority.challenge.approval_id,
    approval_digest: authority.challenge.approval_digest,
    host_run_id: result.host_run_id,
    host_run_status: result.status,
    authority: 'trusted_conversation_adapter' as const,
    approval_recorded: true as const,
    execution_performed: true as const,
  };
  const record = NigmaTrustedConversationExecutionResultSchema.parse({
    ...provisional,
    digest: sha256(canonicalJson(provisional)),
  });
  await writeEvent(sealEvent({
    protocol_version: 'nigma.execution-event/v1',
    id: `nigma-execution:${result.host_run_id}`,
    interface_profile_sha256: profileHash(interfaceProfile),
    source_conversation_ref_sha256: authority.source_conversation_ref_sha256,
    source_message_ref_sha256: authority.source_message_ref_sha256,
    approval_id: authority.challenge.approval_id,
    approval_digest: authority.challenge.approval_digest,
    host_run_id: result.host_run_id,
    host_run_status: result.status,
    type: 'background',
    title: 'Ejecución finalizada',
    content: `Nigma finalizó la ejecución con estado ${result.status}.`,
    timestamp: Date.parse(result.events.at(-1)?.occurred_at ?? observedAt),
    execution_performed: true,
  }));
  return record;
}

export async function listNigmaDecisionEvents(
  interfaceProfile: string,
  limit = 20,
): Promise<NigmaDecisionEventProjection[]> {
  const expectedProfile = profileHash(interfaceProfile);
  let names: string[];
  try {
    names = await fs.readdir(eventDirectory());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  const events: AuthorityEvent[] = [];
  for (const name of names.filter(value => /^[a-f0-9]{64}\.json$/.test(value))) {
    const value = verifyEvent(JSON.parse(await fs.readFile(path.join(eventDirectory(), name), 'utf8')));
    if (value.interface_profile_sha256 === expectedProfile) events.push(value);
  }
  return events
    .sort((left, right) => right.timestamp - left.timestamp || left.id.localeCompare(right.id))
    .slice(0, Math.max(1, Math.min(100, limit)))
    .map(project);
}

function project(event: AuthorityEvent): NigmaDecisionEventProjection {
  return {
    id: event.id,
    type: event.type,
    title: event.title,
    content: event.content,
    timestamp: event.timestamp,
  };
}

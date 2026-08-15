import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { canonicalJson, sha256 } from './integrity';
import type { NigmaTrustedConversationDecisionResult } from './nigma_host';

const Digest = z.string().regex(/^[a-f0-9]{64}$/);
const Profile = z.string().min(1).max(100).regex(/^[A-Za-z0-9._~-]+$/);

const DecisionEventCoreSchema = z.object({
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

const DecisionEventSchema = DecisionEventCoreSchema.extend({ record_digest: Digest }).strict();
type DecisionEvent = z.infer<typeof DecisionEventSchema>;
export type NigmaDecisionEventProjection = Pick<
  DecisionEvent, 'id' | 'type' | 'title' | 'content' | 'timestamp'
>;

let eventQueue: Promise<unknown> = Promise.resolve();

function eventDirectory(): string {
  return path.resolve(process.env.LOCAL_DATA_DIR ?? '.ego-runtime', 'nigma-decision-events');
}

function profileHash(profile: string): string {
  return sha256(`profile:${Profile.parse(profile)}`);
}

function seal(core: z.infer<typeof DecisionEventCoreSchema>): DecisionEvent {
  const parsed = DecisionEventCoreSchema.parse(core);
  return DecisionEventSchema.parse({
    ...parsed,
    record_digest: sha256(canonicalJson(parsed)),
  });
}

function verify(value: unknown): DecisionEvent {
  const parsed = DecisionEventSchema.parse(value);
  const { record_digest: stored, ...core } = parsed;
  if (sha256(canonicalJson(core)) !== stored) throw new Error('NIGMA_DECISION_EVENT_INTEGRITY_FAILED');
  return parsed;
}

function eventFile(id: string): string {
  const name = createHash('sha256').update(id).digest('hex');
  return path.join(eventDirectory(), `${name}.json`);
}

async function writeEvent(event: DecisionEvent): Promise<DecisionEvent> {
  const run = async () => {
    const directory = eventDirectory();
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700);
    const file = eventFile(event.id);
    try {
      const existing = verify(JSON.parse(await fs.readFile(file, 'utf8')));
      if (existing.record_digest !== event.record_digest) {
        throw new Error('NIGMA_DECISION_EVENT_CONFLICT');
      }
      return existing;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const temporary = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(event, null, 2), { mode: 0o600 });
    await fs.rename(temporary, file);
    await fs.chmod(file, 0o600);
    return event;
  };
  const result = eventQueue.then(run, run);
  eventQueue = result.then(() => undefined, () => undefined);
  return result;
}

export async function recordNigmaConversationDecisionEvent(
  result: NigmaTrustedConversationDecisionResult,
  interfaceProfile: string,
): Promise<NigmaDecisionEventProjection> {
  const event = seal({
    protocol_version: 'nigma.decision-event/v1',
    id: `nigma-approval:${result.approval.approval_id}`,
    interface_profile_sha256: profileHash(interfaceProfile),
    source_conversation_ref_sha256: result.source_conversation_ref_sha256,
    approval_id: result.approval.approval_id,
    approval_digest: result.approval.digest,
    conversation_record_digest: result.digest,
    type: 'background',
    title: 'Aprobación registrada',
    content: 'Nigma registró tu aprobación. La ejecución no comenzó; requiere un paso separado.',
    timestamp: Date.parse(result.approval.created_at),
    execution_performed: false,
  });
  const stored = await writeEvent(event);
  return project(stored);
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
  const events: DecisionEvent[] = [];
  for (const name of names.filter(value => /^[a-f0-9]{64}\.json$/.test(value))) {
    const value = verify(JSON.parse(await fs.readFile(path.join(eventDirectory(), name), 'utf8')));
    if (value.interface_profile_sha256 === expectedProfile) events.push(value);
  }
  return events
    .sort((left, right) => right.timestamp - left.timestamp || left.id.localeCompare(right.id))
    .slice(0, Math.max(1, Math.min(100, limit)))
    .map(project);
}

function project(event: DecisionEvent): NigmaDecisionEventProjection {
  return {
    id: event.id,
    type: event.type,
    title: event.title,
    content: event.content,
    timestamp: event.timestamp,
  };
}

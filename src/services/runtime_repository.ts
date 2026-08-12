import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Artifact, ExecuteRequest, RuntimeEvent } from '../api/schemas/runtime_schemas';
import { AssessmentResult, MasteryState, PracticeSet } from '../domain/types';
import { COLLECTIONS, getFirestore } from './firestore';

export type JobRecord = Record<string, unknown> & {
  request_id: string;
  user_id: string;
  session_id: string;
  objective_id: string;
  status: string;
};

export interface AttemptRecord {
  request_digest: string;
  assessment: AssessmentResult;
  mastery: MasteryState;
  responses: Array<{ question_id: string; answer: string }>;
  created_at: string;
}

export interface RuntimeRepository {
  submit(input: ExecuteRequest, digest: string): Promise<{ created: boolean; shouldDispatch: boolean }>;
  recordDispatch(requestId: string, status: 'dispatched' | 'failed', error?: string): Promise<void>;
  recoverableJobs(limit: number): Promise<ExecuteRequest[]>;
  getJob(requestId: string): Promise<JobRecord | null>;
  claim(requestId: string, owner: string, leaseMs: number): Promise<boolean>;
  renew(requestId: string, owner: string, leaseMs: number): Promise<'ok' | 'cancelled' | 'lost'>;
  complete(requestId: string, owner: string, artifacts: Artifact[]): Promise<boolean>;
  fail(requestId: string, owner: string, error: string): Promise<void>;
  cancel(requestId: string): Promise<'not_found' | 'terminal' | 'cancelled'>;
  emitEvent(requestId: string, sessionId: string, type: string, data: Record<string, unknown>): Promise<RuntimeEvent>;
  eventsAfter(requestId: string, cursor: number): Promise<RuntimeEvent[]>;
  saveArtifact(artifact: Artifact, requestId: string, type: string): Promise<void>;
  savePractice(requestId: string, practice: PracticeSet): Promise<void>;
  getPractice(requestId: string): Promise<PracticeSet | null>;
  saveMastery(requestId: string, mastery: MasteryState): Promise<void>;
  getMastery(requestId: string): Promise<MasteryState | null>;
  getAttempt(requestId: string, attemptId: string): Promise<AttemptRecord | null>;
  applyAssessment(requestId: string, attemptId: string, digest: string, assessment: AssessmentResult,
    responses: AttemptRecord['responses'], update: (current: MasteryState) => MasteryState):
    Promise<{ conflict: boolean; created: boolean; attempt?: AttemptRecord }>;
}

interface LocalState {
  jobs: Record<string, JobRecord>;
  events: Record<string, RuntimeEvent[]>;
  artifacts: Record<string, Artifact & { request_id: string; type: string; created_at: string }>;
  practices: Record<string, PracticeSet>;
  mastery: Record<string, MasteryState>;
  attempts: Record<string, Record<string, AttemptRecord>>;
}

const emptyState = (): LocalState => ({
  jobs: {}, events: {}, artifacts: {}, practices: {}, mastery: {}, attempts: {},
});

class LocalRuntimeRepository implements RuntimeRepository {
  private state: LocalState = emptyState();
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();
  private activeJobs = new Set<string>();

  private get file(): string {
    return path.resolve(process.env.LOCAL_DATA_DIR ?? '.ego-runtime', 'state.json');
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      this.state = { ...emptyState(), ...JSON.parse(await fs.readFile(this.file, 'utf8')) as LocalState };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    this.loaded = true;
  }

  private async read<T>(operation: () => T): Promise<T> {
    await this.queue;
    await this.load();
    return structuredClone(operation());
  }

  private async mutate<T>(operation: () => T): Promise<T> {
    const run = async () => {
      await this.load();
      const value = operation();
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const temporary = this.file + '.' + randomUUID() + '.tmp';
      await fs.writeFile(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 });
      await fs.rename(temporary, this.file);
      return structuredClone(value);
    };
    const result = this.queue.then(run, run);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  submit(input: ExecuteRequest, digest: string) {
    return this.mutate(() => {
      const existing = this.state.jobs[input.request_id];
      if (existing) {
        if (existing.request_digest !== digest) throw new Error('IDEMPOTENCY_CONFLICT');
        return { created: false, shouldDispatch: existing.status === 'pending' && existing.dispatch_status !== 'dispatched' };
      }
      const now = new Date().toISOString();
      this.state.jobs[input.request_id] = {
        request_id: input.request_id, user_id: input.user_id, session_id: input.session_id,
        objective_id: input.objective_id, status: 'pending', dispatch_status: 'pending',
        artifacts: [], event_sequence: 0, attempts: 0, request_digest: digest,
        request_payload: input, created_at: now, updated_at: now,
      };
      return { created: true, shouldDispatch: true };
    });
  }

  recordDispatch(requestId: string, status: 'dispatched' | 'failed', error?: string) {
    return this.mutate(() => {
      const job = this.requireJob(requestId);
      job.dispatch_status = status;
      job.dispatch_error = error ?? null;
      job.updated_at = new Date().toISOString();
    });
  }

  recoverableJobs(limit: number) {
    return this.read(() => Object.values(this.state.jobs)
      .filter(job => ['pending', 'running'].includes(job.status))
      .slice(0, limit).map(job => job.request_payload as ExecuteRequest));
  }

  getJob(requestId: string) {
    return this.read(() => this.state.jobs[requestId] ?? null);
  }

  claim(requestId: string, owner: string, leaseMs: number) {
    return this.mutate(() => {
      const job = this.state.jobs[requestId];
      if (!job || ['completed', 'cancelled'].includes(job.status) || this.activeJobs.has(requestId)) return false;
      this.activeJobs.add(requestId);
      const now = new Date();
      Object.assign(job, { status: 'running', lease_owner: owner,
        lease_expires_at: new Date(now.getTime() + leaseMs).toISOString(),
        attempts: Number(job.attempts ?? 0) + 1, updated_at: now.toISOString() });
      return true;
    });
  }

  renew(requestId: string, owner: string, leaseMs: number) {
    return this.mutate(() => {
      const job = this.state.jobs[requestId];
      if (!job || job.status === 'cancelled') return 'cancelled' as const;
      if (job.lease_owner !== owner) return 'lost' as const;
      job.lease_expires_at = new Date(Date.now() + leaseMs).toISOString();
      job.updated_at = new Date().toISOString();
      return 'ok' as const;
    });
  }

  complete(requestId: string, owner: string, artifacts: Artifact[]) {
    return this.mutate(() => {
      const job = this.state.jobs[requestId];
      if (!job || job.lease_owner !== owner || job.status === 'cancelled') return false;
      const now = new Date().toISOString();
      Object.assign(job, { status: 'completed', artifacts, lease_owner: null, lease_expires_at: null,
        completed_at: now, updated_at: now });
      this.activeJobs.delete(requestId);
      return true;
    });
  }

  fail(requestId: string, owner: string, error: string) {
    return this.mutate(() => {
      const job = this.state.jobs[requestId];
      if (!job || job.lease_owner !== owner || job.status === 'cancelled') return;
      Object.assign(job, { status: 'failed', error, lease_owner: null, lease_expires_at: null,
        updated_at: new Date().toISOString() });
      this.activeJobs.delete(requestId);
    });
  }

  cancel(requestId: string) {
    return this.mutate(() => {
      const job = this.state.jobs[requestId];
      if (!job) return 'not_found' as const;
      if (['completed', 'failed'].includes(job.status)) return 'terminal' as const;
      Object.assign(job, { status: 'cancelled', lease_owner: null, lease_expires_at: null,
        updated_at: new Date().toISOString() });
      this.activeJobs.delete(requestId);
      return 'cancelled' as const;
    });
  }

  emitEvent(requestId: string, sessionId: string, type: string, data: Record<string, unknown>) {
    return this.mutate(() => {
      const job = this.requireJob(requestId);
      const sequence = Number(job.event_sequence ?? 0) + 1;
      job.event_sequence = sequence;
      const event: RuntimeEvent = { event_id: 'evt_' + randomUUID(), request_id: requestId,
        session_id: sessionId, sequence_number: sequence, type, timestamp: new Date().toISOString(), data };
      (this.state.events[requestId] ??= []).push(event);
      return event;
    });
  }

  eventsAfter(requestId: string, cursor: number) {
    return this.read(() => (this.state.events[requestId] ?? []).filter(event => event.sequence_number > cursor));
  }

  saveArtifact(artifact: Artifact, requestId: string, type: string) {
    return this.mutate(() => {
      this.state.artifacts[artifact.id] = { ...artifact, request_id: requestId, type, created_at: new Date().toISOString() };
    });
  }
  savePractice(requestId: string, practice: PracticeSet) {
    return this.mutate(() => { this.state.practices[requestId] = practice; });
  }
  getPractice(requestId: string) {
    return this.read(() => this.state.practices[requestId] ?? null);
  }
  saveMastery(requestId: string, mastery: MasteryState) {
    return this.mutate(() => { this.state.mastery[requestId] = mastery; });
  }
  getMastery(requestId: string) {
    return this.read(() => this.state.mastery[requestId] ?? null);
  }
  getAttempt(requestId: string, attemptId: string) {
    return this.read(() => this.state.attempts[requestId]?.[attemptId] ?? null);
  }

  applyAssessment(requestId: string, attemptId: string, digest: string, assessment: AssessmentResult,
    responses: AttemptRecord['responses'], update: (current: MasteryState) => MasteryState) {
    return this.mutate(() => {
      const attempts = this.state.attempts[requestId] ??= {};
      const existing = attempts[attemptId];
      if (existing) return existing.request_digest === digest
        ? { conflict: false, created: false, attempt: existing }
        : { conflict: true, created: false };
      const current = this.state.mastery[requestId];
      if (!current) throw new Error('Mastery state not found');
      const mastery = update(current);
      const attempt: AttemptRecord = { request_digest: digest, assessment, mastery, responses,
        created_at: new Date().toISOString() };
      attempts[attemptId] = attempt;
      this.state.mastery[requestId] = mastery;
      return { conflict: false, created: true, attempt };
    });
  }

  private requireJob(requestId: string): JobRecord {
    const job = this.state.jobs[requestId];
    if (!job) throw new Error('Job not found');
    return job;
  }
}

class FirestoreRuntimeRepository implements RuntimeRepository {
  private get db() { return getFirestore(); }
  private job(id: string) { return this.db.collection(COLLECTIONS.JOBS).doc(id); }

  async submit(input: ExecuteRequest, digest: string) {
    const ref = this.job(input.request_id);
    let result = { created: false, shouldDispatch: false };
    await this.db.runTransaction(async transaction => {
      const existing = await transaction.get(ref);
      if (existing.exists) {
        if (existing.data()?.request_digest !== digest) throw new Error('IDEMPOTENCY_CONFLICT');
        result.shouldDispatch = existing.data()?.status === 'pending' && existing.data()?.dispatch_status !== 'dispatched';
        return;
      }
      result = { created: true, shouldDispatch: true };
      const now = new Date().toISOString();
      transaction.create(ref, { request_id: input.request_id, user_id: input.user_id, session_id: input.session_id,
        objective_id: input.objective_id, status: 'pending', dispatch_status: 'pending', artifacts: [],
        event_sequence: 0, attempts: 0, request_digest: digest, request_payload: input, created_at: now, updated_at: now });
    });
    return result;
  }

  async recordDispatch(requestId: string, status: 'dispatched' | 'failed', error?: string) {
    await this.job(requestId).update({ dispatch_status: status, dispatch_error: error ?? null, updated_at: new Date().toISOString() });
  }
  async recoverableJobs(limit: number) {
    const snapshot = await this.db.collection(COLLECTIONS.JOBS).where('status', '==', 'pending').limit(limit).get();
    return snapshot.docs.filter(doc => doc.data().dispatch_status !== 'dispatched')
      .map(doc => doc.data().request_payload).filter(Boolean) as ExecuteRequest[];
  }
  async getJob(requestId: string) {
    const snapshot = await this.job(requestId).get();
    return snapshot.exists ? snapshot.data() as JobRecord : null;
  }
  async claim(requestId: string, owner: string, leaseMs: number) {
    const ref = this.job(requestId);
    return this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      const data = snapshot.data();
      if (!snapshot.exists || !data || ['completed', 'cancelled'].includes(data.status)) return false;
      const expiry = Date.parse(String(data.lease_expires_at ?? ''));
      if (data.status === 'running' && Number.isFinite(expiry) && expiry > Date.now()) return false;
      const now = new Date();
      transaction.update(ref, { status: 'running', lease_owner: owner,
        lease_expires_at: new Date(now.getTime() + leaseMs).toISOString(),
        attempts: Number(data.attempts ?? 0) + 1, updated_at: now.toISOString() });
      return true;
    });
  }
  async renew(requestId: string, owner: string, leaseMs: number) {
    const ref = this.job(requestId);
    return this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists || snapshot.data()?.status === 'cancelled') return 'cancelled' as const;
      if (snapshot.data()?.lease_owner !== owner) return 'lost' as const;
      transaction.update(ref, { lease_expires_at: new Date(Date.now() + leaseMs).toISOString(), updated_at: new Date().toISOString() });
      return 'ok' as const;
    });
  }
  async complete(requestId: string, owner: string, artifacts: Artifact[]) {
    const ref = this.job(requestId);
    return this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (snapshot.data()?.lease_owner !== owner || snapshot.data()?.status === 'cancelled') return false;
      const now = new Date().toISOString();
      transaction.update(ref, { status: 'completed', artifacts, lease_owner: null, lease_expires_at: null,
        completed_at: now, updated_at: now });
      return true;
    });
  }
  async fail(requestId: string, owner: string, error: string) {
    const ref = this.job(requestId);
    await this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (snapshot.data()?.lease_owner !== owner || snapshot.data()?.status === 'cancelled') return;
      transaction.update(ref, { status: 'failed', error, lease_owner: null, lease_expires_at: null,
        updated_at: new Date().toISOString() });
    });
  }
  async cancel(requestId: string) {
    const ref = this.job(requestId);
    return this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return 'not_found' as const;
      if (['completed', 'failed'].includes(snapshot.data()?.status)) return 'terminal' as const;
      transaction.update(ref, { status: 'cancelled', lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString() });
      return 'cancelled' as const;
    });
  }
  async emitEvent(requestId: string, sessionId: string, type: string, data: Record<string, unknown>) {
    const ref = this.job(requestId);
    let event!: RuntimeEvent;
    await this.db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error('Job not found');
      const sequence = Number(snapshot.data()?.event_sequence ?? 0) + 1;
      event = { event_id: 'evt_' + randomUUID(), request_id: requestId, session_id: sessionId,
        sequence_number: sequence, type, timestamp: new Date().toISOString(), data };
      transaction.update(ref, { event_sequence: sequence });
      transaction.create(ref.collection(COLLECTIONS.EVENTS).doc(event.event_id), event);
    });
    return event;
  }
  async eventsAfter(requestId: string, cursor: number) {
    const snapshot = await this.job(requestId).collection(COLLECTIONS.EVENTS)
      .where('sequence_number', '>', cursor).orderBy('sequence_number').get();
    return snapshot.docs.map(doc => doc.data() as RuntimeEvent);
  }
  async saveArtifact(artifact: Artifact, requestId: string, type: string) {
    await this.db.collection(COLLECTIONS.ARTIFACTS).doc(artifact.id).create({
      ...artifact, request_id: requestId, type, created_at: new Date().toISOString(),
    });
  }
  async savePractice(requestId: string, practice: PracticeSet) {
    await this.job(requestId).collection('internal').doc('practice').set(practice);
  }
  async getPractice(requestId: string) {
    const snapshot = await this.job(requestId).collection('internal').doc('practice').get();
    return snapshot.exists ? snapshot.data() as PracticeSet : null;
  }
  async saveMastery(requestId: string, mastery: MasteryState) {
    await this.job(requestId).collection('state').doc('mastery').set(mastery);
  }
  async getMastery(requestId: string) {
    const snapshot = await this.job(requestId).collection('state').doc('mastery').get();
    return snapshot.exists ? snapshot.data() as MasteryState : null;
  }
  async getAttempt(requestId: string, attemptId: string) {
    const snapshot = await this.job(requestId).collection('attempts').doc(attemptId).get();
    return snapshot.exists ? snapshot.data() as AttemptRecord : null;
  }
  async applyAssessment(requestId: string, attemptId: string, digest: string, assessment: AssessmentResult,
    responses: AttemptRecord['responses'], update: (current: MasteryState) => MasteryState) {
    const attemptRef = this.job(requestId).collection('attempts').doc(attemptId);
    const masteryRef = this.job(requestId).collection('state').doc('mastery');
    return this.db.runTransaction(async transaction => {
      const [attemptSnapshot, masterySnapshot] = await Promise.all([
        transaction.get(attemptRef), transaction.get(masteryRef),
      ]);
      if (attemptSnapshot.exists) {
        const existing = attemptSnapshot.data() as AttemptRecord;
        return existing.request_digest === digest
          ? { conflict: false, created: false, attempt: existing }
          : { conflict: true, created: false };
      }
      const mastery = update(masterySnapshot.data() as MasteryState);
      const attempt: AttemptRecord = { request_digest: digest, assessment, mastery, responses,
        created_at: new Date().toISOString() };
      transaction.create(attemptRef, attempt);
      transaction.set(masteryRef, mastery);
      return { conflict: false, created: true, attempt };
    });
  }
}

let repository: RuntimeRepository | undefined;
export function getRuntimeRepository(): RuntimeRepository {
  if (!repository) {
    const backend = process.env.RUNTIME_BACKEND ?? (process.env.NODE_ENV === 'production' ? 'cloud' : 'local');
    if (!['local', 'cloud'].includes(backend)) throw new Error('RUNTIME_BACKEND must be local or cloud');
    repository = backend === 'cloud' ? new FirestoreRuntimeRepository() : new LocalRuntimeRepository();
  }
  return repository;
}

export function resetRuntimeRepositoryForTests(): void {
  repository = undefined;
}

import { createHash } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { AssessmentRequestSchema, ExecuteRequest, ExecuteRequestSchema } from '../schemas/runtime_schemas';
import { authMiddleware } from '../auth';
import { TaskQueue } from '../../services/task_queue';
import { AssessmentGraderAgent } from '../../agents/assessment_grader';
import { MasteryStateSchema, PracticeSetSchema } from '../../domain/types';
import { updateMasteryState } from '../../services/mastery';
import { EventTracker } from '../../runtime/events';
import { getRuntimeRepository } from '../../services/runtime_repository';
import { ArtifactStore } from '../../services/artifact_store';
import {
  createLegacyCapabilities, createRuntimeManifest, unsupportedCapabilities,
} from '../../runtime/manifest';
import { approvalRequestDigest, createResultReceipt, verifyExecutionApproval } from '../../runtime/integrity';

const router = Router();

export function publicRuntimeStatus(job: { status: string; rollback?: unknown }): string {
  return job.status === 'cancelled' && !job.rollback ? 'cancelling' : job.status;
}

router.get('/manifest', (_req, res) => res.json(createRuntimeManifest()));
router.get('/capabilities', (_req, res) => res.json(createLegacyCapabilities()));

async function dispatchAndRecord(input: ExecuteRequest): Promise<void> {
  const repository = getRuntimeRepository();
  try {
    await TaskQueue.dispatch(input);
    await repository.recordDispatch(input.request_id, 'dispatched');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Dispatch failed';
    await repository.recordDispatch(input.request_id, 'failed', message);
    throw error;
  }
}

router.post('/approval-digest', authMiddleware, (req, res, next) => {
  try {
    const input = ExecuteRequestSchema.parse(req.body);
    res.json({ algorithm: 'sha256', canonicalization: 'json-sort-keys-v1',
      request_digest: approvalRequestDigest(input) });
  } catch (error) { next(error); }
});

router.post('/execute', authMiddleware, async (req, res, next) => {
  try {
    const input = ExecuteRequestSchema.parse(req.body);
    const approval = verifyExecutionApproval(input);
    if (approval.ok === false) return res.status(approval.status).json({ error: approval.error });
    const unsupported = unsupportedCapabilities(input.capabilities);
    if (unsupported.length) return res.status(422).json({
      error: 'UNSUPPORTED_CAPABILITIES', unsupported_capabilities: unsupported,
    });
    const digest = approvalRequestDigest(input);
    const result = await getRuntimeRepository().submit(input, digest);
    if (result.shouldDispatch) await dispatchAndRecord(input);
    res.status(202).json({
      request_id: input.request_id,
      status: result.created ? 'accepted' : result.shouldDispatch ? 'redispatched' : 'already_accepted',
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'IDEMPOTENCY_CONFLICT') {
      return res.status(409).json({ error: error.message });
    }
    next(error);
  }
});

router.post('/worker', authMiddleware, async (req, res, next) => {
  try {
    const input = ExecuteRequestSchema.parse(req.body);
    const executed = await TaskQueue.dispatchLocal(input);
    if (executed) return res.status(204).end();
    res.status(200).json({ status: 'duplicate_or_terminal' });
  } catch (error) { next(error); }
});

router.post('/maintenance/reconcile', authMiddleware, async (_req, res, next) => {
  try {
    const jobs = await getRuntimeRepository().recoverableJobs(25);
    let dispatched = 0;
    let failed = 0;
    for (const payload of jobs) {
      try {
        await dispatchAndRecord(payload);
        dispatched += 1;
      } catch {
        failed += 1;
      }
    }
    res.json({ scanned: jobs.length, dispatched, failed });
  } catch (error) { next(error); }
});

router.post('/:request_id/assess', authMiddleware, async (req, res, next) => {
  try {
    const input = AssessmentRequestSchema.parse(req.body);
    const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const repository = getRuntimeRepository();
    const [job, practiceValue, existing] = await Promise.all([
      repository.getJob(req.params.request_id),
      repository.getPractice(req.params.request_id),
      repository.getAttempt(req.params.request_id, input.assessment_id),
    ]);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status !== 'completed') return res.status(409).json({ error: 'Learning package is not ready' });
    if (job.user_id !== input.user_id || job.session_id !== input.session_id) {
      return res.status(403).json({ error: 'Assessment does not belong to this learning session' });
    }
    if (existing) {
      if (existing.request_digest !== digest) {
        return res.status(409).json({ error: 'ASSESSMENT_IDEMPOTENCY_CONFLICT' });
      }
      return res.json({ attempt_id: input.assessment_id, language: input.language ?? 'und',
        assessment: existing.assessment, mastery: existing.mastery });
    }

    const practice = PracticeSetSchema.parse(practiceValue);
    const questionIds = new Set(practice.quiz.map(question => question.id));
    const responseIds = new Set(input.responses.map(response => response.question_id));
    if (responseIds.size !== input.responses.length ||
        input.responses.some(response => !questionIds.has(response.question_id))) {
      return res.status(400).json({ error: 'Duplicate or unknown question_id' });
    }

    const assessment = await new AssessmentGraderAgent().grade(
      practice, input.responses, input.user_id, input.language,
    );
    const expectedConcept = new Map(practice.quiz.map(question => [question.id, question.concept_id]));
    if (assessment.results.length !== responseIds.size || assessment.results.some(result =>
      !responseIds.has(result.question_id) || expectedConcept.get(result.question_id) !== result.concept_id)) {
      throw new Error('Assessment grader returned inconsistent results');
    }

    const applied = await repository.applyAssessment(
      req.params.request_id, input.assessment_id, digest, assessment, input.responses.length,
      current => updateMasteryState(MasteryStateSchema.parse(current), assessment),
    );
    if (applied.conflict) return res.status(409).json({ error: 'ASSESSMENT_IDEMPOTENCY_CONFLICT' });
    if (applied.created) {
      await new EventTracker(req.params.request_id, input.session_id)
        .emit('assessment_completed', { attempt_id: input.assessment_id });
    }
    res.json({ attempt_id: input.assessment_id,
      language: input.language ?? 'und',
      assessment: applied.attempt?.assessment, mastery: applied.attempt?.mastery });
  } catch (error) { next(error); }
});

router.get('/:request_id/mastery', authMiddleware, async (req, res, next) => {
  try {
    const state = await getRuntimeRepository().getMastery(req.params.request_id);
    if (!state) return res.status(404).json({ error: 'Mastery state not found' });
    res.json(MasteryStateSchema.parse(state));
  } catch (error) { next(error); }
});

router.get('/:request_id/receipt', authMiddleware, async (req, res, next) => {
  try {
    const job = await getRuntimeRepository().getJob(req.params.request_id);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    try {
      return res.json(createResultReceipt(job));
    } catch (error) {
      if (error instanceof Error && error.message === 'RESULT_NOT_TERMINAL') {
        return res.status(409).json({ error: error.message });
      }
      if (error instanceof Error && error.message === 'RESULT_RECEIPT_NOT_CONFIGURED') {
        return res.status(503).json({ error: error.message });
      }
      throw error;
    }
  } catch (error) { next(error); }
});

router.get('/:request_id', authMiddleware, async (req, res, next) => {
  try {
    const data = await getRuntimeRepository().getJob(req.params.request_id);
    if (!data) return res.status(404).json({ error: 'Job not found' });
    const { request_payload: _payload, request_digest: _digest, lease_owner: _owner,
      lease_expires_at: _expires, ...publicJob } = data;
    publicJob.status = publicRuntimeStatus(publicJob);
    res.json(publicJob);
  } catch (error) { next(error); }
});

router.get('/:request_id/events', authMiddleware, async (req, res, next) => {
  try {
    const cursor = Number.parseInt(String(req.query.cursor ?? 0), 10) || 0;
    res.json({ events: await getRuntimeRepository().eventsAfter(req.params.request_id, cursor) });
  } catch (error) { next(error); }
});

router.post('/:request_id/cancel', authMiddleware, async (req, res, next) => {
  try {
    const runtimeBackend = process.env.RUNTIME_BACKEND ??
      (process.env.NODE_ENV === 'production' ? 'cloud' : 'local');
    if (runtimeBackend !== 'local') {
      return res.status(501).json({ error: 'CANCELLATION_COOPERATIVE_CLOUD_NOT_IMPLEMENTED' });
    }
    const CancellationSchema = z.object({
      id: z.string().min(1), digest: z.string().regex(/^[0-9a-f]{64}$/),
      invocation_id: z.string().min(1), invocation_digest: z.string().regex(/^[0-9a-f]{64}$/),
      runtime_run_id: z.string().min(1),
    }).strict();
    const cancellation = req.body?.cancellation
      ? CancellationSchema.parse(req.body.cancellation) : undefined;
    if (cancellation && (cancellation.runtime_run_id !== req.params.request_id ||
        cancellation.invocation_id !== req.params.request_id)) {
      return res.status(409).json({ error: 'CANCELLATION_LINK_MISMATCH' });
    }
    const repository = getRuntimeRepository();
    const existingJob = await repository.getJob(req.params.request_id);
    if (!existingJob) return res.status(404).json({ error: 'Job not found' });
    const requestPayload = existingJob.request_payload as ExecuteRequest | undefined;
    const nigma = requestPayload?.metadata?.nigma as Record<string, unknown> | undefined;
    if (cancellation && nigma?.invocation_digest !== cancellation.invocation_digest) {
      return res.status(409).json({ error: 'CANCELLATION_DIGEST_MISMATCH' });
    }
    const result = await repository.cancel(req.params.request_id, cancellation);
    if (result === 'not_found') return res.status(404).json({ error: 'Job not found' });
    if (result === 'terminal') return res.status(409).json({ error: 'Job already finished' });
    const timeout = Math.max(100, Math.min(10_000, Number(process.env.CANCELLATION_DRAIN_TIMEOUT_MS ?? 5_000)));
    const drained = await TaskQueue.waitForLocal(req.params.request_id, timeout);
    const job = await repository.getJob(req.params.request_id);
    let rollback = job?.rollback as Record<string, unknown> | undefined;
    if (!drained && !rollback) {
      return res.status(202).json({
        status: 'cancelling', cancellation_id: cancellation?.id ?? null,
      });
    }
    if (!rollback) {
      rollback = await ArtifactStore.rollbackGeneratedArtifacts(req.params.request_id);
      rollback.worker_drained = drained;
      await repository.recordRollback(req.params.request_id, rollback);
      if (job) await repository.emitEvent(req.params.request_id, job.session_id, 'cancelled', rollback);
    }
    res.json({ status: 'cancelled', cancellation_id: cancellation?.id ?? null, rollback });
  } catch (error) { next(error); }
});

export default router;

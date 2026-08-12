import { createHash } from 'node:crypto';
import { Router } from 'express';
import { AssessmentRequestSchema, ExecuteRequest, ExecuteRequestSchema } from '../schemas/runtime_schemas';
import { authMiddleware } from '../auth';
import { getFirestore, COLLECTIONS } from '../../services/firestore';
import { TaskQueue } from '../../services/task_queue';
import { AssessmentGraderAgent } from '../../agents/assessment_grader';
import { AssessmentResultSchema, MasteryStateSchema, PracticeSetSchema } from '../../domain/types';
import { updateMasteryState } from '../../services/mastery';
import { EventTracker } from '../../runtime/events';

const router = Router();

router.get('/capabilities', (_req, res) => res.json({
  runtime: 'ego-runtime', version: '0.3.0',
  capabilities: [
    'education.study_plan', 'education.flashcards', 'education.quiz',
    'education.feynman', 'education.mastery', 'documents.pdf', 'documents.text', 'artifacts',
  ],
}));

async function dispatchAndRecord(input: ExecuteRequest): Promise<void> {
  const ref = getFirestore().collection(COLLECTIONS.JOBS).doc(input.request_id);
  try {
    await TaskQueue.dispatch(input);
    await ref.update({ dispatch_status: 'dispatched', dispatch_error: null, updated_at: new Date().toISOString() });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Dispatch failed';
    await ref.update({ dispatch_status: 'failed', dispatch_error: message, updated_at: new Date().toISOString() });
    throw error;
  }
}

router.post('/execute', authMiddleware, async (req, res, next) => {
  try {
    const input = ExecuteRequestSchema.parse(req.body);
    const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const ref = getFirestore().collection(COLLECTIONS.JOBS).doc(input.request_id);
    let shouldDispatch = false;
    let created = false;
    await getFirestore().runTransaction(async transaction => {
      const existing = await transaction.get(ref);
      if (existing.exists) {
        if (existing.data()?.request_digest !== digest) throw new Error('IDEMPOTENCY_CONFLICT');
        shouldDispatch = existing.data()?.status === 'pending' && existing.data()?.dispatch_status !== 'dispatched';
        return;
      }
      created = true;
      shouldDispatch = true;
      const now = new Date().toISOString();
      transaction.create(ref, {
        request_id: input.request_id, user_id: input.user_id, session_id: input.session_id,
        objective_id: input.objective_id, status: 'pending', dispatch_status: 'pending',
        artifacts: [], event_sequence: 0, attempts: 0, request_digest: digest,
        request_payload: input, created_at: now, updated_at: now,
      });
    });
    if (shouldDispatch) await dispatchAndRecord(input);
    res.status(202).json({
      request_id: input.request_id,
      status: created ? 'accepted' : shouldDispatch ? 'redispatched' : 'already_accepted',
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
    const snapshot = await getFirestore().collection(COLLECTIONS.JOBS)
      .where('status', '==', 'pending').limit(25).get();
    let dispatched = 0;
    let failed = 0;
    for (const document of snapshot.docs) {
      const payload = ExecuteRequestSchema.safeParse(document.data().request_payload);
      if (!payload.success || document.data().dispatch_status === 'dispatched') continue;
      try {
        await dispatchAndRecord(payload.data);
        dispatched += 1;
      } catch {
        failed += 1;
      }
    }
    res.json({ scanned: snapshot.size, dispatched, failed });
  } catch (error) { next(error); }
});

router.post('/:request_id/assess', authMiddleware, async (req, res, next) => {
  try {
    const input = AssessmentRequestSchema.parse(req.body);
    const requestDigest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const jobRef = getFirestore().collection(COLLECTIONS.JOBS).doc(req.params.request_id);
    const attemptRef = jobRef.collection('attempts').doc(input.assessment_id);
    const [job, practiceDoc, existingAttempt] = await Promise.all([
      jobRef.get(), jobRef.collection('internal').doc('practice').get(), attemptRef.get(),
    ]);
    if (!job.exists) return res.status(404).json({ error: 'Job not found' });
    if (job.data()?.status !== 'completed') return res.status(409).json({ error: 'Learning package is not ready' });
    if (job.data()?.user_id !== input.user_id || job.data()?.session_id !== input.session_id) {
      return res.status(403).json({ error: 'Assessment does not belong to this learning session' });
    }
    if (existingAttempt.exists) {
      if (existingAttempt.data()?.request_digest !== requestDigest) {
        return res.status(409).json({ error: 'ASSESSMENT_IDEMPOTENCY_CONFLICT' });
      }
      return res.json({
        attempt_id: input.assessment_id,
        assessment: existingAttempt.data()?.assessment,
        mastery: existingAttempt.data()?.mastery,
      });
    }

    const practice = PracticeSetSchema.parse(practiceDoc.data());
    const questionIds = new Set(practice.quiz.map(question => question.id));
    const responseIds = new Set(input.responses.map(response => response.question_id));
    if (responseIds.size !== input.responses.length ||
        input.responses.some(response => !questionIds.has(response.question_id))) {
      return res.status(400).json({ error: 'Duplicate or unknown question_id' });
    }

    const assessment = await new AssessmentGraderAgent().grade(practice, input.responses, input.user_id);
    const expectedConcept = new Map(practice.quiz.map(question => [question.id, question.concept_id]));
    if (assessment.results.length !== responseIds.size || assessment.results.some(result =>
      !responseIds.has(result.question_id) || expectedConcept.get(result.question_id) !== result.concept_id)) {
      throw new Error('Assessment grader returned inconsistent results');
    }

    const masteryRef = jobRef.collection('state').doc('mastery');
    let updatedMastery: ReturnType<typeof updateMasteryState> | undefined;
    let finalAssessment = assessment;
    let createdAttempt = false;
    await getFirestore().runTransaction(async transaction => {
      const [attemptSnapshot, masterySnapshot] = await Promise.all([
        transaction.get(attemptRef), transaction.get(masteryRef),
      ]);
      if (attemptSnapshot.exists) {
        if (attemptSnapshot.data()?.request_digest !== requestDigest) throw new Error('ASSESSMENT_IDEMPOTENCY_CONFLICT');
        updatedMastery = MasteryStateSchema.parse(attemptSnapshot.data()?.mastery);
        finalAssessment = AssessmentResultSchema.parse(attemptSnapshot.data()?.assessment);
        return;
      }
      const currentMastery = MasteryStateSchema.parse(masterySnapshot.data());
      const updatedAt = new Date();
      updatedMastery = updateMasteryState(currentMastery, assessment, updatedAt);
      createdAttempt = true;
      transaction.create(attemptRef, {
        request_digest: requestDigest,
        assessment,
        mastery: updatedMastery,
        responses: input.responses,
        created_at: updatedAt.toISOString(),
      });
      transaction.set(masteryRef, updatedMastery);
    });

    if (createdAttempt) {
      await new EventTracker(req.params.request_id, input.session_id)
        .emit('assessment_completed', { attempt_id: input.assessment_id });
    }
    res.json({ attempt_id: input.assessment_id, assessment: finalAssessment, mastery: updatedMastery });
  } catch (error) {
    if (error instanceof Error && error.message === 'ASSESSMENT_IDEMPOTENCY_CONFLICT') {
      return res.status(409).json({ error: error.message });
    }
    next(error);
  }
});

router.get('/:request_id/mastery', authMiddleware, async (req, res) => {
  const state = await getFirestore().collection(COLLECTIONS.JOBS).doc(req.params.request_id)
    .collection('state').doc('mastery').get();
  if (!state.exists) return res.status(404).json({ error: 'Mastery state not found' });
  res.json(MasteryStateSchema.parse(state.data()));
});

router.get('/:request_id', authMiddleware, async (req, res) => {
  const doc = await getFirestore().collection(COLLECTIONS.JOBS).doc(req.params.request_id).get();
  if (!doc.exists) return res.status(404).json({ error: 'Job not found' });
  const data = doc.data()!;
  const { request_payload: _payload, request_digest: _digest, lease_owner: _owner,
    lease_expires_at: _expires, ...publicJob } = data;
  res.json(publicJob);
});

router.get('/:request_id/events', authMiddleware, async (req, res) => {
  const cursor = Number.parseInt(String(req.query.cursor ?? 0), 10) || 0;
  const snapshot = await getFirestore().collection(COLLECTIONS.JOBS).doc(req.params.request_id)
    .collection(COLLECTIONS.EVENTS).where('sequence_number', '>', cursor).orderBy('sequence_number').get();
  res.json({ events: snapshot.docs.map(doc => doc.data()) });
});

router.post('/:request_id/cancel', authMiddleware, async (req, res) => {
  const ref = getFirestore().collection(COLLECTIONS.JOBS).doc(req.params.request_id);
  const doc = await ref.get();
  if (!doc.exists) return res.status(404).json({ error: 'Job not found' });
  if (['completed', 'failed'].includes(doc.data()?.status)) return res.status(409).json({ error: 'Job already finished' });
  await ref.update({ status: 'cancelled', lease_owner: null, lease_expires_at: null, updated_at: new Date().toISOString() });
  res.json({ status: 'cancelled' });
});

export default router;

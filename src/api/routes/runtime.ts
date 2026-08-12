import { createHash } from 'node:crypto';
import { Router } from 'express';
import { ExecuteRequestSchema } from '../schemas/runtime_schemas';
import { authMiddleware } from '../auth';
import { getFirestore, COLLECTIONS } from '../../services/firestore';
import { TaskQueue } from '../../services/task_queue';

const router = Router();
router.get('/capabilities', (_req, res) => res.json({
  runtime: 'ego-runtime', version: '0.2.0',
  capabilities: ['education.study_plan', 'documents.pdf', 'documents.text', 'artifacts'],
}));

router.post('/execute', authMiddleware, async (req, res, next) => {
  try {
    const input = ExecuteRequestSchema.parse(req.body);
    const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
    const ref = getFirestore().collection(COLLECTIONS.JOBS).doc(input.request_id);
    let created = false;
    await getFirestore().runTransaction(async tx => {
      const existing = await tx.get(ref);
      if (existing.exists) {
        if (existing.data()?.request_digest !== digest) throw new Error('IDEMPOTENCY_CONFLICT');
        return;
      }
      created = true; const now = new Date().toISOString();
      tx.create(ref, { request_id: input.request_id, user_id: input.user_id, session_id: input.session_id,
        objective_id: input.objective_id, status: 'pending', artifacts: [], event_sequence: 0,
        request_digest: digest, created_at: now, updated_at: now });
    });
    if (created) await TaskQueue.dispatch(input);
    res.status(202).json({ request_id: input.request_id, status: created ? 'accepted' : 'already_accepted' });
  } catch (error) {
    if (error instanceof Error && error.message === 'IDEMPOTENCY_CONFLICT') return res.status(409).json({ error: error.message });
    next(error);
  }
});

router.post('/worker', authMiddleware, async (req, res, next) => {
  try { const input = ExecuteRequestSchema.parse(req.body); await TaskQueue.dispatchLocal(input); res.status(204).end(); }
  catch (error) { next(error); }
});
router.get('/:request_id', authMiddleware, async (req, res) => {
  const doc = await getFirestore().collection(COLLECTIONS.JOBS).doc(req.params.request_id).get();
  if (!doc.exists) return res.status(404).json({ error: 'Job not found' });
  res.json(doc.data());
});
router.get('/:request_id/events', authMiddleware, async (req, res) => {
  const cursor = Number.parseInt(String(req.query.cursor ?? 0), 10) || 0;
  const snapshot = await getFirestore().collection(COLLECTIONS.JOBS).doc(req.params.request_id)
    .collection(COLLECTIONS.EVENTS).where('sequence_number', '>', cursor).orderBy('sequence_number').get();
  res.json({ events: snapshot.docs.map(doc => doc.data()) });
});
router.post('/:request_id/cancel', authMiddleware, async (req, res) => {
  const ref = getFirestore().collection(COLLECTIONS.JOBS).doc(req.params.request_id);
  const doc = await ref.get(); if (!doc.exists) return res.status(404).json({ error: 'Job not found' });
  if (['completed', 'failed'].includes(doc.data()?.status)) return res.status(409).json({ error: 'Job already finished' });
  await ref.update({ status: 'cancelled', updated_at: new Date().toISOString() });
  res.json({ status: 'cancelled' });
});
export default router;

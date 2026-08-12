import { Router, Request, Response } from 'express';
import { ExecuteRequestSchema } from '../schemas/runtime_schemas';
import { getFirestore, COLLECTIONS } from '../../services/firestore';
import { TaskQueue } from '../../services/task_queue';

const router = Router();

// Simple auth middleware simulation
const authMiddleware = (req: Request, res: Response, next: Function) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }
  next();
};

router.get('/capabilities', (req, res) => {
  res.json({
    runtime: "ego-runtime",
    version: "0.1.0",
    capabilities: [
      "education.tutor",
      "education.research",
      "education.feynman",
      "education.flashcards",
      "education.critique",
      "education.study_plan",
      "education.scheduling",
      "documents.pdf",
      "artifacts"
    ]
  });
});

router.post('/execute', authMiddleware, async (req, res) => {
  try {
    const parsedReq = ExecuteRequestSchema.parse(req.body);
    
    const db = getFirestore();
    const jobRef = db.collection(COLLECTIONS.JOBS).doc(parsedReq.request_id);
    
    // Idempotency check
    const jobDoc = await jobRef.get();
    if (jobDoc.exists) {
      return res.status(202).json({
        request_id: parsedReq.request_id,
        status: 'accepted',
        message: 'Job already exists'
      });
    }

    // Persist new job
    await jobRef.set({
      request_id: parsedReq.request_id,
      session_id: parsedReq.session_id,
      objective_id: parsedReq.objective_id,
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    // Dispatch async work
    await TaskQueue.dispatch(parsedReq);

    // Return 202 Accepted immediately
    res.status(202).json({
      request_id: parsedReq.request_id,
      status: 'accepted'
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Invalid request' });
  }
});

router.get('/:request_id', authMiddleware, async (req, res) => {
  const db = getFirestore();
  const doc = await db.collection(COLLECTIONS.JOBS).doc(req.params.request_id).get();
  if (!doc.exists) {
    return res.status(404).json({ error: 'Job not found' });
  }
  res.json(doc.data());
});

router.get('/:request_id/events', authMiddleware, async (req, res) => {
  const db = getFirestore();
  const cursor = parseInt(req.query.cursor as string || '0', 10);
  
  const snapshot = await db.collection(COLLECTIONS.EVENTS)
    .where('request_id', '==', req.params.request_id)
    .where('sequence_number', '>', cursor)
    .orderBy('sequence_number', 'asc')
    .get();
    
  const events = snapshot.docs.map(d => d.data());
  res.json({ events });
});

router.post('/:request_id/cancel', authMiddleware, async (req, res) => {
  const db = getFirestore();
  const jobRef = db.collection(COLLECTIONS.JOBS).doc(req.params.request_id);
  
  const doc = await jobRef.get();
  if (!doc.exists) {
    return res.status(404).json({ error: 'Job not found' });
  }
  
  await jobRef.update({
    status: 'cancelled',
    updated_at: new Date().toISOString()
  });
  
  res.json({ status: 'cancelled' });
});

export default router;

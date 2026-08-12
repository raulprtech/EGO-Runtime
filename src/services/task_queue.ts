import { ExecuteRequest } from '../api/schemas/runtime_schemas';
import { Coordinator } from '../agents/coordinator';
import { getFirestore, COLLECTIONS } from './firestore';

export class TaskQueue {
  static async dispatch(request: ExecuteRequest): Promise<void> {
    // Simulate Pub/Sub or Cloud Tasks behavior.
    // We run this asynchronously so the HTTP response can return immediately.
    setImmediate(async () => {
      try {
        console.log(`[TaskQueue] Picked up job ${request.request_id}`);
        const coordinator = new Coordinator(request);
        await coordinator.run();
      } catch (error) {
        console.error(`[TaskQueue] Job ${request.request_id} failed:`, error);
        const db = getFirestore();
        await db.collection(COLLECTIONS.JOBS).doc(request.request_id).update({
          status: 'failed',
          updated_at: new Date().toISOString()
        });
      }
    });
  }
}

import { randomUUID } from 'node:crypto';
import { getFirestore, COLLECTIONS } from '../services/firestore';
import { RuntimeEvent } from '../api/schemas/runtime_schemas';

export class EventTracker {
  constructor(private readonly requestId: string, private readonly sessionId: string) {}
  async emit(type: string, data: Record<string, unknown> = {}): Promise<RuntimeEvent> {
    const db = getFirestore();
    const jobRef = db.collection(COLLECTIONS.JOBS).doc(this.requestId);
    const eventId = `evt_${randomUUID()}`;
    let event: RuntimeEvent | undefined;
    await db.runTransaction(async (transaction) => {
      const job = await transaction.get(jobRef);
      if (!job.exists) throw new Error(`Job ${this.requestId} does not exist`);
      const sequence = Number(job.data()?.event_sequence ?? 0) + 1;
      event = { event_id: eventId, request_id: this.requestId, session_id: this.sessionId,
        sequence_number: sequence, type, timestamp: new Date().toISOString(), data };
      transaction.update(jobRef, { event_sequence: sequence });
      transaction.create(jobRef.collection(COLLECTIONS.EVENTS).doc(eventId), event);
    });
    return event!;
  }
}

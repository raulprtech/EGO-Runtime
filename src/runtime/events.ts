import { getFirestore, COLLECTIONS } from '../services/firestore';
import { RuntimeEvent } from '../api/schemas/runtime_schemas';
import { v4 as uuidv4 } from 'uuid';

export class EventTracker {
  private requestId: string;
  private sessionId: string;

  constructor(requestId: string, sessionId: string) {
    this.requestId = requestId;
    this.sessionId = sessionId;
  }

  private async getNextSequenceNumber(): Promise<number> {
    const db = getFirestore();
    const seqRef = db.collection(COLLECTIONS.SEQUENCES).doc(this.requestId);
    
    return await db.runTransaction(async (t) => {
      const doc = await t.get(seqRef);
      let nextSeq = 1;
      if (doc.exists) {
        nextSeq = (doc.data()?.current || 0) + 1;
      }
      t.set(seqRef, { current: nextSeq });
      return nextSeq;
    });
  }

  async emit(type: string, data: Record<string, any> = {}): Promise<void> {
    const db = getFirestore();
    const seq = await this.getNextSequenceNumber();
    
    const event: RuntimeEvent = {
      event_id: `evt_${uuidv4()}`,
      request_id: this.requestId,
      session_id: this.sessionId,
      sequence_number: seq,
      type,
      timestamp: new Date().toISOString(),
      data
    };

    await db.collection(COLLECTIONS.EVENTS).doc(event.event_id).set(event);
    console.log(`[Event Emitted] [${this.requestId}] [${seq}] ${type}`);
  }
}

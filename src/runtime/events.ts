import { getRuntimeRepository } from '../services/runtime_repository';
import { RuntimeEvent } from '../api/schemas/runtime_schemas';

export class EventTracker {
  constructor(private readonly requestId: string, private readonly sessionId: string) {}

  emit(type: string, data: Record<string, unknown> = {}): Promise<RuntimeEvent> {
    return getRuntimeRepository().emitEvent(this.requestId, this.sessionId, type, data);
  }
}

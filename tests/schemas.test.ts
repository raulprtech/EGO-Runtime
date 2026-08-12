import { describe, it, expect, vi } from 'vitest';
import { PlannerAgent } from '../src/agents/planner';
import { ExecuteRequestSchema } from '../src/api/schemas/runtime_schemas';

describe('ExecuteRequestSchema', () => {
  it('should validate a correct request', () => {
    const validReq = {
      request_id: 'req_123',
      user_id: 'usr_1',
      session_id: 'sess_1',
      objective_id: 'obj_1',
      message: 'Hello',
    };
    const parsed = ExecuteRequestSchema.parse(validReq);
    expect(parsed.request_id).toBe('req_123');
    expect(parsed.attachments).toEqual([]);
  });

  it('should fail on missing fields', () => {
    const invalidReq = {
      user_id: 'usr_1',
    };
    expect(() => ExecuteRequestSchema.parse(invalidReq)).toThrow();
  });
});

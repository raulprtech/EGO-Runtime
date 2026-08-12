import { describe, expect, it } from 'vitest';
import { ExecuteRequestSchema } from '../src/api/schemas/runtime_schemas';
import { StudyPlanSchema } from '../src/domain/types';

describe('runtime contracts', () => {
  it('defaults optional execute collections', () => {
    const parsed = ExecuteRequestSchema.parse({
      request_id: 'req_123', user_id: 'usr_1', session_id: 'sess_1',
      objective_id: 'obj_1', message: 'Master these papers',
    });
    expect(parsed.attachments).toEqual([]);
    expect(parsed.metadata).toEqual({});
  });
  it('rejects remote HTTP artifacts', () => {
    expect(() => ExecuteRequestSchema.parse({
      request_id: 'r', user_id: 'u', session_id: 's', objective_id: 'o', message: 'm',
      attachments: [{ id: 'a', name: 'x.pdf', mime_type: 'application/pdf', uri: 'https://example.com/x.pdf' }],
    })).toThrow();
  });
  it('validates mastery-oriented plans', () => {
    expect(StudyPlanSchema.parse({
      learning_objective: 'Understand X', sub_objectives: [], required_concepts: [], dependencies: [],
      estimated_difficulty: 'advanced', study_sessions: [{ id: 's1', topic: 'X', duration_minutes: 25,
        technique: 'feynman', activities: ['Explain X'], completion_criteria: ['No unexplained terms'] }],
      review_cadence_days: [1, 3, 7], mastery_criteria: ['Score 80%'], deliverables: [],
    }).study_sessions[0].technique).toBe('feynman');
  });
});

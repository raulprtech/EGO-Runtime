import { describe, expect, it } from 'vitest';
import { ExecuteRequestSchema } from '../src/api/schemas/runtime_schemas';
import { MasteryStateSchema, PracticeSetSchema, StudyPlanSchema } from '../src/domain/types';
import { isJobClaimable } from '../src/services/job_lifecycle';
import { updateMasteryState } from '../src/services/mastery';

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
  it('validates a practice package', () => {
    const card = { id: 'f1', concept_id: 'c1', front: 'What is X?', back: 'X',
      source_artifact_ids: ['a1'] };
    const question = { id: 'q1', concept_id: 'c1', prompt: 'Explain X', answer_key: 'X',
      rubric: ['Defines X'], source_artifact_ids: ['a1'] };
    expect(PracticeSetSchema.parse({
      session: { title: 'X', focus_minutes: 25, feynman_prompt: 'Teach X', completion_criteria: ['Clear'] },
      flashcards: [card, { ...card, id: 'f2' }, { ...card, id: 'f3' }],
      quiz: [question, { ...question, id: 'q2' }, { ...question, id: 'q3' }],
    }).quiz).toHaveLength(3);
  });
});

describe('job lifecycle', () => {
  it('rejects an active lease and permits an expired lease', () => {
    const now = Date.parse('2026-08-12T12:00:00Z');
    expect(isJobClaimable({ status: 'running', lease_expires_at: '2026-08-12T12:05:00Z' }, now)).toBe(false);
    expect(isJobClaimable({ status: 'running', lease_expires_at: '2026-08-12T11:59:00Z' }, now)).toBe(true);
    expect(isJobClaimable({ status: 'completed' }, now)).toBe(false);
  });
});

describe('mastery update', () => {
  it('raises confidence and schedules a longer interval after mastery', () => {
    const mastery = MasteryStateSchema.parse({
      objective_id: 'o1', updated_at: '2026-08-01T00:00:00Z',
      concepts: [{ concept_id: 'c1', label: 'X', confidence: 0, attempts: 0,
        next_review_at: '2026-08-02T00:00:00Z' }],
    });
    const updated = updateMasteryState(mastery, {
      summary: 'Good', results: [{ question_id: 'q1', concept_id: 'c1', score: 0.9,
        feedback: 'Correct', missing_elements: [] }],
    }, new Date('2026-08-12T00:00:00Z'));
    expect(updated.concepts[0].confidence).toBeCloseTo(0.54);
    expect(updated.concepts[0].attempts).toBe(1);
    expect(updated.concepts[0].next_review_at).toBe('2026-08-19T00:00:00.000Z');
  });
});

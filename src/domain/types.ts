import { z } from 'zod';
import { ArtifactSchema } from '../api/schemas/runtime_schemas';

export const LearningObjectiveSchema = z.object({
  id: z.string(), title: z.string(), description: z.string(), deadline: z.string().optional(),
  status: z.enum(['draft', 'active', 'paused', 'completed', 'cancelled']),
  progress: z.number().min(0).max(1), concepts: z.array(z.string()),
  materials: z.array(ArtifactSchema), milestones: z.array(z.string()),
});
export type LearningObjective = z.infer<typeof LearningObjectiveSchema>;

export const StudyPlanSchema = z.object({
  learning_objective: z.string(),
  sub_objectives: z.array(z.string()),
  required_concepts: z.array(z.string()),
  dependencies: z.array(z.string()),
  estimated_difficulty: z.enum(['introductory', 'intermediate', 'advanced']),
  study_sessions: z.array(z.object({
    id: z.string(), topic: z.string(), duration_minutes: z.number().int().min(15).max(180),
    technique: z.enum(['focus', 'feynman', 'flashcards', 'quiz', 'review']),
    activities: z.array(z.string()), completion_criteria: z.array(z.string()),
  })),
  review_cadence_days: z.array(z.number().int().positive()),
  mastery_criteria: z.array(z.string()),
  deliverables: z.array(z.string()),
});
export type StudyPlan = z.infer<typeof StudyPlanSchema>;

export const ConceptMapSchema = z.object({
  nodes: z.array(z.object({
    id: z.string(), label: z.string(),
    type: z.enum(['foundation', 'concept', 'method', 'application']),
    source_artifact_ids: z.array(z.string()),
  })),
  edges: z.array(z.object({ source: z.string(), target: z.string(), relationship: z.string() })),
});
export type ConceptMap = z.infer<typeof ConceptMapSchema>;

export const PracticeSetSchema = z.object({
  session: z.object({
    title: z.string(),
    focus_minutes: z.number().int().min(15).max(90),
    feynman_prompt: z.string(),
    completion_criteria: z.array(z.string()),
  }),
  flashcards: z.array(z.object({
    id: z.string(), concept_id: z.string(), front: z.string(), back: z.string(),
    source_artifact_ids: z.array(z.string()),
  })).min(3).max(30),
  quiz: z.array(z.object({
    id: z.string(), concept_id: z.string(), prompt: z.string(), answer_key: z.string(),
    rubric: z.array(z.string()), source_artifact_ids: z.array(z.string()),
  })).min(3).max(15),
});
export type PracticeSet = z.infer<typeof PracticeSetSchema>;

export const AssessmentResultSchema = z.object({
  results: z.array(z.object({
    question_id: z.string(), concept_id: z.string(), score: z.number().min(0).max(1),
    feedback: z.string(), missing_elements: z.array(z.string()),
  })),
  summary: z.string(),
});
export type AssessmentResult = z.infer<typeof AssessmentResultSchema>;

export const MasteryStateSchema = z.object({
  objective_id: z.string(),
  concepts: z.array(z.object({
    concept_id: z.string(), label: z.string(), confidence: z.number().min(0).max(1),
    attempts: z.number().int().nonnegative(), next_review_at: z.string(),
  })),
  updated_at: z.string(),
});
export type MasteryState = z.infer<typeof MasteryStateSchema>;

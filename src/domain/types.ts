import { z } from 'zod';
import { ArtifactSchema } from '../api/schemas/runtime_schemas';

export const LearningObjectiveSchema = z.object({
  id: z.string(), title: z.string(), description: z.string(), deadline: z.string().optional(),
  status: z.enum(['draft', 'active', 'paused', 'completed', 'cancelled']),
  progress: z.number().min(0).max(1), concepts: z.array(z.string()),
  materials: z.array(ArtifactSchema), milestones: z.array(z.string()),
});
export type LearningObjective = z.infer<typeof LearningObjectiveSchema>;

export const ConceptSchema = z.object({
  concept: z.string(), confidence: z.number().min(0).max(1),
  evidence: z.array(z.object({ type: z.string(), score: z.number() })),
  last_reviewed: z.string().optional(), next_review: z.string().optional(),
});
export type ConceptState = z.infer<typeof ConceptSchema>;

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

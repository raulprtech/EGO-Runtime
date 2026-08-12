import { z } from 'zod';
import { ArtifactSchema } from '../api/schemas/runtime_schemas';

export const LearningObjectiveSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  deadline: z.string().optional(),
  status: z.enum(['draft', 'active', 'paused', 'completed', 'cancelled']),
  progress: z.number(),
  concepts: z.array(z.string()),
  materials: z.array(ArtifactSchema),
  milestones: z.array(z.string()),
});

export type LearningObjective = z.infer<typeof LearningObjectiveSchema>;

export const ConceptSchema = z.object({
  concept: z.string(),
  confidence: z.number(),
  evidence: z.array(z.object({
    type: z.string(),
    score: z.number()
  })),
  last_reviewed: z.string().optional(),
  next_review: z.string().optional()
});

export type ConceptState = z.infer<typeof ConceptSchema>;

// Outputs for Gemini
export const StudyPlanSchema = z.object({
  learning_objective: z.string(),
  sub_objectives: z.array(z.string()),
  required_concepts: z.array(z.string()),
  dependencies: z.array(z.string()),
  estimated_difficulty: z.string(),
  study_sessions: z.array(z.object({
    topic: z.string(),
    duration_minutes: z.number(),
    activities: z.array(z.string())
  })),
  deliverables: z.array(z.string())
});

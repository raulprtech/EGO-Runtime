import { z } from 'zod';

export const ArtifactSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(255),
  mime_type: z.enum(['application/pdf', 'text/plain', 'text/markdown', 'application/json']),
  uri: z.string().refine(value => /^gs:\/\/[^/]+\/.+$/.test(value) || /^file:\/\/.+$/.test(value),
    'Artifact URI must use gs:// or file://'),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  size_bytes: z.number().int().positive().optional(),
});
export type Artifact = z.infer<typeof ArtifactSchema>;

export const ExecuteRequestSchema = z.object({
  request_id: z.string().min(1).max(128),
  user_id: z.string().min(1).max(128),
  session_id: z.string().min(1).max(128),
  objective_id: z.string().min(1).max(128),
  message: z.string().min(1).max(20_000),
  attachments: z.array(ArtifactSchema).max(20).default([]),
  capabilities: z.array(z.string()).default([]),
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type ExecuteRequest = z.infer<typeof ExecuteRequestSchema>;

export const AssessmentRequestSchema = z.object({
  assessment_id: z.string().regex(/^[A-Za-z0-9_-]+$/).max(128),
  user_id: z.string().min(1).max(128),
  session_id: z.string().min(1).max(128),
  responses: z.array(z.object({
    question_id: z.string().min(1).max(128),
    answer: z.string().min(1).max(10_000),
  })).min(1).max(15),
});
export type AssessmentRequest = z.infer<typeof AssessmentRequestSchema>;

export const EventSchema = z.object({
  event_id: z.string(), request_id: z.string(), session_id: z.string(),
  sequence_number: z.number().int().positive(), type: z.string(), timestamp: z.string(),
  data: z.record(z.string(), z.unknown()),
});
export type RuntimeEvent = z.infer<typeof EventSchema>;

export const JobStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobSchema = z.object({
  request_id: z.string(), session_id: z.string(), objective_id: z.string(), user_id: z.string(),
  status: JobStatusSchema, artifacts: z.array(ArtifactSchema).default([]), error: z.string().optional(),
  created_at: z.string(), updated_at: z.string(),
});
export type Job = z.infer<typeof JobSchema>;

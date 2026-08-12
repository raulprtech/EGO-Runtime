import { z } from 'zod';

export const ArtifactSchema = z.object({
  id: z.string(),
  name: z.string(),
  mime_type: z.string(),
  uri: z.string(),
});

export type Artifact = z.infer<typeof ArtifactSchema>;

export const ExecuteRequestSchema = z.object({
  request_id: z.string(),
  user_id: z.string(),
  session_id: z.string(),
  objective_id: z.string(),
  message: z.string(),
  attachments: z.array(ArtifactSchema).default([]),
  capabilities: z.array(z.string()).default([]),
  metadata: z.record(z.any()).default({}),
});

export type ExecuteRequest = z.infer<typeof ExecuteRequestSchema>;

export const EventSchema = z.object({
  event_id: z.string(),
  request_id: z.string(),
  session_id: z.string(),
  sequence_number: z.number(),
  type: z.string(),
  timestamp: z.string(),
  data: z.record(z.any()),
});

export type RuntimeEvent = z.infer<typeof EventSchema>;

export const JobStatusSchema = z.enum(['pending', 'running', 'completed', 'failed', 'cancelled']);
export type JobStatus = z.infer<typeof JobStatusSchema>;

export const JobSchema = z.object({
  request_id: z.string(),
  session_id: z.string(),
  objective_id: z.string(),
  status: JobStatusSchema,
  created_at: z.string(),
  updated_at: z.string(),
});

export type Job = z.infer<typeof JobSchema>;

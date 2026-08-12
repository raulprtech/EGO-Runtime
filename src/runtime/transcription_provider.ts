import { z } from 'zod';

export const TranscriptionSegmentSchema = z.object({
  start_ms: z.number().int().nonnegative(),
  end_ms: z.number().int().nonnegative(),
  speaker: z.string().min(1).max(100).optional(),
  text: z.string().min(1),
  language: z.string().min(2).max(35).optional(),
}).refine(segment => segment.end_ms >= segment.start_ms, {
  message: 'Segment end_ms must be greater than or equal to start_ms',
});

export const TranscriptionResultSchema = z.object({
  text: z.string(),
  detected_language: z.string().min(2).max(35).optional(),
  duration_ms: z.number().int().positive().optional(),
  segments: z.array(TranscriptionSegmentSchema).default([]),
});

export type TranscriptionResult = z.infer<typeof TranscriptionResultSchema>;

export interface TranscriptionRequest {
  audio: Uint8Array;
  mimeType: string;
  language?: string;
  diarization?: boolean;
  abortSignal?: AbortSignal;
}

export interface TranscriptionProvider {
  readonly id: string;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
}

let override: TranscriptionProvider | undefined;

export function setTranscriptionProvider(provider?: TranscriptionProvider): void {
  override = provider;
}

export async function getTranscriptionProvider(): Promise<TranscriptionProvider> {
  if (override) return override;
  const provider = process.env.TRANSCRIPTION_PROVIDER ?? 'gemini';
  if (provider === 'gemini' || provider === 'gemini-adk') {
    const { GeminiTranscriptionProvider } = await import('../providers/gemini_transcription_provider');
    return new GeminiTranscriptionProvider();
  }
  throw new Error(`Unsupported TRANSCRIPTION_PROVIDER: ${provider}`);
}

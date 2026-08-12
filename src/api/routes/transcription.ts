import { randomUUID } from 'node:crypto';
import express, { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth';
import { getTranscriptionProvider, TranscriptionResultSchema } from '../../runtime/transcription_provider';

const router = Router();
const maxAudioBytes = Number(process.env.MAX_AUDIO_BYTES ?? 10 * 1024 * 1024);
const supportedMimeTypes = new Set([
  'audio/wav', 'audio/x-wav', 'audio/mp3', 'audio/mpeg', 'audio/aiff',
  'audio/x-aiff', 'audio/aac', 'audio/ogg', 'audio/flac', 'audio/mp4', 'audio/webm',
]);
const optionsSchema = z.object({
  language: z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).optional(),
  diarization: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
});
const transcriptionIdSchema = z.string().regex(/^[A-Za-z0-9_-]+$/).max(128);

router.post(
  '/',
  authMiddleware,
  express.raw({ type: () => true, limit: maxAudioBytes }),
  async (req, res, next) => {
    try {
      const mimeType = String(req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (!supportedMimeTypes.has(mimeType)) {
        return res.status(415).json({
          error: 'Unsupported audio type',
          supported_mime_types: [...supportedMimeTypes],
        });
      }
      if (!Buffer.isBuffer(req.body) || !req.body.length) {
        return res.status(400).json({ error: 'Audio body is required' });
      }
      const options = optionsSchema.parse({
        language: typeof req.query.language === 'string' ? req.query.language : undefined,
        diarization: typeof req.query.diarization === 'string' ? req.query.diarization : undefined,
      });
      const requestedId = req.header('x-transcription-id');
      const transcriptId = requestedId
        ? transcriptionIdSchema.parse(requestedId)
        : `tr_${randomUUID()}`;
      const timeoutMs = Number(process.env.TRANSCRIPTION_TIMEOUT_MS ?? 120_000);
      const provider = await getTranscriptionProvider();
      const result = TranscriptionResultSchema.parse(await provider.transcribe({
        audio: req.body,
        mimeType: mimeType === 'audio/mpeg' ? 'audio/mp3'
          : mimeType === 'audio/x-wav' ? 'audio/wav'
            : mimeType === 'audio/x-aiff' ? 'audio/aiff' : mimeType,
        language: options.language,
        diarization: options.diarization,
        abortSignal: AbortSignal.timeout(timeoutMs),
      }));
      res.json({
        transcription_id: transcriptId,
        provider: provider.id,
        ...result,
      });
    } catch (error) {
      next(error);
    }
  },
);

export default router;

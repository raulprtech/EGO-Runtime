import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../auth';
import { getSpeechSynthesisProvider } from '../../runtime/speech_synthesis_provider';

const router = Router();
const maxTextChars = Number(process.env.MAX_SPEECH_TEXT_CHARS ?? 8_000);
const requestSchema = z.object({
  speech_id: z.string().regex(/^[A-Za-z0-9_-]+$/).max(128).optional(),
  text: z.string().min(1).max(maxTextChars),
  voice: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/).optional(),
  language: z.string().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).optional(),
  style: z.string().min(1).max(500).optional(),
  format: z.enum(['wav', 'pcm']).default('wav'),
});

router.post('/', authMiddleware, async (req, res, next) => {
  try {
    const input = requestSchema.parse(req.body);
    const speechId = input.speech_id ?? `sp_${randomUUID()}`;
    const provider = await getSpeechSynthesisProvider();
    const result = await provider.synthesize({
      text: input.text,
      voice: input.voice,
      language: input.language,
      style: input.style,
      format: input.format,
      abortSignal: AbortSignal.timeout(Number(process.env.SPEECH_SYNTHESIS_TIMEOUT_MS ?? 120_000)),
    });
    res.set({
      'Content-Type': result.mimeType,
      'Content-Length': String(result.audio.byteLength),
      'Cache-Control': 'no-store',
      'Content-Disposition': `inline; filename="${speechId}.${input.format}"`,
      'X-Speech-Id': speechId,
      'X-Speech-Provider': provider.id,
      'X-Audio-Sample-Rate': String(result.sampleRate),
      'X-Audio-Channels': String(result.channels),
      ...(result.durationMs ? { 'X-Audio-Duration-Ms': String(result.durationMs) } : {}),
    });
    res.send(Buffer.from(result.audio));
  } catch (error) {
    next(error);
  }
});

export default router;

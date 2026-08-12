import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getTranscriptionProvider } from '../src/runtime/transcription_provider';

const filename = process.env.EGO_TRANSCRIPTION_SMOKE_FILE;
if (!filename) throw new Error('Set EGO_TRANSCRIPTION_SMOKE_FILE to a WAV, MP3, AIFF, AAC, OGG, FLAC, M4A or WebM recording');

const mimeByExtension: Record<string, string> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.webm': 'audio/webm',
};
const mimeType = mimeByExtension[path.extname(filename).toLowerCase()];
if (!mimeType) throw new Error('Unsupported audio extension');

const provider = await getTranscriptionProvider();
const startedAt = Date.now();
const result = await provider.transcribe({
  audio: await fs.readFile(filename),
  mimeType,
  language: process.env.EGO_TRANSCRIPTION_LANGUAGE,
  diarization: process.env.EGO_TRANSCRIPTION_DIARIZATION === 'true',
});

console.log(JSON.stringify({
  type: 'transcription.smoke_passed',
  provider: provider.id,
  model: process.env.EGO_TRANSCRIPTION_MODEL ?? process.env.EGO_MODEL ?? 'provider-default',
  latency_ms: Date.now() - startedAt,
  characters: result.text.length,
  segments: result.segments.length,
  detected_language: result.detected_language,
}));

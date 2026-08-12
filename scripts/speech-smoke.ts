import 'dotenv/config';
import fs from 'node:fs/promises';
import { getSpeechSynthesisProvider } from '../src/runtime/speech_synthesis_provider';

const provider = await getSpeechSynthesisProvider();
const startedAt = Date.now();
const result = await provider.synthesize({
  text: process.env.EGO_SPEECH_SMOKE_TEXT ?? 'Hola. La s�ntesis de voz est� funcionando correctamente.',
  voice: process.env.EGO_TTS_VOICE,
  language: process.env.EGO_SPEECH_LANGUAGE ?? 'es-MX',
  style: process.env.EGO_SPEECH_STYLE ?? 'Warm, clear, conversational, and concise.',
  format: 'wav',
});
const output = process.env.EGO_SPEECH_SMOKE_OUTPUT ?? '/tmp/ego-speech-smoke.wav';
await fs.writeFile(output, result.audio);

console.log(JSON.stringify({
  type: 'speech.smoke_passed',
  provider: provider.id,
  model: process.env.EGO_TTS_MODEL ?? 'gemini-3.1-flash-tts-preview',
  latency_ms: Date.now() - startedAt,
  bytes: result.audio.byteLength,
  duration_ms: result.durationMs,
  sample_rate: result.sampleRate,
  channels: result.channels,
  output,
}));

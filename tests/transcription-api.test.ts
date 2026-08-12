import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server';
import {
  setTranscriptionProvider,
  TranscriptionProvider,
  TranscriptionRequest,
} from '../src/runtime/transcription_provider';

describe('transcription API', () => {
  afterEach(() => setTranscriptionProvider(undefined));

  it('accepts authenticated binary audio through a provider-neutral contract', async () => {
    let received: TranscriptionRequest | undefined;
    const provider: TranscriptionProvider = {
      id: 'test-transcriber',
      async transcribe(request) {
        received = request;
        return {
          text: 'Hola, esta es una prueba.',
          detected_language: 'es-MX',
          duration_ms: 1200,
          segments: [{
            start_ms: 0, end_ms: 1200, speaker: 'Speaker 1',
            text: 'Hola, esta es una prueba.', language: 'es-MX',
          }],
        };
      },
    };
    setTranscriptionProvider(provider);
    process.env.INTERNAL_RUNTIME_TOKEN = 'transcription-test-token';

    const app = await createApp();
    const server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      const response = await fetch(
        `${base}/v1/runtime/transcriptions?language=es-MX&diarization=true`,
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer transcription-test-token',
            'Content-Type': 'audio/wav',
            'X-Transcription-Id': 'voice_turn_1',
          },
          body: new Uint8Array([82, 73, 70, 70]),
        },
      );
      expect(response.ok).toBe(true);
      expect(await response.json()).toMatchObject({
        transcription_id: 'voice_turn_1',
        provider: 'test-transcriber',
        text: 'Hola, esta es una prueba.',
        detected_language: 'es-MX',
      });
      expect(received).toMatchObject({
        mimeType: 'audio/wav',
        language: 'es-MX',
        diarization: true,
      });
      expect(received?.audio.byteLength).toBe(4);

      const unsupported = await fetch(`${base}/v1/runtime/transcriptions`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer transcription-test-token',
          'Content-Type': 'application/octet-stream',
        },
        body: new Uint8Array([1]),
      });
      expect(unsupported.status).toBe(415);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => error ? reject(error) : resolve()));
    }
  });
});

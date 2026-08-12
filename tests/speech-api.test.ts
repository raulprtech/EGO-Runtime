import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../server';
import {
  setSpeechSynthesisProvider,
  SpeechSynthesisProvider,
  SpeechSynthesisRequest,
} from '../src/runtime/speech_synthesis_provider';

describe('speech synthesis API', () => {
  afterEach(() => setSpeechSynthesisProvider(undefined));

  it('returns playable binary audio through a provider-neutral contract', async () => {
    let received: SpeechSynthesisRequest | undefined;
    const provider: SpeechSynthesisProvider = {
      id: 'test-speech',
      async synthesize(request) {
        received = request;
        return {
          audio: new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]),
          mimeType: 'audio/wav',
          sampleRate: 24_000,
          channels: 1,
          durationMs: 500,
        };
      },
    };
    setSpeechSynthesisProvider(provider);
    process.env.INTERNAL_RUNTIME_TOKEN = 'speech-test-token';

    const app = await createApp();
    const server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      const response = await fetch(`${base}/v1/runtime/speech`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer speech-test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          speech_id: 'voice_reply_1',
          text: 'Vamos a comenzar la sesión.',
          voice: 'Kore',
          language: 'es-MX',
          style: 'Warm and conversational.',
          format: 'wav',
        }),
      });
      expect(response.ok).toBe(true);
      expect(response.headers.get('content-type')).toContain('audio/wav');
      expect(response.headers.get('x-speech-id')).toBe('voice_reply_1');
      expect(response.headers.get('x-speech-provider')).toBe('test-speech');
      expect(response.headers.get('x-audio-sample-rate')).toBe('24000');
      expect(response.headers.get('x-audio-duration-ms')).toBe('500');
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(
        new Uint8Array([82, 73, 70, 70, 1, 2, 3, 4]),
      );
      expect(received).toMatchObject({
        text: 'Vamos a comenzar la sesión.',
        voice: 'Kore',
        language: 'es-MX',
        style: 'Warm and conversational.',
        format: 'wav',
      });

      const invalid = await fetch(`${base}/v1/runtime/speech`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer speech-test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: '' }),
      });
      expect(invalid.status).toBe(400);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close(error => error ? reject(error) : resolve()));
    }
  });
});

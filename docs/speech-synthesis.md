# Speech synthesis

EGO converts one completed text response into playable audio:

```http
POST /v1/runtime/speech
Authorization: Bearer <INTERNAL_RUNTIME_TOKEN>
Content-Type: application/json

{
  "speech_id": "voice_reply_42",
  "text": "Vamos a comenzar con una explicación breve.",
  "voice": "Kore",
  "language": "es-MX",
  "style": "Warm, clear, conversational, and concise.",
  "format": "wav"
}
```

`speech_id` is optional correlation metadata and does not imply durable deduplication. `voice`, `language`, `style` and `format` are optional. The default output is WAV.

## Binary response

The response body is audio, not JSON:

```http
200 OK
Content-Type: audio/wav
Cache-Control: no-store
X-Speech-Id: voice_reply_42
X-Speech-Provider: gemini
X-Audio-Sample-Rate: 24000
X-Audio-Channels: 1
X-Audio-Duration-Ms: 4360

<binary WAV body>
```

These metadata headers are exposed through CORS. A browser can use `response.blob()` and play the resulting object URL directly.

Set `format` to `pcm` for raw signed 16-bit little-endian PCM. WAV is recommended for ordinary playback.

## Gemini adapter

```dotenv
SPEECH_SYNTHESIS_PROVIDER=gemini
EGO_TTS_MODEL=gemini-3.1-flash-tts-preview
EGO_TTS_VOICE=Kore
MAX_SPEECH_TEXT_CHARS=8000
SPEECH_SYNTHESIS_TIMEOUT_MS=120000
```

The adapter adds a valid WAV header to Gemini's PCM result. It performs one bounded retry when a preview model returns no audio or the API responds with 429/5xx.

Gemini provides multiple prebuilt voices. The runtime accepts a provider-neutral voice identifier; unsupported names are rejected by the selected provider.

## Smoke test

```bash
EGO_SPEECH_SMOKE_OUTPUT=/tmp/voice.wav npm run smoke:speech
```

The command prints metadata but never prints the API key or audio content.

## Privacy

The endpoint does not log or persist the requested text or generated audio. Responses use `Cache-Control: no-store`.

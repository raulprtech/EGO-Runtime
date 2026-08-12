# Audio transcription

EGO exposes provider-neutral transcription for completed voice turns:

```http
POST /v1/runtime/transcriptions?language=es-MX&diarization=false
Authorization: Bearer <INTERNAL_RUNTIME_TOKEN>
Content-Type: audio/webm
X-Transcription-Id: voice_turn_42

<binary audio body>
```

`language` is an optional BCP-47 hint. `diarization=true` requests stable speaker labels. `X-Transcription-Id` is an optional correlation identifier; it does not imply durable deduplication.

## Response

```json
{
  "transcription_id": "voice_turn_42",
  "provider": "gemini",
  "text": "Quiero estudiar este documento.",
  "detected_language": "es-MX",
  "duration_ms": 1840,
  "segments": [
    {
      "start_ms": 0,
      "end_ms": 1840,
      "speaker": "Speaker 1",
      "text": "Quiero estudiar este documento.",
      "language": "es-MX"
    }
  ]
}
```

Segment timestamps and duration are best-effort provider output. The complete `text` field is always present.

## Accepted media

- WAV: `audio/wav`, `audio/x-wav`
- MP3: `audio/mp3`, `audio/mpeg`
- AIFF: `audio/aiff`, `audio/x-aiff`
- AAC, OGG and FLAC
- M4A/MP4 audio: `audio/mp4`
- browser MediaRecorder: `audio/webm`

The body limit defaults to 10 MiB through `MAX_AUDIO_BYTES`, below Gemini's 20 MB inline request limit. `TRANSCRIPTION_TIMEOUT_MS` defaults to 120 seconds.

## Provider model

Transcription has its own `TranscriptionProvider` port. The bundled `gemini` adapter uses inline audio and structured output. Select it with:

```dotenv
TRANSCRIPTION_PROVIDER=gemini
EGO_TRANSCRIPTION_MODEL=gemini-3.5-flash
```

Run a real smoke test with an existing recording:

```bash
EGO_TRANSCRIPTION_SMOKE_FILE=/absolute/path/voice.wav npm run smoke:transcription
```

## Realtime boundary

This endpoint handles one completed audio turn per request. It is not streaming speech recognition. A future realtime provider can implement the same domain result contract, while a streaming transport would be versioned separately.

Audio bytes and transcripts are not logged or persisted by this endpoint.

# Architecture

EGO is a local-first learning runtime invoked through a stable HTTP contract. External orchestration and client layers are optional consumers, not runtime dependencies.

## Ports and adapters

- **Runtime repository port:** jobs, events, leases, practice, attempts and mastery.
  - `local`: atomic JSON state plus local artifacts.
  - `cloud`: Firestore state with GCS artifacts.
- **Model provider port:** schema-constrained structured generation.
  - `gemini-adk`: bundled hackathon adapter using Google ADK and Gemini.
  - Other providers can implement the same interface without changing agents or domain services.
- **Speech synthesis provider port:** converts completed response text into WAV or raw PCM for immediate playback.
  - `gemini`: bundled Gemini 3.1 Flash TTS Preview adapter.
  - Output voice, language and performance style remain request-level options.
- **Transcription provider port:** converts a completed binary audio turn into normalized text and timestamped segments.
  - `gemini`: bundled inline-audio adapter using the Gemini API.
  - Streaming speech recognition can use another adapter and a separately versioned transport.
- **Work delivery:**
  - `local`: in-process asynchronous execution with restart recovery.
  - `cloud`: durable Cloud Tasks delivery.
- **API:** validation, idempotency, jobs, events, cancellation and assessment.
- **Learning workflow:** document analysis, planning, retrieval practice, grading and mastery updates.

## Workflow

```text
execute -> dispatch -> exclusive claim -> extract -> concept map -> study plan
        -> practice package -> mastery state -> artifacts -> completed
                                      |
                                      +-> assess -> attempt -> next review
```

## Local trust boundary

A local input must use a `file://` URI and resolve inside `LOCAL_INPUT_ROOT`, including after symlink resolution. Runtime state is written with owner-only file permissions under `LOCAL_DATA_DIR`.

## Cloud trust boundary

The cloud adapter accepts `gs://` sources, applies bucket allow-lists and uses platform IAM. Deployment infrastructure remains outside this repository.

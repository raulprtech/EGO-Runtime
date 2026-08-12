# EGO Runtime

EGO is an open-source, model-agnostic learning-agent runtime. It turns user-provided papers and documents into a grounded learning package that evolves over repeated study attempts.

The included hackathon adapter uses Google Agent Development Kit and Gemini. Agents and learning-domain services depend only on the structured-generation port, so additional model providers can be added without changing the workflow.

Account-specific deployment topology and proprietary client or orchestration code intentionally live outside this repository.

## Implemented vertical slice

1. Accept an idempotent learning request.
2. Read allow-listed local files in local mode or verified GCS objects through the cloud adapter.
3. Generate a source-grounded concept map and mastery plan.
4. Produce a focused session, Feynman prompt, flashcards and short-answer quiz.
5. Persist artifacts, sequenced events and an initial mastery state.
6. Transcribe completed voice turns through a provider-neutral audio endpoint.
7. Synthesize response text into WAV or PCM through an independent speech provider.
8. Grade later quiz responses and update confidence and review dates.
9. Recover unfinished local jobs after process restarts.
10. Support Cloud Tasks, Firestore leases and GCS when the cloud backend is selected.

## Run locally

Local mode needs Node 22.3+ and a key for the configured model provider. It does not need Firestore, GCS, Application Default Credentials or Cloud Tasks.

```bash
cp .env.example .env
# Add GEMINI_API_KEY to .env
npm ci --legacy-peer-deps
npm run lint
npm test
npm run dev
```

In another terminal, run the included file-based workflow:

```bash
npm run demo
```

Local state and generated artifacts are written under `.ego-runtime/`. Inputs must be inside `LOCAL_INPUT_ROOT`; symlinks and paths that escape that root are rejected.

## Provider extension

`ModelProvider` is the stable structured-generation boundary. `TranscriptionProvider` independently defines speech-to-text. The bundled hackathon adapters use Gemini, while future providers can be registered without changing agents, learning-domain services or the HTTP audio contract.

See [local development](docs/local-development.md), [turn-based audio](docs/turn-based-audio.md), [audio transcription](docs/audio-transcription.md), [speech synthesis](docs/speech-synthesis.md), [process protocol](docs/process-protocol.md), [API](docs/api.md), [architecture](docs/architecture.md), [control-plane integration](docs/control-plane-integration.md), [cloud E2E](docs/cloud-e2e.md), and the neutral [deployment contract](docs/deployment-contract.md).

## Security

EGO rejects arbitrary remote URLs, confines local inputs to a configured root, restricts cloud inputs to configured buckets, verifies optional hashes, validates all model outputs, keeps answer keys outside learner artifacts and uses constant-time application-token comparison.

## Status

Version 0.6 is a local-first, turn-based audio hackathon vertical slice. Scheduling, richer tutoring conversations, adaptive question generation and production-scale retrieval remain planned extensions.

## License

Apache-2.0.

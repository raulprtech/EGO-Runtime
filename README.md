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

Local mode needs Node 22.3+. Gemini requires its API key; the deterministic demo provider runs without credentials. Neither path needs Firestore, GCS, Application Default Credentials or Cloud Tasks.

```bash
cp .env.example .env
# Add GEMINI_API_KEY, or set MODEL_PROVIDER=deterministic-demo for the local demo
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

Assessment requests may declare a BCP47 language. The runtime returns the declared language, bounded per-question scores and updated mastery. Raw learner responses are used transiently for grading but are not retained in local or Firestore attempt records; durable state contains only response count, digest, scores and mastery.

The credential-free provider uses the versioned `deterministic-bilingual-v1` assessment baseline. Results include matched/missing elements and explicit mastery, partial-match, uncertainty or insufficient-evidence reasons. Its reviewed Spanish/English aliases cover the current Nigma demonstration only; this deterministic fallback is not an open-domain semantic grader.

## Provider extension

`ModelProvider` is the stable structured-generation boundary. `TranscriptionProvider` independently defines speech-to-text. The bundled adapters include Gemini+ADK and a credential-free deterministic demo provider; future providers can be registered without changing agents, learning-domain services or the HTTP audio contract.

See [local development](docs/local-development.md), [Nigma handoff](docs/nigma-handoff.md), [Nigma host orchestration](docs/nigma-host-orchestration.md), [F4.6 host events](docs/f4.6-runtime-neutral-host-events-result-2026-08-14.md), [deterministic demo provider](docs/deterministic-demo-provider.md), [turn-based audio](docs/turn-based-audio.md), [process protocol](docs/process-protocol.md), [API](docs/api.md), [architecture](docs/architecture.md), [control-plane integration](docs/control-plane-integration.md), [execution integrity](docs/execution-integrity.md), [cloud E2E](docs/cloud-e2e.md), and the neutral [deployment contract](docs/deployment-contract.md).

G1.1 adds a host-independent educational decision adapter. `POST /v1/runtime/nigma/educational-tasks/prepare` forwards only objective and bounded local material references, validates Nigma's sealed route and returns a compact human-review projection. It never approves or executes; the existing `/host-runs` resumes only after Nigma independently confirms an exact current approval. G1.2 persists each transition atomically and exposes authenticated state and cursor-based event reads that survive a local restart without retaining learner context or secrets. G1.3 derives eligible pre-acceptance failures from that sealed record and asks Nigma for a new, separately approvable route; it never substitutes a runtime after acceptance. G1.5 verifies Nigma's selected/runner-up explanation and projects scores, factor deltas and `human_approval_required` without receiving authority. See [G1.1](docs/g1.1-nigma-host-decision-adapter-result-2026-08-14.md), [G1.2](docs/g1.2-durable-host-observability-result-2026-08-14.md), [G1.3](docs/g1.3-runtime-competition-fallback-result-2026-08-14.md) and [G1.5](docs/g1.5-runtime-decision-explanation-result-2026-08-14.md).

## Security

EGO rejects arbitrary remote URLs, confines local inputs to a configured root, restricts cloud inputs to configured buckets, verifies optional hashes, validates all model outputs, keeps answer keys outside learner artifacts and uses constant-time application-token comparison.

## Status

Version 0.9 adds the runtime-neutral host-run identity and eight-event lifecycle on top of the host-owned Nigma orchestration loop. G1.2 makes those traces durable, integrity-checked and readable after restart; distributed scheduling remains planned. The strict runtime adapter and credential-free deterministic provider remain available for local integration tests. F5.2 assessment integration declares the requested language and removes raw learner responses from durable attempts; see [the F5.2 result](docs/f5.2-learning-assessment-result-2026-08-14.md). Richer tutoring conversations, adaptive question generation and production-scale retrieval remain planned extensions.

F5.3 adds local cooperative cancellation for sealed Nigma invocations. EGO reports `cancelling` until its worker drains, removes partial artifact files and records, then exposes a cancelled receipt with the exact Nigma cancellation reference and durable rollback evidence. Cloud cancellation remains fail-closed and unimplemented. See [the F5.3 result](docs/f5.3-runtime-cancellation-result-2026-08-14.md).

## License

Apache-2.0.

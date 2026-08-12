# Architectural decisions

1. **Local-first execution.** Development and desktop use require only the runtime process, local storage and a configured model provider.
2. **Model-provider port.** Agents request validated structured generation through a provider-neutral interface. Gemini+ADK is an adapter, not a domain dependency.
3. **Dual persistence adapters.** Atomic JSON persistence supports one local runtime process; Firestore supports distributed cloud execution.
4. **Backend-specific delivery.** Local work runs asynchronously in-process and is recovered on restart. Cloud work uses named Cloud Tasks.
5. **Exclusive execution.** Local active-job ownership and cloud transactional leases prevent duplicate concurrent work.
6. **Constrained artifact sources.** Local files must remain under `LOCAL_INPUT_ROOT`; cloud objects must come from allow-listed GCS buckets.
7. **Separated learner and evaluator data.** Public practice artifacts omit answer keys; grading material remains private runtime state.
8. **Turn-based audio boundary.** Version 0.5 accepts completed audio turns synchronously. Realtime streaming requires a separately versioned transport, while normalized transcription results remain provider-neutral.
9. **Ephemeral transcription.** Raw audio and transcripts are not logged or persisted by the transcription endpoint.
10. **Neutral integration contract.** Proprietary orchestration, client and deployment implementations are intentionally outside this repository.

# Architectural decisions

1. **Local-first execution.** Development and desktop use require only the runtime process, local storage and a configured model provider.
2. **Model-provider port.** Agents request validated structured generation through a provider-neutral interface. Gemini+ADK is an adapter, not a domain dependency.
3. **Dual persistence adapters.** Atomic JSON persistence supports one local runtime process; Firestore supports distributed cloud execution.
4. **Backend-specific delivery.** Local work runs asynchronously in-process and is recovered on restart. Cloud work uses named Cloud Tasks.
5. **Exclusive execution.** Local active-job ownership and cloud transactional leases prevent duplicate concurrent work.
6. **Constrained artifact sources.** Local files must remain under `LOCAL_INPUT_ROOT`; cloud objects must come from allow-listed GCS buckets.
7. **Separated learner and evaluator data.** Public practice artifacts omit answer keys; grading material remains private runtime state.
8. **Turn-based audio boundary.** Version 0.6 accepts completed audio turns and returns completed speech responses synchronously. Realtime streaming requires a separately versioned transport.
9. **Independent speech ports.** Transcription and synthesis providers can evolve separately from learning models and from each other.
10. **Ephemeral voice data.** Raw audio, transcripts, synthesis text and generated speech are not logged or persisted by voice endpoints.
11. **Neutral integration contract.** Proprietary orchestration, client and deployment implementations are intentionally outside this repository.
12. **Declarative runtime discovery.** EGO publishes a versioned manifest of implemented capabilities and relative entrypoints. External control planes select runtimes; deployment systems only make instances reachable.
13. **Runtime-owned Nigma policy.** Nigma proposes an immutable route, but EGO independently admits only exact plugin, provider, binding, permission and input combinations configured by the runtime owner.
14. **Deterministic fallback is evidence infrastructure.** The credential-free provider proves transport, grounding, persistence, receipts and replay locally; it does not claim semantic parity with Gemini or replace model-backed tutoring evaluation.

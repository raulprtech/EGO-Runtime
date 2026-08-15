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

15. **Host-owned runtime routing.** Nigma selects an exact runtime identity/version; the host operator owns endpoints and credentials. The control-plane envelope cannot redirect transport.
16. **Bounded synchronous reference loop.** EGO 0.8 proves invocation-to-experience feedback synchronously for local integration. Durable long-running orchestration requires a later asynchronous host-run contract.
17. **Transient learner answers.** Assessment answers are passed to the grading provider but are not durable attempt state. Local and Firestore records retain only a response count and digest plus bounded scores/mastery, while answer keys remain private runtime state.
18. **Explicit response language.** Assessment requests may carry one BCP47 language through the provider boundary, and responses declare that language so hosts can audit consistency without interpreting prose.
19. **Versioned deterministic grading.** The credential-free grader publishes its calibration identity and per-item reason codes. Its bilingual alias set is frozen in fixtures and intentionally bounded; scores from different calibration versions must not be silently compared.
20. **Content-free durable host evidence.** EGO persists host state atomically and seals it with SHA-256, but retains only identities, lifecycle events, sanitized failures and artifact references. Raw learner context, material content, idempotency keys and credentials remain outside the record.
21. **Fallback creates new authority.** A pre-acceptance host failure may ask Nigma for another candidate, but EGO never substitutes an executor under the old approval. Failure after runtime acceptance is ineligible because it could duplicate work.
22. **Human approval is a separate capability.** The normal runtime bearer token cannot record an approval. A trusted adapter must also present a distinct high-entropy credential and the exact phrase bound to a server-side sealed challenge. Recording approval and executing remain separate operations.
23. **Approval challenges fail closed on storage permissions.** Restart recovery retains only exact identities, target, phrase hash and timestamps in a `0600` file. Filesystems that cannot enforce owner-only mode are rejected instead of silently weakening the human-decision boundary.

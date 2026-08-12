# Architectural decisions

1. **Official Google ADK for TypeScript.** Agent execution uses `@google/adk`; Zod validates every structured response.
2. **Firestore durability.** Jobs, nested events, leases, attempts and mastery state are persisted outside disposable compute instances.
3. **Cloud Tasks delivery.** Production rejects in-memory background execution. Named tasks make ambiguous dispatch retries idempotent.
4. **Exclusive worker leases.** A transaction claims each job and prevents concurrent delivery from executing it twice.
5. **GCS-only inputs.** Arbitrary HTTPS retrieval is rejected. Deployments control allowed buckets and service-account permissions.
6. **Separated learner and evaluator data.** Public practice artifacts omit answer keys; grading material remains in an internal job subcollection.
7. **Neutral integration contract.** Proprietary orchestration, client and deployment implementations are intentionally outside this repository.

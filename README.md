# EGO Runtime

EGO is an open-source learning-agent runtime built with Google Agent Development Kit for TypeScript. It turns user-provided papers and documents into a grounded learning package that can be managed over repeated study attempts.

Account-specific deployment topology and proprietary client or orchestration code intentionally live outside this repository.

## Implemented vertical slice

1. Accept an idempotent learning request.
2. Verify and extract allow-listed PDF, text or Markdown objects from Google Cloud Storage.
3. Generate a source-grounded concept map and mastery plan with ADK and Gemini 3.5.
4. Produce a focused session, Feynman prompt, flashcards and short-answer quiz.
5. Persist artifacts, sequenced events and an initial mastery state.
6. Grade later quiz responses and update confidence and review dates.
7. Use Cloud Tasks, transactional dispatch recovery and exclusive worker leases in production.

## Local development

Requires Node 22.3+, a Gemini key, Google Application Default Credentials, Firestore and GCS buckets.

```bash
cp .env.example .env
npm ci --legacy-peer-deps
npm run lint
npm test
npm run dev
```

See [API](docs/api.md), [architecture](docs/architecture.md), [control-plane integration](docs/control-plane-integration.md), [cloud E2E](docs/cloud-e2e.md), and the neutral [deployment contract](docs/deployment-contract.md).

## Security

EGO rejects arbitrary remote URLs, restricts GCS inputs to configured buckets, verifies object metadata and optional hashes, validates model outputs, keeps answer keys outside learner artifacts and uses constant-time application-token comparison. Production deployments should also enforce platform IAM.

## Status

Version 0.3 is a hackathon-oriented vertical slice. Scheduling, richer tutoring conversations, adaptive question generation and production-scale retrieval remain planned extensions.

## License

Apache-2.0.

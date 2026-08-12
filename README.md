# EGO Runtime

EGO is an open-source learning-agent runtime built with Google Agent Development Kit for TypeScript. It turns user-provided papers and documents into a source-grounded concept map and a structured mastery plan.

EGO intentionally contains no account-specific deployment topology and no private Nigma or ARIA code. Production infrastructure lives in a separate deployment repository.

## Implemented vertical slice

1. Receive an idempotent learning request.
2. Read allow-listed PDF, text, or Markdown objects from Google Cloud Storage.
3. Verify object size, MIME type and optional SHA-256.
4. Extract document text.
5. Run ADK Document Analyzer and Learning Planner agents on Gemini 3.5.
6. Validate their structured output with Zod.
7. Upload the concept map and study plan to GCS.
8. Persist job state and sequenced events in Firestore.

Cloud Tasks is supported through environment configuration; local development runs synchronously.

## Local development

Requires Node 22.3+, a Gemini key, Google Application Default Credentials, Firestore, and two GCS buckets.

```bash
cp .env.example .env
npm ci --legacy-peer-deps
npm run lint
npm test
npm run dev
```

API documentation is in [docs/api.md](docs/api.md), architecture in [docs/architecture.md](docs/architecture.md), and deployment contracts in [docs/deployment-contract.md](docs/deployment-contract.md).

## Security

EGO rejects arbitrary HTTPS artifacts, restricts GCS inputs to configured buckets, verifies metadata, uses constant-time bearer-token comparison, and scopes events below each job. Production deployments should additionally place Cloud Run behind IAM and private ingress.

## Status

Version 0.2 is a hackathon-oriented vertical slice. Flashcards, quizzes, Feynman conversations, mastery tracking and ARIA/Nigma adapters are planned extensions rather than advertised capabilities.

## License

Apache-2.0.

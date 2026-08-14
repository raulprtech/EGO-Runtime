# Deterministic demo provider

`MODEL_PROVIDER=deterministic-demo` runs the complete local learning workflow without an API key or model download. It is intended for integration tests, offline demonstrations and recovery when validating transport or persistence.

The provider uses bounded rules to:

- extract concepts from Markdown headings or short source sentences;
- create 25-minute study sessions and a 1/3/7-day review cadence;
- generate three source-linked flashcards and retrieval questions;
- grade literal concept-token overlap for the generated answer keys.

All results still pass the same Zod domain schemas and source-reference checks as model-backed output. No network, credential, GPU or language model is used.

This mode is not a substitute for Gemini's semantic reasoning or pedagogical quality. It should be visibly labelled in a product demo and must not be used to claim that nuanced free-text answers were intelligently assessed.

```dotenv
RUNTIME_BACKEND=local
MODEL_PROVIDER=deterministic-demo
```

The ordinary `npm run demo` and the Nigma handoff then work with only local files.

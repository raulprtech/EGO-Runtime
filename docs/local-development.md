# Local development

Local mode is the default outside production and is selected explicitly with:

```dotenv
RUNTIME_BACKEND=local
LOCAL_INPUT_ROOT=.
LOCAL_DATA_DIR=.ego-runtime
MODEL_PROVIDER=gemini-adk
EGO_MODEL=gemini-3.5-flash
```

Only the selected provider credentials are required. The bundled hackathon adapter reads `GEMINI_API_KEY` or `GOOGLE_API_KEY`.

Execution approval is disabled locally unless `REQUIRE_EXECUTION_APPROVAL=true`. When enabled, configure `EXECUTION_APPROVAL_SECRET`. Configure the independent `RESULT_RECEIPT_SECRET` to issue terminal signed receipts. Generate both as distinct high-entropy secrets and keep them out of client applications.

## Start

```bash
cp .env.example .env
npm ci --legacy-peer-deps
npm run dev
```

Run `npm run smoke:model` to verify the configured provider with a minimal structured response. Then run `npm run demo` from a second terminal. The demo submits `examples/source.md` with a `file://` URI and follows durable events until completion.

## Storage layout

```text
.ego-runtime/
  state.json
  artifacts/
    <request-id>/
      <artifact-id>/
```

`state.json` is written through atomic replacement and contains jobs, events, evaluator-only practice data, attempts and mastery. The local adapter targets one runtime process. Use the cloud adapter for distributed workers.

## Input confinement

The runtime resolves both `LOCAL_INPUT_ROOT` and each input through the filesystem before reading. Inputs outside the root, including symlink escapes, are rejected. Generated files always remain under `LOCAL_DATA_DIR`.

## Add a model provider

Implement `ModelProvider` from `src/runtime/model_provider.ts`, validate responses through the supplied Zod schema, and register the adapter in `getModelProvider`. Agents and the learning workflow require no changes.

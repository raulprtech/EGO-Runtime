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

The optional Nigma human-decision adapter requires
`NIGMA_HUMAN_DECISION_TOKEN`. Generate at least 32 random characters, keep it
separate from `INTERNAL_RUNTIME_TOKEN`, and expose it only to the trusted
conversation/UI adapter that captures an explicit owner decision. Never place
it in model context or a mobile bundle.

The optional Hermes conversation sidecar additionally reads
`HERMES_CHAT_URL`, `HERMES_CHAT_API_KEY`, `EGO_RUNTIME_URL` and
`EGO_RUNTIME_TOKEN`. These are process-owned transport settings; they must not
be sent to a model, stored in ARIA or written into its sealed binding. See the
[sidecar guide](hermes-decision-sidecar.md).

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
  nigma-human-approval-challenges/
    <host-preparation-id>.json
  artifacts/
    <request-id>/
      <artifact-id>/
```

`state.json` is written through atomic replacement and contains jobs, events, evaluator-only practice data, attempts and mastery. The local adapter targets one runtime process. Use the cloud adapter for distributed workers.

Human-approval challenge files contain identities, hashes, the exact approval
target and bounded timestamps, but no objective, materials or raw phrase. EGO
requires owner-only `0600` file permissions and fails closed on filesystems
that cannot enforce them. Use a Linux filesystem or an equivalently protected
deployment volume; DrvFS-mounted Windows directories are not suitable for this
store.

## Input confinement

The runtime resolves both `LOCAL_INPUT_ROOT` and each input through the filesystem before reading. Inputs outside the root, including symlink escapes, are rejected. Generated files always remain under `LOCAL_DATA_DIR`.

## Add a model provider

Implement `ModelProvider` from `src/runtime/model_provider.ts`, validate responses through the supplied Zod schema, and register the adapter in `getModelProvider`. Agents and the learning workflow require no changes.

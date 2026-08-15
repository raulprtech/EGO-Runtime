# Nigma host orchestration

EGO 0.9 can act as a reference host runtime for an already approved Nigma plan. The host requests the immutable invocation, routes it to an exact runtime identity/version, waits for a terminal state, retrieves the bounded receipt and posts that receipt back to Nigma.

## Prepare and present before approval

The neutral host can prepare an educational route without Hermes and without receiving approval authority:

```http
POST /v1/runtime/nigma/educational-tasks/prepare
Authorization: Bearer <host-runtime-token>
Idempotency-Key: <stable-preparation-key>
Content-Type: application/json

{
  "objective": "Create a bounded study plan",
  "materials": [{ "uri": "file:///controlled/course/notes.md" }]
}
```

The response uses `nigma.host-preparation/v1` and contains a compact plan/runtime summary, the exact plan/route/plugin/provider approval target and the fixed `/v1/runtime/nigma/host-runs` resume path. It is always `awaiting_human_approval`; EGO has no endpoint that records the decision. A trusted actor must submit the exact approval to Nigma separately. Calling the resume endpoint before that decision, after expiry or after any sealed-link change fails before runtime routing.

This endpoint never creates an approval and never accepts an invocation supplied by the caller:

```http
POST /v1/runtime/nigma/host-runs
Authorization: Bearer <host-runtime-token>
Idempotency-Key: <stable-run-key>
Content-Type: application/json

{
  "plan_id": "approved-nigma-plan-id",
  "learner_context": {
    "user_id": "learner-id",
    "session_id": "session-id",
    "objective_id": "objective-id"
  }
}
```

Nigma must return an invocation generated from a current exact human approval. If it returns `approval_required`, the host stops before contacting any runtime.

## Runtime-owned routes

The host reads `NIGMA_HOST_ROUTES_FILE`. Each entry binds one exact `runtime_id@runtime_version` to an operator-controlled base URL and the name of an environment variable containing that runtime's credential. Nigma never supplies either value.

```json
{
  "protocol_version": "nigma.host-routes/v1",
  "routes": [
    {
      "runtime_id": "ego-runtime",
      "runtime_version": "0.9.0",
      "base_url": "http://127.0.0.1:3000/v1/runtime",
      "credential_env": "NIGMA_RUNTIME_TOKEN_EGO"
    }
  ]
}
```

Only HTTPS and loopback HTTP URLs are accepted. URLs with embedded credentials, query strings or fragments fail closed. Route identities cannot repeat, credential environment names must use the `NIGMA_RUNTIME_TOKEN_` prefix and secrets never enter responses or logs.

Required configuration:

```dotenv
NIGMA_CONTROL_PLANE_URL=http://127.0.0.1:8000
NIGMA_CONTROL_PLANE_API_KEY=<host-to-nigma-secret>
NIGMA_HOST_ROUTES_FILE=config/nigma-host-routes.example.json
NIGMA_RUNTIME_TOKEN_EGO=<host-to-runtime-secret>
```

`NIGMA_HOST_TIMEOUT_MS` is bounded to 1–120 seconds and defaults to 30 seconds. A host timeout does not manufacture a failure receipt or cancel an otherwise valid runtime job. A retry with the same plan, learner context and `Idempotency-Key` resumes through Nigma's invocation idempotency, EGO's mapped-request idempotency and Nigma's receipt reconciliation.

## Neutral progress result

EGO returns `protocol_version=nigma.host-run-result/v1`, a stable `host_run_id`
and the ordered `nigma.host-event/v1` lifecycle:

`request_received → invocation_authorized → runtime_routed → runtime_accepted → runtime_terminal → receipt_observed → receipt_recorded → run_completed`.

Every event is now written atomically before the next external transition. The
host record uses `nigma.host-run-record/v1`, is sealed by `record_digest` and is
stored at `LOCAL_DATA_DIR/nigma-host-runs/<host_run_id>.json` with owner-only
directory/file permissions. It contains only plan and integrity identities,
bounded lifecycle evidence, content-free artifact references and a sanitized
failure code/message. It never stores the idempotency key, learner identifiers,
runtime credentials, control-plane credentials or educational content.

Authenticated readers can recover terminal or partial progress after an EGO
restart:

```http
GET /v1/runtime/nigma/host-runs/<host_run_id>
Authorization: Bearer <host-runtime-token>
```

Incremental consumers can request only events after a previously observed
sequence:

```http
GET /v1/runtime/nigma/host-runs/<host_run_id>/events?after=4
Authorization: Bearer <host-runtime-token>
```

The response uses `nigma.host-event-page/v1` and includes `next_cursor`, current
status and the record digest. Invalid IDs, path-like IDs, invalid cursors,
schema corruption and digest mismatches fail closed. Reusing one host
idempotency identity with changed learner routing context also fails before any
upstream call. Exact retry retains the existing Nigma/EGO idempotent transport,
appends a new numbered attempt and never overwrites prior evidence.

Runtime replay marks `runtime_accepted.replayed=true`. Events contain no URL,
credential or environment-variable name. Nigma's independent offline verifier
and JSON-stdio fixture define the replaceable boundary; EGO is only its first
live implementation.

## Current limitation

The execution request remains synchronous and intended for local integration;
durable records make it observable and auditable but do not yet provide a
restartable distributed scheduler. A process loss during an active transition
requires an exact idempotent retry. Remote deployment also requires platform
service authentication or a signed-envelope protocol; SHA-256 alone
authenticates no sender.

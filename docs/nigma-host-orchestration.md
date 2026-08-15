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
  "materials": [{ "uri": "file:///controlled/course/notes.md" }],
  "presentation_locale": "en-US"
}
```

The response uses `nigma.host-preparation/v1` and contains a compact plan/runtime summary, the exact plan/route/plugin/provider approval target and the fixed `/v1/runtime/nigma/host-runs` resume path. It is always `awaiting_human_approval`; EGO has no endpoint that records the decision. A trusted actor must submit the exact approval to Nigma separately. Calling the resume endpoint before that decision, after expiry or after any sealed-link change fails before runtime routing.

G1.5 optionally adds `runtime_decision`: selected and runner-up scores in integer
millionths, their margin, factor deltas, evidence basis and bounded reason codes.
EGO recalculates Nigma's explanation digest and verifies its exact selection and
snapshot links before projecting it. Historical preparations without the field
remain valid; an altered present explanation fails with 502. The projection is
always marked `human_approval_required`, `approval_granted=false` and
`execution_performed=false`.

G1.6 adds `runtime_decision.presentation`, a deterministic host-owned rendering
of the verified object. Supported locales are `es-MX` (default) and `en-US`.
EGO removes `presentation_locale` before forwarding the request to Nigma. The
presentation has a separate digest/ID, links the exact source explanation and
is always `informational_only`; changing locale changes only the host view and
host preparation ID, not the Nigma plan, selection or approval target.

Fallback preparation keeps its body empty. A caller may set
`X-Presentation-Locale: en-US`; omitting the header uses `es-MX`. Unsupported
locales fail validation before Nigma is contacted.

G1.7 adds `interface_projection` when the verified G1.6 presentation is
available. Its own digest binds the exact preparation/presentation and three
generic events: `tool.started`, `tool.completed` and `assistant.completed`.
The final text includes the localized review plus the exact approval phrase but
remains `human_decision_required`, `approval_recorded=false` and
`execution_performed=false`.

To receive the same sealed events as an SSE stream, explicitly add:

```http
Accept: text/event-stream
```

The server returns `X-Nigma-Projection-Digest` and does not treat a generic
`*/*` request as SSE. Historical preparations without a verified explanation
remain readable as JSON; an explicit SSE request for one fails with 406 instead
of manufacturing presentation text.

## Record an exact human decision

G1.8 gives a trusted host/UI adapter a narrow approval-write path without
giving the model or normal runtime bearer token approval authority:

```http
POST /v1/runtime/nigma/human-approvals
Authorization: Bearer <host-runtime-token>
X-Nigma-Human-Decision-Token: <independent-human-channel-secret>
Idempotency-Key: <stable-human-decision-key>
Content-Type: application/json

{
  "protocol_version": "nigma.trusted-human-approval-submission/v1",
  "host_preparation_id": "host-preparation-...",
  "interface_projection_id": "host-preparation-interface-...",
  "interface_projection_digest": "<64-hex>",
  "approval_phrase": "<exact phrase displayed to the human>",
  "approver": "local-owner",
  "expires_at": "<absolute ISO-8601 timestamp>"
}
```

Preparation persists an owner-only sealed challenge for two hours. It contains
only identities, the exact approval target, phrase SHA-256 and timestamps; raw
objective, materials and phrase are absent. The approval endpoint reloads this
challenge after restart and rejects missing/expired challenges, changed
projection links, altered phrases, invalid expiries, missing idempotency and a
human credential equal to the runtime credential.

On success EGO asks Nigma to record the exact approval, verifies Nigma's full
response and returns a separately sealed record. It does not request an
invocation, contact a selected runtime or execute. A later `/host-runs` call is
still required and Nigma remains authoritative for approval validity.

### Conversation adapter

A host that already authenticates conversation actors may use the narrower
conversation-shaped input instead of copying fields into `/human-approvals`:

```http
POST /v1/runtime/nigma/conversation-decisions
Authorization: Bearer <host-runtime-token>
X-Nigma-Human-Decision-Token: <independent-human-channel-secret>
Idempotency-Key: <stable-message-decision-key>
Content-Type: application/json

{
  "protocol_version": "nigma.trusted-conversation-decision/v1",
  "host_preparation_id": "host-preparation-...",
  "interface_projection_id": "host-preparation-interface-...",
  "interface_projection_digest": "<64-hex>",
  "turn": {
    "role": "user",
    "origin": "externally_authenticated_human",
    "conversation_ref": "<host-opaque-reference>",
    "message_ref": "<host-opaque-reference>",
    "observed_at": "<ISO-8601 timestamp>",
    "content": "<exact approval phrase and nothing else>"
  },
  "approver": "local-owner",
  "expires_at": "<absolute ISO-8601 timestamp>"
}
```

The separate human credential is the technical trust boundary: it must remain
in the host adapter and outside model context. `role=user` is additionally
schema-enforced, the whole content must match the challenge exactly, and the
observation must occur after presentation. Nigma receives domain-separated
hashes rather than the raw conversation/message references. This is a neutral
port; it does not make EGO emulate Hermes chat APIs and requires no ARIA change.

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
NIGMA_HUMAN_DECISION_TOKEN=<independent-human-channel-secret>
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

## Safe runtime fallback

If a sealed host record ends before `runtime_accepted` with an eligible
unreachable, unavailable or rejected-runtime failure, an authenticated host
client may request a replacement:

```http
POST /v1/runtime/nigma/host-runs/<host_run_id>/fallbacks
Authorization: Bearer <host-runtime-token>
Idempotency-Key: <stable-fallback-key>
Content-Type: application/json

{}
```

The body must be empty. EGO derives failure code, observation time and evidence
digest from the durable record and sends only that evidence to Nigma. The
response presents a new exact plan and approval target with
`approval_granted=false` and `execution_performed=false`. It cannot resume
until a trusted actor separately approves the replacement in Nigma.

Fallback is refused after any `runtime_accepted` event, including later host
timeouts. At that point cancellation or exact retry/reconciliation is required
to avoid double execution.

## Current limitation

The execution request remains synchronous and intended for local integration;
durable records make it observable and auditable but do not yet provide a
restartable distributed scheduler. A process loss during an active transition
requires an exact idempotent retry. Remote deployment also requires platform
service authentication or a signed-envelope protocol; SHA-256 alone
authenticates no sender.

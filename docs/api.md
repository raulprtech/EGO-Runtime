# API reference

Base path: `/v1/runtime`.

All endpoints except `manifest` and the legacy `capabilities` endpoint require the configured application token. A platform IAM layer may additionally authenticate service identities.

## Endpoints

- `GET /manifest` — versioned runtime identity, protocol, capabilities, entrypoints and limits.
- `POST /approval-digest` — normalize a request and return the SHA-256 digest to approve.
- `GET /capabilities` — backward-compatible capability summary; new discovery clients should use `manifest`.
- `POST /execute` — create or safely redispatch an idempotent job.
- `POST /materials` — stage one authenticated PDF, DOCX, plain-text, Markdown or JSON learning material under `LOCAL_INPUT_ROOT`; requires encoded name/owner, exact media type and `Idempotency-Key` headers. Legacy `.doc` is not accepted.
- `GET /materials/:material_id` — recover and integrity-check an owner-bound active record or released tombstone.
- `DELETE /materials/:material_id` — remove material bytes idempotently while retaining a sealed release tombstone; it never approves or executes.
- `POST /nigma/invocations` — validate an approved Nigma route against the runtime-owned allow-list and submit it.
- `POST /nigma/educational-tasks/prepare` — obtain a verified pre-approval plan view as JSON, or its generic interface events with explicit `Accept: text/event-stream`.
- `POST /nigma/human-approvals` — record an exact, separately authenticated human approval for a persisted sealed preparation; never execute it.
- `POST /nigma/conversation-decisions` — map one externally authenticated human `user` turn to the exact approval adapter; model/tool roles cannot use it.
- `POST /nigma/conversation-executions` — accept a separately authenticated second exact human turn and resume only its sealed, already-approved plan.
- `GET /nigma/decision-events?profile=aria&limit=20` — read bounded, profile-scoped informational receipts for decisions and terminal executions already recorded; it cannot approve or execute.
- `POST /nigma/host-runs` — request an already-approved Nigma invocation, execute its exact runtime route and return the terminal receipt.
- `GET /nigma/host-runs/:host_run_id` — read a sealed durable host-run state and content-free artifact references.
- `GET /nigma/host-runs/:host_run_id/events?after=N` — read ordered host events after a bounded cursor.
- `POST /nigma/host-runs/:host_run_id/fallbacks` — derive a pre-acceptance failure from the sealed host record and request a separately approvable Nigma replacement.
- `GET /nigma/:invocation_id/receipt` — translate a terminal EGO job into a Nigma execution receipt.
- `POST /transcriptions` - transcribe one binary audio turn; see [audio transcription](audio-transcription.md).
- `POST /speech` - synthesize one JSON text response into WAV or PCM; see [speech synthesis](speech-synthesis.md).
- `POST /worker` — Cloud Tasks delivery endpoint.
- `POST /maintenance/reconcile` — redispatch pending jobs whose initial dispatch failed.
- `GET /:request_id` — sanitized public job state and artifact references.
- GET /:request_id/mastery — latest longitudinal concept confidence and review schedule.
- `GET /:request_id/receipt` — return a deterministic HMAC-signed terminal result receipt.
- `GET /:request_id/events?cursor=N` — durable ordered events after a cursor.
- `POST /:request_id/cancel` — cooperative cancellation.
- `POST /:request_id/assess` — grade quiz responses and update mastery.

## Nigma educational preparation

`POST /nigma/educational-tasks/prepare` accepts objective, bounded local
material references and an optional host-only `presentation_locale` (`es-MX`
or `en-US`). JSON responses contain `nigma.host-preparation/v1`, the exact
approval target, the verified runtime-decision presentation and the separately
sealed `nigma.host-preparation-interface/v1` projection.

With `Accept: text/event-stream`, the endpoint emits exactly
`tool.started`, `tool.completed` and `assistant.completed`. These frames are
presentation only: the projection is `human_decision_required` and cannot
record approval or execute. The locale is removed before the request reaches
Nigma.

## Trusted Nigma human approval

`POST /nigma/human-approvals` requires both the normal runtime bearer token and
`X-Nigma-Human-Decision-Token`. The latter must be configured through
`NIGMA_HUMAN_DECISION_TOKEN`, contain at least 32 characters and differ from
`INTERNAL_RUNTIME_TOKEN`. The request supplies the exact preparation/projection
identities, exact displayed approval phrase, bounded approver, absolute
`expires_at` and a stable `Idempotency-Key`.

EGO verifies those values against its owner-only sealed challenge and forwards
only the exact approval target plus phrase SHA-256 to Nigma. The challenge and
approval each expire within two hours; approval must remain valid for at least
one minute and cannot outlive the challenge. A successful response is
`nigma.trusted-human-approval-record/v1` with `approval_recorded=true` and
`execution_performed=false`. Execution remains a separate `/nigma/host-runs`
request and Nigma independently revalidates the current approval.

## Trusted conversation decision

`POST /nigma/conversation-decisions` uses the same two independent credentials
as `/nigma/human-approvals`. Its strict
`nigma.trusted-conversation-decision/v1` body identifies the sealed
preparation/projection and one turn with `role=user`,
`origin=externally_authenticated_human`, opaque conversation/message
references, observation time and content.

The complete turn content must equal the sealed approval phrase byte for byte;
prefixes, suffixes and normalization are not accepted. The observation must
fall within the presentation challenge window with at most 30 seconds of clock
skew. EGO hashes both opaque references with domain separation, forwards only
those hashes and seals `nigma.trusted-conversation-decision-record/v1`. Raw
conversation IDs, message IDs and message content are not retained in Nigma.
The result records approval only and always has `execution_performed=false`.
It also returns a separately bound `execution_authorization` whose exact phrase
must be supplied by a later human turn. After the verified result, EGO persists
one idempotent, integrity-sealed `nigma.decision-event/v2` and an owner-only
execution challenge under the interface profile supplied by the trusted
sidecar. `GET /nigma/decision-events` returns only `id`, `type`, `title`,
`content` and millisecond `timestamp`. It requires the runtime bearer but never
the human-decision credential because it is a read-only projection of completed
authority, not an authority endpoint. The durable record retains profile and
conversation references only as domain-separated SHA-256 values.

Existing `nigma.decision-event/v1` files remain readable and are never
rewritten. The v2 event explicitly states that execution has not begun and
contains the exact phrase required for the separate action.

## Trusted conversation execution

`POST /nigma/conversation-executions` requires both the normal runtime bearer
and the independent `X-Nigma-Human-Decision-Token`. Its
`nigma.trusted-conversation-execution/v1` body binds the original host
preparation, interface projection, approval identity/digest and exactly one
later externally authenticated human `user` turn.

EGO reloads the owner-only `0600` execution challenge and requires the same
interface profile and conversation, byte-exact phrase content, valid approval
window and bounded observation time. Raw phrase and conversation references
are not stored in the challenge. Learner identifiers are derived from
domain-separated hashes, and the host-run idempotency key is fixed by the
sealed approval challenge so repeated delivery cannot create another run.

Only after those checks does EGO call the existing host-run path. Nigma then
independently revalidates the approval before issuing an invocation. A terminal
result produces `nigma.trusted-conversation-execution-record/v1` and one
profile-scoped `Ejecución finalizada` event. The read-only event feed itself
still cannot start execution.

## Runtime manifest

`GET /manifest` is the stable discovery surface used by an external control plane to determine whether this runtime can execute a task. It returns relative entrypoints so deployment remains responsible for publishing the absolute base URL.

```json
{
  "manifest_version": "1.0",
  "runtime_id": "ego-runtime",
  "runtime_version": "0.8.0",
  "protocol": {
    "name": "ego-runtime-http",
    "version": 1,
    "base_path": "/v1/runtime"
  },
  "backend": "local",
  "supported_backends": ["local", "cloud"],
  "integrations": {
    "nigma": {
      "protocol": "nigma.runtime-handoff/v1",
      "supported": true,
      "configured": false,
      "host_orchestration_supported": true,
      "host_orchestration_configured": false
    }
  },
  "capabilities": ["education.study_plan", "audio.transcription"],
  "execution": {
    "asynchronous": true,
    "idempotent_submission": true,
    "durable_events": true,
    "approval_protocol": true,
    "result_receipts": true
  },
  "integrity": {
    "approval": { "algorithm": "hmac-sha256", "supported": true, "required": false, "configured": false },
    "result_receipt": { "algorithm": "hmac-sha256", "supported": true, "configured": false }
  }
}
```

Provider identifiers describe the active adapters; they are not model requirements. Unsupported protocol features are advertised as `false` rather than inferred by callers.

## Execute request

```json
{
  "request_id": "req_123",
  "user_id": "user_1",
  "session_id": "session_1",
  "objective_id": "objective_1",
  "message": "Master the supplied papers",
  "attachments": [
    {
      "id": "source_1",
      "name": "paper.pdf",
      "mime_type": "application/pdf",
      "uri": "file:///absolute/path/inside/LOCAL_INPUT_ROOT/paper.pdf",
      "sha256": "optional-64-character-hex-digest"
    }
  ]
}
```

A request whose `capabilities` contains values absent from the current manifest returns `422` with `UNSUPPORTED_CAPABILITIES` and the deduplicated unsupported values. An empty list remains valid for compatibility.

A successful submission returns `202` with `accepted`, `redispatched` or `already_accepted`. Local mode accepts `file://` inputs inside `LOCAL_INPUT_ROOT`; cloud mode accepts `gs://` inputs.

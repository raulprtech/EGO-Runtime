# API reference

Base path: `/v1/runtime`.

All endpoints except `manifest` and the legacy `capabilities` endpoint require the configured application token. A platform IAM layer may additionally authenticate service identities.

## Endpoints

- `GET /manifest` — versioned runtime identity, protocol, capabilities, entrypoints and limits.
- `POST /approval-digest` — normalize a request and return the SHA-256 digest to approve.
- `GET /capabilities` — backward-compatible capability summary; new discovery clients should use `manifest`.
- `POST /execute` — create or safely redispatch an idempotent job.
- `POST /nigma/invocations` — validate an approved Nigma route against the runtime-owned allow-list and submit it.
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

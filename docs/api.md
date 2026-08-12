# API reference

Base path: `/v1/runtime`.

All endpoints except `capabilities` require the configured application token. A platform IAM layer may additionally authenticate service identities.

## Endpoints

- `GET /capabilities` — implemented runtime capabilities.
- `POST /execute` — create or safely redispatch an idempotent job.
- `POST /worker` — Cloud Tasks delivery endpoint.
- `POST /maintenance/reconcile` — redispatch pending jobs whose initial dispatch failed.
- `GET /:request_id` — sanitized public job state and artifact references.
- GET /:request_id/mastery — latest longitudinal concept confidence and review schedule.
- `GET /:request_id/events?cursor=N` — durable ordered events after a cursor.
- `POST /:request_id/cancel` — cooperative cancellation.
- `POST /:request_id/assess` — grade quiz responses and update mastery.

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
      "uri": "gs://allowed-input/paper.pdf",
      "sha256": "optional-64-character-hex-digest"
    }
  ]
}
```

A successful submission returns `202` with `accepted`, `redispatched` or `already_accepted`.

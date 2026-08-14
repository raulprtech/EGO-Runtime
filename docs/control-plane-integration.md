# Control-plane integration

An orchestration layer can discover and invoke EGO without importing runtime code.

## Discovery

```http
GET /v1/runtime/manifest
```

The response advertises only implemented behavior. A control plane may use it as one candidate manifest when selecting an execution provider. Selection policy, endpoint availability and credential issuance remain outside the runtime.

The manifest deliberately separates:

- stable runtime and protocol identity;
- task capabilities;
- relative API entrypoints;
- active provider adapters;
- execution guarantees and limits.

`GET /v1/runtime/capabilities` remains available as a compatibility endpoint and includes `manifest_url`. New integrations should consume the versioned manifest.

The deployment layer publishes an absolute service endpoint. It must not rewrite capability declarations or choose which runtime receives a task.

## Authorize work

When approval is required, obtain the normalized digest from `POST /v1/runtime/approval-digest`, collect approval outside the runtime, and submit its signed evidence with the execution request. See [execution integrity](execution-integrity.md).

Approved Nigma work uses the separate `POST /v1/runtime/nigma/invocations` adapter. EGO validates Nigma's sealed route against its own local policy and then maps it into the same execution path. The adapter must not reinterpret or manufacture an EGO approval for a different request.

See [Nigma handoff](nigma-handoff.md) for the exact envelope, allow-list and receipt contract.

## Submit work

```http
POST /v1/runtime/execute
Authorization: Bearer <application-token>
Content-Type: application/json
```

Repeated requests with the same `request_id` and body are safe. Reusing the identifier with different content returns `409`. A failed initial dispatch is retried when the same request is submitted again or the maintenance reconciler runs.

## Observe and control

- `GET /v1/runtime/:request_id`
- `GET /v1/runtime/:request_id/events?cursor=0`
- `POST /v1/runtime/:request_id/cancel`

Internal request payloads, digests and lease ownership are never returned by the job endpoint.

## Assess learning

After a job completes, the client presents questions from `practice_set.json` and submits answers:

```http
POST /v1/runtime/:request_id/assess
Content-Type: application/json

{
  "assessment_id": "assessment_1",
  "user_id": "user_1",
  "session_id": "session_1",
  "responses": [
    { "question_id": "q1", "answer": "Learner explanation" }
  ]
}
```

The response contains grading feedback and the updated mastery state.

The latest state is available through `GET /v1/runtime/:request_id/mastery`. A control plane can validate the terminal result using `GET /v1/runtime/:request_id/receipt`.

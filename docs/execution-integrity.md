# Execution integrity

EGO supports an optional approval gate before job creation and deterministic signed receipts after terminal execution. Both mechanisms use independent HMAC-SHA256 secrets shared with the authorized control plane through deployment configuration.

## Approval flow

1. Build the complete execution request without `approval`.
2. Send it to `POST /v1/runtime/approval-digest` using runtime authentication.
3. Present the exact request or plan to the approving principal.
4. Sign the canonical approval claims with `EXECUTION_APPROVAL_SECRET`.
5. Add the claims and signature as `approval`, then submit the request to `POST /v1/runtime/execute`.

Example evidence:

```json
{
  "approval_id": "approval_123",
  "approved_by": "user_1",
  "approved_at": "2026-08-12T12:00:00.000Z",
  "expires_at": "2026-08-12T12:15:00.000Z",
  "request_digest": "64-character-sha256-hex",
  "signature": "64-character-hmac-sha256-hex"
}
```

The signature input is the `json-sort-keys-v1` canonical JSON of all evidence fields except `signature`. Object keys are sorted recursively, arrays retain their order and undefined properties are omitted. The digest endpoint applies schema defaults before hashing, so callers should use it rather than infer normalized defaults.

When `REQUIRE_EXECUTION_APPROVAL=true`, a request without evidence returns `428 APPROVAL_REQUIRED`. EGO also rejects expired evidence, invalid signatures and evidence bound to a different normalized request. Replaying the same approved request remains safe through request idempotency.

Local direct clients may leave the gate disabled. If they include approval evidence voluntarily, EGO still verifies it and requires `EXECUTION_APPROVAL_SECRET`.

## Result receipts

After a job is `completed`, `failed` or `cancelled`, request:

```http
GET /v1/runtime/:request_id/receipt
```

The endpoint requires runtime authentication and `RESULT_RECEIPT_SECRET`. Before a terminal state it returns `409 RESULT_NOT_TERMINAL`; without the signing secret it returns `503 RESULT_RECEIPT_NOT_CONFIGURED`.

The receipt includes runtime identity, request/session/objective identity, the canonical request digest, terminal status, artifacts and terminal timestamp. `payload_digest` is SHA-256 over the canonical receipt payload before receipt metadata. `signature` is HMAC-SHA256 over that same payload. Repeated reads return the same receipt.

Use separate, randomly generated secrets for approvals, receipts and runtime transport authentication. Provision them through the deployment environment; never send them to an end-user client.

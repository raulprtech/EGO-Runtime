# Nigma Integration Guide

This document describes how Nigma (the control plane) should interact with the `AriaLearningRuntime`.

## Base URL
The runtime exposes its API at `/v1`.

## Authentication
Currently, the runtime expects a simple bearer token for service-to-service authentication.
Header: `Authorization: Bearer <INTERNAL_RUNTIME_TOKEN>`

*(Note: In local development, ensure the `INTERNAL_RUNTIME_TOKEN` env var matches. In production, this should be replaced with Google Cloud IAM OIDC tokens.)*

## 1. Capabilities
Nigma can query the runtime's capabilities to determine if it should route a specific request here.

```http
GET /v1/capabilities
```

**Response:**
```json
{
  "runtime": "aria-learning",
  "version": "0.1.0",
  "capabilities": [
    "education.tutor",
    "education.study_plan",
    "documents.pdf",
    "artifacts"
  ]
}
```

## 2. Execute a Learning Task
To start a workflow (e.g., analyzing papers and creating a study plan), Nigma calls the execute endpoint.

```http
POST /v1/runtime/execute
Authorization: Bearer <token>
Content-Type: application/json

{
  "request_id": "req_12345",
  "user_id": "usr_999",
  "session_id": "sess_42",
  "objective_id": "obj_001",
  "message": "Tengo que entender estos tres papers y preparar una exposición para el viernes.",
  "attachments": [
    {
      "id": "artifact_1",
      "name": "paper1.pdf",
      "mime_type": "application/pdf",
      "uri": "gs://aria-bucket/paper1.pdf"
    }
  ],
  "capabilities": ["education.study_plan"]
}
```

**Response (202 Accepted):**
```json
{
  "request_id": "req_12345",
  "status": "accepted"
}
```

## 3. Monitor Events
Nigma can poll or stream events to send back to the user.

```http
GET /v1/runtime/req_12345/events?cursor=0
```

**Response:**
```json
{
  "events": [
    {
      "event_id": "evt_abc",
      "request_id": "req_12345",
      "sequence_number": 1,
      "type": "runtime_started",
      "timestamp": "2026-08-11T20:00:00Z",
      "data": {}
    }
  ]
}
```

## 4. Retrieve Job Status
```http
GET /v1/runtime/req_12345
```

## 5. Cancel Job
```http
POST /v1/runtime/req_12345/cancel
```

# EGO Runtime API Documentation

The EGO Runtime exposes a RESTful API designed for service-to-service communication (invoked by the Nigma control plane).

## Base URL
`/v1/runtime` (or `/v1`)

## Authentication
All endpoints require a Bearer token.
`Authorization: Bearer <INTERNAL_RUNTIME_TOKEN>`

---

## Endpoints

### 1. Get Capabilities
Returns the list of features supported by this runtime.

**Request:**
`GET /v1/capabilities`

**Response (200 OK):**
```json
{
  "runtime": "ego-runtime",
  "version": "0.1.0",
  "capabilities": [
    "education.tutor",
    "education.research",
    "education.feynman",
    "education.flashcards",
    "education.critique",
    "education.study_plan",
    "education.scheduling",
    "documents.pdf",
    "artifacts"
  ]
}
```

### 2. Execute Task
Submits an asynchronous learning task to the runtime. 

**Request:**
`POST /v1/runtime/execute`

**Body:**
```json
{
  "request_id": "req_123",
  "user_id": "usr_456",
  "session_id": "sess_789",
  "objective_id": "obj_001",
  "message": "I need to understand backpropagation.",
  "attachments": [],
  "capabilities": ["education.tutor"]
}
```

**Response (202 Accepted):**
```json
{
  "request_id": "req_123",
  "status": "accepted"
}
```

### 3. Get Job Status
Retrieves the current state of a submitted job.

**Request:**
`GET /v1/runtime/:request_id`

**Response (200 OK):**
```json
{
  "request_id": "req_123",
  "session_id": "sess_789",
  "objective_id": "obj_001",
  "status": "running",
  "created_at": "2026-08-11T20:00:00Z",
  "updated_at": "2026-08-11T20:00:05Z"
}
```

### 4. Get Events (Polling/Cursor)
Retrieves the sequenced events for a job, useful for real-time monitoring.

**Request:**
`GET /v1/runtime/:request_id/events?cursor=0`

**Response (200 OK):**
```json
{
  "events": [
    {
      "event_id": "evt_abc123",
      "request_id": "req_123",
      "session_id": "sess_789",
      "sequence_number": 1,
      "type": "runtime_started",
      "timestamp": "2026-08-11T20:00:01Z",
      "data": { "message": "Coordinator initialized" }
    }
  ]
}
```

### 5. Cancel Job
Attempts to cancel a running job.

**Request:**
`POST /v1/runtime/:request_id/cancel`

**Response (200 OK):**
```json
{
  "status": "cancelled"
}
```

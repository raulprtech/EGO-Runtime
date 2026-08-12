# Architectural Decisions

1.  **Node.js / TypeScript over Python**:
    *   *Context*: The environment mandates a TypeScript/Node.js stack for deployment and tooling compatibility.
    *   *Decision*: The Python Google ADK requested in the prompt has been translated into a conceptual equivalent using TypeScript, Express, Zod, and the official `@google/genai` Node SDK. The architectural principles (separation of concerns, decoupled runtime) are fully preserved.

2.  **Firestore for Persistence**:
    *   *Context*: Events, jobs, and artifacts need durable storage.
    *   *Decision*: Using Firebase Admin SDK to interact with Firestore. Collections created: `aria_jobs`, `aria_events`, `aria_artifacts`.

3.  **Async Job Dispatching (Simulated Pub/Sub)**:
    *   *Context*: The `/execute` endpoint must return `202 Accepted` immediately.
    *   *Decision*: A robust in-memory `TaskQueue` service is implemented. In a true Google Cloud production environment, this would be swapped with Cloud Tasks or Pub/Sub. The interface allows easy swapping.

4.  **Event Sequencing**:
    *   *Context*: Events must be ordered.
    *   *Decision*: Implemented a Firestore transaction-based sequence generator to ensure monotonically increasing `sequence_number` for each event within a job/session.

5.  **Artifact Handling**:
    *   *Context*: Need to validate PDFs and generate new artifacts.
    *   *Decision*: The runtime simulates downloading and validating GCS URIs. It generates synthetic outputs (`study_plan.json`, `concept_map.json`) and stores their metadata in Firestore as artifacts.

6.  **Idempotency**:
    *   *Context*: Prevent duplicate job executions for the same request.
    *   *Decision*: Idempotency keys (`request_id`) are checked against existing jobs in Firestore before dispatch.

7.  **Zod for Contracts**:
    *   *Context*: Pydantic was requested for Python.
    *   *Decision*: Zod provides identical robust schema validation and type inference for TypeScript.

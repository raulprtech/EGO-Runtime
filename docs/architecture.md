# Aria Learning Runtime

## Architecture

This project implements the Aria Learning Runtime, adhering to the principles of a decoupled agentic execution engine.

### Core Components

1.  **API Layer (`/api`)**: Express.js server providing REST endpoints for Nigma to interact with the runtime. Uses Zod for strict contract validation.
2.  **Runtime Interface (`/runtime`)**: Defines the `AgentRuntime` interface to ensure interchangeability of runtimes (e.g., `HermesRuntime`, `AriaLearningRuntime`).
3.  **Agents (`/agents`)**: Contains the core logic for fulfilling educational tasks.
    *   **Coordinator**: Orchestrates the execution, delegates to sub-agents, and manages the overall workflow.
    *   **Planner**: Generates structured learning plans based on objectives and documents.
    *   **Document Analyzer**: Extracts concepts and builds conceptual maps from input materials.
4.  **Services (`/services`)**:
    *   **Firestore**: Handles persistence of jobs, sessions, events, and artifacts.
    *   **Task Queue**: Simulates an asynchronous worker queue (like Cloud Tasks/PubSub) to process jobs in the background without blocking the HTTP response.
    *   **Artifact Store**: Manages the storage and retrieval of artifacts (simulating GCS interaction for this vertical slice).

### Data Flow (Execution)

1.  Nigma sends a `POST /v1/runtime/execute` request.
2.  API validates the request (Zod) and idempotency key.
3.  A Job is created in Firestore (`status: pending`).
4.  The job is dispatched to the Task Queue.
5.  API returns `202 Accepted` immediately.
6.  The Task Queue worker picks up the job and invokes the `Coordinator`.
7.  The Coordinator emits durable events (sequence numbered) to Firestore.
8.  Coordinator uses Gemini 3.5 (via `@google/genai`) for structured outputs.
9.  Artifacts (`study_plan.json`, `concept_map.json`) are generated and stored.
10. Job is marked as `completed`.

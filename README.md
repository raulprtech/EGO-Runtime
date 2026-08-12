# EGO Runtime (formerly Aria Learning Runtime)

EGO Runtime is an autonomous educational agent engine designed to coordinate learning workflows. It transforms high-level academic intentions into executable learning processes by orchestrating specialized agents (Planner, Document Analyzer, Tutor, Critic, etc.).

This runtime is designed to be invoked by a higher-level control plane ("Nigma") and executes tasks asynchronously, emitting observable, sequenced events and durable artifacts.

## Key Principles
*   **Active Education:** Prioritizes real learning, autonomy, and epistemological honesty over complacency.
*   **Tool Coordination:** Acts as a longitudinal layer over existing educational tools (documents, search, flashcards).
*   **Asynchronous & Observable:** HTTP API immediately accepts tasks (202) and processes them in the background, emitting Server-Sent Events (SSE) compatible structured logs.

## Project Structure
*   `src/api/`: Express routes and Zod schemas (Contracts).
*   `src/agents/`: Specific agent logic (Coordinator, Planner, DocumentAnalyzer).
*   `src/services/`: Firestore integration, Task Queue (simulated), Artifact Store.
*   `src/domain/`: Core business entities (LearningObjective, ConceptState).
*   `src/tools/`: Integration adapters (e.g., Calendar).
*   `docs/`: Architecture, Decisions, API, Deployment, and Nigma Integration guides.
*   `scripts/`: Demo scripts for local testing.

## Local Development

### Requirements
*   Node.js v22+
*   Google Cloud SDK (for Firebase local credentials, or set service account env vars)
*   A valid Gemini API Key

### Setup
1. Copy the environment template:
   ```bash
   cp .env.example .env
   ```
2. Configure `.env` with your `GEMINI_API_KEY`.
3. Install dependencies:
   ```bash
   npm install
   ```
4. Run the development server:
   ```bash
   npm run dev
   ```
5. In a separate terminal, run the E2E vertical slice demo:
   ```bash
   node scripts/demo.js
   ```

## Documentation
Please refer to the `/docs` folder for detailed documentation:
*   [Architecture (architecture.md)](./docs/architecture.md)
*   [Architectural Decisions (decisions.md)](./docs/decisions.md)
*   [API Reference (api.md)](./docs/api.md)
*   [Nigma Integration (nigma-integration.md)](./docs/nigma-integration.md)
*   [Deployment (deploy.md)](./docs/deploy.md)

# Architecture

EGO is a decoupled learning runtime invoked by an external orchestration layer and consumed through a separate client interface.

## Components

- **API:** validates contracts, enforces idempotency and exposes job, event, cancellation and assessment endpoints.
- **Cloud Tasks adapter:** delivers durable asynchronous work. Failed dispatches remain recoverable through reconciliation.
- **Job lifecycle:** obtains an exclusive Firestore lease before execution and renews it between stages.
- **ADK agents:** analyze documents, plan study, design retrieval practice and grade assessments.
- **Artifact store:** verifies GCS inputs and writes immutable generated artifacts.
- **Learning state:** stores hidden answer keys, assessment attempts and evolving concept confidence separately from public job state.

## Initial workflow

```text
execute -> durable dispatch -> lease -> extract -> concept map -> study plan
        -> practice package -> mastery state -> artifacts -> completed
```

A later `assess` call grades responses, records an attempt, updates concept confidence and assigns the next review date.

## Trust boundary

The orchestration layer owns user-facing policy and runtime selection. EGO owns one learning workflow. The client interface never needs direct cloud credentials.

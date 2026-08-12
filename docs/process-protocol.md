# Local process protocol

A desktop or orchestration client owns the runtime child process. The contract intentionally uses standard process and HTTP primitives.

## Start

Launch the production bundle with an optional dynamic port:

```bash
HOST=127.0.0.1 PORT=0 npm start
```

For development, the same contract is available through `npm run dev`. Local mode binds to `127.0.0.1` by default; the cloud adapter binds to `0.0.0.0` unless `HOST` overrides it.

## Readiness

The first protocol record on stdout is one JSON line:

```json
{
  "type": "runtime.ready",
  "protocol_version": 1,
  "pid": 12345,
  "instance_id": "uuid",
  "base_url": "http://127.0.0.1:43127",
  "health_url": "http://127.0.0.1:43127/health",
  "backend": "local",
  "model_provider": "gemini-adk",
  "model_configured": true,
  "shutdown": "SIGTERM"
}
```

A client should parse stdout line-by-line, ignore non-JSON diagnostic lines, wait for `runtime.ready`, and then verify `GET /health`. It must not infer readiness from a fixed delay. `model_configured` reports credential configuration without revealing or testing the credential; `npm run smoke:model` performs the real provider check.

## Query

- `GET /health` needs no application token and reports protocol version, instance ID, backend, provider and active local jobs.
- All job, event, cancellation and assessment endpoints remain under `/v1/runtime` and require `INTERNAL_RUNTIME_TOKEN`.
- Reuse the reported `base_url`; a client that requested `PORT=0` must not guess the selected port.

## Shutdown

Send `SIGTERM` to the reported PID. The runtime:

1. stops accepting new HTTP connections;
2. waits up to `SHUTDOWN_GRACE_MS` for active local jobs;
3. writes `runtime.stopped` to stdout;
4. exits with code 0 if drained, or 2 if the grace period expired.

`SIGINT` has the same semantics for terminal use. Repeated in-process stop requests share one shutdown operation. If a process is force-killed, unfinished jobs remain on disk and are recovered at the next start.

## Stream rules

Protocol records are single-line JSON objects with a stable `type` and integer `protocol_version`. Human-readable diagnostics may also appear on stdout or stderr, so clients must select records by `type`.

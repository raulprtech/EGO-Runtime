# Hermes conversation decision sidecar

The G1.10–G1.11 sidecar connects an authenticated Hermes conversation to EGO's
neutral G1.9 human-decision port. It is a trusted deployment adapter, not a
model tool and not an ARIA backend. It records an explicit approval only; it
cannot execute a plan.

## Trust boundary

- Hermes authenticates the conversation and labels human turns as `user`.
- The sidecar owns the Hermes API key, EGO runtime token and independent Nigma
  human-decision token. None may enter model context or a mobile bundle.
- EGO validates the exact sealed preparation, phrase and presentation window.
- Nigma records the approval. A later, separate command must request execution.

Hermes and EGO URLs must use HTTPS, except loopback HTTP for local testing.
Embedded URL credentials, queries, fragments, redirects, shared runtime/human
tokens and human tokens shorter than 32 characters fail closed.

## Bind before presenting the plan

Configure the process environment without committing secret values:

```dotenv
HERMES_CHAT_URL=https://hermes.example
HERMES_CHAT_API_KEY=<secret>
HERMES_PROFILE=aria
EGO_RUNTIME_URL=https://ego.example
EGO_RUNTIME_TOKEN=<secret>
NIGMA_HUMAN_DECISION_TOKEN=<different-secret-at-least-32-characters>
```

Create the binding after the sealed preparation exists and immediately before
presenting its approval phrase in the chosen Hermes session:

```bash
npm run nigma:hermes-decision -- bind \
  --preparation /secure/preparation.json \
  --binding /secure/hermes-decision-binding.json \
  --session-ref <opaque-session-reference> \
  --approver <operator-identity> \
  --expires-at <absolute-ISO-8601-time>
```

The expiry must be between one minute and two hours after binding. Binding
refuses to overwrite an existing file. The output includes only the binding
digest, baseline count, pending state and Hermes contract digest. G1.11 bindings
use `nigma.hermes-conversation-binding/v2` and seal both the profile hash and
the authenticated `/v1/capabilities` contract. Legacy v1 bindings remain valid
only for the default profile.

## Compatibility doctor

Run the authenticated contract probe before binding:

```bash
npm run nigma:hermes-decision -- doctor
```

To verify the real messages endpoint without printing content:

```bash
npm run nigma:hermes-decision -- doctor --session-ref <session-reference>
```

The output contains only platform, profile/contract hashes, verification state
and message count. Missing bearer authentication, incompatible capabilities or
invalid message shape fails closed.

## Scan after a human response

```bash
npm run nigma:hermes-decision -- scan \
  --binding /secure/hermes-decision-binding.json \
  --session-ref <same-opaque-session-reference>
```

Possible outcomes are:

- `no_match`: no new exact human decision; EGO was not contacted;
- `approval_recorded`: exactly one eligible turn was accepted and sealed;
- `already_recorded`: the local binding is locked and no upstream call occurs.
- `approval_window_closed`: v2 binding is sealed `expired` before reading chat.

Baseline messages, assistant/system/tool messages and decorated text are
ignored. Two new exact candidate turns are ambiguous and fail closed. A session
mismatch, modified binding, unsafe file mode or invalid upstream response also
fails closed.

## Supervise until a terminal decision

`watch` safely repeats scans and can be restarted with the same binding:

```bash
npm run nigma:hermes-decision -- watch \
  --binding /secure/hermes-decision-binding.json \
  --session-ref <same-opaque-session-reference> \
  --poll-ms 2000 \
  --max-transient-errors 5
```

Polling is bounded to 250–30000 ms and zero to 100 transient errors. Network,
timeout, 429 and 5xx failures may retry; authentication, contract, integrity,
profile, ambiguity and authority failures stop immediately. The supervisor
persists only terminal `recorded` or `expired` bindings. Restarting either state
performs no upstream call. It never executes a plan.

## Windows Hermes with WSL EGO

Hermes 0.20 commonly binds its profile API to Windows loopback. WSL may not be
able to reach that socket. Build the autonomous CommonJS artifact and run it
with Node on the Hermes host while keeping its binding on a Linux filesystem:

```bash
npm run build:hermes-decision
```

The artifact is `dist/hermes-decision-adapter.cjs`. A service manager should
inject the five credentials/settings, invoke `watch`, restart on unexpected
failure and preserve the same owner-only binding. Do not expose Hermes on a LAN
or relax the HTTP URL guard merely to cross the Windows/WSL boundary. Windows
can call a WSL-hosted EGO loopback service when that platform forwarding is
available; otherwise use authenticated HTTPS between hosts.

## Durable data

The binding must be a regular `0600` file. It contains the preparation and
projection identities, phrase/session/message hashes, approver, bounded times
and—after success—the approval and record digests. It contains no raw phrase,
session reference, message reference, credentials, objective or learner
material. Store it on a filesystem that enforces Unix owner-only permissions;
DrvFS is not suitable.

The CLI prints one sanitized JSON object. Operators should monitor nonzero exit
status and structured error codes, and should never log the process environment
or the authenticated Hermes message response.

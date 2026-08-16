# Hermes conversation decision and execution sidecar

The G1.10–G1.16 sidecar connects an authenticated Hermes conversation to EGO's
neutral human-decision and execution ports. It is a trusted deployment adapter,
not a model tool and not an ARIA backend. It first records an explicit
approval, then requires a separate exact human turn before execution.

## Trust boundary

- Hermes authenticates the conversation and labels human turns as `user`.
- The sidecar owns the Hermes API key, EGO runtime token and independent Nigma
  human-decision token. None may enter model context or a mobile bundle.
- EGO validates the exact sealed preparation, phrase and presentation window.
- Nigma records the approval. A later, separate exact human turn must request execution.
- EGO records a profile-scoped informational receipt after Nigma confirms the
  approval. ARIA may read that receipt through its relay, but it cannot use the
  feed to approve or execute.

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
use `nigma.hermes-conversation-binding/v3`, seal both the profile hash and the
authenticated `/v1/capabilities` contract and carry an explicit null execution
state. Historical v1/v2 bindings remain readable, but cannot infer execution
authority.

ARIA exposes one continuous user conversation even though Hermes retains an
opaque primary session and older compaction segments. Resolve the current
primary session before binding, capture its complete message set as baseline,
and present the phrase in that same session. Do not create a separate approval
conversation or ask the user to select an internal Hermes session. A server or
profile change and every segment rollover require a fresh preparation and
baseline rather than silently rebinding a pending decision.

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
- `approval_window_closed`: a modern binding is sealed `expired` before reading chat.

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
profile, ambiguity and authority failures stop immediately. The approval
supervisor persists only terminal `recorded` or `expired` bindings.
Restarting either state performs no approval call.

## Scan or supervise the separate execution turn

After `approval_recorded`, ARIA's informational event shows the exact second
phrase. Scan once with the same binding and Hermes session:

```bash
npm run nigma:hermes-decision -- execute-scan \
  --binding /secure/hermes-decision-binding.json \
  --session-ref <same-opaque-session-reference>
```

Or supervise until execution, expiry or a terminal error:

```bash
npm run nigma:hermes-decision -- execute-watch \
  --binding /secure/hermes-decision-binding.json \
  --session-ref <same-opaque-session-reference> \
  --poll-ms 2000 \
  --max-transient-errors 5
```

Possible outcomes are `no_match`, `execution_recorded`,
`already_executed` and `execution_window_closed`. The watcher excludes every
baseline turn and the approval turn, accepts only one later human `user`
message whose complete content hashes to the sealed execution phrase, and
preserves the profile/session binding. Assistant/tool/system messages,
decoration, ambiguity, wrong profile/session, legacy binding and expiry fail
before execution.

On a valid turn, EGO calls the existing host-run loop with an idempotency
identity derived from the approval challenge. Nigma revalidates the current
approval before returning an invocation. The binding locks as `executed` only
after EGO returns a matching terminal record. It retains host-run ID, status,
record digest and message hash, never raw phrase or opaque references. Restart
or replay of `executed` performs no upstream call.

## Windows Hermes with WSL EGO

Hermes 0.20 commonly binds its profile API to Windows loopback. WSL may not be
able to reach that socket. Build the autonomous CommonJS artifact and run it
with Node on the Hermes host while keeping its binding on a Linux filesystem:

```bash
npm run build:hermes-decision
```

The artifact is `dist/hermes-decision-adapter.cjs`. A service manager should
inject the five credentials/settings, invoke `watch`, then `execute-watch`
after approval, restart on unexpected failure and preserve the same owner-only
binding. Do not expose Hermes on a LAN
or relax the HTTP URL guard merely to cross the Windows/WSL boundary. Windows
can call a WSL-hosted EGO loopback service when that platform forwarding is
available; otherwise use authenticated HTTPS between hosts.

If Windows localhost forwarding is unavailable during a controlled local test,
an owner-managed TCP or HTTP bridge may listen only on Windows loopback and
forward to the exact WSL EGO address. Verify the bridge before binding, remove
it after the terminal decision and never bind it to LAN interfaces. This is a
deployment workaround, not permission to add non-loopback HTTP to the sidecar
allow-list.

When Windows Node accesses `\\wsl.localhost\<distro>\...`, the adapter does
not trust Windows' synthetic POSIX mode. It accepts only a bounded WSL UNC path,
invokes `%SystemRoot%\System32\wsl.exe`, uses absolute `/usr/bin` utilities,
and verifies a regular file owned by the distro's current user with mode
`0600`. Writes precreate a random `0600` temporary file inside WSL before
writing, atomically rename it and verify the final file. Generic Windows and
DrvFS paths still fail closed.

For a physical ARIA device on the same LAN, bearer authentication remains
mandatory. Limit any firewall rule to the required port, local address, local
subnet and current Windows network profiles. Local HTTP is for controlled
testing only; remote or production use requires authenticated HTTPS. ARIA's
stored profile and SecureStore key must match the supervised Hermes profile
without entering a model prompt, repository or mobile bundle.

## Durable data

The binding must be a regular `0600` file. It contains the preparation and
projection identities, phrase/session/message hashes, approver, bounded times
and—after success—the approval, host-run and record digests. It contains no raw phrase,
session reference, message reference, credentials, objective or learner
material. Store it on a filesystem that enforces Unix owner-only permissions;
DrvFS is not suitable.

The CLI prints one sanitized JSON object. Operators should monitor nonzero exit
status and structured error codes, and should never log the process environment
or the authenticated Hermes message response.

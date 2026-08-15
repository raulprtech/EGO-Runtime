# Hermes conversation decision sidecar

The G1.10 sidecar connects an authenticated Hermes conversation to EGO's
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
digest, baseline count and pending state.

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

Baseline messages, assistant/system/tool messages and decorated text are
ignored. Two new exact candidate turns are ambiguous and fail closed. A session
mismatch, modified binding, unsafe file mode or invalid upstream response also
fails closed.

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

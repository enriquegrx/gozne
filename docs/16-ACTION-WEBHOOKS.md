# Signed action webhooks

Gozne can deliver an approved action to one private HTTP service. Simulation
remains the default. Webhook mode is available only on the administration
surface and must be deliberately configured when that process starts.

This adapter sends data; it does not run shell commands, call a blockchain or
hold provider credentials. The receiving service decides how an approved
project, version and environment map to a real operation.

## Enable the adapter

Set these variables only on the private `admin` process:

```text
GOZNE_SURFACE=admin
GOZNE_ACTION_MODE=webhook
GOZNE_ACTION_WEBHOOK_URL=https://deploy.internal.example/actions
GOZNE_ACTION_WEBHOOK_SECRET=<at least 32 random bytes>
GOZNE_ACTION_WEBHOOK_TIMEOUT_MS=5000
```

The URL must use HTTPS and cannot contain credentials or a fragment. A local
test service may use HTTP only when `GOZNE_ACTION_WEBHOOK_ALLOW_HTTP=true`; this
explicit exception is unsuitable for traffic crossing an untrusted network. Keep
the secret outside the repository and restrict access to the container
configuration.

`gozne config check --json` rejects incomplete, short-secret, public-surface and
ambiguous configurations. `/version` on the private surface reports
`actionDeliveryMode` without returning the URL or secret.

## Request contract

Gozne sends `POST` with `Content-Type: application/json`, does not follow
redirects and accepts any `2xx` response. The request body is deterministic:

```json
{
  "format": "gozne-action-v1",
  "actionId": "41fbb384-6140-4ab1-87e6-a94065023586",
  "application": "demo",
  "requester": "operator",
  "payload": {
    "project": "website",
    "version": "v1.2.3",
    "environment": "production"
  },
  "payloadHash": "<sha256>",
  "approvals": ["operator", "reviewer"],
  "requestedAt": 1788681600000,
  "expiresAt": 1788683400000
}
```

The `approvals` list contains the distinct live administrator identities that
satisfied the action when delivery started. The action stores its delivery mode
when it is requested, before anyone signs it. Reconfiguring Gozne cannot turn an
older simulation approval into a webhook delivery.

These headers authenticate and deduplicate the request:

```text
Idempotency-Key: <actionId>
X-Gozne-Timestamp: <Unix milliseconds>
X-Gozne-Signature: sha256=<lowercase HMAC-SHA-256 hex>
```

Compute the HMAC over the exact bytes below, without parsing or reserializing
the body first:

```text
<X-Gozne-Timestamp>.<raw request body>
```

A Node.js receiver can verify it as follows:

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifyGozne(rawBody, headers, secret) {
  const timestamp = headers['x-gozne-timestamp'];
  const supplied = headers['x-gozne-signature'];
  if (!/^\d{13}$/.test(timestamp ?? '')) return false;
  if (Math.abs(Date.now() - Number(timestamp)) > 300_000) return false;
  if (!/^sha256=[a-f0-9]{64}$/.test(supplied ?? '')) return false;
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.`)
    .update(rawBody)
    .digest();
  return timingSafeEqual(expected, Buffer.from(supplied.slice(7), 'hex'));
}
```

Validate the timestamp before expensive work, verify the HMAC in constant time,
then confirm that `Idempotency-Key` equals the body `actionId`. Parse the JSON
only after signature verification. Enforce the body schema and reject unknown
formats.

## Idempotency and retries

The receiver must persist one result per `Idempotency-Key` before returning
success. A repeated key must return the stored result and must not repeat the
effect. Do not deduplicate only in process memory.

Gozne creates a hashed, short-lived lease before each call. A network error,
timeout, non-`2xx` response, redirect or response larger than 64 KiB records
`action.delivery-failed`; the original requester may retry while its session,
action and approvals remain valid. At most five attempts are allowed. Every
attempt uses the same body and idempotency key with a fresh timestamp and HMAC.

On success Gozne stores the HTTP status and SHA-256 of the response bytes, marks
the action executed and appends `action.executed`. It never stores the response
body. An in-flight result can still be committed if a policy update revokes the
browser session after delivery started. The short opaque lease proves that this
is the matching attempt.

The delivery guarantee is **at least once**. The receiver may commit and Gozne
may crash before recording the response. The subsequent attempt therefore uses
the same idempotency key. A receiver that ignores this rule can execute an
operation more than once.

## Recovery boundary

Database restoration marks any captured in-flight delivery failed and cancels
pending or approved actions. It cannot determine whether an external receiver
already committed an effect. Compare the receiver's idempotency ledger with the
Gozne audit and receipt tables before issuing a replacement action.

Provider-specific reconciliation and delivery queues across multiple Gozne
instances remain future work. This adapter targets one Gozne instance and one
operator-controlled receiver.

# API and integration contracts

The machine-readable contract is [openapi.yaml](../openapi.yaml). Browser login,
Each surface uses its own same-origin HTTPS API. Public authentication and
private administration use different hostnames. Control routes exist only with
`GOZNE_SURFACE=admin`; the default is `public`. No policy means authentication
routes return `503`. Timestamps are Unix milliseconds unless a signed message
uses ISO 8601.

## Authentication routes

| Method | Route                                | Purpose                          | Requirement               |
| ------ | ------------------------------------ | -------------------------------- | ------------------------- |
| GET    | `/healthz`                           | SQLite read health               | None                      |
| GET    | `/version`                           | Build and capability metadata    | None                      |
| POST   | `/v1/auth/nonce`                     | Issue login challenge            | Allowed origin and chain  |
| POST   | `/v1/auth/verify`                    | Verify proof and create session  | Login context cookie      |
| GET    | `/v1/auth/me`                        | Current session and CSRF token   | Session                   |
| GET    | `/v1/auth/validate?application=demo` | Internal proxy decision          | Session                   |
| POST   | `/v1/auth/logout`                    | Revoke current session           | Session, origin and CSRF  |
| POST   | `/v1/internal/authorize`             | Permission and resource decision | Application service token |
| POST   | `/v1/internal/authorize/batch`       | Up to 50 ordered decisions       | Application service token |

## Login flow

1. Send `application`, `network` (`evm` or `solana`), `address` and a string
   `chainId` to `nonce`.
2. The server checks origin, application and chain, creates a 128-bit nonce and
   sets a random browser-context cookie.
3. Sign the exact returned `message`. For Solana, pass the returned
   `signInInput` to a compatible wallet's `signIn` method.
4. Send only `nonce`, `message` and `signature` to `verify`, with the context
   cookie.
5. The server checks exact content, signer, domain, URI, chain and time. It
   consumes the challenge and creates an authorized session in one transaction.
6. The response sets a session cookie and returns public session information.

EVM uses `personal_sign` with a 65-byte hexadecimal signature including `0x`.
Solana uses a 64-byte Ed25519 signature encoded as canonical base64. Challenges
last five minutes. A valid proof for an unauthorized wallet still fails with the
same public error as an invalid signature.

Both `verify` and `me` return `id`, `identity`, `network`, `address`,
`application`, `roles`, `expiresAt` and `csrfToken`. Static sessions last one
hour; guest sessions expire at the earlier of one hour or their invitation
deadline. The cookie may outlive a guest's authorization; the server remains
authoritative.

## Capability discovery

`GET /version` is available through both bundled HTTPS surfaces. It returns the
running version, `public` or `admin` surface, and stable capability identifiers.
Integrations that need method-aware writes must require
`forward-auth.request.v1` before switching their protected upstream. The admin
surface additionally advertises `control.admin.v1` and
`control.approval-threshold.v1`. The operator build also reports
`audit.export-chain.v1` and `action.delivery-webhook.v1`, plus the active
`actionDeliveryMode`. Unknown capabilities must be ignored so Gozne can add
compatible behavior without breaking consumers.

This endpoint reports code capabilities, not operational readiness. Check
`/healthz`, validate the deployment topology, and complete a real authenticated
request before promoting a release.

## Cookies and mutation protection

Both `__Host-gozne-login` and `__Host-gozne-session` use:

```text
Secure; HttpOnly; SameSite=Strict; Path=/
```

There is no `Domain` attribute. Session cookies contain a random 256-bit opaque
value; SQLite stores its hash. Successful login rotates the current cookie and
revokes the previous session. No wallet address or role is encoded in the
cookie.

Logout and all control mutations require `Origin` to exactly match the
application and `X-CSRF-Token` to match the session's token. If `Sec-Fetch-Site`
is supplied, it must be `same-origin`. Read routes reject conflicting Origin or
Fetch Metadata headers. No cross-origin CORS flow is provided.

## Control routes

All paths below start with `/v1/auth/control`. They use the current session's
application; clients cannot select another application in a mutation body. The
overview also returns `actionDeliveryMode`; every action and receipt carries its
own snapshotted `deliveryMode`.

`GET /audit` is administrator-only and returns the newest audit events for that
application. Use `limit` (1–100), the returned `nextBefore` cursor and an
optional exact `event` filter. Each event includes its sequence, time, type,
actor identity and public session ID. The response never contains session
tokens, token hashes, signatures or signed payloads.

| Method | Suffix                     | Required actor                                |
| ------ | -------------------------- | --------------------------------------------- |
| GET    | (none)                     | Any valid session                             |
| GET    | `/audit`                   | Administrator                                 |
| POST   | `/invitations`             | Administrator with reader access              |
| POST   | `/invitations/{id}/revoke` | Administrator                                 |
| POST   | `/actions`                 | Any valid session                             |
| POST   | `/actions/{id}/challenge`  | Administrator                                 |
| POST   | `/actions/{id}/approve`    | Distinct administrator and fresh wallet proof |
| POST   | `/actions/{id}/execute`    | Original requesting session                   |
| POST   | `/actions/{id}/cancel`     | Original requesting session or administrator  |

Read the [control contract and walkthrough](11-CONTROL-PANEL.md) for bodies,
state transitions, timing, approval thresholds and limitations. Actions run as a
local simulation unless the private process is explicitly configured for the
[signed webhook adapter](16-ACTION-WEBHOOKS.md). There is no generic
arbitrary-command execution endpoint.

## Forward-auth contract

A successful internal validation returns `200` with no body and these headers:

```text
X-Gozne-Identity: <internal identity>
X-Gozne-Role: <comma-separated roles>
X-Gozne-Application: <application ID>
X-Gozne-Session: <public audit session ID, not a token>
```

The proxy must discard client-supplied identity headers and send only verified
ones to the protected application. The examples use an explicit outgoing header
allowlist and do not forward the authentication cookie to the demo app.

Responses: `401` for no live session, `403` for another application, `429` for
rate limiting and `503` for unavailable storage or missing policy. The proxy
must deny access on any failed validation. Nginx may translate an unexpected
`auth_request` status to `500`, which still denies the protected response. Keep
`validate` internal; the example proxy returns `404` to public requests.

Session management also provides `POST /v1/auth/control/sessions/{id}/revoke`
for an administrator to revoke another session in the current application. It
requires an empty JSON body, Origin and CSRF. The current session must use
logout.

`GET` and `POST /v1/auth/control/users` provide the administrator user directory
and revision-checked permanent user edits. See the
[panel guide](11-CONTROL-PANEL.md#permanent-users-wallets-and-application-roles)
for scope, shared-wallet restrictions and instance-wide session invalidation.

`GET` and `POST /v1/auth/control/authorization` read and replace the current
application's permission catalog, role bundles, resource hierarchy and scoped
grants. `POST /v1/auth/control/authorization/inspect` explains an effective
decision. These routes require a private administrator session; writes require
Origin and CSRF and invalidate all sessions when the policy changes. The
[resource authorization guide](17-RESOURCE-AUTHORIZATION.md) defines the
service-side integration and trust boundary.

## Errors

```json
{
  "error": {
    "code": "AUTH_INVALID_PROOF",
    "message": "Authentication could not be completed",
    "request_id": "00000000-0000-4000-8000-000000000000"
  }
}
```

Public login errors do not reveal whether a wallet is authorized. Authenticated
administrator operations can report actionable conflicts such as
`INVITATION_EXISTS` or `WALLET_CONFIGURED`. Action failures include
`ADMIN_REQUIRED`, `REQUESTER_REQUIRED`, `ACTION_UNAVAILABLE` and
`ACTION_NOT_FOUND`. Webhook failures return `ACTION_DELIVERY_FAILED` without
including the receiver URL or response. Never put signatures, cookies or full
proofs in error logs.

Bodies reject unknown fields. The global body limit is 16 KiB. See
[operations](08-OPERATIONS.md) for rate and storage limits.

## Research application write validation

`GET /v1/auth/validate-request?application=quique&method=POST&write_role=admin`
is the new private forward-auth contract for research records. All three query
parameters are required. The private proxy captures the original method before
its auth subrequest and chooses the required write role from its configuration.
GET/HEAD validate the live session/application and reject conflicting
origin/fetch metadata. POST/PUT/PATCH/DELETE additionally require that role,
exact session origin and session-bound X-CSRF-Token. Unknown/missing methods
fail; legacy validate remains available for existing read-only integrations. The
same four identity headers are returned, and cookies/CSRF must never be
forwarded to the protected application.

Every bundled proxy hides validate-request from browsers. The Research Lab
routing lives in the adjacent app.quique.es repository and requires this Gozne
capability before enabling its mutations. Deploy matching reviewed commits; old
gateways fail closed on the new route. No live grants or public administration
routes change. Run
`RESEARCH_REPOSITORY=/absolute/path/to/APP.QUIQUE.ES node scripts/test-research-proxy.mjs`
after building both repositories' images to test real Gozne with the new
application. It creates only temporary synthetic identities and a disposable
Compose project.

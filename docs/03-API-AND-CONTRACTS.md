# API and integration contracts

The machine-readable contract is [openapi.yaml](../openapi.yaml). Browser login,
Each surface uses its own same-origin HTTPS API. Public authentication and
private administration use different hostnames. Control routes exist only with
`GOZNE_SURFACE=admin`; the default is `public`. No policy means authentication
routes return `503`. Timestamps are Unix milliseconds unless a signed message
uses ISO 8601.

## Authentication routes

| Method | Route                                | Purpose                         | Requirement              |
| ------ | ------------------------------------ | ------------------------------- | ------------------------ |
| GET    | `/healthz`                           | SQLite read health              | None                     |
| GET    | `/version`                           | Build version and alpha stage   | None                     |
| POST   | `/v1/auth/nonce`                     | Issue login challenge           | Allowed origin and chain |
| POST   | `/v1/auth/verify`                    | Verify proof and create session | Login context cookie     |
| GET    | `/v1/auth/me`                        | Current session and CSRF token  | Session                  |
| GET    | `/v1/auth/validate?application=demo` | Internal proxy decision         | Session                  |
| POST   | `/v1/auth/logout`                    | Revoke current session          | Session, origin and CSRF |

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
application; clients cannot select another application in a mutation body.

| Method | Suffix                     | Required actor                               |
| ------ | -------------------------- | -------------------------------------------- |
| GET    | (none)                     | Any valid session                            |
| POST   | `/invitations`             | Administrator with reader access             |
| POST   | `/invitations/{id}/revoke` | Administrator                                |
| POST   | `/actions`                 | Any valid session                            |
| POST   | `/actions/{id}/challenge`  | Administrator                                |
| POST   | `/actions/{id}/approve`    | Administrator and fresh wallet proof         |
| POST   | `/actions/{id}/execute`    | Original requesting session                  |
| POST   | `/actions/{id}/cancel`     | Original requesting session or administrator |

Read the [control contract and walkthrough](11-CONTROL-PANEL.md) for bodies,
state transitions, timing and limitations. Only the deployment simulation is
implemented; there is no generic arbitrary-command execution endpoint.

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
`ACTION_NOT_FOUND`. Never put signatures, cookies or full proofs in error logs.

Bodies reject unknown fields. The global body limit is 16 KiB. See
[operations](08-OPERATIONS.md) for rate and storage limits.

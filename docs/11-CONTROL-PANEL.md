# Control panel, invitations and signed actions

This guide describes the implemented MVP. The panel uses real wallet proofs and
persistent authorization state. Its default deployment operation is a
**simulation**; operators can explicitly configure signed private webhook
delivery. The simulation inserts a receipt in SQLite and does not call a hosting
service or execute a command.

## Start with an administrator

On a new installation, follow the [README](../README.md). The starter
`example-user` identity has `reader` and `admin` for `demo` and no wallets.
Attach your public address with the CLI, then open the internal panel at
`https://127.0.0.1:9443` in a browser with that wallet installed. Select Rabby,
MetaMask or another detected EVM provider explicitly; Phantom handles Solana.

The panel shows `ADMIN` after an administrator signs in. Only administrators can
create or revoke invitations and sign approvals. A valid reader can request an
action and execute an approval bound to their original session. No balance or
NFT ownership grants permissions.

## Upgrading an existing installation

1. With the old image still running, create a fresh backup and copy it outside
   the volume. Record the old image digest. See [recovery](09-RECOVERY.md).
2. Build and start the new image. Migration `003-control-panel.sql` adds control
   tables transactionally. Existing identities and grants are preserved.
3. Export the live policy to `policy.local.json`, as shown in
   [operations](08-OPERATIONS.md#policy-and-cli).
4. For the intended operator only, add `admin` alongside `reader` in the
   application's grant. Preserve all other identities, wallets and grants.
5. Check and apply that reviewed file. A changed policy revokes existing
   sessions and outstanding temporary authority; sign in again.

Example grant fragment, not a complete policy:

```json
{
  "grants": {
    "demo": ["reader", "admin"]
  }
}
```

Do not replace a populated policy with the empty example. The migration never
promotes existing users automatically.

## Walkthrough: owner and collaborator

Use two browser profiles, or separate browsers, so the owner and collaborator
have different session cookies. Each profile needs its own available wallet.

1. **Owner:** sign in with the configured administrator wallet.
2. In **Temporary invitations**, choose the network, enter the collaborator's
   public address and select 30 minutes. Create the invitation.
3. Send the collaborator the normal demo URL. It contains no secret token.
4. **Collaborator:** open that URL in their own profile and sign in using the
   invited wallet. The session receives `reader` and ends no later than the
   invitation deadline.
5. Request a simulated deployment, for example `website`, `v1.2.3`, `staging`.
6. **Owner:** click Refresh, review the request and click **Sign approval**.
   Read the wallet message: project, version, environment, action ID and payload
   hash belong to this request. Approve with the same wallet account as the
   administrator session. If the application requires more than one approval,
   repeat this step with distinct administrator identities until the threshold
   is met.
7. **Collaborator:** click Refresh and **Execute simulation once**. A receipt
   appears. A repeated API call is rejected; the UI no longer offers execution.
8. **Owner:** revoke the invitation. The collaborator's existing session loses
   access immediately, including through the protected application's proxy.

With the default threshold of one, an administrator can request, approve and
execute their own action. Set **Approvals required** to two or more on the
application definition when separation of duties is required. A user signing out
cannot transfer an existing request to their next session.

## Invitation semantics

An invitation is a time-limited reader grant for one canonical wallet address
and one application. Its validity begins when created, not when first opened.
The allowed duration is 5–1,440 minutes; the UI offers 30 minutes, one hour,
four hours and one day. `acceptedAt` records its first successful login. The
same wallet may sign in again while the grant remains valid; this is not a
single-use invite link.

The URL is only a route to login. Possessing or forwarding it proves nothing.
The wallet signature supplies the ownership proof. Invitation UUIDs are
metadata, not credentials.

A wallet already present anywhere in the static policy cannot receive a dynamic
invitation. This prevents an invitation from bypassing disabled wallets or
static application restrictions. Invitations only work for applications whose
required roles are empty or contain only `reader`; the creating administrator
must also have `reader`. They never grant administrator access.

Revocation and expiry are checked live. A renewed invitation creates a new guest
identity; it does not revive old sessions. Changes to the static policy revoke
all invitations. Server restarts alone preserve them.

## Action lifecycle

```mermaid
stateDiagram-v2
    [*] --> pending: Request exact payload
    pending --> pending: Distinct proof below threshold
    pending --> approved: Required live proofs reached
    approved --> executed: Original session commits simulation
    pending --> canceled: Cancel, policy change or restore
    approved --> canceled: Cancel, policy change or restore
    pending --> expired: Deadline or session invalidation
    approved --> expired: Deadline or either session invalidation
```

`expired` is a computed API state. The database retains the original pending or
approved record for history, while the API refuses further execution.

The canonical payload is JSON in this exact property order:

```json
{ "project": "website", "version": "v1.2.3", "environment": "staging" }
```

The server computes SHA-256 over its UTF-8 bytes. Project and version are 1–64
ASCII letters, digits, dots, underscores or hyphens, beginning with a letter or
digit. Environment is `preview`, `staging` or `production`; all three are
simulated. There is no payload-edit endpoint. Cancel and create a new request to
change it.

The signed message contains a human-readable deployment statement and resources
`urn:gozne:action:<UUID>` and `urn:gozne:sha256:<hash>`, in addition to the
application resource. SIWE/SIWS also bind wallet, domain, origin URI, chain,
nonce, issue time and expiry. It cannot be replaced with a login signature.

A request lasts at most 30 minutes and never outlives its requesting session. An
approval challenge lasts at most five minutes, capped by both the request and
administrator session. Each approval remains valid only until **its own
challenge deadline**; signing near expiry does not grant another five minutes.
An application requires between one and ten distinct administrator identities.
The request snapshots that threshold, so later display and audit history remain
unambiguous. A second session or wallet belonging to the same identity cannot
add another approval. The action becomes executable only while the full set of
required approvals and the original requesting session remain live.

Issuing another challenge for the same action and administrator session replaces
the previous one. A matched invalid proof consumes its challenge; a new
challenge can be requested while the action is pending. An identity with a live
recorded approval cannot sign the same action again. If that approval expires or
its session is revoked before the threshold is reached, the identity may provide
a fresh proof. All sessions and permissions are rechecked at execution. Logout,
revocation or expiry can invalidate a previously approved action.

## API examples

Use the same-origin browser session cookie automatically and the `csrfToken`
returned by `/v1/auth/me` in `X-CSRF-Token` for every POST. Bodies are strict;
unknown fields are rejected. All requests use the session's application.

| Endpoint                                        | Body                                                             | Result                                                           |
| ----------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| `GET /v1/auth/control`                          | None                                                             | Actions, invitation/session metadata for admins, recent receipts |
| `GET /v1/auth/control/audit`                    | Query: `limit`, `before`, optional exact `event`                 | Administrator-only, application-scoped audit page                |
| `POST /v1/auth/control/invitations`             | `{"network":"evm","address":"YOUR_PUBLIC_ADDRESS","minutes":30}` | Invitation ID, address, expiry, reader role and normal login URL |
| `POST /v1/auth/control/invitations/{id}/revoke` | `{}`                                                             | `{"ok":true}`                                                    |
| `POST /v1/auth/control/actions`                 | Canonical payload fields above                                   | Pending action and payload hash                                  |
| `POST /v1/auth/control/actions/{id}/challenge`  | `{"chainId":"1"}`                                                | Exact message, nonce, expiry; SIWS input for Solana              |
| `POST /v1/auth/control/actions/{id}/approve`    | `{"nonce":"…","message":"…","signature":"…"}`                    | Updated action and approval progress                             |
| `POST /v1/auth/control/actions/{id}/execute`    | `{}`                                                             | Executed action and simulated receipt                            |
| `POST /v1/auth/control/actions/{id}/cancel`     | `{}`                                                             | `{"ok":true}`                                                    |

EVM signatures use `personal_sign` encoding; Solana uses `signIn` and base64
Ed25519 signatures. The full contract is in [OpenAPI](../openapi.yaml).

Administrators see recent actions for their application; readers see only
actions from their current requesting session. All authorized users see recent
simulated deployment receipts for that application. Invitation addresses and
active-session metadata are administrator-only. Raw session hashes are never
returned.

## Execution and integration limits

The simulation inserts one `demo_deployments` row keyed by action ID, changes
the action status and appends an audit event in one transaction. Concurrent
calls produce one effect; a second execution returns `409`. If the audit or
storage write fails, the effect and status change roll back and execution can be
retried.

This guarantees one recorded simulation per action in the current database
history. It does not prevent creating a new action for the same payload.

When the private server uses webhook mode, a newly requested action snapshots
that mode and its approval message says the exact payload will be delivered.
Execution creates a short opaque lease, sends the HMAC-authenticated request and
uses the action ID as its idempotency key. Failed calls are auditable and can be
retried up to five times. The receiver must durably deduplicate that key because
the distributed guarantee is at least once. See
[Signed action webhooks](16-ACTION-WEBHOOKS.md).

The audit stream stores the application, event, actor identity, public session
ID and time. The private panel can filter exact event types and page backwards
through the history. Every query requires an administrator session and is
restricted to that session's application. Session tokens, token hashes, full
signatures and signed payloads are not returned or stored in the audit record;
action and invitation tables hold the operation details. Events are retained for
up to 30 days and the global audit table is capped at 50,000 rows. A deployment
receipt is operational evidence in the trusted database, not a standalone
cryptographic certificate.

The dashboard supports automatic updates and bounded recent lists. Counters
describe loaded records, not lifetime totals. The audit retention window is not
an archival system; export records externally if policy requires longer
retention. See [operational limits](08-OPERATIONS.md#current-limits).

Restoration invalidates every invitation and pending approval and marks a
captured in-flight delivery failed. See [recovery](09-RECOVERY.md). Scoped agent
delegation, passkeys, OIDC and provider-specific deployment adapters remain on
the [roadmap](06-ROADMAP.md).

## Active sessions and automatic updates

Administrators can inspect up to 100 active sessions for the current
application, including the identity, network, public address and session
deadlines. **Revoke session** immediately closes that session's authority,
including outstanding approvals signed by it. The current session is labeled
**This session**; use **Sign out** to close it. Revoking a guest session does
not revoke the invitation: that wallet can sign in again until its invitation is
revoked or expires.

`POST /v1/auth/control/sessions/{id}/revoke` accepts `{}` and requires the same
session, Origin and CSRF protections as other mutations. Only administrators can
revoke another session in their application. Missing, expired, already-revoked
or foreign-application sessions return `404`; the caller's own session returns
`409 USE_LOGOUT`. Revocation and the administrator audit event share one commit.

Each overview action includes `requiredApprovals`, the number of currently valid
approvals in `approvalCount`, the non-secret approval records in `approvals`,
and `permissions.approve`, `permissions.execute` and `permissions.cancel`. These
describe the current session's available controls; execution authority is never
inferred from matching identity names. The server still revalidates every
mutation.

Auto-refresh runs every 30 seconds while signed in, enabled and visible. It
skips wallet interactions and other pending operations. Turn it off with the
checkbox or refresh manually. Failed background requests back off to 60 and then
120 seconds; a successful refresh resets the interval. An invalid session clears
the workspace and stops polling. The panel does not extend a session's lifetime.

## Permanent users, wallets and application roles

**Users & wallets** manages the static policy for the signed-in administrator's
application. Use **Reload users**, choose an existing identity or **Create a new
user**, enter its ID, assign roles and add public EVM/Solana wallet addresses.
Each wallet can be enabled, disabled or removed. Save related edits together.
IDs cannot be renamed. Clearing all roles revokes permanent access to this
application while retaining the identity for later reauthorization; the panel
has no destructive identity-delete operation.

A nonempty grant must include every role required by the application. `admin`
gives administrative privileges for this application; `reader` is ordinary
access in the example. The panel prevents removing the current administrator's
role or disabling/removing the wallet used by that session. The first operator
still needs local CLI bootstrap; public visitors cannot create an administrator.

Wallets belong to global identities in the current policy model. If an identity
has a grant entry for another application, its wallet list is read-only here.
You can change its roles in the current application without changing its other
grants. Use the privileged CLI to manage shared wallets. Identity IDs and wallet
addresses cannot be silently taken over from an existing unrelated identity.

Saving is an atomic, validated policy update with an optimistic revision check.
A stale editor receives `409 POLICY_CONFLICT`; reload and review before
retrying. The operator's live administrator session is checked again inside the
write transaction. Invalid addresses, duplicate wallets and failed audit writes
leave the previous policy and sessions intact. Identical edits are a no-op.

**An effective policy change invalidates all sessions, invitations and pending
approvals across the Gozne instance**, including the administrator's session.
The panel explains this before saving and returns to sign-in afterward. This is
the same conservative behavior as CLI policy imports; it is not limited to the
edited user's sessions. In contrast, the session and invitation revocation
buttons act on their individual targets.

### JSON API

- `GET /v1/auth/control/users`: administrator-only directory containing
  `revision`, `application`, `requiredRoles` and `users`. Each user includes
  `id`, `wallets`, current-application `roles` and `walletsEditable`.
- `POST /v1/auth/control/users`: accepts `revision`, `create`, `id`, a full
  `wallets` array (`network`, `address`, `enabled`) and current-application
  `roles`. Origin, session cookie and CSRF are required. It returns `changed`
  and `reauthenticationRequired`.

The server chooses the application from the session, not from submitted JSON.
The directory is deliberately loaded on sign-in or explicit reload, so
background refresh does not overwrite an unsaved editor. It contains at most the
policy's 1,000 identities, with at most 20 wallets and 20 roles per
identity/application. Full policy export and cross-application wallet changes
remain local CLI operations. Application definitions are managed by explicitly
authorized [application managers](13-APPLICATIONS.md).

## Resource authorization editor

Administrators can define the current application's permission catalog, role
bundles, resource hierarchy and scoped grants in one revision-checked form. The
access inspector evaluates an identity, permission and resource without changing
policy and explains the matching application role, scoped role or deny reason. A
save uses the same global session invalidation rules described above.

The editor uses compact line formats so the complete model remains visible for
review. Permissions use one line each. Roles use `role: permission, permission`.
Resources use `type:id` or `type:id > parent-type:parent-id`. Grants use
`identity | role | resource | optional ISO expiry | optional ISO start | environments | maximum amount`.
Empty optional columns stay between `|` separators. Amounts are non-negative
integers in application-defined minor units. The server parses none of these
strings directly: the browser converts them to the strict JSON contract, which
the server validates again. See
[resource authorization](17-RESOURCE-AUTHORIZATION.md) for policy examples and
the application service API.

### Deployment boundary

The panel and its JSON API now run in separate containers from public sign-in.
The public API does not register control routes, and the public proxy does not
serve panel assets. Both Compose variants publish administration on loopback
only, at `https://127.0.0.1:9443`. See the complete
[private administration guide](12-PRIVATE-ADMINISTRATION.md).

Panel sessions sign the application's `adminOrigin`. Public sessions sign its
`origin`; cookies, proofs and sessions cannot be moved between surfaces. Each
browser page calls its own same-origin API, without privileged JavaScript API
keys. Administration mutations still require an admin role and CSRF.

The invitations link to the **public application**. A collaborator can sign in
there without network access to administration. The signed-action simulation now
lives inside the private workspace: readers need internal network access and a
separate workspace sign-in to request or execute a simulated action.

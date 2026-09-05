# Threat model and security

Gozne protects application access, wallet-to-identity mappings, permissions,
sessions, approval state and audit records. It does not hold keys or protect
funds. A compromised authorized wallet can impersonate its owner until the
operator disables it. A compromised host or same-origin script is outside the
protection offered by wallet signatures.

## Controls

| Threat                               | Implemented control                                                 |
| ------------------------------------ | ------------------------------------------------------------------- |
| Replayed login signature             | Unique nonce, short TTL, browser binding and atomic consumption     |
| Valid signature for another site     | Exact domain, URI, origin, application and chain binding            |
| Altered message                      | Exact comparison with the server-issued message                     |
| Public wallet enumeration            | Uniform invalid-proof response and bounded delay                    |
| Stolen session                       | Secure host-only HttpOnly cookie, rotation, TTL and live revocation |
| CSRF                                 | SameSite, exact Origin, Fetch Metadata and session CSRF token       |
| Forged proxy identity                | Explicit header allowlist at the reverse proxy                      |
| Invitation forwarding                | Authorization bound to the invited public address                   |
| Invitation bypass of disabled wallet | Static policy takes precedence over guest access                    |
| Privilege escalation                 | Live server-side application roles; guests cannot grant admin       |
| Reused or substituted approval       | Fresh nonce, action ID, exact payload hash, signer/session binding  |
| Double execution                     | Effect, consumption and audit in the same SQLite transaction        |
| Revoked requester or signer          | Both sessions rechecked before execution                            |
| Failed persistence                   | Roll back and deny; no successful response before commit            |
| API abuse                            | Per-IP rate limits, nonce limits and pending-action limits          |
| XSS in the example panel             | Local scripts, strict CSP, text-only DOM insertion                  |
| Secret leakage in logs               | No request URLs, bodies, cookies, signatures or IPs logged          |

## Action-specific boundaries

Action signatures approve a **simulation**, not an on-chain or hosting-provider
transaction. Project, version and environment are immutable after creation. The
statement displays these fields; resources bind an action UUID and SHA-256 of
canonical JSON. Login and action messages are different and cannot be reused
interchangeably.

The approval challenge is bound to the administrator's current session. Invalid
proofs consume a matched action nonce. Another session cannot consume it. The
server rechecks state after cryptographic verification and at execution.

The original requesting session must remain live. Signing out and signing back
in creates a different session and does not transfer execution rights. The
approver's session must remain live and retain `admin`. A normal restart
preserves valid approvals, while policy changes and explicit restoration
invalidate them.

The owner may approve their own request. There is no two-person rule, quorum,
agent delegation or external execution capability in this alpha.

## Administrative access

The starter policy authorizes no wallet. Attaching a wallet to its administrator
identity is a deliberate local CLI operation. Existing users are not
automatically promoted by a database migration.

Permanent user writes require an administrator, an unchanged policy revision,
and a second live authorization check inside the transaction. The API cannot
edit another application's grants or mutate shared identity wallets. Current
operator lockout is rejected. Policy-write failure rolls back invalidation.

The panel and control API use private ingress; neither is served by the public
authentication proxy. The public API registers no control routes. Distinct HTTPS
hostnames and server-side audience checks prevent public cookies or proofs from
being reused on the administration listener. See
[private administration](12-PRIVATE-ADMINISTRATION.md). The control API requires
authentication; only session-scoped administrator routes expose invitation and
session metadata. All mutations require CSRF and exact origin checks. The CLI
and database volume remain privileged local surfaces. Protect them with
operating-system permissions.

## Persistence and recovery

Schema migrations use checksums and transactions. Backup publication rejects
existing destinations, symlinks and leftover SQLite sidecars. Restore clears
sessions and challenges, revokes invitations and cancels pending/approved
actions. It preserves the snapshot's policy, which must be reviewed before
activation: a historical policy may authorize a subsequently disabled wallet.

The exactly-once claim is limited to one simulation action in one SQLite
history. It is not a guarantee for external services, arbitrary database
tampering, restoring files outside the supported command, or creating a new
action with the same payload. The host's filesystem and clock must behave
correctly.

## Runtime and release requirements

Containers run as non-root with dropped capabilities, no new privileges and a
read-only root filesystem; only explicitly mounted state is writable. Gateway
and protected app need a private network boundary. OrbStack's convenience
domains are for development, not production isolation.

CI checks secrets, dependencies and HIGH/CRITICAL findings in the gateway image.
A stable release also needs a license, attribution review, independent security
review, browser compatibility evidence and broader failure testing. Current
checks do not constitute a cryptographic audit or a complete production
assessment.

See [verification](10-VERIFICATION.md) for exercised scenarios and limitations.
Report vulnerabilities through [SECURITY.md](../SECURITY.md).

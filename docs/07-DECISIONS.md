# Architecture decisions

These decisions describe the implemented alpha. Public source availability does
not make the current build a stable release.

## D-001 — Independent project

Accepted. New repository and history; private references remain outside the
public project.

## D-002 — No custody or blockchain transactions

Accepted. Authentication and approvals use message signatures. Gozne stores no
private keys or seed phrases and requests no blockchain transactions.

## D-003 — Modular monolith

Accepted. One application with internal modules. A separate core package should
follow a real second consumer, not precede it.

## D-004 — Local policy administration, scoped web controls

Implemented. The CLI owns policy, identity and wallet administration, diagnosis,
session revocation and audit export. The web panel manages invitations and
simulated actions through authenticated, application-scoped endpoints. It cannot
edit arbitrary policy or promote a guest to administrator.

## D-005 — Node.js and TypeScript

Node.js 24.20.0, strict TypeScript and ESM output. Exact dependency versions are
in `package.json` and `package-lock.json`; TypeScript stays within the supported
range of the configured lint tooling.

## D-006 — SQLite

A small adapter over `node:sqlite` uses WAL, `FULL` synchronous mode, a
one-second writer timeout and `BEGIN IMMEDIATE` transactions. Migration
checksums reject changed history; a binary rejects a database newer than itself.

Synchronous database operations block the event loop. This design targets one
instance and short operations, not high concurrency. Schema 3 adds invitation
and action state. `/healthz` checks reads, not write availability.

Reference: [Node SQLite documentation](https://nodejs.org/api/sqlite.html).

## D-007 — Opaque sessions

Implemented. Random 256-bit cookies with hashes in SQLite. Sessions last at most
one hour, are revocable and consult live policy. Guest sessions are also bounded
by their invitation deadline.

## D-008 — Policy as explicit state

SQLite is authoritative. Full validated JSON imports are atomic; CLI edits use
optimistic concurrency. A changed policy invalidates sessions, invitations and
pending approvals. Identical imports are no-ops. No automatic file watching.

## D-009 — Fastify

Fastify 5 provides route validation, TypeScript support and HTTP injection
tests. Only used dependencies are installed. Forwarding headers are not trusted,
CORS is not opened, and request logs omit URLs, bodies, cookies and IP
addresses.

References:
[validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/)
and [support policy](https://fastify.dev/docs/latest/Reference/LTS/).

## D-010 — Exact SIWE and SIWS proofs

`siwe` and `ethers` verify EVM EOA signatures. Wallet Standard supplies SIWS
formatting and `@noble/curves` performs strict Ed25519 verification. Free-form
message fallbacks and smart wallets are not supported.

Login binds a random browser context; action challenges bind an authenticated
administrator session. The final transaction rechecks state after asynchronous
cryptographic verification. Persistence failure never issues a successful cookie
or records a partial execution.

References: [SIWE](https://docs.login.xyz/) and
[Sign-In With Solana](https://github.com/phantom/sign-in-with-solana).

## D-011 — License

Pending. The public repository does not yet grant an open-source license.
`private: true` prevents accidental npm publication; it does not control GitHub
visibility. No license is implied by this documentation.

## D-012 — Name

Gozne is the working name. Trademark and commercial-use validation remain
pending before a stable release.

## D-013 — Static panel, no additional frontend framework

HTML, CSS and browser JavaScript are sufficient for this small API-driven panel.
Astro would introduce another toolchain without a current rendering requirement.
[Tabler](https://tabler.io/admin-template) was reviewed for dashboard structure;
the implementation is original and does not add Bootstrap, a CDN or a template
license dependency. Revisit this choice if routing and client state grow
complex.

## D-014 — Wallet-bound invitations, no bearer invitation token

An invitation grants reader access to one otherwise unconfigured wallet for one
application. The shared URL is the normal login page. The recipient proves
wallet ownership at login, so no secret invitation token needs storage or
delivery. Acceptance means the first successful login, not a separate redemption
action.

## D-015 — Approvals and simulation share a database commit

The only adapter records a synthetic deployment receipt. Its effect and action
consumption are committed together, making concurrent execution reject
duplicates. An external deployment integration must provide its own
idempotency/delivery model; do not describe this local guarantee as distributed
exactly-once execution.

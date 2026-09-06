# Roadmap and delivery criteria

## Completed foundation

- [x] Independent repository, product scope and architecture documentation.
- [x] Node.js 24, strict TypeScript, formatting, lint and tests.
- [x] Fastify API, SQLite migrations, non-root Docker and Compose.
- [x] SIWE for EVM EOAs and standardized Sign-In With Solana.
- [x] Browser-bound nonces, opaque sessions and application roles.
- [x] Local administrative CLI and Nginx forward-auth.
- [x] Transaction failure tests, live backup and safe restore.
- [x] HTTPS integration, image scanning, CycloneDX inventories and secret scans.
- [x] SIGKILL/WAL, real ENOSPC and short concurrency tests.

## First control-panel MVP

- [x] Responsive local-asset panel with explicit wallet selection.
- [x] Wallet-bound reader invitations with expiry and revocation.
- [x] Exact signed action payload, expiry and one-time simulation execution.
- [x] Administrator/collaborator walkthrough and HTTPS integration test.
- [x] Schema migration and restoration rules for invitations and approvals.
- [x] English README, API documentation and operator guides.
- [x] English and Spanish browser interfaces with persistent locale selection.

This MVP records simulated deployment receipts. It does not execute a real
deployment, require multiple approvers or provide cross-domain SSO.

## Application integration and administration

- [x] Private panel/API containers, separate session audiences and loopback demo
      ingress.
- [x] Permanent user, wallet and role management.
- [x] Read-only deployment diagnostics and TLS expiry checks.
- [x] Operator-controlled application definitions and workspace switching.
- [x] Configurable multi-person approval thresholds for sensitive actions.
- [x] Hash-chained audit exports with offline digest verification.
- [x] HMAC-signed action webhook with idempotency, leases and bounded retries.
- [x] Independent QUIQUE.ES workspace integration with full HTTPS tests.
- [x] Extract the QUIQUE.ES product source into its own local project while
      preserving the mandatory Gozne contract.
- [ ] Switch the production protected upstream to the independent application
      image after cross-repository verification.
- [x] Deploy the public/private origins on the target infrastructure and verify
      external isolation.

## Before a stable release

- [ ] Validate the Gozne name and choose a distribution license.
- [ ] Complete attribution review and independent security review.
- [ ] Test real wallet extensions and supported browser versions.
- [ ] Run prolonged load tests and broader storage/power-loss scenarios.
- [ ] Demonstrate an independent application integration and full recovery
      drill.
- [ ] Establish binary reproducibility, signed artifacts and release checksums.
- [x] Add bounded audit retention and cursor pagination in the private panel.
- [ ] Review operational scale before larger deployments.

## Later product work

Prioritize from actual integrations rather than adding every authentication
feature:

1. Provider-specific action adapters and reconciliation beyond the generic
   signed webhook.
2. Scoped and expiring delegation, including agent use cases.
3. Wallet linking and replacement; WalletConnect and mobile support.
4. Smart-wallet verification and optional passkey step-up.
5. OIDC Authorization Code + PKCE for existing applications.
6. PostgreSQL or high availability when a deployment requires it.

## Definition of a stable delivery

Functional and security tests pass in CI and the runtime image. No HIGH or
CRITICAL gateway-image findings remain at publication time. Setup, upgrade,
backup and recovery are demonstrated. Documentation matches behavior,
limitations are explicit, and examples contain no real user data. A public
security channel, license and independently reviewed release process are in
place.

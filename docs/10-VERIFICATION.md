# Verification and alpha evidence

The Research Lab milestone 4 cross-repository HTTPS run on 6 September 2026 also
verified the unchanged Gozne boundary for accounting: a reader forging `admin`
was denied, while an authenticated admin recorded an exact balanced
funding/allocation and a reader retrieved the exact fund totals. The same run
retained the existing origin, CSRF, header sanitation, evidence streaming,
logout and revocation checks.

Pushes and pull requests run formatting, lint, compilation, tests, dependency
audit, secret scanning and HTTPS integration on Linux. Installation uses the
lockfile without lifecycle scripts. Images and CI actions are pinned by digest
or commit.

## Local checks

```sh
npm run check
npm audit --audit-level=moderate
docker build -t gozne:dev .
node scripts/smoke-container.mjs
node scripts/test-proxy.mjs
node scripts/test-resilience.mjs
```

The unit/injection suite covers EVM and SIWS signatures, concurrent replay,
browser isolation, expiry, application roles, CSRF and forged headers. It forces
session/audit write failures and a SQLite writer lock, checking that
transactions leave no partial nonce consumption or successful cookie. Failed
policy or logout audit writes preserve prior state.

Audit export tests verify deterministic sealing, offline CLI operation, an
externally supplied digest and rejection of edited, deleted or reordered event
records.

Control tests cover wallet-bound invitation login, wrong-wallet rejection, guest
restrictions, cross-application isolation, fresh signatures, altered payload
statements, signature replay, Solana approval, concurrent one-time execution,
revocation, expiry, approver logout and rollback of failed execution audit
writes. Recovery from a pre-execution backup cancels its approval and revokes
the guest invitation.

The HTTPS suite creates ephemeral wallets and a temporary trusted test CA, uses
Nginx, and checks both networks, stripped headers, CLI revocation, logout and
failure closure. It also exercises an owner inviting a guest, the guest logging
in and requesting an action, the owner signing, one-time execution and
invitation revocation. It uses isolated Compose resources and removes only those
resources.

Panel tests also exercise session-scoped action controls, automatic refresh,
hidden-tab suppression, retry backoff and clearing an invalid session. Session
revocation tests cover cross-application isolation, CSRF, administrator roles
and audit-write rollback. HTTPS integration also revokes a guest session through
the control API and checks that the proxy denies its next request.

## Crash, full storage and concurrency

`test-resilience.mjs` requires a built `gozne:dev` image and installed npm
dependencies. Randomly named containers and ephemeral wallets keep it separate
from the demo volume. Its helper worker is mounted only for these tests and
requires an explicit test environment flag. Test resources are cleaned up.

Three scenarios are exercised:

- **SIGKILL with WAL writes:** a helper opens a transaction, modifies a session
  and forces uncommitted pages into WAL. The entire container is killed. Restart
  must roll back those writes and pass `quick_check`. A second kill verifies
  that a previously committed revocation and consumed nonce survive. This does
  not interrupt every possible instruction in the login implementation.
- **Full storage:** an 8 MiB tmpfs is filled until a real `ENOSPC` occurs after
  checkpointing. Login, logout and policy mutation must fail without successful
  cookies or partial writes. Freeing space permits reuse of the original
  challenge and successful logout without restart. This is a filesystem-full
  test, not power loss or physical disk failure.
- **Concurrency:** eight clients make 40 baseline validations, then requests for
  15 seconds with a 50 ms pause per client. Only `200` and `429` are accepted,
  the IP quota is checked, and health reads stay available. A later revocation
  must survive restart.

These tests use loopback HTTP with synthetic cookies to isolate gateway
behavior. The separate proxy suite checks actual HTTPS. Crash/ENOSPC scenarios
focus on authentication state; action-specific write rollback is covered by
injection tests, not by every physical-failure scenario.

`reports/resilience.json` records image ID, dates, counts and p50/p95/maximum
latencies, including failure results without cookies, signatures or wallet
addresses. CI attaches it to `security-reports`. Latencies depend on the host;
many overloaded requests may be `429` rejections, so these numbers are not a
successful-authentication throughput benchmark or a prolonged load test.

Real browser/extension compatibility, prolonged load, power-loss behavior and
external security review remain open. Mocked Rabby/MetaMask providers check
selection behavior; they do not certify installed extension versions.

## Inventories and image scanning

```sh
mkdir -p reports
npm sbom --omit=dev --sbom-format=cyclonedx > reports/dependencies.cdx.json
sh scripts/scan-image.sh
```

The npm inventory lists production dependencies. Trivy scans an exported archive
of `gozne:dev` without access to the Docker socket. It writes `image-scan.json`
and `image.cdx.json` including OS and application packages. Any HIGH or CRITICAL
finding, even without a fix, fails the step. Download or scanner failures also
fail; they never count as a clean scan. An unchanged image may acquire new
findings as the vulnerability database evolves.

GitHub retains JSON reports in `security-reports` for 30 days, including failed
runs. Databases, real wallets and local state are not uploaded. Generated
reports are excluded from Git.

The gateway image uses digest-pinned Node.js 24.20.0 on Alpine and explicitly
updates `libcrypto3`/`libssl3` to `3.5.8-r0` for CVE-2026-14456. npm and Yarn
are removed from the final image. Linux and HTTPS tests run against this base;
adding native modules requires revisiting musl compatibility.

This does not yet establish binary reproducibility or signed releases. The
demo's Nginx image is separate and is not included in the `gozne:dev` scan.

References: [npm SBOM](https://docs.npmjs.com/cli/v11/commands/npm-sbom) and
[Trivy image scanning](https://trivy.dev/docs/dev/references/configuration/cli/trivy_image/).

## Private administration boundary

Unit tests exercise two API instances against separate connections to the same
SQLite file, verifying public route absence, cross-surface proof/session denial,
policy visibility and invalidation. Hostname validation rejects port-only
separation and overlap with another application's public hostname.

The HTTPS test starts separate public and internal proxy containers, verifies
loopback publication and disjoint network membership, checks public dashboard
assets/control routes return 404, then uses independent signed private sessions
for invitations, user management and simulated actions. Public wallet login and
protected application access remain part of the same test.

The HTTPS integration test also runs the deployment diagnostic against its
isolated Compose project. A healthy deployment must pass; stopping `admin-api`
must fail the diagnostic while public health remains successful. Unit tests
cover all-interface port bindings, published API ports, shared networks,
incorrect surfaces, frontend state mounts, missing/duplicate/stopped services
and certificate warning/expiry boundaries.

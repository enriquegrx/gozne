# Operating the alpha

## OrbStack demo

From the repository root with OrbStack running:

```sh
sh scripts/demo-certs.sh
docker compose -f examples/compose/orbstack.yaml up --build -d --wait
docker compose -f examples/compose/orbstack.yaml exec gateway gozne policy apply /app/policy.json
docker compose -f examples/compose/orbstack.yaml exec gateway gozne wallet attach example-user evm YOUR_PUBLIC_ADDRESS
```

Open [https://gozne.orb.local](https://gozne.orb.local). OrbStack terminates TLS
in front of the demo's Nginx and may ask you to install its local certificate.
The initial `example-user` has `reader` and `admin` grants for `demo`, but no
wallet is authorized until you explicitly attach its public address.

Use `solana` in the command for a Solana address. The browser must have the
chosen extension installed and enabled for this site. EVM discovery uses
EIP-6963, including Rabby, MetaMask and other compatible providers. The selector
never falls back to `window.ethereum`. Solana uses Phantom's `signIn` support.
Use the HTTPS URL, not the HTML file directly.

The example EVM chain is Ethereum mainnet (`1`); Solana allows mainnet and
devnet. These are message signatures, not transactions. Protocol support and
synthetic provider tests do not certify every extension version. See
[Rabby's integration guidance](https://rabby.io/docs/integrating-rabby-wallet).

The `gozne-demo_state` volume persists policy and operational state. `down`
stops the demo; `down -v` deletes its volume. Never reapply an empty starter
policy after adding users. Use the [panel walkthrough](11-CONTROL-PANEL.md)
next.

## Portable HTTPS demo

```sh
sh scripts/demo-certs.sh
docker compose -f examples/compose/compose.yaml up --build -d --wait
docker compose -f examples/compose/compose.yaml exec gateway gozne policy apply /app/policy.json
docker compose -f examples/compose/compose.yaml exec gateway gozne wallet attach example-user evm YOUR_PUBLIC_ADDRESS
```

Open [https://localhost:8443](https://localhost:8443). The generated self-signed
certificate lasts seven days. Review and trust it locally for browser testing;
it is not a deployment certificate. Both demo variants share a Compose project
name, so stop one before starting the other and use the correct origin policy.

## Private administration

Both Compose variants now run a separate `admin-panel` and `admin-api`. Open
`https://127.0.0.1:9443` after reviewing/trusting the local demo certificate.
Public sign-in stays at the public application URL. The two hostnames must be
different, since browser cookies are not isolated by port.

For upgrades, private networking, TLS and SSH access, follow
[Private administration](12-PRIVATE-ADMINISTRATION.md). Do not reapply the
starter policy to add `adminOrigin`; export and edit the existing policy
instead.

## Policy and CLI

SQLite is authoritative; a mounted policy file is not watched. Export the live
policy before editing so CLI-added wallets are preserved:

```sh
umask 077
docker compose -f examples/compose/orbstack.yaml exec -T gateway gozne policy export --json > policy.local.json
```

Edit the private file, then copy and apply it:

```sh
docker compose -f examples/compose/orbstack.yaml exec -T gateway sh -c 'umask 077; cat > /app/state/policy-import.json' < policy.local.json
docker compose -f examples/compose/orbstack.yaml exec gateway gozne policy check /app/state/policy-import.json
docker compose -f examples/compose/orbstack.yaml exec gateway gozne policy apply /app/state/policy-import.json
```

An identity needs a nonempty explicit grant and every application
`requiredRole`. `identity add` creates an identity with no grants; edit the
exported policy to assign them. Invalid policy imports preserve the previous
document. Adding `admin` grants control privileges only for that application.
Never grant it to a collaborator who should only have reader access.

Available commands, run as `gozne` in the container:

```text
config check
policy check FILE
policy apply FILE
policy export
identity list
identity add ID
wallet attach ID evm ADDRESS
wallet disable evm ADDRESS
session list
session revoke SESSION_ID
audit export
database backup NEW_FILE
database restore BACKUP NEW_FILE
doctor
```

Use `--help` for arguments and `--json` for machine-readable output. Session IDs
are public audit identifiers, not usable cookies. Policy changes invalidate all
sessions, invitations and pending approvals. An identical policy import is a
no-op; CLI edits detect concurrent changes.

`audit export` includes each event's application where it is known. Interactive
administrators see only their current application's events through the private
API and panel. The database keeps at most 50,000 audit rows and removes rows
older than 30 days as new events are written; export to an external archive when
longer retention is required.

## Proxy integration

Login, API and application share an HTTPS origin. Cookies are host-only; this
alpha does not provide cross-domain SSO. Nginx internally validates the `demo`
session before serving `/private/`, then forwards verified identity, roles,
application and public session ID. It strips client-supplied identity headers
and does not forward the authentication cookie to the synthetic app.

In a deployment, gateway and protected app must only be reachable through a
trusted private boundary. OrbStack's automatic local domains are a development
convenience, not production network isolation. Keep `validate` private. Nginx
fails closed if Gozne is unavailable and may return `500` for a failed
`auth_request`. `/healthz` checks database reads, not writes or policy
readiness.

The demo panel assumes `application: 'demo'`. To reuse it for another app,
update that client identifier, the policy origin and the proxy validation
application together. Login messages, sessions and action proofs are all
application-bound.

## Current limits

One instance, local SQLite and a correct server clock are required. Login
challenges last five minutes. Sessions last at most one hour without automatic
refresh. Reader invitations last 5–1,440 minutes. Action requests last at most
30 minutes and approval challenges at most five minutes, capped by session and
request deadlines.

Nonce, verification and action-proof routes have per-route limits of 20 requests
per minute per IP; other authentication/control routes use 120. Counters are in
memory. Gozne does not trust `X-Forwarded-For`, so users behind Nginx share its
IP quota. Size and review these limits before expanding use.

Storage limits: 1,000 login nonces, five per browser context during TTL
including consumed challenges; 10,000 unexpired sessions; 1,000 live
invitations; 1,000 unexpired pending/approved actions globally and 20 per
requesting identity and application; 1,000 action challenges. Audit is capped at
50,000 events and 30 days. Expired login nonces/sessions are pruned when new
challenges are issued. Action challenges are pruned when new action challenges
are issued.

Action, invitation and receipt history is retained in SQLite without automatic
archival. Monitor volume growth. The overview returns at most 100 recent
actions, 100 invitations, 100 sessions and 20 receipts. Dashboard counters
reflect these returned windows, not lifetime totals. There is no pagination or
server push. Visible signed-in panels poll every 30 seconds by default (four
requests/minute for session and overview checks), with backoff on errors.
Disable auto-refresh when many users share a constrained proxy quota. Manual
Refresh remains available.

SQLite contains addresses, policy, challenge messages and operation metadata.
Protect the volume and backups. Request logs omit signatures, cookies, bodies,
URLs and IPs. See [recovery](09-RECOVERY.md) and
[verification](10-VERIFICATION.md). Downgrading a migrated database is
unsupported.

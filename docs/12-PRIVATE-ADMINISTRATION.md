# Private administration

Gozne separates public wallet sign-in from the workspace that manages users,
wallets, roles, invitations, sessions and signed simulation actions.

## Deployed layout

```text
Public browser → public HTTPS proxy → gateway (GOZNE_SURFACE=public)
                         │                         │
                         └→ protected demo app     │
                                                   ├→ local SQLite volume
Local/VPN browser → private HTTPS panel → admin-api │
                                      (GOZNE_SURFACE=admin)
```

The browser talks JSON/HTTP to its own HTTPS origin. The private Nginx panel
proxies API requests to `admin-api`; there is no cross-origin browser API key,
CORS bypass, or public route to that service. No frontend has the database
mounted. The two API processes use the same existing local SQLite volume with
WAL and transactional writes, so an administrative change affects public
sessions immediately. Do not put this volume on NFS or mount it across hosts.

| Service       | Network                              | Host publication      |
| ------------- | ------------------------------------ | --------------------- |
| `proxy`       | public entry + public backend        | Public demo URL       |
| `gateway`     | public backend, internal             | None                  |
| `demo-app`    | public backend, internal             | None                  |
| `admin-panel` | admin entry + internal admin backend | `127.0.0.1:9443` only |
| `admin-api`   | admin backend, internal              | None                  |

Public services share no Docker network with the admin API. The public proxy
explicitly returns 404 for control paths and panel assets. The public API itself
does not register control routes, so forwarding around Nginx does not expose
them. The public page contains only wallet login and a link to the private app.

Docker's
[port publishing](https://docs.docker.com/engine/network/port-publishing/) and
[internal networks](https://docs.docker.com/reference/compose-file/networks/)
provide the network boundary. Loopback binding restricts the supplied admin port
to the Docker host. OrbStack additionally offers host-side direct container
access and automatic domain routing; these development features are not an
Internet access policy. Keep its LAN exposure disabled and do not publish or
tunnel an administrative container domain. Host operators and other privileged
processes remain trusted.

## Session separation

An application's existing `origin` is the public sign-in origin. Optional
`adminOrigin` enables private sign-in for that same application:

```json
{
  "id": "demo",
  "origin": "https://gozne.orb.local",
  "adminOrigin": "https://127.0.0.1:9443",
  "evmChainIds": [1],
  "solanaChains": ["solana:mainnet", "solana:devnet"],
  "requiredRoles": ["reader"]
}
```

Both must be canonical HTTPS origins. Admin hostnames must differ from **all**
public application hostnames. A different port alone is insufficient because
cookies are host-scoped, not port-scoped. Each sign-in proof includes the
appropriate origin. The API rejects a proof or session on the other listener,
even if the client manually copies cookies or omits Origin. Missing
`adminOrigin` denies private sign-in without disrupting public login.

The application and existing grants remain the authority: a reader on the
private network cannot administer users or invitations. Mutations require Origin
and CSRF as before. Never rewrite the browser's Origin at a proxy. An invitation
always points to the public origin; the invited user needs no private network
access for public login. Signed simulation actions now require private workspace
access, including a separate sign-in for their requester.

## Run locally

```sh
sh scripts/demo-certs.sh
docker compose -f examples/compose/orbstack.yaml up --build -d --wait
```

On a **new** installation only, apply the starter policy and attach the
operator's public wallet as described in the README. Open:

- Public login: `https://gozne.orb.local` (portable Compose:
  `https://localhost:8443`).
- Internal workspace: `https://127.0.0.1:9443`.

The internal endpoint uses the generated local self-signed certificate, valid
for seven days. Review and trust that certificate locally before wallet testing,
or supply a certificate from your development CA through `DEMO_TLS_DIRECTORY`.
The script preserves existing certificate files. Replace expired development
files deliberately and recreate `admin-panel`; never use these certificates for
production. No global trust setting is modified by Gozne.

`DEMO_ADMIN_PORT` changes the loopback port, but you must update `adminOrigin`
to match. The Compose file deliberately provides no bind-address variable that
could silently publish administration on every interface.

## Upgrade an existing installation

1. Back up the live database and keep a copy outside its volume. Record the old
   image digest. Do not replace the current policy with the empty starter file.
2. Build the new image and generate/provide the internal TLS files. Existing
   schema version 3 is unchanged. Recreate all services with the updated Compose
   file so their network membership and asset mounts change together.
3. Export the live policy through the CLI. Add the intended `adminOrigin` to
   each application that needs a private workspace; preserve all existing
   wallets and grants. Validate and apply the edited policy using the
   [policy workflow](08-OPERATIONS.md#policy-and-cli).
4. This policy update invalidates all existing sessions, invitations and pending
   approvals. Sign in again at the relevant origin. Public login remains usable
   if the administrator has not yet configured private sign-in.
5. Check that `/admin.html`, `/panel.js` and `/v1/auth/control/users` return 404
   on the public URL, and that private sign-in works at the internal URL.

## Deploy on a server

Keep the admin port on loopback. Reach it through an SSH local forward or a
VPN-only reverse proxy with firewall rules limiting its listener to the VPN. For
example, a tunnel can forward a local port to the server's loopback port:

```sh
ssh -N -L 9443:127.0.0.1:9443 operator@your-server
```

Your browser URL, certificate and configured `adminOrigin` must agree. Use a
trusted TLS certificate for a private administration hostname and arrange
private DNS (or a local host mapping when tunneling) for that hostname. Do not
add the panel to the public reverse proxy, DNS tunnel, load balancer, or
OrbStack sharing configuration. Do not expose either API's port directly.

No VPN, external server, firewall or public DNS record is provisioned by the
local example. An Internet deployment needs those host-specific controls.

## Limits and checks

This is network and session separation on one trusted host. It is not database
privilege separation: a compromised backend process still has write access to
the shared state. A distributed setup needs a persistence/service boundary of
its own. The browser frontend has no such access.

Permanent policy edits continue to invalidate sessions, invitations and pending
approvals instance-wide. Individual session revocation remains targeted. Both
processes retain existing audit transactions and fail-closed behavior.

`test/surfaces.test.ts` verifies audience rejection, distinct hostnames and
cross-connection policy visibility. `scripts/test-proxy.mjs` verifies real HTTPS
on separate ports, denied public routes/assets, private user management, public
session invalidation, invitation login and signed simulation controls.

# quique.es workspace integration

A small independent HTTP application protected by Gozne, with the ivory, ink and
amber visual style of QUIQUE.ES. The brand symbol is supplied from the owner's
QUIQUE.ES project. The public login uses Gozne wallet discovery. The private
workspace displays the verified identity, roles, wallet and session expiry, and
supports logout. It is a starting workspace, not a business application with
invented data or deployments.

`server.mjs` imports only Node's HTTP module. It verifies no wallet signatures,
reads no cookies and imports no Gozne libraries. The isolated proxy supplies
identity headers after live authorization, stripping all client-supplied
identity headers. The application container has no published port or database
mount.

## Local preview

From the Gozne repository root:

```sh
sh scripts/demo-certs.sh
docker compose -f examples/quique-app/compose.yaml up --build -d --wait
docker compose -f examples/quique-app/compose.yaml exec gateway gozne policy apply /app/policy.json
docker compose -f examples/quique-app/compose.yaml exec gateway gozne wallet attach operator evm YOUR_PUBLIC_ADDRESS
```

Apply the starter policy **only on a new volume**. It authorizes no wallets. Its
`operator` identity is an application manager with reader/admin roles in
`quique`. Never reapply it after creating users or modifying access.

- Public preview: `https://app.quique.orb.local/`.
- Private panel: `https://127.0.0.1:9543/?application=quique`.

The panel's local certificate comes from the demo certificate directory. For
real deployment, use the existing internal certificate service and trusted TLS.
Production targets requested for this integration are `app.quique.es` (public)
and `gozne.quique.es` (internal only). Local preview does not publish those DNS
names, configure a tunnel or modify the existing QUIQUE.ES website.

## Verification

```sh
TEST_QUIQUE=1 node scripts/test-proxy.mjs
```

After building the Gozne image, this creates an isolated portable HTTPS setup
using `compose.test.yaml` and temporary wallet keys. It exercises EVM and Solana
sign-in, real protected workspace HTML, denial without a session, forged-header
removal, private management, revocation, logout, backup/restore and gateway
failure. It also verifies the deployment diagnostic and public/private route
separation. Temporary test state is removed afterward.

## Target server deployment (prepared, not activated by the local preview)

`compose.server.yaml` defines a separate project from the existing QUIQUE.ES
website. It serves public authentication on origin port 3012 and administration
on origin port 3013, with no directly published API or application container.
The default bind address is loopback. Set `QUIQUE_BIND_ADDRESS` to the Docker
server's internal address only after reviewing source restrictions.

`public.server.conf` permits origin traffic from the designated Cloudflare
connector; `admin.server.conf` permits only the internal Nginx host. Neither
trusts a caller-supplied forwarding header to override its source-address rule.
Review these environment-specific IP allowlists before applying them elsewhere.
The public proxy still has no administrative routes or panel assets.

Use a private copy of `policy.server.example.json`, attach the intended
operator's **public wallet** and set `QUIQUE_POLICY_FILE` to that file. It has
no wallets by default. Never commit an operational policy, TLS keys or
credentials. The admin container renders the `quique` application default into
tmpfs at start.

Required external configuration:

- Cloudflare Tunnel: `app.quique.es` to the Docker host's port 3012.
- Internal hosts/DNS: `gozne.quique.es` to the internal Nginx host.
- Internal Nginx: review/install `gozne.internal.nginx.conf`, using the
  certificate issued on `pki01`; allow only the actual internal/VPN client
  ranges. Never put this hostname in the public tunnel.
- Certificate delivery: copy the full chain and private key securely from the
  Certbot lineage, validate them, then run `nginx -t` before reload. Configure a
  scoped renewal deployment hook so renewed files reach this Nginx host.
  Issuance/renewal on the certificate host alone does not update the serving
  host.

The provided hostname and source-IP configuration targets the owner's existing
infrastructure. Deploy under a new release directory, inspect Compose before
startup and keep rollback scoped to this new project. Do not stop or recreate
the existing QUIQUE.ES, mailbox, password manager, XYZ or OpenWA containers.

# quique.es workspace integration

A small independent HTTP application protected by Gozne, with the ivory, ink and
amber visual style shared by quique.es and pass.quique.es. Its public access
screen reuses the family header and footer, removes the decorative grid and
presents every detected wallet as a direct sign-in choice. Rabby and MetaMask
have dedicated entries; other EIP-6963 browser wallets are added automatically.
Phantom signs in on Solana mainnet. The private workspace displays the verified
identity, roles, wallet and session expiry, and supports logout. It is a
starting workspace, not a business application with invented data or
deployments.

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

The quique policy intentionally accepts Solana mainnet only in both preview and
production. Authentication signs a SIWS message and does not submit a
transaction or incur a fee.

## Target server deployment

`compose.server.yaml` defines a separate project from the existing QUIQUE.ES
website. It serves public authentication on origin port 3012 and terminates
private administration TLS in Gozne's own Nginx container. The admin listener
defaults to loopback port 9443. Production may set `QUIQUE_ADMIN_BIND_ADDRESS`
to the Docker server's internal address and `QUIQUE_ADMIN_PORT=443` after
reviewing source restrictions. No API or protected application container has a
published port.

`public.server.conf` permits origin traffic from the designated Cloudflare
connector. `admin.server.conf` accepts only the configured internal LAN and VPN
ranges and rejects the Cloudflare connector before serving the panel. Neither
trusts a caller-supplied forwarding header to override its source-address rule.
The public proxy still has no administrative routes or panel assets. Adjust the
private ranges when deploying on a different network.

Use a private copy of `policy.server.example.json`, attach the intended
operator's **public wallet** and set `QUIQUE_POLICY_FILE` to that file. It has
no wallets by default. Never commit an operational policy, TLS keys or
credentials. The admin container renders the `quique` application default into
tmpfs at start.

Required external configuration:

- Cloudflare Tunnel: `app.quique.es` to the Docker host's port 3012.
- Internal hosts/DNS: `gozne.quique.es` to the Docker host's internal address.
  Never put this hostname in the public tunnel.
- Private TLS: set `QUIQUE_TLS_DIRECTORY` to a root-owned directory containing
  `fullchain.pem` and `privkey.pem`, delivered from the `pki01` Certbot lineage.
  Validate the files before recreating `admin-panel` and configure a scoped
  renewal hook to refresh them. Issuance on the certificate host alone does not
  update the serving container.
- Deployment diagnostics: pass the exact internal listener to
  `gozne check-deployment --admin-bind INTERNAL_IP`; the default permits only
  loopback.

The provided hostname and source-IP configuration targets the owner's existing
infrastructure. Deploy under a new release directory, inspect Compose before
startup and keep rollback scoped to this new project. Do not stop or recreate
the existing QUIQUE.ES, mailbox, password manager, XYZ or OpenWA containers.

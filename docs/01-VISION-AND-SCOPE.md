# Vision and scope

## The problem

Applications that authenticate wallets often repeat the same sensitive work:
discovering providers, issuing messages, preventing replay, checking signatures,
creating sessions, revoking them and mapping wallets to application roles.
Repeating that code in every portal increases maintenance and security costs.

## The proposal

Gozne handles wallet authentication and supplies a verified web identity to an
HTTP application through a defined reverse-proxy boundary. The protected app
needs no private keys or blockchain libraries.

The control panel extends this foundation with temporary wallet access and
approvals bound to a specific action. Its first action adapter is deliberately a
**local deployment simulation**. It demonstrates the permission workflow, not a
connection to a hosting provider.

## Intended users

- Operators of private portals, internal tools and self-hosted services.
- Teams whose collaborators already use wallets.
- Small installations that need explicit permissions and centralized revocation.

This alpha is not designed for mass onboarding without wallets, social login,
global high availability or immediate support for all smart wallets.

## Product principles

1. **Ownership proof, never custody.** Private keys and seed phrases stay with
   users.
2. **No blockchain transaction.** Authentication signs a readable message.
3. **Live authorization.** Access and approvals expire and remain revocable.
4. **Explicit intent.** An action signature names exactly what is being
   approved.
5. **Simple deployment.** One service, SQLite and an HTTPS reverse proxy.
6. **Established formats.** SIWE and Sign-In With Solana, without custom
   cryptography.
7. **Independent project.** Public examples contain only synthetic data.

## Implemented alpha scope

- EVM EOA and Solana authentication.
- Explicit identities, wallets and roles per application.
- Persistent opaque sessions and local administrative CLI.
- Nginx `auth_request` example and a header contract for integration.
- Browser control panel, reader invitations, signed simulated deployment
  actions.
- Non-root OCI containers, transactional SQLite migrations and verified backups.
- OpenAPI, automated tests, image scanning and CycloneDX inventories.

## Deferred capabilities

WalletConnect, ERC-1271/ERC-6492, OIDC, passkeys, wallet recovery, quorum
approvals, agent delegation, real deployment adapters, PostgreSQL and clustering
are not implemented. A proxy integration alone does not enforce signatures on
individual application operations.

## Success criteria

A new operator should be able to follow the README, authorize their own wallet
and protect the example application. Replay, altered messages, wrong origins,
expired invitations and revoked sessions must fail. Restarts preserve committed
state; restoration must not revive sessions or pending approvals. Public
artifacts must contain no operational secrets or real user data.

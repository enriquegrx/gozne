# Applications and workspaces

Gozne's private panel can list applications, create them and edit their public
origin, private administration origin, allowed chains and required roles. The
login page accepts an application ID instead of being tied to `demo`.

## Two different responsibilities

An application's `admin` role grants user, invitation and session management for
that application. It does not permit creating applications or changing their
origins. These instance-wide configuration operations require an explicit
operator-controlled list in the policy:

```json
{
  "applicationManagers": ["operator"]
}
```

This is a fragment, not a complete policy. Export the current policy, add the
list referencing existing identity IDs, validate and apply it through the local
CLI. An application manager must also have a live `admin` session in the current
application. The list is optional; old policies have no application managers by
default. Do not automatically promote existing application administrators.

The browser API cannot edit this list. Ordinary administrators cannot replace an
application manager's wallets, even when that identity belongs only to their
application. Wallets shared across applications remain CLI-controlled. This
prevents an administrator from replacing a manager's wallet with their own.

## Configure an application

1. Sign in at the private panel with an authorized manager wallet.
2. Open **Applications** and choose **New application** or an existing entry.
3. Set its ID, canonical public HTTPS origin, separate private HTTPS origin,
   allowed EVM/Solana chains and required roles.
4. Save. The creator receives required roles plus `admin` for a new application.
   Existing application grants are preserved on updates.
5. Configure that application's reverse proxy, DNS and TLS separately. A saved
   definition alone does not publish a hostname or create an application server.

IDs cannot be renamed through the panel. Application deletion is not exposed. To
avoid current-workspace lockout, the panel rejects changing its own private
origin or required roles that would exclude the current manager. Such changes
require a reviewed CLI policy update. All normal policy validations still apply,
including distinct public/private hostnames and bounded chain/role lists.

Effective changes invalidate every session, invitation and pending approval in
the instance. Identical edits are a no-op. Stale revisions return 409, and a
failed audit write rolls back the definition, creator grant and invalidation.
Manager permission is checked again inside the policy transaction.

## Switch workspaces

The application list shows accessible definitions; managers can inspect all
configured definitions. **Open workspace** ends the current session and opens
that application's private origin with `?application=<id>`. Sign a fresh proof
there. Manager status does not bypass the destination application's wallet, role
or chain requirements.

Public login URLs can also use `?application=<id>`. A static page may set a
default with `<meta name="gozne-application" content="your-app">`. The
Application ID input is editable before sign-in. A loaded session belonging to
another requested application is logged out before starting the new login.
Sessions are never silently relabeled or shared between applications.

## JSON contract

- `GET /v1/auth/control/applications` returns `revision`, `canManage`,
  `currentApplication` and application definitions. Non-managers only see
  applications accessible to the current wallet.
- `POST /v1/auth/control/applications` takes `revision`, `create` and a full
  `application` definition. `adminOrigin` is required for panel writes. Origin,
  CSRF and application-manager permission are enforced server-side.

See [OpenAPI](../openapi.yaml). This is private API functionality; the public
surface does not register these routes.

## Upgrade and rollback

No schema migration is required. Back up before changing policy. Older binaries
will not understand a policy containing `applicationManagers`; rollback requires
a compatible policy or the pre-upgrade backup. Do not point an older process at
the new policy while another process is still running the new version.

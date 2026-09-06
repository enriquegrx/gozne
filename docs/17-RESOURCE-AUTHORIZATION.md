# Resource authorization

Gozne can answer a narrower question after wallet authentication: **may this
live identity perform this permission on this resource?** This complements the
existing route gate and signed-action workflow.

## Model

Authorization combines three elements:

- **Permissions** name application operations, such as `documents.read`,
  `documents.edit` or `workflow.approve`.
- **Roles** bundle permissions. Existing application roles apply everywhere. A
  scoped grant applies a role only to one resource.
- **Resources** use `type:id` keys and may have one parent. A grant on a parent
  applies to its descendants. `document:*` grants a role to every declared
  document.

Every permission and resource must be declared. An unknown identity, permission,
resource or missing grant produces a deny decision. There is no implicit access
and no explicit-deny precedence in this version.

```json
{
  "version": 1,
  "applications": [
    {
      "id": "portal",
      "origin": "https://portal.example.com",
      "adminOrigin": "https://gozne.internal.example.com",
      "evmChainIds": [1],
      "solanaChains": ["solana:mainnet"],
      "requiredRoles": ["reader"],
      "authorization": {
        "permissions": [
          "documents.read",
          "documents.edit",
          "workflow.submit",
          "workflow.approve"
        ],
        "roles": {
          "reader": ["documents.read"],
          "editor": ["documents.read", "documents.edit"],
          "operator": ["workflow.submit"],
          "approver": ["workflow.approve"],
          "admin": ["*"]
        },
        "resources": [
          { "type": "project", "id": "alpha" },
          {
            "type": "document",
            "id": "42",
            "parent": "project:alpha"
          },
          { "type": "workflow", "id": "invoices" }
        ]
      }
    }
  ],
  "identities": [
    {
      "id": "alice",
      "wallets": [],
      "grants": { "portal": ["reader"] },
      "resourceGrants": {
        "portal": [
          { "role": "editor", "resource": "project:alpha" },
          {
            "role": "approver",
            "resource": "workflow:invoices",
            "notBefore": 1767225600000,
            "expiresAt": 1798761600000,
            "conditions": {
              "environments": ["production"],
              "maximumAmount": 500000
            }
          }
        ]
      }
    }
  ]
}
```

Here `alice` can read every declared resource because `reader` is an application
role. She can edit document `42` because it is a child of `project:alpha`. Her
workflow approval is valid only inside its time window, in production and up to
`500000` minor units. The application defines whether that means cents, wei or
another indivisible unit.

## Private decision API

Give each application backend an independent random secret of at least 32 bytes.
Configure the public Gozne process with a JSON object:

```sh
export GOZNE_AUTHORIZATION_TOKENS='{"portal":"replace-with-at-least-32-random-bytes"}'
```

The variable is absent from API responses, policy documents and the admin panel.
Store it in the deployment secret manager. Adding at least one token enables the
`authorization.resource.v1` capability. Context conditions and resource lookup
also advertise `authorization.context.v1` and
`authorization.lookup-resources.v1`.

After forward authentication, the application receives `X-Gozne-Session`. It can
submit that public session ID to Gozne across the private service network:

```http
POST /v1/internal/authorize HTTP/1.1
Authorization: Bearer replace-with-at-least-32-random-bytes
Content-Type: application/json

{
  "sessionId": "11111111-1111-4111-8111-111111111111",
  "permission": "documents.edit",
  "resource": "document:42"
}
```

```json
{
  "allowed": true,
  "reason": "resource-role:editor@project:alpha",
  "decisionId": "22222222-2222-4222-8222-222222222222",
  "policyRevision": "..."
}
```

The bearer token selects the application. Gozne then verifies that the session
is live and belongs to that application. The application must use only the
session ID supplied by its trusted reverse proxy.

Use `/v1/internal/authorize/batch` to check up to 50 permission-resource pairs
for one session. This can drive a table or toolbar, but the backend must repeat
the check immediately before every protected mutation.

`POST /v1/internal/authorized-resources` accepts a session, permission, resource
type and optional context. It returns the declared resource keys that the
session may access. Use this to build a server-side filter before loading or
returning rows. The endpoint is bounded by the policy's 1,000-resource limit.

Checks may include `context.environment` and an integer `context.amount`. If a
matching grant requires a missing value, Gozne denies with
`context-required:environment`, `context-required:amount` or both. A supplied
value outside the grant returns `condition-not-met`. Application-wide roles do
not carry scoped conditions.

The bundled Nginx entry points return `404` for `/v1/internal/*`. Application
backends call `gateway:3001` directly on the internal container network. Do not
publish that port or route it through a Cloudflare tunnel.

## Administration

The private panel's **Authorization** section edits the current application's
complete model and scoped grants. Its access inspector tests an identity,
permission and resource and shows the matching role or deny reason.

Like every policy edit, a saved authorization change uses an optimistic policy
revision and invalidates sessions, invitations, challenges and pending actions
across the instance. Make related edits together and sign in again after saving.

Allowed `read`, `list` and `view` decisions are not individually written to the
audit table. Denied decisions and allowed permissions with other suffixes are
audited. Each service response has a decision ID and policy revision for
application-level correlation.

## Application responsibilities

The application must:

1. derive the permission and resource from its own route and data;
2. use only the proxy-verified session ID;
3. fail closed on timeout, malformed response or any non-`200` status;
4. check again when performing a mutation;
5. filter collections before returning data.

Signed actions remain the stronger workflow for exact, high-impact intent and
multi-person approval. Resource authorization determines who may request,
inspect or approve; the signed action records exactly what was approved.

## Current limits

This version supports role bundles, exact resources, one-parent inheritance,
type wildcards, time windows, environment lists, maximum integer amounts and
lookup of visible declared resources. IP conditions and arbitrary expressions
are not implemented. Teams and an external OpenFGA or SpiceDB adapter remain
later extensions.

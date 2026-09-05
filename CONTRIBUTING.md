# Contributing to Gozne

For a substantial change, open an issue describing the problem before writing an
implementation. For a bug, include steps to reproduce it with synthetic data.

## Development

Use Node.js 24.20.0 and npm. With nvm: `nvm install` and `nvm use`.

```sh
npm ci
npm run check
```

`check` runs formatting, lint, compilation and tests. Use `npm run format` to
apply formatting. Tests create temporary databases and ephemeral signing keys.

For changes to authentication, storage, containers or proxy behavior, also run:

```sh
docker build -t gozne:dev .
node scripts/smoke-container.mjs
node scripts/test-proxy.mjs
node scripts/test-resilience.mjs
```

Security changes need behavioral tests that demonstrate the corrected failure.
Use `.test` domains, synthetic identities and ephemeral test keys. Never commit
production data, session cookies, wallet secrets or local database files.

Keep README, OpenAPI and relevant guides in English. Describe what actually
works and distinguish simulations from external effects. Document migrations and
recovery implications when persistent state changes. Published migrations are
immutable; add a new numbered migration instead of editing an old one.

Browser interface copy must remain complete in English and Spanish. Add static
and runtime text to the shared catalogue, format displayed dates with the locale
helpers, and keep signed messages and protocol identifiers language-neutral.
Follow the [internationalization guide](docs/15-INTERNATIONALIZATION.md) and its
review checklist for every user-facing change.

The distribution license is pending. Contact the maintainer before submitting a
substantial contribution to clarify its terms.

See [operations](docs/08-OPERATIONS.md) and
[verification](docs/10-VERIFICATION.md) for the complete local workflow.

# Internationalization

Gozne's browser interfaces support English and Spanish without a frontend
framework or a translation service. The same small module is loaded by the
public sign-in page, the protected QUIQUE.ES workspace and the private control
panel.

## User behavior

- English (`en`) and Spanish (`es`) are available from the language control in
  each header.
- A `?lang=en` or `?lang=es` query parameter takes precedence on the first visit
  to a page.
- Otherwise Gozne uses the last language selected on that origin, then the
  browser language, and finally English.
- The explicit choice is stored as `gozne.locale` in `localStorage`. Public and
  protected pages share it because they have the same origin. The internal panel
  stores its own copy because it intentionally uses a separate origin.
- Changing language updates the current page. It does not sign the user out or
  change their authorization.

Dates and times are rendered through `Intl.DateTimeFormat`, so their order and
punctuation follow the selected locale.

## Security boundary

Translation applies only to human-readable interface copy. These values remain
language-neutral and must never be translated:

- SIWE and SIWS challenge messages;
- signed-action messages and payload hashes;
- nonces, signatures, wallet addresses and chain identifiers;
- application IDs, role IDs, action states stored by the API and audit data;
- HTTP paths and machine-readable error codes.

This keeps a signature deterministic across languages. The browser may show a
translated explanation around a signing step, but it submits exactly the
canonical message returned by the server.

## Adding interface copy

The English source and Spanish catalogue live in
[`examples/login/i18n.js`](../examples/login/i18n.js). Treat an interface change
as incomplete until its visible copy works in both languages.

For static HTML, write the English copy normally and add its Spanish value to
the `spanish` catalogue. The module translates text nodes, page titles,
placeholders, `aria-label` and `title` attributes while preserving the English
source in memory so users can switch back.

Use `data-i18n` when an element contains a runtime value or markup makes the
source ambiguous:

```html
<h1 data-i18n="Welcome, {identity}." data-i18n-identity="alice">
  Welcome, alice.
</h1>
```

For text created in JavaScript, translate at the point where it becomes UI:

```js
const t = (source, values) => window.GozneI18n?.t(source, values) ?? source;

status.textContent = t('Updated {time}', { time });
```

Use `formatDate` or `formatTime` for values displayed to a person:

```js
const expires = window.GozneI18n.formatDate(session.expiresAt, {
  dateStyle: 'medium',
  timeStyle: 'short',
});
```

Keep interpolation values out of the catalogue and use named placeholders. Text
is assigned with `textContent`; translated strings are never interpreted as
HTML.

## Adding a language

1. Add its two-letter code to `SUPPORTED` in `i18n.js`.
2. Add a catalogue with every existing source key.
3. Extend `t()` to select that catalogue.
4. Check the public sign-in, protected workspace and private panel at desktop
   and mobile widths.
5. Run `npm run check` and the Compose surface test.

The language module is mounted as a read-only file in every example proxy and
served only as `/i18n.js`. The Content Security Policy continues to allow local
scripts only.

## Review checklist

Before merging user-facing work, verify:

- new headings, labels, help text, buttons, placeholders and accessibility
  labels have translations;
- success, empty, loading and error states created in JavaScript use `t()`;
- dates use the locale formatter;
- signed or persisted protocol values remain canonical;
- both EN and ES fit without horizontal overflow on a narrow viewport;
- switching languages preserves the session and selected wallet.

import { createServer } from 'node:http';

const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[character],
  );

createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200);
    res.end('ok');
    return;
  }
  if (req.method !== 'GET' || req.url !== '/') {
    res.writeHead(404);
    res.end();
    return;
  }

  // Only the isolated, trusted reverse proxy can reach this service.
  // It removes supplied identity headers and validates a live Gozne session.
  const identity = req.headers['x-gozne-identity'];
  const application = req.headers['x-gozne-application'];
  if (typeof identity !== 'string' || application !== 'quique') {
    res.writeHead(401);
    res.end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta name="theme-color" content="#fbf8f1">
    <title>app.quique.es · Workspace</title>
    <link rel="stylesheet" href="/style.css">
    <script defer src="/workspace.js"></script>
  </head>
  <body class="app-shell">
    <a class="skip-link" href="#main">Skip to workspace</a>
    <header class="site-header">
      <div class="site-header__inner">
        <a class="site-wordmark" href="/private/" aria-label="Go to your workspace">
          <span class="site-wordmark__mark" aria-hidden="true"></span>
          <span>app.quique.es</span>
        </a>
        <div class="site-header__actions">
          <span class="private-label"><span aria-hidden="true"></span>Wallet verified</span>
          <button id="logout" class="header-logout" type="button">Sign out</button>
        </div>
      </div>
    </header>

    <main id="main" class="workspace">
      <section class="hero">
        <p class="eyebrow">PRIVATE WORKSPACE</p>
        <h1>Welcome, ${escape(identity)}.</h1>
        <p class="muted">Your personal space, opened with your wallet.</p>
      </section>
      <div class="grid">
        <section class="card">
          <div class="section-heading">
            <h2>Your account</h2>
            <span class="tag"><span class="signal"></span>AUTHORIZED</span>
          </div>
          <dl class="facts">
            <dt>Identity</dt><dd>${escape(identity)}</dd>
            <dt>Application</dt><dd>${escape(application)}</dd>
            <dt>Permissions</dt><dd>${escape(req.headers['x-gozne-role'])}</dd>
            <dt>Wallet</dt><dd id="wallet">Loading…</dd>
            <dt>Session expires</dt><dd id="expires">Loading…</dd>
          </dl>
          <p id="status" class="status" role="status">Checking your current session.</p>
        </section>
        <section class="card">
          <h2>Resources</h2>
          <a class="resource" href="https://quique.es/en/">quique.es ↗<small>Public website</small></a>
          <a class="resource" href="https://pass.quique.es">pass.quique.es ↗<small>Share secrets securely</small></a>
          <a class="resource" href="https://quique.es/en/security/">Security ↗<small>Security information and contact</small></a>
          <p class="note">This workspace is the starting point for your private tools.</p>
        </section>
      </div>
    </main>

    <footer class="site-footer">
      <div class="site-footer__meta">
        <p class="site-footer__years" aria-label="2012 to 2026">
          <time datetime="2012">2012</time><span aria-hidden="true">—</span><time datetime="2026">2026</time>
        </p>
        <span class="site-footer__separator" aria-hidden="true">·</span>
        <a class="site-footer__link" href="https://quique.es/en/">quique.es</a>
        <span class="site-footer__separator" aria-hidden="true">·</span>
        <a class="site-footer__link" href="https://pass.quique.es">pass</a>
        <span class="site-footer__separator" aria-hidden="true">·</span>
        <a class="site-footer__link" href="https://quique.es/en/security/">Security</a>
        <span class="site-footer__separator" aria-hidden="true">·</span>
        <a class="site-footer__link" href="https://quique.es/en/message/">Contact</a>
        <span class="site-footer__separator" aria-hidden="true">·</span>
        <a class="site-footer__link" href="https://quique.es/en/inbox/">Inbox</a>
      </div>
      <p class="site-footer__privacy">Authentication cookie only. No invasive tracking.</p>
    </footer>
  </body>
</html>`);
}).listen(8080, '0.0.0.0');

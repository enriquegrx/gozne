import { createServer } from 'node:http';
const escape = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
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
  res.end(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>quique.es · Workspace</title><link rel="stylesheet" href="/style.css"><script defer src="/workspace.js"></script></head><body><main class="workspace"><header><a class="brand" href="/private/"><img src="/brand/symbol.png" alt="" width="48" height="48">quique.es</a><button id="logout">Sign out</button></header><section class="hero"><p class="eyebrow">PRIVATE WORKSPACE</p><h1>Welcome, ${escape(identity)}.</h1><p class="muted">Your personal space, opened with your wallet.</p></section><div class="grid"><section class="card"><div class="section-heading"><h2>Your account</h2><span class="tag"><span class="signal"></span>AUTHORIZED</span></div><dl class="facts"><dt>Identity</dt><dd>${escape(identity)}</dd><dt>Application</dt><dd>${escape(application)}</dd><dt>Permissions</dt><dd>${escape(req.headers['x-gozne-role'])}</dd><dt>Wallet</dt><dd id="wallet">Loading…</dd><dt>Session expires</dt><dd id="expires">Loading…</dd></dl><p id="status" role="status">Checking your current session.</p></section><section class="card"><h2>Resources</h2><a class="resource" href="https://quique.es">quique.es ↗<small>Public website</small></a><a class="resource" href="https://quique.es/security/">Security ↗<small>Security information and contact</small></a><p class="note">This workspace is the starting point for your private tools.</p></section></div><footer>quique.es · Understand first. Then act.</footer></main></body></html>`,
  );
}).listen(8080, '0.0.0.0');

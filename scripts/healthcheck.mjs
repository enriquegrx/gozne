const host = process.env.GOZNE_HOST ?? '127.0.0.1';
const address =
  host === '0.0.0.0'
    ? '127.0.0.1'
    : host === '::'
      ? '[::1]'
      : host.includes(':')
        ? `[${host}]`
        : host;
try {
  const response = await fetch(
    `http://${address}:${process.env.GOZNE_PORT ?? '3001'}/healthz`,
    { signal: AbortSignal.timeout(3000) },
  );
  process.exitCode = response.status === 200 ? 0 : 1;
} catch {
  process.exitCode = 1;
}

#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { request } from 'node:https';
import { parseArgs } from 'node:util';
import type { TLSSocket } from 'node:tls';
import {
  inspectBoundary,
  certificateFinding,
  versionMetadataFinding,
} from '../src/operations/deployment.js';
import type { ContainerState, Finding } from '../src/operations/deployment.js';

const { values } = parseArgs({
  options: {
    compose: { type: 'string', default: 'examples/compose/orbstack.yaml' },
    project: { type: 'string', default: 'gozne-demo' },
    'public-origin': { type: 'string', default: 'https://gozne.orb.local' },
    'admin-origin': { type: 'string', default: 'https://127.0.0.1:9443' },
    'admin-bind': { type: 'string', default: '127.0.0.1,::1' },
    'public-ca': { type: 'string' },
    'admin-ca': { type: 'string', default: 'examples/compose/tls/cert.pem' },
    json: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
});
if (values.help) {
  console.log(
    'Read-only Compose deployment check.\nOptions: --compose FILE --project NAME --public-origin HTTPS_ORIGIN --admin-origin HTTPS_ORIGIN --admin-bind IP[,IP] --public-ca FILE --admin-ca FILE --json\nExit codes: 0 pass, 1 failure, 2 certificate renewal warning. Run on the Docker host.',
  );
  process.exit(0);
}
const findings: Finding[] = [];
const docker = (...args: string[]) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 4 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const reportError = (check: string, message: string) =>
  findings.push({ check, status: 'fail', message });
try {
  const ids = docker(
    'compose',
    '-f',
    values.compose,
    '-p',
    values.project,
    'ps',
    '-q',
    '--all',
  )
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!ids.length) throw new Error('No containers');
  interface Inspect {
    Config: { Labels: Record<string, string>; Env: string[] };
    State: { Running: boolean };
    HostConfig: {
      PortBindings: Record<
        string,
        { HostIp: string; HostPort: string }[] | null
      >;
    };
    NetworkSettings: { Networks: Record<string, unknown> };
    Mounts: { Name?: string; Destination: string }[];
  }
  const raw = JSON.parse(docker('inspect', ...ids)) as Inspect[];
  const stateVolumes = new Set(
    raw
      .filter((c) =>
        ['gateway', 'admin-api'].includes(
          c.Config.Labels['com.docker.compose.service'] ?? '',
        ),
      )
      .flatMap((c) =>
        c.Mounts.filter((m) => m.Destination === '/app/state').map(
          (m) => m.Name,
        ),
      ),
  );
  stateVolumes.delete(undefined);
  const containers: ContainerState[] = raw.map((c) => ({
    service: c.Config.Labels['com.docker.compose.service'] ?? '',
    running: c.State.Running,
    surface: c.Config.Env.find((e) => e.startsWith('GOZNE_SURFACE='))?.split(
      '=',
    )[1],
    networks: Object.keys(c.NetworkSettings.Networks),
    ports: Object.values(c.HostConfig.PortBindings ?? {})
      .flatMap((p) => p ?? [])
      .map((p) => ({ host: p.HostIp, port: p.HostPort })),
    stateMounted: c.Mounts.some(
      (m) =>
        m.Destination === '/app/state' ||
        (m.Name !== undefined && stateVolumes.has(m.Name)),
    ),
  }));
  const networks = [...new Set(containers.flatMap((c) => c.networks))];
  const inspected = networks.length
    ? (JSON.parse(docker('network', 'inspect', ...networks)) as {
        Name: string;
        Internal: boolean;
      }[])
    : [];
  findings.push(
    ...inspectBoundary(
      containers,
      new Set(inspected.filter((n) => n.Internal).map((n) => n.Name)),
      new Set(
        values['admin-bind']
          .split(',')
          .map((host) => host.trim())
          .filter(Boolean),
      ),
    ),
  );
} catch {
  reportError(
    'docker.inspect',
    'Cannot inspect the running Compose project; check Docker context, project and access',
  );
}

async function probe(
  origin: string,
  path: string,
  ca: Buffer | undefined,
  captureBody = false,
) {
  return new Promise<{ status: number; expiry: string; body: string }>(
    (resolve, reject) => {
      const req = request(
        new URL(path, origin),
        { ca, method: 'GET' },
        (res) => {
          const expiry = (res.socket as TLSSocket).getPeerCertificate()
            .valid_to;
          let body = '';
          if (captureBody) {
            res.setEncoding('utf8');
            res.on('data', (chunk: string) => {
              body += chunk;
              if (body.length > 16 * 1024)
                res.destroy(new Error('HTTPS response is too large'));
            });
          } else res.resume();
          res.on('end', () =>
            resolve({ status: res.statusCode ?? 0, expiry, body }),
          );
          res.on('error', reject);
        },
      );
      // Bound DNS, connection and response time together. TLS verification remains enabled.
      const timer = setTimeout(
        () => req.destroy(new Error('HTTPS timeout')),
        5000,
      );
      req.on('close', () => clearTimeout(timer));
      req.on('error', reject);
      req.end();
    },
  );
}
for (const surface of ['public', 'admin'] as const) {
  const origin = values[`${surface}-origin`];
  const caPath = values[`${surface}-ca`];
  try {
    const url = new URL(origin);
    if (
      url.protocol !== 'https:' ||
      url.origin !== origin ||
      url.username ||
      url.password
    )
      throw new Error('Invalid origin');
    const ca = caPath ? readFileSync(caPath) : undefined;
    const metadata = await probe(origin, '/version', ca, true);
    findings.push(
      versionMetadataFinding(surface, metadata.status, metadata.body),
    );
    const paths: [string, number][] =
      surface === 'public'
        ? [
            ['/healthz', 200],
            ['/', 200],
            ['/i18n.js', 200],
            ['/admin.html', 404],
            ['/panel.js', 404],
            ['/applications.js', 404],
            ['/v1/auth/control', 404],
            ['/v1/auth/control/users', 404],
          ]
        : [
            ['/healthz', 200],
            ['/', 200],
            ['/i18n.js', 200],
            ['/panel.js', 200],
            ['/applications.js', 200],
            ['/v1/auth/control/users', 401],
          ];
    for (const [path, expected] of paths) {
      const result = await probe(origin, path, ca);
      findings.push({
        check: `${surface}${path}`,
        status: result.status === expected ? 'pass' : 'fail',
        message: `HTTP ${result.status}; expected ${expected}`,
      });
      if (path === '/healthz')
        findings.push({
          ...certificateFinding(result.expiry),
          check: `${surface}.certificate`,
        });
    }
  } catch {
    reportError(
      `${surface}.https`,
      'HTTPS check failed; verify origin, reachability, certificate trust and expiry',
    );
  }
}
const status = findings.some((f) => f.status === 'fail')
  ? 'fail'
  : findings.some((f) => f.status === 'warn')
    ? 'warn'
    : 'pass';
if (values.json) console.log(JSON.stringify({ status, findings }));
else {
  for (const finding of findings)
    console.log(
      `${finding.status.toUpperCase()} ${finding.check}: ${finding.message}`,
    );
  console.log(
    `Deployment check: ${status}. Read-only snapshot; not an external network audit.`,
  );
}
process.exitCode = status === 'fail' ? 1 : status === 'warn' ? 2 : 0;

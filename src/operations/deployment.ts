import {
  administrationCapability,
  approvalThresholdCapability,
  auditChainCapability,
  authenticationCapabilities,
  webhookActionCapability,
} from '../metadata.js';

export interface ContainerState {
  service: string;
  running: boolean;
  surface?: string | undefined;
  networks: string[];
  ports: { host: string; port: string }[];
  stateMounted: boolean;
}
export interface Finding {
  check: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
}

export function inspectBoundary(
  containers: ContainerState[],
  internalNetworks: Set<string>,
  allowedAdminHosts = new Set(['127.0.0.1', '::1']),
): Finding[] {
  const findings: Finding[] = [];
  const check = (name: string, ok: boolean, message: string) => {
    findings.push({ check: name, status: ok ? 'pass' : 'fail', message });
  };
  const services = ['gateway', 'proxy', 'demo-app', 'admin-api', 'admin-panel'];
  for (const service of services) {
    const entries = containers.filter((c) => c.service === service);
    check(
      `${service}.running`,
      entries.length === 1 && entries[0]!.running,
      `${service} must have exactly one running container`,
    );
  }
  for (const container of containers.filter((c) =>
    services.includes(c.service),
  )) {
    if (container.service === 'gateway' || container.service === 'admin-api') {
      const expected = container.service === 'gateway' ? 'public' : 'admin';
      check(
        `${container.service}.surface`,
        container.surface === expected,
        `${container.service} must explicitly select the ${expected} surface`,
      );
      check(
        `${container.service}.network`,
        container.networks.length > 0 &&
          container.networks.every((n) => internalNetworks.has(n)),
        `${container.service} must use internal backend networks only`,
      );
    }
    if (['gateway', 'admin-api', 'demo-app'].includes(container.service))
      check(
        `${container.service}.ports`,
        container.ports.length === 0,
        `${container.service} must not publish host ports`,
      );
    if (container.service === 'admin-panel')
      check(
        'admin-panel.bind-address',
        container.ports.length > 0 &&
          container.ports.every((p) => allowedAdminHosts.has(p.host)),
        'Every administrative port must bind to an explicitly allowed address',
      );
    if (['proxy', 'admin-panel'].includes(container.service))
      check(
        `${container.service}.storage`,
        !container.stateMounted,
        'Frontend containers must not mount the state volume',
      );
  }
  const publicNetworks = new Set(
    containers
      .filter((c) => ['gateway', 'proxy', 'demo-app'].includes(c.service))
      .flatMap((c) => c.networks),
  );
  const privateNetworks = containers
    .filter((c) => ['admin-api', 'admin-panel'].includes(c.service))
    .flatMap((c) => c.networks);
  check(
    'networks.separation',
    !privateNetworks.some((n) => publicNetworks.has(n)),
    'Public and administrative services must not share a Docker network',
  );
  return findings;
}

export function certificateFinding(validTo: string, now = Date.now()): Finding {
  const remaining = Date.parse(validTo) - now;
  return {
    check: 'certificate.expiry',
    status:
      !Number.isFinite(remaining) || remaining <= 0
        ? 'fail'
        : remaining < 48 * 3600_000
          ? 'warn'
          : 'pass',
    message: Number.isFinite(remaining)
      ? `Certificate expires ${new Date(Date.parse(validTo)).toISOString()}`
      : 'Certificate expiry is unavailable',
  };
}

export function versionMetadataFinding(
  surface: 'public' | 'admin',
  status: number,
  body: string,
): Finding {
  const failure = (message: string): Finding => ({
    check: `${surface}.version`,
    status: 'fail',
    message,
  });
  if (status !== 200) return failure(`HTTP ${status}; expected 200`);
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return failure('Version metadata is not valid JSON');
  }
  if (!value || typeof value !== 'object')
    return failure('Version metadata is not an object');
  const metadata = value as Record<string, unknown>;
  const capabilities = metadata.capabilities;
  if (
    metadata.name !== 'gozne' ||
    metadata.authentication !== true ||
    metadata.surface !== surface ||
    (surface === 'admin' &&
      metadata.actionDeliveryMode !== 'simulation' &&
      metadata.actionDeliveryMode !== 'webhook') ||
    typeof metadata.version !== 'string' ||
    !/^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/.test(metadata.version) ||
    !Array.isArray(capabilities) ||
    capabilities.some((entry) => typeof entry !== 'string') ||
    new Set(capabilities).size !== capabilities.length
  )
    return failure('Version metadata has an invalid shape or surface');
  const required = [
    ...authenticationCapabilities,
    ...(surface === 'admin'
      ? [
          administrationCapability,
          approvalThresholdCapability,
          auditChainCapability,
          webhookActionCapability,
        ]
      : []),
  ];
  const missing = required.filter((entry) => !capabilities.includes(entry));
  if (missing.length)
    return failure(`Required capabilities missing: ${missing.join(', ')}`);
  if (surface === 'public' && capabilities.includes(administrationCapability))
    return failure('Public surface must not advertise administration');
  return {
    check: `${surface}.version`,
    status: 'pass',
    message: `Gozne ${metadata.version} advertises the required ${surface} capabilities`,
  };
}

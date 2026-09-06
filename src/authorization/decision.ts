import type { Policy } from '../policy/policy.js';

export interface AuthorizationCheck {
  permission: string;
  resource: string;
  context?: {
    environment?: string;
    amount?: number;
  };
}

export interface AuthorizationDecision {
  allowed: boolean;
  reason: string;
}

function grantsPermission(
  roles: Record<string, string[]>,
  roleNames: string[],
  permission: string,
): string | null {
  return (
    roleNames.find((role) => {
      const permissions = roles[role];
      return permissions?.includes('*') || permissions?.includes(permission);
    }) ?? null
  );
}

function resourcePath(
  resources: { type: string; id: string; parent?: string }[],
  target: string,
): string[] | null {
  const index = new Map(
    resources.map((resource) => [
      `${resource.type}:${resource.id}`,
      resource.parent,
    ]),
  );
  if (!index.has(target)) return null;
  const result: string[] = [];
  let current: string | undefined = target;
  while (current) {
    result.push(current);
    current = index.get(current);
  }
  return result;
}

export function decide(
  policy: Policy,
  applicationId: string,
  identityId: string,
  check: AuthorizationCheck,
  now: number,
  applicationRoles?: string[],
): AuthorizationDecision {
  const application = policy.applications.find(
    (entry) => entry.id === applicationId,
  );
  const model = application?.authorization;
  if (!application || !model)
    return { allowed: false, reason: 'authorization-model-unavailable' };
  if (!model.permissions.includes(check.permission))
    return { allowed: false, reason: 'permission-unknown' };
  const path = resourcePath(model.resources, check.resource);
  if (!path) return { allowed: false, reason: 'resource-unknown' };
  const identity = policy.identities.find((entry) => entry.id === identityId);
  if (!identity && !applicationRoles)
    return { allowed: false, reason: 'identity-unknown' };

  const applicationRole = grantsPermission(
    model.roles,
    applicationRoles ?? identity?.grants[applicationId] ?? [],
    check.permission,
  );
  if (applicationRole)
    return {
      allowed: true,
      reason: `application-role:${applicationRole}`,
    };

  const grants = identity?.resourceGrants?.[applicationId] ?? [];
  const missingContext = new Set<string>();
  let conditionFailed = false;
  for (const grant of grants) {
    if (grant.notBefore !== undefined && grant.notBefore > now) continue;
    if (grant.expiresAt !== undefined && grant.expiresAt <= now) continue;
    const [type] = grant.resource.split(':');
    const applies =
      path.includes(grant.resource) ||
      (grant.resource.endsWith(':*') &&
        path.some((resource) => resource.startsWith(`${type}:`)));
    if (!applies) continue;
    if (!grantsPermission(model.roles, [grant.role], check.permission))
      continue;
    let grantMissingContext = false;
    let grantConditionFailed = false;
    if (grant.conditions?.environments) {
      if (check.context?.environment === undefined) {
        missingContext.add('environment');
        grantMissingContext = true;
      } else if (
        !grant.conditions.environments.includes(check.context.environment)
      )
        grantConditionFailed = true;
    }
    if (grant.conditions?.maximumAmount !== undefined) {
      if (check.context?.amount === undefined) {
        missingContext.add('amount');
        grantMissingContext = true;
      } else if (check.context.amount > grant.conditions.maximumAmount)
        grantConditionFailed = true;
    }
    if (grantMissingContext) continue;
    if (grantConditionFailed) {
      conditionFailed = true;
      continue;
    }
    return {
      allowed: true,
      reason: `resource-role:${grant.role}@${grant.resource}`,
    };
  }
  if (missingContext.size)
    return {
      allowed: false,
      reason: `context-required:${[...missingContext].sort().join(',')}`,
    };
  if (conditionFailed) return { allowed: false, reason: 'condition-not-met' };
  return { allowed: false, reason: 'no-matching-grant' };
}

export function validateAuthorizationCheck(
  value: AuthorizationCheck,
): AuthorizationCheck {
  if (
    !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(value.permission) ||
    value.permission.length > 64 ||
    !/^[a-z][a-z0-9-]{0,31}:[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(
      value.resource,
    )
  )
    throw new Error('Invalid authorization check');
  if (
    value.context?.environment !== undefined &&
    !/^[a-z][a-z0-9-]{0,63}$/.test(value.context.environment)
  )
    throw new Error('Invalid authorization environment');
  if (
    value.context?.amount !== undefined &&
    (!Number.isSafeInteger(value.context.amount) || value.context.amount < 0)
  )
    throw new Error('Invalid authorization amount');
  return value;
}

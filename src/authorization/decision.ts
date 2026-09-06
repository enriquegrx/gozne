import type { Policy } from '../policy/policy.js';

export interface AuthorizationCheck {
  permission: string;
  resource: string;
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
  for (const grant of grants) {
    if (grant.expiresAt !== undefined && grant.expiresAt <= now) continue;
    const [type] = grant.resource.split(':');
    const applies =
      path.includes(grant.resource) ||
      (grant.resource.endsWith(':*') &&
        path.some((resource) => resource.startsWith(`${type}:`)));
    if (!applies) continue;
    if (grantsPermission(model.roles, [grant.role], check.permission))
      return {
        allowed: true,
        reason: `resource-role:${grant.role}@${grant.resource}`,
      };
  }
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
  return value;
}

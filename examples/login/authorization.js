/* global window, document */
'use strict';
(() => {
  const { api, busy } = window.gozne;
  const el = (selector) => document.querySelector(selector);
  const t = (source) => window.GozneI18n?.t(source) ?? source;
  let state = null;
  const lines = (value) =>
    value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
  const csv = (value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

  function show(data) {
    state = data;
    el('#authorization-permissions').value = data.model.permissions.join('\n');
    el('#authorization-roles').value = Object.entries(data.model.roles)
      .map(([role, permissions]) => `${role}: ${permissions.join(', ')}`)
      .join('\n');
    el('#authorization-resources').value = data.model.resources
      .map(
        (resource) =>
          `${resource.type}:${resource.id}${resource.parent ? ` > ${resource.parent}` : ''}`,
      )
      .join('\n');
    el('#authorization-grants').value = data.grants
      .map(
        (grant) =>
          `${grant.identity} | ${grant.role} | ${grant.resource}${grant.expiresAt ? ` | ${new Date(grant.expiresAt).toISOString()}` : ''}`,
      )
      .join('\n');
    const identities = el('#authorization-identity');
    identities.replaceChildren();
    for (const identity of data.identities) {
      const option = document.createElement('option');
      option.value = identity;
      option.textContent = identity;
      identities.append(option);
    }
    el('#authorization-fields').disabled = false;
    el('#authorization-inspector-fields').disabled = false;
    el('#reload-authorization').disabled = false;
    el('#authorization-status').textContent = t(
      'Authorization policy loaded for {application}.',
    ).replace('{application}', data.application);
  }

  async function load() {
    const session = window.gozneSession;
    if (!session?.roles.includes('admin')) return;
    const data = await api('control/authorization');
    if (window.gozneSession?.id === session.id) show(data);
  }

  function parseModel() {
    const roles = Object.fromEntries(
      lines(el('#authorization-roles').value).map((line) => {
        const divider = line.indexOf(':');
        if (divider < 1) throw new Error(t('Each role needs a colon.'));
        return [line.slice(0, divider).trim(), csv(line.slice(divider + 1))];
      }),
    );
    const resources = lines(el('#authorization-resources').value).map(
      (line) => {
        const [key, parent, ...extra] = line
          .split('>')
          .map((part) => part.trim());
        if (extra.length || !key?.includes(':'))
          throw new Error(t('Invalid resource hierarchy line.'));
        const divider = key.indexOf(':');
        return {
          type: key.slice(0, divider),
          id: key.slice(divider + 1),
          ...(parent ? { parent } : {}),
        };
      },
    );
    return {
      permissions: lines(el('#authorization-permissions').value),
      roles,
      resources,
    };
  }

  function parseGrants() {
    return lines(el('#authorization-grants').value).map((line) => {
      const [identity, role, resource, expiry, ...extra] = line
        .split('|')
        .map((part) => part.trim());
      if (!identity || !role || !resource || extra.length)
        throw new Error(t('Invalid scoped grant line.'));
      const expiresAt = expiry ? Date.parse(expiry) : undefined;
      if (expiry && !Number.isSafeInteger(expiresAt))
        throw new Error(t('Invalid grant expiry.'));
      return {
        identity,
        role,
        resource,
        ...(expiresAt === undefined ? {} : { expiresAt }),
      };
    });
  }

  function signedOut() {
    state = null;
    el('#authorization-fields').disabled = true;
    el('#authorization-inspector-fields').disabled = true;
    el('#reload-authorization').disabled = true;
    el('#authorization-result').textContent = '';
    el('#authorization-status').textContent = t(
      'Administrator sign-in required.',
    );
  }

  window.addEventListener('gozne:session', () => {
    if (!window.gozneSession?.roles.includes('admin')) signedOut();
    else
      load().catch((error) => {
        el('#authorization-status').textContent = error.message;
      });
  });
  el('#reload-authorization').addEventListener('click', () => busy(load));
  el('#authorization-form').addEventListener('submit', (event) => {
    event.preventDefault();
    busy(async () => {
      if (!state || !window.gozneSession?.roles.includes('admin'))
        throw new Error(t('Reload authorization first.'));
      const result = await api(
        'control/authorization',
        {
          revision: state.revision,
          model: parseModel(),
          grants: parseGrants(),
        },
        { 'X-CSRF-Token': window.gozneSession.csrfToken },
      );
      if (result.reauthenticationRequired) {
        window.gozneSession = null;
        el('#session').hidden = true;
        window.dispatchEvent(new window.Event('gozne:session'));
        el('#status').textContent = t(
          'Authorization saved. Sign in again to use the new policy.',
        );
      } else
        el('#authorization-status').textContent = t(
          'No authorization changes were needed.',
        );
    });
  });
  el('#authorization-inspector').addEventListener('submit', (event) => {
    event.preventDefault();
    busy(async () => {
      const decision = await api(
        'control/authorization/inspect',
        {
          identity: el('#authorization-identity').value,
          permission: el('#authorization-permission').value.trim(),
          resource: el('#authorization-resource').value.trim(),
        },
        { 'X-CSRF-Token': window.gozneSession.csrfToken },
      );
      const result = el('#authorization-result');
      result.className = `decision ${decision.allowed ? 'decision-allowed' : 'decision-denied'}`;
      result.textContent = `${decision.allowed ? t('Allowed') : t('Denied')} · ${decision.reason}`;
    });
  });
  if (window.gozneSession?.roles.includes('admin')) load();
})();

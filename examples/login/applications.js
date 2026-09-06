/* global window, document */
'use strict';
(() => {
  const { api, busy } = window.gozne;
  const el = (id) => document.querySelector(id);
  const t = (source) => window.GozneI18n?.t(source) ?? source;
  let directory = null;
  let loadedSession = null;
  const split = (value) =>
    value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  function edit() {
    const app = directory?.applications.find(
      (app) => app.id === el('#application-picker').value,
    );
    el('#app-id').value = app?.id || '';
    el('#app-id').readOnly = !!app;
    el('#app-origin').value = app?.origin || '';
    el('#app-admin-origin').value = app?.adminOrigin || window.location.origin;
    el('#app-roles').value = (app?.requiredRoles || ['reader']).join(', ');
    el('#app-evm').value = (app?.evmChainIds || [1]).join(', ');
    el('#app-solana').value = (app?.solanaChains || []).join(', ');
    el('#app-approvals').value = app?.approvalThreshold || 1;
  }
  async function load() {
    const session = window.gozneSession;
    if (!session) return;
    const result = await api('control/applications');
    if (window.gozneSession?.id !== session.id) return;
    directory = result;
    loadedSession = session.id;
    el('#application-fields').disabled = !result.canManage;
    el('#reload-applications').disabled = false;
    el('#applications-status').textContent = result.canManage
      ? t(
          'Application manager access. Select an application to edit its configuration.',
        )
      : t(
          'Your accessible applications. Configuration requires an application manager.',
        );
    const list = el('#application-list');
    list.replaceChildren();
    const picker = el('#application-picker');
    picker.replaceChildren();
    const create = document.createElement('option');
    create.value = '';
    create.textContent = t('New application');
    picker.append(create);
    for (const app of result.applications) {
      const option = document.createElement('option');
      option.value = app.id;
      option.textContent = app.id;
      picker.append(option);
      const row = document.createElement('p');
      row.textContent = `${app.id} · ${app.origin} `;
      if (app.adminOrigin) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'secondary';
        button.textContent =
          app.id === session.application
            ? t('Current workspace')
            : t('Open workspace');
        button.disabled = app.id === session.application;
        button.addEventListener('click', () =>
          busy(async () => {
            await api(
              'logout',
              {},
              { 'X-CSRF-Token': window.gozneSession.csrfToken },
            );
            window.gozneSession = null;
            window.dispatchEvent(new window.Event('gozne:session'));
            window.location.assign(
              `${app.adminOrigin}/?application=${encodeURIComponent(app.id)}`,
            );
          }),
        );
        row.append(button);
      }
      list.append(row);
    }
    edit();
  }
  window.addEventListener('gozne:session', () => {
    if (!window.gozneSession) {
      directory = null;
      loadedSession = null;
      el('#application-fields').disabled = true;
      el('#reload-applications').disabled = true;
      el('#application-list').replaceChildren();
      el('#application-picker').replaceChildren();
      for (const id of [
        'app-id',
        'app-origin',
        'app-admin-origin',
        'app-roles',
        'app-evm',
        'app-solana',
        'app-approvals',
      ])
        el(`#${id}`).value = '';
      el('#applications-status').textContent = t(
        'Sign in to see your applications.',
      );
    } else if (loadedSession !== window.gozneSession.id)
      load().catch((error) => {
        el('#applications-status').textContent = error.message;
      });
  });
  el('#reload-applications').addEventListener('click', () => busy(load));
  el('#application-picker').addEventListener('change', edit);
  el('#application-form').addEventListener('submit', (event) => {
    event.preventDefault();
    busy(async () => {
      if (!directory?.canManage || !window.gozneSession)
        throw new Error(t('Application manager access required.'));
      const result = await api(
        'control/applications',
        {
          revision: directory.revision,
          create: !el('#application-picker').value,
          application: {
            id: el('#app-id').value.trim(),
            origin: el('#app-origin').value.trim(),
            adminOrigin: el('#app-admin-origin').value.trim(),
            requiredRoles: split(el('#app-roles').value),
            evmChainIds: split(el('#app-evm').value).map(Number),
            solanaChains: split(el('#app-solana').value),
            approvalThreshold: Number(el('#app-approvals').value),
            ...(directory.applications.find(
              (app) => app.id === el('#application-picker').value,
            )?.authorization
              ? {
                  authorization: directory.applications.find(
                    (app) => app.id === el('#application-picker').value,
                  ).authorization,
                }
              : {}),
          },
        },
        { 'X-CSRF-Token': window.gozneSession.csrfToken },
      );
      if (result.reauthenticationRequired) {
        window.gozneSession = null;
        el('#session').hidden = true;
        el('#application-id').readOnly = false;
        window.dispatchEvent(new window.Event('gozne:session'));
        el('#status').textContent = t(
          'Application saved. Sign in again; all sessions and temporary grants were invalidated.',
        );
      } else
        el('#applications-status').textContent = t('No changes were needed.');
    });
  });
  if (window.gozneSession)
    load().catch((error) => {
      el('#applications-status').textContent = error.message;
    });
  window.addEventListener('gozne:languagechange', () => {
    if (window.gozneSession)
      load().catch((error) => {
        el('#applications-status').textContent = error.message;
      });
  });
})();

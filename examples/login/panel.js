/* global window, document */
'use strict';
(() => {
  const { api, busy, providers, walletSelect } = window.gozne;
  const select = (id) => document.querySelector(id);
  const date = (value) => new Date(value).toLocaleString();
  const short = (value) =>
    value.length > 24 ? `${value.slice(0, 12)}…${value.slice(-8)}` : value;
  let currentSession = null;
  let refreshVersion = 0;
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function empty(container, message) {
    container.replaceChildren(element('p', message, 'empty'));
  }
  function button(label, operation) {
    const node = element('button', label, 'secondary');
    node.type = 'button';
    node.addEventListener('click', () =>
      busy(async () => {
        await operation();
        await refresh();
        select('#status').textContent = `${label}: completed.`;
      }),
    );
    return node;
  }
  const mutate = (path, body = {}) =>
    api(`control/${path}`, body, { 'X-CSRF-Token': currentSession.csrfToken });

  async function approve(id) {
    if (currentSession.network === 'solana') {
      const provider = window.phantom?.solana;
      if (!provider?.signIn)
        throw new Error('Phantom with Sign-In With Solana is required.');
      const account = await provider.connect();
      if (account.publicKey.toString() !== currentSession.address)
        throw new Error('Select the wallet account used for this session.');
      const challenge = await mutate(`actions/${id}/challenge`, {
        chainId: select('#solana-chain').value,
      });
      const signed = await provider.signIn(challenge.signInInput);
      return mutate(`actions/${id}/approve`, {
        nonce: challenge.nonce,
        message: new TextDecoder('utf-8', { fatal: true }).decode(
          signed.signedMessage,
        ),
        signature: btoa(String.fromCharCode(...signed.signature)),
      });
    }
    const provider = providers.get(walletSelect.value);
    if (!provider)
      throw new Error('Select a detected EVM wallet in the wallet panel.');
    const [address] = await provider.request({ method: 'eth_requestAccounts' });
    if (address.toLowerCase() !== currentSession.address.toLowerCase())
      throw new Error('Select the wallet account used for this session.');
    const chainId = BigInt(
      await provider.request({ method: 'eth_chainId' }),
    ).toString();
    const challenge = await mutate(`actions/${id}/challenge`, { chainId });
    const hex =
      '0x' +
      Array.from(new TextEncoder().encode(challenge.message), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
    const signature = await provider.request({
      method: 'personal_sign',
      params: [hex, address],
    });
    return mutate(`actions/${id}/approve`, {
      nonce: challenge.nonce,
      message: challenge.message,
      signature,
    });
  }

  function renderActions(actions) {
    const list = select('#action-list');
    list.replaceChildren();
    if (!actions.length)
      return empty(
        list,
        'No requests yet. Create a simulated deployment above.',
      );
    for (const action of actions) {
      const record = element('article', undefined, 'record');
      const head = element('div', undefined, 'record-head');
      head.append(
        element('h3', `${action.payload.project} / ${action.payload.version}`),
        element('span', action.status, `badge badge-${action.status}`),
      );
      record.append(
        head,
        element(
          'p',
          `${action.payload.environment} · Requested by ${short(action.requester)} · Expires ${date(action.expiresAt)}`,
        ),
      );
      if (action.approvedBy)
        record.append(
          element(
            'p',
            `Approved by ${action.approvedBy} · Approval expires ${date(action.approvalExpiresAt)}`,
          ),
        );
      const details = element('details');
      details.append(
        element('summary', 'View signed identifiers'),
        element('p', `Action: ${action.id}`),
        element('code', `SHA-256: ${action.payloadHash}`),
      );
      record.append(details);
      const controls = element('div', undefined, 'record-actions');
      if (action.status === 'pending' && currentSession.roles.includes('admin'))
        controls.append(button('Sign approval', () => approve(action.id)));
      // Execution remains tied to the original session; the server enforces this even for the same identity.
      if (
        action.status === 'approved' &&
        action.requester === currentSession.identity
      )
        controls.append(
          button('Execute simulation once', () =>
            mutate(`actions/${action.id}/execute`),
          ),
        );
      if (['pending', 'approved'].includes(action.status))
        controls.append(
          button('Cancel request', () => mutate(`actions/${action.id}/cancel`)),
        );
      record.append(controls);
      list.append(record);
    }
  }
  function renderInvitations(invitations) {
    const list = select('#invitation-list');
    list.replaceChildren();
    if (!currentSession.roles.includes('admin'))
      return empty(
        list,
        'Your invitation grants reader access. Administration is reserved for operators.',
      );
    if (!invitations.length)
      return empty(
        list,
        'No invitations yet. Invite a public wallet address above.',
      );
    for (const invitation of invitations) {
      const state =
        invitation.revokedAt !== null
          ? 'revoked'
          : invitation.expiresAt <= Date.now()
            ? 'expired'
            : invitation.acceptedAt !== null
              ? 'accepted'
              : 'invited';
      const record = element('article', undefined, 'record');
      const head = element('div', undefined, 'record-head');
      head.append(
        element(
          'h3',
          `${invitation.network.toUpperCase()} · ${short(invitation.address)}`,
        ),
        element('span', state, 'badge'),
      );
      record.append(
        head,
        element('p', invitation.address),
        element('p', `Reader · Expires ${date(invitation.expiresAt)}`),
      );
      if (['invited', 'accepted'].includes(state))
        record.append(
          button('Revoke access', () =>
            mutate(`invitations/${invitation.id}/revoke`),
          ),
        );
      list.append(record);
    }
  }
  function renderDeployments(deployments) {
    const list = select('#deployment-list');
    list.replaceChildren();
    if (!deployments.length)
      return empty(
        list,
        'Executed simulations will appear here. No infrastructure is changed.',
      );
    for (const deployment of deployments) {
      const row = element('article', undefined, 'record');
      row.append(
        element('h3', `${deployment.project} / ${deployment.version}`),
        element(
          'p',
          `${deployment.environment} · Simulated · ${date(deployment.executedAt)}`,
        ),
        element('code', deployment.actionId),
      );
      list.append(row);
    }
  }
  function signedOut() {
    currentSession = null;
    select('#action-fields').disabled = true;
    select('#invite-fields').disabled = true;
    select('#refresh-panel').disabled = true;
    select('#connection-state').textContent = 'DISCONNECTED';
    select('#welcome').hidden = false;
    select('#invite-result').textContent = '';
    for (const id of ['invitations', 'pending', 'executed'])
      select(`#metric-${id}`).textContent = '—';
    empty(
      select('#action-list'),
      'Sign in to see requests and create your first action.',
    );
    empty(
      select('#invitation-list'),
      'Administrator sign-in required to manage invitations.',
    );
    empty(select('#deployment-list'), 'No receipts loaded.');
  }
  async function refresh() {
    const version = ++refreshVersion;
    if (!window.gozneSession) return signedOut();
    const session = await api('me');
    const data = await api('control');
    if (version !== refreshVersion || !window.gozneSession) return;
    currentSession = session;
    select('#action-fields').disabled = false;
    select('#invite-fields').disabled = !session.roles.includes('admin');
    select('#refresh-panel').disabled = false;
    select('#connection-state').textContent = session.roles.includes('admin')
      ? 'ADMIN'
      : 'READER';
    select('#welcome').hidden = true;
    select('#metric-invitations').textContent = session.roles.includes('admin')
      ? data.invitations.filter(
          (invite) =>
            invite.revokedAt === null && invite.expiresAt > Date.now(),
        ).length
      : '—';
    select('#metric-pending').textContent = data.actions.filter(
      (action) => action.status === 'pending',
    ).length;
    select('#metric-executed').textContent = data.actions.filter(
      (action) => action.status === 'executed',
    ).length;
    renderActions(data.actions);
    renderInvitations(data.invitations);
    renderDeployments(data.deployments);
  }
  function handleRefreshError(error) {
    signedOut();
    select('#status').textContent =
      `Could not load the workspace: ${error.message} Refresh or sign in again.`;
  }
  window.addEventListener('gozne:session', () => {
    refresh().catch(handleRefreshError);
  });
  select('#refresh-panel').addEventListener('click', () => busy(refresh));
  select('#action-form').addEventListener('submit', (event) => {
    event.preventDefault();
    busy(async () => {
      const data = new FormData(event.currentTarget);
      await mutate('actions', Object.fromEntries(data));
      await refresh();
      select('#status').textContent =
        'Request created. An administrator can now sign the exact deployment.';
    });
  });
  select('#invite-form').addEventListener('submit', (event) => {
    event.preventDefault();
    busy(async () => {
      const data = new FormData(event.currentTarget);
      const invitation = await mutate('invitations', {
        network: data.get('network'),
        address: data.get('address'),
        minutes: Number(data.get('minutes')),
      });
      await refresh();
      const result = select('#invite-result');
      result.replaceChildren(
        document.createTextNode(
          `Invite created for ${short(invitation.address)} until ${date(invitation.expiresAt)}. Share this address: `,
        ),
      );
      const link = element('a', invitation.url);
      link.href = invitation.url;
      result.append(link);
      select('#status').textContent =
        'Invitation created. Only that wallet can use it; the link carries no access token.';
    });
  });
  refresh().catch(handleRefreshError);
})();

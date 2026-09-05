/* global window, document */
'use strict';

const t = (source, values) => {
  if (window.GozneI18n) return window.GozneI18n.t(source, values);
  return source.replace(/\{([a-zA-Z]+)\}/g, (match, key) =>
    Object.hasOwn(values || {}, key) ? String(values[key]) : match,
  );
};
const formatTime = (value) =>
  window.GozneI18n
    ? window.GozneI18n.formatTime(value)
    : new Date(value).toLocaleTimeString();

const status = document.querySelector('#status');
const sessionPanel = document.querySelector('#session');
const walletSelect = document.querySelector('#evm-wallet');
const providers = new Map();
const applicationInput = document.querySelector('#application-id');
const defaultApplication =
  document.querySelector('meta[name="gozne-application"]')?.content || 'demo';
const requestedApplication = window.location
  ? new URLSearchParams(window.location.search).get('application') ||
    defaultApplication
  : defaultApplication;
applicationInput.value = requestedApplication;
let csrfToken = null;
let operationPending = false;

const walletOptions = new Map([
  ['io.rabby', document.querySelector('#wallet-rabby')],
  ['io.metamask', document.querySelector('#wallet-metamask')],
]);
const walletButtons = new Map([
  ['io.rabby', document.querySelector('#wallet-rabby-card')],
  ['io.metamask', document.querySelector('#wallet-metamask-card')],
]);
const wiredWalletButtons = new WeakSet();
const walletList = document.querySelector('#evm-wallet-list');
const evmButton = document.querySelector('#evm');
const connectionState = document.querySelector('#connection-state');

function selectWallet(key) {
  walletSelect.value = key;
  evmButton.click();
}

function enableWalletButton(button, key) {
  if (!button) return;
  button.disabled = false;
  const state =
    typeof button.querySelector === 'function'
      ? button.querySelector('[data-wallet-state]')
      : null;
  if (state) state.textContent = t('Detected');
  if (wiredWalletButtons.has(button)) return;
  wiredWalletButtons.add(button);
  button.addEventListener('click', () => selectWallet(key));
}

function createWalletButton(key, name) {
  if (!walletList) return null;
  const button = document.createElement('button');
  button.className = 'wallet-option';
  button.type = 'button';

  const icon = document.createElement('img');
  icon.src = '/wallets/ethereum.svg';
  icon.alt = '';

  const copy = document.createElement('span');
  copy.className = 'wallet-copy';
  const title = document.createElement('strong');
  title.textContent = name;
  const detail = document.createElement('small');
  detail.textContent = t('EVM browser wallet');
  copy.append(title, detail);

  const state = document.createElement('span');
  state.className = 'wallet-state';
  state.dataset.walletState = '';
  state.textContent = t('Detected');

  const arrow = document.createElement('span');
  arrow.className = 'wallet-arrow';
  arrow.ariaHidden = 'true';
  arrow.textContent = '↗';
  button.append(icon, copy, state, arrow);
  walletList.append(button);
  walletButtons.set(key, button);
  return button;
}

window.addEventListener('eip6963:announceProvider', (event) => {
  const { info, provider } = event.detail ?? {};
  if (
    typeof info?.uuid !== 'string' ||
    typeof info?.name !== 'string' ||
    typeof provider?.request !== 'function'
  )
    return;
  const known = info.rdns === 'io.rabby' || info.rdns === 'io.metamask';
  const key = known ? info.rdns : `uuid:${info.uuid}`;
  providers.set(key, provider);
  let option = walletOptions.get(key);
  if (!option) {
    option = document.createElement('option');
    option.value = key;
    walletOptions.set(key, option);
    walletSelect.append(option);
  }
  option.textContent = known
    ? info.rdns === 'io.rabby'
      ? 'Rabby'
      : 'MetaMask'
    : String(info.name).slice(0, 80);
  option.disabled = false;
  const walletButton =
    walletButtons.get(key) ??
    createWalletButton(key, String(info.name).slice(0, 80));
  enableWalletButton(walletButton, key);
});
function discoverWallets() {
  window.dispatchEvent(new window.Event('eip6963:requestProvider'));
}
document.querySelector('#refresh-wallets').addEventListener('click', () => {
  discoverWallets();
  status.textContent = t(
    'Looking for wallets. If yours is missing, enable it for this site and reload.',
  );
});
discoverWallets();

async function api(path, body, headers = {}) {
  const response = await fetch(`/v1/auth/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) {
    const error = new Error(
      t(result.error?.message ?? 'The request could not be completed.'),
    );
    error.status = response.status;
    throw error;
  }
  return result;
}
function showSession(session) {
  applicationInput.value = session.application || applicationInput.value;
  applicationInput.readOnly = true;
  csrfToken = session.csrfToken;
  window.gozneSession = session;
  window.dispatchEvent(new window.Event('gozne:session'));
  sessionPanel.hidden = false;
  if (connectionState) connectionState.textContent = t('Connected');
  status.textContent = t(
    'Signed in as {identity}. Session expires at {time}.',
    {
      identity: session.identity,
      time: formatTime(session.expiresAt),
    },
  );
}
async function busy(operation) {
  if (operationPending) return;
  operationPending = true;
  const previous = new Map();
  const buttons = document.querySelectorAll('button');
  buttons.forEach((button) => {
    previous.set(button, button.disabled);
    button.disabled = true;
  });
  status.textContent = t(
    'Working… Review your wallet if a signature is requested.',
  );
  try {
    await operation();
  } catch (error) {
    status.textContent = t(error.message || 'Sign-in failed.');
  } finally {
    buttons.forEach((button) => {
      button.disabled = previous.get(button);
    });
    const refreshButton = document.querySelector('#refresh-panel');
    if (refreshButton) refreshButton.disabled = !window.gozneSession;
    operationPending = false;
  }
}

document.querySelector('#evm').addEventListener('click', () =>
  busy(async () => {
    const provider = providers.get(walletSelect.value);
    if (!provider?.request)
      throw new Error(
        t(
          'Select a detected wallet. Another wallet will never be opened in its place.',
        ),
      );
    const [address] = await provider.request({ method: 'eth_requestAccounts' });
    const chainId = BigInt(
      await provider.request({ method: 'eth_chainId' }),
    ).toString();
    const challenge = await api('nonce', {
      application: applicationInput.value.trim(),
      network: 'evm',
      address,
      chainId,
    });
    const hex =
      '0x' +
      Array.from(new TextEncoder().encode(challenge.message), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join('');
    const signature = await provider.request({
      method: 'personal_sign',
      params: [hex, address],
    });
    showSession(
      await api('verify', {
        nonce: challenge.nonce,
        message: challenge.message,
        signature,
      }),
    );
  }),
);

document.querySelector('#solana').addEventListener('click', () =>
  busy(async () => {
    const provider = window.phantom?.solana;
    if (!provider?.signIn)
      throw new Error(
        t('This demo needs Phantom with Sign-In With Solana support.'),
      );
    const connected = await provider.connect();
    const address = connected.publicKey.toString();
    const chainId = document.querySelector('#solana-chain').value;
    const challenge = await api('nonce', {
      application: applicationInput.value.trim(),
      network: 'solana',
      address,
      chainId,
    });
    const signed = await provider.signIn(challenge.signInInput);
    const message = new TextDecoder('utf-8', { fatal: true }).decode(
      signed.signedMessage,
    );
    const signature = btoa(String.fromCharCode(...signed.signature));
    showSession(
      await api('verify', { nonce: challenge.nonce, message, signature }),
    );
  }),
);

document.querySelector('#logout').addEventListener('click', () =>
  busy(async () => {
    await api('logout', {}, { 'X-CSRF-Token': csrfToken });
    csrfToken = null;
    window.gozneSession = null;
    window.dispatchEvent(new window.Event('gozne:session'));
    sessionPanel.hidden = true;
    if (connectionState) connectionState.textContent = t('Not connected');
    applicationInput.readOnly = false;
    status.textContent = t('Signed out.');
  }),
);
api('me')
  .then(async (session) => {
    if (session.application && session.application !== requestedApplication) {
      await api('logout', {}, { 'X-CSRF-Token': session.csrfToken });
      status.textContent = t(
        'Application changed. Sign in to start a separate session.',
      );
    } else showSession(session);
  })
  .catch(() => {
    /* No active session on first visit. */
  });

window.gozne = {
  api,
  busy,
  providers,
  walletSelect,
  isBusy: () => operationPending,
};

window.addEventListener('gozne:languagechange', () => {
  if (window.gozneSession) showSession(window.gozneSession);
});

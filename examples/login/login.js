/* global window, document */
'use strict';

const status = document.querySelector('#status');
const sessionPanel = document.querySelector('#session');
const walletSelect = document.querySelector('#evm-wallet');
const providers = new Map();
let csrfToken = null;
let operationPending = false;

const walletOptions = new Map([
  ['io.rabby', document.querySelector('#wallet-rabby')],
  ['io.metamask', document.querySelector('#wallet-metamask')],
]);
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
});
function discoverWallets() {
  window.dispatchEvent(new window.Event('eip6963:requestProvider'));
}
document.querySelector('#refresh-wallets').addEventListener('click', () => {
  discoverWallets();
  status.textContent =
    'Looking for wallets. If yours is missing, enable it for this site and reload.';
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
      result.error?.message ?? 'The request could not be completed.',
    );
    error.status = response.status;
    throw error;
  }
  return result;
}
function showSession(session) {
  csrfToken = session.csrfToken;
  window.gozneSession = session;
  window.dispatchEvent(new window.Event('gozne:session'));
  sessionPanel.hidden = false;
  status.textContent = `Signed in as ${session.identity}. Session expires at ${new Date(session.expiresAt).toLocaleTimeString()}.`;
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
  status.textContent =
    'Working… Review your wallet if a signature is requested.';
  try {
    await operation();
  } catch (error) {
    status.textContent = error.message || 'Sign-in failed.';
  } finally {
    buttons.forEach((button) => {
      button.disabled = previous.get(button);
    });
    document.querySelector('#refresh-panel').disabled = !window.gozneSession;
    operationPending = false;
  }
}

document.querySelector('#evm').addEventListener('click', () =>
  busy(async () => {
    const provider = providers.get(walletSelect.value);
    if (!provider?.request)
      throw new Error(
        'Select a detected wallet. Another wallet will never be opened in its place.',
      );
    const [address] = await provider.request({ method: 'eth_requestAccounts' });
    const chainId = BigInt(
      await provider.request({ method: 'eth_chainId' }),
    ).toString();
    const challenge = await api('nonce', {
      application: 'demo',
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
        'This demo needs Phantom with Sign-In With Solana support.',
      );
    const connected = await provider.connect();
    const address = connected.publicKey.toString();
    const chainId = document.querySelector('#solana-chain').value;
    const challenge = await api('nonce', {
      application: 'demo',
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
    status.textContent = 'Signed out.';
  }),
);
api('me')
  .then(showSession)
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

/* global window, document */
'use strict';

const status = document.querySelector('#status');
const sessionPanel = document.querySelector('#session');
const walletSelect = document.querySelector('#evm-wallet');
const providers = new Map();
let csrfToken = null;

window.addEventListener('eip6963:announceProvider', (event) => {
  const { info, provider } = event.detail ?? {};
  if (!info || !provider || providers.has(info.uuid)) return;
  providers.set(info.uuid, provider);
  const option = document.createElement('option');
  option.value = info.uuid;
  option.textContent = String(info.name).slice(0, 80);
  walletSelect.append(option);
});
window.dispatchEvent(new window.Event('eip6963:requestProvider'));

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
  if (!response.ok)
    throw new Error(
      result.error?.message ?? 'No se pudo completar la petición.',
    );
  return result;
}
function showSession(session) {
  csrfToken = session.csrfToken;
  sessionPanel.hidden = false;
  status.textContent = `Has entrado como ${session.identity}. La sesión caduca a las ${new Date(session.expiresAt).toLocaleTimeString()}.`;
}
async function busy(operation) {
  const buttons = document.querySelectorAll('button');
  buttons.forEach((button) => {
    button.disabled = true;
  });
  status.textContent = 'Revisa la solicitud en tu wallet…';
  try {
    await operation();
  } catch (error) {
    status.textContent = error.message || 'No se pudo iniciar sesión.';
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}

document.querySelector('#evm').addEventListener('click', () =>
  busy(async () => {
    const provider = providers.get(walletSelect.value) ?? window.ethereum;
    if (!provider?.request)
      throw new Error('No encuentro una wallet EVM en este navegador.');
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
        'Esta demo necesita una wallet Phantom con Sign-In With Solana.',
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
    sessionPanel.hidden = true;
    status.textContent = 'Sesión cerrada.';
  }),
);
api('me')
  .then(showSession)
  .catch(() => {
    /* No active session on first visit. */
  });

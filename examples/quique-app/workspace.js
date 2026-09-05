/* global window, document */
'use strict';
let session;
async function refresh() {
  const response = await fetch('/v1/auth/me', { credentials: 'same-origin' });
  if (!response.ok) {
    window.location.replace('/');
    return;
  }
  session = await response.json();
  document.querySelector('#wallet').textContent = session.address;
  document.querySelector('#expires').textContent = new Date(
    session.expiresAt,
  ).toLocaleString();
  document.querySelector('#status').textContent = 'Your session is active.';
}
document.querySelector('#logout').addEventListener('click', async () => {
  try {
    if (!session) await refresh();
    if (!session) return;
    const response = await fetch('/v1/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': session.csrfToken,
      },
      body: '{}',
    });
    if (response.ok || response.status === 401) window.location.replace('/');
    else throw new Error('Could not sign out. Try again.');
  } catch (error) {
    document.querySelector('#status').textContent = error.message;
  }
});
refresh().catch(() => {
  document.querySelector('#status').textContent =
    'Could not check your session. Reload to retry.';
});
window.setInterval(() => {
  if (!document.hidden)
    refresh().catch(() => {
      document.querySelector('#status').textContent =
        'Connection interrupted. Retrying shortly.';
    });
}, 30000);

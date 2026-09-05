import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(
  new URL('../../examples/login/login.js', import.meta.url),
  'utf8',
);
class Element {
  value = '';
  textContent = '';
  disabled = false;
  hidden = true;
  options: Element[] = [];
  handlers = new Map<string, () => Promise<void>>();
  append(option: Element) {
    this.options.push(option);
  }
  addEventListener(name: string, handler: () => Promise<void>) {
    this.handlers.set(name, handler);
  }
}
function fixture() {
  const elements = new Map<string, Element>();
  const querySelector = (selector: string) => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector)!;
  };
  const requests: string[] = [];
  const listeners = new Map<string, (event: unknown) => void>();
  let defaultCalls = 0;
  runInNewContext(source, {
    document: {
      querySelector,
      querySelectorAll: () => [],
      createElement: () => new Element(),
    },
    window: {
      ethereum: {
        request() {
          defaultCalls++;
          throw new Error('Default provider must not be used');
        },
      },
      addEventListener: (name: string, fn: (event: unknown) => void) =>
        listeners.set(name, fn),
      dispatchEvent() {},
      Event: class {},
    },
    TextEncoder,
    fetch: async (url: string) => ({
      ok: true,
      json: async () => {
        requests.push(url);
        if (url.endsWith('/nonce'))
          return { nonce: 'test', message: 'Synthetic sign-in' };
        return {
          identity: 'tester',
          expiresAt: Date.now() + 1000,
          csrfToken: 'test',
        };
      },
    }),
  });
  function announce(rdns: string, calls: string[]) {
    listeners.get('eip6963:announceProvider')!({
      detail: {
        info: { uuid: rdns, rdns, name: rdns },
        provider: {
          request: async ({ method }: { method: string }) => {
            calls.push(method);
            if (method === 'eth_requestAccounts') return ['synthetic-address'];
            if (method === 'eth_chainId') return '0x1';
            return 'synthetic-signature';
          },
        },
      },
    });
  }
  return {
    querySelector,
    announce,
    requests,
    defaultCalls: () => defaultCalls,
  };
}

test('choosing Rabby uses only Rabby with MetaMask installed, regardless of announcement order', async () => {
  for (const order of [
    ['io.metamask', 'io.rabby'],
    ['io.rabby', 'io.metamask'],
  ]) {
    const f = fixture();
    const rabby: string[] = [];
    const metamask: string[] = [];
    for (const name of order)
      f.announce(name, name === 'io.rabby' ? rabby : metamask);
    assert.equal(
      f.querySelector('#evm-wallet').value,
      '',
      'discovery must not choose for the user',
    );
    f.querySelector('#evm-wallet').value = 'io.rabby';
    // A later MetaMask announcement must not change the selected provider.
    f.announce('io.metamask', metamask);
    await f.querySelector('#evm').handlers.get('click')!();
    assert.deepEqual(rabby, [
      'eth_requestAccounts',
      'eth_chainId',
      'personal_sign',
    ]);
    assert.deepEqual(metamask, []);
    assert.equal(f.defaultCalls(), 0);
    assert.ok(f.requests.includes('/v1/auth/verify'));
  }
});

test('an unavailable selection never falls back to the default wallet', async () => {
  const f = fixture();
  const metamask: string[] = [];
  f.announce('io.metamask', metamask);
  f.querySelector('#evm-wallet').value = 'io.rabby';
  await f.querySelector('#evm').handlers.get('click')!();
  assert.deepEqual(metamask, []);
  assert.equal(f.defaultCalls(), 0);
  assert.equal(f.requests.includes('/v1/auth/nonce'), false);
  assert.match(
    f.querySelector('#status').textContent,
    /Selecciona una wallet detectada/,
  );
});

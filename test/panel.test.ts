import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setImmediate } from 'node:timers/promises';
import { createContext, runInContext } from 'node:vm';
import test from 'node:test';

test('login and panel scripts coexist and render administrator actions without unsafe HTML', async () => {
  class Element {
    textContent = '';
    value = '';
    disabled = false;
    hidden = false;
    checked = true;
    type = '';
    className = '';
    href = '';
    children: Element[] = [];
    handlers = new Map<string, (event?: unknown) => unknown>();
    append(...nodes: Element[]) {
      this.children.push(...nodes);
    }
    replaceChildren(...nodes: Element[]) {
      this.children = nodes;
    }
    addEventListener(name: string, handler: (event?: unknown) => unknown) {
      this.handlers.set(name, handler);
    }
    set innerHTML(_value: string) {
      throw new Error('Unsafe HTML insertion');
    }
  }
  const elements = new Map<string, Element>();
  const select = (id: string) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id)!;
  };
  const listeners = new Map<
    string,
    (event: { type: string; detail?: unknown }) => void
  >();
  const address = '0x0000000000000000000000000000000000000001';
  const session = {
    id: 'session',
    identity: 'owner',
    network: 'evm',
    address,
    application: 'demo',
    roles: ['reader', 'admin'],
    expiresAt: Date.now() + 60000,
    csrfToken: 'csrf',
  };
  const action = {
    id: 'action',
    requester: 'owner',
    payload: {
      project: '<script>untrusted</script>',
      version: 'v1',
      environment: 'staging',
    },
    payloadHash: 'abc',
    status: 'pending',
    expiresAt: Date.now() + 60000,
    approvedBy: null,
  };
  const requests: {
    url: string;
    body: unknown;
    headers: Record<string, string>;
  }[] = [];
  const walletCalls: string[] = [];
  const timers: (() => Promise<void>)[] = [];
  let revoked = false;
  let unavailable = false;
  const delays: number[] = [];
  const page = {
    hidden: false,
    querySelector: select,
    querySelectorAll: () => [],
    createElement: () => new Element(),
    createTextNode: (text: string) => {
      const node = new Element();
      node.textContent = text;
      return node;
    },
  };
  const context = createContext({
    document: page,
    window: {
      setTimeout: (callback: () => Promise<void>, delay: number) => {
        delays.push(delay);
        timers.push(callback);
        return timers.length;
      },
      clearTimeout: () => {},
      addEventListener: (
        name: string,
        handler: (event: { type: string; detail?: unknown }) => void,
      ) => listeners.set(name, handler),
      dispatchEvent: (event: { type: string }) =>
        listeners.get(event.type)?.(event),
      Event: class {
        constructor(public type: string) {}
      },
    },
    TextEncoder,
    fetch: async (
      url: string,
      options: { body?: string; headers: Record<string, string> },
    ) => {
      requests.push({
        url,
        body: options.body ? JSON.parse(options.body) : null,
        headers: options.headers,
      });
      let result: unknown = session;
      if (url === '/v1/auth/control')
        result = {
          actions: [
            {
              ...action,
              permissions: {
                approve: action.status === 'pending',
                execute: action.status === 'approved',
                cancel: ['pending', 'approved'].includes(action.status),
              },
            },
          ],
          invitations: [],
          sessions: [],
          deployments: [],
        };
      if (url.endsWith('/challenge'))
        result = {
          nonce: 'nonce',
          message: 'Exact action proof',
          expiresAt: Date.now() + 1000,
        };
      if (url.endsWith('/approve')) {
        action.status = 'approved';
        result = action;
      }
      if (url.endsWith('/execute')) {
        action.status = 'executed';
        result = { action, receipt: { simulated: true } };
      }
      return {
        ok: !((revoked || unavailable) && url.endsWith('/me')),
        status:
          revoked && url.endsWith('/me')
            ? 401
            : unavailable && url.endsWith('/me')
              ? 503
              : 200,
        json: async () => result,
      };
    },
  });
  for (const file of ['login.js', 'panel.js'])
    runInContext(
      readFileSync(
        new URL(`../../examples/login/${file}`, import.meta.url),
        'utf8',
      ),
      context,
    );
  await setImmediate();
  assert.equal(select('#connection-state').textContent, 'ADMIN');
  assert.equal(select('#invite-fields').disabled, false);
  assert.equal(select('#action-fields').disabled, false);
  assert.equal(select('#metric-pending').textContent, 1);
  const record = select('#action-list').children[0]!;
  assert.equal(
    record.children[0]!.children[0]!.textContent,
    '<script>untrusted</script> / v1',
  );
  listeners.get('eip6963:announceProvider')!({
    type: 'eip6963:announceProvider',
    detail: {
      info: { uuid: 'rabby', rdns: 'io.rabby', name: 'Rabby' },
      provider: {
        request: async ({ method }: { method: string }) => {
          walletCalls.push(method);
          return method === 'eth_requestAccounts'
            ? [address]
            : method === 'eth_chainId'
              ? '0x1'
              : 'signature';
        },
      },
    },
  });
  select('#evm-wallet').value = 'io.rabby';
  await record.children
    .at(-1)!
    .children.find((node) => node.textContent === 'Sign approval')!
    .handlers.get('click')!();
  assert.deepEqual(walletCalls, [
    'eth_requestAccounts',
    'eth_chainId',
    'personal_sign',
  ]);
  const approval = requests.find((request) =>
    request.url.endsWith('/approve'),
  )!;
  assert.equal(approval.headers['X-CSRF-Token'], 'csrf');
  assert.deepEqual(approval.body, {
    nonce: 'nonce',
    message: 'Exact action proof',
    signature: 'signature',
  });
  const approved = select('#action-list').children[0]!;
  await approved.children
    .at(-1)!
    .children.find((node) => node.textContent === 'Execute simulation once')!
    .handlers.get('click')!();
  assert.equal(select('#metric-executed').textContent, 1);
  assert.equal(
    select('#action-list').children[0]!.children.at(-1)!.children.length,
    0,
  );
  const before = requests.length;
  page.hidden = true;
  await timers.at(-1)!();
  assert.equal(requests.length, before, 'hidden tabs must not poll');
  page.hidden = false;
  unavailable = true;
  await timers.at(-1)!();
  assert.equal(delays.at(-1), 60000);
  await timers.at(-1)!();
  assert.equal(delays.at(-1), 120000);
  unavailable = false;
  await timers.at(-1)!();
  assert.equal(delays.at(-1), 30000);
  revoked = true;
  await timers.at(-1)!();
  assert.equal(select('#sync-status').textContent, 'Session ended');
  assert.equal(select('#connection-state').textContent, 'DISCONNECTED');
  assert.equal(select('#invite-fields').disabled, true);
  assert.equal(select('#action-fields').disabled, true);
});

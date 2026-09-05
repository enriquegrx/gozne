import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(
  new URL('../../examples/login/i18n.js', import.meta.url),
  'utf8',
);

class FakeElement {
  dataset: Record<string, string> = {};
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  classList = { add: () => {} };
  handlers = new Map<string, () => void>();
  textContent = '';
  title = '';
  type = '';

  hasAttribute(name: string) {
    return this.attributes.has(name);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  replaceChildren(...children: FakeElement[]) {
    this.children = children;
  }

  append(child: FakeElement) {
    this.children.push(child);
  }

  addEventListener(name: string, handler: () => void) {
    this.handlers.set(name, handler);
  }
}

test('the shared interface follows and persists an explicit locale', () => {
  const textNode = {
    nodeValue: '  Choose your wallet  ',
    parentElement: { tagName: 'H2' },
  };
  const labelled = new FakeElement();
  labelled.attributes.set('aria-label', 'Authentication guarantees');
  const switcher = new FakeElement();
  const stored = new Map<string, string>();
  const events: Array<{ type: string; detail: unknown }> = [];
  const document = {
    title: 'Gozne · Sign in',
    documentElement: { lang: '' },
    createTreeWalker: () => {
      let delivered = false;
      return {
        nextNode: () => {
          if (delivered) return null;
          delivered = true;
          return textNode;
        },
      };
    },
    querySelectorAll: (selector: string) =>
      selector === '[data-language-switcher]' ? [switcher] : [labelled],
    createElement: () => new FakeElement(),
  };
  const window = {
    NodeFilter: { SHOW_TEXT: 4 },
    location: { search: '' },
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    },
    CustomEvent: class {
      type: string;
      detail: unknown;
      constructor(type: string, init: { detail: unknown }) {
        this.type = type;
        this.detail = init.detail;
      }
    },
    dispatchEvent: (event: { type: string; detail: unknown }) =>
      events.push(event),
    GozneI18n: undefined as unknown,
  };

  vm.runInNewContext(source, {
    document,
    Intl,
    navigator: { language: 'es-ES' },
    Object,
    URLSearchParams,
    WeakMap,
    window,
  });

  const i18n = window.GozneI18n as {
    locale: string;
    t: (key: string) => string;
  };
  assert.equal(document.documentElement.lang, 'es');
  assert.equal(document.title, 'Gozne · Iniciar sesión');
  assert.equal(textNode.nodeValue, '  Elige tu wallet  ');
  assert.equal(
    labelled.attributes.get('aria-label'),
    'Garantías de autenticación',
  );
  assert.equal(switcher.children.length, 2);
  assert.equal(i18n.t('No gas or network fee'), 'Sin gas ni comisiones de red');

  switcher.children[0]!.handlers.get('click')!();
  assert.equal(i18n.locale, 'en');
  assert.equal(stored.get('gozne.locale'), 'en');
  assert.equal(textNode.nodeValue, '  Choose your wallet  ');
  assert.equal(events.at(-1)?.type, 'gozne:languagechange');
  assert.equal(
    i18n.t('Canonical signature payload'),
    'Canonical signature payload',
  );
});

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);

const STATE = {
  ok: true,
  settings: {
    libraryDirs: [],
    outputDir: '',
    calibreDir: '',
    defaultFormat: 'mobi',
    push: { port: 8180, bind: '0.0.0.0' },
    kindle: { host: '', port: 22, user: 'root', documentsPath: '/mnt/us/documents', passwordConfigured: false, keyPathConfigured: false, keyPathHint: '' },
  },
  library: [],
  jobs: [],
  queue: [],
  push: { running: false, port: 8180, bind: '0.0.0.0', urls: [], queueCount: 0 },
  kindle: { configured: false, connected: false, host: '', port: 22, documentsPath: '/mnt/us/documents' },
  calibre: null,
};

test('client bundle 在 jsdom 里渲染不崩（hooks 回归）', async () => {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
    url: 'http://127.0.0.1:3080/',
    pretendToBeVisual: true,
  });
  global.window = dom.window;
  global.document = dom.window.document;
  Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
  global.HTMLElement = dom.window.HTMLElement;
  global.IS_REACT_ACT_ENVIRONMENT = true;

  let shown = false;
  global.fetch = async () => {
    shown = true;
    return { ok: true, status: 200, json: async () => ({ ...STATE }) };
  };

  let registration;
  global.window.__ModuleLoader__ = { load: (value) => { registration = value; } };
  require('../client.js');
  assert.ok(registration, 'client.js 应通过 __ModuleLoader__.load 注册');
  assert.equal(registration.id, '@morehao/dsh-kindle-shelf');

  // React 从 node_modules 解析，与下面 react-dom 用的是同一份。
  const exports = registration.factory(require);
  assert.equal(typeof exports.apply, 'function');

  let MainPanel = null;
  const slots = {
    register(options, component) {
      if (options.name === 'main') MainPanel = component;
    },
    inject(_name, factory) {
      factory();
      return () => undefined;
    },
  };
  const ctx = {
    get: (name) => (name === 'slots' ? slots : undefined),
    effect: (factory) => factory(),
  };
  exports.apply(ctx);
  assert.ok(MainPanel, '应注册 main 面板组件');

  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  let renderError = null;
  try {
    root.render(React.createElement(MainPanel));
    await new Promise((resolve) => setTimeout(resolve, 200));
  } catch (error) {
    renderError = error;
  }
  assert.equal(renderError, null, `渲染不应抛错：${renderError?.message ?? ''}`);
  assert.ok(shown, '应请求 /state');

  const text = document.getElementById('root').textContent ?? '';
  assert.match(text, /Kindle/);
  assert.match(text, /书库/);
  assert.match(text, /推送服务/);
});

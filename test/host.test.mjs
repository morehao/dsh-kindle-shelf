import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { zipSync, strToU8 } from 'fflate';

import { mergeSettings, normalizeSettings, parseEbookMeta, parseEpubMeta, DEFAULT_SETTINGS } from '../lib/internal.js';
import { apply } from '../lib/index.js';

// ── 纯函数 ──────────────────────────────────────────────────────────────

test('normalizeSettings 补默认值并做边界校验', () => {
  const settings = normalizeSettings({});
  assert.deepEqual(settings.libraryDirs, []);
  assert.equal(settings.defaultFormat, 'azw3');
  assert.equal(settings.push.port, 8180);
  assert.equal(settings.kindle.port, 22);

  const clamped = normalizeSettings({ push: { port: 70000 }, kindle: { port: -1 }, defaultFormat: 'pdf' });
  assert.equal(clamped.push.port, 65535);
  assert.equal(clamped.kindle.port, 1);
  assert.equal(clamped.defaultFormat, 'azw3');
});

test('mergeSettings 能清空密码但保留其它字段', () => {
  const base = normalizeSettings({ kindle: { host: '1.2.3.4', password: 'secret' } });
  assert.equal(base.kindle.password, 'secret');
  const cleared = mergeSettings(base, { kindle: { password: '' } });
  assert.equal(cleared.kindle.password, undefined);
  assert.equal(cleared.kindle.host, '1.2.3.4');
});

test('parseEbookMeta 解析 calibre 输出', () => {
  const meta = parseEbookMeta('Title               : 鹿鼎记\nAuthor(s)           : 金庸\nLanguage            : zh\n');
  assert.equal(meta.title, '鹿鼎记');
  assert.equal(meta.author, '金庸');
});

// ── EPUB 解析 ───────────────────────────────────────────────────────────

function makeEpub() {
  const container = `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;
  const opf = `<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>射雕英雄传</dc:title>
    <dc:creator>金庸</dc:creator>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="cover-img" href="images/cover.jpg" media-type="image/jpeg"/>
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine><itemref idref="ch1"/></spine>
</package>`;
  return zipSync(
    {
      mimetype: strToU8('application/epub+zip'),
      'META-INF/container.xml': strToU8(container),
      'OEBPS/content.opf': strToU8(opf),
      'OEBPS/images/cover.jpg': new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]),
      'OEBPS/ch1.xhtml': strToU8('<html><body>hi</body></html>'),
    },
    { level: 0 },
  );
}

test('parseEpubMeta 提取标题/作者/封面路径', () => {
  const meta = parseEpubMeta(makeEpub());
  assert.equal(meta.title, '射雕英雄传');
  assert.equal(meta.author, '金庸');
  assert.equal(meta.coverPath, 'OEBPS/images/cover.jpg');
});

test('parseEpubMeta 对坏数据返回空对象而不抛', () => {
  assert.deepEqual(parseEpubMeta(new Uint8Array([1, 2, 3])), {});
});

// ── 插件装配 + HTTP ─────────────────────────────────────────────────────

async function boot() {
  const dir = await mkdtemp(path.join(tmpdir(), 'dsh-kindle-test-'));
  await mkdir(path.join(dir, 'books'), { recursive: true });
  const book = path.join(dir, 'books', '雪山飞狐.epub');
  await writeFile(book, makeEpub());
  const pushPort = 20000 + Math.floor(Math.random() * 5000);
  await writeFile(
    path.join(dir, 'settings.json'),
    JSON.stringify({ libraryDirs: [path.join(dir, "books")], outputDir: path.join(dir, "out"), push: { port: pushPort } }),
  );

  const routes = [];
  const ctx = {
    get: () => undefined,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    webServer: { register: (options) => routes.push(options) },
    effect: () => {},
  };
  apply(ctx, { stateDir: dir });
  const registered = routes[0];
  assert.ok(registered, '应注册 webServer 路由');
  assert.equal(registered.path, '/api/morehao/kindle');

  const { createServer } = await import('node:http');
  const server = createServer((req, res) => void registered.handler(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const base = `http://127.0.0.1:${port}`;
  return {
    dir,
    book,
    pushPort,
    base,
    async close() {
      await fetch(`${base}/api/morehao/kindle/push/stop`, {
        method: 'POST',
        headers: { 'x-dsh-kindle': '1' },
      }).catch(() => undefined);
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
        server.closeIdleConnections?.();
      });
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function call(base, method, pathname, body, withHeader = true) {
  const response = await fetch(`${base}/api/morehao/kindle${pathname}`, {
    method,
    headers: { 'content-type': 'application/json', ...(withHeader ? { 'x-dsh-kindle': '1' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json };
}

test('HTTP 面：鉴权头、状态、书库、推送队列', async () => {
  const app = await boot();
  try {
    const denied = await call(app.base, 'GET', '/state', undefined, false);
    assert.equal(denied.status, 403);

    const state = await call(app.base, 'GET', '/state');
    assert.equal(state.status, 200);
    assert.equal(state.json.ok, true);
    assert.ok(Array.isArray(state.json.library));
    assert.equal(state.json.library.length, 1);
    assert.equal(state.json.library[0].title, '射雕英雄传');

    const queued = await call(app.base, 'POST', '/queue', { paths: [app.book] });
    assert.equal(queued.status, 200);
    assert.equal(queued.json.queue.length, 1);
    assert.match(queued.json.queue[0].slug, /\.epub$/);

    const removed = await call(app.base, 'DELETE', `/queue/${queued.json.queue[0].id}`);
    assert.equal(removed.json.removed, true);

    // 封面：不带自定义头也应可用
    const cover = await fetch(`${app.base}/api/morehao/kindle/cover?path=${encodeURIComponent(app.book)}`);
    assert.equal(cover.status, 200);
    assert.equal(cover.headers.get('content-type'), 'image/jpeg');
  } finally {
    await app.close();
  }
});

test('HTTP 面：转换任务拒绝不支持格式', async () => {
  const app = await boot();
  try {
    const bad = await call(app.base, 'POST', '/convert', { paths: ['/tmp/not-a-book.xyz'] });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.code, 'UNSUPPORTED_FORMAT');
  } finally {
    await app.close();
  }
});

test('推送页只暴露队列中的文件', async () => {
  const app = await boot();
  try {
    // 插件加载时异步启动推送服务：轮询到就绪再断言。
    const pushBase = `http://127.0.0.1:${app.pushPort}`;
    let page;
    for (let i = 0; i < 40; i += 1) {
      try {
        page = await fetch(`${pushBase}/`);
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    assert.ok(page, '推送服务应已启动');
    await call(app.base, 'POST', '/queue', { paths: [app.book] });
    const html = await (await fetch(`${pushBase}/`)).text();
    assert.match(html, /雪山飞狐/);
    const missing = await fetch(`${pushBase}/d/000000000000/deadbeef.epub`);
    assert.equal(missing.status, 404);
  } finally {
    await app.close();
  }
});

// 保持默认设置的对象不被测试污染
test('DEFAULT_SETTINGS 未被修改', () => {
  assert.deepEqual(DEFAULT_SETTINGS.libraryDirs, []);
  assert.equal(DEFAULT_SETTINGS.push.port, 8180);
});

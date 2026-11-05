/**
 * Host HTTP 面：`/api/morehao/kindle-shelf/*`。
 *
 * 除封面外一律要求自定义头 `x-dsh-kindle-shelf: 1`（跨源预检顺带挡 CSRF）；
 * 封面由 <img> 直接请求，无法带头，故单独放行，但只允许书库目录内的文件。
 */
import type http from 'node:http';

import { hasHeader, HttpError, readJsonBody, sendJson } from '@morehao/dsh-plugin-kit/http';

import type { Settings } from '../config.js';
import { mergeSettings, publicSettings } from '../config.js';
import { err, KindlError } from '../errors.js';
import type { Store } from '../state.js';
import type { Converter } from './convert.js';
import { probeConverter } from './convert.js';
import type { Library } from './library.js';
import type { PushServer } from './push.js';
import type { KindleSftp } from './sftp.js';

export const ROUTE_PREFIX = '/api/morehao/kindle-shelf';
export const HEADER = 'x-dsh-kindle-shelf';
const MAX_BODY = 256 * 1024;

export interface RouteDeps {
  store: Store;
  library: Library;
  converter: Converter;
  push: PushServer;
  sftp: KindleSftp;
  logger?: (event: string, data?: Record<string, unknown>) => void;
  /** 测试注入：跳过真实文件系统。 */
  env?: NodeJS.ProcessEnv;
}

export function createRoutes(deps: RouteDeps): (request: http.IncomingMessage, response: http.ServerResponse) => Promise<void> {
  return async (request, response) => {
    let pathname = '';
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      if (url.pathname === `${ROUTE_PREFIX}/cover`) {
        await cover(deps, url, response);
        return;
      }
      if (!hasHeader(request, HEADER)) {
        sendJson(response, 403, { ok: false, code: 'FORBIDDEN', message: '缺少鉴权头' });
        return;
      }
      pathname = url.pathname.startsWith(ROUTE_PREFIX)
        ? url.pathname.slice(ROUTE_PREFIX.length) || '/'
        : url.pathname;
      const body = request.method === 'POST' || request.method === 'DELETE' ? await readJsonBody(request, { maxBytes: MAX_BODY }) : {};
      const result = await dispatch(deps, request.method ?? 'GET', pathname, url, body);
      sendJson(response, 200, { ok: true, ...result });
    } catch (error) {
      const mapped = mapError(error);
      deps.logger?.('route.error', { pathname, code: mapped.code, message: mapped.message });
      sendJson(response, mapped.status, { ok: false, code: mapped.code, message: mapped.message });
    }
  };
}

function mapError(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof HttpError) {
    return { status: 400, code: error.code, message: error.message };
  }
  if (error instanceof KindlError) {
    const status = error.code === 'NOT_FOUND' || error.code === 'KINDLE_NOT_FOUND' ? 404 : 400;
    return { status, code: error.code, message: error.message };
  }
  return { status: 500, code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) };
}

async function dispatch(
  deps: RouteDeps,
  method: string,
  pathname: string,
  url: URL,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { store, library, converter, push, sftp } = deps;

  if (method === 'GET' && pathname === '/state') {
    const settings = store.readSettings();
    return {
      settings: publicSettings(settings),
      library: await library.scan(),
      jobs: converter.list(),
      queue: push.queueList(),
      push: push.status(),
      kindle: sftp.status(),
      calibre: probeConverter(settings) ?? null,
    };
  }

  if (method === 'GET' && pathname === '/library') {
    return { books: await library.scan() };
  }

  if (method === 'POST' && pathname === '/library/enrich') {
    const file = stringField(body.path);
    if (file === '') throw err('NOT_FOUND', '缺少 path');
    const map = await library.enrichWithCalibre(file);
    return { meta: map };
  }

  if (method === 'POST' && pathname === '/convert') {
    const paths = stringArray(body.paths);
    if (paths.length === 0) throw err('INVALID_INPUT', '缺少 paths');
    const settings = store.readSettings();
    const format = body.format === 'mobi' ? 'mobi' : body.format === 'azw3' ? 'azw3' : settings.defaultFormat;
    return { jobs: converter.submit(paths, format) };
  }

  if (method === 'GET' && pathname === '/jobs') {
    return { jobs: converter.list() };
  }

  if (method === 'POST' && pathname === '/jobs/cancel') {
    const id = stringField(body.id);
    return { cancelled: converter.cancel(id) };
  }

  if (method === 'POST' && pathname === '/queue') {
    const paths = stringArray(body.paths);
    if (paths.length === 0) throw err('INVALID_INPUT', '缺少 paths');
    const added = push.add(paths);
    return { added, queue: push.queueList() };
  }

  if (method === 'DELETE' && pathname.startsWith('/queue/')) {
    const id = pathname.slice('/queue/'.length);
    return { removed: push.remove(id), queue: push.queueList() };
  }

  if (method === 'POST' && pathname === '/push/start') {
    return { status: await push.start() };
  }

  if (method === 'POST' && pathname === '/push/stop') {
    return { status: await push.stop() };
  }

  if (method === 'GET' && pathname === '/push') {
    return { status: push.status() };
  }

  if (method === 'GET' && pathname === '/kindle') {
    const status = sftp.status();
    let books: unknown[] = [];
    if (status.configured) {
      try {
        books = await sftp.list();
      } catch (error) {
        return { status: { ...sftp.status(), error: error instanceof Error ? error.message : String(error) }, books: [] };
      }
    }
    return { status: sftp.status(), books };
  }

  if (method === 'POST' && pathname === '/kindle/connect') {
    const settings = mergeSettings(store.readSettings(), { kindle: pickKindle(body) });
    store.writeSettings(settings);
    await sftp.disconnect();
    if (settings.kindle.host === '') {
      return { status: sftp.status() };
    }
    await sftp.ensure();
    return { status: sftp.status() };
  }

  if (method === 'POST' && pathname === '/kindle/disconnect') {
    await sftp.disconnect();
    return { status: sftp.status() };
  }

  if (method === 'POST' && pathname === '/kindle/upload') {
    const paths = stringArray(body.paths);
    if (paths.length === 0) throw err('INVALID_INPUT', '缺少 paths');
    return await sftp.upload(paths);
  }

  if (method === 'POST' && pathname === '/kindle/delete') {
    const names = stringArray(body.names);
    if (names.length === 0) throw err('INVALID_INPUT', '缺少 names');
    return await sftp.remove(names);
  }

  if (method === 'POST' && pathname === '/kindle/download') {
    const names = stringArray(body.names);
    const targetDir = stringField(body.targetDir);
    if (names.length === 0) throw err('INVALID_INPUT', '缺少 names');
    if (targetDir === '') throw err('INVALID_INPUT', '缺少 targetDir');
    return await sftp.download(names, targetDir);
  }

  if (method === 'GET' && pathname === '/settings') {
    const settings = store.readSettings();
    return { settings: publicSettings(settings) };
  }

  if (method === 'POST' && pathname === '/settings') {
    const previous = store.readSettings();
    const settings = mergeSettings(previous, body);
    assertSettings(settings);
    store.writeSettings(settings);
    if (settings.push.port !== previous.push.port || settings.push.bind !== previous.push.bind) {
      await push.reconfigure(settings.push.port, settings.push.bind);
    }
    return { settings: publicSettings(settings), push: push.status() };
  }

  throw err('NOT_FOUND', `未知路由：${url.pathname}`);
}

/** 封面：不要求自定义头（<img> 带不了），但只允许书库目录内的 epub。 */
async function cover(deps: RouteDeps, url: URL, response: http.ServerResponse): Promise<void> {
  const file = url.searchParams.get('path') ?? '';
  if (file === '' || !deps.library.isAllowed(file)) {
    sendJson(response, 404, { ok: false, code: 'NOT_FOUND', message: '不允许的路径' });
    return;
  }
  const found = await deps.library.coverFor(file);
  if (found === null) {
    response.writeHead(204, { 'cache-control': 'no-store' });
    response.end();
    return;
  }
  response.writeHead(200, {
    'content-type': `image/${found.ext === 'jpg' ? 'jpeg' : found.ext}`,
    'content-length': String(found.data.length),
    'cache-control': 'private, max-age=86400',
  });
  response.end(found.data);
}

function assertSettings(settings: Settings): void {
  for (const dir of settings.libraryDirs) {
    if (!dir.startsWith('/') && !dir.startsWith('~')) throw err('INVALID_INPUT', `书库目录必须是绝对路径：${dir}`);
  }
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim());
}

function pickKindle(body: Record<string, unknown>): Record<string, unknown> {
  const source = (body.kindle ?? body) as Record<string, unknown>;
  return {
    ...(source.host !== undefined ? { host: source.host } : {}),
    ...(source.port !== undefined ? { port: source.port } : {}),
    ...(source.user !== undefined ? { user: source.user } : {}),
    ...(source.password !== undefined ? { password: source.password } : {}),
    ...(source.keyPath !== undefined ? { keyPath: source.keyPath } : {}),
  };
}

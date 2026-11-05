/**
 * 局域网推送服务：Mac 当只读服务端，Kindle 用自带浏览器来拉书。
 *
 * 这是未越狱设备唯一可行的局域网路径。安全边界刻意收紧：
 *   - 只服务「推送队列」里登记过的文件，不开放任意路径；
 *   - 默认绑 0.0.0.0 但只读，无写接口；
 *   - 下载名用 ASCII slug（Kindle 浏览器对中文名兼容差），中文名走 filename*。
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { err } from '../errors.js';
import type { QueueItem } from '../types.js';
import { lanAddresses } from './net.js';

/** Kindle 浏览器只放行这些扩展名；AZW3 与 AZW 同为 KF8，仅换名。 */
const DOWNLOAD_EXTS = new Set(['.azw', '.azw3', '.prc', '.mobi', '.epub', '.pdf', '.txt']);

const MIME: Record<string, string> = {
  '.azw': 'application/vnd.amazon.ebook',
  '.azw3': 'application/vnd.amazon.ebook',
  '.prc': 'application/x-mobipocket-ebook',
  '.mobi': 'application/x-mobipocket-ebook',
  '.epub': 'application/epub+zip',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
};

export interface PushStatus {
  running: boolean;
  port: number;
  bind: string;
  urls: string[];
  error?: string;
  queueCount: number;
}

function asciiSlug(name: string): string {
  const stem = path.basename(name, path.extname(name));
  const slug = stem
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug === '' ? 'book' : slug;
}

function serveExt(original: string): string {
  const ext = path.extname(original).toLowerCase();
  if (!DOWNLOAD_EXTS.has(ext)) return '.azw';
  // 对外统一呈现 .azw：Kindle 浏览器只认 .AZW/.PRC/.MOBI/.TXT。
  if (ext === '.azw3') return '.azw';
  if (ext === '.prc') return '.mobi';
  return ext;
}

function human(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = n;
  let unit = 'B';
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return `${value.toFixed(1)} ${unit}`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch] ?? ch);
}

export interface PushServerOptions {
  /** 队列变化的持久化回调。 */
  onQueueChanged: (queue: QueueItem[]) => void;
  /** 启动时从磁盘恢复的队列。 */
  initialQueue: QueueItem[];
  /** 默认端口与绑定地址。 */
  port: number;
  bind: string;
  logger?: (event: string, data?: Record<string, unknown>) => void;
}

export class PushServer {
  private options: PushServerOptions;
  private server: ReturnType<typeof createServer> | undefined;
  private queue: QueueItem[];
  private port: number;
  private bind: string;
  private error: string | undefined;

  constructor(options: PushServerOptions) {
    this.options = options;
    this.queue = [...options.initialQueue];
    this.port = options.port;
    this.bind = options.bind;
  }

  queueList(): QueueItem[] {
    return [...this.queue];
  }

  status(): PushStatus {
    const running = this.server !== undefined;
    return {
      running,
      port: this.port,
      bind: this.bind,
      urls: running ? this.urls() : [],
      queueCount: this.queue.length,
      ...(this.error === undefined ? {} : { error: this.error }),
    };
  }

  urls(): string[] {
    const port = this.port;
    return lanAddresses().map((ip) => `http://${ip}:${port}/`);
  }

  /** 加入推送队列；已存在的同路径跳过。 */
  add(paths: string[]): QueueItem[] {
    const added: QueueItem[] = [];
    for (const file of paths) {
      if (this.queue.some((item) => item.path === file)) continue;
      const ext = serveExt(file);
      const slug = `${asciiSlug(file)}${ext}`;
      const item: QueueItem = {
        id: createHash('sha1').update(`${file}:${Date.now()}`).digest('hex').slice(0, 12),
        path: file,
        slug,
        title: path.basename(file, path.extname(file)),
        size: 0,
        addedAt: Date.now(),
      };
      this.queue.push(item);
      added.push(item);
    }
    if (added.length > 0) this.options.onQueueChanged(this.queue);
    return added;
  }

  remove(id: string): boolean {
    const index = this.queue.findIndex((item) => item.id === id);
    if (index < 0) return false;
    this.queue.splice(index, 1);
    this.options.onQueueChanged(this.queue);
    return true;
  }

  /** 端口/绑定地址变化后调用；正在运行时会重启监听。 */
  async reconfigure(port: number, bind: string): Promise<void> {
    if (port === this.port && bind === this.bind) return;
    const wasRunning = this.server !== undefined;
    if (wasRunning) await this.stop();
    this.port = port;
    this.bind = bind;
    if (wasRunning) await this.start().catch(() => undefined);
  }

  async start(): Promise<PushStatus> {
    if (this.server !== undefined) return this.status();
    this.error = undefined;
    const server = createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', (error: NodeJS.ErrnoException) => {
        this.error = error.code === 'EADDRINUSE' ? `端口 ${this.port} 已被占用` : error.message;
        reject(err('PUSH_START_FAILED', this.error));
      });
      server.listen(this.port, this.bind, () => resolve());
    });
    this.server = server;
    this.options.logger?.('push.started', { port: this.port, urls: this.urls() });
    return this.status();
  }

  async stop(): Promise<PushStatus> {
    const server = this.server;
    this.server = undefined;
    if (server !== undefined) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      this.options.logger?.('push.stopped', {});
    }
    return this.status();
  }

  private resolveItem(id: string, slug: string): QueueItem {
    const item = this.queue.find((entry) => entry.id === id);
    if (item === undefined) throw err('NOT_FOUND', '文件不在推送队列中');
    if (slug !== '' && item.slug !== slug) throw err('NOT_FOUND', '文件名不匹配');
    return item;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        this.text(response, 405, 'method not allowed');
        return;
      }
      const pathname = decodeURIComponent(url.pathname);

      if (pathname === '/' || pathname === '/index.html') {
        this.html(response, 200, this.indexPage());
        return;
      }

      const match = pathname.match(/^\/d\/([a-f0-9]+)(?:\/([^/]+))?$/);
      if (match?.[1] !== undefined) {
        await this.download(response, match[1], match[2] === undefined ? '' : decodeURIComponent(match[2]), request.method === 'HEAD');
        return;
      }

      this.text(response, 404, 'not found');
    } catch (error) {
      this.text(response, 404, error instanceof Error ? error.message : 'not found');
    }
  }

  private async download(response: ServerResponse, id: string, slug: string, headOnly: boolean): Promise<void> {
    const item = this.resolveItem(id, slug);
    const info = await stat(item.path);
    if (!info.isFile()) throw err('NOT_FOUND', '文件不存在');
    const ext = path.extname(item.slug).toLowerCase();
    const ctype = MIME[ext] ?? 'application/octet-stream';
    const encoded = encodeURIComponent(`${item.title}${ext}`);

    response.writeHead(200, {
      'content-type': ctype,
      'content-length': String(info.size),
      'accept-ranges': 'bytes',
      'content-disposition': `attachment; filename="${item.slug}"; filename*=UTF-8''${encoded}`,
      'cache-control': 'no-store',
    });
    if (headOnly) {
      response.end();
      return;
    }
    const stream = createReadStream(item.path);
    stream.on('error', () => response.destroy());
    stream.pipe(response);
    item.size = info.size;
    item.downloadedAt = Date.now();
    this.options.onQueueChanged(this.queue);
    this.options.logger?.('push.download', { id: item.id, slug: item.slug, size: info.size });
  }

  private indexPage(): string {
    const queue = this.queue;
    const rows = queue
      .map((item) => {
        const href = `/d/${item.id}/${encodeURIComponent(item.slug)}`;
        const done = item.downloadedAt === undefined ? '' : '<span class="done">已下载</span>';
        return `<tr><td><a href="${href}">${escapeHtml(item.title)}</a>
          <div class="meta">${escapeHtml(path.extname(item.slug).slice(1).toUpperCase())} · ${human(item.size)} ${done}</div></td></tr>`;
      })
      .join('');

    return `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Send to Kindle</title>
<style>
  body{font-family:-apple-system,"Helvetica Neue",Helvetica,Arial,sans-serif;margin:0;padding:18px;background:#fff;color:#111}
  h1{font-size:22px;margin:0 0 2px}
  p.hint{color:#666;font-size:13px;margin:0 0 18px}
  table{width:100%;border-collapse:collapse}
  td{padding:14px 0;border-bottom:1px solid #e5e5e5;font-size:17px;line-height:1.4}
  a{color:#0a5cbf;text-decoration:none;font-weight:600}
  .meta{color:#777;font-size:12px;font-weight:400;margin-top:4px}
  .done{color:#1a7f37;margin-left:8px}
  .empty{color:#777;font-size:15px;padding:24px 0}
</style></head><body>
<h1>传给 Kindle</h1>
<p class="hint">点书名下载，下载完成后会出现在 Kindle 书库（未出现时用「本机 → 文档」同步一次）。</p>
${rows === '' ? '<div class="empty">推送队列是空的。在 DSH 的 Kindle 工作台里把书加入队列后再刷新本页。</div>' : `<table>${rows}</table>`}
</body></html>`;
  }

  private html(response: ServerResponse, status: number, body: string): void {
    response.writeHead(status, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': String(Buffer.byteLength(body)),
    });
    response.end(body);
  }

  private text(response: ServerResponse, status: number, body: string): void {
    response.writeHead(status, {
      'content-type': 'text/plain; charset=utf-8',
      'cache-control': 'no-store',
      'content-length': String(Buffer.byteLength(body)),
    });
    response.end(body);
  }
}

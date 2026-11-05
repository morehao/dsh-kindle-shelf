/**
 * 本机书库：扫描目录、提取标题/作者/封面。
 *
 * EPUB 走 fflate 直解（快，无进程）；其它格式先用文件名，必要时由
 * ebook-meta 兜底。封面按「路径 + mtime」缓存在 <stateDir>/covers。
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Settings } from '../config.js';
import { LIBRARY_EXTS } from '../config.js';
import type { BookEntry } from '../types.js';
import { binaryPath, CALIBRE_BINARIES, runCalibre } from './calibre.js';
import { coverExtension, extractEpubCover, parseEpubMeta } from './epub.js';

const SKIP_DIRS = new Set(['node_modules', '@eaDir', '#recycle', '.Trash', '.git', '.svn']);
const MAX_SCAN_DEPTH = 6;
const MAX_EPUB_BYTES = 300 * 1024 * 1024;

interface MetaCache {
  mtimeMs: number;
  title?: string;
  author?: string;
  coverPath?: string;
}

function baseName(file: string): string {
  return path.basename(file, path.extname(file));
}

export class Library {
  private settings: () => Settings;
  private coverDir: string;
  private metaCache = new Map<string, MetaCache>();

  constructor(options: { settings: () => Settings; coverDir: string }) {
    this.settings = options.settings;
    this.coverDir = options.coverDir;
  }

  /** 扫描书库目录 + 转换输出目录，返回按路径排序的书籍列表。 */
  async scan(): Promise<BookEntry[]> {
    const files: string[] = [];
    for (const dir of this.roots()) {
      await walk(dir, 0, files);
    }
    files.sort();
    const entries: BookEntry[] = [];
    for (const file of files) {
      const entry = await this.entryFor(file);
      if (entry !== null) entries.push(entry);
    }
    return entries;
  }

  private async entryFor(file: string): Promise<BookEntry | null> {
    let info;
    try {
      info = await stat(file);
    } catch {
      return null;
    }
    if (!info.isFile()) return null;
    const format = path.extname(file).toLowerCase();
    if (!LIBRARY_EXTS.has(format)) return null;

    let title = baseName(file);
    let author = '';
    let cover = false;
    if (format === '.epub' && info.size <= MAX_EPUB_BYTES) {
      const cached = this.metaCache.get(file);
      if (cached !== undefined && cached.mtimeMs === info.mtimeMs) {
        title = cached.title ?? title;
        author = cached.author ?? author;
        cover = cached.coverPath !== undefined;
      } else {
        try {
          const buffer = await readFile(file);
          const meta = parseEpubMeta(buffer);
          this.metaCache.set(file, { mtimeMs: info.mtimeMs, ...meta });
          title = meta.title ?? title;
          author = meta.author ?? author;
          cover = meta.coverPath !== undefined;
        } catch {
          this.metaCache.set(file, { mtimeMs: info.mtimeMs });
        }
      }
    }

    return {
      path: file,
      name: path.basename(file),
      title,
      author,
      format,
      size: info.size,
      mtimeMs: info.mtimeMs,
      enriched: format === '.epub',
      hasCover: cover,
    };
  }

  /** 返回封面字节与扩展名；没有封面时返回 null。 */
  async coverFor(file: string): Promise<{ data: Buffer; ext: string } | null> {
    let info;
    try {
      info = await stat(file);
    } catch {
      return null;
    }
    const key = createHash('sha1').update(file).digest('hex');
    for (const ext of ['jpg', 'jpeg', 'png', 'gif', 'webp']) {
      const cached = path.join(this.coverDir, `${key}.${ext}`);
      if (await exists(cached)) {
        return { data: await readFile(cached), ext };
      }
    }

    let meta = this.metaCache.get(file);
    if (meta === undefined || meta.mtimeMs !== info.mtimeMs) {
      if (path.extname(file).toLowerCase() !== '.epub') return null;
      try {
        const buffer = await readFile(file);
        const parsed = parseEpubMeta(buffer);
        meta = { mtimeMs: info.mtimeMs, ...parsed };
        this.metaCache.set(file, meta);
      } catch {
        return null;
      }
    }
    if (meta.coverPath === undefined) return null;
    try {
      const buffer = await readFile(file);
      const data = extractEpubCover(buffer, meta.coverPath);
      if (data === undefined) return null;
      await mkdir(this.coverDir, { recursive: true });
      const realExt = coverExtension(meta.coverPath);
      const target = path.join(this.coverDir, `${key}.${realExt}`);
      await writeFile(target, data);
      return { data: Buffer.from(data), ext: realExt };
    } catch {
      return null;
    }
  }

  /** 用 ebook-meta 为单个非 EPUB 文件补充元数据；失败时保持原值。 */
  async enrichWithCalibre(file: string): Promise<{ title?: string; author?: string }> {
    const settings = this.settings();
    const args = [file];
    try {
      const result = await runCalibre(settings, CALIBRE_BINARIES.meta, args, { timeoutMs: 20_000 });
      const map = parseEbookMeta(result.stdout);
      const info = await stat(file);
      this.metaCache.set(file, { mtimeMs: info.mtimeMs, title: map.title, author: map.author });
      return map;
    } catch {
      return {};
    }
  }

  /** 解析 calibre 的 ebook-convert 路径（供路由探测用）。 */
  calibreConvertPath(): string {
    return binaryPath(this.settings(), CALIBRE_BINARIES.convert);
  }

  /** 只允许书库目录与转换输出目录内的路径（封面接口用它兜任意文件读取）。 */
  isAllowed(file: string): boolean {
    const resolved = path.resolve(expandHome(file));
    return this.roots().some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
  }

  /** 扫描根：书库目录 + 转换输出目录（去重）。 */
  private roots(): string[] {
    const settings = this.settings();
    const dirs = [...settings.libraryDirs];
    if (settings.outputDir.trim() !== '') dirs.push(settings.outputDir.trim());
    return Array.from(new Set(dirs.map((dir) => path.resolve(expandHome(dir)))));
  }
}

export function expandHome(value: string): string {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

/** 解析 `ebook-meta` 的 `Key : Value` 文本输出。 */
export function parseEbookMeta(text: string): { title?: string; author?: string } {
  const out: { title?: string; author?: string } = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z ()]+?)\s*:\s*(.*)$/);
    if (match === null) continue;
    const key = match[1]?.trim().toLowerCase();
    const value = match[2]?.trim();
    if (key === undefined || value === undefined || value === '') continue;
    if (key === 'title') out.title = value;
    if (key === 'author(s)' || key === 'author') out.author = value;
  }
  return out;
}

async function walk(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth > MAX_SCAN_DEPTH) return;
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    let info;
    try {
      info = await stat(full);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      await walk(full, depth + 1, out);
    } else if (info.isFile()) {
      if (LIBRARY_EXTS.has(path.extname(name).toLowerCase())) out.push(full);
    }
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}



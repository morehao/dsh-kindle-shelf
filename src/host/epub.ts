/**
 * EPUB 轻量解析：只取标题 / 作者 / 封面，不引 XML 库。
 *
 * 用 fflate 按需解压（只解 container.xml → OPF → 封面图），比启动 calibre
 * 的 ebook-meta 快一个数量级；非 EPUB 的元数据仍交给 calibre 兜底。
 */
import { unzipSync } from 'fflate';

export interface EpubMeta {
  title?: string;
  author?: string;
  /** OPF 内的封面资源路径。 */
  coverPath?: string;
  /** EPUB 内所有资源的路径（相对 zip 根）。 */
  resources?: string[];
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[body.toLowerCase()] ?? match;
  });
}

function stripTags(text: string): string {
  return decodeEntities(text.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function pick(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<dc:${tag}\\b[^>]*>([\\s\\S]*?)</dc:${tag}>`, 'i'));
  if (match?.[1] === undefined) return undefined;
  const value = stripTags(match[1]);
  return value === '' ? undefined : value;
}

function unzipSome(buffer: Uint8Array, keep: (name: string) => boolean): Record<string, Uint8Array> {
  try {
    return unzipSync(buffer, { filter: (file) => keep(file.name) });
  } catch {
    return {};
  }
}

function textOf(bytes: Uint8Array | undefined): string | undefined {
  if (bytes === undefined) return undefined;
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    return undefined;
  }
}

/** 解析 EPUB 元数据；失败返回空对象，绝不抛（坏书不应拖垮整次扫描）。 */
export function parseEpubMeta(buffer: Uint8Array): EpubMeta {
  const containerBytes = unzipSome(buffer, (name) => name === 'META-INF/container.xml')['META-INF/container.xml'];
  const container = textOf(containerBytes);
  if (container === undefined) return {};
  const rootfile = container.match(/full-path\s*=\s*["']([^"']+)["']/i)?.[1];
  if (rootfile === undefined) return {};

  const opfBytes = unzipSome(buffer, (name) => name === rootfile)[rootfile];
  const opf = textOf(opfBytes);
  if (opf === undefined) return {};

  const title = pick(opf, 'title');
  const author = pick(opf, 'creator');

  // 封面：优先 EPUB2 的 <meta name="cover" content="id">，其次 EPUB3 的 properties="cover-image"。
  const base = rootfile.includes('/') ? rootfile.slice(0, rootfile.lastIndexOf('/') + 1) : '';
  let coverHref: string | undefined;
  const metaCoverId = opf.match(/<meta\b[^>]*name\s*=\s*["']cover["'][^>]*content\s*=\s*["']([^"']+)["']/i)?.[1];
  if (metaCoverId !== undefined) {
    const escaped = metaCoverId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    coverHref = opf.match(new RegExp(`<item\\b[^>]*id\\s*=\\s*["']${escaped}["'][^>]*>`, 'i'))?.[0]
      ?.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
  }
  if (coverHref === undefined) {
    const guide = opf.match(/<reference\b[^>]*type\s*=\s*["']cover["'][^>]*href\s*=\s*["']([^"']+)["']/i)?.[1];
    coverHref = guide;
  }
  if (coverHref === undefined) {
    // properties="cover-image" 的 item
    const items = opf.match(/<item\b[^>]*>/gi) ?? [];
    for (const item of items) {
      if (/properties\s*=\s*["'][^"']*cover-image/i.test(item)) {
        coverHref = item.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
        break;
      }
    }
  }
  if (coverHref === undefined) {
    // 兜底：manifest 里第一张常见图片
    const items = opf.match(/<item\b[^>]*>/gi) ?? [];
    for (const item of items) {
      const type = item.match(/media-type\s*=\s*["']([^"']+)["']/i)?.[1] ?? '';
      if (/^image\/(jpe?g|png|gif|webp)$/i.test(type)) {
        coverHref = item.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
        break;
      }
    }
  }

  const coverPath = coverHref === undefined ? undefined : normalizePath(base + coverHref);
  return {
    ...(title === undefined ? {} : { title }),
    ...(author === undefined ? {} : { author }),
    ...(coverPath === undefined ? {} : { coverPath }),
  };
}

/** 取 EPUB 内封面图片的原始字节。 */
export function extractEpubCover(buffer: Uint8Array, coverPath: string): Uint8Array | undefined {
  return unzipSome(buffer, (name) => name === coverPath)[coverPath];
}

export function coverExtension(coverPath: string): string {
  const match = coverPath.toLowerCase().match(/\.(jpe?g|png|gif|webp)$/);
  return match?.[1] ?? 'jpg';
}

/** 把 `../` 与反斜杠归一化成 zip 内相对路径。 */
export function normalizePath(path: string): string {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

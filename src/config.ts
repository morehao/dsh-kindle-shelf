/**
 * 插件设置：书库目录、转换输出、calibre 路径、推送服务、可选 SFTP。
 *
 * 所有字段都可缺省，`normalizeSettings` 负责补默认值并做边界校验。
 * SFTP 的密码/私钥路径属于敏感值：落盘 0600，HTTP 面只回「是否已配置」。
 */

export interface Settings {
  /** 本机书库目录（可多个，递归扫描）。 */
  libraryDirs: string[];
  /** 转换产物输出目录。 */
  outputDir: string;
  /** calibre 可执行文件所在目录（含 ebook-convert / ebook-meta）。 */
  calibreDir: string;
  /** 默认转换目标格式。 */
  defaultFormat: 'azw3' | 'mobi';
  push: {
    port: number;
    bind: string;
  };
  kindle: {
    host: string;
    port: number;
    user: string;
    /** Kindle 上书库目录。 */
    documentsPath: string;
    password?: string;
    keyPath?: string;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  libraryDirs: [],
  outputDir: '~/Documents/Books/kindle',
  calibreDir: '/Applications/calibre.app/Contents/MacOS',
  defaultFormat: 'mobi',
  push: { port: 8180, bind: '0.0.0.0' },
  kindle: {
    host: '',
    port: 22,
    user: 'root',
    documentsPath: '/mnt/us/documents',
  },
};

/** Kindle 阅读器可识别的扩展名（推送页按此筛选）。 */
export const KINDLE_EXTS = new Set(['.azw3', '.azw', '.mobi', '.prc', '.epub', '.pdf', '.txt']);

/** 本机书库扫描的扩展名。 */
export const LIBRARY_EXTS = new Set(['.epub', '.pdf', '.mobi', '.azw', '.azw3', '.prc', '.txt', '.fb2', '.docx', '.rtf', '.lit']);

const FORMATS = new Set(['azw3', 'mobi']);

function str(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function boolString(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim());
}

export function normalizeSettings(raw: unknown): Settings {
  const input = (raw ?? {}) as Partial<Settings>;
  const push = (input.push ?? {}) as Partial<Settings['push']>;
  const kindle = (input.kindle ?? {}) as Partial<Settings['kindle']>;
  const format = str(input.defaultFormat, DEFAULT_SETTINGS.defaultFormat);
  return {
    libraryDirs: boolString(input.libraryDirs),
    outputDir: str(input.outputDir, DEFAULT_SETTINGS.outputDir),
    calibreDir: str(input.calibreDir, DEFAULT_SETTINGS.calibreDir) || DEFAULT_SETTINGS.calibreDir,
    defaultFormat: (FORMATS.has(format) ? format : DEFAULT_SETTINGS.defaultFormat) as 'azw3' | 'mobi',
    push: {
      port: num(push.port, DEFAULT_SETTINGS.push.port, 1024, 65535),
      bind: str(push.bind, DEFAULT_SETTINGS.push.bind) || DEFAULT_SETTINGS.push.bind,
    },
    kindle: {
      host: str(kindle.host, '').trim(),
      port: num(kindle.port, DEFAULT_SETTINGS.kindle.port, 1, 65535),
      user: str(kindle.user, DEFAULT_SETTINGS.kindle.user) || DEFAULT_SETTINGS.kindle.user,
      documentsPath: str(kindle.documentsPath, DEFAULT_SETTINGS.kindle.documentsPath) || DEFAULT_SETTINGS.kindle.documentsPath,
      ...(typeof kindle.password === 'string' && kindle.password !== '' ? { password: kindle.password } : {}),
      ...(typeof kindle.keyPath === 'string' && kindle.keyPath !== '' ? { keyPath: kindle.keyPath } : {}),
    },
  };
}

/** 对外展示时抹掉敏感值。 */
export function publicSettings(settings: Settings): Record<string, unknown> {
  const { password, keyPath, ...kindle } = settings.kindle;
  return {
    ...settings,
    kindle: {
      ...kindle,
      passwordConfigured: password !== undefined && password !== '',
      keyPathConfigured: keyPath !== undefined && keyPath !== '',
      keyPathHint: keyPath ?? '',
    },
  };
}

/** 合并一次部分更新：显式 `undefined` 表示「不改」，空字符串表示「清空」。 */
export function mergeSettings(current: Settings, patch: unknown): Settings {
  const input = (patch ?? {}) as Partial<Settings>;
  const next: Settings = {
    ...current,
    ...(input.libraryDirs !== undefined ? { libraryDirs: boolString(input.libraryDirs) } : {}),
    ...(input.outputDir !== undefined ? { outputDir: String(input.outputDir) } : {}),
    ...(input.calibreDir !== undefined ? { calibreDir: String(input.calibreDir) } : {}),
    ...(input.defaultFormat !== undefined ? { defaultFormat: input.defaultFormat } : {}),
    push: {
      ...current.push,
      ...(input.push?.port !== undefined ? { port: input.push.port } : {}),
      ...(input.push?.bind !== undefined ? { bind: input.push.bind } : {}),
    },
    kindle: {
      ...current.kindle,
      ...(input.kindle?.host !== undefined ? { host: String(input.kindle.host).trim() } : {}),
      ...(input.kindle?.port !== undefined ? { port: input.kindle.port } : {}),
      ...(input.kindle?.user !== undefined ? { user: String(input.kindle.user) } : {}),
      ...(input.kindle?.documentsPath !== undefined ? { documentsPath: String(input.kindle.documentsPath) } : {}),
      ...(input.kindle?.password !== undefined
        ? input.kindle.password === ''
          ? {}
          : { password: String(input.kindle.password) }
        : {}),
      ...(input.kindle?.keyPath !== undefined
        ? input.kindle.keyPath === ''
          ? {}
          : { keyPath: String(input.kindle.keyPath) }
        : {}),
    },
  };
  // 清空密码/私钥：patch 里显式空串要真的删掉。
  if (input.kindle?.password === '' && next.kindle.password !== undefined) delete next.kindle.password;
  if (input.kindle?.keyPath === '' && next.kindle.keyPath !== undefined) delete next.kindle.keyPath;
  return normalizeSettings(next);
}

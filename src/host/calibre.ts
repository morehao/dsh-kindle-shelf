/** calibre 可执行文件定位与调用。 */
import { existsSync } from 'node:fs';
import path from 'node:path';

import { sanitizedEnv, spawnCollect, type ExecResult } from '@morehao/dsh-plugin-kit/exec';

import type { Settings } from '../config.js';
import { err } from '../errors.js';

export const CALIBRE_BINARIES = {
  convert: 'ebook-convert',
  meta: 'ebook-meta',
} as const;

export type CalibreBinary = (typeof CALIBRE_BINARIES)[keyof typeof CALIBRE_BINARIES];

export function binaryPath(settings: Settings, binary: CalibreBinary): string {
  return path.join(settings.calibreDir, binary);
}

/** 探测 calibre 是否可用；返回问题描述，可用时返回 null。 */
export function probeCalibre(settings: Settings): string | null {
  const convert = binaryPath(settings, CALIBRE_BINARIES.convert);
  if (!existsSync(convert)) {
    return `找不到 ${convert}，请检查 calibre 安装路径`;
  }
  return null;
}

export interface CalibreOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  onLine?: (line: string) => void;
}

/** 运行一个 calibre 命令；失败时抛出带 stderr 尾部的错误。 */
export async function runCalibre(
  settings: Settings,
  binary: CalibreBinary,
  args: string[],
  options: CalibreOptions = {},
): Promise<ExecResult> {
  const command = binaryPath(settings, binary);
  if (!existsSync(command)) throw err('CALIBRE_MISSING', `找不到 ${command}，请检查 calibre 安装路径`);

  let tail = '';
  const result = await spawnCollect(command, args, {
    env: sanitizedEnv(process.env),
    timeoutMs: options.timeoutMs ?? 0,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    maxStdout: 64 * 1024,
    maxStderr: 256 * 1024,
    onData: (chunk, channel) => {
      if (channel !== 'stderr') return;
      tail = (tail + chunk).slice(-8000);
      for (const line of chunk.split(/\r?\n/)) {
        if (line.trim() !== '') options.onLine?.(line.trim());
      }
    },
  });

  if (result.error !== undefined) {
    throw err('CALIBRE_FAILED', `${binary} 启动失败：${result.error.message}`);
  }
  if (result.code !== 0) {
    const detail = (result.stderr || tail).trim().split(/\r?\n/).slice(-20).join('\n');
    throw err('CALIBRE_FAILED', `${binary} 退出码 ${result.code}${detail === '' ? '' : `：\n${detail}`}`);
  }
  return result;
}

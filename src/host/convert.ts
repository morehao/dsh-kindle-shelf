/**
 * 转换队列：EPUB/PDF/MOBI → AZW3/MOBI，串行执行，解析 calibre 的百分比进度。
 *
 * 任务只留内存（插件常驻），不做跨进程恢复：转换是短任务，重启后重新提交即可。
 */
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { Settings } from '../config.js';
import { err } from '../errors.js';
import type { ConvertJob } from '../types.js';
import { binaryPath, CALIBRE_BINARIES, runCalibre } from './calibre.js';

const CONVERTIBLE = new Set(['.epub', '.pdf', '.mobi', '.azw', '.azw3', '.prc', '.txt', '.docx', '.rtf', '.fb2', '.lit', '.html', '.htm']);

let counter = 0;

function nextId(): string {
  counter += 1;
  return `job-${Date.now().toString(36)}-${counter}`;
}

function defaultOutputDir(): string {
  return path.join(os.homedir(), 'Documents', 'Books', 'kindle');
}

export class Converter {
  private settings: () => Settings;
  private jobs: ConvertJob[] = [];
  private queue: string[] = [];
  private active: { id: string; controller: AbortController } | undefined;
  private running = false;
  private onUpdate: (job: ConvertJob) => void;

  constructor(options: { settings: () => Settings; onUpdate?: (job: ConvertJob) => void }) {
    this.settings = options.settings;
    this.onUpdate = options.onUpdate ?? (() => {});
  }

  list(): ConvertJob[] {
    return [...this.jobs].reverse();
  }

  find(id: string): ConvertJob | undefined {
    return this.jobs.find((job) => job.id === id);
  }

  /** 提交一批文件；返回新建的任务。路径必须存在且格式可转。 */
  submit(paths: string[], format: 'azw3' | 'mobi'): ConvertJob[] {
    const created: ConvertJob[] = [];
    for (const input of paths) {
      const ext = path.extname(input).toLowerCase();
      if (!CONVERTIBLE.has(ext)) throw err('UNSUPPORTED_FORMAT', `不支持转换的格式：${path.basename(input)}`);
      if (!existsSync(input)) throw err('NOT_FOUND', `文件不存在：${input}`);

      const output = this.outputPath(input, format);
      const job: ConvertJob = {
        id: nextId(),
        input,
        output,
        format,
        status: 'queued',
        progress: 0,
        message: '排队中',
      };
      this.jobs.push(job);
      this.queue.push(job.id);
      created.push(job);
    }
    void this.pump();
    return created;
  }

  cancel(id: string): boolean {
    const job = this.find(id);
    if (job === undefined) return false;
    if (job.status === 'queued') {
      this.queue = this.queue.filter((item) => item !== id);
      job.status = 'cancelled';
      job.message = '已取消';
      job.finishedAt = Date.now();
      this.onUpdate(job);
      return true;
    }
    if (this.active?.id === id) {
      this.active.controller.abort();
      return true;
    }
    return false;
  }

  private outputPath(input: string, format: 'azw3' | 'mobi'): string {
    const settings = this.settings();
    const outDir = settings.outputDir.trim() === '' ? defaultOutputDir() : path.resolve(expandHome(settings.outputDir));
    const stem = path.basename(input, path.extname(input));
    let target = path.join(outDir, `${stem}.${format}`);
    let n = 2;
    while (existsSync(target)) {
      target = path.join(outDir, `${stem} (${n}).${format}`);
      n += 1;
    }
    return target;
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const id = this.queue.shift();
        if (id === undefined) break;
        const job = this.find(id);
        if (job === undefined || job.status !== 'queued') continue;
        await this.runJob(job);
      }
    } finally {
      this.running = false;
    }
  }

  private async runJob(job: ConvertJob): Promise<void> {
    const settings = this.settings();
    const controller = new AbortController();
    this.active = { id: job.id, controller };
    job.status = 'running';
    job.startedAt = Date.now();
    job.message = '转换中';
    job.progress = 0;
    this.onUpdate(job);

    try {
      await mkdir(path.dirname(job.output), { recursive: true });
      const args = [job.input, job.output, '--output-profile', 'kindle_pw3'];
      if (job.format === 'mobi') args.push('--mobi-file-type', 'new');
      const result = await runCalibre(settings, CALIBRE_BINARIES.convert, args, {
        signal: controller.signal,
        onLine: (line) => {
          const match = line.match(/(\d{1,3})\s*%/);
          if (match?.[1] !== undefined) {
            const progress = Math.min(99, Number.parseInt(match[1], 10));
            if (progress > job.progress) {
              job.progress = progress;
              job.message = `转换中 ${progress}%`;
              this.onUpdate(job);
            }
          } else if (line.startsWith('Transforming')) {
            job.message = '排版中';
            this.onUpdate(job);
          }
        },
      });
      void result;
      if (!existsSync(job.output)) throw err('CONVERT_FAILED', '转换结束但没有生成文件');
      job.status = 'done';
      job.progress = 100;
      job.message = '完成';
      job.finishedAt = Date.now();
    } catch (error) {
      if (controller.signal.aborted) {
        job.status = 'cancelled';
        job.message = '已取消';
      } else {
        job.status = 'failed';
        job.message = '转换失败';
        job.error = error instanceof Error ? error.message : String(error);
      }
      job.finishedAt = Date.now();
    } finally {
      this.active = undefined;
      this.onUpdate(job);
    }
  }
}

export function expandHome(value: string): string {
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

/** 供路由做「转换器是否可用」判断。 */
export function probeConverter(settings: Settings): string | null {
  const bin = binaryPath(settings, CALIBRE_BINARIES.convert);
  return existsSync(bin) ? null : `找不到 ${bin}`;
}

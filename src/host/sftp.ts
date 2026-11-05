/**
 * 可选后端：通过 SSH/SFTP 管理越狱 Kindle 的 /mnt/us/documents。
 *
 * 未越狱设备不暴露 SSH，这里的所有操作都会以「未配置/连不上」收场——UI 必须
 * 把这条路径当成可选能力，而不是默认路径。
 *
 * Kindle 的 dropbear 很老，只支持 group1/group14-sha1、aes-cbc 一类算法，
 * 所以显式放宽 ssh2 的算法列表。
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import { Client, type SFTPWrapper } from 'ssh2';

import type { Settings } from '../config.js';
import { err } from '../errors.js';
import type { KindleFile, KindleStatus } from '../types.js';

const ALGORITHMS = {
  kex: [
    'curve25519-sha256',
    'ecdh-sha2-nistp256',
    'diffie-hellman-group14-sha256',
    'diffie-hellman-group14-sha1',
    'diffie-hellman-group1-sha1',
  ],
  cipher: [
    'aes128-gcm@openssh.com',
    'aes256-gcm@openssh.com',
    'aes128-ctr',
    'aes192-ctr',
    'aes256-ctr',
    'aes128-cbc',
    '3des-cbc',
  ],
  serverHostKey: ['ssh-ed25519', 'ecdsa-sha2-nistp256', 'rsa-sha2-256', 'rsa-sha2-512', 'ssh-rsa'],
  hmac: ['hmac-sha2-256', 'hmac-sha1'],
};

const CONNECT_TIMEOUT = 15_000;

interface Session {
  client: Client;
  sftp: SFTPWrapper;
}

function isConfigured(settings: Settings): boolean {
  return settings.kindle.host !== '';
}

export class KindleSftp {
  private settings: () => Settings;
  private session: Session | undefined;
  private lastError: string | undefined;

  constructor(options: { settings: () => Settings }) {
    this.settings = options.settings;
  }

  status(): KindleStatus {
    const kindle = this.settings().kindle;
    return {
      configured: isConfigured(this.settings()),
      connected: this.session !== undefined,
      host: kindle.host,
      port: kindle.port,
      documentsPath: kindle.documentsPath,
      ...(this.lastError === undefined ? {} : { error: this.lastError }),
    };
  }

  /** 建立连接（幂等）；返回可用的 SFTP 会话。 */
  async ensure(): Promise<Session> {
    if (this.session !== undefined) return this.session;
    const kindle = this.settings().kindle;
    if (!isConfigured(this.settings())) {
      throw err('KINDLE_NOT_CONFIGURED', '还没有配置 Kindle 的 SSH 地址');
    }

    const privateKey = kindle.keyPath === undefined ? undefined : await readFile(kindle.keyPath).catch(() => undefined);
    if (kindle.keyPath !== undefined && privateKey === undefined) {
      throw err('KINDLE_KEY_INVALID', `读不到私钥：${kindle.keyPath}`);
    }
    if (privateKey === undefined && kindle.password === undefined) {
      throw err('KINDLE_NO_CREDENTIAL', '需要密码或私钥；越狱后可在 KUAL 里查看 root 密码');
    }

    const client = new Client();
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(err('KINDLE_TIMEOUT', `连接 ${kindle.host}:${kindle.port} 超时`)), CONNECT_TIMEOUT);
        client.once('ready', () => {
          clearTimeout(timer);
          resolve();
        });
        client.once('error', (error) => {
          clearTimeout(timer);
          reject(err('KINDLE_CONNECT_FAILED', `连接失败：${error.message}`));
        });
        client.connect({
          host: kindle.host,
          port: kindle.port,
          username: kindle.user,
          ...(privateKey === undefined ? {} : { privateKey }),
          ...(kindle.password === undefined ? {} : { password: kindle.password }),
          readyTimeout: CONNECT_TIMEOUT,
          algorithms: ALGORITHMS as never,
        });
      });

      const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
        client.sftp((error, wrapper) => {
          if (error !== undefined) reject(err('KINDLE_SFTP_FAILED', `SFTP 不可用：${error.message}`));
          else resolve(wrapper);
        });
      });

      this.session = { client, sftp };
      this.lastError = undefined;
      client.once('close', () => {
        this.session = undefined;
      });
      client.once('error', (error) => {
        this.lastError = error.message;
        this.session = undefined;
      });
      return this.session;
    } catch (error) {
      client.end();
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    const session = this.session;
    this.session = undefined;
    if (session !== undefined) session.client.end();
  }

  /** 列出 Kindle 书库目录下的文件（目录也返回，供 UI 区分）。 */
  async list(): Promise<KindleFile[]> {
    const session = await this.ensure();
    const kindle = this.settings().kindle;
    const entries = await new Promise<Array<{ filename: string; attrs: { size: number; isDirectory: () => boolean } }>>(
      (resolve, reject) => {
        session.sftp.readdir(kindle.documentsPath, (error, list) => {
          if (error !== undefined) reject(err('KINDLE_LIST_FAILED', `读取 ${kindle.documentsPath} 失败：${error.message}`));
          else resolve(list as never);
        });
      },
    );
    return entries
      .map((entry) => ({
        name: entry.filename,
        size: entry.attrs.size,
        isDir: entry.attrs.isDirectory(),
      }))
      .filter((entry) => !entry.name.startsWith('.'))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  }

  /** 上传一批本地文件到 Kindle 书库目录；返回成功/失败明细。 */
  async upload(paths: string[]): Promise<{ uploaded: string[]; failed: Array<{ path: string; error: string }> }> {
    const session = await this.ensure();
    const kindle = this.settings().kindle;
    const uploaded: string[] = [];
    const failed: Array<{ path: string; error: string }> = [];
    for (const file of paths) {
      const info = await stat(file).catch(() => undefined);
      if (info === undefined || !info.isFile()) {
        failed.push({ path: file, error: '文件不存在' });
        continue;
      }
      const remote = `${kindle.documentsPath.replace(/\/+$/u, '')}/${path.basename(file)}`;
      try {
        await new Promise<void>((resolve, reject) => {
          session.sftp.fastPut(file, remote, (error) => {
            if (error) reject(err('KINDLE_UPLOAD_FAILED', error.message));
            else resolve();
          });
        });
        uploaded.push(path.basename(file));
      } catch (error) {
        failed.push({ path: file, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { uploaded, failed };
  }

  /** 删除 Kindle 上的文件（只允许书库目录下的直接子项）。 */
  async remove(names: string[]): Promise<{ removed: string[]; failed: Array<{ name: string; error: string }> }> {
    const session = await this.ensure();
    const kindle = this.settings().kindle;
    const removed: string[] = [];
    const failed: Array<{ name: string; error: string }> = [];
    for (const name of names) {
      if (name === '' || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
        failed.push({ name, error: '非法文件名' });
        continue;
      }
      const remote = `${kindle.documentsPath.replace(/\/+$/u, '')}/${name}`;
      try {
        const attrs = await new Promise<{ isDirectory: () => boolean }>((resolve, reject) => {
          session.sftp.stat(remote, (error, value) => {
            if (error !== undefined) reject(err('KINDLE_NOT_FOUND', error.message));
            else resolve(value as never);
          });
        });
        await new Promise<void>((resolve, reject) => {
          const done = (error?: Error | null): void => (error ? reject(err('KINDLE_DELETE_FAILED', error.message)) : resolve());
          if (attrs.isDirectory()) session.sftp.rmdir(remote, done);
          else session.sftp.unlink(remote, done);
        });
        removed.push(name);
      } catch (error) {
        failed.push({ name, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { removed, failed };
  }

  /** 把 Kindle 上的文件取回本机目录。 */
  async download(names: string[], targetDir: string): Promise<{ downloaded: string[]; failed: Array<{ name: string; error: string }> }> {
    const session = await this.ensure();
    const kindle = this.settings().kindle;
    const downloaded: string[] = [];
    const failed: Array<{ name: string; error: string }> = [];
    for (const name of names) {
      if (name === '' || name.includes('/') || name.includes('\\')) {
        failed.push({ name, error: '非法文件名' });
        continue;
      }
      const remote = `${kindle.documentsPath.replace(/\/+$/u, '')}/${name}`;
      const local = path.join(targetDir, name);
      try {
        await new Promise<void>((resolve, reject) => {
          session.sftp.fastGet(remote, local, (error) => {
            if (error) reject(err('KINDLE_DOWNLOAD_FAILED', error.message));
            else resolve();
          });
        });
        downloaded.push(local);
      } catch (error) {
        failed.push({ name, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return { downloaded, failed };
  }
}

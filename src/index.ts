/**
 * 插件入口（Host half）。
 *
 * 装配顺序：状态目录 → 书库/转换器/推送服务/SFTP → HTTP 路由。
 * `webServer` 是硬依赖；其余能力（calibre、Kindle SSH）都是运行时探测，
 * 缺了只会让对应功能不可用，不会阻塞插件加载。
 */
import { Library } from './host/library.js';
import { Converter } from './host/convert.js';
import { PushServer } from './host/push.js';
import { createRoutes, ROUTE_PREFIX } from './host/routes.js';
import { KindleSftp } from './host/sftp.js';
import { Store } from './state.js';

export const name = 'dsh-kindle';

/** 唯一硬依赖：没有 HTTP 载体就没有工作台。 */
export const inject = ['webServer'];

export interface PluginLogger {
  info?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
  debug?: (message: string) => void;
}

export interface PluginContext {
  get?: (name: string) => unknown;
  effect?: (factory: (() => unknown) | ((...args: unknown[]) => unknown), label?: string) => unknown;
  logger?: PluginLogger;
  webServer?: {
    register: (options: { kind: 'prefix'; path: string; handler: unknown }) => unknown;
  };
  [key: string]: unknown;
}

export interface PluginConfig {
  /** 覆盖状态目录（测试用）。 */
  stateDir?: string;
}

export function apply(ctx: PluginContext, config: PluginConfig = {}): void {
  const log = (event: string, data?: Record<string, unknown>): void => {
    ctx.logger?.info?.(`[dsh-kindle] ${event}${data === undefined ? '' : ` ${JSON.stringify(data)}`}`);
  };

  const store = new Store({
    env: process.env,
    ...(config.stateDir === undefined ? {} : { dir: config.stateDir }),
  });
  const settings = (): ReturnType<Store['readSettings']> => store.readSettings();

  const library = new Library({ settings, coverDir: store.coversDir });
  const converter = new Converter({
    settings,
    onUpdate: (job) => log('convert.update', { id: job.id, status: job.status, progress: job.progress }),
  });

  const push = new PushServer({
    initialQueue: store.readState().queue,
    onQueueChanged: (queue) => {
      try {
        store.writeState({ queue });
      } catch (error) {
        log('push.persist.failed', { message: error instanceof Error ? error.message : String(error) });
      }
    },
    port: settings().push.port,
    bind: settings().push.bind,
    logger: log,
  });

  const sftp = new KindleSftp({ settings });
  const handler = createRoutes({ store, library, converter, push, sftp, logger: log });

  const webServer = ctx.webServer;
  if (webServer === undefined) {
    ctx.logger?.warn?.('[dsh-kindle] webServer 未注册，工作台不可用');
    return;
  }
  webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler });

  // 推送服务默认随插件启动；端口被占时降级为「未启动」，UI 里可重试。
  void push.start().catch((error: unknown) => {
    log('push.start.failed', { message: error instanceof Error ? error.message : String(error) });
  });

  if (typeof ctx.effect === 'function') {
    ctx.effect(
      () => () => {
        void push.stop();
        void sftp.disconnect();
      },
      'dsh-kindle:host',
    );
  }
}

/** 状态目录与持久化：settings.json / state.json 都在 $DSH_HOME/kindle 下。 */
import path from 'node:path';

import { createJsonStore, resolveDshHome, type JsonStore } from '@morehao/dsh-plugin-kit/state';

import { DEFAULT_SETTINGS, normalizeSettings, type Settings } from './config.js';
import type { QueueItem } from './types.js';

export interface PersistedState {
  queue: QueueItem[];
}

const EMPTY_STATE: () => PersistedState = () => ({ queue: [] });

export class Store {
  readonly dir: string;
  private settingsStore: JsonStore<Settings>;
  private stateStore: JsonStore<PersistedState>;

  constructor(options: { env?: NodeJS.ProcessEnv; dir?: string } = {}) {
    const home = resolveDshHome(options.env ?? process.env);
    this.dir = options.dir ?? path.join(home, 'kindle');
    this.settingsStore = createJsonStore<Settings>({
      dir: this.dir,
      file: 'settings.json',
      fallback: () => ({ ...DEFAULT_SETTINGS }),
    });
    this.stateStore = createJsonStore<PersistedState>({
      dir: this.dir,
      file: 'state.json',
      fallback: EMPTY_STATE,
    });
  }

  /** 读设置：坏文件/缺失回默认值，并补齐默认项。 */
  readSettings(): Settings {
    return normalizeSettings(this.settingsStore.read());
  }

  writeSettings(settings: Settings): void {
    this.settingsStore.write(normalizeSettings(settings));
  }

  readState(): PersistedState {
    const state = this.stateStore.read();
    return { queue: Array.isArray(state.queue) ? state.queue.filter(isQueueItem) : [] };
  }

  writeState(state: PersistedState): void {
    this.stateStore.write({ queue: state.queue });
  }

  get settingsPath(): string {
    return this.settingsStore.path;
  }

  get statePath(): string {
    return this.stateStore.path;
  }

  get coversDir(): string {
    return path.join(this.dir, 'covers');
  }
}

function isQueueItem(value: unknown): value is QueueItem {
  if (value === null || typeof value !== 'object') return false;
  const item = value as Partial<QueueItem>;
  return (
    typeof item.id === 'string' &&
    typeof item.path === 'string' &&
    typeof item.slug === 'string' &&
    typeof item.title === 'string' &&
    typeof item.size === 'number' &&
    typeof item.addedAt === 'number'
  );
}

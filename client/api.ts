/** 客户端数据入口：统一前缀、CSRF 头、错误码透出。 */
export const API = '/api/morehao/kindle-shelf';
export const HEADER = 'x-dsh-kindle-shelf';

export interface ApiFailure extends Error {
  code?: string;
}

export async function apiCall<T = Record<string, any>>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', [HEADER]: '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  let json: Record<string, any> = {};
  try {
    json = (await response.json()) as Record<string, any>;
  } catch {
    json = {};
  }
  if (!response.ok || json.ok === false) {
    const error = new Error(typeof json.message === 'string' ? json.message : `HTTP ${response.status}`) as ApiFailure;
    error.code = typeof json.code === 'string' ? json.code : undefined;
    throw error;
  }
  return json as T;
}

export function coverUrl(path: string): string {
  return `${API}/cover?path=${encodeURIComponent(path)}`;
}

export interface Book {
  path: string;
  name: string;
  title: string;
  author: string;
  format: string;
  size: number;
  mtimeMs: number;
  enriched: boolean;
  hasCover: boolean;
}

export interface Job {
  id: string;
  input: string;
  output: string;
  format: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  progress: number;
  message: string;
  error?: string;
}

export interface QueueItem {
  id: string;
  path: string;
  slug: string;
  title: string;
  size: number;
  addedAt: number;
  downloadedAt?: number;
}

export interface PushStatus {
  running: boolean;
  port: number;
  bind: string;
  urls: string[];
  queueCount: number;
  error?: string;
}

export interface KindleStatus {
  configured: boolean;
  connected: boolean;
  host: string;
  port: number;
  documentsPath: string;
  error?: string;
}

export interface SettingsView {
  libraryDirs: string[];
  outputDir: string;
  calibreDir: string;
  defaultFormat: 'azw3' | 'mobi';
  push: { port: number; bind: string };
  kindle: {
    host: string;
    port: number;
    user: string;
    documentsPath: string;
    passwordConfigured: boolean;
    keyPathConfigured: boolean;
    keyPathHint: string;
  };
}

export interface StatePayload {
  settings: SettingsView;
  library: Book[];
  jobs: Job[];
  queue: QueueItem[];
  push: PushStatus;
  kindle: KindleStatus;
  calibre: string | null;
}

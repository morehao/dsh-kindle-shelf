/** 插件内部共享类型。 */

export interface BookEntry {
  /** 绝对路径。 */
  path: string;
  /** 文件名（含扩展名）。 */
  name: string;
  /** 展示标题：优先元数据，缺省用文件名去扩展名。 */
  title: string;
  /** 作者，缺省空串。 */
  author: string;
  /** 小写扩展名，含点。 */
  format: string;
  size: number;
  mtimeMs: number;
  /** 元数据是否已补充（来自 ebook-meta）。 */
  enriched: boolean;
  hasCover: boolean;
}

export interface ConvertJob {
  id: string;
  input: string;
  output: string;
  format: 'azw3' | 'mobi';
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  progress: number;
  message: string;
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface QueueItem {
  id: string;
  path: string;
  /** 对外下载名（ASCII slug，扩展名已按 Kindle 白名单调整）。 */
  slug: string;
  title: string;
  size: number;
  addedAt: number;
  downloadedAt?: number;
}

export interface KindleFile {
  name: string;
  size: number;
  isDir: boolean;
}

export interface KindleStatus {
  configured: boolean;
  connected: boolean;
  host: string;
  port: number;
  documentsPath: string;
  error?: string;
}

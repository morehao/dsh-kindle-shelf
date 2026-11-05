/** 测试与内省用的额外导出（不进主入口，避免把内部实现锁进公共 API）。 */
export { normalizeSettings, mergeSettings, publicSettings, DEFAULT_SETTINGS } from './config.js';
export { parseEbookMeta } from './host/library.js';
export { parseEpubMeta, extractEpubCover, normalizePath } from './host/epub.js';
export { Store } from './state.js';

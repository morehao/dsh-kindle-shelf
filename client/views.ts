/** 工作台四个视图：书库 / 传送 / Kindle / 设置。 */
import { useEffect, useState } from 'react';

import { apiCall, coverUrl, type Book, type KindleStatus, type SettingsView, type StatePayload } from './api.js';
import { Alert, Btn, Card, Empty, Input, Pill, Row, Select, TextArea, copyText, h, humanSize, shortTime } from './ui.js';

export interface ViewProps {
  state: StatePayload;
  busy: boolean;
  run: (fn: () => Promise<void>) => Promise<void>;
  refresh: () => Promise<void>;
  notify: (kind: 'ok' | 'err' | 'warn', text: string) => void;
}

const KINDLE_EXT = /\.(azw3?|mobi|prc|epub|pdf|txt)$/i;

function formatBytes(bytes: number): string {
  return humanSize(bytes);
}

// ── 书库 ────────────────────────────────────────────────────────────────

export function LibraryView(props: ViewProps): any {
  const { state, busy, run, refresh, notify } = props;
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [formatFilter, setFormatFilter] = useState('all');

  const formats = Array.from(new Set(state.library.map((book) => book.format))).sort();
  const books = state.library.filter((book) => {
    if (formatFilter !== 'all' && book.format !== formatFilter) return false;
    if (query.trim() === '') return true;
    const needle = query.trim().toLowerCase();
    return book.title.toLowerCase().includes(needle) || book.author.toLowerCase().includes(needle) || book.name.toLowerCase().includes(needle);
  });

  const toggle = (path: string): void => {
    setSelected((current) => (current.includes(path) ? current.filter((item) => item !== path) : [...current, path]));
  };

  const convert = (format: 'azw3' | 'mobi'): void => {
    const paths = selected.filter((path) => /\.(epub|pdf|mobi|azw3?|prc|txt|docx|rtf|fb2|lit)$/i.test(path));
    if (paths.length === 0) {
      notify('warn', '选中的书里没有可转换的格式（EPUB/PDF/MOBI/TXT 等）');
      return;
    }
    void run(async () => {
      const result = await apiCall<{ jobs: Array<{ id: string }> }>('POST', '/convert', { paths, format });
      notify('ok', `已加入 ${result.jobs.length} 个转换任务`);
      setSelected([]);
    });
  };

  const queue = (): void => {
    if (selected.length === 0) return;
    const unsupported = selected.filter((path) => !KINDLE_EXT.test(path));
    if (unsupported.length > 0) {
      notify('err', `以下格式 Kindle 不支持，先转换：${unsupported.map((item) => item.split('/').pop()).join('、')}`);
      return;
    }
    void run(async () => {
      await apiCall('POST', '/queue', { paths: selected });
      notify('ok', `已加入推送队列 ${selected.length} 本`);
      setSelected([]);
    });
  };

  const running = state.jobs.filter((job) => job.status === 'running' || job.status === 'queued');

  return h(
    'div',
    { className: 'dshk-body' },
    h(
      'div',
      { className: 'dshk-toolbar' },
      h(Input, { value: query, onInput: setQuery, placeholder: '搜索书名 / 作者 / 文件名' }),
      h(Select, {
        value: formatFilter,
        onChange: setFormatFilter,
        options: [{ value: 'all', label: '全部格式' }, ...formats.map((format) => ({ value: format, label: format.slice(1).toUpperCase() }))],
      }),
      h(Btn, { onClick: refresh, disabled: busy }, '刷新'),
      h('span', { className: 'dshk-hint' }, `共 ${books.length} 本`),
    ),
    state.settings.libraryDirs.length === 0
      ? h(Alert, { kind: 'warn' }, '还没有设置书库目录。到「设置」里填一个书籍目录（如 ~/Documents/Books），再回来刷新。')
      : null,
    books.length === 0
      ? h(Empty, null, state.settings.libraryDirs.length === 0 ? '先在设置里添加书库目录' : '这个目录下没有找到电子书')
      : h(
          'div',
          { className: 'dshk-grid' },
          books.map((book) => h(BookCard, { key: book.path, book, selected: selected.includes(book.path), onToggle: () => toggle(book.path) })),
        ),
    running.length > 0
      ? h(
          Card,
          { title: '转换任务', hint: `${running.length} 个进行中` },
          h(
            'div',
            { className: 'dshk-list' },
            running.map((job) => h(JobRow, { key: job.id, job, onCancel: () => void run(async () => { await apiCall('POST', '/jobs/cancel', { id: job.id }); }) })),
          ),
        )
      : null,
    selected.length > 0
      ? h(
          'div',
          { className: 'dshk-actions' },
          h('span', { className: 'dshk-hint' }, `已选 ${selected.length} 本`),
          h(Btn, { variant: 'primary', onClick: () => convert('mobi'), disabled: busy }, '转 MOBI'),
          h(Btn, { onClick: () => convert('azw3'), disabled: busy }, '转 AZW3'),
          h(Btn, { onClick: queue, disabled: busy }, '加入推送队列'),
          h(Btn, { variant: 'ghost', onClick: () => setSelected([]) }, '清空'),
        )
      : null,
  );
}

function BookCard(props: { book: Book; selected: boolean; onToggle: () => void }): any {
  const { book, selected, onToggle } = props;
  const [coverFailed, setCoverFailed] = useState(false);
  return h(
    'button',
    { type: 'button', className: 'dshk-book', 'data-selected': selected ? 'true' : 'false', onClick: onToggle, title: book.path },
    h(
      'div',
      { className: 'dshk-cover' },
      book.hasCover && !coverFailed
        ? h('img', { src: coverUrl(book.path), alt: '', loading: 'lazy', onError: () => setCoverFailed(true) })
        : h('span', null, book.format.slice(1).toUpperCase()),
    ),
    h('div', { className: 'dshk-book-title' }, book.title),
    h(
      'div',
      { className: 'dshk-book-meta' },
      h('span', { className: 'dshk-tag' }, book.format.slice(1)),
      h('span', null, formatBytes(book.size)),
      book.author === '' ? null : h('span', null, book.author),
    ),
  );
}

function JobRow(props: { job: StatePayload['jobs'][number]; onCancel: () => void }): any {
  const { job, onCancel } = props;
  return h(
    'div',
    { className: 'dshk-item' },
    h(
      'div',
      { className: 'dshk-item-main' },
      h('div', { className: 'dshk-item-title' }, job.input.split('/').pop()),
      h('div', { className: 'dshk-item-sub' }, `${job.status === 'running' ? job.message : job.status}`),
      job.status === 'running' ? h('div', { className: 'dshk-progress' }, h('div', { className: 'dshk-progress-inner', style: { width: `${job.progress}%` } })) : null,
    ),
    job.error === undefined ? null : h('span', { className: 'dshk-hint' }, job.error.slice(0, 120)),
    job.status === 'queued' || job.status === 'running' ? h(Btn, { small: true, variant: 'ghost', onClick: onCancel }, '取消') : null,
  );
}

// ── 传送 ────────────────────────────────────────────────────────────────

export function TransferView(props: ViewProps): any {
  const { state, busy, run, notify } = props;
  const push = state.push;

  return h(
    'div',
    { className: 'dshk-body' },
    h(
      Card,
      {
        title: '局域网推送服务',
        extra: h(
          'span',
          { className: 'dshk-check' },
          h(Pill, { kind: push.running ? 'ok' : push.error === undefined ? 'idle' : 'err' }, push.running ? '运行中' : '未启动'),
        ),
      },
      h('div', { className: 'dshk-hint' }, 'Kindle 不监听端口，所以由这台 Mac 起一个只读页面，Kindle 用「体验版网页浏览器」打开下面的地址来下载。'),
      push.urls.length > 0
        ? h(
            'div',
            { className: 'dshk-url' },
            push.urls.map((url) => h('a', { key: url, href: url, target: '_blank', rel: 'noreferrer' }, url)),
            h(Btn, { small: true, onClick: () => void copyText(push.urls[0] ?? '').then((ok) => notify(ok ? 'ok' : 'warn', ok ? '地址已复制' : '复制失败，请手动选择地址')) }, '复制地址'),
          )
        : h('div', { className: 'dshk-hint' }, `端口 ${push.port}，启动后这里会显示局域网地址`),
      push.error === undefined ? null : h(Alert, { kind: 'err' }, push.error),
      h(
        'div',
        { className: 'dshk-toolbar' },
        push.running
          ? h(Btn, { onClick: () => void run(async () => { await apiCall('POST', '/push/stop'); notify('ok', '已停止推送服务'); }) }, '停止')
          : h(Btn, { variant: 'primary', onClick: () => void run(async () => { await apiCall('POST', '/push/start'); notify('ok', '已启动推送服务'); }) }, '启动'),
        h('span', { className: 'dshk-hint' }, `端口 ${push.port} · 队列 ${push.queueCount} 本`),
      ),
    ),
    h(
      Card,
      { title: '推送队列', hint: 'Kindle 浏览器上看到的顺序' },
      state.queue.length === 0
        ? h(Empty, null, '队列是空的。到「书库」里选几本书加入队列。')
        : h(
            'div',
            { className: 'dshk-list' },
            state.queue.map((item) =>
              h(
                'div',
                { key: item.id, className: 'dshk-item' },
                h(
                  'div',
                  { className: 'dshk-item-main' },
                  h('div', { className: 'dshk-item-title' }, item.title),
                  h('div', { className: 'dshk-item-sub' }, `${item.slug} · ${formatBytes(item.size)} · ${item.downloadedAt === undefined ? '待下载' : `已下载 ${shortTime(item.downloadedAt)}`}`),
                ),
                h(Btn, { small: true, variant: 'ghost', disabled: busy, onClick: () => void run(async () => { await apiCall('DELETE', `/queue/${item.id}`); }) }, '移除'),
              ),
            ),
          ),
    ),
  );
}

// ── Kindle ──────────────────────────────────────────────────────────────

interface KindlePayload {
  status: KindleStatus;
  books: Array<{ name: string; size: number; isDir: boolean }>;
}

export function KindleView(props: ViewProps): any {
  const { state, busy, run, notify } = props;
  const [host, setHost] = useState(state.settings.kindle.host);
  const [port, setPort] = useState(String(state.settings.kindle.port));
  const [user, setUser] = useState(state.settings.kindle.user);
  const [password, setPassword] = useState('');
  const [books, setBooks] = useState<KindlePayload['books']>([]);
  const [status, setStatus] = useState<KindleStatus>(state.kindle);
  const [selected, setSelected] = useState<string[]>([]);

  const load = async (): Promise<void> => {
    try {
      const payload = await apiCall<KindlePayload>('GET', '/kindle');
      setStatus(payload.status);
      setBooks(payload.books ?? []);
    } catch (error) {
      notify('err', error instanceof Error ? error.message : String(error));
    }
  };

  useEffect(() => {
    if (state.kindle.configured) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.kindle.host]);

  const connect = (): void => {
    void run(async () => {
      const payload = await apiCall<KindlePayload>('POST', '/kindle/connect', {
        kindle: { host: host.trim(), port: Number(port) || 22, user: user.trim() || 'root', ...(password === '' ? {} : { password }) },
      });
      setStatus(payload.status);
      notify('ok', '连接成功');
      setPassword('');
      await load();
    });
  };

  const upload = (): void => {
    if (selected.length === 0) return;
    void run(async () => {
      const result = await apiCall<{ uploaded: string[]; failed: Array<{ path: string; error: string }> }>('POST', '/kindle/upload', { paths: selected });
      notify(result.failed.length === 0 ? 'ok' : 'warn', `已上传 ${result.uploaded.length} 本${result.failed.length > 0 ? `，失败 ${result.failed.length} 本` : ''}`);
      setSelected([]);
      await load();
    });
  };

  return h(
    'div',
    { className: 'dshk-body' },
    h(Alert, { kind: 'warn' }, '「管理 Kindle 已有图书」需要 Kindle 越狱并开启 SSH（USBNetwork / KUAL）。未越狱设备请用「传送」页，只能单向推送。'),
    h(
      Card,
      { title: '连接 Kindle', extra: h(Pill, { kind: status.connected ? 'ok' : status.configured ? 'warn' : 'idle' }, status.connected ? '已连接' : status.configured ? '已配置未连接' : '未配置') },
      h(Row, { label: '地址' }, h(Input, { value: host, onInput: setHost, placeholder: '192.168.31.x' })),
      h(Row, { label: '端口' }, h(Input, { value: port, onInput: setPort, placeholder: '22' })),
      h(Row, { label: '用户名' }, h(Input, { value: user, onInput: setUser, placeholder: 'root' })),
      h(Row, { label: '密码' }, h(Input, { value: password, onInput: setPassword, password: true, placeholder: 'KUAL 里显示的 root 密码' })),
      h(Row, { label: '' }, h('div', { className: 'dshk-hint' }, '也支持在「设置」里填私钥路径；二选一即可。')),
      status.error === undefined ? null : h(Alert, { kind: 'err' }, status.error),
      h(
        'div',
        { className: 'dshk-toolbar' },
        h(Btn, { variant: 'primary', onClick: connect, disabled: busy || host.trim() === '' }, '连接并读取书库'),
        h(Btn, { onClick: () => void run(async () => { await load(); notify('ok', '已刷新'); }) , disabled: busy }, '刷新书单'),
        h(Btn, { variant: 'ghost', onClick: () => void run(async () => { await apiCall('POST', '/kindle/disconnect'); await load(); notify('ok', '已断开'); }) }, '断开'),
      ),
    ),
    status.configured
      ? h(
          Card,
          { title: 'Kindle 书库', hint: status.documentsPath },
          books.length === 0
            ? h(Empty, null, '没有读到文件，或设备未连接')
            : h(
                'div',
                { className: 'dshk-list' },
                books.map((file) =>
                  h(
                    'div',
                    { key: file.name, className: 'dshk-item' },
                    h('input', {
                      type: 'checkbox',
                      checked: selected.includes(file.name),
                      onChange: () =>
                        setSelected((current) => (current.includes(file.name) ? current.filter((item) => item !== file.name) : [...current, file.name])),
                    }),
                    h('div', { className: 'dshk-item-main' }, h('div', { className: 'dshk-item-title' }, file.name), h('div', { className: 'dshk-item-sub' }, file.isDir ? '目录' : formatBytes(file.size))),
                    h(
                      Btn,
                      {
                        small: true,
                        variant: 'danger',
                        disabled: busy,
                        onClick: () =>
                          void run(async () => {
                            if (typeof window !== 'undefined' && !window.confirm(`删除 Kindle 上的「${file.name}」？`)) return;
                            const result = await apiCall<{ removed: string[]; failed: Array<{ name: string; error: string }> }>('POST', '/kindle/delete', { names: [file.name] });
                            notify(result.failed.length === 0 ? 'ok' : 'err', result.failed.length === 0 ? '已删除' : result.failed[0]?.error ?? '删除失败');
                            await load();
                          }),
                      },
                      '删除',
                    ),
                  ),
                ),
              ),
          selected.length > 0
            ? h(
                'div',
                { className: 'dshk-actions' },
                h('span', { className: 'dshk-hint' }, `已选 ${selected.length} 个`),
                h(Btn, { variant: 'primary', onClick: upload, disabled: busy }, '上传选中文件到 Kindle'),
              )
            : null,
        )
      : null,
    h(
      Card,
      { title: '从本机传到 Kindle' },
      h('div', { className: 'dshk-hint' }, '在「书库」里选书 → 加入推送队列（浏览器下载），或连上 SSH 后在这里上传。转换好的 AZW3 在书库刷新后同样可选。'),
    ),
  );
}

// ── 设置 ────────────────────────────────────────────────────────────────

export function SettingsView(props: ViewProps): any {
  const { state, busy, run, notify } = props;
  const settings = state.settings;
  const [libraryDirs, setLibraryDirs] = useState(settings.libraryDirs.join('\n'));
  const [outputDir, setOutputDir] = useState(settings.outputDir);
  const [calibreDir, setCalibreDir] = useState(settings.calibreDir);
  const [defaultFormat, setDefaultFormat] = useState(settings.defaultFormat);
  const [pushPort, setPushPort] = useState(String(settings.push.port));
  const [keyPath, setKeyPath] = useState(settings.kindle.keyPathHint);

  const save = (): void => {
    void run(async () => {
      await apiCall('POST', '/settings', {
        libraryDirs: libraryDirs.split('\n').map((line) => line.trim()).filter((line) => line !== ''),
        outputDir: outputDir.trim(),
        calibreDir: calibreDir.trim(),
        defaultFormat,
        push: { port: Number(pushPort) || 8180 },
        kindle: { keyPath: keyPath.trim() },
      });
      notify('ok', '设置已保存');
    });
  };

  return h(
    'div',
    { className: 'dshk-body' },
    h(
      Card,
      { title: '书库' },
      h(Row, { label: '书库目录' }, h(TextArea, { value: libraryDirs, onInput: setLibraryDirs, rows: 3, placeholder: '/Users/you/Documents/Books\n/Volumes/移动硬盘/books' })),
      h('div', { className: 'dshk-hint' }, '每行一个绝对路径，会递归扫描。支持 EPUB / PDF / MOBI / AZW3 / TXT / FB2 / DOCX / RTF。'),
      h(Row, { label: '转换输出' }, h(Input, { value: outputDir, onInput: setOutputDir, placeholder: '留空则用 ~/Documents/Books/kindle' })),
    ),
    h(
      Card,
      { title: '转换' },
      h(Row, { label: 'calibre 目录' }, h(Input, { value: calibreDir, onInput: setCalibreDir, mono: true })),
      h(Row, { label: '默认格式' }, h(Select, { value: defaultFormat, onChange: (value: string) => setDefaultFormat(value as 'azw3' | 'mobi'), options: [{ value: 'mobi', label: 'MOBI（兼容性最好，推荐）' }, { value: 'azw3', label: 'AZW3（KF8，排版更好）' }] })),
      h('div', { className: 'dshk-hint' }, state.calibre === null ? 'calibre 可用' : state.calibre),
    ),
    h(
      Card,
      { title: '局域网推送' },
      h(Row, { label: '端口' }, h(Input, { value: pushPort, onInput: setPushPort, placeholder: '8180' })),
      h('div', { className: 'dshk-hint' }, '改端口后会自动重启推送服务；Kindle 浏览器访问 http://<本机局域网 IP>:<端口>/。'),
    ),
    h(
      Card,
      { title: 'Kindle SSH（可选）' },
      h(Row, { label: '私钥路径' }, h(Input, { value: keyPath, onInput: setKeyPath, mono: true, placeholder: '~/.ssh/kindle_rsa（不用私钥就留空）' })),
      h('div', { className: 'dshk-hint' }, '密码在「Kindle」页填写；这里只存路径。连接信息保存后不会明文回显。'),
    ),
    h('div', { className: 'dshk-toolbar' }, h(Btn, { variant: 'primary', onClick: save, disabled: busy }, '保存设置')),
  );
}

/**
 * Client half 入口：侧栏「Kindle」→ 工作台。
 *
 * 外壳只做三件事：拉 /state、轮询转换与下载状态、切 tab。视图按需渲染。
 * 数据只来自 Host 的 `/api/morehao/kindle/*`，客户端不碰文件系统。
 */
import { useEffect, useState } from 'react';

import { apiCall, type StatePayload } from './api.js';
import { SidebarPanelIcon } from './icon.js';
import { CSS, STYLE_ID } from './styles.js';
import { Alert, Btn, Pill, h } from './ui.js';
import { KindleView, LibraryView, SettingsView, TransferView, type ViewProps } from './views.js';

export const PANEL_ID = 'dsh-kindle';

export const inject = ['slots'];

type Tab = 'library' | 'transfer' | 'kindle' | 'settings';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'library', label: '书库' },
  { id: 'transfer', label: '传送' },
  { id: 'kindle', label: 'Kindle' },
  { id: 'settings', label: '设置' },
];

interface Notice {
  kind: 'ok' | 'err' | 'warn';
  text: string;
}

function PanelView(): any {
  const [tab, setTab] = useState<Tab>('library');
  const [state, setState] = useState<StatePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const refresh = async (): Promise<void> => {
    try {
      const payload = await apiCall<StatePayload>('GET', '/state');
      setState(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    void refresh();
    const hasActive = state === null || state.jobs.some((job) => job.status === 'running' || job.status === 'queued');
    const timer = setInterval(() => void refresh(), hasActive ? 2000 : 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.jobs.some((job) => job.status === 'running' || job.status === 'queued')]);

  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setNotice({ kind: 'err', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  const notify = (kind: Notice['kind'], text: string): void => setNotice({ kind, text });

  if (state === null) {
    return h(
      'div',
      { className: 'dshk-root' },
      h('div', { className: 'dshk-head' }, h('span', { className: 'dshk-title' }, 'Kindle')),
      error === null ? h('div', { className: 'dshk-hint' }, '正在读取状态…') : h(Alert, { kind: 'err' }, error),
    );
  }

  const props: ViewProps = { state, busy, run, refresh, notify };
  const view = tab === 'library' ? LibraryView(props) : tab === 'transfer' ? TransferView(props) : tab === 'kindle' ? KindleView(props) : SettingsView(props);

  return h(
    'div',
    { className: 'dshk-root' },
    h(
      'div',
      { className: 'dshk-head' },
      h('span', { className: 'dshk-title' }, 'Kindle'),
      h(Pill, { kind: state.push.running ? 'ok' : 'idle' }, state.push.running ? '推送服务运行中' : '推送服务未启动'),
      h(Pill, { kind: state.calibre === null ? 'ok' : 'err' }, state.calibre === null ? 'calibre 就绪' : 'calibre 不可用'),
      state.kindle.configured ? h(Pill, { kind: state.kindle.connected ? 'ok' : 'warn' }, state.kindle.connected ? 'Kindle 已连接' : 'Kindle 已配置') : null,
      h(
        'span',
        { className: 'dshk-spacer' },
        h(Btn, { small: true, onClick: () => void refresh(), disabled: busy }, '刷新'),
      ),
    ),
    notice === null ? null : h(Alert, { kind: notice.kind }, notice.text),
    error === null ? null : h(Alert, { kind: 'err' }, error),
    h(
      'div',
      { className: 'dshk-tabs', role: 'tablist' },
      TABS.map((item) =>
        h(
          'button',
          { key: item.id, type: 'button', className: 'dshk-tab', role: 'tab', 'aria-selected': tab === item.id ? 'true' : 'false', onClick: () => setTab(item.id) },
          item.label,
        ),
      ),
    ),
    view,
  );
}

function injectStyles(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const existing = document.getElementById(STYLE_ID);
  if (existing !== null) return () => existing.remove();
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
  return () => style.remove();
}

interface Slots {
  register: (options: Record<string, unknown>, component: any) => void;
  inject: (name: string, factory: () => unknown) => () => void;
}

export function apply(ctx: any): void {
  const slots: Slots | undefined = ctx.get?.('slots');
  if (slots === undefined || typeof slots.register !== 'function') return;

  const disposeStyles = injectStyles();
  const disposers: Array<() => void> = [];

  disposers.push(
    slots.inject('main', () => {
      const disposeMain = slots.register({ name: 'main', key: PANEL_ID }, PanelView);
      const disposeEntry = slots.inject('sidebar.panellist', () =>
        slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 41, label: () => 'Kindle' }, SidebarPanelIcon),
      );
      return [disposeMain, disposeEntry];
    }),
  );

  if (typeof ctx.effect === 'function') {
    ctx.effect(
      () => () => {
        for (const dispose of disposers.splice(0)) {
          try {
            dispose();
          } catch {
            // 单个卸载失败不影响其它挂载点
          }
        }
        disposeStyles();
      },
      'dsh-kindle:client',
    );
  }
}

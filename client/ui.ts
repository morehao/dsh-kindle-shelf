/** 客户端与宿主的唯一接触点：只拿 `react`，组件用 `h()` 手写。 */
import React from 'react';

export const h: any = React.createElement;
export { React };

export interface ChildrenProps {
  children?: any;
  [key: string]: any;
}

export function Card(props: ChildrenProps & { title?: string; hint?: string; extra?: any }): any {
  return h(
    'section',
    { className: 'dshk-card' },
    props.title === undefined && props.extra === undefined
      ? null
      : h(
          'div',
          { className: 'dshk-card-h' },
          props.title === undefined ? null : h('h3', null, props.title),
          props.hint === undefined ? null : h('span', { className: 'dshk-hint' }, props.hint),
          props.extra === undefined ? null : h('span', { className: 'dshk-spacer' }, props.extra),
        ),
    props.children,
  );
}

export function Row(props: ChildrenProps & { label?: string }): any {
  return h(
    'div',
    { className: 'dshk-row' },
    props.label === undefined ? null : h('label', { className: 'dshk-label' }, props.label),
    props.children,
  );
}

export function Input(props: ChildrenProps & { value?: string; onInput?: (value: string) => void; placeholder?: string; mono?: boolean; password?: boolean; type?: string }): any {
  return h('input', {
    className: `dshk-input${props.mono === true ? ' dshk-mono' : ''}`,
    value: props.value,
    placeholder: props.placeholder,
    type: props.password === true ? 'password' : props.type ?? 'text',
    onInput: (event: any) => props.onInput?.(event.target.value),
  });
}

export function TextArea(props: ChildrenProps & { value?: string; onInput?: (value: string) => void; rows?: number; placeholder?: string }): any {
  return h('textarea', {
    className: 'dshk-input dshk-mono',
    rows: props.rows ?? 3,
    value: props.value,
    placeholder: props.placeholder,
    onInput: (event: any) => props.onInput?.(event.target.value),
  });
}

export function Select(props: ChildrenProps & { value?: string; onChange?: (value: string) => void; options: Array<{ value: string; label: string }> }): any {
  return h(
    'select',
    { className: 'dshk-select', value: props.value, onChange: (event: any) => props.onChange?.(event.target.value) },
    props.options.map((option) => h('option', { key: option.value, value: option.value }, option.label)),
  );
}

export function Btn(props: ChildrenProps & { onClick?: () => void; variant?: 'primary' | 'danger' | 'ghost'; small?: boolean; disabled?: boolean; title?: string }): any {
  const classes = ['dshk-btn'];
  if (props.variant === 'primary') classes.push('dshk-btn-primary');
  if (props.variant === 'danger') classes.push('dshk-btn-danger');
  if (props.variant === 'ghost') classes.push('dshk-btn-ghost');
  if (props.small === true) classes.push('dshk-btn-sm');
  return h(
    'button',
    { type: 'button', className: classes.join(' '), onClick: props.onClick, disabled: props.disabled === true, title: props.title },
    props.children,
  );
}

export function Pill(props: { kind?: 'ok' | 'warn' | 'err' | 'idle'; children: any }): any {
  return h('span', { className: 'dshk-pill' }, h('span', { className: `dshk-dot ${props.kind ?? ''}`.trim() }), props.children);
}

export function Alert(props: ChildrenProps & { kind?: 'ok' | 'warn' | 'err' }): any {
  return h('div', { className: `dshk-alert${props.kind === 'err' ? ' err' : props.kind === 'ok' ? ' ok' : ''}` }, props.children);
}

export function Empty(props: ChildrenProps): any {
  return h('div', { className: 'dshk-empty' }, props.children);
}

export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 'B';
  for (const next of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = next;
  }
  return unit === 'B' ? `${value} B` : `${value.toFixed(1)} ${unit}`;
}

export function shortTime(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

export async function copyText(value: string): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return false;
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

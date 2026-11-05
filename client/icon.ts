/** 侧栏入口图标：一本合起的书。只画自包含 glyph，颜色跟随 currentColor。 */
import { h } from './ui.js';

export function SidebarPanelIcon(props: { size?: number; active?: boolean }): any {
  const size = typeof props.size === 'number' ? props.size : 16;
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: props.active === true ? 2 : 1.7,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    h('path', { d: 'M5 4.5h9.5A2.5 2.5 0 0 1 17 7v12.5H7.5A2.5 2.5 0 0 1 5 17z' }),
    h('path', { d: 'M5 17a2.5 2.5 0 0 1 2.5-2.5H17' }),
    h('path', { d: 'M9 7.5h5M9 11h5' }),
  );
}

// 由 scripts/sync-theme.mjs 从 enso-code/src/shared/theme/anchors.ts@3916fe5ae7f317c33855be043e4a725f36b14479 同步，勿手改
/** 用户 CSS / 插件主题可依赖的稳定选择器：组件上的 `data-enso="…"` */
export const THEME_ANCHORS = [
  'canvas',
  'sidebar',
  'main',
  'title-bar',
  'session-tabs',
  'side-panel',
  'timeline',
  'message-user',
  'message-assistant',
  'tool-row',
  'thinking',
  'todo',
  'code-block',
  'composer',
  'status-line',
  'settings-nav',
  'settings-content',
] as const;

export type ThemeAnchor = (typeof THEME_ANCHORS)[number];

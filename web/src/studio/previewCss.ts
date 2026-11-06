import { resolveThemeAssets, resolveThemeBackground, themeAssetsCss } from '../enso-theme/assets';
import { themeTokensCss } from '../enso-theme/tokensCss';
import type { ThemeAssets, ThemeBackground, ThemeBackgroundSize } from '../enso-theme/types';
import type { Draft } from './draft';
import { themeIdOf } from './pack';

const SIZE: Record<ThemeBackgroundSize, string> = {
  cover: 'background-size:cover;background-repeat:no-repeat;background-position:center',
  contain: 'background-size:contain;background-repeat:no-repeat;background-position:center',
  repeat: 'background-size:auto;background-repeat:repeat;background-position:top left',
  center: 'background-size:auto;background-repeat:no-repeat;background-position:center',
};

/**
 * 近似宿主的背景图模式：BackgroundLayer 把可见度合成在整张壁纸（图+遮罩）上，普通面板全透；
 * 代码块、输入框按各自不透明度铺底，见 useBackgroundImage 与 globals.css 的 html.bg-image-enabled。
 * 宿主改的是 Tailwind 的 --color-*，模拟界面直接用原始令牌，所以这里按选择器逐个改写
 */
export function backgroundCss(background: Required<Omit<ThemeBackground, 'image'>>): string {
  const { size, blur, brightness, saturation, mask, opacity, composerOpacity, codeOpacity } = background;
  const alpha = (token: string, a: number) => `oklch(from var(--${token}) l c h / ${a})`;
  return `
.m-bg{display:block}
.m-bg-media{opacity:${Math.min(1, Math.max(0, opacity))}}
.m-bg-image{inset:${blur > 0 ? `-${blur * 2}px` : '0'};background-image:var(--enso-asset-background);${SIZE[size]};filter:blur(${blur}px) brightness(${brightness}) saturate(${saturation})}
.m-bg-mask{background:color-mix(in oklab,var(--canvas,var(--background)) ${Math.round(mask * 100)}%,transparent)}
.m-canvas{position:relative;background:transparent}
[data-enso=main],[data-enso=side-panel],[data-enso=todo]{background:transparent}
[data-enso=code-block]{background:${alpha('background', codeOpacity)}}
[data-enso=composer]{background:${alpha('background', composerOpacity)}}
`;
}

/**
 * 注入顺序与宿主相同：tokens → 素材 → 背景图模式 → 主题 CSS。
 * 模拟「减少动态效果」：把 reduce 媒体查询改成恒真，宿主的 still 规则就会生效
 */
export function previewCss(draft: Draft, assets: ThemeAssets, background: ThemeBackground | undefined, urls: Map<string, string>, reducedMotion: boolean): string {
  const themeId = themeIdOf(draft.id) || 'theme';
  const theme = {
    id: `${draft.id}/${themeId}` as const,
    name: draft.name,
    source: { kind: 'plugin' as const, pluginId: draft.id, pluginName: draft.name },
    light: draft.light,
    dark: draft.dark,
  };
  const themePath = `themes/${themeId}.json`;
  const toUrl = (rel: string) => urls.get(rel) ?? '';
  const resolved = resolveThemeAssets(assets, themePath, toUrl);
  const resolvedBackground = background && resolveThemeBackground(background, themePath, toUrl);
  const css = [
    themeTokensCss(theme, 'theme'),
    themeAssetsCss(resolved, resolvedBackground),
    draft.background ? backgroundCss(draft.background) : '',
    draft.css ?? '',
  ].join('\n');
  return reducedMotion
    ? css.replace(/\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/g, 'all').replace(/\(\s*prefers-reduced-motion\s*:\s*no-preference\s*\)/g, 'not all')
    : css;
}

/** 模拟 EnsoCode 主窗口的底样式，只用宿主派生出的变量 */
export const MOCK_CSS = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;height:100%}
body{font:13px/1.55 var(--font-family-sans,-apple-system,BlinkMacSystemFont,'PingFang SC','Segoe UI',sans-serif);color:var(--foreground);background:var(--canvas);-webkit-font-smoothing:antialiased}
.m-canvas{display:flex;height:100vh;background:var(--canvas);overflow:hidden}
.m-bg{display:none;position:fixed;inset:0;overflow:hidden;background:var(--canvas)}
.m-bg-media,.m-bg-image,.m-bg-mask{position:absolute;inset:0}
.m-sidebar{width:208px;flex:none;display:flex;flex-direction:column;gap:2px;padding:44px 8px 12px}
.m-group{padding:10px 10px 4px;font-size:11px;color:var(--subtle-foreground)}
.m-item{display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:8px;color:var(--muted-foreground);white-space:nowrap;overflow:hidden}
.m-item.on{background:var(--accent);color:var(--foreground)}
.m-dot{width:7px;height:7px;flex:none;border-radius:50%;background:var(--subtle-foreground);opacity:.5}
:root[data-enso-session=running] .m-item.on .m-dot,:root[data-enso-session=running] .m-title .m-dot{background:var(--brand);opacity:1}
:root[data-enso-session=waiting] .m-item.on .m-dot,:root[data-enso-session=waiting] .m-title .m-dot{background:var(--warning);opacity:1}
:root[data-enso-session=error] .m-item.on .m-dot,:root[data-enso-session=error] .m-title .m-dot{background:var(--destructive);opacity:1}
.m-workspace{flex:1;min-width:0;display:flex;gap:8px;padding:8px 8px 8px 0}
[data-enso=main]{flex:1;min-width:0;display:flex;flex-direction:column;background:var(--background);border-radius:10px;box-shadow:var(--elevation-surface);overflow:hidden}
[data-enso=title-bar]{height:40px;flex:none;display:flex;align-items:center;gap:8px;padding:0 14px;border-bottom:1px solid var(--border);font-weight:500}
.m-title{display:flex;align-items:center;gap:8px}
[data-enso=timeline]{position:relative;flex:1;min-height:0;overflow:auto;padding:20px 0 8px}
.m-col{max-width:600px;margin:0 auto;padding:0 16px}
.m-hello{padding-top:56px;text-align:center;color:var(--muted-foreground)}
.m-hello b{display:block;font-size:18px;color:var(--foreground);margin-bottom:4px}
[data-enso=message-user]{display:flex;flex-direction:column;align-items:flex-end;gap:2px;margin-bottom:18px}
[data-enso=message-user]>div:not(:last-child){max-width:80%;padding:8px 12px;border-radius:14px;background:var(--secondary)}
.m-meta{font-size:11px;color:var(--subtle-foreground)}
[data-enso=message-assistant] p{margin:0 0 10px}
[data-enso=message-assistant] code{font:12px ui-monospace,SFMono-Regular,Menlo,monospace;padding:1px 4px;border-radius:4px;background:var(--muted);border:1px solid var(--border)}
[data-enso=thinking]{min-height:28px;margin:2px 0 12px;color:var(--muted-foreground);font-size:12px}
[data-enso=thinking][data-live] .m-think{background:linear-gradient(90deg,var(--muted-foreground),var(--foreground),var(--muted-foreground));background-size:200% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;animation:m-shine 1.6s linear infinite}
@keyframes m-shine{to{background-position:-200% 0}}
@media (prefers-reduced-motion: reduce){[data-enso=thinking][data-live] .m-think{animation:none}}
[data-enso=tool-row]{display:flex;gap:8px;align-items:center;margin:0 0 10px;font-size:12px;color:var(--subtle-foreground)}
[data-enso=code-block]{position:relative;margin:14px 0;border:1px solid var(--border);border-radius:8px;background:var(--sunken)}
[data-enso=code-block] pre{margin:0;padding:10px 12px;overflow:auto;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}
.m-k{color:var(--brand)}
[data-enso=todo]{margin:10px 0 4px;padding:8px 12px;border:1px solid var(--border);border-radius:8px;background:var(--card)}
[data-enso=todo] div{display:flex;gap:8px;align-items:center;padding:2px 0;color:var(--muted-foreground)}
.m-check{width:12px;height:12px;flex:none;border-radius:50%;border:1.5px solid var(--input)}
.m-check.done{background:var(--brand);border-color:var(--brand)}
.m-check.now{border-color:var(--brand)}
.m-bottom{flex:none;padding:6px 0 10px}
[data-enso=composer]{display:flex;flex-direction:column;gap:6px;min-height:86px;padding:10px 12px 8px;border:1px solid var(--input);border-radius:14px;background:var(--background);box-shadow:var(--elevation-surface)}
[data-enso=composer] textarea{flex:1;resize:none;border:0;outline:0;background:transparent;color:inherit;font:inherit}
[data-enso=composer] textarea::placeholder{color:var(--subtle-foreground)}
.m-tools{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--muted-foreground)}
.m-chip{padding:2px 8px;border-radius:6px;background:var(--secondary)}
.m-send{margin-left:auto;width:26px;height:26px;border-radius:50%;background:var(--primary);color:var(--primary-foreground);display:grid;place-items:center;font-size:14px}
[data-enso=status-line]{position:relative;display:flex;gap:14px;padding:6px 6px 0 28px;font-size:11px;color:var(--subtle-foreground)}
:root[data-enso-session=error] .m-state{color:var(--destructive)}
:root[data-enso-session=waiting] .m-state{color:var(--warning)}
:root[data-enso-session=running] .m-state{color:var(--brand)}
[data-enso=side-panel]{width:232px;flex:none;display:flex;flex-direction:column;gap:4px;padding:12px;background:var(--background);border-radius:10px;box-shadow:var(--elevation-surface);color:var(--muted-foreground);font-size:12px}
[data-enso=side-panel] b{color:var(--foreground);font-weight:500;margin-bottom:6px}
.m-file{padding:3px 6px;border-radius:6px}
.m-file.on{background:var(--accent);color:var(--foreground)}
`;

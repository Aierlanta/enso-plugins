import { THEME_BACKGROUND_PARAMS } from '../enso-theme/assets';
import { BUILTIN_THEMES } from '../enso-theme/builtinThemes';
import type { ThemeAssetSlot, ThemeAssetState, ThemeBackgroundParam, ThemeBackgroundSize, ThemeMode, ThemePalette } from '../enso-theme/types';

/** 上传的原始文件；name 只用来取扩展名 */
export interface AssetFile {
  name: string;
  blob: Blob;
}

/** 与宿主 ThemeAsset 同形，路径换成文件；没有默认图就没有这个槽位 */
export interface DraftAsset {
  src: AssetFile;
  still?: AssetFile;
  dark?: AssetFile;
  states?: Partial<Record<ThemeAssetState, AssetFile>>;
}

export type DraftAssets = Partial<Record<ThemeAssetSlot, DraftAsset>>;

/** 与宿主 ThemeBackground 同形，图片换成文件；参数在草稿里总是写全 */
export type DraftBackground = { image: DraftAsset; size: ThemeBackgroundSize } & Record<ThemeBackgroundParam, number>;

/** 生成器唯一的状态：预览与导出都从它派生 */
export interface Draft {
  id: string;
  name: string;
  version: string;
  author: string;
  light: ThemePalette;
  dark: ThemePalette;
  assets: DraftAssets;
  /** 老草稿没有这个字段 */
  background?: DraftBackground;
  css?: string;
}

export type AssetVariant = 'src' | 'still' | 'dark' | ThemeAssetState;

export const ASSET_STATES: readonly ThemeAssetState[] = ['running', 'waiting', 'error'];

export const VARIANTS: readonly { key: AssetVariant; label: string }[] = [
  { key: 'src', label: '默认' },
  { key: 'still', label: '静帧' },
  { key: 'dark', label: '深色' },
  { key: 'running', label: '运行中' },
  { key: 'waiting', label: '等待中' },
  { key: 'error', label: '出错' },
];

/** 槽位顺序与宿主 assets.ts 的 SLOTS 一致 */
export const SLOTS: readonly { slot: ThemeAssetSlot; label: string; hint: string }[] = [
  { slot: 'canvas-pattern', label: '画布底纹', hint: '主窗口画布平铺，跟随全局状态' },
  { slot: 'sidebar-footer', label: '侧栏底部', hint: '侧栏背景底部居中' },
  { slot: 'empty-main', label: '空白主区', hint: '没有打开会话时的主区' },
  { slot: 'welcome', label: '新会话欢迎', hint: '还没有用户消息时，时间线右下角' },
  { slot: 'composer-peek', label: '输入框探头', hint: '从输入框上沿探头，聚焦时弹起' },
  { slot: 'thinking', label: '思考中', hint: '思考块左侧；静帧用于思考结束后' },
  { slot: 'code-corner', label: '代码块角标', hint: '代码块右上沿' },
  { slot: 'status-icon', label: '状态行图标', hint: '状态行左侧' },
  { slot: 'panel-corner', label: '右面板角落', hint: '右侧面板右下角' },
];

export const PALETTE_FIELDS: readonly { key: keyof ThemePalette; label: string }[] = [
  { key: 'canvas', label: '画布' },
  { key: 'surface', label: '主卡片' },
  { key: 'sunken', label: '凹面' },
  { key: 'border', label: '分隔线' },
  { key: 'borderStrong', label: '控件描边' },
  { key: 'text', label: '正文' },
  { key: 'textMuted', label: '次要文字' },
  { key: 'textSubtle', label: '弱化文字' },
  { key: 'accent', label: '强调色' },
];

const ENSO = BUILTIN_THEMES[0]!;

export const emptyDraft = (): Draft => ({
  id: 'me.mytheme',
  name: '我的主题',
  version: '0.1.0',
  author: '',
  light: { ...ENSO.light },
  dark: { ...ENSO.dark },
  assets: {},
});

/** 另一模式的建议值：内置 Enso 的那套调色板，沿用当前强调色 */
export const suggestPalette = (from: ThemeMode, draft: Draft): ThemePalette => {
  const to: ThemeMode = from === 'light' ? 'dark' : 'light';
  return { ...ENSO[to], accent: draft[from].accent };
};

export function getVariant(asset: DraftAsset | undefined, key: AssetVariant): AssetFile | undefined {
  if (!asset) return undefined;
  return key === 'src' || key === 'still' || key === 'dark' ? asset[key] : asset.states?.[key];
}

/** 清掉默认图等于清掉整张素材 */
export function withVariant(current: DraftAsset | undefined, key: AssetVariant, file: AssetFile | undefined): DraftAsset | undefined {
  if (key === 'src') return file ? { ...current, src: file } : undefined;
  if (!current) return undefined;
  if (key === 'still' || key === 'dark') {
    const { [key]: _, ...asset } = current;
    return file ? { ...asset, [key]: file } : asset;
  }
  const { [key]: _, ...states } = current.states ?? {};
  const nextStates = file ? { ...states, [key]: file } : states;
  const { states: __, ...asset } = current;
  return Object.keys(nextStates).length > 0 ? { ...asset, states: nextStates } : asset;
}

export function setVariant(assets: DraftAssets, slot: ThemeAssetSlot, key: AssetVariant, file: AssetFile | undefined): DraftAssets {
  const { [slot]: current, ...rest } = assets;
  const next = withVariant(current, key, file);
  return next ? { ...rest, [slot]: next } : rest;
}

export const BACKGROUND_DEFAULTS: Omit<DraftBackground, 'image'> = {
  size: 'cover',
  ...(Object.fromEntries(Object.entries(THEME_BACKGROUND_PARAMS).map(([key, range]) => [key, range.default])) as Record<ThemeBackgroundParam, number>),
};

/** 换图保留参数；第一次放图取设置页默认值；清掉默认图等于去掉背景 */
export function setBackgroundVariant(background: DraftBackground | undefined, key: AssetVariant, file: AssetFile | undefined): DraftBackground | undefined {
  const image = withVariant(background?.image, key, file);
  if (!image) return undefined;
  return { ...BACKGROUND_DEFAULTS, ...background, image };
}

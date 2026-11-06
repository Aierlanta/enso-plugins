import { parseThemeAssets, THEME_ASSET_EXTENSIONS } from '../enso-theme/assets';
import { parseThemeFile } from '../enso-theme/themeFile';
import { isSafeTokenValue } from '../enso-theme/tokensCss';
import type { ThemeAsset, ThemeAssets, ThemeAssetSlot, ThemePalette } from '../enso-theme/types';
import { PALETTE_FIELDS, type AssetFile, type AssetVariant, type Draft, type DraftAssets } from './draft';

/** 与 enso-code manifest.ts / scripts/lib.mjs 相同的规则 */
const PLUGIN_ID = /^[a-z][a-z0-9]*(\.[a-z0-9]+)+$/;
const THEME_ID = /^[a-z][a-z0-9-]{0,31}$/;
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;
export const ENGINE = '>=0.3.3';

/** 插件 id 的最后一段做主题 id，也是 themes/<id>.json 的文件名 */
export const themeIdOf = (pluginId: string) => pluginId.split('.').pop() ?? '';

const extOf = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();

/** 主题 JSON 的 assets（相对 themes/）与对应文件（相对插件根目录）；预览与导出共用 */
export function draftAssets(draftAssets: DraftAssets): { assets: ThemeAssets; files: Map<string, Blob> } {
  const files = new Map<string, Blob>();
  const path = (slot: ThemeAssetSlot, variant: AssetVariant, file: AssetFile) => {
    const rel = `assets/${variant === 'src' ? slot : `${slot}-${variant}`}.${extOf(file.name)}`;
    files.set(`themes/${rel}`, file.blob);
    return rel;
  };
  const assets: ThemeAssets = {};
  for (const [slot, asset] of Object.entries(draftAssets) as [ThemeAssetSlot, DraftAssets[ThemeAssetSlot]][]) {
    if (!asset) continue;
    const out: ThemeAsset = { src: path(slot, 'src', asset.src) };
    if (asset.still) out.still = path(slot, 'still', asset.still);
    if (asset.dark) out.dark = path(slot, 'dark', asset.dark);
    const states = Object.entries(asset.states ?? {}).filter((entry): entry is [keyof NonNullable<ThemeAsset['states']>, AssetFile] => !!entry[1]);
    if (states.length > 0) out.states = Object.fromEntries(states.map(([state, file]) => [state, path(slot, state, file)]));
    assets[slot] = out;
  }
  return { assets, files };
}

export function themeJson(draft: Draft, assets: ThemeAssets) {
  const palette = (p: ThemePalette) => Object.fromEntries(PALETTE_FIELDS.map(({ key }) => [key, p[key].trim()]));
  return { light: palette(draft.light), dark: palette(draft.dark), ...(Object.keys(assets).length > 0 ? { assets } : {}) };
}

export function manifestJson(draft: Draft) {
  const themeId = themeIdOf(draft.id);
  const css = draft.css?.trim();
  const author = draft.author.trim();
  return {
    schemaVersion: 1,
    id: draft.id,
    name: draft.name.trim(),
    version: draft.version,
    description: author ? `${draft.name.trim()}主题，作者 ${author}。` : `${draft.name.trim()}主题。`,
    engines: { enso: ENGINE },
    permissions: [],
    contributes: {
      themes: [{ id: themeId, name: draft.name.trim(), path: `themes/${themeId}.json`, ...(css ? { css: `themes/${themeId}.css` } : {}) }],
    },
  };
}

/** 导出前自检：清单字段、调色板、素材都按宿主规则走一遍，返回可读的错误 */
export function checkDraft(draft: Draft): string[] {
  const errors: string[] = [];
  if (!PLUGIN_ID.test(draft.id) || draft.id.length > 40)
    errors.push('插件 id 要写成小写反向域名，例如 me.mytheme，不超过 40 个字符');
  else if (!THEME_ID.test(themeIdOf(draft.id))) errors.push('插件 id 的最后一段要以字母开头');
  if (!draft.name.trim() || draft.name.length > 40) errors.push('名称不能为空，不超过 40 个字符');
  if (!SEMVER.test(draft.version)) errors.push('版本号要写成 1.2.3 这样的格式');
  for (const mode of ['light', 'dark'] as const) {
    for (const { key, label } of PALETTE_FIELDS) {
      const value = draft[mode][key];
      if (!value.trim() || !isSafeTokenValue(value)) errors.push(`${mode === 'light' ? '浅色' : '深色'}「${label}」不是合法的颜色`);
    }
  }
  for (const [slot, asset] of Object.entries(draft.assets)) {
    if (!asset) continue;
    const names = [asset.src, asset.still, asset.dark, ...Object.values(asset.states ?? {})].filter((f): f is AssetFile => !!f);
    for (const file of names)
      if (!THEME_ASSET_EXTENSIONS.includes(extOf(file.name))) errors.push(`「${slot}」的 ${file.name} 格式不支持，只能用 ${THEME_ASSET_EXTENSIONS.join('、')}`);
  }
  if (errors.length > 0) return errors;
  const { assets } = draftAssets(draft.assets);
  const parsed = parseThemeFile(themeJson(draft, assets));
  if (!parsed.ok) return [parsed.error];
  const kept = Object.keys(parseThemeAssets(assets) ?? {});
  const lost = Object.keys(assets).filter((slot) => !kept.includes(slot));
  if (lost.length > 0) errors.push(`素材槽位没有通过校验：${lost.join('、')}`);
  return errors;
}

export type PackResult = { ok: true; files: Map<string, Uint8Array> } | { ok: false; errors: string[] };

/** 插件目录的全部文件，路径相对插件根目录；结构与 packages/enso.nailong 一致 */
export async function packDraft(draft: Draft): Promise<PackResult> {
  const errors = checkDraft(draft);
  if (errors.length > 0) return { ok: false, errors };
  const text = (value: unknown) => new TextEncoder().encode(`${JSON.stringify(value, null, 2)}\n`);
  const themeId = themeIdOf(draft.id);
  const { assets, files: blobs } = draftAssets(draft.assets);
  const files = new Map<string, Uint8Array>([
    ['enso-plugin.json', text(manifestJson(draft))],
    [`themes/${themeId}.json`, text(themeJson(draft, assets))],
  ]);
  const css = draft.css?.trim();
  if (css) files.set(`themes/${themeId}.css`, new TextEncoder().encode(`${css}\n`));
  for (const [path, blob] of blobs) files.set(path, new Uint8Array(await blob.arrayBuffer()));
  return { ok: true, files };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of data) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** 只存储不压缩的 zip，与 scripts/zip.mjs 同格式；图片本身已压缩 */
export function zipStore(files: Map<string, Uint8Array>): Uint8Array {
  const entries = [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [path, data] of entries) {
    const name = new TextEncoder().encode(path);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(12, 33, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, (3 << 8) | 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(14, 33, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(38, (0o100644 << 16) >>> 0, true);
    central.setUint32(42, offset, true);
    locals.push(new Uint8Array(local.buffer), name, data);
    centrals.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

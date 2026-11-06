import { parseThemeFile } from '../enso-theme/themeFile';
import type { ThemeAsset, ThemeAssetSlot } from '../enso-theme/types';
import { BACKGROUND_DEFAULTS, type AssetFile, type Draft, type DraftAsset, type DraftAssets } from './draft';

type Read = (path: string) => Promise<Blob | undefined>;

export type ImportResult = { ok: true; draft: Draft; warnings: string[] } | { ok: false; error: string };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 插件目录（zip、文件夹、内置示例）→ 草稿；只取清单里的第一个主题 */
export async function draftFromPlugin(paths: string[], read: Read): Promise<ImportResult> {
  const manifestPath = paths
    .filter((p) => p === 'enso-plugin.json' || p.endsWith('/enso-plugin.json'))
    .sort((a, b) => a.split('/').length - b.split('/').length)[0];
  if (!manifestPath) return { ok: false, error: '没有找到 enso-plugin.json' };
  const root = manifestPath.slice(0, -'enso-plugin.json'.length);
  const json = async (path: string): Promise<unknown> => {
    const blob = await read(root + path);
    if (!blob) return undefined;
    try {
      return JSON.parse(await blob.text());
    } catch {
      return undefined;
    }
  };
  const manifest = await json('enso-plugin.json');
  if (!isRecord(manifest)) return { ok: false, error: 'enso-plugin.json 不是合法的 JSON' };
  const contributes = isRecord(manifest.contributes) ? manifest.contributes : {};
  const theme = Array.isArray(contributes.themes) ? contributes.themes.find(isRecord) : undefined;
  if (!theme || typeof theme.path !== 'string') return { ok: false, error: '这个插件没有贡献主题' };
  const parsed = parseThemeFile(await json(theme.path));
  if (!parsed.ok) return { ok: false, error: `主题文件解析失败：${parsed.error}` };

  const warnings: string[] = [];
  if (parsed.tokens) warnings.push('主题里的 tokens 覆盖没有导入，生成器暂不支持编辑');
  const dir = theme.path.split('/').slice(0, -1).join('/');
  const file = async (rel: string): Promise<AssetFile | undefined> => {
    const blob = await read(root + (dir ? `${dir}/${rel}` : rel));
    if (!blob) warnings.push(`缺少素材 ${rel}`);
    return blob && { name: rel.split('/').pop() ?? rel, blob };
  };
  const draftAsset = async (asset: ThemeAsset | undefined): Promise<DraftAsset | undefined> => {
    const src = asset && (await file(asset.src));
    if (!asset || !src) return undefined;
    const out: DraftAsset = { src };
    for (const key of ['still', 'dark'] as const) {
      const got = asset[key] && (await file(asset[key]));
      if (got) out[key] = got;
    }
    for (const [state, path] of Object.entries(asset.states ?? {}) as [keyof NonNullable<DraftAsset['states']>, string][]) {
      const got = await file(path);
      if (got) out.states = { ...out.states, [state]: got };
    }
    return out;
  };
  const assets: DraftAssets = {};
  for (const [slot, asset] of Object.entries(parsed.assets ?? {}) as [ThemeAssetSlot, ThemeAsset | undefined][]) {
    const out = await draftAsset(asset);
    if (out) assets[slot] = out;
  }
  let background: Draft['background'];
  if (parsed.background) {
    const { image: raw, ...params } = parsed.background;
    const image = await draftAsset(raw);
    if (image) background = { ...BACKGROUND_DEFAULTS, ...params, image };
  }

  let css: string | undefined;
  if (typeof theme.css === 'string') {
    css = await (await read(root + theme.css))?.text();
    if (css === undefined) warnings.push(`缺少 CSS 文件 ${theme.css}`);
    else if (/url\(\s*['"]?(?!data:|var\()/.test(css))
      warnings.push('CSS 里用 url() 引用了插件内的其他文件，生成器只保留素材槽位里的图片，这些引用在预览和导出里都会失效');
  }
  const str = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v : fallback);
  return {
    ok: true,
    warnings,
    draft: {
      id: str(manifest.id, 'me.mytheme'),
      name: str(theme.name, str(manifest.name, '导入的主题')),
      version: str(manifest.version, '0.1.0'),
      author: '',
      light: parsed.light,
      dark: parsed.dark,
      assets,
      ...(background ? { background } : {}),
      ...(css?.trim() ? { css } : {}),
    },
  };
}

/** zip 里的文件列表；支持存储和 deflate 两种方法 */
export async function readZip(data: Uint8Array): Promise<Map<string, Blob>> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let end = data.length - 22;
  while (end >= 0 && view.getUint32(end, true) !== 0x06054b50) end--;
  if (end < 0) throw new Error('不是 zip 文件');
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = new Map<string, Blob>();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error('zip 目录损坏');
    const method = view.getUint16(at + 10, true);
    const size = view.getUint32(at + 20, true);
    const nameLen = view.getUint16(at + 28, true);
    const skip = nameLen + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(data.subarray(at + 46, at + 46 + nameLen));
    at += 46 + skip;
    if (name.endsWith('/')) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = new Blob([data.slice(start, start + size)]);
    if (method === 0) files.set(name, raw);
    else if (method === 8) files.set(name, await new Response(raw.stream().pipeThrough(new DecompressionStream('deflate-raw'))).blob());
    else throw new Error(`不支持的压缩方法 ${method}`);
  }
  return files;
}

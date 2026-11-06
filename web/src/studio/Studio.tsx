import { ArrowLeft, Download, FolderOpen, PackageOpen, RotateCcw, Wand2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import * as React from 'react';
import { toast, Toaster } from 'sonner';

import { EnsoMark } from '@/components/wordmark';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TooltipProvider } from '@/components/ui/tooltip';
import { easeOut } from '@/lib/motion';
import type { ThemeMode } from '../enso-theme/types';
import { BACKGROUND_DEFAULTS, emptyDraft, suggestPalette, type Draft } from './draft';
import { AssetsEditor, BackgroundEditor, CssEditor, Field, PaletteEditor, Section } from './editor';
import { draftFromPlugin, readZip, type ImportResult } from './importTheme';
import { checkDraft, draftAssets, packDraft, zipStore } from './pack';
import { Preview, type MainView, type PreviewState, type SessionState } from './Preview';
import { previewCss } from './previewCss';
import { Segmented } from './segmented';
import { loadDraft, saveDraft } from './store';

const STATES: { value: SessionState; label: string }[] = [
  { value: 'idle', label: '空闲' },
  { value: 'running', label: '运行中' },
  { value: 'waiting', label: '等待' },
  { value: 'error', label: '出错' },
];

/** 奶龙示例直接取仓库里的插件包，构建时作为静态资源发布；不带 CSS，它引用的额外文件不在槽位里 */
const NAILONG = import.meta.glob(['../../../packages/enso.nailong/enso-plugin.json', '../../../packages/enso.nailong/themes/nailong.json', '../../../packages/enso.nailong/themes/assets/*.webp'], {
  query: '?url&no-inline',
  import: 'default',
  eager: true,
}) as Record<string, string>;

async function loadNailong(): Promise<ImportResult> {
  const prefix = '../../../packages/enso.nailong/';
  const urls = new Map(Object.entries(NAILONG).map(([path, url]) => [path.slice(prefix.length), url]));
  const result = await draftFromPlugin([...urls.keys()], async (path) => {
    const url = urls.get(path);
    const res = url ? await fetch(url) : undefined;
    return res?.ok ? res.blob() : undefined;
  });
  return result.ok ? { ...result, draft: { ...result.draft, id: 'me.nailong', css: undefined }, warnings: [] } : result;
}

function useBlobUrls(files: Map<string, Blob>) {
  const [urls, setUrls] = React.useState(() => new Map<string, string>());
  React.useEffect(() => {
    const next = new Map([...files].map(([path, blob]) => [path, URL.createObjectURL(blob)]));
    setUrls(next);
    return () => next.forEach((url) => URL.revokeObjectURL(url));
  }, [files]);
  return urls;
}

function download(data: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/zip' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Studio() {
  const [draft, setDraft] = React.useState<Draft>(emptyDraft);
  const [loaded, setLoaded] = React.useState(false);
  const [mode, setMode] = React.useState<ThemeMode>('light');
  const [preview, setPreview] = React.useState<PreviewState>({ dark: false, session: 'running', activity: 'running', live: true, view: 'chat', reducedMotion: false });
  const [errors, setErrors] = React.useState<string[]>([]);
  const saveWarned = React.useRef(false);
  const zipInput = React.useRef<HTMLInputElement>(null);
  const dirInput = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    loadDraft()
      .then((saved) => saved && setDraft(saved))
      .catch((error) => console.warn('读取草稿失败', error))
      .finally(() => setLoaded(true));
  }, []);

  React.useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => {
      saveDraft(draft).catch((error) => {
        console.warn('保存草稿失败', error);
        if (!saveWarned.current) toast.warning('草稿没能存进浏览器，刷新页面会丢失');
        saveWarned.current = true;
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, loaded]);

  React.useEffect(() => setErrors([]), [draft]);

  // 只按图片取文件，拖滑块不重建 blob URL；背景参数由 previewCss 直接读草稿
  const bgImage = draft.background?.image;
  const { assets, background, files } = React.useMemo(() => draftAssets(draft.assets, bgImage && { ...BACKGROUND_DEFAULTS, image: bgImage }), [draft.assets, bgImage]);
  const urls = useBlobUrls(files);
  const css = React.useMemo(() => previewCss(draft, assets, background, urls, preview.reducedMotion), [draft, assets, background, urls, preview.reducedMotion]);
  const set = <K extends keyof PreviewState>(key: K) => (value: PreviewState[K]) => setPreview((p) => ({ ...p, [key]: value }));
  const update = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const applyImport = (result: ImportResult, what: string) => {
    if (!result.ok) return void toast.error(`${what}失败`, { description: result.error });
    setDraft(result.draft);
    toast.success(`已${what}「${result.draft.name}」`, result.warnings.length > 0 ? { description: result.warnings.join('；'), duration: 8000 } : undefined);
  };

  const importZip = async (file: File | undefined) => {
    if (!file) return;
    try {
      const entries = await readZip(new Uint8Array(await file.arrayBuffer()));
      applyImport(await draftFromPlugin([...entries.keys()], async (path) => entries.get(path)), '导入');
    } catch (error) {
      toast.error('导入失败', { description: error instanceof Error ? error.message : String(error) });
    }
  };

  const importDir = async (list: FileList | null) => {
    if (!list?.length) return;
    const entries = new Map([...list].map((f) => [f.webkitRelativePath || f.name, f as Blob]));
    applyImport(await draftFromPlugin([...entries.keys()], async (path) => entries.get(path)), '导入');
  };

  const exportZip = async () => {
    const packed = await packDraft(draft);
    if (!packed.ok) return setErrors(packed.errors);
    download(zipStore(packed.files), `${draft.id}-${draft.version}.zip`);
    toast.success('已导出插件包', {
      description: `解压后在 EnsoCode 设置 → 插件 → 从压缩包安装中选择这个文件，启用后在外观里选择「${draft.name}」。${draft.css?.trim() ? '带高级 CSS，安装时需要同意「修改界面样式」。' : ''}`,
      duration: 10000,
    });
  };

  const idError = React.useMemo(() => checkDraft({ ...draft, assets: {} }).find((e) => e.includes('插件 id')), [draft]);

  return (
    <TooltipProvider>
      <div className="relative min-h-dvh">
        <div aria-hidden className="page-backdrop pointer-events-none absolute inset-x-0 top-0 -z-10 h-96" />
        <div className="mx-auto flex max-w-[1600px] flex-col gap-5 px-5 pt-6 pb-10 sm:px-8">
          <header className="flex flex-wrap items-center gap-3">
            <a href="/" className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground">
              <ArrowLeft className="size-4" />
              插件市场
            </a>
            <h1 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight">
              <EnsoMark className="size-6" />
              <span className="wordmark-text">主题工坊</span>
            </h1>
            <p className="text-sm text-muted-foreground">不写 CSS，也能做带角色、随会话状态换图的 EnsoCode 主题。</p>
            <div className="ml-auto flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" onClick={async () => applyImport(await loadNailong(), '载入示例')}>
                <Wand2 />
                载入奶龙示例
              </Button>
              <Button variant="ghost" size="sm" onClick={() => zipInput.current?.click()}>
                <PackageOpen />
                导入 zip
              </Button>
              <Button variant="ghost" size="sm" onClick={() => dirInput.current?.click()}>
                <FolderOpen />
                导入文件夹
              </Button>
              <Button variant="ghost" size="sm" onClick={() => (setDraft(emptyDraft()), toast('已清空草稿'))}>
                <RotateCcw />
                重新开始
              </Button>
              <input ref={zipInput} type="file" accept=".zip" hidden onChange={(e) => (importZip(e.target.files?.[0]), (e.target.value = ''))} />
              <input ref={dirInput} type="file" hidden {...{ webkitdirectory: '' }} onChange={(e) => (importDir(e.target.files), (e.target.value = ''))} />
            </div>
          </header>

          <div className="grid items-start gap-5 lg:grid-cols-[minmax(360px,420px)_1fr]">
            <div className="flex flex-col gap-3">
              <Section title="基本信息" hint="插件 id 是小写反向域名，最后一段同时作为主题 id。">
                <div className="grid grid-cols-2 gap-3">
                  <Field label="名称">
                    <Input value={draft.name} onChange={(e) => update({ name: e.target.value })} className="h-8" />
                  </Field>
                  <Field label="作者">
                    <Input value={draft.author} onChange={(e) => update({ author: e.target.value })} placeholder="可选" className="h-8" />
                  </Field>
                  <Field label="插件 id" error={idError}>
                    <Input value={draft.id} onChange={(e) => update({ id: e.target.value.trim() })} spellCheck={false} className="h-8 font-mono text-xs" />
                  </Field>
                  <Field label="版本">
                    <Input value={draft.version} onChange={(e) => update({ version: e.target.value.trim() })} spellCheck={false} className="h-8 font-mono text-xs" />
                  </Field>
                </div>
              </Section>
              <PaletteEditor
                mode={mode}
                onMode={(m) => (setMode(m), set('dark')(m === 'dark'))}
                palette={draft[mode]}
                onChange={(palette) => update({ [mode]: palette })}
                onSuggest={() => {
                  const to: ThemeMode = mode === 'light' ? 'dark' : 'light';
                  update({ [to]: suggestPalette(mode, draft) });
                  setMode(to);
                  set('dark')(to === 'dark');
                  toast(`已按 Enso 默认${to === 'dark' ? '深色' : '浅色'}调色板生成建议，强调色沿用当前值`);
                }}
              />
              <AssetsEditor assets={draft.assets} onChange={(assets) => update({ assets })} />
              <BackgroundEditor background={draft.background} onChange={(background) => update({ background })} />
              <CssEditor key={loaded ? 'ready' : 'loading'} css={draft.css ?? ''} onChange={(value) => update({ css: value })} />
              <div className="flex flex-col gap-2 rounded-xl border bg-card p-4 shadow-xs">
                <Button onClick={exportZip}>
                  <Download />
                  导出插件 zip
                </Button>
                <AnimatePresence>
                  {errors.length > 0 && (
                    <motion.ul
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.2, ease: easeOut }}
                      className="flex list-disc flex-col gap-1 rounded-md border border-destructive/30 bg-destructive/5 py-2 pr-3 pl-7 text-xs text-destructive"
                    >
                      {errors.map((error) => (
                        <li key={error}>{error}</li>
                      ))}
                    </motion.ul>
                  )}
                </AnimatePresence>
                <p className="text-xs leading-relaxed text-muted-foreground">草稿和图片只存在这个浏览器里，不会上传。</p>
              </div>
            </div>

            <div className="flex flex-col gap-3 lg:sticky lg:top-6">
              <div className="flex flex-wrap items-center gap-2">
                <Segmented<ThemeMode> label="明暗" value={preview.dark ? 'dark' : 'light'} onChange={(v) => (setMode(v), set('dark')(v === 'dark'))} options={[{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }]} />
                <Segmented<MainView> label="主区" value={preview.view} onChange={set('view')} options={[{ value: 'empty', label: '空白主区' }, { value: 'new', label: '新会话' }, { value: 'chat', label: '有消息' }]} />
                <Segmented label="思考" value={preview.live ? 'live' : 'done'} onChange={(v) => set('live')(v === 'live')} options={[{ value: 'live', label: '思考中' }, { value: 'done', label: '思考结束' }]} />
                <Segmented label="减少动态效果" value={preview.reducedMotion ? 'on' : 'off'} onChange={(v) => set('reducedMotion')(v === 'on')} options={[{ value: 'off', label: '正常动效' }, { value: 'on', label: '减少动效' }]} />
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-2">
                  当前会话
                  <Segmented label="当前会话状态" value={preview.session} onChange={set('session')} options={STATES} />
                </span>
                <span className="flex items-center gap-2">
                  全局
                  <Segmented label="全局状态" value={preview.activity} onChange={set('activity')} options={STATES} />
                </span>
              </div>
              <Preview css={css} state={preview} className="h-[min(720px,calc(100dvh-140px))] min-h-[520px] w-full rounded-xl border bg-card shadow-sm" />
            </div>
          </div>
        </div>
        <Toaster theme="system" position="bottom-center" toastOptions={{ className: 'font-sans' }} />
      </div>
    </TooltipProvider>
  );
}

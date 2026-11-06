import { ChevronRight, ImagePlus, Sparkles, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import * as React from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { easeOut } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { THEME_ASSET_EXTENSIONS, THEME_BACKGROUND_PARAMS } from '../enso-theme/assets';
import type { ThemeAssetSlot, ThemeBackgroundParam, ThemeBackgroundSize, ThemeMode, ThemePalette } from '../enso-theme/types';
import {
  getVariant,
  PALETTE_FIELDS,
  setBackgroundVariant,
  setVariant,
  SLOTS,
  VARIANTS,
  type AssetFile,
  type AssetVariant,
  type DraftAsset,
  type DraftAssets,
  type DraftBackground,
} from './draft';
import { Segmented } from './segmented';

export function Section({ title, hint, action, children }: { title: string; hint?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 shadow-xs">
      <header className="flex items-start gap-3">
        <div className="flex-1 space-y-0.5">
          <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
          {hint && <p className="text-xs leading-relaxed text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-medium text-muted-foreground">
      {label}
      {children}
      {error && <span className="font-normal text-destructive">{error}</span>}
    </label>
  );
}

const HEX = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i;
const toPickerValue = (value: string) => {
  const v = value.trim();
  if (!HEX.test(v)) return '#000000';
  return v.length === 4 ? `#${[...v.slice(1)].map((c) => c + c).join('')}` : v.toLowerCase();
};
const isColor = (value: string) => typeof CSS === 'undefined' || CSS.supports('color', value);

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const bad = !value.trim() || !isColor(value);
  return (
    <div className="flex items-center gap-3">
      <label className="relative size-8 shrink-0 cursor-pointer overflow-hidden rounded-md border shadow-xs transition-transform duration-200 ease-out-expo hover:scale-105" style={{ background: bad ? undefined : value }}>
        <input type="color" aria-label={`${label}取色`} value={toPickerValue(value)} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 size-full cursor-pointer opacity-0" />
      </label>
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <Input value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} aria-invalid={bad} spellCheck={false} className={cn('h-8 font-mono text-xs', bad && 'border-destructive focus-visible:ring-destructive/30')} />
    </div>
  );
}

export function PaletteEditor({
  mode,
  onMode,
  palette,
  onChange,
  onSuggest,
}: {
  mode: ThemeMode;
  onMode: (mode: ThemeMode) => void;
  palette: ThemePalette;
  onChange: (palette: ThemePalette) => void;
  onSuggest: () => void;
}) {
  const other = mode === 'light' ? '深色' : '浅色';
  return (
    <Section
      title="调色板"
      hint="浅色、深色各九个颜色，界面上的其他颜色都由它们派生。值可以是 hex、rgb() 或 oklch()。"
      action={<Segmented label="调色板模式" value={mode} onChange={onMode} options={[{ value: 'light', label: '浅色' }, { value: 'dark', label: '深色' }]} />}
    >
      <div className="flex flex-col gap-2">
        {PALETTE_FIELDS.map(({ key, label }) => (
          <ColorRow key={key} label={label} value={palette[key]} onChange={(value) => onChange({ ...palette, [key]: value })} />
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={onSuggest} className="self-start">
        <Sparkles />
        用这里的强调色生成{other}建议
      </Button>
    </Section>
  );
}

const ACCEPT = THEME_ASSET_EXTENSIONS.map((ext) => `.${ext}`).join(',');
const extOk = (name: string) => THEME_ASSET_EXTENSIONS.includes(name.slice(name.lastIndexOf('.') + 1).toLowerCase());

function useObjectUrl(blob: Blob | undefined) {
  const [url, setUrl] = React.useState<string>();
  React.useEffect(() => {
    if (!blob) return setUrl(undefined);
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

function AssetCell({ label, file, disabled, onFile }: { label: string; file?: AssetFile; disabled: boolean; onFile: (file: AssetFile | undefined) => void }) {
  const url = useObjectUrl(file?.blob);
  const input = React.useRef<HTMLInputElement>(null);
  const [over, setOver] = React.useState(false);
  const take = (picked: File | undefined) => {
    if (!picked) return;
    if (!extOk(picked.name)) return void toast.error(`${picked.name} 格式不支持`, { description: `只能用 ${THEME_ASSET_EXTENSIONS.join('、')}` });
    onFile({ name: picked.name, blob: picked });
  };
  return (
    <div className="flex min-w-0 flex-col items-center gap-1">
      <div className="relative flex w-full justify-center">
        <button
          type="button"
          disabled={disabled}
          title={disabled ? '先上传默认图' : file ? `${file.name}，点击替换` : `上传${label}图`}
          onClick={() => input.current?.click()}
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            if (!disabled) take(e.dataTransfer.files[0]);
          }}
          className={cn(
            'flex aspect-square w-full max-w-14 items-center justify-center overflow-hidden rounded-lg border bg-background outline-none transition-[border-color,background-color,transform] duration-200 ease-out-expo focus-visible:ring-[3px] focus-visible:ring-ring/50',
            !file && 'border-dashed text-muted-foreground hover:border-ring hover:text-foreground',
            over && 'scale-105 border-ring bg-accent',
            disabled && 'cursor-not-allowed opacity-40',
          )}
        >
          {url ? <img src={url} alt={label} className="size-full object-contain p-1" /> : <ImagePlus className="size-4" />}
        </button>
        <AnimatePresence>
          {file && (
            <motion.button
              type="button"
              aria-label={`清除${label}图`}
              onClick={() => onFile(undefined)}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.6 }}
              transition={{ duration: 0.12, ease: easeOut }}
              className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground shadow-xs transition-colors hover:text-foreground"
            >
              <X className="size-3" />
            </motion.button>
          )}
        </AnimatePresence>
        <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => (take(e.target.files?.[0]), (e.target.value = ''))} />
      </div>
      <span className="text-[11px] text-muted-foreground">{label}</span>
    </div>
  );
}

function VariantGrid({ asset, onChange }: { asset?: DraftAsset; onChange: (key: AssetVariant, file: AssetFile | undefined) => void }) {
  return (
    <div className="grid grid-cols-6 gap-1.5">
      {VARIANTS.map(({ key, label }) => (
        <AssetCell key={key} label={label} file={getVariant(asset, key)} disabled={key !== 'src' && !asset} onFile={(file) => onChange(key, file)} />
      ))}
    </div>
  );
}

function SlotCard({ slot, label, hint, asset, onChange }: { slot: ThemeAssetSlot; label: string; hint: string; asset?: DraftAsset; onChange: (key: AssetVariant, file: AssetFile | undefined) => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium">{label}</span>
        <code className="font-mono text-[11px] text-muted-foreground">{slot}</code>
      </div>
      <p className="-mt-1 text-xs text-muted-foreground">{hint}</p>
      <VariantGrid asset={asset} onChange={onChange} />
    </div>
  );
}

export function AssetsEditor({ assets, onChange }: { assets: DraftAssets; onChange: (assets: DraftAssets) => void }) {
  return (
    <Section
      title="角色素材"
      hint="每个位置先放一张默认图，再按需补变体：静帧用于减少动态效果和思考结束后，深色用于深色模式，三种状态图跟随会话状态切换。拖拽图片到格子里，或点击选择。"
    >
      <div className="flex flex-col gap-2">
        {SLOTS.map(({ slot, label, hint }) => (
          <SlotCard key={slot} slot={slot} label={label} hint={hint} asset={assets[slot]} onChange={(key, file) => onChange(setVariant(assets, slot, key, file))} />
        ))}
      </div>
    </Section>
  );
}

/** 文案与 EnsoCode 外观设置「背景图」一致；百分比显示与设置页同为 ×100，模糊是 px */
const SIZES: readonly { value: ThemeBackgroundSize; label: string }[] = [
  { value: 'cover', label: '覆盖' },
  { value: 'contain', label: '完整显示' },
  { value: 'repeat', label: '平铺' },
  { value: 'center', label: '居中原图' },
];

const SLIDERS: readonly { key: ThemeBackgroundParam; label: string; px?: boolean }[] = [
  { key: 'opacity', label: '背景可见度' },
  { key: 'blur', label: '模糊', px: true },
  { key: 'brightness', label: '亮度' },
  { key: 'saturation', label: '饱和度' },
  { key: 'mask', label: '遮罩' },
  { key: 'composerOpacity', label: '输入框不透明度' },
  { key: 'codeOpacity', label: '代码块不透明度' },
];

function SliderRow({ label, value, px, max, onChange }: { label: string; value: number; px?: boolean; max: number; onChange: (value: number) => void }) {
  const scale = px ? 1 : 100;
  const shown = Math.round(value * scale);
  return (
    <label className="flex items-center gap-3 text-xs text-muted-foreground">
      <span className="w-24 shrink-0">{label}</span>
      <input type="range" min={0} max={max * scale} step={1} value={shown} onChange={(e) => onChange(Number(e.target.value) / scale)} className="h-1.5 flex-1 cursor-pointer accent-primary" />
      <span className="w-12 shrink-0 text-right font-mono tabular-nums">
        {shown}
        {px ? 'px' : '%'}
      </span>
    </label>
  );
}

export function BackgroundEditor({ background, onChange }: { background?: DraftBackground; onChange: (background: DraftBackground | undefined) => void }) {
  return (
    <Section
      title="背景图"
      hint="铺满整个窗口的壁纸，面板会变成半透明。变体用法同角色素材，三种状态图跟随全局状态切换。用户在 EnsoCode 外观里自己开了背景图时，以用户的为准。"
    >
      <VariantGrid asset={background?.image} onChange={(key, file) => onChange(setBackgroundVariant(background, key, file))} />
      {background && (
        <div className="flex flex-col gap-2.5 pt-1">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span className="w-24 shrink-0">填充方式</span>
            <Segmented label="填充方式" value={background.size} onChange={(size) => onChange({ ...background, size })} options={SIZES} />
          </div>
          {SLIDERS.map(({ key, label, px }) => (
            <SliderRow key={key} label={label} px={px} max={THEME_BACKGROUND_PARAMS[key].max} value={background[key]} onChange={(value) => onChange({ ...background, [key]: value })} />
          ))}
        </div>
      )}
    </Section>
  );
}

export function CssEditor({ css, onChange }: { css: string; onChange: (css: string) => void }) {
  const [open, setOpen] = React.useState(!!css.trim());
  return (
    <section className="rounded-xl border bg-card shadow-xs">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 rounded-xl p-4 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
        <ChevronRight className={cn('size-4 text-muted-foreground transition-transform duration-200 ease-out-expo', open && 'rotate-90')} />
        <span className="flex-1 text-sm font-semibold tracking-tight">高级 CSS</span>
        {css.trim() && <span className="text-xs text-muted-foreground">已填写</span>}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2, ease: easeOut }} className="overflow-hidden">
            <div className="flex flex-col gap-2 px-4 pb-4">
              <p className="rounded-md border border-dashed bg-muted/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                可选。只用 <code className="font-mono">[data-enso="…"]</code> 锚点和主题变量。填写后，安装和更新时 EnsoCode 会单独请求「修改界面样式」同意。不要引用远程资源。
              </p>
              <textarea
                value={css}
                onChange={(e) => onChange(e.target.value)}
                spellCheck={false}
                rows={10}
                placeholder={'[data-enso="composer"] {\n  border-radius: 18px;\n}'}
                className="min-h-40 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 font-mono text-xs leading-relaxed shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

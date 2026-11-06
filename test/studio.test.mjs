import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readPackages } from '../scripts/lib.mjs';

// web/src 里的 TS 按 bundler 习惯省略扩展名，Node 需要补上 .ts 才能解析
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL?.includes('/web/src/') && !/\.[a-z]+$/.test(specifier)) {
      return next(`${specifier}.ts`, context);
    }
    return next(specifier, context);
  },
});

const { packDraft, zipStore } = await import('../web/src/studio/pack.ts');
const { emptyDraft } = await import('../web/src/studio/draft.ts');
const { draftFromPlugin, readZip } = await import('../web/src/studio/importTheme.ts');
const { parseThemeFile } = await import('../web/src/enso-theme/themeFile.ts');

const file = (name, text = name) => ({ name, blob: new Blob([text]) });

function draft() {
  return {
    ...emptyDraft(),
    id: 'demo.studio',
    name: '测试主题',
    author: 'tester',
    css: '[data-enso="composer"] { border-radius: 16px; }',
    assets: {
      thinking: {
        src: file('busy.webp'),
        still: file('busy-still.PNG'),
        dark: file('busy-dark.gif'),
        states: { running: file('run.webp'), error: file('oops.webp') },
      },
      'sidebar-footer': { src: file('lying.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>') },
    },
  };
}

async function unzipPackage(zip, id) {
  const root = await mkdtemp(join(tmpdir(), 'studio-'));
  const dir = join(root, 'packages', id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(root, 'out.zip'), zip);
  const result = spawnSync('unzip', ['-q', join(root, 'out.zip'), '-d', dir], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return { root, dir };
}

test('导出的 zip 解压后通过市场校验，主题 JSON 的素材完整', async (t) => {
  const packed = await packDraft(draft());
  assert.ok(packed.ok, packed.ok ? '' : packed.errors.join('\n'));
  const { root, dir } = await unzipPackage(zipStore(packed.files), 'demo.studio');
  t.after(() => rm(root, { recursive: true, force: true }));

  const { packages, errors } = await readPackages(root);
  assert.deepEqual(errors, []);
  assert.equal(packages.length, 1);
  const { manifest } = packages[0];
  assert.equal(manifest.engines.enso, '>=0.3.3');
  assert.deepEqual(manifest.contributes.themes, [
    { id: 'studio', name: '测试主题', path: 'themes/studio.json', css: 'themes/studio.css' },
  ]);
  assert.match(await readFile(join(dir, 'themes/studio.css'), 'utf8'), /border-radius: 16px/);

  const theme = parseThemeFile(JSON.parse(await readFile(join(dir, 'themes/studio.json'), 'utf8')));
  assert.ok(theme.ok);
  assert.deepEqual(theme.assets, {
    'sidebar-footer': { src: 'assets/sidebar-footer.svg' },
    thinking: {
      src: 'assets/thinking.webp',
      still: 'assets/thinking-still.png',
      dark: 'assets/thinking-dark.gif',
      states: { running: 'assets/thinking-running.webp', error: 'assets/thinking-error.webp' },
    },
  });
  const paths = Object.values(theme.assets).flatMap((a) => [a.src, a.still, a.dark, ...Object.values(a.states ?? {})]).filter(Boolean);
  for (const path of paths) assert.ok(existsSync(join(dir, 'themes', path)), `${path} 在包里`);
  assert.equal(await readFile(join(dir, 'themes/assets/thinking-running.webp'), 'utf8'), 'run.webp');
});

test('带背景图的草稿导出后主题 JSON 有完整 background，并能导入回草稿', async (t) => {
  const background = {
    image: { src: file('wall.JPG'), dark: file('wall-dark.webp'), states: { running: file('busy.webp') } },
    size: 'contain',
    opacity: 0.7,
    blur: 6,
    brightness: 0.9,
    saturation: 1.2,
    mask: 0.3,
    composerOpacity: 0.5,
    codeOpacity: 0.8,
  };
  const packed = await packDraft({ ...draft(), background });
  assert.ok(packed.ok, packed.ok ? '' : packed.errors.join('\n'));
  const { root, dir } = await unzipPackage(zipStore(packed.files), 'demo.studio');
  t.after(() => rm(root, { recursive: true, force: true }));

  const theme = parseThemeFile(JSON.parse(await readFile(join(dir, 'themes/studio.json'), 'utf8')));
  assert.ok(theme.ok);
  const { image: _, ...params } = background;
  assert.deepEqual(theme.background, {
    ...params,
    image: { src: 'assets/background.jpg', dark: 'assets/background-dark.webp', states: { running: 'assets/background-running.webp' } },
  });
  assert.equal(await readFile(join(dir, 'themes/assets/background-dark.webp'), 'utf8'), 'wall-dark.webp');

  const entries = await readZip(zipStore(packed.files));
  const back = await draftFromPlugin([...entries.keys()], async (path) => entries.get(path));
  assert.ok(back.ok);
  const { image, ...backParams } = back.draft.background;
  assert.deepEqual(backParams, params);
  assert.equal(await image.states.running.blob.text(), 'busy.webp');
});

test('没有 CSS 时清单不声明 css，也不需要样式同意', async () => {
  const packed = await packDraft({ ...draft(), css: '  ' });
  assert.ok(packed.ok);
  assert.ok(!packed.files.has('themes/studio.css'));
  const manifest = JSON.parse(new TextDecoder().decode(packed.files.get('enso-plugin.json')));
  assert.equal(manifest.contributes.themes[0].css, undefined);
});

test('不合法的草稿给出可读错误，不产出文件', async () => {
  const bad = { ...draft(), id: 'Bad Id', version: 'v1', light: { ...draft().light, accent: 'red; }' } };
  bad.assets = { ...bad.assets, welcome: { src: file('hello.txt') } };
  const packed = await packDraft(bad);
  assert.equal(packed.ok, false);
  assert.ok(packed.errors.some((e) => e.includes('插件 id')));
  assert.ok(packed.errors.some((e) => e.includes('版本号')));
  assert.ok(packed.errors.some((e) => e.includes('浅色「强调色」')));
  assert.ok(packed.errors.some((e) => e.includes('hello.txt')));
});

test('导出的 zip 能原样导入回草稿', async () => {
  const original = draft();
  const packed = await packDraft(original);
  assert.ok(packed.ok);
  const entries = await readZip(zipStore(packed.files));
  const result = await draftFromPlugin([...entries.keys()], async (path) => entries.get(path));
  assert.ok(result.ok, result.ok ? '' : result.error);
  const { draft: back } = result;
  assert.deepEqual([back.id, back.name, back.version, back.css?.trim()], [original.id, original.name, original.version, original.css]);
  assert.deepEqual(back.light, original.light);
  assert.deepEqual(back.dark, original.dark);
  assert.equal(await back.assets.thinking.states.error.blob.text(), 'oops.webp');
  assert.deepEqual(Object.keys(back.assets).sort(), ['sidebar-footer', 'thinking']);
  assert.deepEqual(Object.keys(back.assets.thinking).sort(), ['dark', 'src', 'states', 'still']);
});

test('能导入 deflate 压缩、带顶层目录的奶龙 zip', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'studio-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const zip = join(root, 'nailong.zip');
  const result = spawnSync('zip', ['-qr', zip, 'enso.nailong'], { cwd: new URL('../packages', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const entries = await readZip(new Uint8Array(await readFile(zip)));
  const imported = await draftFromPlugin([...entries.keys()], async (path) => entries.get(path));
  assert.ok(imported.ok, imported.ok ? '' : imported.error);
  assert.equal(imported.draft.id, 'enso.nailong');
  assert.equal(Object.keys(imported.draft.assets).length, 8);
  assert.equal(imported.draft.assets.thinking.still.name, 'busy-still.webp');
  assert.ok(imported.warnings.some((w) => w.includes('url()')), 'CSS 引用了槽位外的文件要提示');
});

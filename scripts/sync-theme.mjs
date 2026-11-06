import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repoRoot } from './lib.mjs';

/** 主题生成器原样使用的宿主纯模块；拍平到同一目录，只改相对 import */
export const THEME_FILES = {
  'src/shared/theme/types.ts': 'types.ts',
  'src/shared/theme/derive.ts': 'derive.ts',
  'src/shared/theme/tokensCss.ts': 'tokensCss.ts',
  'src/shared/theme/assets.ts': 'assets.ts',
  'src/shared/theme/themeFile.ts': 'themeFile.ts',
  'src/shared/theme/anchors.ts': 'anchors.ts',
  'src/shared/theme/builtinThemes.ts': 'builtinThemes.ts',
  'src/shared/accentColor.ts': 'accentColor.ts',
};

const IMPORT_REWRITES = [
  ["'../accentColor'", "'./accentColor'"],
  ["'./theme/types'", "'./types'"],
];

const HEADER = /^\/\/ 由 scripts\/sync-theme\.mjs 从 .*\n/;

export function transform(source) {
  return IMPORT_REWRITES.reduce((text, [from, to]) => text.replaceAll(from, to), source);
}

export const header = (rel, sha) => `// 由 scripts/sync-theme.mjs 从 enso-code/${rel}@${sha} 同步，勿手改\n`;

function ensoSha(dir) {
  const result = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : 'unknown';
}

/** 返回与 enso-code 当前内容不一致的副本（比对时忽略来源说明那一行） */
export async function staleThemeCopies(ensoDir, targetDir) {
  const stale = [];
  for (const [rel, name] of Object.entries(THEME_FILES)) {
    const target = join(targetDir, name);
    const expected = transform(await readFile(join(ensoDir, rel), 'utf8'));
    if (!existsSync(target) || (await readFile(target, 'utf8')).replace(HEADER, '') !== expected) stale.push(name);
  }
  return stale;
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const ensoDir = resolve(env.ENSO_CODE_DIR ?? join(repoRoot, '../enso-code'));
  const targetDir = join(repoRoot, 'web/src/enso-theme');
  if (!existsSync(join(ensoDir, 'src/shared/theme'))) throw new Error(`找不到 enso-code：${ensoDir}（用 ENSO_CODE_DIR 指定）`);
  if (argv.includes('--check')) {
    const stale = await staleThemeCopies(ensoDir, targetDir);
    if (stale.length > 0) throw new Error(`web/src/enso-theme 与 enso-code 不一致：${stale.join('、')}；运行 node scripts/sync-theme.mjs`);
    process.stdout.write('web/src/enso-theme 与 enso-code 一致\n');
    return;
  }
  const sha = ensoSha(ensoDir);
  await mkdir(targetDir, { recursive: true });
  for (const [rel, name] of Object.entries(THEME_FILES)) {
    const source = await readFile(join(ensoDir, rel), 'utf8');
    await writeFile(join(targetDir, name), header(rel, sha) + transform(source));
  }
  process.stdout.write(`已从 ${ensoDir}@${sha.slice(0, 9)} 同步 ${Object.keys(THEME_FILES).length} 个主题模块\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

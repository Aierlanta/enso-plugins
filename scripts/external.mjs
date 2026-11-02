// 把 registry/external/<id>.json 声明的外部插件按固定 commit 拉到 packages/<id>/
// { "repo": "owner/name", "commit": "<40 位 sha>", "path": "子目录" }
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ID_RE, repoRoot } from './lib.mjs';

export function parseExternal(raw, id) {
  const errors = [];
  if (!ID_RE.test(id) || id.length > 40) errors.push(`${id}: id 不合法`);
  if (typeof raw?.repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(raw.repo)) errors.push(`${id}: repo 必须是 owner/name`);
  if (typeof raw?.commit !== 'string' || !/^[0-9a-f]{40}$/.test(raw.commit)) errors.push(`${id}: commit 必须是完整 40 位 sha`);
  const path = raw?.path ?? '.';
  if (typeof path !== 'string' || path.startsWith('/') || path.includes('\\') || path.split('/').includes('..'))
    errors.push(`${id}: path 不合法`);
  return errors.length ? { errors } : { repo: raw.repo, commit: raw.commit, path };
}

export async function fetchExternals(root = repoRoot, fetchImpl = fetch) {
  const dir = join(root, 'registry', 'external');
  if (!existsSync(dir)) return [];
  const done = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    const id = file.slice(0, -5);
    const spec = parseExternal(JSON.parse(readFileSync(join(dir, file), 'utf8')), id);
    if (spec.errors) throw new Error(spec.errors.join('\n'));
    const target = join(root, 'packages', id);
    if (existsSync(target) && !existsSync(join(target, '.external'))) throw new Error(`${id}: packages/${id} 已存在，不能同时是外部插件`);
    const res = await fetchImpl(`https://codeload.github.com/${spec.repo}/tar.gz/${spec.commit}`);
    if (!res.ok) throw new Error(`${id}: 下载 ${spec.repo}@${spec.commit} 失败（HTTP ${res.status}）`);
    const tmp = mkdtempSync(join(tmpdir(), 'enso-ext-'));
    try {
      writeFileSync(join(tmp, 'src.tgz'), Buffer.from(await res.arrayBuffer()));
      execFileSync('tar', ['-xzf', 'src.tgz', '--no-same-owner'], { cwd: tmp });
      const top = readdirSync(tmp).find((n) => n !== 'src.tgz');
      const base = resolve(tmp, top);
      const source = resolve(base, spec.path);
      if (source !== base && !source.startsWith(base + sep)) throw new Error(`${id}: path 越界`);
      if (!existsSync(join(source, 'enso-plugin.json'))) throw new Error(`${id}: ${spec.path} 下没有 enso-plugin.json`);
      rmSync(target, { recursive: true, force: true });
      cpSync(source, target, { recursive: true, verbatimSymlinks: true });
      writeFileSync(join(target, '.external'), `${spec.repo}@${spec.commit}:${spec.path}\n`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    done.push(`${id} ← ${spec.repo}@${spec.commit.slice(0, 7)}/${spec.path}`);
  }
  return done;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const line of await fetchExternals()) console.log(line);
}

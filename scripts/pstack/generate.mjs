#!/usr/bin/env node
// 由 cursor/plugins 的 pstack 生成 packages/enso.pstack；做法沿用上游 scripts/generate-pstack-harness-trees.mjs
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const ID = 'enso.pstack';
const OUT = join(ROOT, 'packages', ID);
const ADAPTER = 'docs/harness/enso.md';
const GUIDE = 'docs/guide';
const GITHUB = 'https://github.com/cursor/plugins';
const COMMAND = 'node scripts/pstack/generate.mjs [--source <cursor-plugins>/pstack]';
const LINK = /\]\(([^)\s]+)\)/g;
const SKIP = /(^|\/)(node_modules|\.DS_Store)(\/|$)|\/scripts\/test(\/|$)|\.test\.ts$|\.test-helper\.ts$/;

const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};
const PSTACK = resolve(flag('--source') ?? join(ROOT, '..', 'cursor-plugins', 'pstack'));
const SKILLS = join(PSTACK, 'skills');
if (!existsSync(join(SKILLS, 'poteto-mode', 'SKILL.md'))) {
  console.log(`FAIL ${PSTACK} is not a pstack folder. Pass --source <cursor-plugins>/pstack.`);
  process.exit(1);
}

const TERMS = [
  { key: '`Task`', re: /`Task`|\bTask (tool|subagent|call)/ },
  { key: '`AskQuestion`', re: /AskQuestion/ },
  { key: 'todolist', re: /\btodo ?list\b/i },
  { key: 'generalPurpose', re: /generalPurpose/ },
  { key: 'poteto-agent', re: /poteto-agent/ },
  { key: 'comment-sicko', re: /comment-sicko/ },
  { key: '`readonly: true`', re: /readonly: (true|false)|readonly\/Ask/ },
  { key: '`environment: "cloud"`', re: /environment: "(cloud|local)"/ },
  { key: 'cloud_base_branch', re: /cloud_base_branch/ },
  { key: '`run_in_background: true`', re: /run_in_background/ },
  { key: '`resume`', re: /`resume`/ },
  { key: '`file_attachments`', re: /file_attachments/ },
  { key: 'claude-', re: /\bclaude-[a-z]+-\d/ },
  { key: 'grok-', re: /\bgrok-\d/ },
  { key: 'gpt-', re: /\bgpt-\d/ },
  { key: 'inherit-parent', re: /inherit-parent/ },
  { key: 'pstack-models.mdc', re: /pstack-models\.mdc/ },
  { key: '.cursor/skills/', re: /\.cursor\/skills/ },
  { key: '~/.cursor/plugins/', re: /\.cursor\/plugins|\.cursor-plugin/ },
  { key: '.cursor/rules/', re: /\.cursor\/rules|always-applied rule/ },
  { key: 'agent-transcripts', re: /agent-transcripts|\.cursor\/projects/ },
  { key: 'Cursor-only features', re: /Bugbot|Cursor [Aa]utomation|cursor\.(sh|com)\/automations|[Cc]loud [Aa]gent|built-in PR tool/ },
];
const ROUTE_KEY = 'Run another pstack skill';
// composer 预设：只在选中时加载 skills/poteto，系统提示词尾巴让顶层会话每个任务先走 poteto-mode
const PRESET = 'preset';
const PRESET_SKILL = 'skills/poteto';
const PRESET_TAIL = 'prompts/poteto.md';
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// 插件子代理的 systemPrompt 是正文文本：上游 frontmatter 用不上，也不知道 pstack 装在哪
const AGENTS = {
  'poteto-agent': {
    description:
      "Delegate subagent for code-writing and helper tasks spawned during a poteto-mode run, not the runner itself. Runs on the session model and cannot take a model; when the role names a model, spawn worker with that model instead and tell it to read pstack's agents/poteto-agent.md. Always put the absolute path of pstack's skills/poteto-mode/SKILL.md in the brief.",
    tools: 'all',
    replace: [
      [
        "search `~/.cursor/plugins/` for a file whose path ends in `skills/poteto-mode/SKILL.md`. If more than one file matches, use the copy whose `.cursor-plugin/plugin.json` has the highest `version`.",
        "search `extension-plugins/packages/enso.pstack/` in EnsoCode's app data folder (`~/Library/Application Support/enso-code/` on macOS) for a file whose path ends in `skills/poteto-mode/SKILL.md`. If more than one file matches, use the copy whose `enso-plugin.json` has the highest `version`.",
      ],
    ],
  },
  'comment-sicko': {
    description:
      'A deranged comment-hater that savors deletion and condemns workaround code. Deletes comments in the scoped files or diff and flags workaround code with MUST KILL; never writes application code. Runs on the session model and cannot take a model.',
    tools: 'all',
    replace: [],
  },
};
const AGENT_LINE =
  'In EnsoCode, read `docs/harness/enso.md` in the pstack folder once before you start. It maps the Cursor names in pstack to EnsoCode. ' +
  "The pstack folder holds `skills/poteto-mode/SKILL.md`. Use the path your parent gave you, else find it under `extension-plugins/packages/enso.pstack/` in EnsoCode's app data folder.";
const SKILL_LINE =
  `In EnsoCode, read [the EnsoCode adapter](../../${ADAPTER}) once per session before you follow this skill. ` +
  'It maps the Cursor names in pstack skills to EnsoCode.';

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (SKIP.test(relative(PSTACK, path))) return [];
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function file(path) {
  return { bytes: readFileSync(path), executable: (statSync(path).mode & 0o111) !== 0 };
}

const text = (bytes) => bytes.toString('utf8');
const frontmatter = (body) => body.match(/^---\n([\s\S]*?)\n---\n*/);
const skills = readdirSync(SKILLS)
  .filter((name) => existsSync(join(SKILLS, name, 'SKILL.md')))
  .sort();

function cursorNames(paths, others) {
  const route = new RegExp(`the \\*\\*(?<bold>${others})\\*\\* skill|\`/(?<command>${others})\``, 'g');
  const linksToSkill = (line, name) => line.includes(`(../${name}/`);
  const namesBareSkill = (line) =>
    [...line.matchAll(route)].some(({ groups }) => !linksToSkill(line, groups.bold ?? groups.command));
  const used = new Set();
  for (const path of paths) {
    const body = readFileSync(path, 'utf8');
    for (const term of TERMS) if (term.re.test(body)) used.add(term.key);
    if (body.split('\n').some(namesBareSkill)) used.add(ROUTE_KEY);
  }
  return used;
}

const problems = [];
const users = new Map();
const use = (owner, keys) => {
  for (const key of keys) users.set(key, [...(users.get(key) ?? []), owner]);
};
const wraps = new Map();
for (const skill of skills) {
  const dir = join(SKILLS, skill);
  const used = cursorNames(
    walk(dir).filter((path) => path.endsWith('.md')),
    skills.filter((name) => name !== skill).join('|')
  );
  const body = readFileSync(join(dir, 'SKILL.md'), 'utf8');
  const wrap = used.size > 0 && /^# /m.test(body);
  if (used.size > 0 && !wrap) problems.push(`skills/${skill}/SKILL.md uses Cursor names but has no H1`);
  wraps.set(skill, wrap);
  use(skill, used);
  const name = frontmatter(body)?.[1]
    .match(/^name:(.*)$/m)?.[1]
    .trim()
    .replace(/^(["'])(.*)\1$/, '$2');
  if (name !== skill) problems.push(`skills/${skill}/SKILL.md has name ${JSON.stringify(name ?? '')}, not ${skill}`);
  if (!SKILL_NAME.test(skill) || skill.length > 64) problems.push(`skills/${skill} is not a valid skill name`);
}
if (skills.includes(PRESET_SKILL.split('/')[1])) problems.push(`upstream now has ${PRESET_SKILL}, rename the preset skill`);
for (const agent of Object.keys(AGENTS)) {
  const path = join(PSTACK, 'agents', `${agent}.md`);
  if (!existsSync(path)) problems.push(`agents/${agent}.md is missing`);
  else use(`agents/${agent}`, cursorNames([path], skills.join('|')));
}
const adapter = readFileSync(join(HERE, 'enso.md'), 'utf8');
for (const [key, using] of users) {
  if (!adapter.includes(key)) problems.push(`EnsoCode adapter has no row for ${key}, used by ${using.join(', ')}`);
}

function resolveLink(from, href) {
  const target = href.replace(/[#?].*/, '');
  if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) return undefined;
  const path = posix.join(posix.dirname(from), target).replace(/\/$/, '');
  return existsSync(join(PSTACK, path)) ? path : undefined;
}

const has = (files, path) => files.has(path) || [...files.keys()].some((key) => key.startsWith(`${path}/`));

function upstream() {
  const plugin = JSON.parse(readFileSync(join(PSTACK, 'plugin.json'), 'utf8'));
  let commit = '';
  try {
    commit = execFileSync('git', ['-C', PSTACK, 'log', '-1', '--format=%H', '--', '.'], { encoding: 'utf8' }).trim();
  } catch {}
  return { version: plugin.version, commit };
}

function render() {
  const files = new Map(
    [
      ...walk(SKILLS),
      ...walk(join(PSTACK, GUIDE)).filter((path) => path.endsWith('.md')),
      join(PSTACK, 'README.md'),
      join(PSTACK, 'LICENSE'),
    ].map((path) => [relative(PSTACK, path), file(path)])
  );
  files.set(ADAPTER, { bytes: Buffer.from(adapter), executable: false });
  for (const path of [`${PRESET_SKILL}/SKILL.md`, PRESET_TAIL]) files.set(path, file(join(HERE, PRESET, path)));
  for (const [skill, wrap] of wraps) {
    const entry = files.get(`skills/${skill}/SKILL.md`);
    if (wrap) entry.bytes = Buffer.from(text(entry.bytes).replace(/^(# .*)\n+/m, `$1\n\n${SKILL_LINE}\n\n`));
  }
  for (const [agent, { replace }] of Object.entries(AGENTS)) {
    let body = readFileSync(join(PSTACK, 'agents', `${agent}.md`), 'utf8');
    body = body.slice(frontmatter(body)?.[0].length ?? 0);
    for (const [from, to] of replace) {
      if (!body.includes(from)) problems.push(`agents/${agent}.md no longer contains: ${from.slice(0, 60)}…`);
      body = body.replace(from, to);
    }
    if (!/^# /m.test(body)) problems.push(`agents/${agent}.md has no H1`);
    files.set(`agents/${agent}.md`, {
      bytes: Buffer.from(body.replace(/^(# .*)\n+/m, `$1\n\n${AGENT_LINE}\n\n`)),
      executable: false,
    });
  }
  const { version, commit } = upstream();
  const source = `${GITHUB}/tree/${commit || 'main'}/pstack`;
  const readme = files.get('README.md');
  readme.bytes = Buffer.from(
    `> EnsoCode 版 pstack，生成自 [cursor/plugins pstack ${version}](${source})，作者 Lauren Tan，MIT 协议。` +
      '在输入框选「pstack · poteto-mode」预设，每个任务都会先走 poteto-mode；也可以用 `/skill:poteto-mode` 单次开始。' +
      `Cursor 名称在 EnsoCode 里的对应见 [${ADAPTER}](${ADAPTER})。` +
      `不要手改，在 enso-plugins 仓库运行 \`${COMMAND}\` 重新生成。\n\n${text(readme.bytes)}`
  );
  for (const [path, entry] of files) {
    if (!path.endsWith('.md')) continue;
    entry.bytes = Buffer.from(
      text(entry.bytes).replace(LINK, (link, href) => {
        const target = resolveLink(path, href);
        if (!target || target.split('/')[0] === '..' || has(files, target)) return link;
        const kind = statSync(join(PSTACK, target)).isDirectory() ? 'tree' : 'blob';
        return `](${GITHUB}/${kind}/main/pstack/${target}${href.slice(href.search(/[#?]|$/))})`;
      })
    );
  }
  const previous = existsSync(join(OUT, 'enso-plugin.json'))
    ? JSON.parse(readFileSync(join(OUT, 'enso-plugin.json'), 'utf8')).version
    : '0.1.0';
  const manifest = {
    schemaVersion: 1,
    id: ID,
    name: 'pstack',
    version: previous,
    icon: 'icon.svg',
    description: `Lauren Tan 的 pstack ${version}（MIT）：poteto-mode 按任务挑选 playbook，配套 arena、interrogate、architect 等 ${skills.length} 个 skill 和工程原则，先深挖再并行。在输入框选「pstack · poteto-mode」预设，或用 /skill:poteto-mode 开始。`,
    permissions: [],
    contributes: {
      skills: [...skills.map((skill) => `skills/${skill}`), PRESET_SKILL],
      presets: [
        {
          id: 'poteto',
          name: 'pstack · poteto-mode',
          skills: [PRESET_SKILL],
          mcpServers: [],
          systemPromptTail: PRESET_TAIL,
        },
      ],
      agentTypes: Object.entries(AGENTS).map(([agent, { description, tools }]) => ({
        name: `pstack:${agent}`,
        description,
        systemPrompt: `agents/${agent}.md`,
        tools,
        skills: [],
      })),
    },
  };
  files.set('enso-plugin.json', { bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), executable: false });
  files.set('icon.svg', file(join(HERE, 'icon.svg')));
  return files;
}

const files = render();
for (const [path, entry] of files) {
  if (!path.endsWith('.md')) continue;
  for (const [, href] of text(entry.bytes).matchAll(LINK)) {
    const target = resolveLink(path, href);
    if (target && !has(files, target)) problems.push(`${path} links to ${href}, which is not in the package`);
  }
}
for (const problem of problems) console.log(`FAIL ${problem}`);
if (problems.length > 0) process.exit(1);

if (argv.includes('--check')) {
  const onDisk = new Map(existsSync(OUT) ? walk(OUT).map((path) => [relative(OUT, path), file(path)]) : []);
  const drifted = [...new Set([...files.keys(), ...onDisk.keys()])].sort().filter((path) => {
    const [want, have] = [files.get(path), onDisk.get(path)];
    return !want || !have || !want.bytes.equals(have.bytes) || want.executable !== have.executable;
  });
  for (const path of drifted.slice(0, 20)) console.log(`packages/${ID}/${path}`);
  if (drifted.length > 0) {
    console.log(`packages/${ID} is out of date. Run \`${COMMAND}\` and commit the result.`);
    process.exit(1);
  }
  console.log(`packages/${ID} is up to date.`);
} else {
  rmSync(OUT, { recursive: true, force: true });
  for (const [path, { bytes, executable }] of files) {
    mkdirSync(dirname(join(OUT, path)), { recursive: true });
    writeFileSync(join(OUT, path), bytes);
    chmodSync(join(OUT, path), executable ? 0o755 : 0o644);
  }
  const wrapped = [...wraps.values()].filter(Boolean).length;
  console.log(`${skills.length} skills, ${wrapped} SKILL.md files with the adapter line, ${files.size} files`);
}

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  activate,
  buildFixInChatMessage,
  combineUserInstructions,
  countChangedLines,
  formatFindingsTable,
  filterGeneratedFromPatch,
  parseFindingsFromText,
  parseGeneratedAttrs,
} from '../packages/enso.bugbot/main.mjs';

async function withTemp(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'bugbot-test-'));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function createHarness(dataDir, initialDraft = '') {
  const tools = {};
  const handlers = {};
  const commands = {};
  let draft = {
    text: initialDraft,
    hasReferences: false,
    generation: 'g1',
    rev: 'r1',
  };
  const draftCalls = [];
  const viewEvents = [];

  activate({
    dataDir,
    tools: { register: (name, fn) => (tools[name] = fn) },
    renderer: { handle: (name, fn) => (handlers[name] = fn) },
    commands: { register: (id, fn) => (commands[id] = fn) },
    composer: {
      readDraft: async () => ({ ...draft }),
      insertText: async (input) => {
        draftCalls.push({ op: 'insertText', input });
        draft = { ...draft, text: `${draft.text}${input.text}`, rev: 'r2' };
        return { rev: draft.rev };
      },
      replaceDraft: async (input) => {
        draftCalls.push({ op: 'replaceDraft', input });
        draft = { ...draft, text: input.text, rev: 'r2' };
        return { rev: draft.rev };
      },
    },
    ui: {
      view: {
        emit: async (name, data) => {
          viewEvents.push({ name, data });
        },
      },
    },
  });

  return { tools, handlers, commands, draftCalls, viewEvents, getDraft: () => draft };
}

test('纯函数：统计增删行、解析 linguist-generated 属性、合并 BUGBOT.md 与用户指令', () => {
  const diff = [
    'diff --git a/a.ts b/a.ts',
    '--- a/a.ts',
    '+++ b/a.ts',
    '@@ -1,2 +1,3 @@',
    '-const x = 1;',
    '+const x = 2;',
    '+const y = 3;',
  ].join('\n');
  assert.equal(countChangedLines(diff), 3);

  const generated = parseGeneratedAttrs(
    'dist/bundle.js: linguist-generated: true\nsrc/app.ts: linguist-generated: unspecified\ngen/out.ts: linguist-generated: set\n'
  );
  assert.deepEqual([...generated], ['dist/bundle.js', 'gen/out.ts']);

  const quoted = parseGeneratedAttrs(
    '"src/my file.ts": linguist-generated: true\n"\\344\\270\\255.ts": linguist-generated: set\n'
  );
  assert.ok(quoted.has('src/my file.ts'));
  assert.ok(quoted.has('中.ts'));

  const patch = [
    'diff --git "a/src/my file.ts" "b/src/my file.ts"',
    '+generated',
    'diff --git a/src/ok.ts b/src/ok.ts',
    '+export const ok = 1;',
  ].join('\n');
  const filtered = filterGeneratedFromPatch(patch, new Set(['src/my file.ts']));
  assert.doesNotMatch(filtered, /my file/);
  assert.match(filtered, /src\/ok\.ts/);

  const merged = combineUserInstructions(
    [{ path: '.cursor/BUGBOT.md', content: 'No floating promises.' }],
    'Check error paths.'
  );
  assert.equal(
    merged,
    'No floating promises.\n\n[EXTREMELY IMPORTANT] User instructions for this run:\nCheck error paths.'
  );
});

test('parseFindingsFromText 支持 Markdown 表与 <answer><bug> XML 并按严重度排序', () => {
  assert.deepEqual(parseFindingsFromText('Bugbot found no bugs'), []);
  assert.deepEqual(parseFindingsFromText('<answer></answer>'), []);

  const fromTable = parseFindingsFromText(
    [
      '| Severity | Location (file:line) | Finding |',
      '| --- | --- | --- |',
      '| low | src/b.ts:20 | Unused helper |',
      '| high | src/a.ts:10-14 | Null dereference on empty list |',
      '| medium | src/a.ts:5 | Race condition on state update |',
    ].join('\n')
  );
  assert.deepEqual(
    fromTable.map((f) => [f.severity, f.file, f.startLine, f.endLine]),
    [
      ['high', 'src/a.ts', 10, 14],
      ['medium', 'src/a.ts', 5, 5],
      ['low', 'src/b.ts', 20, 20],
    ]
  );

  const fromXml = parseFindingsFromText(
    `<answer>
      <bug>
        <severity>high</severity>
        <file>src/auth.ts</file>
        <start_line>42</start_line>
        <end_line>45</end_line>
        <description>Missing token expiry check</description>
      </bug>
    </answer>`
  );
  assert.equal(fromXml.length, 1);
  assert.equal(fromXml[0].file, 'src/auth.ts');
  assert.equal(fromXml[0].startLine, 42);
  assert.equal(fromXml[0].endLine, 45);
  assert.match(formatFindingsTable(fromXml), /\| high \| src\/auth\.ts:42-45 \| Missing token expiry check \|/);

  const mixed = [
    'Bugbot found no bugs',
    '<answer></answer>',
    '| Severity | Location (file:line) | Finding |',
    '| --- | --- | --- |',
    '| high | src/a.ts:3 | Real bug that mentions bugbot found no bugs |',
  ].join('\n');
  assert.equal(parseFindingsFromText(mixed).length, 1);
  assert.equal(parseFindingsFromText(mixed)[0].file, 'src/a.ts');
});

test('bugbot_prepare + bugbot_report + 面板交互（剔除 generated、10 行阈值、dismiss、Fix in Chat）', async () => {
  await withTemp(async (root) => {
    const dataDir = join(root, 'data');
    const repo = join(root, 'repo');
    await mkdir(join(repo, 'src'), { recursive: true });
    await mkdir(join(repo, 'dist'), { recursive: true });
    await mkdir(join(repo, '.cursor'), { recursive: true });

    const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
    git('init', '-b', 'main');
    git('config', 'user.name', 'john.doe');
    git('config', 'user.email', 'john.doe@company.com');

    await writeFile(join(repo, '.gitattributes'), 'dist/** linguist-generated=true\n');
    await writeFile(join(repo, '.cursor', 'BUGBOT.md'), 'Always verify array bounds.');
    await writeFile(join(repo, 'src', 'index.ts'), 'export const v = 1;\n');
    await writeFile(join(repo, 'dist', 'bundle.js'), 'console.log(1);\n');
    git('add', '.');
    git('commit', '-m', 'init');

    const { tools, handlers, commands, draftCalls, viewEvents, getDraft } = createHarness(dataDir);

    // 仅改动 2 行有效代码 + 20 行 generated 文件 → 过滤后不足 10 行，自动跳过
    await writeFile(join(repo, 'src', 'index.ts'), 'export const v = 2;\n');
    await writeFile(
      join(repo, 'dist', 'bundle.js'),
      Array.from({ length: 20 }, (_, i) => `console.log(${i});`).join('\n')
    );
    const skipped = await tools.bugbot_prepare(
      { mode: 'uncommitted_changes' },
      { projectRoot: repo, sessionId: 's1' }
    );
    assert.equal(skipped.details.skipped, true);
    assert.equal(skipped.details.reason, 'not_enough_changes');
    assert.match(skipped.content, /Not enough changes to review/);

    // 写入 >= 10 行有效改动后正常生成子代理提示词与 patch 文件
    const lines = Array.from({ length: 14 }, (_, i) => `export const item${i + 1} = ${i + 1};`);
    await writeFile(join(repo, 'src', 'index.ts'), `${lines.join('\n')}\n`);
    const prepared = await tools.bugbot_prepare(
      { mode: 'uncommitted_changes', customInstructions: 'Check off-by-one errors.' },
      { projectRoot: repo, sessionId: 's1' }
    );
    assert.equal(prepared.details.skipped, false);
    assert.match(prepared.content, /Full Repository Path:/);
    assert.match(prepared.content, /Diff: uncommitted changes/);
    assert.match(prepared.content, /Always verify array bounds\./);
    assert.match(
      prepared.content,
      /\[EXTREMELY IMPORTANT\] User instructions for this run:\nCheck off-by-one errors\./
    );
    assert.doesNotMatch(prepared.content, /dist\/bundle\.js/);

    // 记录 findings
    const report = await tools.bugbot_report(
      {
        runId: prepared.details.runId,
        rawText: [
          '| Severity | Location (file:line) | Finding |',
          '| --- | --- | --- |',
          '| low | src/index.ts:10 | Redundant constant |',
          '| high | src/index.ts:2-4 | Off-by-one boundary error |',
        ].join('\n'),
      },
      { projectRoot: repo, sessionId: 's1' }
    );
    assert.equal(report.details.counts.total, 2);
    assert.equal(report.details.counts.high, 1);
    assert.equal(viewEvents.at(-1).name, 'snapshot');
    assert.equal(viewEvents.at(-1).data.findings.length, 2);
    assert.equal(viewEvents.at(-1).data.sessionId, 's1');

    // 面板读取快照、Fix in Chat、忽略后 Fix All in Chat
    const snap = await handlers.getSnapshot({}, { projectRoot: repo, sessionId: 's1' });
    assert.equal(snap.findings.length, 2);
    assert.equal(snap.findings[0].severity, 'high');

    await handlers.fixInChat({ id: snap.findings[0].id }, { projectRoot: repo, sessionId: 's1' });
    assert.match(getDraft().text, /^Verify this issue exists and fix it:/);
    assert.match(getDraft().text, /Affected files:\n- src\/index\.ts \(lines 2-4\)/);
    assert.match(getDraft().text, /export const item2 = 2;/);
    assert.equal(draftCalls.at(-1).input.expectedRev, undefined);
    assert.deepEqual(draftCalls.at(-1).input.expect, { generation: 'g1', rev: 'r1' });
    const fixedSnap = await handlers.getSnapshot({}, { projectRoot: repo, sessionId: 's1' });
    assert.equal(fixedSnap.findings[0].fixed, true);
    assert.equal(fixedSnap.findings[1].fixed, undefined);

    await handlers.fixAllInChat({}, { projectRoot: repo, sessionId: 's1' });
    assert.match(getDraft().text, /Redundant constant/);
    assert.doesNotMatch(getDraft().text, /Off-by-one boundary error/);
    const allFixed = await handlers.getSnapshot({}, { projectRoot: repo, sessionId: 's1' });
    assert.equal(allFixed.findings.every((f) => f.fixed), true);

    const removed = await handlers.deleteFinding({ id: allFixed.findings[1].id }, { projectRoot: repo, sessionId: 's1' });
    assert.equal(removed.findings.length, 1);

    // /enso.bugbot:review 命令写入草稿
    await handlers.clearFindings({}, { projectRoot: repo, sessionId: 's1' });
    await commands.review({});
    assert.match(getDraft().text, /^\/skill:review-bugbot/);

    await handlers.promptReviewInChat({ mode: 'uncommitted_changes' });
    assert.match(getDraft().text, /\/skill:review-bugbot/);
    assert.match(getDraft().text, /mode: "uncommitted_changes"/);

    const sameReport = [
      '| Severity | Location (file:line) | Finding |',
      '| --- | --- | --- |',
      '| low | src/index.ts:10 | Redundant constant |',
      '| high | src/index.ts:2-4 | Off-by-one boundary error |',
    ].join('\n');
    await tools.bugbot_report({ runId: prepared.details.runId, rawText: sameReport }, { projectRoot: repo, sessionId: 's1' });
    const before = await handlers.getSnapshot({}, { projectRoot: repo, sessionId: 's1' });
    await handlers.dismissFinding({ id: before.findings[0].id, dismissed: true }, { projectRoot: repo, sessionId: 's1' });
    await tools.bugbot_report({ runId: prepared.details.runId, rawText: sameReport }, { projectRoot: repo, sessionId: 's1' });
    const after = await handlers.getSnapshot({}, { projectRoot: repo, sessionId: 's1' });
    assert.equal(after.findings[0].dismissed, true);
    assert.equal(after.findings[1].dismissed, false);
  });
});

test('branch diff 分开提交与工作区，且 diff 失败不会报成改动不足', async () => {
  await withTemp(async (root) => {
    const dataDir = join(root, 'data');
    const repo = join(root, 'repo');
    await mkdir(join(repo, 'src'), { recursive: true });
    const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
    git('init', '-b', 'main');
    git('config', 'user.name', 'john.doe');
    git('config', 'user.email', 'john.doe@company.com');
    await writeFile(join(repo, 'src', 'index.ts'), 'const a = 1;\n');
    git('add', '.');
    git('commit', '-m', 'base');
    git('checkout', '-b', 'feature');
    await writeFile(join(repo, 'src', 'index.ts'), 'const a = 1;\nconst b = 2;\n');
    git('add', '.');
    git('commit', '-m', 'add b');
    await writeFile(join(repo, 'src', 'index.ts'), 'const a = 1;\nconst c = 3;\n');
    await writeFile(join(repo, 'src', 'note.ts'), 'export const note = 1;\n');
    await writeFile(join(repo, 'src', 'big.ts'), 'x'.repeat(1024 * 1024 + 1));
    await writeFile(join(repo, 'src', 'bin.dat'), Buffer.from([0, 1, 2, 3]));

    const { tools } = createHarness(dataDir);
    const prepared = await tools.bugbot_prepare(
      { mode: 'branch_changes', baseBranch: 'main', minChangedLines: 1 },
      { projectRoot: repo }
    );
    assert.equal(prepared.details.skipped, false);
    assert.match(prepared.content, /const b = 2/);
    assert.match(prepared.content, /const c = 3/);
    assert.match(prepared.content, /export const note = 1/);
    assert.doesNotMatch(prepared.content, /x{200}/);
    assert.doesNotMatch(prepared.content, /bin\.dat/);

    const oneLine = await tools.bugbot_prepare(
      { mode: 'natural_language', changeDescription: 'only one line' },
      { projectRoot: repo }
    );
    assert.equal(oneLine.details.skipped, true);
    assert.equal(oneLine.details.changedLines, 1);

    const failed = await tools.bugbot_prepare({}, { projectRoot: join(root, 'not-a-repo') });
    assert.equal(failed.details.skipped, true);
    assert.equal(failed.details.reason, 'diff_failed');
    assert.doesNotMatch(failed.content, /Not enough changes/);
  });
});

test('buildFixInChatMessage 对不存在的文件追加 Related files (could not be opened)', async () => {
  await withTemp(async (repo) => {
    const msg = await buildFixInChatMessage(repo, {
      file: 'missing/file.ts',
      startLine: 7,
      endLine: 7,
      description: 'Broken import',
    });
    assert.match(msg, /Related files \(could not be opened\):\n- missing\/file\.ts \(line 7\)/);
  });
});

test('侧栏脚本能切换 diff 范围，并且不会调用不存在的 swapText', async () => {
  const html = await readFile(new URL('../packages/enso.bugbot/bugbot.html', import.meta.url), 'utf8');
  assert.equal(html.includes('swapText'), false);
  assert.match(html, /button\[data-mode\]/);
  assert.match(html, /addEventListener\(\s*'click'/);
  assert.match(html, /totalBadgeEl\.textContent/);
  assert.match(html, /snap\.sessionId !== boundSession/);
});

test('快照按会话隔离，别的会话 running 不会出现在这边', async () => {
  await withTemp(async (root) => {
    const dataDir = join(root, 'data');
    const repo = join(root, 'repo');
    const other = join(root, 'other');
    await mkdir(join(repo, 'src'), { recursive: true });
    await mkdir(join(other, 'src'), { recursive: true });
    const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
    for (const dir of [repo, other]) {
      git(dir, 'init', '-b', 'main');
      git(dir, 'config', 'user.name', 'john.doe');
      git(dir, 'config', 'user.email', 'john.doe@company.com');
      await writeFile(join(dir, 'src', 'index.ts'), 'const a = 1;\n');
      git(dir, 'add', '.');
      git(dir, 'commit', '-m', 'base');
      await writeFile(join(dir, 'src', 'index.ts'), 'const a = 1;\nconst b = 2;\n');
    }

    const { tools, handlers } = createHarness(dataDir);
    const mine = await tools.bugbot_prepare(
      { mode: 'uncommitted_changes', minChangedLines: 1 },
      { projectRoot: repo, sessionId: 's1' }
    );
    assert.equal(mine.details.skipped, false);
    const theirs = await tools.bugbot_prepare(
      { mode: 'uncommitted_changes', minChangedLines: 1 },
      { projectRoot: other, sessionId: 's2' }
    );
    assert.equal(theirs.details.skipped, false);

    const here = await handlers.getSnapshot({}, { projectRoot: repo, sessionId: 's1' });
    const there = await handlers.getSnapshot({}, { projectRoot: other, sessionId: 's2' });
    assert.equal(here.sessionId, 's1');
    assert.equal(here.status, 'running');
    assert.equal(here.projectRoot, repo);
    assert.equal(there.sessionId, 's2');
    assert.equal(there.projectRoot, other);
    assert.notEqual(here.runId, there.runId);
  });
});

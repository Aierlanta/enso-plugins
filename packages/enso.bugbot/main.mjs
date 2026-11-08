import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 };
const DEFAULT_MIN_CHANGED_LINES = 10;
const MAX_INLINE_DIFF_CHARS = 24_000;
const MAX_UNTRACKED_BYTES = 1024 * 1024;
const REVIEW_COMMAND = '/skill:review-bugbot';

function normalizeSeverity(raw) {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === 'critical' || s === 'high' || s === 'error' || s === 'p0' || s === 'p1') return 'high';
  if (s === 'low' || s === 'minor' || s === 'info' || s === 'nit' || s === 'p3') return 'low';
  return 'medium';
}

export function countChangedLines(diffText) {
  if (typeof diffText !== 'string' || !diffText) return 0;
  let count = 0;
  for (const line of diffText.split('\n')) {
    if (
      (line.startsWith('+') && !line.startsWith('+++')) ||
      (line.startsWith('-') && !line.startsWith('---'))
    ) {
      count += 1;
    }
  }
  return count;
}

export function parseGeneratedAttrs(checkAttrStdout) {
  const generated = new Set();
  if (typeof checkAttrStdout !== 'string' || !checkAttrStdout) return generated;
  for (const rawLine of checkAttrStdout.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^(.*?):\s*linguist-generated:\s*(\S+)$/i.exec(line);
    if (!match) continue;
    const filePath = unquoteGitPath(match[1]);
    const value = match[2];
    const v = value.toLowerCase();
    if (v === 'true' || v === 'set') {
      generated.add(filePath);
    }
  }
  return generated;
}

/** git 默认 core.quotePath 会给空格和非 ASCII 路径加 C 风格引号。 */
export function unquoteGitPath(raw) {
  const s = String(raw ?? '').trim();
  if (s.length < 2 || s[0] !== '"' || s.at(-1) !== '"') return s;
  const body = s.slice(1, -1);
  const bytes = [];
  let plain = '';
  const flush = () => {
    if (bytes.length === 0) return;
    plain += Buffer.from(bytes).toString('utf8');
    bytes.length = 0;
  };
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== '\\') {
      flush();
      plain += ch;
      continue;
    }
    const next = body[i + 1];
    if (next === undefined) break;
    i += 1;
    if (next >= '0' && next <= '7') {
      let oct = next;
      for (
        let k = 0;
        k < 2 && i + 1 < body.length && body[i + 1] >= '0' && body[i + 1] <= '7';
        k += 1
      ) {
        i += 1;
        oct += body[i];
      }
      bytes.push(Number.parseInt(oct, 8));
      continue;
    }
    flush();
    if (next === 'n') plain += '\n';
    else if (next === 't') plain += '\t';
    else if (next === '"' || next === '\\') plain += next;
    else plain += next;
  }
  flush();
  return plain;
}

function stripDiffPrefix(path) {
  return path.replace(/^[ab]\//, '');
}

export function parseDiffGitPaths(line) {
  if (!line.startsWith('diff --git ')) return null;
  const rest = line.slice('diff --git '.length);
  const tokens = [];
  for (let i = 0; i < rest.length; ) {
    if (rest[i] === ' ') {
      i += 1;
      continue;
    }
    if (rest[i] === '"') {
      let j = i + 1;
      while (j < rest.length) {
        if (rest[j] === '\\') {
          j += 2;
          continue;
        }
        if (rest[j] === '"') break;
        j += 1;
      }
      tokens.push(rest.slice(i, Math.min(rest.length, j + 1)));
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < rest.length && rest[j] !== ' ') j += 1;
    tokens.push(rest.slice(i, j));
    i = j;
  }
  if (tokens.length < 2) return null;
  return {
    fileA: stripDiffPrefix(unquoteGitPath(tokens[0])),
    fileB: stripDiffPrefix(unquoteGitPath(tokens[1])),
  };
}

export function filterGeneratedFromPatch(patchText, generatedFiles) {
  if (!patchText || !generatedFiles || generatedFiles.size === 0) return patchText || '';
  const lines = patchText.split('\n');
  const kept = [];
  let skipBlock = false;
  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const paths = parseDiffGitPaths(line);
      const fileA = paths?.fileA ?? '';
      const fileB = paths?.fileB ?? '';
      skipBlock = generatedFiles.has(fileA) || generatedFiles.has(fileB);
    }
    if (!skipBlock) kept.push(line);
  }
  return kept.join('\n').trim();
}

export function combineUserInstructions(rules, customInstructions) {
  const parts = [];
  if (Array.isArray(rules)) {
    for (const r of rules) {
      const content = typeof r?.content === 'string' ? r.content.trim() : '';
      if (content) parts.push(content);
    }
  }
  const extra = typeof customInstructions === 'string' ? customInstructions.trim() : '';
  if (extra) {
    parts.push(`[EXTREMELY IMPORTANT] User instructions for this run:\n${extra}`);
  }
  return parts.join('\n\n');
}

function parseLocationSpec(rawLocation) {
  const cleaned = String(rawLocation ?? '')
    .trim()
    .replace(/^`+|`+$/g, '');
  const m = /^(.+?):(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(cleaned);
  if (!m) {
    return {
      file: cleaned || 'unknown',
      startLine: 1,
      endLine: 1,
    };
  }
  const startLine = Math.max(1, Number.parseInt(m[2], 10) || 1);
  const endLine = Math.max(startLine, Number.parseInt(m[3] ?? m[2], 10) || startLine);
  return {
    file: m[1].trim(),
    startLine,
    endLine,
  };
}

function findingIdFor(item) {
  const key = `${item.severity}|${item.file}|${item.startLine}|${item.endLine}|${item.description}`;
  return `bug_${createHash('sha1').update(key).digest('hex').slice(0, 10)}`;
}

export function sortFindings(findings) {
  return [...findings].sort((a, b) => {
    const sa = SEVERITY_ORDER[a.severity] ?? 1;
    const sb = SEVERITY_ORDER[b.severity] ?? 1;
    if (sa !== sb) return sa - sb;
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return (a.startLine || 1) - (b.startLine || 1);
  });
}

export function parseFindingsFromText(rawText) {
  if (typeof rawText !== 'string' || !rawText.trim()) return [];
  const text = rawText.trim();

  const xmlBugs = [];
  const bugBlockRegex = /<bug\b[^>]*>([\s\S]*?)<\/bug>/gi;
  for (const match of text.matchAll(bugBlockRegex)) {
    const block = match[1];
    const pick = (tag) => {
      const m = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
      return m ? m[1].trim() : '';
    };
    const file = pick('file') || pick('path') || parseLocationSpec(pick('location')).file;
    const startLine = Number.parseInt(pick('start_line') || pick('line') || '1', 10) || 1;
    const endLine =
      Number.parseInt(pick('end_line') || String(startLine), 10) || Math.max(1, startLine);
    const title = pick('title');
    const description = pick('description') || pick('finding') || title;
    if (!file || !description) continue;
    const severity = normalizeSeverity(pick('severity') || 'medium');
    const item = {
      severity,
      file,
      startLine: Math.max(1, startLine),
      endLine: Math.max(startLine, endLine),
      title: title || description.slice(0, 80),
      description,
      dismissed: false,
    };
    xmlBugs.push({ ...item, id: findingIdFor(item) });
  }
  if (xmlBugs.length > 0) return sortFindings(xmlBugs);

  const tableBugs = [];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('|') || !line.endsWith('|')) continue;
    const cells = line
      .slice(1, -1)
      .split('|')
      .map((c) => c.trim());
    if (cells.length < 3) continue;
    if (cells.every((c) => /^[-:\s]+$/.test(c))) continue;
    if (/^severity$/i.test(cells[0]) && /location/i.test(cells[1])) continue;

    const severity = normalizeSeverity(cells[0].replace(/\*+/g, ''));
    const loc = parseLocationSpec(cells[1]);
    const description = cells.slice(2).join(' | ').trim();
    if (!loc.file || !description) continue;
    const item = {
      severity,
      file: loc.file,
      startLine: loc.startLine,
      endLine: loc.endLine,
      title: description.slice(0, 80),
      description,
      dismissed: false,
    };
    tableBugs.push({ ...item, id: findingIdFor(item) });
  }
  return sortFindings(tableBugs);
}

export function formatLocationLabel(finding) {
  const start = finding.startLine || 1;
  const end = finding.endLine || start;
  return end > start ? `${finding.file}:${start}-${end}` : `${finding.file}:${start}`;
}

export function formatAffectedFileBullet(finding) {
  const start = finding.startLine || 1;
  const end = finding.endLine || start;
  return end > start
    ? `- ${finding.file} (lines ${start}-${end})`
    : `- ${finding.file} (line ${start})`;
}

export function formatFindingsTable(findings) {
  const active = sortFindings((findings || []).filter(isOpenFinding));
  if (active.length === 0) return 'Bugbot found no bugs';
  const rows = [
    '| Severity | Location (file:line) | Finding |',
    '| --- | --- | --- |',
    ...active.map(
      (f) =>
        `| ${f.severity} | ${formatLocationLabel(f)} | ${String(f.description ?? '').replace(/\|/g, '\\|')} |`
    ),
  ];
  return rows.join('\n');
}

async function runGit(cwd, args) {
  return new Promise((resolvePromise) => {
    execFile(
      'git',
      ['--no-pager', ...args],
      {
        cwd,
        encoding: 'utf8',
        maxBuffer: 16 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err) {
          const tooBig =
            err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ||
            /maxBuffer/i.test(String(err.message ?? ''));
          resolvePromise({
            ok: false,
            tooBig,
            stdout: '',
            stderr:
              typeof stderr === 'string' && stderr
                ? stderr
                : String(err?.stderr ?? err?.message ?? err),
          });
          return;
        }
        resolvePromise({
          ok: true,
          stdout: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
        });
      }
    );
  });
}

async function resolveDefaultBaseBranch(cwd, explicitBase) {
  if (typeof explicitBase === 'string' && explicitBase.trim()) return explicitBase.trim();
  const originHead = await runGit(cwd, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  if (originHead.ok && originHead.stdout.trim()) {
    return originHead.stdout.trim();
  }
  for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
    const verify = await runGit(cwd, ['rev-parse', '--verify', '--quiet', candidate]);
    if (verify.ok && verify.stdout.trim()) return candidate;
  }
  return null;
}

async function readBugbotRules(cwd) {
  const candidates = ['.cursor/BUGBOT.md', '.enso/BUGBOT.md', 'BUGBOT.md'];
  const rules = [];
  for (const relPath of candidates) {
    try {
      const content = await readFile(join(cwd, relPath), 'utf8');
      if (content.trim()) {
        rules.push({ path: relPath, content: content.trim() });
      }
    } catch {
      // ignore absent rule file
    }
  }
  return rules;
}

async function buildUntrackedPatch(cwd, untrackedFiles) {
  const chunks = [];
  for (const relPath of untrackedFiles) {
    const chunk = await readUntrackedFile(cwd, relPath);
    if (chunk) chunks.push(chunk);
  }
  return chunks.join('\n\n');
}

async function readUntrackedFile(cwd, relPath) {
  let fh;
  try {
    const full = resolve(cwd, relPath);
    const relCheck = relative(cwd, full);
    if (relCheck.startsWith('..') || isAbsolute(relCheck)) return '';
    const info = await stat(full);
    if (!info.isFile() || info.size > MAX_UNTRACKED_BYTES) return '';
    fh = await open(full, 'r');
    const buf = Buffer.alloc(info.size);
    await fh.read(buf, 0, info.size, 0);
    if (buf.includes(0)) return '';
    const content = buf.toString('utf8');
    const lines = content.split('\n');
    if (lines.at(-1) === '') lines.pop();
    const body = lines.map((l) => `+${l}`).join('\n');
    const header = [
      `diff --git a/${relPath} b/${relPath}`,
      'new file mode 100644',
      '--- /dev/null',
      `+++ b/${relPath}`,
      `@@ -0,0 +1,${lines.length} @@`,
    ].join('\n');
    return body ? `${header}\n${body}` : header;
  } catch {
    return '';
  } finally {
    await fh?.close();
  }
}

function diffFailure(result) {
  if (result.tooBig) {
    return {
      error: 'diff_too_large',
      message: 'Diff is too large to review (git output exceeded 16MB and was truncated).',
    };
  }
  const detail = String(result.stderr || 'git diff failed').trim();
  return {
    error: 'diff_failed',
    message: `Failed to collect git diff: ${detail}`,
  };
}

function gitPaths(stdout) {
  return String(stdout ?? '')
    .split('\n')
    .map((line) => unquoteGitPath(line))
    .filter(Boolean);
}

async function gitDiffRange(cwd, contextLines, revs) {
  const diffRes = await runGit(cwd, [
    'diff',
    `--unified=${contextLines}`,
    '--no-color',
    '--find-renames',
    ...revs,
  ]);
  if (!diffRes.ok) return { ok: false, ...diffFailure(diffRes) };
  const nameRes = await runGit(cwd, ['diff', '--name-only', '--find-renames', ...revs]);
  if (!nameRes.ok) return { ok: false, ...diffFailure(nameRes) };
  return { ok: true, patch: diffRes.stdout, files: gitPaths(nameRes.stdout) };
}

async function collectLocalDiff(cwd, options = {}) {
  const requestedMode = options.mode || 'branch_changes';
  const includeUntracked = options.includeUntracked !== false;
  const contextLines = 10;

  if (requestedMode === 'natural_language') {
    const summary = String(options.changeDescription ?? '').trim();
    const changedLines = summary ? summary.split('\n').filter((line) => line.trim()).length : 0;
    return {
      effectiveMode: 'natural_language',
      baseBranch: null,
      patchText: summary,
      changedFiles: [],
      changedLines,
    };
  }

  let effectiveMode = requestedMode;
  let baseBranch = null;
  let mergeBase = null;

  if (requestedMode === 'branch_changes') {
    baseBranch = await resolveDefaultBaseBranch(cwd, options.baseBranch);
    if (baseBranch) {
      const mergeBaseRes = await runGit(cwd, ['merge-base', 'HEAD', baseBranch]);
      const headRev = await runGit(cwd, ['rev-parse', 'HEAD']);
      if (
        mergeBaseRes.ok &&
        headRev.ok &&
        mergeBaseRes.stdout.trim() &&
        mergeBaseRes.stdout.trim() !== headRev.stdout.trim()
      ) {
        mergeBase = mergeBaseRes.stdout.trim();
      } else if (!mergeBaseRes.ok || !headRev.ok) {
        return {
          ...diffFailure(mergeBaseRes.ok ? headRev : mergeBaseRes),
          effectiveMode,
          baseBranch,
          patchText: '',
          changedFiles: [],
          changedLines: 0,
        };
      } else {
        effectiveMode = 'uncommitted_changes';
      }
    } else {
      effectiveMode = 'uncommitted_changes';
    }
  }

  const ranges = mergeBase ? [[mergeBase, 'HEAD'], ['HEAD']] : [['HEAD']];
  const pieces = [];
  const trackedFiles = [];
  for (const revs of ranges) {
    const part = await gitDiffRange(cwd, contextLines, revs);
    if (!part.ok) {
      return {
        error: part.error,
        message: part.message,
        effectiveMode,
        baseBranch,
        patchText: '',
        changedFiles: [],
        changedLines: 0,
      };
    }
    if (part.patch.trim()) pieces.push(part.patch.trim());
    trackedFiles.push(...part.files);
  }

  let untrackedFiles = [];
  if (includeUntracked) {
    const untrackedRes = await runGit(cwd, ['ls-files', '--others', '--exclude-standard']);
    if (!untrackedRes.ok) {
      return {
        ...diffFailure(untrackedRes),
        effectiveMode,
        baseBranch,
        patchText: '',
        changedFiles: [],
        changedLines: 0,
      };
    }
    untrackedFiles = gitPaths(untrackedRes.stdout);
  }

  const allCandidateFiles = [...new Set([...trackedFiles, ...untrackedFiles])];
  let generatedSet = new Set();
  if (allCandidateFiles.length > 0) {
    const attrRes = await runGit(cwd, ['check-attr', 'linguist-generated', '--', ...allCandidateFiles]);
    if (!attrRes.ok) {
      return {
        ...diffFailure(attrRes),
        effectiveMode,
        baseBranch,
        patchText: '',
        changedFiles: [],
        changedLines: 0,
      };
    }
    generatedSet = parseGeneratedAttrs(attrRes.stdout);
  }

  const keptUntracked = untrackedFiles.filter((f) => !generatedSet.has(f));
  const filteredTrackedPatch = filterGeneratedFromPatch(pieces.join('\n\n'), generatedSet);
  const untrackedPatch =
    keptUntracked.length > 0 ? await buildUntrackedPatch(cwd, keptUntracked) : '';
  const combinedPatch = [filteredTrackedPatch, untrackedPatch].filter(Boolean).join('\n\n');
  const changedFiles = allCandidateFiles.filter((f) => !generatedSet.has(f));

  return {
    effectiveMode,
    baseBranch,
    patchText: combinedPatch,
    changedFiles,
    excludedGeneratedFiles: [...generatedSet],
    changedLines: countChangedLines(combinedPatch),
  };
}

export function buildBugbotSubagentUserPrompt({
  projectRoot,
  effectiveMode,
  baseBranch,
  changeDescription,
  userInstructions,
  patchFilePath,
  patchText,
}) {
  const lines = [`Full Repository Path: ${projectRoot}`];
  if (effectiveMode === 'natural_language') {
    lines.push('Diff: natural language');
    lines.push(`Change Description:\n${changeDescription || '(none)'}`);
  } else if (effectiveMode === 'branch_changes') {
    lines.push('Diff: branch changes');
    if (baseBranch) lines.push(`Base Branch: ${baseBranch}`);
  } else {
    lines.push('Diff: uncommitted changes');
  }
  if (patchFilePath) {
    lines.push(`Patch File: ${patchFilePath}`);
  }
  if (userInstructions) {
    lines.push(`Custom Instructions:\n${userInstructions}`);
  }
  if (patchText && effectiveMode !== 'natural_language') {
    const inline =
      patchText.length > MAX_INLINE_DIFF_CHARS
        ? `${patchText.slice(0, MAX_INLINE_DIFF_CHARS)}\n... [Diff truncated inline; read full patch from ${patchFilePath}]`
        : patchText;
    lines.push(`Unified Diff:\n\`\`\`diff\n${inline}\n\`\`\``);
  }
  return lines.join('\n\n');
}

async function readSnippetForFinding(projectRoot, finding) {
  if (!projectRoot || !finding?.file) return { exists: false, snippet: '' };
  const full = resolve(projectRoot, finding.file);
  const rel = relative(projectRoot, full);
  if (rel.startsWith('..') || isAbsolute(rel)) return { exists: false, snippet: '' };
  try {
    const content = await readFile(full, 'utf8');
    const allLines = content.split('\n');
    const start = Math.max(1, (finding.startLine || 1) - 2);
    const end = Math.min(allLines.length, (finding.endLine || finding.startLine || 1) + 2);
    const slice = allLines.slice(start - 1, end).join('\n');
    return { exists: true, snippet: slice };
  } catch {
    return { exists: false, snippet: '' };
  }
}

export async function buildFixInChatMessage(projectRoot, finding) {
  const { exists, snippet } = await readSnippetForFinding(projectRoot, finding);
  const parts = [`Verify this issue exists and fix it:\n\n${finding.description}`];
  if (exists) {
    parts.push(`Affected files:\n${formatAffectedFileBullet(finding)}`);
    if (snippet.trim()) {
      parts.push(`\`\`\`\n${snippet}\n\`\`\``);
    }
  } else {
    parts.push(`Related files (could not be opened):\n${formatAffectedFileBullet(finding)}`);
  }
  return parts.join('\n\n');
}

export async function buildFixAllInChatMessage(projectRoot, findings) {
  const active = sortFindings((findings || []).filter(isOpenFinding));
  if (active.length === 0) return '';
  const bugLines = active.map(
    (f, idx) => `Bug ${idx + 1} (${f.severity} · ${formatLocationLabel(f)}):\n${f.description}`
  );
  const affected = [];
  const unresolved = [];
  for (const f of active) {
    const { exists } = await readSnippetForFinding(projectRoot, f);
    if (exists) affected.push(formatAffectedFileBullet(f));
    else unresolved.push(formatAffectedFileBullet(f));
  }
  const parts = [`Verify these issues exist and fix them:\n\n${bugLines.join('\n\n')}`];
  if (affected.length > 0) {
    parts.push(`Affected files:\n${[...new Set(affected)].join('\n')}`);
  }
  if (unresolved.length > 0) {
    parts.push(`Related files (could not be opened):\n${[...new Set(unresolved)].join('\n')}`);
  }
  return parts.join('\n\n');
}

async function writeComposerPrompt(enso, text) {
  const draft = await enso.composer.readDraft();
  const trimmed = draft.text.trim();
  const isBugbotSeed =
    !trimmed ||
    trimmed.startsWith('Verify this issue exists and fix it:') ||
    trimmed.startsWith('Verify these issues exist and fix them:') ||
    trimmed.startsWith(REVIEW_COMMAND) ||
    trimmed.startsWith('/review-bugbot');
  if (isBugbotSeed && !draft.hasReferences) {
    return enso.composer.replaceDraft({
      expect: { generation: draft.generation, rev: draft.rev },
      text,
    });
  }
  return enso.composer.insertText({
    expect: { generation: draft.generation, rev: draft.rev },
    text: `\n\n${text}`,
  });
}

function scopeFrom(ctx) {
  const projectRoot = ctx?.projectRoot || process.cwd();
  const sessionId = typeof ctx?.sessionId === 'string' && ctx.sessionId ? ctx.sessionId : null;
  return {
    projectRoot,
    sessionId,
    key: sessionId ? `session:${sessionId}` : `project:${projectRoot}`,
  };
}

function stateFileForScope(dataDir, key) {
  const id = createHash('sha1').update(key).digest('hex').slice(0, 12);
  return join(dataDir, 'snapshots', `${id}.json`);
}

function emptySnapshot(scope) {
  return {
    runId: null,
    status: 'idle',
    projectRoot: scope.projectRoot,
    sessionId: scope.sessionId,
    effectiveMode: null,
    baseBranch: null,
    changedFiles: [],
    changedLines: 0,
    rulesLoaded: [],
    updatedAt: null,
    findings: [],
  };
}

async function loadScopedSnapshot(dataDir, scope) {
  const file = stateFileForScope(dataDir, scope.key);
  try {
    const snap = JSON.parse(await readFile(file, 'utf8'));
    return { ...snap, projectRoot: scope.projectRoot, sessionId: scope.sessionId };
  } catch {
    return emptySnapshot(scope);
  }
}

async function saveScopedSnapshot(dataDir, scope, snapshot) {
  const saved = { ...snapshot, projectRoot: scope.projectRoot, sessionId: scope.sessionId };
  const file = stateFileForScope(dataDir, scope.key);
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(saved, null, 2), 'utf8');
  await rename(tmp, file);
  return saved;
}

function keepDismissed(findings, prev) {
  const dismissed = new Set((prev?.findings || []).filter((f) => f.dismissed).map((f) => f.id));
  if (dismissed.size === 0) return findings;
  return findings.map((f) => (dismissed.has(f.id) ? { ...f, dismissed: true } : f));
}

function isOpenFinding(finding) {
  return !finding?.dismissed && !finding?.fixed;
}

function sameFinding(finding, payloadFinding) {
  if (!payloadFinding || typeof payloadFinding !== 'object') return false;
  return (
    finding.file === payloadFinding.file &&
    (finding.startLine || 1) === (payloadFinding.startLine || 1) &&
    (finding.endLine || finding.startLine || 1) ===
      (payloadFinding.endLine || payloadFinding.startLine || 1) &&
    finding.description === payloadFinding.description
  );
}

export function activate(enso) {
  let runSeq = 0;
  const snapshotTail = new Map();

  function withSnapshot(key, fn) {
    const prev = snapshotTail.get(key) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    snapshotTail.set(
      key,
      run.then(
        () => undefined,
        () => undefined
      )
    );
    return run;
  }

  async function commitSnapshot(scope, snapshot) {
    const saved = await saveScopedSnapshot(enso.dataDir, scope, snapshot);
    const emit = enso.ui?.view?.emit;
    if (typeof emit === 'function') {
      try {
        await emit('snapshot', saved);
      } catch {
        // 旧宿主没有这条通道，或事件被拒绝时，侧栏仍可手动刷新
      }
    }
    return saved;
  }

  enso.commands.register('review', async () => {
    await writeComposerPrompt(enso, `${REVIEW_COMMAND} `);
  });

  enso.tools.register('bugbot_prepare', async (args, ctx) => {
    const scope = scopeFrom(ctx);
    const projectRoot = scope.projectRoot;
    const minChangedLines =
      typeof args?.minChangedLines === 'number' && Number.isFinite(args.minChangedLines)
        ? Math.max(1, Math.floor(args.minChangedLines))
        : DEFAULT_MIN_CHANGED_LINES;
    const rules = await readBugbotRules(projectRoot);
    const diffInfo = await collectLocalDiff(projectRoot, {
      mode: args?.mode || 'branch_changes',
      baseBranch: args?.baseBranch,
      changeDescription: args?.changeDescription,
      includeUntracked: args?.includeUntracked !== false,
    });

    runSeq += 1;
    const runId = `run-${Date.now()}-${runSeq}`;

    if (diffInfo.error) {
      await withSnapshot(scope.key, () =>
        commitSnapshot(scope, {
          runId,
          status: 'skipped',
          reason: diffInfo.error,
          projectRoot,
          effectiveMode: diffInfo.effectiveMode,
          baseBranch: diffInfo.baseBranch,
          changedFiles: [],
          excludedGeneratedFiles: [],
          changedLines: 0,
          rulesLoaded: rules.map((r) => r.path),
          updatedAt: new Date().toISOString(),
          findings: [],
        })
      );
      return {
        content: diffInfo.message,
        details: {
          skipped: true,
          reason: diffInfo.error,
          runId,
          changedLines: 0,
          minChangedLines,
        },
      };
    }

    if (diffInfo.changedLines < minChangedLines) {
      const skippedSnapshot = {
        runId,
        status: 'skipped',
        reason: 'not_enough_changes',
        projectRoot,
        effectiveMode: diffInfo.effectiveMode,
        baseBranch: diffInfo.baseBranch,
        changedFiles: diffInfo.changedFiles,
        excludedGeneratedFiles: diffInfo.excludedGeneratedFiles || [],
        changedLines: diffInfo.changedLines,
        rulesLoaded: rules.map((r) => r.path),
        updatedAt: new Date().toISOString(),
        findings: [],
      };
      await withSnapshot(scope.key, () =>
        commitSnapshot(scope, skippedSnapshot)
      );
      return {
        content: `Not enough changes to review (${diffInfo.changedLines} changed lines < ${minChangedLines} minimum after filtering linguist-generated files).`,
        details: {
          skipped: true,
          reason: 'not_enough_changes',
          runId,
          changedLines: diffInfo.changedLines,
          minChangedLines,
          excludedGeneratedFiles: diffInfo.excludedGeneratedFiles || [],
        },
      };
    }

    const patchesDir = join(enso.dataDir, 'patches');
    await mkdir(patchesDir, { recursive: true });
    const patchFilePath = join(patchesDir, `${runId}.patch`);
    await writeFile(patchFilePath, diffInfo.patchText, 'utf8');

    const userInstructions = combineUserInstructions(rules, args?.customInstructions);
    const subagentPrompt = buildBugbotSubagentUserPrompt({
      projectRoot,
      effectiveMode: diffInfo.effectiveMode,
      baseBranch: diffInfo.baseBranch,
      changeDescription: args?.changeDescription,
      userInstructions,
      patchFilePath,
      patchText: diffInfo.patchText,
    });

    await withSnapshot(scope.key, () => commitSnapshot(scope, {
      runId,
      status: 'running',
      projectRoot,
      effectiveMode: diffInfo.effectiveMode,
      baseBranch: diffInfo.baseBranch,
      changedFiles: diffInfo.changedFiles,
      excludedGeneratedFiles: diffInfo.excludedGeneratedFiles || [],
      changedLines: diffInfo.changedLines,
      rulesLoaded: rules.map((r) => r.path),
      patchFilePath,
      updatedAt: new Date().toISOString(),
      findings: [],
    }));

    return {
      content: subagentPrompt,
      details: {
        skipped: false,
        runId,
        projectRoot,
        effectiveMode: diffInfo.effectiveMode,
        baseBranch: diffInfo.baseBranch,
        changedFiles: diffInfo.changedFiles,
        excludedGeneratedFiles: diffInfo.excludedGeneratedFiles || [],
        changedLines: diffInfo.changedLines,
        rulesLoaded: rules.map((r) => r.path),
        patchFilePath,
      },
    };
  });

  enso.tools.register('bugbot_report', async (args, ctx) => {
    const scope = scopeFrom(ctx);
    const projectRoot = scope.projectRoot;
    return withSnapshot(scope.key, async () => {
      const prev = await loadScopedSnapshot(enso.dataDir, scope);

      let findings = [];
      if (Array.isArray(args?.findings) && args.findings.length > 0) {
        findings = sortFindings(
          args.findings.map((f) => {
            const severity = normalizeSeverity(f.severity);
            const startLine = Math.max(1, Number(f.startLine) || 1);
            const endLine = Math.max(startLine, Number(f.endLine) || startLine);
            const item = {
              severity,
              file: String(f.file ?? 'unknown').trim(),
              startLine,
              endLine,
              title: String(f.title ?? f.description ?? '').trim().slice(0, 80),
              description: String(f.description ?? '').trim(),
              dismissed: false,
            };
            return { ...item, id: findingIdFor(item) };
          })
        );
      } else if (typeof args?.rawText === 'string') {
        findings = parseFindingsFromText(args.rawText);
      }
      findings = keepDismissed(findings, prev);

      const counts = {
        total: findings.length,
        high: findings.filter((f) => f.severity === 'high').length,
        medium: findings.filter((f) => f.severity === 'medium').length,
        low: findings.filter((f) => f.severity === 'low').length,
      };

      const nextSnapshot = {
        ...prev,
        runId: args?.runId || prev.runId || `run-${Date.now()}`,
        status: 'completed',
        projectRoot,
        updatedAt: new Date().toISOString(),
        findings,
        counts,
      };
      await commitSnapshot(scope, nextSnapshot);

      return {
        content: formatFindingsTable(findings),
        details: {
          runId: nextSnapshot.runId,
          status: 'completed',
          counts,
          findings,
        },
      };
    });
  });

  enso.renderer.handle('getSnapshot', async (_payload, ctx) => {
    return loadScopedSnapshot(enso.dataDir, scopeFrom(ctx));
  });

  enso.renderer.handle('dismissFinding', async (payload, ctx) => {
    const scope = scopeFrom(ctx);
    return withSnapshot(scope.key, async () => {
      const snap = await loadScopedSnapshot(enso.dataDir, scope);
      const id = String(payload?.id ?? '');
      const dismissed = payload?.dismissed !== false;
      snap.findings = (snap.findings || []).map((f) => (f.id === id ? { ...f, dismissed } : f));
      snap.updatedAt = new Date().toISOString();
      return commitSnapshot(scope, snap);
    });
  });

  enso.renderer.handle('fixInChat', async (payload, ctx) => {
    const scope = scopeFrom(ctx);
    const projectRoot = scope.projectRoot;
    return withSnapshot(scope.key, async () => {
      const snap = await loadScopedSnapshot(enso.dataDir, scope);
      const finding =
        (snap.findings || []).find((f) => f.id === payload?.id) ||
        (snap.findings || []).find((f) => sameFinding(f, payload?.finding)) ||
        (payload?.finding && typeof payload.finding === 'object' ? payload.finding : null);
      if (!finding) return { ok: false, error: 'Finding not found' };
      const text = await buildFixInChatMessage(projectRoot, finding);
      await writeComposerPrompt(enso, text);
      snap.findings = (snap.findings || []).map((f) =>
        f.id === finding.id || sameFinding(f, finding) ? { ...f, fixed: true } : f
      );
      snap.updatedAt = new Date().toISOString();
      const snapshot = await commitSnapshot(scope, snap);
      return { ok: true, text, snapshot };
    });
  });

  enso.renderer.handle('fixAllInChat', async (_payload, ctx) => {
    const scope = scopeFrom(ctx);
    const projectRoot = scope.projectRoot;
    return withSnapshot(scope.key, async () => {
      const snap = await loadScopedSnapshot(enso.dataDir, scope);
      const text = await buildFixAllInChatMessage(projectRoot, snap.findings || []);
      if (!text) return { ok: false, error: 'No active findings to fix' };
      await writeComposerPrompt(enso, text);
      snap.findings = (snap.findings || []).map((f) => (isOpenFinding(f) ? { ...f, fixed: true } : f));
      snap.updatedAt = new Date().toISOString();
      const snapshot = await commitSnapshot(scope, snap);
      return { ok: true, text, snapshot };
    });
  });

  enso.renderer.handle('promptReviewInChat', async (payload) => {
    const text =
      payload?.mode === 'uncommitted_changes'
        ? `${REVIEW_COMMAND}\n\nReview only uncommitted / dirty working-tree changes. Call bugbot_prepare with mode: "uncommitted_changes".`
        : `${REVIEW_COMMAND} `;
    await writeComposerPrompt(enso, text);
    return { ok: true, text };
  });

  enso.renderer.handle('clearFindings', async (_payload, ctx) => {
    const scope = scopeFrom(ctx);
    return withSnapshot(scope.key, async () => {
      const snap = await loadScopedSnapshot(enso.dataDir, scope);
      snap.findings = [];
      snap.status = 'idle';
      snap.updatedAt = new Date().toISOString();
      return commitSnapshot(scope, snap);
    });
  });

  enso.renderer.handle('deleteFinding', async (payload, ctx) => {
    const scope = scopeFrom(ctx);
    return withSnapshot(scope.key, async () => {
      const snap = await loadScopedSnapshot(enso.dataDir, scope);
      const id = String(payload?.id ?? '');
      snap.findings = (snap.findings || []).filter((f) => f.id !== id);
      snap.updatedAt = new Date().toISOString();
      return commitSnapshot(scope, snap);
    });
  });
}

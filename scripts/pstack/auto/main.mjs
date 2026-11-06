import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const FILE = 'state.json';
const LIMIT = 200;
const PREFIX = '/skill:poteto-mode ';

export function parseState(raw) {
  let json;
  try {
    json = JSON.parse(raw);
  } catch {
    return [];
  }
  const ids = Array.isArray(json?.on) ? json.on.filter((id) => typeof id === 'string' && id) : [];
  return [...new Set(ids)].slice(-LIMIT);
}

export function withSession(on, sessionId, enabled) {
  const next = on.filter((id) => id !== sessionId);
  if (enabled) next.push(sessionId);
  return next.slice(-LIMIT);
}

export function inputAction(on, ctx, data) {
  const text = data?.text;
  if (typeof text !== 'string' || ctx?.agent || !on.includes(ctx?.sessionId)) return undefined;
  const head = text.trimStart();
  if (/^\/skill:poteto-mode(?:\s|$)/.test(head)) return undefined;
  if (head.startsWith('/') && !head.startsWith('/skill:')) return undefined;
  return { action: 'transform', text: PREFIX + head };
}

async function readState(dir) {
  try {
    return parseState(await readFile(join(dir, FILE), 'utf8'));
  } catch {
    return [];
  }
}

async function writeState(dir, on) {
  await mkdir(dir, { recursive: true });
  const tmp = join(dir, `.${FILE}.${process.pid}.tmp`);
  await writeFile(tmp, `${JSON.stringify({ on })}\n`);
  await rename(tmp, join(dir, FILE));
}

export async function activate(enso) {
  const dir = typeof enso?.dataDir === 'string' ? enso.dataDir : '';
  let on = dir ? await readState(dir) : [];
  let queue = Promise.resolve();
  const commit = (sessionId, enabled) => {
    const run = queue.then(async () => {
      const current = on.includes(sessionId);
      const want = enabled(current);
      if (want !== current) {
        const next = withSession(on, sessionId, want);
        if (dir) await writeState(dir, next);
        on = next;
      }
      return { on: on.includes(sessionId) };
    });
    queue = run.catch(() => undefined);
    return run;
  };
  const sessionOf = (args) => (typeof args?.sessionId === 'string' ? args.sessionId : '');
  enso.renderer.handle('session', (args) => {
    const sessionId = sessionOf(args);
    if (!sessionId) return { on: false };
    return commit(sessionId, (current) => current && args.pstack === true);
  });
  enso.renderer.handle('toggle', (args) => {
    const sessionId = sessionOf(args);
    if (!sessionId) return { on: false };
    return commit(sessionId, (current) => !current && args.pstack === true);
  });
  enso.events.on('input', (data, ctx) => inputAction(on, ctx, data));
}

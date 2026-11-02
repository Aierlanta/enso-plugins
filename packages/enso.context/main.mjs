import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const KEEP_SESSIONS = 30;
const KEEP_HISTORY = 40;
const KINDS = ['system', 'tools', 'skills', 'memory', 'files', 'results', 'chat'];

const num = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');

// 旧宿主没有 parts：按分类合计拼成同形的七类，条目只有一项
function partsOf(data) {
  if (Array.isArray(data.parts)) {
    return data.parts
      .filter((p) => p && KINDS.includes(p.kind))
      .map((p) => ({
        kind: p.kind,
        tokens: num(p.tokens),
        items: (Array.isArray(p.items) ? p.items : []).slice(0, 24).map((it) => ({
          name: str(it?.name, 1024),
          tag: str(it?.tag, 32),
          ...(num(it?.n) > 1 ? { n: num(it.n) } : {}),
          tokens: num(it?.tokens),
        })),
      }));
  }
  const b = data.buckets ?? {};
  const one = (kind, tokens) => ({ kind, tokens, items: [] });
  return [
    one('system', num(b.system)),
    one('tools', num(b.tools)),
    one('skills', num(b.skills)),
    one('memory', num(b.instructions) + num(b.reminders)),
    one('chat', num(b.conversation) + num(b.compaction)),
  ].filter((p) => p.tokens > 0);
}

export function activate(enso) {
  const file = join(enso.dataDir, 'sessions.json');
  let cache = null;
  let chain = Promise.resolve();

  const load = async () => {
    if (cache) return cache;
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'));
      cache = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      cache = {};
    }
    return cache;
  };
  const save = async (all) => {
    await mkdir(enso.dataDir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(all));
    await rename(tmp, file);
  };
  const update = (fn) => (chain = chain.then(async () => save(fn(await load()))).catch(() => {}));

  enso.events.on('context_usage', (data, ctx) => {
    const id = ctx.sessionId;
    if (!id || ctx.agent || !data) return;
    const u = data.usage;
    const snap = {
      used: num(data.used),
      estimated: data.estimated === true,
      window: num(data.contextWindow),
      parts: partsOf(data),
      turns: num(data.turns),
      usage: u && {
        input: num(u.input),
        output: num(u.output),
        cacheRead: num(u.cacheRead),
        cacheWrite: num(u.cacheWrite),
      },
    };
    return update((all) => {
      const prev = all[id];
      const history = prev?.history ?? [];
      if (!snap.estimated && snap.used !== history.at(-1)) history.push(snap.used);
      all[id] = {
        ...snap,
        history: history.slice(-KEEP_HISTORY),
        at: Date.now(),
      };
      const ids = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
      for (const old of ids.slice(KEEP_SESSIONS)) delete all[old];
      return all;
    });
  });

  enso.renderer.handle('current', async (args, ctx) => {
    await chain;
    const s = ctx.sessionId ? (await load())[ctx.sessionId] : null;
    return s ? { id: ctx.sessionId, ...s } : null;
  });
}

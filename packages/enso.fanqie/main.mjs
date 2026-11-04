import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FanqieClient, normalizeBook } from './openfanqie/index.js';
import { PATHS } from './openfanqie/protocol/app.js';

// 单次返回的 JSON 控制在 40KB，留足 64KB UI 载荷上限的余量
const BUDGET = 40 * 1024;
const KEEP_COVERS = 300;
const KEEP_CHAPTERS = 600;
const KEEP_CATALOGS = 8;
const SHELF_MAX = 60;
const BOOK_TAB = 3;

const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const str = (v, n) => String(v ?? '').slice(0, n);
const int = (v) => Math.max(0, Math.floor(Number(v) || 0));
const digits = (v) => (/^\d{1,30}$/.test(String(v ?? '')) ? String(v) : '');

// cell 可以嵌套 cell_data，书都挂在 book_data 上
const collect = (cells, out = []) => {
  for (const cell of Array.isArray(cells) ? cells : []) {
    for (const b of cell?.book_data ?? []) out.push(normalizeBook(b));
    collect(cell?.cell_data, out);
  }
  return out;
};

const summary = (b) => ({
  id: b.bookId,
  title: b.title,
  author: b.author,
  abstract: b.abstract.slice(0, 300),
  cover: b.coverUrl,
  category: b.category,
  words: b.wordCount,
  score: b.score,
  finished: b.isFinished,
  reads: b.readCountText,
});
const books = (list) => {
  const seen = new Set();
  return list.filter((b) => b.bookId && b.title && !seen.has(b.bookId) && seen.add(b.bookId)).map(summary);
};

// 取下一批行，累计字节不超过预算（至少给一行）
const fit = (rows, from) => {
  let end = from;
  let size = 0;
  while (end < rows.length) {
    size += Buffer.byteLength(JSON.stringify(rows[end])) + 1;
    if (size > BUDGET && end > from) break;
    end++;
  }
  return end;
};

const friendly = (e) => {
  if (e?.name === 'ApiError') {
    const msg = String(e.message ?? '');
    return new Error(msg.startsWith('HTTP') ? `服务端返回 ${msg}` : `服务端拒绝请求（${e.code}${msg ? `：${msg}` : ''}）`);
  }
  if (e?.name === 'AbortError' || e?.name === 'TimeoutError') return new Error('请求超时，稍后再试');
  if (/fetch failed|ENOTFOUND|ECONNRE|ETIMEDOUT|EAI_AGAIN/.test(`${e?.message} ${e?.cause?.code ?? ''}`)) return new Error('网络请求失败');
  return e instanceof Error ? e : new Error(String(e));
};

export function activate(enso) {
  const coverDir = join(enso.dataDir, 'covers');
  const chapterDir = join(enso.dataDir, 'chapters');
  const shelfFile = join(enso.dataDir, 'shelf.json');
  const profilePath = join(enso.dataDir, 'device.json');
  let client = new FanqieClient({ profilePath });
  const catalogs = new Map();

  // 匿名设备用一阵后会被服务端限制：部分接口返回空响应（-1），正文接口返回 110 ERROR。
  // 两种情况都视为设备失效，换一台新设备重试一次。
  const stale = (e) => e?.name === 'ApiError' && (e.code === -1 || e.code === 110);
  const renew = async (used) => {
    if (client !== used) return;
    await rm(profilePath, { force: true });
    client = new FanqieClient({ profilePath });
  };
  const api = async (fn) => {
    const c = client;
    try {
      return await fn(c);
    } catch (e) {
      if (!stale(e)) throw friendly(e);
      await renew(c);
      return fn(client).catch((err) => Promise.reject(friendly(err)));
    }
  };

  const mall = (c, cur) => {
    const pairs = [
      ['tab_type', String(cur?.t ?? 0)],
      ['offset', String(cur?.o ?? 0)],
      ['tab_index', '0'],
      ['client_req_type', '3'],
    ];
    // 翻页必须带上首屏的 session_id，否则服务端报错
    if (cur?.s) pairs.push(['session_id', cur.s]);
    return c.get(PATHS.bookmallTab, pairs);
  };

  enso.renderer.handle('discover', (a) =>
    api(async (c) => {
      let cur = null;
      try {
        cur = a?.cursor ? JSON.parse(a.cursor) : null;
      } catch {}
      const data = await mall(c, cur).catch((e) => (cur ? mall(c, null) : Promise.reject(e)));
      const tab = data?.tab_item?.[0] ?? {};
      const more = (tab.has_more === true || tab.has_more === 1) && tab.session_id;
      // 一轮推荐翻完就重新要首屏，服务端每次都会换一批
      const cursor = more ? JSON.stringify({ t: tab.tab_type, o: tab.next_offset, s: tab.session_id }) : '';
      return { items: books(collect(tab.cell_data)), cursor, hasMore: true };
    })
  );

  enso.renderer.handle('search', (a) => {
    const q = str(a?.q, 100).trim();
    if (!q) return { items: [], hasMore: false };
    let cur = null;
    try {
      cur = a?.cursor ? JSON.parse(a.cursor) : null;
    } catch {}
    return api(async (c) => {
      const pairs = [
        ['query', q],
        ['offset', String(int(cur?.o))],
        ['count', '10'],
        ['tab_type', String(BOOK_TAB)],
        ['search_source', '1'],
        ['tab_name', 'feed'],
        ['user_is_login', '0'],
      ];
      // 只改 offset 会拿到同一页，翻页要回传 passback
      if (cur?.p != null) pairs.push(['passback', String(cur.p)]);
      const data = await c.get(PATHS.searchTab, pairs);
      const tabs = data?.search_tabs ?? [];
      const tab = tabs.find((t) => t.tab_type === BOOK_TAB) ?? {};
      const hasMore = Boolean(tab.has_more);
      const cursor = hasMore ? JSON.stringify({ o: tab.next_offset, p: tab.passback ?? tab.next_offset }) : '';
      return { items: books(collect(tab.data)), cursor, hasMore };
    });
  });

  // 目录可能上千章：首块带书籍信息和分卷，之后按字节分块，页面用 from 续取
  enso.renderer.handle('catalog', (a) =>
    api(async (c) => {
      const id = digits(a?.bookId);
      if (!id) throw new Error('缺少书籍');
      const from = int(a?.from);
      let entry = catalogs.get(id);
      if (!entry || from === 0) {
        const { book, chapters } = await c.catalog(id);
        if (!book) throw new Error('书籍不存在或已下架');
        const vols = [];
        chapters.forEach((ch, i) => {
          if (ch.volumeName && ch.volumeName !== vols.at(-1)?.[1]) vols.push([i, ch.volumeName.slice(0, 60)]);
        });
        entry = {
          book: {
            ...summary(book),
            abstract: book.abstract.slice(0, 3000),
            last: book.lastChapterTitle,
            tags: book.tags || book.categoryTags,
          },
          rows: chapters.map((ch) => [ch.itemId, ch.title.slice(0, 80)]),
          vols: vols.length > 1 ? vols : [],
        };
        catalogs.delete(id);
        catalogs.set(id, entry);
        while (catalogs.size > KEEP_CATALOGS) catalogs.delete(catalogs.keys().next().value);
      }
      const end = fit(entry.rows, from);
      const res = { total: entry.rows.length, rows: entry.rows.slice(from, end), next: end < entry.rows.length ? end : null };
      if (from === 0) Object.assign(res, { book: entry.book, vols: entry.vols });
      return res;
    })
  );

  const prune = async (dir, keep) => {
    const files = await readdir(dir).catch(() => []);
    const stats = await Promise.all(
      files.map(async (f) => ({ path: join(dir, f), at: (await stat(join(dir, f)).catch(() => null))?.mtimeMs ?? 0 }))
    );
    await Promise.all(stats.sort((x, y) => y.at - x.at).slice(keep).map((s) => rm(s.path, { force: true })));
  };

  // 正文落盘缓存；长章节按段落分块返回
  enso.renderer.handle('chapter', async (a) => {
    const bookId = digits(a?.bookId);
    const itemId = digits(a?.itemId);
    if (!bookId || !itemId) throw new Error('缺少章节');
    const file = join(chapterDir, sha1(`${bookId}/${itemId}`));
    let ch = await readFile(file, 'utf8').then(JSON.parse, () => null);
    if (ch) {
      const now = new Date();
      utimes(file, now, now).catch(() => {});
    } else {
      const r = await api((c) => c.chapter(bookId, itemId));
      if (!r.paragraphs.length) throw new Error('这一章暂时没有内容');
      ch = { title: r.title, paragraphs: r.paragraphs };
      await mkdir(chapterDir, { recursive: true });
      await writeFile(file, JSON.stringify(ch));
      prune(chapterDir, KEEP_CHAPTERS).catch(() => {});
    }
    const from = int(a?.at);
    const end = fit(ch.paragraphs, from);
    return { title: ch.title, paragraphs: ch.paragraphs.slice(from, end), next: end < ch.paragraphs.length ? end : null };
  });

  const which = (name) => {
    const dirs = [...(process.env.PATH ?? '').split(':'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
    for (const dir of dirs) if (dir && existsSync(join(dir, name))) return join(dir, name);
    return null;
  };

  const run = (bin, args, signal) =>
    new Promise((resolve, reject) => {
      const child = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'], signal });
      let err = '';
      child.stderr.on('data', (d) => (err = (err + d).slice(-2000)));
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `退出码 ${code}`))));
    });

  // 封面是 HEIC，Chromium 解不了：macOS 用 sips 转 JPEG，其它系统有 ffmpeg 就用 ffmpeg
  const toJpeg = async (url, signal) => {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const src = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type') ?? '';
    if (/image\/(jpeg|png|webp|gif)/.test(type)) return { mime: type.split(';')[0], data: src };
    const dir = await mkdtemp(join(tmpdir(), 'fq-cover-'));
    try {
      const input = join(dir, 'in');
      const output = join(dir, 'out.jpg');
      await writeFile(input, src);
      const ffmpeg = which('ffmpeg');
      if (process.platform === 'darwin') await run('/usr/bin/sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '60', '-Z', '240', input, '--out', output], signal);
      else if (ffmpeg) await run(ffmpeg, ['-loglevel', 'error', '-i', input, '-frames:v', '1', '-vf', 'scale=180:-2', '-q:v', '6', output], signal);
      else return null;
      return { mime: 'image/jpeg', data: await readFile(output) };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  // 永不抛错：封面失败不能触发 UI 熔断
  enso.renderer.handle('cover', async (a, ctx) => {
    const url = String(a?.url ?? '');
    if (!/^https:\/\//.test(url)) return null;
    const file = join(coverDir, sha1(url.split('?')[0]));
    try {
      return (await readFile(file, 'utf8')) || null;
    } catch {}
    try {
      const img = await toJpeg(url, ctx?.signal);
      if (!img?.data.length || img.data.length > 46 * 1024) return null;
      const uri = `data:${img.mime};base64,${img.data.toString('base64')}`;
      await mkdir(coverDir, { recursive: true });
      await writeFile(file, uri);
      prune(coverDir, KEEP_COVERS).catch(() => {});
      return uri;
    } catch (e) {
      console.warn('cover failed', e.message);
      return null;
    }
  });

  // 阅读记录放在主进程并落盘，各会话的侧栏实例共用。hist=出现在历史，fav=在书架
  let shelf = [];
  const loaded = readFile(shelfFile, 'utf8')
    .then(JSON.parse)
    .then((v) => (shelf = Array.isArray(v) ? v.map((x) => ({ hist: true, fav: false, ...x })) : []), () => {});
  let saveTimer = null;
  const persist = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try {
        await mkdir(enso.dataDir, { recursive: true });
        await writeFile(`${shelfFile}.tmp`, JSON.stringify(shelf));
        await rename(`${shelfFile}.tmp`, shelfFile);
      } catch (e) {
        console.warn('shelf save failed', e.message);
      }
    }, 500);
  };
  const entry = (e) => ({
    id: digits(e.id),
    title: str(e.title, 80),
    author: str(e.author, 40),
    cover: str(e.cover, 800),
    finished: Boolean(e.finished),
    total: int(e.total),
    index: int(e.index),
    itemId: digits(e.itemId),
    chapter: str(e.chapter, 80),
    ratio: Math.min(1, Math.max(0, Number(e.ratio) || 0)),
    at: int(e.at) || Date.now(),
    hist: Boolean(e.hist),
    fav: Boolean(e.fav),
  });
  // 超出上限时先丢最旧的非书架记录
  const cap = () => {
    while (shelf.length > SHELF_MAX) {
      const i = shelf.findLastIndex((x) => !x.fav);
      shelf.splice(i < 0 ? shelf.length - 1 : i, 1);
    }
  };
  const drop = () => (shelf = shelf.filter((x) => x.hist || x.fav));

  enso.renderer.handle('shelf', async (a) => {
    await loaded;
    let changed = false;
    if (a?.put && typeof a.put === 'object') {
      const e = entry({ ...a.put, hist: true });
      const prev = shelf.find((x) => x.id === e.id);
      if (e.id && !(prev && prev.at > e.at)) {
        e.fav = prev ? prev.fav : e.fav;
        shelf = [e, ...shelf.filter((x) => x.id !== e.id)];
        cap();
        changed = true;
      }
    }
    if (a?.fav && typeof a.fav === 'object') {
      const e = entry(a.fav);
      const prev = shelf.find((x) => x.id === e.id);
      if (prev) prev.fav = e.fav;
      else if (e.id && e.fav) shelf.push({ ...e, hist: false });
      drop();
      cap();
      changed = true;
    }
    if (a?.unhist) {
      const prev = shelf.find((x) => x.id === String(a.unhist));
      if (prev) prev.hist = false;
      drop();
      changed = true;
    }
    if (a?.clear === 'hist' || a?.clear === 'fav') {
      for (const x of shelf) x[a.clear] = false;
      drop();
      changed = true;
    }
    if (changed) persist();
    return a?.list ? shelf : { ok: true };
  });

  const usageOf = async (dir) => {
    const files = await readdir(dir).catch(() => []);
    const sizes = await Promise.all(files.map((f) => stat(join(dir, f)).then((s) => s.size, () => 0)));
    return { files: files.length, bytes: sizes.reduce((x, y) => x + y, 0) };
  };

  enso.renderer.handle('cache', async (a) => {
    if (a?.clear) {
      catalogs.clear();
      await Promise.all([rm(coverDir, { recursive: true, force: true }), rm(chapterDir, { recursive: true, force: true })]);
    }
    const [chapters, covers] = await Promise.all([usageOf(chapterDir), usageOf(coverDir)]);
    return { bytes: chapters.bytes + covers.bytes, chapters: chapters.files, covers: covers.files };
  });
}

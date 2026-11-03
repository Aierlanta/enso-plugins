import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  COMMANDS,
  chunkText,
  createPairing,
  emptyState,
  inboundText,
  markdownToHtml,
  markPending,
  mirrorTargets,
  pendingTargets,
  rootSession,
  route,
  takeReply,
} from './lib.mjs';

/** 每轮长轮询的等待；收到消息立即返回，空闲时最多这么久 */
const POLL_SECONDS = 25;
/** 轮询出错后退避，封顶 */
const BACKOFF_START_MS = 3_000;
const BACKOFF_MAX_MS = 60_000;
const PROGRESS_EVERY_MS = 3_000;
/** 给 HTML 标签留余量，转换后仍超 4096 时整段退回纯文本 */
const CHUNK = 3500;
const COMMANDS_VERSION = 2;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let stopped = false;
export function deactivate() {
  stopped = true;
}

/** options.loop=false 时不起常驻轮询，返回 tick() 供测试逐轮驱动 */
export function activate(enso, { loop = true } = {}) {
  stopped = false;
  const file = join(enso.dataDir, 'state.json');
  let chain = Promise.resolve();
  const locked = (fn) => {
    const p = chain.then(fn);
    chain = p.catch(() => {});
    return p;
  };
  const load = async () => {
    try {
      return { ...emptyState(), ...JSON.parse(await readFile(file, 'utf8')) };
    } catch {
      return emptyState();
    }
  };
  const save = async (state) => {
    await mkdir(enso.dataDir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(state, null, 2));
    await rename(tmp, file);
  };
  const update = (fn) =>
    locked(async () => {
      const state = await load();
      const result = await fn(state);
      await save(state);
      return result;
    });

  // ---- Bot API ----
  const api = async (method, body, retry = true) => {
    const { botToken } = await enso.config.get();
    if (!botToken) throw new Error('请先在插件设置里填写 Bot Token');
    const res = await enso.net.fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    let data;
    try {
      data = JSON.parse(res.body);
    } catch {
      throw new Error(`Telegram 返回 HTTP ${res.status}`);
    }
    const wait = data.parameters?.retry_after;
    if (!data.ok && res.status === 429 && retry && wait <= 30) {
      await sleep(wait * 1000);
      return api(method, body, false);
    }
    if (!data.ok) throw Object.assign(new Error(`Telegram：${data.description ?? res.status}`), { status: res.status });
    return data.result;
  };

  /** 先试富文本，解析失败或超长退回纯文本 */
  const deliver = async (chatId, text, editId) => {
    const html = markdownToHtml(text);
    const attempts = html.length <= 4096 ? [{ text: html, parse_mode: 'HTML' }, { text }] : [{ text }];
    let lastError;
    for (const body of attempts) {
      try {
        if (editId) return await api('editMessageText', { chat_id: chatId, message_id: editId, ...body });
        return await api('sendMessage', { chat_id: chatId, ...body });
      } catch (error) {
        lastError = error;
        if (error.status !== 400) break;
      }
    }
    if (editId) return deliver(chatId, text);
    throw lastError;
  };
  const send = async (chatId, text, editId) => {
    const parts = chunkText(text, CHUNK);
    for (const [i, part] of parts.entries()) await deliver(chatId, part, i === 0 ? editId : undefined);
  };
  const edit = (chatId, messageId, text) =>
    api('editMessageText', { chat_id: chatId, message_id: messageId, text }).catch(() => {});

  let bot;
  const identity = async () => {
    if (!bot) bot = await api('getMe', {});
    return bot;
  };

  const explain = (error) => {
    if (error?.code === 'PERMISSION_DENIED')
      return '没有授权：到 EnsoCode 设置 → 插件 → Telegram 打开“允许向任意运行中的会话发送消息”。';
    if (error?.code === 'INJECT_FAILED') return '绑定的会话没在运行，请在 EnsoCode 里打开它。';
    if (error?.code === 'RATE_LIMITED') return '发得太快了，稍后再试。';
    return `投递失败：${error?.message ?? error}`;
  };

  /** Bot API 只给文件路径，再从文件端点按二进制取回 */
  const downloadImage = async ({ fileId, mimeType }) => {
    const { file_path: path } = await api('getFile', { file_id: fileId });
    const { botToken } = await enso.config.get();
    const res = await enso.net.fetch(`https://api.telegram.org/file/bot${botToken}/${path}`, {
      responseType: 'base64',
    });
    if (res.status !== 200 || !res.body) throw new Error(`图片下载失败：HTTP ${res.status}`);
    return { data: res.body, mimeType };
  };

  // ---- 入站 ----
  const handle = async (action) => {
    if (action.kind === 'reply') return send(action.chatId, action.text);
    if (action.kind === 'stop') {
      try {
        await enso.session.abort(action.sessionId);
        return send(action.chatId, '⏹ 已停止当前任务。');
      } catch (error) {
        if (error?.code === 'ABORT_FAILED') return send(action.chatId, '没有正在运行的任务。');
        if (error?.code === 'UNSUPPORTED' || error?.code === 'INVALID_ARGS' || /session\.abort/.test(error?.message))
          return send(action.chatId, '当前 EnsoCode 版本不支持远程停止，请升级。');
        return send(action.chatId, explain(error));
      }
    }
    if (action.kind === 'bound')
      return send(action.chatId, '✅ 已绑定到 EnsoCode 会话，直接发消息即可。/help 查看用法。');
    if (action.kind !== 'inject') return;
    let images;
    if (action.image) {
      try {
        images = [await downloadImage(action.image)];
      } catch (error) {
        return send(action.chatId, `图片没收到：${error?.message ?? error}`);
      }
    }
    const steer = action.deliverAs === 'steer';
    const placeholder = await api('sendMessage', {
      chat_id: action.chatId,
      text: steer ? '↪️ 已插入当前任务' : '⏳ 已收到，处理中…',
      reply_parameters: { message_id: action.messageId, allow_sending_without_reply: true },
    }).catch(() => null);
    await update((state) => {
      const existing = pendingTargets(state, action.sessionId).find((t) => t.chatId === action.chatId);
      // 插话并入正在进行的那一轮，沿用它的占位消息
      if (!(steer && existing))
        markPending(state, action.sessionId, { chatId: action.chatId, placeholderId: placeholder?.message_id });
    });
    try {
      await enso.session.inject({
        sessionId: action.sessionId,
        text: inboundText(action),
        ...(images ? { images } : {}),
        deliverAs: action.deliverAs,
        triggerTurn: true,
      });
    } catch (error) {
      await update((state) => {
        state.pending[rootSession(action.sessionId)] = pendingTargets(state, action.sessionId).filter(
          (t) => t.chatId !== action.chatId
        );
      });
      if (placeholder) await edit(action.chatId, placeholder.message_id, explain(error));
      else await send(action.chatId, explain(error));
    }
  };

  const pollOnce = (seconds, me) =>
    locked(async () => {
      const state = await load();
      if (state.commandsVersion !== COMMANDS_VERSION) {
        await api('setMyCommands', { commands: COMMANDS }).catch(() => {});
        state.commandsVersion = COMMANDS_VERSION;
        await save(state);
      }
      const updates = await api('getUpdates', {
        offset: state.offset,
        timeout: seconds,
        allowed_updates: ['message'],
      });
      const actions = [];
      for (const u of updates) {
        state.offset = Math.max(state.offset, u.update_id + 1);
        actions.push(route(state, u, Date.now(), me));
      }
      // 先落盘 offset，处理失败也不会重复投递
      if (updates.length) await save(state);
      return actions;
    });

  /** 常驻轮询：Telegram 长轮询收到消息就返回，所以延迟只是网络往返 */
  const tick = async (seconds = POLL_SECONDS) => {
    const { botToken } = await enso.config.get();
    if (!botToken) return false;
    const actions = await pollOnce(seconds, await identity());
    for (const action of actions)
      await handle(action).catch((error) => console.error('[telegram]', error?.message ?? error));
    return true;
  };
  const pollLoop = async () => {
    let backoff = BACKOFF_START_MS;
    while (!stopped) {
      try {
        if (!(await tick())) await sleep(5_000);
        backoff = BACKOFF_START_MS;
      } catch (error) {
        console.error('[telegram] 轮询失败，', Math.round(backoff / 1000), '秒后重试：', error?.message ?? error);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
      }
    }
  };
  if (loop) void pollLoop();

  // ---- 出站 ----
  const progress = new Map();
  enso.events.on('tool_call', async (data, ctx) => {
    if (!ctx?.sessionId) return;
    const key = rootSession(ctx.sessionId);
    const entry = progress.get(key) ?? { steps: 0, at: 0 };
    entry.steps += 1;
    progress.set(key, entry);
    if (Date.now() - entry.at < PROGRESS_EVERY_MS) return;
    entry.at = Date.now();
    const targets = pendingTargets(await load(), key).filter((t) => t.placeholderId);
    const who = ctx.agent ? `${ctx.agent.name} · ` : '';
    for (const t of targets)
      await edit(t.chatId, t.placeholderId, `⏳ 处理中…（第 ${entry.steps} 步：${who}${data?.toolName ?? '工具'}）`);
  });

  enso.events.on('agent_end', async (data, ctx) => {
    if (!ctx?.sessionId || ctx.agent) return;
    const text = String(data?.text ?? '').trim();
    const reply = await update((state) => takeReply(state, ctx.sessionId, text));
    progress.delete(rootSession(ctx.sessionId));
    const answered = [];
    for (const t of reply?.targets ?? []) {
      await send(t.chatId, reply.text, t.placeholderId).catch((e) => console.error('[telegram]', e.message));
      answered.push(t.chatId);
    }
    if (!text) return;
    for (const chatId of mirrorTargets(await load(), ctx.sessionId, answered))
      await send(chatId, text).catch((e) => console.error('[telegram]', e.message));
  });

  enso.events.on('input', async (data, ctx) => {
    if (!ctx?.sessionId || ctx.agent || data?.source === 'extension') return;
    const text = String(data?.text ?? '').trim();
    if (!text) return;
    for (const chatId of mirrorTargets(await load(), ctx.sessionId))
      await send(chatId, `💬 EnsoCode：${text}`).catch(() => {});
  });

  // ---- 侧栏 ----
  const view = async (sessionId) => {
    const { botToken } = await enso.config.get();
    if (!botToken) return { configured: false };
    let me = null;
    let error = null;
    try {
      me = await identity();
    } catch (e) {
      error = e?.message ?? String(e);
    }
    const state = await load();
    const root = sessionId ? rootSession(sessionId) : null;
    const now = Date.now();
    const pairing = root && state.pairings.find((p) => p.sessionId === root && p.expiresAt > now);
    return {
      configured: true,
      bot: me && { username: me.username, name: me.first_name },
      error,
      sessionId: root,
      pairing: pairing && { code: pairing.code, expiresAt: pairing.expiresAt, link: link(me, pairing.code) },
      bindings: root ? state.bindings.filter((b) => b.sessionId === root) : [],
      others: state.bindings.filter((b) => b.sessionId !== root).length,
    };
  };
  const link = (me, code) => (me?.username ? `https://t.me/${me.username}?start=${code}` : null);
  const needSession = (ctx) => {
    if (!ctx?.sessionId) throw new Error('请先打开一个会话');
    return rootSession(ctx.sessionId);
  };

  enso.renderer.handle('state', (_args, ctx) => view(ctx?.sessionId));
  enso.renderer.handle('pair', async (_args, ctx) => {
    const sessionId = needSession(ctx);
    await update((state) => createPairing(state, sessionId, Date.now()));
    return view(sessionId);
  });
  enso.renderer.handle('unbind', async (args, ctx) => {
    const sessionId = needSession(ctx);
    const removed = await update((state) => {
      const hit = state.bindings.find((b) => b.chatId === args?.chatId && b.sessionId === sessionId);
      if (!hit) return null;
      state.bindings = state.bindings.filter((b) => b !== hit);
      const pending = pendingTargets(state, sessionId).filter((t) => t.chatId !== hit.chatId);
      if (pending.length) state.pending[sessionId] = pending;
      else delete state.pending[sessionId];
      return hit;
    });
    if (removed) await send(removed.chatId, '已在 EnsoCode 里解绑。').catch(() => {});
    return view(sessionId);
  });
  enso.renderer.handle('sync', async (args, ctx) => {
    const sessionId = needSession(ctx);
    await update((state) => {
      const hit = state.bindings.find((b) => b.chatId === args?.chatId && b.sessionId === sessionId);
      if (hit) hit.sync = args?.on === true;
    });
    return view(sessionId);
  });
  enso.renderer.handle('open', async (args) => {
    if (typeof args?.url === 'string' && args.url.startsWith('https://t.me/')) await enso.ui.openExternal(args.url);
    return null;
  });

  enso.tools.register('telegram_reply', async (args, ctx) => {
    const text = String(args?.text ?? '').trim();
    if (!text) throw new Error('text 不能为空');
    if (!ctx.sessionId) throw new Error('调用不属于任何会话');
    const sessionId = rootSession(ctx.sessionId);
    const chats = (await load()).bindings.filter((b) => b.sessionId === sessionId);
    if (!chats.length) throw new Error('本会话没有绑定 Telegram 聊天');
    for (const chat of chats) await send(chat.chatId, text);
    return `已发送到 ${chats.length} 个 Telegram 聊天`;
  });
  return { tick };
}

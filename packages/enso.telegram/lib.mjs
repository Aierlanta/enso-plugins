const PAIR_TTL_MS = 10 * 60_000;
const MAX_PAIRINGS = 5;
const IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
/** Telegram 下载上限 20MB；宿主单次响应 5MB */
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const MEDIA = ['photo', 'document', 'voice', 'video', 'audio', 'sticker', 'video_note', 'animation'];

export const COMMANDS = [
  { command: 'help', description: '查看用法' },
  { command: 'status', description: '查看绑定状态' },
  { command: 'steer', description: '向正在运行的任务插话' },
  { command: 'stop', description: '停止正在运行的任务' },
  { command: 'sync', description: '开关 EnsoCode 对话同步（on / off）' },
  { command: 'unbind', description: '解除绑定' },
];

const HELP = [
  '直接发消息即可交给 EnsoCode 会话，回复会自动发回这里。',
  '/steer <内容>：插入正在运行的任务',
  '/stop：停止正在运行的任务',
  '可以直接发图片（附文字说明更好）。',
  '/sync on|off：把 EnsoCode 里的对话也同步到这里',
  '/status：查看绑定',
  '/unbind：解除绑定',
  '群聊里请 @机器人 或回复机器人的消息。',
].join('\n');

export const emptyState = () => ({ offset: 0, bindings: [], pairings: [], pending: {} });

export const rootSession = (id) => String(id).split('::')[0];

export function chunkText(text, size = 4000) {
  const parts = [];
  let rest = String(text ?? '').trim();
  while (rest.length > size) {
    const cut = rest.lastIndexOf('\n', size);
    const at = cut > size / 2 ? cut : size;
    parts.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 模型常用的 Markdown 子集转 Telegram HTML；不认识的写法按原文转义 */
export function markdownToHtml(md) {
  const slots = [];
  const hold = (html) => `\u0000${slots.push(html) - 1}\u0000`;
  let text = String(md ?? '')
    .replace(/```([\w+-]*)\n?([\s\S]*?)```/g, (_, lang, code) =>
      hold(
        `<pre><code${lang ? ` class="language-${lang}"` : ''}>${escapeHtml(code.replace(/\n$/, ''))}</code></pre>`
      )
    )
    .replace(/`([^`\n]+)`/g, (_, code) => hold(`<code>${escapeHtml(code)}</code>`));
  text = escapeHtml(text)
    .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
    .replace(/(?:^&gt; ?.*(?:\n|$))+/gm, (block) => {
      const body = block.replace(/\n$/, '').replace(/^&gt; ?/gm, '');
      return `<blockquote>${body}</blockquote>${block.endsWith('\n') ? '\n' : ''}`;
    })
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*(?!\s)(.+?)\*\*/g, '<b>$1</b>')
    .replace(/~~(?!\s)(.+?)~~/g, '<s>$1</s>')
    .replace(/(?<![\w*])\*(?![\s*])([^*\n]+?)\*(?![\w*])/g, '<i>$1</i>')
    .replace(/(?<!\w)_(?![\s_])([^_\n]+?)_(?!\w)/g, '<i>$1</i>');
  return text.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[Number(i)]);
}

export function createPairing(state, sessionId, now, random = Math.random) {
  const code = String(Math.floor(random() * 1e6)).padStart(6, '0');
  state.pairings = [
    { code, sessionId: rootSession(sessionId), expiresAt: now + PAIR_TTL_MS },
    ...state.pairings.filter((p) => p.expiresAt > now && p.code !== code),
  ].slice(0, MAX_PAIRINGS);
  return code;
}

export function bindChat(state, { chatId, chatType, title, sessionId, sync = false }) {
  const binding = { chatId, chatType, title, sessionId: rootSession(sessionId), sync };
  state.bindings = [binding, ...state.bindings.filter((b) => b.chatId !== chatId)];
}

const parseCommand = (text) => {
  const m = /^\/([a-z]+)(?:@(\w+))?(?:\s+([\s\S]*))?$/i.exec(text);
  return m ? { name: m[1].toLowerCase(), target: m[2], arg: (m[3] ?? '').trim() } : null;
};

/** 把一条 update 归类成要做的事；只有配对过的聊天能投递消息 */
export function route(state, update, now, bot = {}) {
  const m = update?.message;
  const chatId = m?.chat?.id;
  if (typeof chatId !== 'number') return { kind: 'ignore' };
  const isGroup = m.chat.type === 'group' || m.chat.type === 'supergroup';
  const from = m.from?.username ?? m.from?.first_name ?? String(m.from?.id ?? chatId);
  const reply = (text) => ({ kind: 'reply', chatId, text });
  let text = String(m.text ?? m.caption ?? '').trim();
  const binding = state.bindings.find((b) => b.chatId === chatId);

  const command = parseCommand(text);
  if (command?.target && command.target.toLowerCase() !== String(bot.username).toLowerCase())
    return { kind: 'ignore' };

  // 侧栏的 t.me 链接会带着配对码发 /start <码>
  if (command?.name === 'bind' || (command?.name === 'start' && command.arg)) {
    const pairing = /^\d{6}$/.test(command.arg)
      ? state.pairings.find((p) => p.code === command.arg && p.expiresAt > now)
      : null;
    if (!pairing) return reply('配对码无效或已过期，请在 EnsoCode 侧栏「Telegram」里重新生成。');
    state.pairings = state.pairings.filter((p) => p !== pairing);
    bindChat(state, {
      chatId,
      chatType: m.chat.type,
      title: m.chat.title ?? from,
      sessionId: pairing.sessionId,
    });
    return { kind: 'bound', chatId, sessionId: pairing.sessionId };
  }
  if (!binding) {
    return command?.name === 'start' && !isGroup
      ? reply('在 EnsoCode 侧栏「Telegram」里点「绑定」，再点链接或把配对码发给我：/bind 123456')
      : { kind: 'ignore' };
  }

  if (command) {
    switch (command.name) {
      case 'start':
      case 'help':
        return reply(HELP);
      case 'status':
        return reply(`已绑定会话 ${binding.sessionId}\n同步 EnsoCode 对话：${binding.sync ? '开' : '关'}`);
      case 'unbind':
        state.bindings = state.bindings.filter((b) => b !== binding);
        return reply('已解绑。');
      case 'sync': {
        if (!/^(on|off)$/i.test(command.arg)) return reply('用法：/sync on 或 /sync off');
        binding.sync = command.arg.toLowerCase() === 'on';
        return reply(binding.sync ? '已开启同步：EnsoCode 里的对话也会发到这里。' : '已关闭同步。');
      }
      case 'stop':
        return { kind: 'stop', chatId, sessionId: binding.sessionId };
      case 'steer':
        if (!command.arg) return reply('用法：/steer 补充内容');
        return inject(binding, chatId, command.arg, from, m.message_id, 'steer');
    }
  }

  if (isGroup) {
    const mention = bot.username ? new RegExp(`@${bot.username}\\b`, 'i') : null;
    const repliedToBot = m.reply_to_message?.from?.id === bot.id && bot.id !== undefined;
    if (!(mention?.test(text) || repliedToBot)) return { kind: 'ignore' };
    if (mention) text = text.replace(mention, '').trim();
  }
  const image = imageOf(m);
  if (image === 'too-large') return reply('图片超过 5MB，请压缩后再发。');
  if (image) {
    return {
      ...inject(binding, chatId, text || '（用户发来一张图片）', from, m.message_id, 'followUp'),
      image,
    };
  }
  if (!text) {
    return MEDIA.some((k) => m[k] !== undefined)
      ? reply('暂只支持文字和图片，文件、语音等请附带文字说明或改用 EnsoCode。')
      : { kind: 'ignore' };
  }
  return inject(binding, chatId, text, from, m.message_id, 'followUp');
}

/** 照片取不超过上限的最大尺寸；以文件发送的图片按 mime 识别 */
function imageOf(m) {
  if (Array.isArray(m.photo) && m.photo.length) {
    const fit = m.photo
      .filter((p) => p?.file_id && (p.file_size ?? 0) <= IMAGE_MAX_BYTES)
      .sort((a, b) => (b.file_size ?? 0) - (a.file_size ?? 0))[0];
    return fit ? { fileId: fit.file_id, mimeType: 'image/jpeg' } : 'too-large';
  }
  const doc = m.document;
  if (doc?.file_id && IMAGE_MIME.includes(doc.mime_type)) {
    if ((doc.file_size ?? 0) > IMAGE_MAX_BYTES) return 'too-large';
    return { fileId: doc.file_id, mimeType: doc.mime_type };
  }
  return null;
}

const inject = (binding, chatId, text, from, messageId, deliverAs) => ({
  kind: 'inject',
  chatId,
  sessionId: binding.sessionId,
  text,
  from,
  messageId,
  deliverAs,
});

export const inboundText = ({ from, text }) => `[Telegram 消息，来自 ${from}]\n\n${text}`;

/** 记下这个会话有一轮由 Telegram 发起，结束时回发；同一聊天只保留最新的占位消息 */
export function markPending(state, sessionId, target) {
  const key = rootSession(sessionId);
  state.pending[key] = [...(state.pending[key] ?? []).filter((t) => t.chatId !== target.chatId), target];
}

export const pendingTargets = (state, sessionId) => state.pending[rootSession(sessionId)] ?? [];

/** 轮次结束：有待回且正文非空时取出并清掉待回 */
export function takeReply(state, sessionId, text) {
  const key = rootSession(sessionId);
  const targets = state.pending[key];
  const body = String(text ?? '').trim();
  if (!targets?.length || !body) return null;
  delete state.pending[key];
  return { targets, text: body };
}

/** 开启同步的聊天，排除本轮已经回发过的 */
export const mirrorTargets = (state, sessionId, exclude = []) =>
  state.bindings
    .filter((b) => b.sync && b.sessionId === rootSession(sessionId) && !exclude.includes(b.chatId))
    .map((b) => b.chatId);

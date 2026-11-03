const HAN = /\p{Script=Han}/u;

/** 半数以上汉字视为已经是中文，不再请求翻译。 */
export const HAN_SKIP_RATIO = 0.5;
export function hanRatio(text) {
  let han = 0;
  let total = 0;
  for (const ch of String(text ?? '')) {
    if (/\s/u.test(ch)) continue;
    total += 1;
    if (HAN.test(ch)) han += 1;
  }
  return total === 0 ? 0 : han / total;
}

function isFenceOpen(line) {
  return /^```/.test(line.trimStart());
}

function isFenceClose(line) {
  return /^```+\s*$/.test(line.trim());
}

export function segment(text, streaming) {
  const lines = String(text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');
  const blocks = [];
  let buf = [];
  let inCode = false;

  const flush = (kind) => {
    const source = kind === 'code' ? buf.join('\n').trimEnd() : buf.join('\n').trim();
    buf = [];
    if (!source) return;
    blocks.push({
      source,
      kind: kind === 'code' ? 'code' : hanRatio(source) >= HAN_SKIP_RATIO ? 'skip' : 'prose',
    });
  };

  for (const line of lines) {
    if (inCode) {
      buf.push(line);
      if (isFenceClose(line)) {
        inCode = false;
        flush('code');
      }
      continue;
    }
    if (isFenceOpen(line)) {
      flush('prose');
      inCode = true;
      buf.push(line);
      continue;
    }
    if (line.trim() === '') {
      flush('prose');
      continue;
    }
    buf.push(line);
  }
  flush(inCode ? 'code' : 'prose');

  const last = blocks.length - 1;
  return blocks.map((block, index) => ({ ...block, final: index < last || !streaming }));
}

export function createQueue(limit) {
  let active = 0;
  const pending = [];
  const drain = () => {
    while (active < limit && pending.length > 0) {
      const item = pending.shift();
      active += 1;
      Promise.resolve()
        .then(item.job)
        .then(item.resolve, item.reject)
        .finally(() => {
          active -= 1;
          drain();
        });
    }
  };
  return (job) =>
    new Promise((resolve, reject) => {
      pending.push({ job, resolve, reject });
      drain();
    });
}


const cache = new Map();
const listeners = new Map();
const queue = createQueue(3);

function subscribe(source, fn) {
  let set = listeners.get(source);
  if (!set) listeners.set(source, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(source);
  };
}

function publish(source) {
  const entry = cache.get(source) ?? null;
  for (const fn of listeners.get(source) ?? []) fn(entry);
}

function load(source, dispatch) {
  if (cache.has(source)) return;
  cache.set(source, { status: 'pending' });
  publish(source);
  queue(() =>
    dispatch('plugin.call', { method: 'translate', args: { text: source } })
      .then((res) => {
        const text = res && typeof res.text === 'string' ? res.text.trim() : '';
        if (!text) throw new Error('翻译结果为空');
        cache.set(source, { status: 'done', text });
      })
      .catch(() => {
        cache.set(source, { status: 'error' });
      })
      .finally(() => publish(source)),
  );
}

const blockStyle = { marginBottom: 8 };
const translatedStyle = {
  color: 'var(--foreground)',
  borderLeft: '2px solid var(--border)',
  marginTop: 4,
  paddingLeft: 8,
  whiteSpace: 'pre-wrap',
};
const pendingStyle = {
  color: 'var(--muted-foreground)',
  opacity: 0.6,
  marginTop: 4,
  paddingLeft: 8,
};
const retryStyle = {
  background: 'transparent',
  border: 'none',
  padding: '4px 0 0 8px',
  margin: 0,
  color: 'var(--muted-foreground)',
  cursor: 'pointer',
  font: 'inherit',
  textDecoration: 'underline',
};

export function onLoad(enso) {
  const { createElement: h, useEffect, useState } = enso.React;

  function Block({ source, kind, final }) {
    const show = kind === 'prose' && final;
    const [entry, setEntry] = useState(null);
    useEffect(() => {
      if (!show) return undefined;
      const unsub = subscribe(source, setEntry);
      if (cache.has(source)) setEntry(cache.get(source));
      else load(source, enso.dispatch);
      return unsub;
    }, [source, show]);

    let translation = null;
    if (show && entry?.status === 'done') translation = h('div', { style: translatedStyle }, entry.text);
    else if (show && entry?.status === 'error') {
      translation = h(
        'button',
        {
          type: 'button',
          onClick: () => {
            cache.delete(source);
            load(source, enso.dispatch);
          },
          style: retryStyle,
        },
        '重试',
      );
    } else if (show && entry?.status === 'pending') translation = h('div', { style: pendingStyle }, '翻译中…');

    return h('div', { style: blockStyle }, h('div', null, source), translation);
  }

  enso.slots.register({
    slot: 'thinking.body',
    component: ({ text, streaming, itemKey }) => {
      const parts = segment(String(text ?? ''), streaming);
      if (parts.length === 0) return null;
      return h(
        'div',
        null,
        parts.map((part, index) =>
          h(Block, {
            key: `${itemKey}:${index}`,
            source: part.source,
            kind: part.kind,
            final: part.final,
          }),
        ),
      );
    },
  });
}

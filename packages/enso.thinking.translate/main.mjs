const TRANSLATE_URL = 'https://index-translate.bilibili.com/v1/chat/completions';
const MODELS = ['Index-Translate-35B-A3B', 'Index-Translate-9B', 'Index-Translate-2B'];
const PROMPT = '请将以下文本翻译为中文，直接输出翻译结果，不要进行任何解释。\n\n';

function requestBody(text, model) {
  return {
    model,
    messages: [{ role: 'user', content: `${PROMPT}${text}` }],
    temperature: 0,
    max_tokens: 2048,
    stream: false,
    // 开启思考时模型可能只回思考内容而没有译文
    chat_template_kwargs: { enable_thinking: false },
  };
}

function stripThink(content) {
  const marker = '</think>';
  const at = content.indexOf(marker);
  return (at === -1 ? content : content.slice(at + marker.length)).trim();
}

export async function translate(enso, text) {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('没有可翻译的文本');
  const config = (await enso.config.get()) ?? {};
  const model = MODELS.includes(config.model) ? config.model : MODELS[0];
  const res = await enso.net.fetch(TRANSLATE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestBody(text, model)),
  });
  if (res.status !== 200) throw new Error(`翻译失败（HTTP ${res.status}）`);
  let data;
  try {
    data = JSON.parse(res.body);
  } catch {
    throw new Error('翻译响应无法解析');
  }
  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('翻译响应缺少内容');
  const translated = stripThink(content);
  if (!translated) throw new Error('翻译结果为空');
  return { text: translated };
}

export function activate(enso) {
  enso.renderer.handle('translate', (args) => translate(enso, args?.text));
}

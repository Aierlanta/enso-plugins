const TRANSLATE_URL = 'https://index-translate.bilibili.com/v1/chat/completions';
const MODELS = ['Index-Translate-35B-A3B', 'Index-Translate-9B', 'Index-Translate-2B'];
const BODY_MODES = ['关闭', '手动', '自动'];
const LANGUAGES = ['中文', '英文', '日文', '韩文', '法文', '德文', '西班牙文', '俄文'];

export function normalizeSettings(config) {
  const source = config && typeof config === 'object' ? config : {};
  return {
    thinking: typeof source.thinking === 'boolean' ? source.thinking : true,
    bodyMode: BODY_MODES.includes(source.bodyMode) ? source.bodyMode : '手动',
    targetLanguage: LANGUAGES.includes(source.targetLanguage) ? source.targetLanguage : '中文',
    model: MODELS.includes(source.model) ? source.model : MODELS[0],
  };
}

function promptFor(language) {
  const target = LANGUAGES.includes(language) ? language : '中文';
  return `请将以下文本翻译为${target}，直接输出翻译结果，不要进行任何解释。\n\n`;
}

function requestBody(text, model, language) {
  return {
    model,
    messages: [{ role: 'user', content: `${promptFor(language)}${text}` }],
    temperature: 0,
    max_tokens: 2048,
    stream: false,
    chat_template_kwargs: { enable_thinking: false },
  };
}

function stripThink(content) {
  const marker = '</think>';
  const at = content.indexOf(marker);
  return (at === -1 ? content : content.slice(at + marker.length)).trim();
}

export async function translate(enso, text, target) {
  if (typeof text !== 'string' || text.trim() === '') throw new Error('没有可翻译的文本');
  const settings = normalizeSettings(await enso.config.get());
  const language = LANGUAGES.includes(target) ? target : settings.targetLanguage;
  const res = await enso.net.fetch(TRANSLATE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(requestBody(text, settings.model, language)),
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

export async function settings(enso) {
  return normalizeSettings(await enso.config.get());
}

export function activate(enso) {
  enso.renderer.handle('translate', (args) => translate(enso, args?.text, args?.target));
  enso.renderer.handle('settings', () => settings(enso));
}

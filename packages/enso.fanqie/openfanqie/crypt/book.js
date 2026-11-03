import { createCipheriv, createDecipheriv, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

// App 内置的固定 AES-128 密钥，用于包裹「密钥注册」请求与响应。
// 来源于 com.dragon.read.reader.d.a 的常量使用方 (RegisterKeyHelper)。
const REGISTER_KEY = Buffer.from('ac25c67ddd8f38c1b37a2348828e222e', 'hex');

function pad16Utf8(s) {
  let t = String(s == null ? '' : s);
  while (t.length < 16) t += '0';
  if (t.length > 16) t = t.slice(0, 16);
  return Buffer.from(t, 'utf8');
}

function hexToKey(s) {
  const raw = Buffer.from(String(s), 'hex');
  if (raw.length === 16 || raw.length === 32) return raw;
  return pad16Utf8(s).subarray(0, 16);
}

function le64(value) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt.asUintN(64, BigInt(value)), 0);
  return b;
}

function aesCbcEncrypt(plain, key, iv) {
  const c = createCipheriv(key.length === 32 ? 'aes-256-cbc' : 'aes-128-cbc', key, iv);
  return Buffer.concat([c.update(plain), c.final()]);
}

function aesCbcDecrypt(ct, key, iv) {
  const d = createDecipheriv(key.length === 32 ? 'aes-256-cbc' : 'aes-128-cbc', key, iv);
  return Buffer.concat([d.update(ct), d.final()]);
}

// 密钥注册请求的 content 字段：
// Base64( iv(16 ascii 字符) || AES-128-CBC( LE64(deviceId) || LE64(userId) ) )
export function buildRegisterKeyContent(deviceId, userId) {
  const plain = Buffer.concat([le64(deviceId), le64(userId)]);
  const ivStr = randomUUID().slice(0, 16);
  const ct = aesCbcEncrypt(plain, REGISTER_KEY, Buffer.from(ivStr, 'utf8'));
  return {
    content: Buffer.concat([Buffer.from(ivStr, 'utf8'), ct]).toString('base64'),
    iv: ivStr,
  };
}

// 响应 key 字段：Base64( iv(16 bytes) || AES-128-CBC(大写 hex 形式的内容密钥) )
export function decryptRegisteredKey(keyB64) {
  const raw = Buffer.from(String(keyB64), 'base64');
  if (raw.length <= 16) throw new Error('registerkey: key too short');
  const iv = raw.subarray(0, 16);
  const ct = raw.subarray(16);
  // 明文是内容密钥的字节，客户端把它转成大写 hex 字符串后存起来。
  return aesCbcDecrypt(ct, REGISTER_KEY, iv).toString('hex').toUpperCase();
}

// 章节正文：Base64( iv(16 bytes) || AES-CBC( gzip(标记文本) ) )
export function decryptChapterContent(contentB64, contentKeyHex, compressStatus = 0) {
  const raw = Buffer.from(String(contentB64), 'base64');
  if (raw.length <= 16) throw new Error('chapter: content too short');
  const iv = raw.subarray(0, 16);
  const ct = raw.subarray(16);
  let plain = aesCbcDecrypt(ct, hexToKey(contentKeyHex), iv);
  if (compressStatus === 1) {
    try { plain = gunzipSync(plain); } catch { /* 某些章节不压缩 */ }
  }
  return plain.toString('utf8');
}

// 客户端把 gzip 解出的标记文本压平为纯文本段落。
const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', hellip: '…', mdash: '—', ndash: '–', middot: '·' };

// 单次扫描，避免 &amp;quot; 被二次还原
export function decodeEntities(s) {
  return s.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]{2,8}));/gi, (m, dec, hex, name) => {
    if (name) return NAMED[name.toLowerCase()] ?? m;
    const code = dec ? Number(dec) : parseInt(hex, 16);
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

export function markupToText(markup) {
  const paragraphs = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/g;
  let m;
  while ((m = re.exec(markup)) !== null) {
    const text = decodeEntities(m[1].replace(/<[^>]+>/g, '')).trim();
    if (text) paragraphs.push(text);
  }
  if (paragraphs.length === 0) {
    const text = decodeEntities(markup.replace(/<[^>]+>/g, '')).trim();
    if (text) paragraphs.push(...text.split(/\n+/).filter(Boolean));
  }
  return paragraphs;
}


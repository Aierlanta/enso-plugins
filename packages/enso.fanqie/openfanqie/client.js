import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';

import { APP, PATHS } from './protocol/app.js';
import { newInstallIdentity, resolveDevice, userAgent } from './protocol/device.js';
import { deviceQueryPairs, readingRequestId } from './protocol/query.js';
import { buildRegisterBody, contentMd5 } from './protocol/register.js';
import { signGET, signPOST } from './sign/index.js';
import { buildRegisterKeyContent, decryptRegisteredKey } from './crypt/book.js';

// 业务错误：服务端 code != 0。
export class ApiError extends Error {
  constructor(code, message, path) {
    super(message || ('请求失败 code=' + code));
    this.name = 'ApiError';
    this.code = code;
    this.path = path;
  }
}

function emptyProfile(device) {
  return {
    ...newInstallIdentity(),
    deviceId: '',
    installId: '',
    ttreq: '',
    storeRegion: '',
    storeRegionSrc: '',
    createdAt: new Date().toISOString(),
    device: resolveDevice(device),
  };
}

export class Client {
  #profile = null;
  #registering = null;

  constructor(options = {}) {
    this.profilePath = options.profilePath || null;
    this.apiOrigin = (options.apiOrigin || ('https://' + APP.apiHost)).replace(/\/+$/, '');
    this.registerOrigin = (options.registerOrigin || ('https://' + APP.registerHost)).replace(/\/+$/, '');
    this.device = resolveDevice(options.device);
    this.fetchImpl = options.fetch || globalThis.fetch;
    this.logger = options.logger || null;
    this.timeoutMs = options.timeoutMs || 20000;
  }

  // ---------- profile ----------

  async loadProfile() {
    if (this.#profile) return this.#profile;
    if (this.profilePath) {
      try {
        const raw = await readFile(this.profilePath, 'utf8');
        this.#profile = { ...emptyProfile(this.device), ...JSON.parse(raw) };
        return this.#profile;
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
      }
    }
    this.#profile = emptyProfile(this.device);
    return this.#profile;
  }

  async saveProfile() {
    if (!this.profilePath || !this.#profile) return;
    await mkdir(dirname(this.profilePath), { recursive: true });
    await writeFile(this.profilePath, JSON.stringify(this.#profile, null, 2));
  }

  get identity() {
    const p = this.#profile;
    return {
      deviceId: p.deviceId,
      installId: p.installId,
      cdid: p.cdid,
      openudid: p.openudid,
      device: resolveDevice(p.device || this.device),
    };
  }

  // ---------- 设备注册 ----------

  async ensureGuest() {
    const p = await this.loadProfile();
    if (p.deviceId && p.installId && p.deviceId !== '0' && p.installId !== '0') return p;
    if (!this.#registering) {
      this.#registering = this.#register().finally(() => { this.#registering = null; });
    }
    return this.#registering;
  }

  async #register() {
    const p = await this.loadProfile();
    const now = Date.now();
    const body = buildRegisterBody(p, now);
    const query = new URLSearchParams({ req_id: p.reqId, tt_data: 'a' }).toString();
    const headers = {
      'User-Agent': userAgent(p.device || this.device),
      'Content-Type': 'application/octet-stream;tt-data=a',
      'log-encode-type': 'gzip',
      'sdk-version': '2',
      'passport-sdk-version': '5051452',
      'x-vc-bdturing-sdk-version': '4.0.3.cn',
      'x-ss-dp': APP.aid,
      'X-SS-STUB': contentMd5(body),
    };
    const url = this.registerOrigin + APP.registerPath + '?' + query;
    this.logger?.('POST ' + url);
    const res = await this.#fetchWithTimeout(url, { method: 'POST', headers, body });
    const text = await res.text();
    if (!res.ok) throw new ApiError(res.status, 'device_register HTTP ' + res.status, APP.registerPath);
    let parsed;
    try { parsed = JSON.parse(text); } catch { throw new ApiError(-1, 'device_register 返回非 JSON', APP.registerPath); }
    const rawId = String(parsed.device_id_str ?? parsed.device_id ?? '');
    const rawInstall = String(parsed.install_id_str ?? parsed.install_id ?? '');
    if (!rawId || rawId === '0' || !rawInstall || rawInstall === '0') {
      throw new ApiError(-1, '匿名注册未返回 device_id/install_id', APP.registerPath);
    }
    p.deviceId = rawId;
    p.installId = rawInstall;
    this.#applyCookies(res, p);
    await this.saveProfile();
    return p;
  }

  #applyCookies(res, p) {
    const list = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
    for (const line of list) {
      const m = /^\s*([^=;]+)=([^;]*)/.exec(line);
      if (!m) continue;
      const name = m[1].trim();
      const value = m[2].trim();
      if (name === 'ttreq') p.ttreq = value;
      else if (name === 'store-region') p.storeRegion = value;
      else if (name === 'store-region-src') p.storeRegionSrc = value;
    }
  }

  // ---------- 请求 ----------

  #guestCookie(p) {
    return [
      'store-region=' + (p.storeRegion || ''),
      'store-region-src=' + (p.storeRegionSrc || ''),
      'install_id=' + p.installId,
      'ttreq=' + (p.ttreq || ''),
    ].join('; ');
  }

  #baseHeaders(p, extra = {}) {
    const headers = {
      'User-Agent': userAgent(p.device || this.device),
      'x-ss-dp': APP.aid,
      lc: '101',
      Cookie: this.#guestCookie(p),
      'Accept-Encoding': 'gzip',
      ...extra,
    };
    // 空值 header 一律不发送（与客户端一致；空 x-tt-dt 会被网关判定为异常）。
    for (const [k, v] of Object.entries(headers)) {
      if (v === '' || v === undefined || v === null) delete headers[k];
    }
    return headers;
  }

  async #fetchWithTimeout(url, init) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  // 签名并发送一次 GET。extraPairs 追加在设备参数之后（顺序参与签名）。
  async get(path, extraPairs = [], { parseJSON = true } = {}) {
    const p = await this.ensureGuest();
    const ticket = Date.now();
    const pairs = [...deviceQueryPairs(this.identity), ...extraPairs];
    const { query, headers } = signGET(pairs, ticket, p.deviceId, APP.versionName, null);
    const url = this.apiOrigin + path + '?' + query;
    const allHeaders = this.#baseHeaders(p, {
      ...headers,
      'x-reading-request': readingRequestId(ticket, Math.floor(Math.random() * 2147483647)),
    });
    this.logger?.('GET ' + url);
    const res = await this.#fetchWithTimeout(url, { method: 'GET', headers: allHeaders });
    return this.#readResponse(res, path, parseJSON);
  }

  // 签名并发送一次 POST JSON。body 会被序列化一次并原样签名/发送。
  async post(path, extraPairs = [], bodyObject = {}, { parseJSON = true } = {}) {
    const p = await this.ensureGuest();
    const ticket = Date.now();
    const body = Buffer.from(JSON.stringify(bodyObject), 'utf8');
    const pairs = [...deviceQueryPairs(this.identity), ...extraPairs];
    const { query, headers } = signPOST(path, pairs, ticket, p.deviceId, APP.versionName, body, null);
    const url = this.apiOrigin + path + '?' + query;
    const allHeaders = this.#baseHeaders(p, {
      ...headers,
      'x-reading-request': readingRequestId(ticket, Math.floor(Math.random() * 2147483647)),
    });
    this.logger?.('POST ' + url);
    const res = await this.#fetchWithTimeout(url, { method: 'POST', headers: allHeaders, body });
    return this.#readResponse(res, path, parseJSON);
  }

  async #readResponse(res, path, parseJSON) {
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok) throw new ApiError(res.status, 'HTTP ' + res.status, path);
    if (!parseJSON) return buf;
    let json;
    try { json = JSON.parse(buf.toString('utf8')); } catch { throw new ApiError(-1, '响应不是 JSON', path); }
    const code = json.code;
    if (code !== undefined && code !== 0 && code !== '0') {
      throw new ApiError(code, json.message || '', path);
    }
    return json.data !== undefined ? json.data : json;
  }

  // ---------- 加密密钥 ----------

  // 注册（或读取）本设备的内容密钥。返回值是大写 hex 字符串。
  async registerContentKey(userId = '0', keyVersion = 0) {
    const p = await this.ensureGuest();
    const { content } = buildRegisterKeyContent(p.deviceId, userId);
    const data = await this.post(PATHS.registerKey, [], { content, keyver: keyVersion });
    if (!data || !data.key) throw new ApiError(-1, 'registerkey 未返回 key', PATHS.registerKey);
    const keyHex = decryptRegisteredKey(data.key);
    this.contentKey = { keyHex, keyVersion: data.keyver, userId };
    return this.contentKey;
  }
}


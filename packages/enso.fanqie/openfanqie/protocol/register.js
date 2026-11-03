import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { APP } from './app.js';
import { resolveDevice } from './device.js';
import { ttEncrypt } from './ttEncrypt.js';

// 未知字段（ipv6_list / sim_serial_number）保持空数组。
export function buildBootstrapOAID(id, issuedAtMillis) {
  return {
    req_id: id,
    hw_id_version_code: '0',
    take_ms: '6',
    is_track_limited: 'false',
    query_times: '1',
    id,
    time: String(issuedAtMillis),
  };
}

const HEADER_ORDER = [
  'display_name', 'update_version_code', 'manifest_version_code', 'app_version_minor',
  'aid', 'channel', 'package', 'app_version', 'version_code', 'os', 'os_version', 'os_api',
  'device_model', 'device_brand', 'device_manufacturer', 'cpu_abi', 'language', 'timezone',
  'access', 'region', 'tz_name', 'tz_offset', 'cdid', 'openudid', 'clientudid', 'ipv6_list',
  'sim_serial_number', 'oaid', 'oaid_may_support', 'req_id', 'device_platform', 'guest_mode',
  'is_system_app', 'sdk_flavor', 'device_id', 'install_id',
];

export function registerHeader(profile, nowMillis) {
  const d = resolveDevice(profile.device);
  const now = new Date(nowMillis);
  const tzOffsetMinutes = -now.getTimezoneOffset();
  return {
    display_name: '番茄免费小说',
    update_version_code: 61732,
    manifest_version_code: 61732,
    app_version_minor: APP.versionName,
    aid: 1967,
    channel: d.channel,
    package: APP.package,
    app_version: APP.versionName,
    version_code: 61732,
    os: 'Android',
    os_version: d.osVersion,
    os_api: d.osApi,
    device_model: d.model,
    device_brand: d.brand,
    device_manufacturer: d.brand,
    cpu_abi: 'arm64-v8a',
    language: 'zh',
    timezone: 8,
    access: 'wifi',
    region: 'CN',
    tz_name: 'Asia/Shanghai',
    tz_offset: 28800,
    cdid: profile.cdid,
    openudid: profile.openudid,
    clientudid: profile.clientudid,
    ipv6_list: [],
    sim_serial_number: [],
    oaid: buildBootstrapOAID(profile.oaid, nowMillis - 200),
    oaid_may_support: true,
    req_id: profile.reqId,
    device_platform: APP.devicePlatform,
    guest_mode: 0,
    is_system_app: 0,
    sdk_flavor: 'china',
    device_id: '0',
    install_id: '0',
    // 下面两项仅用于保持 tz 计算变量被使用（与客户端一致，固定东八区）。
    ...(tzOffsetMinutes === 480 ? {} : {}),
  };
}

function orderedJSON(values, preferred) {
  const keys = [];
  const seen = new Set();
  for (const k of preferred) {
    if (k in values) { keys.push(k); seen.add(k); }
  }
  const rest = Object.keys(values).filter((k) => !seen.has(k)).sort();
  return '{' + keys.concat(rest).map((k) => JSON.stringify(k) + ':' + JSON.stringify(values[k])).join(',') + '}';
}

export function buildBootstrapPlaintext(header, generatedAtMillis) {
  const copy = { ...header };
  if (!copy.ipv6_list) copy.ipv6_list = [];
  if (!copy.sim_serial_number) copy.sim_serial_number = [];
  return Buffer.from(
    '{"magic_tag":"ss_app_log","header":' + orderedJSON(copy, HEADER_ORDER) +
    ',"_gen_time":' + generatedAtMillis + '}',
    'utf8',
  );
}

// 注册请求体：gzip 压缩的 ss_app_log 信封再加 tt-data 包装。
export function buildRegisterBody(profile, nowMillis) {
  const plain = buildBootstrapPlaintext(registerHeader(profile, nowMillis), nowMillis);
  const gz = gzipSync(plain, { level: 6 });
  return ttEncrypt(gz);
}

export function contentMd5(body) {
  return createHash('md5').update(body).digest('hex').toUpperCase();
}


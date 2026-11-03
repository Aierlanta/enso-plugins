import { randomBytes } from 'node:crypto';
import { APP } from './app.js';

// 默认设备：小米 14 / Android 14 / 小米应用商店渠道。
export const DEFAULT_DEVICE = {
  brand: 'Xiaomi',
  model: '23127PN0CC',
  osVersion: '14',
  osApi: 34,
  build: 'UKQ1.230804.001',
  resolution: '1200*2670',
  dpi: 460,
  // 渠道串 = 厂商_aid_abi；番茄 aid 是 1967。
  channel: 'xiaomi_1967_64',
};

export function resolveDevice(device = {}) {
  const d = { ...DEFAULT_DEVICE };
  for (const [k, v] of Object.entries(device || {})) {
    if (v !== undefined && v !== null && v !== '') d[k] = v;
  }
  return d;
}

// App 的 Cronet User-Agent，机型用 model code。
export function userAgent(device = {}) {
  const d = resolveDevice(device);
  return (
    APP.package + '/' + APP.versionCode +
    ' (Linux; U; Android ' + d.osVersion + '; zh_CN; ' + d.model +
    '; Build/' + d.build +
    '; Cronet/TTNetVersion:8d40f833 2026-03-03 QuicVersion:21ac1950 2025-11-18)'
  );
}

function uuidV4() {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' +
    h.slice(16, 20) + '-' + h.slice(20);
}

// 本地生成的匿名安装标识。
export function newInstallIdentity() {
  return {
    cdid: uuidV4(),
    openudid: randomBytes(8).toString('hex'),
    clientudid: uuidV4(),
    oaid: uuidV4(),
    reqId: uuidV4(),
  };
}


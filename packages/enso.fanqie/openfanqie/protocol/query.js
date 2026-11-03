import { APP } from './app.js';
import { resolveDevice } from './device.js';

// 匿名设备查询参数，顺序参与签名。
export function deviceQueryPairs(identity) {
  const d = resolveDevice(identity.device);
  return [
    ['iid', identity.installId],
    ['device_id', identity.deviceId],
    ['ac', 'wifi'],
    ['channel', d.channel],
    ['aid', APP.aid],
    ['app_name', APP.appName],
    ['cdid', identity.cdid],
    ['version_code', APP.versionCode],
    ['version_name', APP.versionName],
    ['device_platform', APP.devicePlatform],
    ['os', 'android'],
    ['ssmix', 'a'],
    ['device_type', d.model],
    ['device_brand', d.brand],
    ['language', 'zh'],
    ['os_api', String(d.osApi)],
    ['os_version', d.osVersion],
    ['manifest_version_code', APP.versionCode],
    ['resolution', d.resolution],
    ['dpi', String(d.dpi)],
    ['update_version_code', APP.versionCode],
    ['host_abi', 'arm64-v8a'],
    ['dragon_device_type', 'phone'],
    ['pv_player', APP.versionCode],
    ['compliance_status', '0'],
    ['need_personal_recommend', '1'],
    ['player_so_load', '1'],
    ['is_android_pad_screen', '0'],
    ['openudid', identity.openudid],
  ];
}

export function readingRequestId(ticketMillis, randomInt) {
  return String(ticketMillis) + '-' + String(Math.abs(Math.trunc(randomInt)));
}


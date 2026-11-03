// 番茄免费小说 (com.dragon.read) 的应用身份常量。
// 这些是 App 的公开身份参数，不是设备凭证。

export const APP = {
  package: 'com.dragon.read',
  versionName: '6.1.7.32',
  versionCode: '61732',
  aid: '1967',
  appName: 'novelapp',
  devicePlatform: 'android',
  // 实测匿名设备可直连的 API 主机（读接口）。
  apiHost: 'api5-normal-sinfonlinea.fqnovel.com',
  // 设备注册主机。
  registerHost: 'log5-applog-lq.fqnovel.com',
  registerPath: '/service/2/device_register/',
};

export const PATHS = {
  bookmallTab: '/reading/bookapi/bookmall/tab/v',
  bookmallCellChange: '/reading/bookapi/bookmall/cell/change/v',
  searchTab: '/reading/bookapi/search/tab/v',
  searchSuggest: '/reading/bookapi/search/suggest/v1/',
  directory: '/reading/bookapi/directory/all_items/v',
  readerFull: '/reading/reader/full/v',
  readerBatchFull: '/reading/reader/batch_full/v',
  registerKey: '/reading/crypt/registerkey',
};


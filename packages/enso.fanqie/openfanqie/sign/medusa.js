import { encryptMedusa } from "./aes.js";
import { appID, channelID, medusaSignKey } from "./const.js";
import { hashF13 } from "./f13.js";
import { le32, md5Raw } from "./prim.js";
import { protoBytes, protoFloat, protoSInt, protoString } from "./proto.js";
import { sm3 } from "./sm3.js";

export { medusaSignKey };

export function xmxor(data, key) {
  const n = data.length;
  const encoded = Buffer.alloc(n);
  for (let i = 0; i < n; i++) {
    const at = (i * 4) & 28;
    const d0 = key[at];
    const d1 = key[at + 1];
    let d2 = (((((data[i] << 4) | (data[i] >> 4)) & 0xff) + d0) & 0xff);
    d2 = ((~d2) & 0xff) ^ d1;
    d2 = ((d2 << 3) | (d2 >> 5)) & 0xff;
    d2 = (d2 + d1) & 0xff;
    d2 ^= d0;
    encoded[n - i - 1] = (~d2) & 0xff;
  }
  const last = encoded[n - 1] ^ encoded[n - 2];
  const first = encoded[0];
  encoded[0] = ((~last) + first) & 0xff;
  encoded[1] = ((encoded[0] ^ encoded[n - 1] ^ 254) + encoded[1]) & 0xff;
  const shifted = ((encoded[1] << 3) | (encoded[1] >> 5)) & 0xff;
  const fix2 = ((last - first) ^ (shifted ^ 2)) & 0xff;
  encoded[2] = (encoded[2] + fix2) & 0xff;
  for (let i = 0; i < n - 4; i++) {
    const sh = ((encoded[i + 2] << 3) | (encoded[i + 2] >> 5)) & 0xff;
    const temp = sh ^ encoded[i + 1] ^ ((i + 3) & 0xff);
    encoded[i + 3] = ((~temp) + encoded[i + 3]) & 0xff;
  }
  encoded[n - 1] ^= encoded[n - 2];
  let sum = 0;
  for (let i = 1; i < n; i++) sum = (sum + encoded[i]) >>> 0;
  encoded[0] = ((encoded[0] ^ encoded[1]) + (sum & 0xff)) & 0xff;
  return encoded;
}

export function keyHash(signKey, random) {
  const r = random >>> 0;
  const hash = sm3(Buffer.concat([signKey, le32(r), signKey]));
  const d1 = (r >>> 16) & 255;
  let d2 = ((d1 << 11) | (r >>> 24)) >>> 0;
  d2 = (d2 ^ (d1 >>> 5)) >>> 0;
  d2 = (d2 ^ d1) >>> 0;
  d2 = (~d2) >>> 0;
  return { hash, seed: le32(d2) };
}

function deviceProto(deviceID) {
  return Buffer.concat([
    protoSInt(1, 1),
    protoSInt(2, 2),
    protoString(3, appID),
    protoString(4, deviceID),
    protoString(5, "Ai6svO3PyrwDOUSmO6ZcResxu"),
    protoString(6, "!noperm!"),
    protoSInt(7, -888888),
    protoSInt(8, -888888),
    protoSInt(9, 3),
    protoSInt(10, -888888),
    protoString(11, "!notset!"),
    protoString(12, "Asia/Shanghai,8"),
    protoString(13, "zh_CN"),
    protoSInt(14, 4),
    protoFloat(16, 255.24993896484375),
    protoFloat(17, 35.58599090576172),
    protoFloat(18, 3.467449188232422),
    protoFloat(19, 3.467449188232422),
    protoFloat(20, 255.1754913330078),
    protoFloat(21, 42.17544174194336),
    protoString(22, "16"),
    protoSInt(23, 41),
    protoSInt(24, 36),
    protoSInt(25, 1728388016635),
    protoSInt(26, 1728388016635),
    protoSInt(27, 1728388016635),
    protoSInt(28, 1728388016637),
    protoSInt(29, -1),
    protoString(30, "25053RT47C"),
    protoString(31, "Redmi"),
    protoString(32, "25053RT47C"),
    protoString(33, "25053RT47C"),
    protoString(34, "Xiaomi"),
    protoString(35, "Redmi"),
    protoString(36, "Redmi"),
    protoSInt(38, 31),
  ]);
}

function indexByte(s, c) {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) === c) return i;
  return -1;
}

export function assembleMedusa(rawURL, body, hasBody, khronos, deviceID, versionName, entropy) {
  let bodyMD5 = Buffer.alloc(16);
  if (hasBody) bodyMD5 = md5Raw(body);
  const q = indexByte(rawURL, 0x3f);
  const queryRaw = q >= 0 ? rawURL.slice(q + 1) : "";
  const querySM3 = sm3(Buffer.from(queryRaw, "utf8"));
  const ts = le32(khronos >>> 0);
  const queryBodyTS = hashF13(querySM3, bodyMD5, ts, khronos >>> 0);
  const check = (((querySM3[0] & 63) << 14) | 0x18000001 | ((queryBodyTS[0] & 63) << 8)) >>> 0;

  const nested = Buffer.concat([
    protoSInt(1, 111),
    protoSInt(2, 10),
    protoSInt(3, 694367),
    protoSInt(5, 586952199),
  ]);
  const nested13 = Buffer.concat([
    protoSInt(1, entropy.NowSecs),
    protoSInt(2, -2),
    protoSInt(4, 200),
  ]);
  const env = Buffer.concat([
    protoSInt(1, entropy.EnvLaunch),
    protoSInt(2, 146331399),
    protoSInt(3, 146331396),
    protoSInt(5, 7),
    protoString(6, "v04.06.04.03-bugfix"),
    protoSInt(7, entropy.EnvPID),
    protoBytes(12, deviceProto(deviceID)),
    protoBytes(13, nested13),
    protoString(14, versionName),
  ]);
  const queryHash = sm3(Buffer.concat([
    Buffer.from(queryRaw, "utf8"),
    bodyMD5,
    Buffer.from("none", "utf8"),
  ]));
  const fixed1 = Buffer.from("f7e85ffad7d7dc3bd62ac87057cf6118", "hex");
  const fixed2 = Buffer.from("4001000000000000", "hex");
  const message = Buffer.concat([
    protoBytes(1, fixed1),
    protoSInt(2, 3),
    protoSInt(3, entropy.MessageRandom >>> 0),
    protoString(4, appID),
    protoString(5, deviceID),
    protoString(6, channelID),
    protoString(7, versionName),
    protoString(8, "v04.06.04-ml-android"),
    protoSInt(9, 67503104),
    protoBytes(10, fixed2),
    protoSInt(12, khronos >>> 0),
    protoBytes(13, queryBodyTS),
    protoBytes(14, querySM3.subarray(0, 6)),
    protoBytes(15, nested),
    protoString(16, "AXYQOS6n2m60x1fVZHIrH3iol"),
    protoSInt(17, khronos >>> 0),
    protoBytes(19, queryHash),
    protoString(20, "none"),
    protoSInt(21, 312),
    protoBytes(23, env),
    protoString(24, '{"cmr":16777216,"cmr2":16777216,"un_h":1879194040,"vpn":0,"kd":0,"fkd":3672518972,"pd":-1872573247,"dyn":"","do":0,"tk":true}'),
  ]);
  const { hash, seed } = keyHash(medusaSignKey(), entropy.Random >>> 0);
  let transformed = Buffer.concat([fixed2, xmxor(message, hash)]);
  for (let i = 0, j = transformed.length - 1; i < j; i++, j--) {
    const tmp = transformed[i];
    transformed[i] = transformed[j];
    transformed[j] = tmp;
  }
  for (let i = 0; i < transformed.length; i++) transformed[i] ^= seed[(~i) & 3];
  const packed = Buffer.concat([
    Buffer.from([0x35]),
    le32(entropy.PackedRandom >>> 0),
    le32(check),
    transformed,
    Buffer.from([(entropy.Random >>> 16) & 255, (entropy.Random >>> 24) & 255]),
  ]);
  const encrypted = encryptMedusa(packed, khronos >>> 0);
  const version = Buffer.from("03000000f7e85ffad7d7dc3bd62ac87057cf6118", "hex");
  const prefix = Buffer.alloc(20);
  for (let i = 0; i < 5; i++) {
    const v = version.readUInt32LE(i * 4);
    le32((v ^ (khronos >>> 0)) >>> 0).copy(prefix, i * 4);
  }
  const out = Buffer.concat([
    prefix,
    Buffer.from([entropy.Random & 255, (entropy.Random >>> 8) & 255, 0, 1]),
    encrypted,
  ]);
  return out.toString("base64");
}

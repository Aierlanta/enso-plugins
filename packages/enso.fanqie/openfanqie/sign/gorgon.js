import { gorgonSDKVersion } from "./const.js";
import { be32, le32, md5Raw, bitReverse } from "./prim.js";

export function rc4Gorgon(data, key) {
  const s = new Uint8Array(256);
  for (let i = 0; i < 256; i++) s[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + s[i] + key[i % key.length]) & 255;
    s[i] = s[j];
  }
  const out = Buffer.alloc(data.length);
  let i = 0;
  j = 0;
  for (let n = 0; n < data.length; n++) {
    i++;
    const x = s[i & 255];
    j += x;
    const y = s[j & 255];
    s[i & 255] = y;
    out[n] = data[n] ^ s[(y + y) & 255];
  }
  return out;
}

export function xGorgon(query, body, hasBody, khronos, random) {
  const queryMD5 = md5Raw(Buffer.from(query, "utf8"));
  let bodyMD5 = Buffer.alloc(16);
  if (hasBody) bodyMD5 = md5Raw(body);
  const input = Buffer.concat([
    queryMD5.subarray(0, 4),
    bodyMD5.subarray(0, 4),
    Buffer.from([0, 0, 0, 0]),
    le32(gorgonSDKVersion),
    be32(khronos >>> 0),
  ]);
  const r = random >>> 0;
  const key = Buffer.from([
    0x4a, 0x40, 0x16, (r >>> 8) & 255, 0x47, 0x6c, 0x01, r & 255,
  ]);
  const out = rc4Gorgon(input, key);
  const n = out.length;
  for (let i = 0; i < n; i++) {
    const value = out[i];
    const swapped = ((value >> 4) | (value << 4)) & 0xff;
    const next = i + 1 < n ? out[i + 1] : out[0];
    out[i] = (~(bitReverse(next ^ swapped) ^ 20)) & 0xff;
  }
  const result = Buffer.concat([
    Buffer.from([0x84, 0x04, r & 255, (r >>> 8) & 255, 0x40, 0x01]),
    out,
  ]);
  return result.toString("hex");
}

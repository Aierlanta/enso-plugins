import { xGorgon } from "./gorgon.js";
import { assembleHelios } from "./helios.js";
import { assembleMedusa } from "./medusa.js";
import { be32, le32, md5Raw } from "./prim.js";
import { sm3 } from "./sm3.js";
import { branchOf } from "./f13.js";
import { randomBytes } from "node:crypto";

const UNRESERVED = "-_.!~*'()";

export function encodeComponent(value) {
  const bytes = Buffer.from(String(value), "utf8");
  let out = "";
  for (const c of bytes) {
    const alpha = (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0x30 && c <= 0x39);
    if (alpha || UNRESERVED.includes(String.fromCharCode(c))) out += String.fromCharCode(c);
    else out += "%" + c.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

export function encodeQuery(pairs) {
  return pairs.map(([k, v]) => encodeComponent(k) + "=" + encodeComponent(v)).join("&");
}

export function drawEntropy(nowMillis) {
  const buf = randomBytes(16);
  const n = buf.readBigUInt64LE(0);
  return {
    EnvLaunch: 100 + Number(n % 21n),
    EnvPID: 10001 + (buf.readUInt16LE(8) % 2000),
    NowSecs: Math.trunc(Number(nowMillis) / 1000),
    MessageRandom: buf.readUInt32LE(0) >>> 0,
    Random: buf.readUInt32LE(4) >>> 0,
    PackedRandom: buf.readUInt32LE(8) >>> 0,
    GorgonRandom: buf.readUInt16LE(12),
    HeliosRandom: buf.readUInt32LE(12) >>> 0,
  };
}

function copyEntropy(entropy, nowMillis) {
  if (entropy == null) return drawEntropy(nowMillis);
  return {
    EnvLaunch: entropy.EnvLaunch ?? 0,
    EnvPID: entropy.EnvPID ?? 0,
    NowSecs: entropy.NowSecs ?? 0,
    MessageRandom: entropy.MessageRandom ?? 0,
    Random: entropy.Random ?? 0,
    PackedRandom: entropy.PackedRandom ?? 0,
    GorgonRandom: entropy.GorgonRandom ?? 0,
    HeliosRandom: entropy.HeliosRandom ?? 0,
  };
}

export function signRequest(path, pairs, nowMillis, deviceID, versionName, body, entropy) {
  const ent = copyEntropy(entropy, nowMillis);
  const hasBody = body != null;
  let bodyMD5 = Buffer.alloc(16);
  if (hasBody) bodyMD5 = md5Raw(body);
  const base = BigInt(nowMillis);
  let query = "";
  let ticket = 0n;
  let khronos = 0;
  for (let offset = 0n; offset < 32n; offset++) {
    ticket = base + offset;
    khronos = Number(ticket / 1000n) >>> 0;
    const withTicket = pairs.map(([k, v]) => [k, v]);
    withTicket.push(["ts", String(khronos)]);
    withTicket.push(["_rticket", ticket.toString()]);
    query = encodeQuery(withTicket);
    const sum = sm3(Buffer.from(query, "utf8"));
    if (branchOf(sum, bodyMD5, le32(khronos)) !== 1) break;
  }
  if (ent.NowSecs === 0) ent.NowSecs = khronos;
  const rawURL = "https://reading.snssdk.com" + path + "?" + query;
  const headers = {
    Accept: "application/json; charset=utf-8,application/x-protobuf",
    "x-xs-from-web": "0",
    "x-ss-req-ticket": ticket.toString(),
    "x-tt-request-tag": "t=0;n=0",
    "sdk-version": "2",
    "passport-sdk-version": "50561",
    "x-vc-bdturing-sdk-version": "3.7.2.cn",
    "x-khronos": String(khronos),
    "x-ladon": be32(khronos).toString("base64"),
    "x-argus": le32(khronos).toString("base64"),
    "x-gorgon": xGorgon(query, body, hasBody, khronos, ent.GorgonRandom >>> 0),
    "x-helios": assembleHelios(khronos, ent.HeliosRandom >>> 0),
    "x-medusa": assembleMedusa(rawURL, body, hasBody, khronos, deviceID, versionName, ent),
    "x-tt-dt": "",
  };
  if (hasBody) {
    headers["Content-Type"] = "application/json; charset=UTF-8";
    headers["x-ss-stub"] = md5Raw(body).toString("hex").toUpperCase();
  }
  return { query, headers };
}

export function signGET(pairs, nowMillis, deviceID, versionName, entropy) {
  return signRequest("/reading/bookapi/search/tab/v", pairs, nowMillis, deviceID, versionName, null, entropy);
}

export function signPOST(path, pairs, nowMillis, deviceID, versionName, body, entropy) {
  return signRequest(path, pairs, nowMillis, deviceID, versionName, body, entropy);
}

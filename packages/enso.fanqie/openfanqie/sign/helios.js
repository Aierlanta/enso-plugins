import { appID, channelID } from "./const.js";
import { add64, le32, md5Raw, ror64 } from "./prim.js";

export function diffuse(words) {
  const table = [words[0]];
  let b0 = words[0];
  let b8 = words[1];
  const queue = words.slice(2);
  for (let i = 0n; i < 34n; i++) {
    let x8 = add64(ror64(b8, 8n), b0) ^ i;
    queue.push(x8);
    x8 ^= ror64(b0, 61n);
    table.push(x8);
    b0 = x8;
    b8 = queue[0];
    queue.shift();
  }
  return table;
}

export function heliosPad(khronos) {
  const text = Buffer.from(String(khronos >>> 0) + "-" + channelID + "-" + appID, "utf8");
  const fill = 16 - (text.length % 16);
  const size = Math.floor((text.length + 1 + 15) / 16) * 16;
  const out = Buffer.alloc(size, fill);
  text.copy(out);
  return out;
}

export function assembleHelios(khronos, random) {
  const r = random >>> 0;
  const seed = Buffer.concat([le32(r), Buffer.from(appID, "utf8")]);
  const digest = md5Raw(seed);
  const ascii = Buffer.from(digest.toString("hex"), "latin1");
  const words = [];
  for (let i = 0; i < 4; i++) words.push(ascii.readBigUInt64LE(i * 8));
  const table = diffuse(words);
  const padded = heliosPad(khronos);
  const output = [];
  for (let off = 0; off < padded.length; off += 16) {
    let a = padded.readBigUInt64LE(off);
    let b = padded.readBigUInt64LE(off + 8);
    for (const t of table.slice(0, 34)) {
      b = t ^ add64(a, ror64(b, 8n));
      a = b ^ ror64(a, 61n);
    }
    const ab = Buffer.alloc(16);
    ab.writeBigUInt64LE(a, 0);
    ab.writeBigUInt64LE(b, 8);
    output.push(ab);
  }
  return Buffer.concat([le32(r), ...output]).toString("base64");
}

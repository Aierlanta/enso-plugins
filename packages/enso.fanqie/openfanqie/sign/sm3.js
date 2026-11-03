import { rol32 } from "./prim.js";

function sm3FF(j, x, y, z) {
  if (j < 16) return (x ^ y ^ z) >>> 0;
  return ((x & y) | (x & z) | (y & z)) >>> 0;
}

function sm3GG(j, x, y, z) {
  if (j < 16) return (x ^ y ^ z) >>> 0;
  return ((x & y) | (~x & z)) >>> 0;
}

function sm3P0(x) {
  return (x ^ rol32(x, 9) ^ rol32(x, 17)) >>> 0;
}

function sm3P1(x) {
  return (x ^ rol32(x, 15) ^ rol32(x, 23)) >>> 0;
}

function sm3Pad(msg) {
  const bitLen = BigInt(msg.length) * 8n;
  const parts = [msg, Buffer.from([0x80])];
  let len = msg.length + 1;
  while ((len + 8) % 64 !== 0) {
    parts.push(Buffer.from([0]));
    len++;
  }
  const lenb = Buffer.alloc(8);
  lenb.writeBigUInt64BE(bitLen, 0);
  parts.push(lenb);
  return Buffer.concat(parts);
}

export function sm3(msg) {
  const h = [
    0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600,
    0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e,
  ];
  const padded = sm3Pad(Buffer.from(msg));
  const w = new Array(68);
  const wp = new Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    const block = padded.subarray(off, off + 64);
    for (let i = 0; i < 16; i++) w[i] = block.readUInt32BE(i * 4) >>> 0;
    for (let j = 16; j < 68; j++) {
      const x = (w[j - 16] ^ w[j - 9] ^ rol32(w[j - 3], 15)) >>> 0;
      w[j] = (sm3P1(x) ^ rol32(w[j - 13], 7) ^ w[j - 6]) >>> 0;
    }
    for (let j = 0; j < 64; j++) wp[j] = (w[j] ^ w[j + 4]) >>> 0;
    let a = h[0];
    let b = h[1];
    let c = h[2];
    let d = h[3];
    let e = h[4];
    let f = h[5];
    let g = h[6];
    let hh = h[7];
    for (let j = 0; j < 64; j++) {
      const tj = j < 16 ? 0x79cc4519 : 0x7a879d8a;
      const ss1 = rol32((rol32(a, 12) + e + rol32(tj, j)) >>> 0, 7);
      const ss2 = (ss1 ^ rol32(a, 12)) >>> 0;
      const tt1 = (sm3FF(j, a, b, c) + d + ss2 + wp[j]) >>> 0;
      const tt2 = (sm3GG(j, e, f, g) + hh + ss1 + w[j]) >>> 0;
      d = c;
      c = rol32(b, 9);
      b = a;
      a = tt1;
      hh = g;
      g = rol32(f, 19);
      f = e;
      e = sm3P0(tt2);
    }
    h[0] = (h[0] ^ a) >>> 0;
    h[1] = (h[1] ^ b) >>> 0;
    h[2] = (h[2] ^ c) >>> 0;
    h[3] = (h[3] ^ d) >>> 0;
    h[4] = (h[4] ^ e) >>> 0;
    h[5] = (h[5] ^ f) >>> 0;
    h[6] = (h[6] ^ g) >>> 0;
    h[7] = (h[7] ^ hh) >>> 0;
  }
  const out = Buffer.alloc(32);
  for (let i = 0; i < 8; i++) out.writeUInt32BE(h[i], i * 4);
  return out;
}

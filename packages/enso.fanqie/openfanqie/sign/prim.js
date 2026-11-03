import { createHash } from "node:crypto";

const MASK64 = (1n << 64n) - 1n;

export function u32(value) {
  return value >>> 0;
}

export function rol32(value, count) {
  const n = count & 31;
  const v = value >>> 0;
  if (n === 0) return v;
  return ((v << n) | (v >>> (32 - n))) >>> 0;
}

export function ror32(value, count) {
  const n = count & 31;
  const v = value >>> 0;
  if (n === 0) return v;
  return ((v >>> n) | (v << (32 - n))) >>> 0;
}

export function ror64(value, count) {
  const v = BigInt(value) & MASK64;
  const n = BigInt(count) & 63n;
  if (n === 0n) return v;
  return ((v >> n) | (v << (64n - n))) & MASK64;
}

export function add64(a, b) {
  return (BigInt(a) + BigInt(b)) & MASK64;
}

export function bitReverse(value) {
  let result = 0;
  for (let i = 0; i < 8; i++) {
    result = ((result << 1) | ((value >> i) & 1)) & 0xff;
  }
  return result;
}

export function zigzag(value) {
  const v = BigInt(value);
  const left = (v << 1n) & MASK64;
  const sign = v < 0n ? MASK64 : 0n;
  return left ^ sign;
}

export function le32(value) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(value >>> 0, 0);
  return buf;
}

export function be32(value) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(value >>> 0, 0);
  return buf;
}

export function le64(value) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value) & MASK64, 0);
  return buf;
}

export function md5Raw(value) {
  return createHash("md5").update(value).digest();
}

export function getIV(iv, data) {
  let value = iv >>> 0;
  for (let i = 0; i < data.length; i++) {
    const b = data[i];
    if ((i & 1) === 0) {
      value = ((value >>> 4) ^ value ^ (value << 6) ^ b) >>> 0;
      continue;
    }
    const inner = ((value >>> 7) ^ value ^ (b | (value << 12))) >>> 0;
    value = (~inner) >>> 0;
  }
  return value;
}

export function sumMD5(data) {
  let check = 0x20220420;
  for (let i = 0; i < 12; i++) {
    let temp;
    if ((i & 1) === 0) {
      temp = ((check >>> 3) ^ check) >>> 0;
      check = (data[i] ^ (check << 7)) >>> 0;
    } else {
      temp = ((check >>> 5) ^ check) >>> 0;
      check = (~(data[i] | (check << 11))) >>> 0;
    }
    check = (check ^ temp) >>> 0;
  }
  return ((check | 4) ^ 0x01000000) >>> 0;
}

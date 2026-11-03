import { branch2Orders, branch2SV } from "./const.js";
import { getIV, le32, rol32, ror32, sumMD5 } from "./prim.js";

const branch0IV = [0xc4a78580, 0xb3c0fd39, 0xc58c5686, 0xc9aa3ba7, 0xf5a7adf2, 0x963c2ed1];

const branch0TT = [
  0xebb64faf, 0x07aadcc2, 0xcf3187bf, 0xe01138ff, 0x6d0bfcff, 0x5a30a3be, 0xb41ad638, 0x34180eb8,
  0xf233eb6f, 0xb1a584cc, 0xccc30dc7, 0x47d1db51, 0xd55653de, 0x70a84fa1, 0x57473c12, 0xf76f0288,
  0x2c077f0a, 0xda0dcad0, 0xfbb86f6c, 0xfdc4cf00, 0x688a020d, 0xe676c6a6, 0x8cd6338b, 0x1a3c8d0e,
  0xcce8b06b, 0x6ad0ed0b, 0xa0522717, 0xdc71ac83, 0x2285db71, 0xd5b4dda6, 0x736f8650, 0x6560306c,
  0x617ce2a6, 0xe423417e, 0x0a40e143, 0x544e4032, 0x88dffb2a, 0x716c1ae0, 0x4c467a88, 0x05b23bb3,
  0xe1d0b866, 0xbaa3dcb8, 0xae3374d3, 0xc3381a50, 0x1702f75b, 0xfe6da368, 0xf0b4cf48, 0x4e0ffbb8,
  0x72aad10d, 0x26c53a3d, 0xf2bce0f6, 0xb4557581, 0x4a257fdd, 0x8c3182a2, 0xab0b3b86, 0x3d5dfb14,
  0x4f103634, 0xd37b52d7, 0x444eff16, 0xeb0a33d1, 0x6ca86f6e, 0x00284ba7, 0x08387cfa, 0x5fb37586,
];

const branch0Init = [
  0x7aba4fc8, 0x67166507, 0x6403fa00, 0x340f512f,
  984304912, 3005047866, 2874125293, 2152413264,
];

const branch0Rounds = [
  [101, 5, 7, 6, 3, 2, 1, 0, 5, 4, 3],
  [96, 0, 6, 7, 5, 3, 2, 1, 5, 4, 4],
  [96, 7, 6, 2, 1, 4, 0, 5, 4, 3, 5],
  [99, 3, 6, 2, 4, 5, 1, 0, 0, 7, 6],
  [96, 0, 5, 6, 7, 3, 1, 2, 5, 4, 4],
  [100, 2, 0, 3, 5, 4, 6, 7, 2, 1, 5],
];

export function branchOf(query, bodyMD5, ts) {
  let iv = getIV(0x20230928, query);
  iv = getIV(iv, bodyMD5);
  iv = getIV(iv, ts);
  const low = iv & 15;
  return (low - (((low * 171) >>> 9) * 3)) >>> 0;
}

function expandWords(data) {
  const di = [];
  for (let off = 0; off + 4 <= data.length; off += 4) di.push(data.readUInt32BE(off) >>> 0);
  let di0 = di[0];
  for (let i = 0; i < 112; i++) {
    const di1 = di[i + 1];
    const di14 = di[i + 14];
    const r1 = (rol32(di1, 14) ^ rol32(di1, 25) ^ (di1 >>> 3)) >>> 0;
    const r2 = (rol32(di14, 13) ^ rol32(di14, 15) ^ (di14 >>> 10)) >>> 0;
    di.push((di0 + di[i + 9] + r1 + r2) >>> 0);
    di0 = di1;
  }
  return di;
}

function mixRounds(state, rounds, di, tt, ivV1) {
  for (let i = 0; i < rounds[0]; i++) {
    const base = (ivV1 + i) >>> 0;
    const w = di[base & 127];
    const idx = (k) => rounds[k];
    const n1 = (((state[idx(3)] ^ state[idx(4)]) & state[idx(1)]) ^ state[idx(3)]) >>> 0;
    const n2 = (rol32(state[idx(1)], 26) ^ rol32(state[idx(1)], 21) ^ rol32(state[idx(1)], 7)) >>> 0;
    const n4 = (w + n1 + n2 + tt[base & 63] + state[idx(5)]) >>> 0;
    const n5 = (rol32(state[idx(2)], 30) ^ rol32(state[idx(2)], 19) ^ rol32(state[idx(2)], 10)) >>> 0;
    const n6 = ((state[idx(2)] & state[idx(6)]) | ((state[idx(2)] | state[idx(6)]) & state[idx(7)])) >>> 0;
    const n7 = (n5 + n6) >>> 0;
    const old = state[idx(9)];
    const last = state[state.length - 1];
    state = [last, ...state.slice(0, -1)];
    state[idx(10)] = (n7 + n4) >>> 0;
    state[idx(8)] = (old + n4) >>> 0;
  }
  return state;
}

function branch0F13(querySM3, bodyMD5, ts, khronos, ivV0) {
  const ivV1 = branch0IV[Math.min(ivV0, branch0IV.length - 1)] >>> 0;
  const countV1 = (ivV1 + khronos + 1) & 255;
  const countV2 = (ivV1 + khronos) >>> 0;
  const tt = branch0TT.map((v) => ror32(v, countV1));
  const n0 = (countV2 + 2) & 7;
  const seed = [0xfa, 0x45, 0x61, 0xd7];
  const pad = Buffer.alloc(seed.length);
  for (let i = 0; i < seed.length; i++) {
    const combined = seed[i] | (seed[i] << 8);
    pad[i] = (combined >> n0) & 255;
  }
  const data = Buffer.concat([
    querySM3,
    bodyMD5,
    ts,
    pad,
    Buffer.from("00000000000001a0", "hex"),
  ]);
  const di = expandWords(data);
  const init = branch0Init.map((v) => ror32(v, countV2 & 31));
  const d = mixRounds(init.slice(), branch0Rounds[ivV0], di, tt, ivV1);
  const ret = Buffer.alloc(32);
  for (let i = 0; i < 8; i++) ret.writeUInt32BE((d[i] + init[i]) >>> 0, i * 4);
  for (let i = 0; i < 16; i++) ret[i] ^= ret[16 + i];
  return Buffer.concat([ret.subarray(0, 16), le32(sumMD5(ret.subarray(0, 16)))]);
}

function md5V3Step(kind, a, b, c, d, m, shift, constant) {
  let f;
  if (kind === 0) f = ((b & c) | (~b & d)) >>> 0;
  else if (kind === 1) f = ((b & d) | (c & ~d)) >>> 0;
  else if (kind === 2) f = (b ^ c ^ d) >>> 0;
  else f = (c ^ (b | ~d)) >>> 0;
  return (b + rol32((a + f + m + constant) >>> 0, shift)) >>> 0;
}

function md5SumV3(message, countV2, orders, countV1) {
  const sv = branch2SV.map((v) => ror32(v, countV1));
  const start = [
    ror32(0x79e0f2fb, countV2),
    ror32(0xc8b52570, countV2),
    ror32(0xebc2f8cd, countV2),
    ror32(0x7c104d93, countV2),
  ];
  const endCount = (countV2 + 6) & 255;
  const end = [
    ror32(0x19be4866, endCount),
    ror32(0xe85986b4, endCount),
    ror32(0xe19b326e, endCount),
    ror32(0x71d1d7d4, endCount),
  ];
  const m = [];
  for (let i = 0; i < 16; i++) m.push(message.readUInt32LE(i * 4) >>> 0);
  let a = start[0];
  let b = start[1];
  let c = start[2];
  let d = start[3];
  const run = (kind, shifts, offset) => {
    for (let i = 0; i < 16; i++) {
      const phase = i & 3;
      const w = m[orders[offset + i]];
      const k = sv[offset + i];
      if (phase === 0) a = md5V3Step(kind, a, b, c, d, w, shifts[i], k);
      else if (phase === 1) d = md5V3Step(kind, d, a, b, c, w, shifts[i], k);
      else if (phase === 2) c = md5V3Step(kind, c, d, a, b, w, shifts[i], k);
      else b = md5V3Step(kind, b, c, d, a, w, shifts[i], k);
    }
  };
  run(0, [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22], 0);
  run(1, [5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20], 16);
  run(2, [4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23], 32);
  run(3, [6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21], 48);
  const words = Buffer.concat([
    le32((((start[0] + a) >>> 0) ^ end[0]) >>> 0),
    le32((((start[1] + b) >>> 0) ^ end[1]) >>> 0),
    le32((((start[2] + c) >>> 0) ^ end[2]) >>> 0),
    le32((((start[3] + d) >>> 0) ^ end[3]) >>> 0),
  ]);
  return Buffer.concat([words, le32(sumMD5(words))]);
}

function branch2F13(iv, querySM3, bodyMD5, ts, khronos) {
  const v = (iv & 13) * 86;
  const ivV0 = (((v >>> 15) & 255) + ((v >>> 8) & 255)) >>> 0;
  const n1s = [0x8980f29b, 0xeb549c7f, 0xb08726db, 0xd40cb5e6, 0xe8f559e4];
  const n1 = n1s[Math.min(ivV0, n1s.length - 1)] >>> 0;
  const countV1 = (n1 + khronos + 1) & 255;
  const countV2 = (n1 + khronos) >>> 0;
  const shift = (countV2 + 5) & 7;
  const seed = [0x84, 0x96, 0x77, 0x9d, 0xd4, 0x15, 0x0b, 0xf8];
  const pad = Buffer.alloc(seed.length);
  for (let i = 0; i < seed.length; i++) {
    const combined = seed[i] | (seed[i] << 8);
    pad[i] = (combined >> shift) & 255;
  }
  const input = Buffer.concat([
    querySM3,
    bodyMD5,
    ts,
    pad,
    Buffer.from("a0010000", "hex"),
  ]);
  const all = branch2Orders();
  const begin = ivV0 << 6;
  return md5SumV3(input, countV2, all.subarray(begin, begin + 64), countV1);
}

export function hashF13(querySM3, bodyMD5, ts, khronos) {
  let iv = getIV(0x20230928, querySM3);
  iv = getIV(iv, bodyMD5);
  iv = getIV(iv, ts);
  const low = iv & 15;
  const ivV0 = (low * 171) >>> 9;
  const branch = (low - ivV0 * 3) >>> 0;
  if (branch === 2) return branch2F13(iv, querySM3, bodyMD5, ts, khronos >>> 0);
  if (branch !== 0) {
    const summed = Buffer.concat([querySM3, bodyMD5]);
    return Buffer.concat([querySM3.subarray(0, 16), bodyMD5, le32(sumMD5(summed))]);
  }
  return branch0F13(querySM3, bodyMD5, ts, khronos >>> 0, ivV0);
}

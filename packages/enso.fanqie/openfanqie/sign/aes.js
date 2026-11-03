import { medusaAESIV, medusaAESKey, sbox } from "./const.js";

const aesCon2 = [
  [1, 0, 2, 3],
  [2, 0, 3, 1],
  [0, 1, 3, 2],
  [1, 0, 2, 3],
];

const aesOrder = [
  [0, 9, 14, 11, 4, 13, 2, 7, 8, 1, 6, 15, 12, 5, 10, 3],
  [0, 9, 14, 15, 4, 13, 2, 7, 8, 1, 6, 3, 12, 5, 10, 11],
  [0, 9, 14, 7, 4, 13, 2, 11, 8, 1, 6, 3, 12, 5, 10, 15],
  [0, 9, 14, 11, 4, 13, 2, 7, 8, 1, 6, 15, 12, 5, 10, 3],
];

const aesInitWord = [0xca025ddc, 0x823dc546, 0xc9420583, 0xc298225f];

function xorBytes(a, b) {
  const out = Buffer.from(a);
  for (let i = 0; i < out.length; i++) out[i] ^= b[i % b.length];
  return out;
}

function expandAES(key, word) {
  const init = aesInitWord[word] >>> 0;
  const all = sbox();
  const box = all.subarray(word * 256, word * 256 + 256);
  const le = Buffer.alloc(4);
  le.writeUInt32LE(init, 0);
  const initial = Buffer.alloc(16);
  for (let i = 0; i < 4; i++) le.copy(initial, i * 4);
  const expanded = Buffer.alloc(48);
  for (let i = 0; i < 16; i++) expanded[i] = initial[i] ^ key[i];
  let rounds = 8;
  for (let i = 4; i < 12; i++) {
    const at = 4 * (i - 1);
    let a = expanded[at];
    let b = expanded[at + 1];
    let c = expanded[at + 2];
    let d = expanded[at + 3];
    if ((i & 3) === 0) {
      const t = (((init >>> (rounds & 24)) ^ box[b]) & 255);
      b = box[c];
      c = box[d];
      d = box[a];
      a = t;
    }
    rounds = (rounds + 2) >>> 0;
    expanded[at + 4] = a ^ expanded[at - 12];
    expanded[at + 5] = b ^ expanded[at - 11];
    expanded[at + 6] = c ^ expanded[at - 10];
    expanded[at + 7] = d ^ expanded[at - 9];
  }
  const keys = [];
  for (let i = 0; i < 12; i++) {
    keys.push([expanded[i * 4], expanded[i * 4 + 1], expanded[i * 4 + 2], expanded[i * 4 + 3]]);
  }
  return keys;
}

function addCon(state, keys, con2) {
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      state[i][j] ^= keys[i][con2[j]];
    }
  }
}

function sub(a, state) {
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) state[i][j] = a.box[state[i][j]];
  }
  const old = state.map((row) => row.slice());
  for (let i = 0; i < 4; i++) state[i] = old[a.con2[i]].slice();
}

function shift(a, state) {
  const flat = new Array(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) flat[i * 4 + j] = state[i][j];
  }
  for (let i = 0; i < 16; i++) state[(i / 4) | 0][i % 4] = flat[a.order[i]];
}

function shiftCon(state, con2) {
  const old = state.map((row) => row.slice());
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) state[i][j] = old[i][con2[j]];
  }
}

function xt(x) {
  let v = (x << 1) & 0xff;
  if ((x & 128) !== 0) v ^= 0x1b;
  return v;
}

function mixColumns(state) {
  for (let i = 0; i < 4; i++) {
    const t = state[0][i] ^ state[1][i] ^ state[2][i] ^ state[3][i];
    const u = state[0][i];
    state[0][i] ^= t ^ xt(state[0][i] ^ state[1][i]);
    state[1][i] ^= t ^ xt(state[1][i] ^ state[2][i]);
    state[2][i] ^= t ^ xt(state[2][i] ^ state[3][i]);
    state[3][i] ^= t ^ xt(state[3][i] ^ u);
  }
}

function block(a, value) {
  const state = [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) state[i][j] = value[i * 4 + j];
  }
  const keys = a.keys;
  addCon(state, keys.slice(0, 4), a.con2);
  for (let i = 1; i < 3; i++) {
    sub(a, state);
    shift(a, state);
    if (i === 1) {
      shiftCon(state, a.con2);
      mixColumns(state);
    }
    addCon(state, keys.slice(i * 4, i * 4 + 4), a.con2);
  }
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) state[i][j] ^= keys[4 + i][j];
  }
  const out = Buffer.alloc(16);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) out[i * 4 + j] = state[i][j];
  }
  return out;
}

function newAESV3(key, khronos) {
  const word = khronos & 3;
  const all = sbox();
  return {
    box: all.subarray(word * 256, word * 256 + 256),
    con2: aesCon2[word],
    order: aesOrder[word],
    keys: expandAES(key, word),
  };
}

export function aesEncrypt(data, iv, khronos) {
  const source = Buffer.from(data);
  const plaintext = Buffer.alloc(32);
  for (let i = 0; i < 31; i++) {
    const at = i * 8;
    const n0 = (source[at] >> 4) & 2;
    const n1 = n0 | (source[at + 1] & 64);
    const n2 = n1 | ((source[at + 2] >> 2) & 1);
    const n3 = n2 | (((source[at + 3] << 3) & 0xff) & 128);
    const n4 = n3 | ((source[at + 4] >> 1) & 4);
    const n5 = n4 | (((source[at + 5] << 3) & 0xff) & 16);
    const n6 = n5 | (((source[at + 6] << 5) & 0xff) & 32);
    plaintext[i] = n6 | ((source[at + 7] >> 4) & 8);
  }
  plaintext[31] = 1;
  const aes = newAESV3(medusaAESKey(), khronos >>> 0);
  let previous = Buffer.from(iv);
  const blocks = [];
  for (let off = 0; off < 32; off += 16) {
    const value = block(aes, xorBytes(plaintext.subarray(off, off + 16), previous));
    blocks.push(value);
    previous = value;
  }
  const blockBytes = Buffer.concat(blocks);
  const out = source;
  for (let i = 0; i < 31; i++) {
    const at = i * 8;
    const k = blockBytes[i];
    out[at] = (out[at] & 0xdf) | ((k << 4) & 32);
    out[at + 1] = (out[at + 1] & 0xbf) | (k & 64);
    out[at + 2] = (out[at + 2] & 0xfb) | ((k << 2) & 4);
    out[at + 3] = (out[at + 3] & 0xef) | ((k >> 3) & 16);
    out[at + 4] = (out[at + 4] & 0xf7) | (((k + k) & 0xff) & 8);
    out[at + 5] = (out[at + 5] & 0xfd) | ((k >> 3) & 2);
    out[at + 6] = (out[at + 6] & 0xfe) | ((k >> 5) & 1);
    out[at + 7] = (out[at + 7] & 0x7f) | ((k << 4) & 128);
  }
  return Buffer.concat([Buffer.from([blockBytes[31]]), out]);
}

export function encryptMedusa(data, khronos) {
  return aesEncrypt(data, medusaAESIV(), khronos);
}

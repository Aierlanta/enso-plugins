import { zigzag } from "./prim.js";

export function varint(value) {
  let v = BigInt(value);
  const out = [];
  while (v > 127n) {
    out.push(Number((v & 127n) | 128n));
    v >>= 7n;
  }
  out.push(Number(v));
  return Buffer.from(out);
}

function protoKey(tag, wire) {
  return varint((BigInt(tag) << 3n) | BigInt(wire));
}

export function protoBytes(tag, body) {
  if (body == null || body.length === 0) return Buffer.alloc(0);
  const data = Buffer.from(body);
  return Buffer.concat([protoKey(tag, 2), varint(BigInt(data.length)), data]);
}

export function protoString(tag, s) {
  return protoBytes(tag, Buffer.from(s, "utf8"));
}

export function protoSInt(tag, value) {
  return Buffer.concat([protoKey(tag, 0), varint(zigzag(value))]);
}

export function protoFloat(tag, value) {
  const bits = Buffer.alloc(4);
  bits.writeFloatLE(value, 0);
  return Buffer.concat([protoKey(tag, 5), bits]);
}

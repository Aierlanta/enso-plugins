import { createCipheriv, createHash } from "node:crypto";

const ttEncryptConstant = Buffer.from("4dd4c2e6b83162090e52b3c7a6733ba41cb2462b829ab58a196b39db57177524f49baf7f08e8d68d26a72e37c1a95a2f1f05a51892aef2949732b62a38aadd58", "hex");
const ttEncryptPrefix = Buffer.from("3176c9b6d71579d7e82179c9e7cbde787b54d541bad3b15f2e8fed92293fa25a", "hex");

function sha512(data) {
  return createHash("sha512").update(data).digest();
}

export function ttEncrypt(input) {
  const prefixHash = sha512(ttEncryptPrefix);
  const keyIV = sha512(Buffer.concat([prefixHash, ttEncryptConstant]));
  const digest = sha512(input);
  const plain = Buffer.concat([digest, Buffer.from(input)]);
  const padding = 16 - (plain.length % 16);
  const padded = Buffer.alloc(plain.length + padding, padding);
  plain.copy(padded);
  const cipher = createCipheriv("aes-128-cbc", keyIV.subarray(0, 16), keyIV.subarray(16, 32));
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
  return Buffer.concat([Buffer.from([0x74, 0x63, 0x05, 0x10, 0x00, 0x00]), ttEncryptPrefix, encrypted]);
}

export const TTEncrypt = ttEncrypt;

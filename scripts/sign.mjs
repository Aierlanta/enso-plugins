import { createPrivateKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { knownOptions, repoRoot } from './lib.mjs';

export function normalizePem(raw) {
  const text = String(raw).replace(/\\n/g, '\n').trim();
  if (!text.includes('-----BEGIN')) throw new Error('ENSO_MARKET_PRIVATE_KEY 必须是 PKCS8 PEM');
  return `${text}\n`;
}

export function signIndex(bytes, pem) {
  const key = createPrivateKey(normalizePem(pem));
  if (key.asymmetricKeyType !== 'ed25519') throw new Error('ENSO_MARKET_PRIVATE_KEY 必须是 Ed25519 私钥');
  return sign(null, bytes, key).toString('base64');
}

export function signRepo(root, pem = process.env.ENSO_MARKET_PRIVATE_KEY) {
  if (!pem) throw new Error('缺少环境变量 ENSO_MARKET_PRIVATE_KEY');
  const bytes = readFileSync(join(root, 'out/v1/index.json'));
  const signature = signIndex(bytes, pem);
  writeFileSync(join(root, 'out/v1/index.json.sig'), `${signature}\n`);
  return signature;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = knownOptions(process.argv, ['--root']);
    signRepo(resolve(options.root ?? repoRoot));
    process.stdout.write('已签名 out/v1/index.json\n');
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

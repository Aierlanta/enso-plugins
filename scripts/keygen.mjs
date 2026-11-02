import { generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { knownOptions } from './lib.mjs';

export function createMarketKey() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = knownOptions(process.argv, ['--private-out']);
    const { publicPem, privatePem } = createMarketKey();
    if (options['private-out']) writeFileSync(options['private-out'], privatePem, { mode: 0o600 });
    else process.stderr.write(privatePem);
    process.stdout.write(publicPem);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

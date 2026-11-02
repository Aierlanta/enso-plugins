import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildRepo, knownOptions, repoRoot } from './lib.mjs';

export async function main(argv = process.argv) {
  const options = knownOptions(argv, ['--root']);
  const { index } = await buildRepo(resolve(options.root ?? repoRoot));
  process.stdout.write(`sequence ${index.sequence}，${index.plugins.length} 个插件\n`);
  return index;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

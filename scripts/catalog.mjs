import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogMarkdown, readExternals, readPackages, readmeWithCatalog, repoRoot } from './lib.mjs';
import { fetchExternals } from './external.mjs';

export async function main(root = repoRoot) {
  await fetchExternals(root);
  const { packages, errors } = await readPackages(root);
  if (errors.length) throw new Error(errors.join('\n'));
  const path = join(root, 'README.md');
  await writeFile(path, readmeWithCatalog(await readFile(path, 'utf8'), catalogMarkdown(packages, await readExternals(root))));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

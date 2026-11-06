// 把 GramJS 打成单文件放进插件包：插件不允许带 node_modules 里的 .node 原生模块
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

await build({
  entryPoints: [here('entry.mjs')],
  outfile: here('../../packages/enso.tgclient/vendor/gramjs.mjs'),
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  minify: true,
  legalComments: 'eof',
  alias: { bufferutil: here('stub/bufferutil.cjs'), 'utf-8-validate': here('stub/utf-8-validate.cjs') },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});

// 侧栏边下边播：mp4box 把普通 MP4 边收边转成 MSE 能吃的分段
await build({
  stdin: { contents: "export { createFile } from 'mp4box';", resolveDir: here('.'), loader: 'js' },
  outfile: here('../../packages/enso.tgclient/vendor/mp4box.js'),
  bundle: true,
  format: 'iife',
  globalName: 'MP4Box',
  platform: 'browser',
  target: 'chrome110',
  minify: true,
  legalComments: 'eof',
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseExternal } from '../scripts/external.mjs';

test('外部插件声明必须固定完整 commit，path 不能越界', () => {
  const commit = 'a'.repeat(40);
  assert.deepEqual(parseExternal({ repo: 'o/r', commit, path: 'enso' }, 'dsh.bce'), { repo: 'o/r', commit, path: 'enso' });
  assert.ok(parseExternal({ repo: 'o/r', commit: 'main' }, 'dsh.bce').errors);
  assert.ok(parseExternal({ repo: 'https://x', commit }, 'dsh.bce').errors);
  assert.ok(parseExternal({ repo: 'o/r', commit, path: '../x' }, 'dsh.bce').errors);
  assert.ok(parseExternal({ repo: 'o/r', commit }, 'Bad').errors);
});

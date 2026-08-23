import assert from 'node:assert/strict';
import {
  filesToWebContainerTree,
  webContainersSupported,
  webContainerPreviewEnabled,
} from './src/services/webcontainer-runner.ts';

// Flat path list → nested WebContainer FileSystemTree.
const tree: any = filesToWebContainerTree([
  { path: 'package.json', content: '{"name":"x"}' },
  { path: 'src/App.tsx', content: 'export default ()=>null' },
  { path: 'src/lib/data.ts', content: 'export const x=1' },
  { path: './index.html', content: '<html></html>' },
]);

// Root files.
assert.equal(tree['package.json'].file.contents, '{"name":"x"}');
assert.equal(tree['index.html'].file.contents, '<html></html>', 'leading ./ stripped');
// Nested directory.
assert.ok(tree.src.directory, 'src is a directory');
assert.equal(tree.src.directory['App.tsx'].file.contents, 'export default ()=>null');
assert.ok(tree.src.directory.lib.directory, 'src/lib is a nested directory');
assert.equal(tree.src.directory.lib.directory['data.ts'].file.contents, 'export const x=1');

// Two files in the same dir share one directory node.
const tree2: any = filesToWebContainerTree([
  { path: 'src/a.ts', content: 'a' },
  { path: 'src/b.ts', content: 'b' },
]);
assert.deepEqual(Object.keys(tree2.src.directory).sort(), ['a.ts', 'b.ts']);

// Empty / malformed paths are skipped.
const tree3: any = filesToWebContainerTree([
  { path: '', content: 'x' },
  { path: '   ', content: 'y' },
  { path: 'ok.ts', content: 'z' },
]);
assert.deepEqual(Object.keys(tree3), ['ok.ts']);

// Support detection is false in Node (no crossOriginIsolated / window).
assert.equal(webContainersSupported(), false);
assert.equal(webContainerPreviewEnabled(), false);

console.log('test-webcontainer-runner passed');

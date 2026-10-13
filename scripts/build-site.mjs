import { mkdir, copyFile, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'public');
await mkdir(output, { recursive: true });
// Publish only browser assets and season/search indexes. The complete player
// database stays in the server function bundle, outside the static output.
for (const file of ['index.html', 'player.html', 'config.json']) {
  await copyFile(path.join(root, file), path.join(output, file));
}
for (const directory of ['assets', 'data']) {
  await cp(path.join(root, directory), path.join(output, directory), { recursive: true });
}
console.log('网站静态文件已生成到 public/；完整球员库由单球员 API 读取。');

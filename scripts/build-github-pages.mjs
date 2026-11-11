import {spawnSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {normalizeBasePath} from './lib/static-paths.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const basePath = normalizeBasePath(process.env.SITE_BASE_PATH ?? '/nba-advanced-top30');
for (const script of ['add-player-basic', 'add-estimated-raptor-playoffs', 'build-player-index',
  'build-player-profiles', 'build-player-honors', 'build-site', 'build-static-mirror', 'verify-static-mirror']) {
  const result = spawnSync(process.execPath, [`scripts/${script}.mjs`], {
    cwd: root, env: {...process.env, SITE_BASE_PATH: basePath}, stdio: 'inherit'
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
const commit = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'});
if (commit.status !== 0) throw new Error('Cannot identify deployed source');
await writeFile(path.join(root, 'dist-cn/deployment.json'), JSON.stringify({
  schema_version: 1, provider: 'github-pages', base_path: basePath, source_commit: commit.stdout.trim()
}) + '\n');

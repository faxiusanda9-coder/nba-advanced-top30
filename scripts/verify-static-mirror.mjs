import {readFile, readdir, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist-cn');
const read = async relative => readFile(path.join(output, relative), 'utf8');
const database = JSON.parse(await readFile(path.join(root, 'api/_data/players.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(root, 'data/games/manifest.json'), 'utf8'));
const index = await read('index.html');
const profileJs = await read('assets/player-profile.js');
if (index.includes('cdn.nba.com/headshots') || profileJs.includes('cdn.nba.com/headshots') ||
    profileJs.includes('/api/player?slug=')) throw new Error('Mirror still uses a foreign runtime image or Vercel API');
for (const player of database.players) {
  const payload = JSON.parse(await read(`data/player-profiles/${player.slug}.json`));
  if (payload.player.player_id !== player.player_id || payload.career.player_id !== player.player_id ||
      payload.honors.player_id !== player.player_id) throw new Error(`${player.slug}: profile mismatch`);
  await stat(path.join(output, 'player', player.slug, 'index.html'));
}
for (const id of Object.keys(manifest.games)) await stat(path.join(output, 'game', id, 'index.html'));
for (const route of ['daily-games', 'advanced-guide', 'current-season']) await stat(path.join(output, route, 'index.html'));
let fileCount = 0, bytes = 0, largest = 0;
const walk = async directory => {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(file);
    else {const size = (await stat(file)).size; fileCount++; bytes += size; largest = Math.max(largest, size);}
  }
};
await walk(output);
if (fileCount > 20000 || largest > 25 * 1024 * 1024) throw new Error('EdgeOne free asset limit exceeded');
console.log(JSON.stringify({profiles: database.players.length, game_routes: Object.keys(manifest.games).length,
  files: fileCount, total_mb: +(bytes / 1048576).toFixed(1), largest_mb: +(largest / 1048576).toFixed(2),
  runtime_player_api: false, runtime_nba_images: false}, null, 2));

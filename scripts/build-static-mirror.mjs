import {cp, mkdir, readFile, readdir, realpath, rm, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {normalizeBasePath, rebaseStaticPaths} from './lib/static-paths.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(root, 'dist-cn');
const basePath = normalizeBasePath(process.env.SITE_BASE_PATH || '');
const rootReal = await realpath(root);
if (output !== path.join(root, 'dist-cn')) throw new Error('Unexpected mirror output path');
try {
  const current = await realpath(output);
  if (!current.startsWith(`${rootReal}${path.sep}`)) throw new Error('Mirror output resolves outside repository');
} catch (error) {if (error.code !== 'ENOENT') throw error;}
await rm(output, {recursive: true, force: true});
await cp(path.join(root, 'public'), output, {recursive: true});

async function replaceOnce(file, original, replacement) {
  const target = path.join(output, file);
  const source = await readFile(target, 'utf8');
  if (!source.includes(original)) throw new Error(`${file}: expected dependency not found`);
  await writeFile(target, source.replace(original, replacement));
}

await replaceOnce('index.html',
  'https://cdn.nba.com/headshots/nba/latest/260x190/${playerId}.png',
  '/assets/player-headshots/${playerId}.png');
await replaceOnce('assets/player-profile.js',
  'https://cdn.nba.com/headshots/nba/latest/260x190/${player.player_id}.png',
  '/assets/player-headshots/${player.player_id}.png');
await replaceOnce('assets/player-profile.js',
  '/api/player?slug=${encodeURIComponent(slug)}',
  '/data/player-profiles/${encodeURIComponent(slug)}.json');

// Transform the shared pages before copying their individual static routes.
for (const entry of await readdir(output, {withFileTypes: true})) {
  if (entry.isFile() && entry.name.endsWith('.html')) {
    const file = path.join(output, entry.name);
    await writeFile(file, rebaseStaticPaths(await readFile(file, 'utf8'), basePath));
  }
}
async function rebaseAssets(directory) {
  for (const entry of await readdir(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await rebaseAssets(file);
    else if (/\.(?:js|mjs|css)$/.test(entry.name))
      await writeFile(file, rebaseStaticPaths(await readFile(file, 'utf8'), basePath));
  }
}
if (basePath) await rebaseAssets(path.join(output, 'assets'));

const database = JSON.parse(await readFile(path.join(root, 'api/_data/players.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(root, 'data/games/manifest.json'), 'utf8'));
if (!Array.isArray(database.players) || !manifest.games) throw new Error('Source archives unavailable');
const playerPage = path.join(output, 'player.html');
const gamePage = path.join(output, 'game.html');
const profileDirectory = path.join(output, 'data/player-profiles');
await mkdir(profileDirectory, {recursive: true});
const ids = new Set(), slugs = new Set();
let cursor = 0;
await Promise.all(Array.from({length: 16}, async () => {
  while (cursor < database.players.length) {
    const player = database.players[cursor++];
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(player.slug) ||
        !/^\d+$/.test(String(player.player_id)) || ids.has(player.player_id) || slugs.has(player.slug))
      throw new Error(`Invalid or duplicate player identity: ${player.slug}`);
    ids.add(player.player_id); slugs.add(player.slug);
    const id = player.player_id;
    const career = JSON.parse(await readFile(path.join(root, 'api/_data/profiles', `${id}.json`), 'utf8'));
    const honors = JSON.parse(await readFile(path.join(root, 'api/_data/honors', `${id}.json`), 'utf8'));
    if (career.player_id !== id || honors.player_id !== id || !Array.isArray(honors.records))
      throw new Error(`${id}: profile identity mismatch`);
    const {popularity_components, ...profile} = player;
    const payload = {player: profile, career, honors};
    await writeFile(path.join(profileDirectory, `${player.slug}.json`), `${JSON.stringify(payload)}\n`);
    const route = path.join(output, 'player', player.slug);
    await mkdir(route, {recursive: true});
    await cp(playerPage, path.join(route, 'index.html'));
  }
}));

const gameIds = Object.keys(manifest.games);
for (const id of gameIds) {
  if (!/^\d{10}$/.test(id)) throw new Error(`Invalid NBA game ID: ${id}`);
  const route = path.join(output, 'game', id);
  await mkdir(route, {recursive: true});
  await cp(gamePage, path.join(route, 'index.html'));
}
for (const route of ['daily-games', 'advanced-guide', 'current-season']) {
  const target = path.join(output, route);
  await mkdir(target, {recursive: true});
  await cp(path.join(output, `${route}.html`), path.join(target, 'index.html'));
}
await writeFile(path.join(output, '.nojekyll'), '');
console.log(JSON.stringify({output, base_path: basePath, static_profiles: database.players.length, static_game_routes: gameIds.length}));

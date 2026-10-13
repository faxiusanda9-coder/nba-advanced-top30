import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeName, nameSlug } from '../assets/player-search-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const firstYear = 1997, lastYear = 2026;
const databaseFile = path.join(root, 'api', '_data', 'players.json');
const indexFile = path.join(root, 'data', 'player-index.json');
const scoring = JSON.parse(await readFile(path.join(root, 'config', 'player-popularity.json'), 'utf8'));
if (!Number.isInteger(scoring.version) || scoring.version < 1 || !Array.isArray(scoring.recency_factors)
    || scoring.recency_factors.some(value => !Number.isFinite(value) || value < 0)
    || Object.values(scoring.weights).some(value => !Number.isFinite(value) || value < 0)) {
  throw new Error('球员热度评分配置需要有效版本和非负数值');
}
const available = new Set(await readdir(path.join(root, 'data')));
for (let year = firstYear; year <= lastYear; year++) if (!available.has(`${year}.json`)) {
  throw new Error(`缺少 ${year}.json，停止生成不完整球员库`);
}
let previous = { players: [] };
try { previous = JSON.parse(await readFile(databaseFile, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!Array.isArray(previous.players)) throw new Error('已有球员库格式异常');
const previousSlugs = new Map(previous.players.map(player => [String(player.player_id), player.slug]));
const grouped = new Map();
const numeric = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
const label = year => `${year - 1}-${String(year % 100).padStart(2, '0')}`;

for (let year = firstYear; year <= lastYear; year++) {
  const archive = JSON.parse(await readFile(path.join(root, 'data', `${year}.json`), 'utf8'));
  if (archive.endingYear !== year || !Array.isArray(archive.rows?.REG) || !Array.isArray(archive.rows?.PST)) {
    throw new Error(`${year}: 赛季档案结构异常`);
  }
  for (const phase of ['REG', 'PST']) {
    const seen = new Set();
    for (const row of archive.rows[phase]) {
      const id = String(row.playerId || '').trim(), name = String(row.PLAYER_NAME || '').trim();
      if (!id || !name) throw new Error(`${year} ${phase}: 球员缺少 ID 或姓名`);
      if (seen.has(id)) throw new Error(`${year} ${phase}: 球员 ${id} 重复，不能重复累计贡献`);
      seen.add(id);
      if (!grouped.has(id)) grouped.set(id, { id, name, aliases: new Set(), first: year, last: year,
        teams: new Map(), positions: new Set(), regular: [], playoffs: [] });
      const player = grouped.get(id);
      player.name = name;
      player.aliases.add(name);
      player.last = Math.max(player.last, year);
      const team = String(row.TEAM_ABBREVIATION || '').trim();
      if (team) {
        if (!player.teams.has(team)) player.teams.set(team, new Set());
        player.teams.get(team).add(year);
        player.lastTeam = team;
      }
      const position = row.PLAYER_POSITION || row.POSITION || row.position;
      if (position) player.positions.add(String(position));
      player[phase === 'REG' ? 'regular' : 'playoffs'].push({ year, games: numeric(row.GP) || 0,
        minutes: numeric(row.MIN) || 0, vorp: numeric(row.VORP), ws: numeric(row.WS),
        bpm: numeric(row.BPM), per: numeric(row.PER) });
    }
  }
}

function popularity(player) {
  const sum = (rows, key) => rows.reduce((total, row) => total + (row[key] ?? 0), 0);
  const peakRows = player.regular.filter(row => row.games >= scoring.peak_min_games && row.minutes >= scoring.peak_min_minutes);
  const peak = key => Math.max(0, ...peakRows.map(row => row[key] ?? 0));
  const latest = player.regular.at(-1);
  const gap = latest ? lastYear - latest.year : lastYear - player.last;
  const recency = scoring.recency_factors[gap] || 0;
  const meaningfulRecent = latest && latest.games >= scoring.recent_min_games && latest.minutes >= scoring.recent_min_minutes;
  const w = scoring.weights;
  const components = {
    historical: w.career_vorp_log * Math.log1p(Math.max(0, sum(player.regular, 'vorp')))
      + w.career_ws_log * Math.log1p(Math.max(0, sum(player.regular, 'ws'))),
    peak: w.peak_bpm * peak('bpm') + w.peak_per_above_average * Math.max(0, peak('per') - 15),
    playoffs: w.playoff_vorp_log * Math.log1p(Math.max(0, sum(player.playoffs, 'vorp')))
      + w.playoff_ws_log * Math.log1p(Math.max(0, sum(player.playoffs, 'ws'))),
    recent: recency * (w.recent_activity + (meaningfulRecent
      ? w.recent_bpm * Math.max(0, latest.bpm ?? 0) + w.recent_per_above_average * Math.max(0, (latest.per ?? 15) - 15) : 0))
  };
  return { score: Number(Object.values(components).reduce((a, b) => a + b, 0).toFixed(3)),
    components: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, Number(value.toFixed(3))])) };
}

const baseSlugs = new Map();
for (const player of grouped.values()) {
  const base = nameSlug(player.name) || `player-${player.id}`;
  if (!baseSlugs.has(base)) baseSlugs.set(base, []);
  baseSlugs.get(base).push(player.id);
}
const usedSlugs = new Set();
for (const player of grouped.values()) {
  const saved = previousSlugs.get(player.id);
  if (!saved) continue;
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(saved) || usedSlugs.has(saved)) throw new Error('已有球员主页 slug 无效或重复');
  usedSlugs.add(saved);
}
const players = [...grouped.values()].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })).map(player => {
  const base = nameSlug(player.name) || `player-${player.id}`;
  let slug = previousSlugs.get(player.id);
  if (!slug) {
    slug = baseSlugs.get(base).length > 1 || usedSlugs.has(base) ? `${base}-${player.id}` : base;
    if (usedSlugs.has(slug)) throw new Error(`球员 slug 冲突：${slug}`);
    usedSlugs.add(slug);
  }
  const heat = popularity(player);
  return {
    player_id: player.id, full_name: player.name, normalized_name: normalizeName(player.name), slug,
    aliases: [...player.aliases].filter(name => name !== player.name).sort(),
    team_history: [...player.teams].map(([team, years]) => ({ team, seasons: [...years].sort((a, b) => a - b).map(label) }))
      .sort((a, b) => a.seasons[0].localeCompare(b.seasons[0]) || a.team.localeCompare(b.team)),
    career_range: { first_season: label(player.first), last_season: label(player.last), scope: 'observed_archive' },
    position: player.positions.size ? [...player.positions].join('/') : null,
    last_team: player.lastTeam || null, popularity_score: heat.score,
    popularity_components: heat.components
  };
});
const meta = { schema_version: 1, coverage: { first_season: label(firstYear), last_season: label(lastYear),
  source_files: lastYear - firstYear + 1, population: 'players appearing in season-stat archives' },
  player_count: players.length, popularity: { ...scoring, inputs: ['regular-season VORP/WS', 'qualified peak BPM/PER',
    'playoff VORP/WS', 'recent archive activity and impact'] } };
const database = { ...meta, players };
const index = { schema_version: 1, coverage: meta.coverage, player_count: players.length, scoring_version: scoring.version,
  players: players.map(player => ({ player_id: player.player_id, full_name: player.full_name,
    normalized_name: player.normalized_name, slug: player.slug, popularity_score: player.popularity_score,
    last_team: player.last_team, last_season: player.career_range.last_season,
    ...(player.aliases.length ? { aliases: player.aliases } : {}) }))
    .sort((a, b) => b.popularity_score - a.popularity_score || a.full_name.localeCompare(b.full_name, 'en')) };
await mkdir(path.dirname(databaseFile), { recursive: true });
await writeFile(databaseFile, `${JSON.stringify(database)}\n`, 'utf8');
await writeFile(indexFile, `${JSON.stringify(index)}\n`, 'utf8');
console.log(`球员库：${players.length} 人；轻量索引 ${(Buffer.byteLength(JSON.stringify(index)) / 1024).toFixed(1)} KiB`);
console.log('初始排序：', index.players.slice(0, 10).map(player => `${player.full_name} ${player.popularity_score}`).join('；'));

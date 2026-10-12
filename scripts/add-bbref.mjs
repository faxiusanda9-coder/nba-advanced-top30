import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const sourceUrl = 'https://www.kaggle.com/api/v1/datasets/download/sumitrodatta/nba-aba-baa-stats/Advanced.csv';
const sourcePage = 'https://www.kaggle.com/datasets/sumitrodatta/nba-aba-baa-stats';
const fields = {
  per: 'PER', ows: 'OWS', dws: 'DWS', ws: 'WS', ws_48: 'WS_48',
  obpm: 'OBPM', dbpm: 'DBPM', bpm: 'BPM', vorp: 'VORP'
};

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const parseLine = line => {
    const cells = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index++) {
      const char = line[index];
      if (char === '"') {
        if (quoted && line[index + 1] === '"') { value += '"'; index++; }
        else quoted = !quoted;
      } else if (char === ',' && !quoted) {
        cells.push(value); value = '';
      } else value += char;
    }
    cells.push(value);
    return cells;
  };
  const headers = parseLine(lines.shift());
  for (const required of ['season', 'lg', 'player', 'team', 'g', 'mp', ...Object.keys(fields)]) {
    if (!headers.includes(required)) throw new Error(`Basketball Reference 档案缺少 ${required} 列`);
  }
  return lines.filter(Boolean).map(line => {
    const cells = parseLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
  });
}

function nameKey(name) {
  let key = String(name || '').replace(/[ёЁ]/g, 'e').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
  key = key.replace(/(?:iii|iv|ii|jr|sr)$/, '');
  return ({
    clarweatherspoon: 'clarenceweatherspoon',
    danschayes: 'dannyschayes',
    ikeaustin: 'isaacaustin',
    stevensmith: 'stevesmith',
    flipmurray: 'ronaldmurray',
    ronaldholland: 'ronholland'
  })[key] || key;
}

function findMatch(row, candidates) {
  // NBA Stats stores a traded player's full season on one row. Use BBRef's
  // combined 2TM/3TM row for that player, never a single-team fragment.
  const fullSeason = candidates.filter(item => /^\d+TM$/.test(item.team));
  const pool = fullSeason.length ? fullSeason : candidates;
  const exactGames = pool.filter(item => Number(item.g) === Number(row.GP));
  if (exactGames.length === 1) return exactGames[0];
  if (exactGames.length > 1) {
    const sameTeam = exactGames.filter(item => item.team === row.TEAM_ABBREVIATION);
    return sameTeam.length === 1 ? sameTeam[0] : null;
  }
  return null;
}

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const fileArg = args.find(arg => arg.startsWith('--file='));
const csv = fileArg
  ? await readFile(fileArg.slice('--file='.length), 'utf8')
  : await (async () => {
      const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`Basketball Reference 档案下载失败：HTTP ${response.status}`);
      return response.text();
    })();
const bySeason = new Map();
for (const item of parseCsv(csv)) {
  if (item.lg !== 'NBA') continue;
  const year = Number(item.season);
  if (year < 1997 || year > 2026) continue;
  if (!bySeason.has(year)) bySeason.set(year, new Map());
  const byName = bySeason.get(year);
  const key = nameKey(item.player);
  if (!byName.has(key)) byName.set(key, []);
  byName.get(key).push(item);
}

let totalMatched = 0;
for (let year = 1997; year <= 2026; year++) {
  const file = path.join(dataDir, `${year}.json`);
  const archive = JSON.parse(await readFile(file, 'utf8'));
  const names = bySeason.get(year);
  if (!names) throw new Error(`${year} 没有 Basketball Reference 常规赛数据，停止写入`);
  let matched = 0;
  const unmatched = [];
  for (const row of archive.rows.REG) {
    const match = findMatch(row, names.get(nameKey(row.PLAYER_NAME)) || []);
    for (const outputField of Object.values(fields)) delete row[outputField];
    if (!match) { unmatched.push(row.PLAYER_NAME); continue; }
    for (const [inputField, outputField] of Object.entries(fields)) {
      const number = Number(match[inputField]);
      if (match[inputField] !== '' && Number.isFinite(number)) row[outputField] = number;
    }
    matched++;
  }
  archive.basketballReferenceSource = { ...archive.basketballReferenceSource, REG: sourcePage };
  totalMatched += matched;
  console.log(`${year}: 常规赛匹配 ${matched}/${archive.rows.REG.length}；未匹配 ${unmatched.length}${unmatched.length && dryRun ? `（${unmatched.slice(0, 15).join('、')}）` : ''}`);
  if (!dryRun) await writeFile(file, `${JSON.stringify(archive)}\n`, 'utf8');
}
console.log(`合计匹配 ${totalMatched} 条常规赛记录。`);

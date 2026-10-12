import { readFile, writeFile } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const sourcePage = 'https://www.kaggle.com/datasets/robertsunderhaft/nba-playoffs';
const sourceUrl = 'https://www.kaggle.com/api/v1/datasets/download/robertsunderhaft/nba-playoffs';
const fields = {
  per: 'PER', ows: 'OWS', dws: 'DWS', ws: 'WS', ws_per_48: 'WS_48',
  obpm: 'OBPM', dbpm: 'DBPM', bpm: 'BPM', vorp: 'VORP'
};

function firstZipFile(zip) {
  if (zip.readUInt32LE(0) !== 0x04034b50) throw new Error('季后赛档案不是 ZIP');
  const flags = zip.readUInt16LE(6);
  const method = zip.readUInt16LE(8);
  if (flags & 1 || flags & 8 || method !== 8) throw new Error('季后赛 ZIP 压缩格式不支持');
  const nameLength = zip.readUInt16LE(26);
  const extraLength = zip.readUInt16LE(28);
  const name = zip.subarray(30, 30 + nameLength).toString('utf8');
  if (name !== 'playoffStats.csv') throw new Error(`季后赛档案文件名变化：${name}`);
  let compressedSize = zip.readUInt32LE(18);
  if (compressedSize === 0xffffffff) {
    let position = 30 + nameLength;
    const end = position + extraLength;
    while (position + 4 <= end) {
      const id = zip.readUInt16LE(position);
      const size = zip.readUInt16LE(position + 2);
      if (id === 1) {
        const value = zip.readBigUInt64LE(position + 12); // ZIP64: uncompressed, then compressed
        if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('季后赛档案过大');
        compressedSize = Number(value);
        break;
      }
      position += 4 + size;
    }
  }
  if (compressedSize === 0xffffffff) throw new Error('季后赛 ZIP 缺少文件长度');
  const start = 30 + nameLength + extraLength;
  return inflateRawSync(zip.subarray(start, start + compressedSize)).toString('utf8');
}

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  function parseLine(line) {
    const cells = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (quoted && line[i + 1] === '"') { cell += '"'; i++; }
        else quoted = !quoted;
      } else if (char === ',' && !quoted) {
        cells.push(cell); cell = '';
      } else cell += char;
    }
    cells.push(cell);
    return cells;
  }
  const headers = parseLine(lines.shift());
  for (const required of ['season', 'player', 'team_id', 'g', 'mp', ...Object.keys(fields)]) {
    if (!headers.includes(required)) throw new Error(`季后赛档案缺少 ${required} 列`);
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
    ronaldholland: 'ronholland',
    omerask: 'omerasik',
    michaelsweetney: 'mikesweetney',
    slavamedvedenko: 'stanislavmedvedenko'
  })[key] || key;
}

function findMatch(row, candidates) {
  const exactGames = candidates.filter(item => Number(item.g) === Number(row.GP));
  if (exactGames.length === 1) return exactGames[0];
  if (exactGames.length > 1) {
    const sameTeam = exactGames.filter(item => item.team_id === row.TEAM_ABBREVIATION);
    if (sameTeam.length === 1) return sameTeam[0];
    const combined = exactGames.filter(item => /^\d+TM$/.test(item.team_id) || item.team_id === 'TOT');
    if (combined.length === 1) return combined[0];
  }
  return null;
}

const fileArg = process.argv.slice(2).find(arg => arg.startsWith('--file='));
const csv = fileArg
  ? await readFile(fileArg.slice('--file='.length), 'utf8')
  : await (async () => {
      const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`季后赛档案下载失败：HTTP ${response.status}`);
      return firstZipFile(Buffer.from(await response.arrayBuffer()));
    })();

const bySeason = new Map();
for (const item of parseCsv(csv)) {
  const year = Number(item.season);
  if (year < 1997 || year > 2022) continue;
  if (!bySeason.has(year)) bySeason.set(year, new Map());
  const names = bySeason.get(year);
  const key = nameKey(item.player);
  if (!names.has(key)) names.set(key, []);
  names.get(key).push(item);
}

for (let year = 1997; year <= 2022; year++) {
  const file = path.join(dataDir, `${year}.json`);
  const archive = JSON.parse(await readFile(file, 'utf8'));
  const names = bySeason.get(year);
  if (!names) throw new Error(`${year} 缺少季后赛数据，停止写入`);
  let matched = 0;
  for (const row of archive.rows.PST) {
    const match = findMatch(row, names.get(nameKey(row.PLAYER_NAME)) || []);
    for (const outputField of Object.values(fields)) delete row[outputField];
    if (!match) continue;
    for (const [inputField, outputField] of Object.entries(fields)) {
      const value = Number(match[inputField]);
      if (match[inputField] !== '' && Number.isFinite(value)) row[outputField] = value;
    }
    matched++;
  }
  archive.basketballReferenceSource = { ...archive.basketballReferenceSource, PST: sourcePage };
  await writeFile(file, `${JSON.stringify(archive)}\n`, 'utf8');
  console.log(`${year}: 季后赛匹配 ${matched}/${archive.rows.PST.length}`);
}

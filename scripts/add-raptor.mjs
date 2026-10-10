import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'data');
const sourceUrls = {
  estimated: 'https://raw.githubusercontent.com/Neil-Paine-1/NBA-elo/main/nba-estimated-raptor.csv'
};

function csvRows(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const parseLine = line => {
    const cells = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') { cell += '"'; i += 1; }
        else quoted = !quoted;
      } else if (ch === ',' && !quoted) {
        cells.push(cell); cell = '';
      } else cell += ch;
    }
    cells.push(cell);
    return cells;
  };
  const headers = parseLine(lines[0]);
  return lines.slice(1).map(line => {
    const cells = parseLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
  });
}

function numberOrNull(value) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function playerKey(value) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]/g, '');
}

function editDistance(left, right) {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= right.length; j += 1) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[right.length];
}

async function downloadCsv(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`下载 RAPTOR 档案失败（HTTP ${response.status}）：${url}`);
  return csvRows(await response.text());
}

const estimatedRows = await downloadCsv(sourceUrls.estimated);

const estimatedByYearTypeAndName = new Map();
for (const row of estimatedRows) {
  const type = row.Type === 'RS' ? 'REG' : row.Type === 'PO' ? 'PST' : '';
  if (!type) continue;
  const key = `${row.Year}|${type}|${playerKey(row.Player)}`;
  const minutes = numberOrNull(row.MP) ?? 0;
  const existing = estimatedByYearTypeAndName.get(key);
  if (!existing) {
    estimatedByYearTypeAndName.set(key, {
      minutes,
      offWeighted: (numberOrNull(row.eRO) ?? 0) * minutes,
      defWeighted: (numberOrNull(row.eRD) ?? 0) * minutes,
      totalWeighted: (numberOrNull(row.eRT) ?? 0) * minutes,
      war: numberOrNull(row.WAR) ?? 0
    });
  } else {
    existing.minutes += minutes;
    existing.offWeighted += (numberOrNull(row.eRO) ?? 0) * minutes;
    existing.defWeighted += (numberOrNull(row.eRD) ?? 0) * minutes;
    existing.totalWeighted += (numberOrNull(row.eRT) ?? 0) * minutes;
    existing.war += numberOrNull(row.WAR) ?? 0;
  }
}
const estimatedByYearAndType = new Map();
for (const [key, value] of estimatedByYearTypeAndName) {
  const [year, type, name] = key.split('|');
  const seasonTypeKey = `${year}|${type}`;
  if (!estimatedByYearAndType.has(seasonTypeKey)) estimatedByYearAndType.set(seasonTypeKey, []);
  estimatedByYearAndType.get(seasonTypeKey).push({ name, value });
}

function findEstimated(endingYear, type, identity) {
  const exact = estimatedByYearTypeAndName.get(`${endingYear}|${type}|${identity}`);
  if (exact) return exact;
  const candidates = (estimatedByYearAndType.get(`${endingYear}|${type}`) ?? [])
    .filter(candidate => Math.abs(candidate.name.length - identity.length) <= 2 &&
      candidate.name.slice(0, 3) === identity.slice(0, 3))
    .map(candidate => ({ ...candidate, distance: editDistance(identity, candidate.name) }))
    .filter(candidate => candidate.distance <= 2)
    .sort((a, b) => a.distance - b.distance);
  if (!candidates.length || (candidates[1] && candidates[1].distance === candidates[0].distance)) return null;
  return candidates[0].value;
}

const years = Array.from({ length: 30 }, (_, index) => 1997 + index);
let matchedEstimated = 0;
let rowsSeen = 0;

for (const endingYear of years) {
  const filePath = path.join(dataDir, `${endingYear}.json`);
  let archive;
  try {
    archive = JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') continue;
    throw error;
  }

  for (const type of ['REG', 'PST']) {
    for (const row of archive.rows?.[type] ?? []) {
      rowsSeen += 1;
      const identity = playerKey(row.PLAYER_NAME);
      for (const field of ['RAPTOR', 'RAPTOR_OFF', 'RAPTOR_DEF', 'RAPTOR_WAR', 'RAPTOR_538', 'RAPTOR_538_OFF', 'RAPTOR_538_DEF', 'RAPTOR_538_WAR', 'PREDATOR', 'PREDATOR_OFF', 'PREDATOR_DEF', 'PACE_IMPACT']) delete row[field];

      const estimated = findEstimated(endingYear, type, identity);
      if (estimated && estimated.minutes > 0) {
        row.EST_RAPTOR_OFF = numberOrNull(estimated.offWeighted / estimated.minutes);
        row.EST_RAPTOR_DEF = numberOrNull(estimated.defWeighted / estimated.minutes);
        row.EST_RAPTOR = numberOrNull(estimated.totalWeighted / estimated.minutes);
        row.EST_RAPTOR_WAR = numberOrNull(estimated.war);
        matchedEstimated += 1;
      } else {
        delete row.EST_RAPTOR_OFF;
        delete row.EST_RAPTOR_DEF;
        delete row.EST_RAPTOR;
        delete row.EST_RAPTOR_WAR;
      }
    }
  }

  archive.raptorSources = {
    estimated: endingYear <= 2025 ? 'Neil Paine Estimated RAPTOR; phase-specific; season ending 2025 has regular season only' : null
  };
  archive.supplementalSources = { ...archive.supplementalSources, raptor: archive.raptorSources.estimated };
  await writeFile(filePath, `${JSON.stringify(archive)}\n`, 'utf8');
}

console.log(`Estimated RAPTOR 合并完成：档案球员记录 ${rowsSeen} 条；匹配 ${matchedEstimated} 条。`);

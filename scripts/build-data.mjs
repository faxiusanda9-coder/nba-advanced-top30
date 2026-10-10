import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'data');
const releaseBase = 'https://github.com/sportsdataverse/sportsdataverse-data/releases/download/nba_stats_player_season_stats';
const timeoutMs = 45_000;

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

function numberOrNull(value, percent = false) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? (percent ? Number((number * 100).toFixed(3)) : number) : null;
}

function normalize(row) {
  return {
    PLAYER_NAME: row.player_name,
    TEAM_ABBREVIATION: row.team_abbreviation || '',
    GP: numberOrNull(row.gp),
    MIN: numberOrNull(row.min),
    OFF_RATING: numberOrNull(row.off_rating),
    DEF_RATING: numberOrNull(row.def_rating),
    NET_RATING: numberOrNull(row.net_rating),
    TS_PCT: numberOrNull(row.ts_pct, true),
    USG_PCT: numberOrNull(row.usg_pct, true),
    REB_PCT: numberOrNull(row.reb_pct, true),
    AST_PCT: numberOrNull(row.ast_pct, true),
    PIE: numberOrNull(row.pie),
    playerId: row.player_id || ''
  };
}

async function getSeasonCsv(endingYear) {
  const url = `${releaseBase}/player_season_stats_${endingYear}.csv`;
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`下载 ${endingYear} 档案失败：HTTP ${response.status}`);
  return response.text();
}

async function writeSeason(endingYear) {
  const rows = csvRows(await getSeasonCsv(endingYear));
  const advancedRows = rows.filter(row => row.measure_type === 'advanced' && row.per_mode === 'pergame');
  const data = {
    season: `${endingYear - 1}-${String(endingYear % 100).padStart(2, '0')}`,
    endingYear,
    source: 'NBA Stats via SportsDataverse archive',
    rows: {
      REG: advancedRows.filter(row => row.season_type === 'regular-season').map(normalize),
      PST: advancedRows.filter(row => row.season_type === 'playoffs').map(normalize)
    }
  };
  if (!data.rows.REG.length) throw new Error(`${endingYear} 未找到常规赛高级数据，未写入文件`);
  await writeFile(path.join(outputDir, `${endingYear}.json`), `${JSON.stringify(data)}\n`, 'utf8');
  return { endingYear, regular: data.rows.REG.length, playoffs: data.rows.PST.length };
}

await mkdir(outputDir, { recursive: true });
const args = new Set(process.argv.slice(2));
const yearArg = process.argv.find(arg => arg.startsWith('--year='));
let years;
if (yearArg) {
  years = [Number(yearArg.slice('--year='.length))];
} else if (args.has('--backfill')) {
  years = Array.from({ length: 30 }, (_, index) => 1997 + index);
} else {
  const now = new Date();
  const currentEndingYear = now.getUTCMonth() >= 8 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  years = [currentEndingYear];
}

for (const year of years) {
  if (!Number.isInteger(year) || year < 1997 || year > 2100) throw new Error(`无效的赛季结束年份：${year}`);
  try {
    const result = await writeSeason(year);
    console.log(`${result.endingYear}: 常规赛 ${result.regular} 人，季后赛 ${result.playoffs} 人`);
  } catch (error) {
    if (!args.has('--backfill') && error.message.includes('HTTP 404')) {
      console.log(`${year}: 当前赛季档案尚未发布，跳过。`);
      continue;
    }
    throw error;
  }
}

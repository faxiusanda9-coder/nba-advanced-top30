import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractBasic, applyBasic } from './lib/player-basic.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'data');
const releaseBase = 'https://github.com/sportsdataverse/sportsdataverse-data/releases/download/nba_stats_player_season_stats';
const raptorUrl = 'https://raw.githubusercontent.com/fivethirtyeight/data/master/nba-raptor/historical_RAPTOR_by_team.csv';
const timeoutMs = 45_000;
let raptorBySeasonPlayer = new Map();

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

function normalizePlayerName(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/[^a-z0-9]/g, '');
}

function numberValue(value) {
  const number = Number(value);
  return value === '' || value == null || !Number.isFinite(number) ? null : number;
}

function buildRaptorIndex(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const endingYear = Number(row.season);
    const type = row.season_type === 'RS' ? 'REG' : row.season_type === 'PO' ? 'PST' : '';
    const name = normalizePlayerName(row.player_name);
    if (!type || !name || !Number.isInteger(endingYear)) continue;
    const key = `${endingYear}|${type}|${name}`;
    if (!grouped.has(key)) grouped.set(key, { poss: 0, mp: 0, war: 0, rates: Object.create(null) });
    const total = grouped.get(key);
    const poss = numberValue(row.poss) || 0;
    total.poss += poss;
    total.mp += numberValue(row.mp) || 0;
    total.war += numberValue(row.war_total) || 0;
    for (const field of ['raptor_offense','raptor_defense','raptor_total','predator_offense','predator_defense','predator_total','pace_impact']) {
      const value = numberValue(row[field]);
      if (value == null) continue;
      const aggregate = total.rates[field] || (total.rates[field] = { weighted: 0, weight: 0 });
      aggregate.weighted += value * poss;
      aggregate.weight += poss;
    }
  }
  return new Map([...grouped].map(([key, total]) => [key, {
    RAPTOR: total.rates.raptor_total?.weight ? total.rates.raptor_total.weighted / total.rates.raptor_total.weight : null,
    RAPTOR_OFF: total.rates.raptor_offense?.weight ? total.rates.raptor_offense.weighted / total.rates.raptor_offense.weight : null,
    RAPTOR_DEF: total.rates.raptor_defense?.weight ? total.rates.raptor_defense.weighted / total.rates.raptor_defense.weight : null,
    RAPTOR_WAR: total.war,
    PREDATOR: total.rates.predator_total?.weight ? total.rates.predator_total.weighted / total.rates.predator_total.weight : null,
    PREDATOR_OFF: total.rates.predator_offense?.weight ? total.rates.predator_offense.weighted / total.rates.predator_offense.weight : null,
    PREDATOR_DEF: total.rates.predator_defense?.weight ? total.rates.predator_defense.weighted / total.rates.predator_defense.weight : null,
    PACE_IMPACT: total.rates.pace_impact?.weight ? total.rates.pace_impact.weighted / total.rates.pace_impact.weight : null
  }]));
}

function normalize(row, endingYear, type) {
  const extra = raptorBySeasonPlayer.get(`${endingYear}|${type}|${normalizePlayerName(row.player_name)}`) || {};
  return {
    PLAYER_NAME: row.player_name,
    TEAM_ABBREVIATION: row.team_abbreviation || '',
    GP: numberOrNull(row.gp),
    MIN: numberOrNull(row.min),
    OFF_RATING: numberOrNull(row.off_rating),
    DEF_RATING: numberOrNull(row.def_rating),
    NET_RATING: numberOrNull(row.net_rating),
    EFG_PCT: numberOrNull(row.efg_pct, true),
    TS_PCT: numberOrNull(row.ts_pct, true),
    USG_PCT: numberOrNull(row.usg_pct, true),
    E_USG_PCT: numberOrNull(row.e_usg_pct, true),
    AST_TO: numberOrNull(row.ast_to),
    AST_RATIO: numberOrNull(row.ast_ratio),
    OREB_PCT: numberOrNull(row.oreb_pct, true),
    DREB_PCT: numberOrNull(row.dreb_pct, true),
    REB_PCT: numberOrNull(row.reb_pct, true),
    AST_PCT: numberOrNull(row.ast_pct, true),
    E_TOV_PCT: numberOrNull(row.e_tov_pct, true),
    PACE: numberOrNull(row.pace),
    POSS: numberOrNull(row.poss),
    PIE: numberOrNull(row.pie),
    ...extra,
    playerId: row.player_id || ''
  };
}

async function loadRaptorData() {
  const response = await fetch(raptorUrl, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`下载 FiveThirtyEight RAPTOR 档案失败：HTTP ${response.status}`);
  raptorBySeasonPlayer = buildRaptorIndex(csvRows(await response.text()));
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
  const regularSeasonRows = advancedRows.filter(row => row.season_type === 'regular-season');
  const playoffRows = advancedRows.filter(row => row.season_type === 'playoffs');
  const data = {
    season: `${endingYear - 1}-${String(endingYear % 100).padStart(2, '0')}`,
    endingYear,
    source: 'NBA Stats via SportsDataverse archive',
    supplementalSources: {
      raptor: 'FiveThirtyEight historical_RAPTOR_by_team.csv (CC BY 4.0; coverage through 2021-22)'
    },
    rows: {
      REG: regularSeasonRows.map(row => normalize(row, endingYear, 'REG')),
      PST: playoffRows.map(row => normalize(row, endingYear, 'PST'))
    }
  };
  if (!data.rows.REG.length) throw new Error(`${endingYear} 未找到常规赛高级数据，未写入文件`);
  applyBasic(data, extractBasic(rows, endingYear));
  data.basicSource = { source: `${releaseBase}/player_season_stats_${endingYear}.csv`, units: 'per_game',
    join: 'NBA player_id + season + phase; verified GP/MIN' };
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

await loadRaptorData();
console.log(`已载入 FiveThirtyEight RAPTOR 附加档案：${raptorBySeasonPlayer.size} 个球员赛季记录`);

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

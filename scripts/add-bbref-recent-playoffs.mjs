import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotDir = path.join(root, 'sources', 'bbref-playoffs');
const api = 'https://api.server.nbaapi.com/api/playeradvancedstats';
const fields = {
  per: 'PER', offensiveWS: 'OWS', defensiveWS: 'DWS', winShares: 'WS',
  winSharesPer: 'WS_48', offensiveBox: 'OBPM', defensiveBox: 'DBPM',
  box: 'BPM', vorp: 'VORP'
};
const refresh = process.argv.includes('--refresh');

function nameKey(name) {
  const key = String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '').replace(/(?:iii|iv|ii|jr|sr)$/, '');
  return ({ ronaldholland: 'ronholland', natewilliams: 'jeenathanwilliams' })[key] || key;
}

function teamKey(team) {
  return ({ PHO: 'PHX', BRK: 'BKN', CHO: 'CHA' })[team] || team;
}

function validateRecords(records, year) {
  if (!Array.isArray(records) || records.length < 150) throw new Error(`${year}: 季后赛来源记录不完整`);
  const ids = new Set();
  for (const row of records) {
    if (row.season !== year || row.isPlayoff !== true || !row.playerId || !row.playerName ||
        !row.team || !Number.isInteger(row.games) || row.games < 1 || ids.has(row.playerId)) {
      throw new Error(`${year}: 季后赛来源的赛季、赛制或球员记录异常`);
    }
    ids.add(row.playerId);
    for (const key of Object.keys(fields)) {
      if (row[key] !== null && (typeof row[key] !== 'number' || !Number.isFinite(row[key]))) {
        throw new Error(`${year}: ${row.playerName} 的 ${key} 格式异常`);
      }
    }
  }
}

async function download(year, teams) {
  const records = [];
  async function request(team) {
    const params = new URLSearchParams({ season: String(year), isPlayoff: 'true', page: '1', pageSize: '50' });
    if (team) params.set('team', team);
    const response = await fetch(`${api}?${params}`, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const pagination = payload.pagination;
    if (!Array.isArray(payload.data) || !pagination || pagination.page !== 1 ||
        !Number.isInteger(pagination.pages) || pagination.pages < 1 || pagination.pages > 20 ||
        !Number.isInteger(pagination.total)) {
      throw new Error(`${year}: 季后赛 API 分页响应异常`);
    }
    if (team && (pagination.pages !== 1 || payload.data.length !== pagination.total ||
        payload.data.some(row => row.team !== team))) throw new Error(`${year}: ${team} 球队查询不完整`);
    return payload;
  }
  const total = (await request()).pagination.total;
  // Default sorting has ties at page boundaries and can duplicate/omit players.
  // Each playoff team's entire roster fits on one page, avoiding those ties.
  for (let start = 0; start < teams.length; start += 4) {
    const payloads = await Promise.all(teams.slice(start, start + 4).map(request));
    for (const payload of payloads) records.push(...payload.data.map(row => Object.fromEntries(
      ['playerId', 'playerName', 'team', 'games', 'minutesPlayed', 'season', 'isPlayoff', ...Object.keys(fields)]
        .map(key => [key, row[key] ?? null])
    )));
  }
  if (records.length !== total) throw new Error(`${year}: 季后赛 API 缺页`);
  validateRecords(records, year);
  records.sort((a, b) => a.playerId.localeCompare(b.playerId, 'en'));
  return {
    season: year, phase: 'PST',
    source: `${api}?season=${year}&isPlayoff=true`,
    reference: `https://www.basketball-reference.com/playoffs/NBA_${year}_advanced.html`,
    retrievedAt: new Date().toISOString(), records
  };
}

await mkdir(snapshotDir, { recursive: true });
// Prepare every season before writing: a failed download or mismatched join
// must not leave some seasons updated and others partially overwritten.
const updates = [];
for (let year = 2023; year <= 2026; year++) {
  const archiveFile = path.join(root, 'data', `${year}.json`);
  const archive = JSON.parse(await readFile(archiveFile, 'utf8'));
  const teams = [...new Set(archive.rows.PST.map(row =>
    ({ PHX: 'PHO', BKN: 'BRK', CHA: 'CHO' })[row.TEAM_ABBREVIATION] || row.TEAM_ABBREVIATION))];
  const snapshotFile = path.join(snapshotDir, `${year}.json`);
  let snapshot;
  let downloaded = false;
  if (refresh) {
    try { snapshot = await download(year, teams); downloaded = true; }
    catch (error) { console.warn(`${year}: API 未更新（${error.message}），使用已保存的季后赛快照`); }
  }
  snapshot ??= JSON.parse(await readFile(snapshotFile, 'utf8'));
  validateRecords(snapshot.records, year);
  if (snapshot.season !== year || snapshot.phase !== 'PST') throw new Error(`${year}: 快照赛季或赛制异常`);
  if (downloaded) {
    try {
      const previous = JSON.parse(await readFile(snapshotFile, 'utf8'));
      if (previous.source === snapshot.source && JSON.stringify(previous.records) === JSON.stringify(snapshot.records)) {
        snapshot.retrievedAt = previous.retrievedAt;
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const names = new Map();
  for (const row of snapshot.records) {
    const key = nameKey(row.playerName);
    if (!names.has(key)) names.set(key, []);
    names.get(key).push(row);
  }
  let matched = 0;
  const unmatched = [];
  const correctedTeams = [];
  for (const row of archive.rows.PST) {
    let candidates = (names.get(nameKey(row.PLAYER_NAME)) || []).filter(item => item.games === Number(row.GP));
    const sameTeam = candidates.filter(item => teamKey(item.team) === teamKey(row.TEAM_ABBREVIATION));
    if (sameTeam.length) candidates = sameTeam;
    else candidates = candidates.filter(item => Math.abs(item.minutesPlayed - Number(row.MIN) * Number(row.GP)) <= Number(row.GP) * 0.11 + 1);
    if (candidates.length !== 1) { unmatched.push(row.PLAYER_NAME); continue; }
    if (teamKey(candidates[0].team) !== teamKey(row.TEAM_ABBREVIATION)) {
      correctedTeams.push(`${row.PLAYER_NAME}: ${row.TEAM_ABBREVIATION}→${teamKey(candidates[0].team)}`);
      row.TEAM_ABBREVIATION = teamKey(candidates[0].team);
    }
    for (const [sourceField, outputField] of Object.entries(fields)) {
      const value = candidates[0][sourceField];
      if (value === null) delete row[outputField];
      else row[outputField] = value;
    }
    matched++;
  }
  if (matched < archive.rows.PST.length * 0.95) throw new Error(`${year}: 季后赛球员匹配率不足，停止写入`);
  archive.basketballReferenceSource = { ...archive.basketballReferenceSource, PST: snapshot.source };
  updates.push({ archiveFile, archive, snapshotFile, snapshot, downloaded });
  console.log(`${year}: 季后赛匹配 ${matched}/${archive.rows.PST.length}${unmatched.length ? `；未匹配：${unmatched.join('、')}` : ''}`);
  if (correctedTeams.length) console.log(`  更正季后赛所属球队：${correctedTeams.join('；')}`);
}
for (const { archiveFile, archive, snapshotFile, snapshot, downloaded } of updates) {
  if (downloaded) await writeFile(snapshotFile, `${JSON.stringify(snapshot)}\n`, 'utf8');
  await writeFile(archiveFile, `${JSON.stringify(archive)}\n`, 'utf8');
}

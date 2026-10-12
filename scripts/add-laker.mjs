import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotDir = path.join(root, 'sources', 'laker');
const year = 2026;
const referenceUrl = 'https://neilpaine.substack.com/p/2025-26-nba-elo-forecast-and-player';
const charts = { REG: 't5PSm', PST: '5L6UD' };
const fields = { offense: 'LAKER_OFF', defense: 'LAKER_DEF', total: 'LAKER', war: 'LAKER_WAR' };
const refresh = process.argv.includes('--refresh');

function playerKey(name) {
  const key = String(name).replace(/[ёЁ]/g, 'e').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/[^a-z0-9]/g, '');
  return ({ ronaldholland: 'ronholland', natewilliams: 'jeenathanwilliams',
    adamabal: 'adamaalphabal', trevonscott: 'trescott', nigelhayesdavis: 'nigelhayes' })[key] || key;
}

function validateSnapshot(snapshot, type) {
  if (snapshot.season !== year || snapshot.phase !== type || snapshot.model !== 'Neil Paine LAKER' ||
      !Array.isArray(snapshot.records) || snapshot.records.length < (type === 'REG' ? 300 : 150)) {
    throw new Error(`${type}: LAKER 来源赛季、赛制或记录数异常`);
  }
  const names = new Set();
  for (const row of snapshot.records) {
    const key = playerKey(row.playerName);
    if (!key || names.has(key) || !Number.isInteger(row.games) || row.games < 1 ||
        !Number.isFinite(row.minutes) || row.minutes <= 0 || !row.teams) {
      throw new Error(`${type}: LAKER 球员记录异常`);
    }
    names.add(key);
    for (const field of Object.keys(fields)) if (!Number.isFinite(row[field])) {
      throw new Error(`${type}: ${row.playerName} 的 ${field} 缺失`);
    }
    // The public table rounds some cells to one decimal or scientific
    // notation. Keep its published total and allow that rounding difference.
    if (Math.abs(row.offense + row.defense - row.total) > 0.15) {
      throw new Error(`${type}: ${row.playerName} 的 LAKER 总值与分项不一致`);
    }
  }
}

async function downloadSnapshot(type) {
  const id = charts[type];
  let chartUrl = `https://datawrapper.dwcdn.net/${id}/`;
  let html;
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(chartUrl, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`公开榜单 HTTP ${response.status}`);
    html = await response.text();
    // Published Datawrapper pages redirect to their current numbered version.
    const redirect = html.length < 1000 ? html.match(/url=(https:\/\/[^"'>\s]+)/)?.[1] : null;
    if (!redirect) break;
    const target = new URL(redirect);
    if (target.origin !== 'https://datawrapper.dwcdn.net' || !target.pathname.startsWith(`/${id}/`)) {
      throw new Error('公开榜单跳转到未知来源');
    }
    chartUrl = target.href;
  }
  const match = html.match(/window\.__DW_SVELTE_PROPS__\s*=\s*JSON\.parse\(("(?:\\.|[^"\\])*")\)/);
  if (!match) throw new Error('公开榜单页面结构变化');
  // Parse the public chart configuration as JSON; never execute page scripts.
  const props = JSON.parse(JSON.parse(match[1]));
  const updatedAt = props.chart?.metadata?.describe?.intro?.match(/Last updated:\s*<\/b>\s*([^\n<]+)/)?.[1]?.trim();
  const sourceDate = new Date(updatedAt);
  if (!updatedAt || !Number.isFinite(sourceDate.getTime()) ||
      sourceDate < new Date('2025-10-01T00:00:00Z') || sourceDate >= new Date('2026-07-01T00:00:00Z')) {
    throw new Error('公开榜单已切换赛季或缺少可核实的更新日期');
  }
  const asset = props.assets?.['dataset.csv'];
  if (!props.published || !asset?.load || !asset.url) throw new Error('公开榜单缺少已发布数据');
  const dataUrl = new URL(asset.url, chartUrl);
  if (dataUrl.origin !== 'https://datawrapper.dwcdn.net' || !dataUrl.pathname.startsWith(`/${id}/`)) {
    throw new Error('公开榜单的数据来源异常');
  }
  const response = await fetch(dataUrl, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`公开榜单数据 HTTP ${response.status}`);
  const lines = (await response.text()).replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const headerIndex = lines.findIndex(line => line.startsWith('Player\t'));
  if (headerIndex < 0 || !lines.slice(0, headerIndex).some(line => line.includes('LAKER'))) {
    throw new Error('公开榜单不是 LAKER 数据');
  }
  const headers = lines[headerIndex].split('\t');
  for (const column of ['Player', 'Team(s)', 'G', 'MP', 'Off', 'Def', 'Tot', 'WAR', 'WAR/82']) {
    if (!headers.includes(column)) throw new Error(`LAKER 榜单缺少 ${column}`);
  }
  const numeric = value => value?.trim() ? Number(value) : NaN;
  const records = lines.slice(headerIndex + 1).filter(Boolean).map(line => {
    const cells = line.split('\t');
    const row = Object.fromEntries(headers.map((header, i) => [header, cells[i]]));
    return { playerName: row.Player, teams: row['Team(s)'], games: numeric(row.G), minutes: numeric(row.MP),
      offense: numeric(row.Off), defense: numeric(row.Def), total: numeric(row.Tot),
      war: numeric(row.WAR), warPer82: numeric(row['WAR/82']) };
  }).sort((a, b) => playerKey(a.playerName).localeCompare(playerKey(b.playerName), 'en'));
  const snapshot = { season: year, phase: type, model: 'Neil Paine LAKER', referenceUrl,
    chartUrl, dataUrl: dataUrl.href, updatedAt, retrievedAt: new Date().toISOString(), records };
  validateSnapshot(snapshot, type);
  return snapshot;
}

await mkdir(snapshotDir, { recursive: true });
const archiveFile = path.join(root, 'data', `${year}.json`);
const archive = JSON.parse(await readFile(archiveFile, 'utf8'));
const updates = [];
for (const type of ['REG', 'PST']) {
  const snapshotFile = path.join(snapshotDir, `${year}-${type}.json`);
  let snapshot;
  let downloaded = false;
  if (refresh) {
    try { snapshot = await downloadSnapshot(type); downloaded = true; }
    catch (error) { console.warn(`${type}: LAKER 榜单未刷新（${error.message}），使用已保存快照`); }
  }
  snapshot ??= JSON.parse(await readFile(snapshotFile, 'utf8'));
  validateSnapshot(snapshot, type);
  if (downloaded) {
    try {
      const previous = JSON.parse(await readFile(snapshotFile, 'utf8'));
      if (previous.dataUrl === snapshot.dataUrl && previous.updatedAt === snapshot.updatedAt &&
          JSON.stringify(previous.records) === JSON.stringify(snapshot.records)) snapshot.retrievedAt = previous.retrievedAt;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const byName = new Map(snapshot.records.map(row => [playerKey(row.playerName), row]));
  let matched = 0;
  const unmatched = [];
  for (const row of archive.rows[type]) {
    const source = byName.get(playerKey(row.PLAYER_NAME));
    // Source minutes are rounded totals; site minutes are per game. Confirm
    // both games and time before joining, including known spelling aliases.
    if (!source || source.games !== Number(row.GP) ||
        Math.abs(source.minutes - Number(row.GP) * Number(row.MIN)) > Number(row.GP) * 0.11 + 1) {
      unmatched.push(row.PLAYER_NAME);
      continue;
    }
    for (const [input, output] of Object.entries(fields)) row[output] = source[input];
    matched++;
  }
  if (matched < archive.rows[type].length * 0.95) throw new Error(`${type}: LAKER 球员匹配率不足，停止写入`);
  updates.push({ type, snapshotFile, snapshot, downloaded });
  console.log(`2025–26 ${type}: LAKER 匹配 ${matched}/${archive.rows[type].length}${unmatched.length ? `；未匹配：${unmatched.join('、')}` : ''}`);
}
archive.raptorSources = { ...archive.raptorSources,
  laker: Object.fromEntries(updates.map(({ type, snapshot }) => [type, {
    model: snapshot.model, source: snapshot.chartUrl, updatedAt: snapshot.updatedAt
  }])) };
for (const { snapshotFile, snapshot, downloaded } of updates) {
  if (downloaded) await writeFile(snapshotFile, `${JSON.stringify(snapshot)}\n`, 'utf8');
}
await writeFile(archiveFile, `${JSON.stringify(archive)}\n`, 'utf8');

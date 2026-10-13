import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './lib/player-basic.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const snapshotFile = path.join(root, 'sources/estimated-raptor/2025-PST.json');
const archiveFile = path.join(root, 'data/2025.json');
const referenceUrl = 'https://neilpaine.substack.com/p/2024-25-nba-forecast';
const chartRoot = 'https://datawrapper.dwcdn.net/NHqDx/';
const fields = { offense: 'EST_RAPTOR_OFF', defense: 'EST_RAPTOR_DEF', total: 'EST_RAPTOR', war: 'EST_RAPTOR_WAR' };

function playerKey(name) {
  const key = String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/[^a-z0-9]/g, '');
  // NBA calls these players Nate Williams and Ronald Holland II.
  return ({ natewilliams: 'jeenathanwilliams', ronaldholland: 'ronholland' })[key] || key;
}

export function validateSnapshot(snapshot) {
  if (snapshot.season !== 2025 || snapshot.phase !== 'PST' || snapshot.model !== 'Neil Paine Estimated RAPTOR' ||
      !Array.isArray(snapshot.records) || snapshot.records.length !== 219 || snapshot.referenceUrl !== referenceUrl ||
      !snapshot.chartUrl?.startsWith(chartRoot) || snapshot.dataUrl !== `${snapshot.chartUrl}data.csv`) {
    throw new Error('2024–25 季后赛 Estimated RAPTOR 来源或覆盖范围异常');
  }
  // The chart gives a calendar date without a timezone; compare that date,
  // avoiding different results on Windows (UTC+8) and Actions (UTC).
  const sourceDay = snapshot.updatedAt?.match(/^[A-Za-z]{3}\.? \d{1,2}, \d{4}/)?.[0];
  const date = new Date(`${sourceDay} UTC`);
  if (!Number.isFinite(date.getTime()) || date < new Date('2025-06-23T00:00:00Z') || date >= new Date('2025-10-01T00:00:00Z')) {
    throw new Error('Estimated RAPTOR 榜单不是总决赛结束后的最终版本');
  }
  const ids = new Set(), names = new Set();
  for (const row of snapshot.records) {
    const key = playerKey(row.playerName);
    if (!/^\d+$/.test(row.player_id) || ids.has(row.player_id) || !key || names.has(key) ||
        !row.teams || !Number.isInteger(row.games) || row.games < 1 || row.games > 23 ||
        !Number.isFinite(row.minutes) || row.minutes <= 0 ||
        Object.keys(fields).some(field => !Number.isFinite(row[field])) ||
        // Public CSV cells sometimes use rounded scientific notation
        // (Landale's total is -2.43E+01). Preserve that published total.
        Math.abs(row.offense + row.defense - row.total) > 0.05) {
      throw new Error(`Estimated RAPTOR 球员记录异常：${row.playerName}`);
    }
    ids.add(row.player_id); names.add(key);
  }
  for (const id of ['1628983', '1630169']) {
    if (snapshot.records.find(row => row.player_id === id)?.games !== 23) {
      throw new Error('缺少 Gilgeous-Alexander / Haliburton 的完整 23 场季后赛记录');
    }
  }
}

export function applySnapshot(archive, snapshot) {
  validateSnapshot(snapshot);
  if (archive.endingYear !== 2025 || archive.season !== '2024-25' || archive.rows.PST.length !== 219) {
    throw new Error('目标档案不是完整的 2024–25 季后赛');
  }
  const byId = new Map(snapshot.records.map(row => [row.player_id, row]));
  // Verify the whole join before touching any statistics. Source minutes are
  // integer season totals; the NBA archive stores rounded minutes per game.
  for (const row of archive.rows.PST) {
    const source = byId.get(String(row.playerId));
    if (!source || playerKey(source.playerName) !== playerKey(row.PLAYER_NAME) ||
        source.teams !== row.TEAM_ABBREVIATION || source.games !== Number(row.GP) ||
        Math.abs(source.minutes - Number(row.GP) * Number(row.MIN)) > Number(row.GP) * 0.11 + 1) {
      throw new Error(`球员 ID、球队、场次或时间不一致：${row.PLAYER_NAME}`);
    }
  }
  for (const row of archive.rows.PST) {
    const source = byId.get(String(row.playerId));
    for (const [input, output] of Object.entries(fields)) row[output] = source[input];
  }
  archive.raptorSources = { ...archive.raptorSources,
    estimated: 'Neil Paine Estimated RAPTOR; phase-specific; 2025 playoffs from final public leaderboard',
    estimatedByPhase: { ...archive.raptorSources?.estimatedByPhase,
      PST: { model: snapshot.model, source: snapshot.chartUrl, referenceUrl, updatedAt: snapshot.updatedAt } } };
  return archive.rows.PST.length;
}

async function downloadSnapshot(archive) {
  let chartUrl = chartRoot, html;
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await fetch(chartUrl, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`公开榜单 HTTP ${response.status}`);
    html = await response.text();
    const redirect = html.length < 1000 ? html.match(/url=(https:\/\/[^"'>\s]+)/)?.[1] : null;
    if (!redirect) break;
    if (!redirect.startsWith(chartRoot)) throw new Error('公开榜单跳转到未知来源');
    chartUrl = redirect;
  }
  const match = html.match(/window\.__DW_SVELTE_PROPS__\s*=\s*JSON\.parse\(("(?:\\.|[^"\\])*")\)/);
  if (!match) throw new Error('公开榜单页面结构变化');
  const props = JSON.parse(JSON.parse(match[1]));
  const describe = props.chart?.metadata?.describe;
  const updatedAt = describe?.intro?.match(/Last updated:\s*<\/b>\s*([^\n<]+)/)?.[1]?.trim();
  if (!props.published || describe?.byline !== 'Neil Paine' || !describe?.intro?.includes('Playoffs')) {
    throw new Error('无法核验公开季后赛榜单的作者与比赛类型');
  }
  const dataUrl = `${chartUrl}data.csv`;
  const response = await fetch(dataUrl, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`公开榜单数据 HTTP ${response.status}`);
  const lines = (await response.text()).replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (!lines[0]?.includes('eRAPTOR') || !lines[1]?.startsWith('Player,')) throw new Error('不是 Estimated RAPTOR 数据');
  const byName = new Map();
  for (const row of archive.rows.PST) {
    const key = playerKey(row.PLAYER_NAME);
    if (byName.has(key)) throw new Error('同名球员需人工核验 ID');
    byName.set(key, row);
  }
  const records = parseCsv(lines.slice(1).join('\n')).map(row => {
    const player = byName.get(playerKey(row.Player));
    if (!player) throw new Error(`没有唯一 NBA ID：${row.Player}`);
    const number = value => value?.trim() ? Number(value) : NaN;
    return { player_id: String(player.playerId), playerName: row.Player, teams: row['Team(s)'],
      games: number(row.G), minutes: number(row.MP), offense: number(row.Off), defense: number(row.Def),
      total: number(row.Tot), war: number(row.WAR) };
  }).sort((a, b) => Number(a.player_id) - Number(b.player_id));
  const snapshot = { schema_version: 1, season: 2025, phase: 'PST', model: 'Neil Paine Estimated RAPTOR',
    referenceUrl, chartUrl, dataUrl, updatedAt, retrievedAt: new Date().toISOString(), records };
  // Also checks team, games and minutes before accepting source-assigned IDs.
  applySnapshot(structuredClone(archive), snapshot);
  return snapshot;
}

async function main() {
  const archive = JSON.parse(await readFile(archiveFile, 'utf8'));
  let snapshot, downloaded = false;
  if (process.argv.includes('--refresh')) {
    try { snapshot = await downloadSnapshot(archive); downloaded = true; }
    catch (error) { console.warn(`Estimated RAPTOR 榜单未刷新（${error.message}），使用已保存快照`); }
  }
  snapshot ??= JSON.parse(await readFile(snapshotFile, 'utf8'));
  const matched = applySnapshot(archive, snapshot);
  if (downloaded) {
    await mkdir(path.dirname(snapshotFile), { recursive: true });
    try {
      const previous = JSON.parse(await readFile(snapshotFile, 'utf8'));
      if (previous.dataUrl === snapshot.dataUrl && previous.updatedAt === snapshot.updatedAt &&
          JSON.stringify(previous.records) === JSON.stringify(snapshot.records)) snapshot.retrievedAt = previous.retrievedAt;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await writeFile(snapshotFile, `${JSON.stringify(snapshot)}\n`, 'utf8');
  }
  await writeFile(archiveFile, `${JSON.stringify(archive)}\n`, 'utf8');
  console.log(`2024–25 PST: Estimated RAPTOR 匹配 ${matched}/219；来源更新 ${snapshot.updatedAt}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

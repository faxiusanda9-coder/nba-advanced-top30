import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseCsv, extractBasic, applyBasic } from './lib/player-basic.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDir = path.join(root, 'sources/player-basic');
await mkdir(sourceDir, { recursive: true });
const refresh = process.argv.includes('--refresh');
const cacheDir = process.argv.find(arg => arg.startsWith('--cache-dir='))?.slice(12);
const years = Array.from({ length: 30 }, (_, i) => 1997 + i);
let total = 0, count = 0;
async function build(year) {
  const source = `https://github.com/sportsdataverse/sportsdataverse-data/releases/download/nba_stats_player_season_stats/player_season_stats_${year}.csv`;
  const snapshotFile = path.join(sourceDir, `${year}.json`);
  let snapshot;
  if (!refresh) {
    try { snapshot = JSON.parse(await readFile(snapshotFile, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!snapshot) {
    try {
      let csv;
      if (cacheDir) { try { csv = await readFile(path.join(cacheDir, `source-${year}.csv`), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
      if (!csv) {
        const response = await fetch(source, { signal: AbortSignal.timeout(45000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        csv = await response.text();
      }
      snapshot = { schema_version: 1, endingYear: year, source, units: 'per_game', rows: extractBasic(parseCsv(csv), year) };
      if (!snapshot.rows.REG.length) throw new Error('缺少常规赛基础数据');
    } catch (error) {
      console.warn(`${year}: 基础统计刷新失败 (${error.message})，使用已保存快照`);
      snapshot = JSON.parse(await readFile(snapshotFile, 'utf8'));
    }
  }
  if (snapshot.endingYear !== year || snapshot.units !== 'per_game' || !snapshot.rows.REG.length) throw new Error('基础统计快照无效');
  const archiveFile = path.join(root, 'data', `${year}.json`);
  const archive = JSON.parse(await readFile(archiveFile, 'utf8'));
  const matched = applyBasic(archive, snapshot.rows);
  archive.basicSource = { source: snapshot.source, units: snapshot.units, join: 'NBA player_id + season + phase; verified GP/MIN' };
  await writeFile(snapshotFile, `${JSON.stringify(snapshot)}\n`);
  await writeFile(archiveFile, `${JSON.stringify(archive)}\n`);
  total += matched; count += archive.rows.REG.length + archive.rows.PST.length;
  console.log(`${year}: 基础统计 ${matched}/${archive.rows.REG.length + archive.rows.PST.length}`);
}
// Keep downloads bounded; all generated joins are by ID, never by name.
await Promise.all(Array.from({ length: 3 }, async () => { while (years.length) await build(years.shift()); }));
console.log(`基础统计合并完成：${total}/${count} 条分赛制记录`);

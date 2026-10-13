import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { metrics, numeric } from '../assets/player-profile-core.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'api/_data/profiles');
const database = JSON.parse(await readFile(path.join(root,'api/_data/players.json'), 'utf8'));
const players = new Map(database.players.map(player => [player.player_id, { schema_version: 1,
  player_id: player.player_id, coverage: { ...database.coverage, scope: 'observed_archive', complete_career_verified: false },
  seasons: { REG: [], PST: [] } }]));

function raptor(row, archive, phase) {
  // RAPTOR_538 ratings are shared between phases; never use them here.
  const officialLabel = archive.endingYear <= 2000 ? 'FiveThirtyEight RAPTOR · 历史箱分版'
    : archive.endingYear <= 2013 ? 'FiveThirtyEight RAPTOR · 箱分+正则化正负值版' : 'FiveThirtyEight RAPTOR · 追踪数据版';
  const models = [
    ['RAPTOR', officialLabel, 'https://github.com/fivethirtyeight/data/blob/master/nba-raptor/historical_RAPTOR_by_team.csv', archive.supplementalSources?.raptor?.includes('historical_RAPTOR_by_team')],
    ['EST_RAPTOR', 'Neil Paine Estimated RAPTOR', archive.raptorSources?.estimatedByPhase?.[phase]?.source || 'https://github.com/Neil-Paine-1/NBA-elo/blob/main/nba-estimated-raptor.csv', Boolean(archive.raptorSources?.estimated)],
    ['LAKER', 'Neil Paine LAKER', archive.raptorSources?.laker?.[phase]?.source, Boolean(archive.raptorSources?.laker?.[phase])]
  ];
  for (const [prefix,label,url,valid] of models) {
    if (!valid || numeric(row[prefix]) == null) continue;
    return { source: { label, url, phase_specific: true }, stats: Object.fromEntries(['','_OFF','_DEF','_WAR']
      .map(suffix => [`RAPTOR_PHASE${suffix}`,numeric(row[`${prefix}${suffix}`])])) };
  }
  return { source: null, stats: Object.fromEntries(['','_OFF','_DEF','_WAR'].map(suffix => [`RAPTOR_PHASE${suffix}`,null])) };
}
let recordCount = 0;
for (let year = 1997; year <= 2026; year++) {
  const archive = JSON.parse(await readFile(path.join(root,'data',`${year}.json`),'utf8'));
  for (const phase of ['REG','PST']) {
    const seen = new Set();
    for (const row of archive.rows[phase]) {
      const id = String(row.playerId);
      if (!players.has(id) || seen.has(id)) throw new Error(`${year} ${phase}: 球员 ID 缺失或重复 ${id}`);
      seen.add(id);
      const impact = raptor(row,archive,phase);
      const stats = Object.fromEntries(metrics.filter(item => !item.key.startsWith('RAPTOR_PHASE')).map(item => [item.key,numeric(row[item.key])]));
      // Do not claim provenance for supplemental values without a recorded source.
      if (!archive.basketballReferenceSource?.[phase]) for (const key of ['BPM','OBPM','DBPM','VORP','WS','WS_48','OWS','DWS','PER']) stats[key] = null;
      if (!archive.basicSource) for (const key of ['PTS','REB','AST','STL','BLK','TOV']) stats[key] = null;
      players.get(id).seasons[phase].push({ season: archive.season, ending_year: year, phase,
        player_id: id, registered_team: row.TEAM_ABBREVIATION || null, team_count: numeric(row.TEAM_COUNT),
        aggregation: numeric(row.TEAM_COUNT) > 1 ? 'multi_team_season_total' : 'season_total',
        stats: { ...stats,...impact.stats }, raptor_source: impact.source,
        sources: { nba: `https://github.com/sportsdataverse/sportsdataverse-data/releases/download/nba_stats_player_season_stats/player_season_stats_${year}.csv`,
          basketball_reference: archive.basketballReferenceSource?.[phase] || null,
          basic: archive.basicSource?.source || null } });
      recordCount++;
    }
  }
}
await mkdir(output,{recursive:true});
for (const [id,profile] of players) await writeFile(path.join(output,`${id}.json`),`${JSON.stringify(profile)}\n`);
console.log(`球员档案：${players.size} 人，${recordCount} 条独立赛季/赛制记录；仅由单球员 API 按需读取。`);

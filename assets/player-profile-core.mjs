export const metrics = [
  ['GP','出场','basic',0], ['MIN','场均分钟','basic',1], ['PTS','PTS 得分','basic',1],
  ['REB','REB 篮板','basic',1], ['AST','AST 助攻','basic',1], ['STL','STL 抢断','basic',1],
  ['BLK','BLK 盖帽','basic',1], ['TOV','TOV 失误','basic',1],
  ['TS_PCT','TS%','basic',1,'%'], ['USG_PCT','USG%','basic',1,'%'], ['EFG_PCT','eFG%','basic',1,'%'],
  ['BPM','BPM','advanced',1], ['OBPM','OBPM','advanced',1], ['DBPM','DBPM','advanced',1],
  ['VORP','VORP','advanced',1], ['WS','WS','advanced',1], ['WS_48','WS/48','advanced',3],
  ['OWS','OWS','advanced',1], ['DWS','DWS','advanced',1], ['PER','PER','advanced',1],
  ['OFF_RATING','OFF RTG','advanced',1], ['DEF_RATING','DEF RTG','advanced',1], ['NET_RATING','NET RTG','advanced',1],
  ['REB_PCT','REB%','advanced',1,'%'], ['AST_PCT','AST%','advanced',1,'%'], ['PIE','PIE','advanced',3],
  ['RAPTOR_PHASE','RAPTOR / LAKER','advanced',2], ['RAPTOR_PHASE_OFF','RAPTOR / LAKER 进攻','advanced',2],
  ['RAPTOR_PHASE_DEF','RAPTOR / LAKER 防守','advanced',2], ['RAPTOR_PHASE_WAR','RAPTOR / LAKER WAR','advanced',2]
].map(([key,label,group,digits,suffix='']) => ({key,label,group,digits,suffix}));
export const numeric = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export function formatMetric(value, key) {
  const number = numeric(value), metric = metrics.find(item => item.key === key);
  return number == null ? '—' : `${number.toFixed(metric?.digits ?? 1)}${metric?.suffix || ''}`;
}
export function sortSeasons(rows, key, direction = 'desc') {
  const sign = direction === 'asc' ? 1 : -1;
  return [...rows].sort((a,b) => {
    const x = numeric(key === 'season' ? a.ending_year : a.stats[key]);
    const y = numeric(key === 'season' ? b.ending_year : b.stats[key]);
    if (x == null || y == null) return x == null && y == null ? b.ending_year - a.ending_year : x == null ? 1 : -1;
    return (x - y) * sign || b.ending_year - a.ending_year;
  });
}
export function metricSource(row, key) {
  if (key.startsWith('RAPTOR_PHASE')) return row.raptor_source?.label || '';
  if (['BPM','OBPM','DBPM','VORP','WS','WS_48','OWS','DWS','PER'].includes(key)) return 'Basketball Reference 衍生档案';
  return 'NBA Stats / SportsDataverse';
}
// Missing seasons and model changes remain gaps, never interpolated values.
export function trendSegments(rows, key) {
  const sorted = [...rows].sort((a,b) => a.ending_year - b.ending_year), segments = [];
  let previous = null, segment = [];
  for (const row of sorted) {
    const value = numeric(row.stats[key]);
    const split = previous && (row.ending_year !== previous.ending_year + 1 ||
      (key.startsWith('RAPTOR_PHASE') && metricSource(row,key) !== metricSource(previous,key)));
    if (value == null || split) { if (segment.length) segments.push(segment); segment = []; }
    if (value != null) segment.push({ row, value });
    previous = value == null ? null : row;
  }
  if (segment.length) segments.push(segment);
  return segments;
}

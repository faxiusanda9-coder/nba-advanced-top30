export const SEASON = '2026-27';
export const SEASON_TYPE = 'REG';
export const RULE_VERSION = 'ongoing-20mpg-58of82-v1';
export const METRICS = [
  ['BPM','BPM','综合影响','bbref',1], ['OBPM','OBPM','进攻影响','bbref',1],
  ['DBPM','DBPM','防守影响','bbref',1], ['WS','WS','胜利贡献','bbref',1],
  ['OWS','OWS','进攻胜利贡献','bbref',1], ['DWS','DWS','防守胜利贡献','bbref',1],
  ['WS_48','WS/48','每48分钟胜利贡献','bbref',3], ['VORP','VORP','替补以上价值','bbref',1],
  ['PER','PER','球员效率值','bbref',1], ['TS_PCT','TS%','真实命中率','nba',1],
  ['USG_PCT','USG%','回合使用率','nba',1],
  ['EPM_ACTUAL','Actual EPM','本季表现评级 · 暂未接入','epm',1],
  ['EPM_EXPECTED','Expected EPM','预测型评级 · 暂未接入','epm',1]
].map(([key,label,chinese,source,decimals])=>({key,label,chinese,source,decimals,
  percentage: ['TS_PCT','USG_PCT'].includes(key)}));

export const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
export const formatValue = (value, metric) => finite(value) === null ? '暂无数据'
  : `${value.toFixed(METRICS.find(item=>item.key===metric)?.decimals ?? 1)}${metric.endsWith('_PCT')?'%':''}`;

export function qualify(teamGames, rule = {}) {
  const teams = Object.entries(teamGames);
  if (teams.length !== 30 || teams.some(([,games])=>!Number.isInteger(games)||games<0||games>90))
    throw new Error('Ranking requires all 30 teams from the same source snapshot');
  const average = teams.reduce((sum,[,games])=>sum+games,0)/30;
  return {version:RULE_VERSION,min_minutes:20,min_games:Math.max(1,Math.ceil(average*58/82)),
    average_team_games:average,team_games:teamGames,custom_rule:true,...rule};
}

export function ranksFor(snapshot, metric) {
  const ranks = new Map();
  const rows = snapshot.players.filter(player=>player.games_included>=snapshot.qualification.min_games &&
    player.minutes_per_game>=snapshot.qualification.min_minutes && finite(player.metrics[metric])!==null)
    .sort((a,b)=>b.metrics[metric]-a.metrics[metric]||a.player_id.localeCompare(b.player_id));
  let rank=0,last;
  rows.forEach((player,index)=>{
    const value=player.metrics[metric];
    if(index===0||value!==last)rank=index+1;
    ranks.set(player.player_id,rank);last=value;
  });
  return {ranks,participants:rows.length};
}

export function metricTable(snapshot, previous, metric) {
  const {ranks,participants}=ranksFor(snapshot,metric);
  const comparable=previous && previous.season===snapshot.season && previous.season_type===snapshot.season_type &&
    previous.source.id===snapshot.source.id && previous.model_versions[metric]===snapshot.model_versions[metric] &&
    previous.qualification.version===snapshot.qualification.version;
  const before = comparable ? ranksFor(previous,metric) : {ranks:new Map()};
  const old = new Map((comparable?previous.players:[]).map(player=>[player.player_id,player]));
  return {schema_version:1,season:snapshot.season,season_type:snapshot.season_type,metric,
    source:snapshot.source,model_version:snapshot.model_versions[metric],snapshot_id:snapshot.snapshot_id,
    data_as_of:snapshot.data_as_of,cutoff_verification:snapshot.cutoff_verification,
    fetched_at:snapshot.fetched_at,observed_date:snapshot.observed_date,
    qualification:snapshot.qualification,participants,
    previous_snapshot:comparable?{snapshot_id:previous.snapshot_id,data_as_of:previous.data_as_of,
      observed_date:previous.observed_date,fetched_at:previous.fetched_at}:null,
    rows:snapshot.players.map(player=>{
      const value=finite(player.metrics[metric]),prior=old.get(player.player_id);
      const previousValue=finite(prior?.metrics[metric]);
      const rank=ranks.get(player.player_id)??null,previousRank=before.ranks.get(player.player_id)??null;
      const eligible=player.games_included>=snapshot.qualification.min_games&&player.minutes_per_game>=snapshot.qualification.min_minutes;
      let state=value===null?'missing':!eligible?'ineligible':!prior?'first_seen':previousValue===null?'first_seen':previousRank===null?'new_entry':'ranked';
      if(previous&&!comparable&&value!==null)state='incomparable';
      return {...player,metrics:undefined,raw_stats:undefined,metric,value,source:snapshot.source.id,
        model_version:snapshot.model_versions[metric],season:snapshot.season,season_type:snapshot.season_type,
        data_as_of:snapshot.data_as_of,fetched_at:snapshot.fetched_at,snapshot_id:snapshot.snapshot_id,
        previous_value:previousValue,value_change:value!==null&&previousValue!==null?value-previousValue:null,
        rank,previous_rank:previousRank,rank_change:rank!==null&&previousRank!==null?previousRank-rank:null,
        state,eligible,left_ranking:rank===null&&previousRank!==null};
    })};
}

export function seriesSegments(points,metric) {
  const segments=[];let segment=[],last;
  for(const point of points) {
    const model=point.model_versions?.[metric];
    if(finite(point.metrics?.[metric])===null||last&&last!==model) {
      if(segment.length)segments.push(segment);segment=[];
    }
    if(finite(point.metrics?.[metric])!==null)segment.push(point);
    last=model;
  }
  if(segment.length)segments.push(segment);
  return segments;
}

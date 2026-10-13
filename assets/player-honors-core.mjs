export const awardTypes = [
  ['championship','NBA 总冠军','core','PST'], ['finals_mvp','总决赛 MVP','core','PST'], ['mvp','常规赛 MVP','core','REG'],
  ['all_nba_1','最佳阵容一阵','other','REG'], ['all_nba_2','最佳阵容二阵','other','REG'], ['all_nba_3','最佳阵容三阵','other','REG'],
  ['all_defensive_1','最佳防守一阵','other','REG'], ['all_defensive_2','最佳防守二阵','other','REG'],
  ['dpoy','最佳防守球员','other','REG'], ['roy','最佳新秀','other','REG'], ['all_star','全明星入选','other','REG'],
  ['scoring_title','得分王','other','REG'], ['assists_title','助攻王','other','REG'], ['rebounds_title','篮板王','other','REG'],
  ['all_star_mvp','全明星赛 MVP','other','REG']
].map(([key,label,group,phase])=>({key,label,group,phase}));
export const playerAwardCategories = awardTypes.filter(item=>!item.key.endsWith('_title')).map(item=>item.key);
const descriptionMap = new Map([
  ['NBA Champion','championship'], ['NBA Finals Most Valuable Player','finals_mvp'], ['NBA Most Valuable Player','mvp'],
  ['NBA Defensive Player of the Year','dpoy'], ['NBA Rookie of the Year','roy'], ['NBA All-Star','all_star'],
  ['NBA All-Star Most Valuable Player','all_star_mvp']
]);
export function seasonYear(season) {
  const match=String(season).match(/^(\d{4})-(\d{2})$/);
  if(!match||Number(match[2])!==(Number(match[1])+1)%100)return null;
  return Number(match[1])+1;
}
export function classifyPlayerAward(row) {
  if(row.TYPE!=='Award'||row.MONTH||row.WEEK||seasonYear(row.SEASON)==null)return null;
  if(row.DESCRIPTION==='All-NBA')return [1,2,3].includes(Number(row.ALL_NBA_TEAM_NUMBER))?`all_nba_${Number(row.ALL_NBA_TEAM_NUMBER)}`:null;
  if(row.DESCRIPTION==='All-Defensive Team')return [1,2].includes(Number(row.ALL_NBA_TEAM_NUMBER))?`all_defensive_${Number(row.ALL_NBA_TEAM_NUMBER)}`:null;
  return descriptionMap.get(row.DESCRIPTION)||null;
}
export function honorsForSeason(honors,year,phase) {
  return (honors?.records||[]).filter(record=>record.award_year===year&&record.phase===phase);
}
export function summarizeHonors(honors) {
  return awardTypes.map(type=>{
    const records=(honors?.records||[]).filter(record=>record.award_type===type.key);
    const status=honors?.coverage?.[type.key]?.status||'missing';
    return {...type,status,count:status==='complete'?records.length:null,known_count:records.length,records};
  });
}

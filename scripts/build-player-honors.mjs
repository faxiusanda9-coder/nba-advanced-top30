import{readFile,writeFile,mkdir}from'node:fs/promises';
import path from'node:path';import{fileURLToPath}from'node:url';
import{awardTypes,playerAwardCategories,classifyPlayerAward,seasonYear}from'../assets/player-honors-core.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=async file=>JSON.parse(await readFile(path.join(root,file),'utf8'));
const database=await read('api/_data/players.json');
const snapshots=await read('sources/honors/player-awards.json');
const titles=await read('sources/honors/statistical-titles.json');
const identities=await read('sources/honors/player-career-coverage.json');
const identityById=new Map(identities.players.map(row=>[row.player_id,row]));
const output=path.join(root,'api/_data/honors');await mkdir(output,{recursive:true});
let verified=0,recordsCount=0;
for(const player of database.players){
  const id=player.player_id,snapshot=snapshots.players[id],identity=identityById.get(id),records=[],seen=new Set();
  const coverage=Object.fromEntries(awardTypes.map(type=>[type.key,{status:'missing',reason:'尚未取得该球员的可靠荣誉记录'}]));
  function add(record){
    if(record.player_id!==id||seasonYear(record.season)!==record.award_year)throw new Error('荣誉 ID/赛季不一致');
    const key=`${record.award_type}|${record.season}`;
    if(!seen.has(key)){records.push(record);seen.add(key);}
  }
  if(snapshot?.status==='complete'){
    if(snapshot.player_id!==id||!Array.isArray(snapshot.records)||!snapshot.source.startsWith('https://stats.nba.com/stats/playerawards?PlayerID='))throw new Error(`PlayerAwards 快照无效 ${id}`);
    for(const key of playerAwardCategories)coverage[key]={status:'complete',scope:'official_career_records',through_year:snapshot.through_year,source:snapshot.source,updated_at:snapshot.updated_at};
    for(const row of snapshot.records){
      if(String(row.PERSON_ID)!==id)throw new Error(`不同 ID 的荣誉混入 ${id}`);
      const type=classifyPlayerAward(row),year=seasonYear(row.SEASON);
      if(!type||year>snapshot.through_year)continue;
      const definition=awardTypes.find(item=>item.key===type);
      add({player_id:id,award_type:type,season:row.SEASON,award_year:year,
        award_level:type.startsWith('all_nba_')||type.startsWith('all_defensive_')?Number(type.at(-1)):null,
        phase:definition.phase,source:snapshot.source,updated_at:snapshot.updated_at});
    }
    verified++;
  }
  // Titles are official named Season Leaders, never maxima of this site's stats.
  const first=identity?identity.from_year+1:null;
  for(const key of['scoring_title','assists_title','rebounds_title']){
    // TO_YEAR formats historically vary between ending and starting years;
    // adding one is conservative and still avoids extending retired careers
    // to a future season whose official list has not yet been published.
    const lastCareerYear=identity?Math.min(titles.last_year,identity.to_year+1):titles.last_year;
    const years=first==null?[]:Array.from({length:Math.max(0,lastCareerYear-Math.max(first,titles.first_year)+1)},(_,i)=>Math.max(first,titles.first_year)+i);
    const missing=years.filter(year=>!titles.seasons[year]?.leaders?.[key]||titles.seasons[year].leaders[key].identity_status==='ambiguous');
    const full=first!=null&&first>=titles.first_year&&!missing.length;
    coverage[key]={status:full?'complete':years.length?'partial':'missing',scope:'official_season_leaders',
      first_year:titles.first_year,through_year:titles.last_year,source:'https://www.nba.com/news/history-season-recaps-index',
      missing_years:missing,reason:full?null:'官方名单或球员生涯覆盖信息未补齐'};
    for(const season of Object.values(titles.seasons)){
      const winner=season.leaders[key];if(winner?.player_id!==id)continue;
      if(first==null||season.award_year<first)throw new Error(`统计王早于官方生涯起点 ${id}`);
      add({player_id:id,award_type:key,season:season.season,award_year:season.award_year,award_level:null,phase:'REG',
        source:season.source,updated_at:season.updated_at});
    }
  }
  records.sort((a,b)=>a.award_year-b.award_year||awardTypes.findIndex(t=>t.key===a.award_type)-awardTypes.findIndex(t=>t.key===b.award_type));
  for(const year of new Set(records.map(row=>row.award_year)))for(const prefix of['all_nba_','all_defensive_']){
    if(records.filter(row=>row.award_year===year&&row.award_type.startsWith(prefix)).length>1)throw new Error(`${id} ${year}: 阵容档次冲突，停止构建`);
  }
  const result={schema_version:1,player_id:id,coverage,records};recordsCount+=records.length;
  await writeFile(path.join(output,`${id}.json`),`${JSON.stringify(result)}\n`);
}
console.log(`荣誉库：${database.player_count} 个独立球员档案；官方 PlayerAwards 已覆盖 ${verified} 人；${recordsCount} 条指定荣誉。未取得的类别保持 missing/partial。`);

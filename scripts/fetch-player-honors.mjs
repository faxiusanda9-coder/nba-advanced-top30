import {mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {classifyPlayerAward} from '../assets/player-honors-core.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.join(root,'sources/honors/player-awards.json');
await mkdir(path.dirname(file),{recursive:true});
let snapshot={schema_version:1,source:'NBA Stats PlayerAwards',endpoint:'https://stats.nba.com/stats/playerawards',players:{}};
try{snapshot=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const database=JSON.parse(await readFile(path.join(root,'api/_data/players.json'),'utf8'));
const all=process.argv.includes('--all'),active=process.argv.includes('--active'),refresh=process.argv.includes('--refresh');
const selected=process.argv.find(arg=>arg.startsWith('--ids='))?.slice(6).split(',');
const maxYear=Number(process.argv.find(arg=>arg.startsWith('--through='))?.slice(10)||2026);
if(!Number.isInteger(maxYear)||maxYear<1970||maxYear>2100)throw new Error('无效的荣誉截止年份');
const now=new Date(),lastCompletedYear=now.getUTCFullYear()-(now.getUTCMonth()<6?1:0);
if(maxYear>lastCompletedYear)throw new Error('不能把尚未结束的赛季标记为生涯荣誉已完整核验');
const archiveEndingYear=Math.max(...database.players.map(player=>Number(player.career_range.last_season.slice(0,4))+1));
let queue=database.players.filter(player=>selected?selected.includes(player.player_id):active?Number(player.career_range.last_season.slice(0,4))+1>=archiveEndingYear||!snapshot.players[player.player_id]:all||!snapshot.players[player.player_id])
  .filter(player=>refresh||!snapshot.players[player.player_id])
  .sort((a,b)=>b.popularity_score-a.popularity_score);
let done=0,failures=0,consecutive=0,stopped=false;
const unsupported=new Set();
async function fetchPlayer(player){
  const id=player.player_id,source=`${snapshot.endpoint}?PlayerID=${id}`;
  const response=await fetch(source,{signal:AbortSignal.timeout(15000),headers:{'User-Agent':'Mozilla/5.0',Referer:'https://www.nba.com/',Accept:'application/json'}});
  if(!response.ok)throw new Error(`NBA HTTP ${response.status}`);
  const payload=await response.json(),result=payload.resultSets?.find(set=>set.name==='PlayerAwards');
  if(String(payload.parameters?.PlayerID)!==id||!result||!Array.isArray(result.headers)||!Array.isArray(result.rowSet)
    ||!['PERSON_ID','DESCRIPTION','SEASON','ALL_NBA_TEAM_NUMBER','TYPE'].every(key=>result.headers.includes(key)))throw new Error('NBA 响应结构或 ID 不一致');
  const rows=result.rowSet.map(cells=>Object.fromEntries(result.headers.map((key,i)=>[key,cells[i]])));
  if(rows.some(row=>String(row.PERSON_ID)!==id))throw new Error('NBA 返回不同球员，停止合并');
  const records=[];
  for(const row of rows){
    const kind=classifyPlayerAward(row);
    if(kind)records.push({PERSON_ID:row.PERSON_ID,FIRST_NAME:row.FIRST_NAME,LAST_NAME:row.LAST_NAME,TEAM:row.TEAM,
      DESCRIPTION:row.DESCRIPTION,ALL_NBA_TEAM_NUMBER:row.ALL_NBA_TEAM_NUMBER,SEASON:row.SEASON,TYPE:row.TYPE});
    else if(/Champion|Valuable|Defensive|All-NBA|All-Star|Rookie of the Year/i.test(row.DESCRIPTION||''))unsupported.add(row.DESCRIPTION);
  }
  // An unexpected shrink must not erase previously verified wins.
  const old=snapshot.players[id];
  if(old&&old.records.some(row=>!records.some(next=>next.DESCRIPTION===row.DESCRIPTION&&next.SEASON===row.SEASON&&String(next.ALL_NBA_TEAM_NUMBER)===String(row.ALL_NBA_TEAM_NUMBER))))throw new Error('官方获奖列表缩减，保留旧快照待核验');
  const through=Math.max(old?.through_year||0,maxYear);
  const changed=!old||JSON.stringify(old.records)!==JSON.stringify(records)||old.through_year!==through;
  snapshot.players[id]={player_id:id,source,status:'complete',through_year:through,
    updated_at:changed?new Date().toISOString():old.updated_at,records};
}
async function save(){await writeFile(file,`${JSON.stringify(snapshot)}\n`);}
// Two bounded workers, with a pause per request. Blocked sources stop the run;
// saved snapshots continue to serve the website without live NBA requests.
await Promise.all(Array.from({length:2},async()=>{
  while(queue.length&&!stopped){
    const player=queue.shift();
    try{await fetchPlayer(player);consecutive=0;}
    catch(error){failures++;consecutive++;console.warn(`${player.player_id} ${player.full_name}: ${error.message}`);if(consecutive>=5)stopped=true;}
    done++;if(done%25===0){await save();console.log(`PlayerAwards ${done} 已处理；${Object.keys(snapshot.players).length}/${database.player_count} 已存；失败 ${failures}`);}
    await new Promise(resolve=>setTimeout(resolve,300));
  }
}));
await save();
console.log(`PlayerAwards 完成：${Object.keys(snapshot.players).length}/${database.player_count} 已存；本次失败 ${failures}${stopped?'；访问受限已停止':''}`);
console.log('未收录的奖项（范围外或无法识别）：',JSON.stringify([...unsupported].sort()));
if(stopped||failures)process.exitCode=1;

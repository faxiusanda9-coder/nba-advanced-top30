import{readFile,writeFile,mkdir}from'node:fs/promises';
import path from'node:path';import{fileURLToPath}from'node:url';
import{normalizeName}from'../assets/player-search-core.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.join(root,'sources/honors/statistical-titles.json');
await mkdir(path.dirname(file),{recursive:true});
let snapshot={schema_version:1,source:'NBA.com official season-review Season Leaders',first_year:1970,last_year:2026,seasons:{}};
try{snapshot=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const database=JSON.parse(await readFile(path.join(root,'api/_data/players.json'),'utf8'));
const identityYear=Number(process.argv.find(a=>a.startsWith('--through='))?.slice(10)||snapshot.last_year);
const identitySource=`https://stats.nba.com/stats/commonallplayers?IsOnlyCurrentSeason=0&LeagueID=00&Season=${identityYear-1}-${String(identityYear%100).padStart(2,'0')}`;
const identityResponse=await fetch(identitySource,{signal:AbortSignal.timeout(15000),headers:{'User-Agent':'Mozilla/5.0',Referer:'https://www.nba.com/'}});
if(!identityResponse.ok)throw new Error(`NBA identities HTTP ${identityResponse.status}`);
const identityPayload=await identityResponse.json(),identitySet=identityPayload.resultSets?.[0];
if(!identitySet?.headers?.includes('FROM_YEAR')||!identitySet?.headers?.includes('PERSON_ID'))throw new Error('官方球员 ID 覆盖表无效');
const registry=identitySet.rowSet.map(cells=>Object.fromEntries(identitySet.headers.map((key,i)=>[key,cells[i]])));
const wanted=new Set(database.players.map(player=>player.player_id));
const identities=registry.filter(row=>wanted.has(String(row.PERSON_ID))).map(row=>({player_id:String(row.PERSON_ID),
  full_name:row.DISPLAY_FIRST_LAST,from_year:Number(row.FROM_YEAR),to_year:Number(row.TO_YEAR)}));
if(identities.length!==wanted.size||new Set(identities.map(row=>row.player_id)).size!==wanted.size)throw new Error('官方 ID 表未覆盖本站所有球员');
const identityFile=path.join(root,'sources/honors/player-career-coverage.json');
let previousIdentity;try{previousIdentity=JSON.parse(await readFile(identityFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
const identitySnapshot={schema_version:1,source:identitySource,players:identities};
identitySnapshot.updated_at=previousIdentity&&JSON.stringify(previousIdentity.players)===JSON.stringify(identities)?previousIdentity.updated_at:new Date().toISOString();
await writeFile(identityFile,`${JSON.stringify(identitySnapshot)}\n`);
const byName=new Map();
for(const player of database.players)for(const name of[player.full_name,...player.aliases]){const key=normalizeName(name);if(!byName.has(key))byName.set(key,new Set());byName.get(key).add(player.player_id);}
const refresh=process.argv.includes('--refresh');
const last=Number(process.argv.find(a=>a.startsWith('--through='))?.slice(10)||snapshot.last_year);
const since=Number(process.argv.find(a=>a.startsWith('--since='))?.slice(8)||snapshot.first_year);
const extract=html=>{const m=html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);if(!m)throw new Error('官方页面未提供可读取数据');return JSON.parse(m[1]).props.pageProps.article;};
const indexUrl='https://www.nba.com/news/history-season-recaps-index';
const response=await fetch(indexUrl,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`NBA index HTTP ${response.status}`);
const index=extract(await response.text());
const links=new Map([...index.contentFiltered.matchAll(/href="([^\"]+)"[^>]*>(.*?)<\/a>/gs)].map(m=>{
  const season=m[2].replace(/<[^>]*>/g,'').trim().match(/^(\d{4})-(\d{2})$/)?.[0];return[season,m[1]];
}).filter(([season])=>season));
let updated=0,failed=0;
for(let year=since;year<=last;year++){
  if(snapshot.seasons[year]&&!refresh)continue;
  const season=`${year-1}-${String(year%100).padStart(2,'0')}`;
  try{
    // The official index has a malformed 1999-00 URL; this is its verified
    // official article address, not an override of any statistical winner.
    const url=new URL(year===2000?'https://www.nba.com/news/history-season-review-1999-00':links.get(season)||'',indexUrl);
    if(!links.has(season)||url.origin!=='https://www.nba.com')throw new Error('官方索引尚未发布此赛季');
    const r=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`NBA recap HTTP ${r.status}`);
    const article=extract(await r.text());
    const match=article.contentText.match(/Season (?:Leaders|Winners)([\s\S]*?)(?:Award Winners|\nAWARDS\b|$)/i);
    if(!match)throw new Error('未找到官方 Season Leaders');
    const leaders={};
    for(const[key,category]of[['scoring_title','(?:Points|PPG|Scoring)'],['assists_title','Assists'],['rebounds_title','Rebounds']]){
      const line=match[1].split(/\r?\n/).map(x=>x.replace(/&amp;/g,'&').trim()).find(line=>new RegExp(`^${category}\\s*[—–-]`).test(line));
      if(!line)throw new Error(`官方名单缺少 ${category}`);
      const raw=line.replace(new RegExp(`^${category}\\s*[—–-]\\s*`),'').trim();
      const winner=raw.split(/[;,\(]/)[0].trim();
      // A name may attach to an NBA ID only when the index has a unique exact
      // normalized match. Same-name players and spelling mismatches stay unresolved.
      const ids=byName.get(normalizeName(winner));
      const id=ids?.size===1?[...ids][0]:null;
      leaders[key]={winner_name:winner,player_id:id,official_line:line,
        identity_status:id?'unique_exact_name':ids?.size>1||/\s(?:and|&)\s/.test(winner)?'ambiguous':'outside_index'};
    }
    const next={season,award_year:year,source:url.href,source_updated_at:article.modified||article.date,leaders};
    const previous=snapshot.seasons[year];
    next.updated_at=previous&&JSON.stringify({...previous,updated_at:null})===JSON.stringify({...next,updated_at:null})?previous.updated_at:new Date().toISOString();
    snapshot.seasons[year]=next;updated++;
  }catch(error){failed++;console.warn(`${season}: ${error.message}，保留快照或标记缺失`);}
  await new Promise(resolve=>setTimeout(resolve,300));
}
snapshot.last_year=Math.max(snapshot.last_year,last);
await writeFile(file,`${JSON.stringify(snapshot)}\n`);
console.log(`官方统计王：已保存 ${Object.keys(snapshot.seasons).length} 季，本次成功 ${updated}，暂缺/失败 ${failed}`);
if(failed)process.exitCode=1;

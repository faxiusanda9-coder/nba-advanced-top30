import {readdir, readFile, writeFile, mkdir, access} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'data', 'games', 'boxscores');
const output = path.join(root, 'assets', 'player-headshots');
const unavailableFile = path.join(root, 'data', 'games', 'headshots-unavailable.json');
const fallbackSourcesFile = path.join(root, 'data', 'games', 'headshot-sources.json');
const dryRun = process.argv.includes('--dry-run');
const retryUnavailable = process.argv.includes('--retry-unavailable');
const limitArg = process.argv.find(arg => arg.startsWith('--max='));
const max = limitArg ? Number(limitArg.slice(6)) : 80;
if (!Number.isInteger(max) || max < 1 || max > 1000) throw new Error('Invalid --max');
const headers = {'User-Agent':'Mozilla/5.0', 'Referer':'https://www.nba.com/'};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function fetchPngUrl(url) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {headers, signal:AbortSignal.timeout(10000)});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Invalid PNG');
      return bytes;
    } catch (error) {last=error;}
  }
  throw last;
}
const fetchPng = id => fetchPngUrl(`https://cdn.nba.com/headshots/nba/latest/260x190/${id}.png`);
const espnScoreboards = new Map(), espnSummaries = new Map();
async function fetchEspnFallback(reference) {
  const date = reference.official_date.replaceAll('-','');
  if (!espnScoreboards.has(date)) espnScoreboards.set(date,fetch(
    `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${date}&limit=1000`,
    {signal:AbortSignal.timeout(10000)}).then(response=>{if(!response.ok)throw new Error(`ESPN scoreboard HTTP ${response.status}`);return response.json();}));
  const scoreboard = await espnScoreboards.get(date);
  const event = scoreboard.events?.find(item=>{
    const competitors=item.competitions?.[0]?.competitors||[];
    return competitors.find(row=>row.homeAway==='home')?.team.name===reference.home
      && competitors.find(row=>row.homeAway==='away')?.team.name===reference.away
      && Math.abs(new Date(item.date).getTime()-new Date(reference.start_utc).getTime())<=600000;
  });
  if(!event)return null;
  if(!espnSummaries.has(event.id)) espnSummaries.set(event.id,fetch(
    `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${event.id}`,
    {signal:AbortSignal.timeout(10000)}).then(response=>{if(!response.ok)throw new Error(`ESPN summary HTTP ${response.status}`);return response.json();}));
  const summary=await espnSummaries.get(event.id);
  const team=summary.boxscore?.players?.find(row=>row.team?.name===reference.team);
  const athlete=team?.statistics?.flatMap(group=>group.athletes||[]).find(row=>row.athlete?.displayName===reference.name);
  const url=athlete?.athlete?.headshot?.href;
  if(!/^https:\/\/a\.espncdn\.com\/i\/headshots\/nba\/players\/full\/\d+\.png$/.test(url||''))return null;
  const image=await fetchPngUrl(url);
  if(image.length<5000)return null;
  return {image,source:{provider:'ESPN',source_url:url,espn_player_id:String(athlete.athlete.id),
    matched_by:'exact game, team, start UTC, and full name',game_id:reference.game_id}};
}

let unavailable = {schema_version:1, ids:[]};
try {unavailable = JSON.parse(await readFile(unavailableFile, 'utf8'));}
catch (error) {if (error.code !== 'ENOENT') throw error;}
const skipped = new Set(retryUnavailable ? [] : unavailable.ids);
const files = await readdir(source);
const ids = new Set(), references = new Map();
for (const file of files.filter(file => /^\d{10}\.json$/.test(file))) {
  const box = JSON.parse(await readFile(path.join(source, file), 'utf8'));
  for (const side of ['home','away']) for (const player of box.teams[side].players)
    if (/^\d+$/.test(player.player_id)) {
      ids.add(player.player_id);
      if(!references.has(player.player_id))references.set(player.player_id,{name:player.player_name,
        team:box.teams[side].name,home:box.teams.home.name,away:box.teams.away.name,
        game_id:box.game_id,official_date:box.official_date,start_utc:box.start_utc});
    }
}
await mkdir(output, {recursive:true});
const missing = [];
for (const id of ids) {
  try {await access(path.join(output, `${id}.png`));}
  catch {if (!skipped.has(id)) missing.push(id);}
}
const selected = missing.slice(0,max), results = [];
const generic = selected.length ? hash(await fetchPng('999999999')) : null;
let cursor = 0;
await Promise.all(Array.from({length:Math.min(4,selected.length)}, async () => {
  while (cursor < selected.length) {
    const id = selected[cursor++];
    try {
      const image = await fetchPng(id);
      if (hash(image) === generic) {
        const fallback=await fetchEspnFallback(references.get(id));
        if(!fallback)results.push({id,status:'unavailable'});
        else {if(!dryRun)await writeFile(path.join(output,`${id}.png`),fallback.image);
          results.push({id,status:'saved',source:fallback.source});}
      } else {if (!dryRun) await writeFile(path.join(output, `${id}.png`), image); results.push({id,status:'saved'});}
    } catch (error) {results.push({id,status:'failed',error:error.message});}
  }
}));
const newlyUnavailable = results.filter(item=>item.status==='unavailable').map(item=>item.id);
const savedIds=new Set(results.filter(item=>item.status==='saved').map(item=>item.id));
const allUnavailable = [...new Set([...unavailable.ids.filter(id=>!savedIds.has(id)),...newlyUnavailable])].sort((a,b)=>Number(a)-Number(b));
if (!dryRun && JSON.stringify(allUnavailable)!==JSON.stringify(unavailable.ids))
  await writeFile(unavailableFile, `${JSON.stringify({schema_version:1,ids:allUnavailable},null,2)}\n`);
const fallbackSources = await readFile(fallbackSourcesFile,'utf8').then(JSON.parse).catch(error=>{
  if(error.code==='ENOENT')return {schema_version:1,players:{}};throw error;
});
let sourceChanges=false;
for(const item of results.filter(item=>item.source)){
  if(JSON.stringify(fallbackSources.players[item.id])!==JSON.stringify(item.source)){
    fallbackSources.players[item.id]=item.source;sourceChanges=true;
  }
}
if(sourceChanges&&!dryRun)await writeFile(fallbackSourcesFile,`${JSON.stringify(fallbackSources,null,2)}\n`);
console.log(JSON.stringify({unique_players:ids.size, queued:missing.length, processed:selected.length,
  saved:results.filter(item=>item.status==='saved').length, unavailable:newlyUnavailable.length,
  failed:results.filter(item=>item.status==='failed').length, dry_run:dryRun}));
for (const failure of results.filter(item=>item.status==='failed')) console.error(`${failure.id}: ${failure.error}`);
if (results.some(item=>item.status==='failed')) process.exitCode=1;

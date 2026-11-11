import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {SEASON,SEASON_TYPE,METRICS,qualify,metricTable,ranksFor} from '../../assets/current-season-core.mjs';
import {dateInZone} from './daily-games.mjs';

export const ROOT_DIRECTORY='data/current-season/2026-27';
export const TEAM_ALIAS={BRK:'BKN',CHO:'CHA',PHO:'PHX'};
const numeric=value=>value===''||value==null||!Number.isFinite(Number(value))?null:Number(value);
const nameKey=value=>String(value).normalize('NFKC').trim().toLocaleLowerCase('en');
export const seriesKey=id=>String(id).replace(':','-');
export const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function resolveIdentity(row,teams,candidates=[],prior=null) {
  const exact=candidates.filter(candidate=>nameKey(candidate.player_name)===nameKey(row.player));
  const candidate=exact.length===1&&teams.includes(exact[0].team_abbreviation)?exact[0]:null;
  const mapped=candidate?.player_id??(prior?.nba_player_id&&nameKey(prior.player_name)===nameKey(row.player)?prior.nba_player_id:null);
  if(prior?.nba_player_id&&mapped&&prior.nba_player_id!==mapped)throw new Error(`BBRef identity reassignment: ${row.player_id}`);
  return {mapped,match:candidate?'exact unique 2026–27 name and team':mapped?'previously verified stable source ID':'source ID only; not merged'};
}

export function fullSeasonRow(group) {
  const aggregate=group.filter(row=>/^(?:\d+TM|TOT)$/.test(row.team));
  if(aggregate.length>1)throw new Error('Duplicate BBRef total');
  if(group.length>1&&!aggregate.length)throw new Error('BBRef traded player has no total');
  return aggregate[0]||group[0];
}

export function parseCsv(text) {
  const lines=[];let row=[],field='',quoted=false;
  for(let i=0;i<text.length;i++) {
    const c=text[i];
    if(c==='"') {if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(field);field='';}
    else if(c==='\n'&&!quoted){row.push(field.replace(/\r$/,''));if(row.some(Boolean))lines.push(row);row=[];field='';}
    else field+=c;
  }
  if(quoted)throw new Error('Truncated CSV quoted field');
  if(field||row.length){row.push(field.replace(/\r$/,''));lines.push(row);}
  const headers=lines.shift()?.map(value=>value.replace(/^\uFEFF/,''));
  if(!headers?.length||new Set(headers).size!==headers.length)throw new Error('Invalid CSV headers');
  return lines.map(cells=>{
    if(cells.length!==headers.length)throw new Error('CSV field count changed');
    return Object.fromEntries(headers.map((key,index)=>[key,cells[index]]));
  });
}

export function nbaRows(csv) {
  const rows=parseCsv(csv).filter(row=>row.season==='2027'&&row.season_type==='regular-season'&&
    row.measure_type==='advanced'&&row.per_mode==='pergame');
  if(rows.length<300)throw new Error('NBA 2026–27 regular-season advanced coverage incomplete');
  const ids=new Set();
  for(const row of rows) {
    if(!/^\d+$/.test(row.player_id)||!row.player_name||ids.has(row.player_id)||
      !Number.isInteger(numeric(row.gp))||numeric(row.gp)<1||numeric(row.min)===null)
      throw new Error('NBA season/player identity or games invalid');
    ids.add(row.player_id);
  }
  return rows;
}

export function nbaTeams(csv) {
  const rows=parseCsv(csv).filter(row=>row.season==='2027'&&row.season_type==='regular-season'&&
    row.measure_type==='advanced'&&row.per_mode==='pergame');
  const teams=Object.fromEntries(rows.map(row=>[row.team_id,numeric(row.gp)]));
  qualify(teams);return teams;
}

export function normalizeNba(rows,teamGames,existingPlayers=[]) {
  const playersById=new Map(existingPlayers.map(player=>[player.player_id,player]));
  return rows.map(row=>{
    const games=numeric(row.gp),minutes=numeric(row.min);
    if(!Number.isInteger(games)||games<1||minutes===null||minutes<0)throw new Error('NBA games or minutes missing');
    if(games>(teamGames[row.team_id]??0)&&numeric(row.team_count)===1)
      throw new Error(`NBA player/team snapshot mismatch: ${row.player_name}`);
    // True shooting can exceed 100% on small samples (a made three is 150%).
    const pct=key=>{const value=numeric(row[key]);if(value!==null&&(value<0||value>2))throw new Error('NBA percentage unit changed');return value===null?null:value*100;};
    return {player_id:row.player_id,source_player_id:row.player_id,player_name:row.player_name,
      nba_player_id:row.player_id,profile_slug:playersById.get(row.player_id)?.slug??null,
      identity_match:'NBA stable player ID',team_id:teamGames[row.team_id]===undefined?null:row.team_id,
      team:teamGames[row.team_id]===undefined?'多队合计':row.team_abbreviation,
      team_ids:teamGames[row.team_id]===undefined?[]:[row.team_id],games_included:games,minutes_per_game:minutes,series_key:seriesKey(row.player_id),
      metrics:{TS_PCT:pct('ts_pct'),USG_PCT:pct('usg_pct')},raw_stats:{gp:row.gp,min:row.min,ts_pct:row.ts_pct,usg_pct:row.usg_pct}};
  }).sort((a,b)=>a.player_id.localeCompare(b.player_id));
}

export function normalizeBbref(csv,teamsCsv,nbaPlayers,existingPlayers=[],previousPlayers=[]) {
  const fields={bpm:'BPM',obpm:'OBPM',dbpm:'DBPM',ws:'WS',ows:'OWS',dws:'DWS',ws_48:'WS_48',vorp:'VORP',per:'PER'};
  const current=parseCsv(csv).filter(row=>row.season==='2027'&&row.lg==='NBA');
  if(current.length<300)throw new Error('Basketball Reference archive does not cover 2026–27');
  const teamIds=new Map(nbaPlayers.map(row=>[row.team_abbreviation,row.team_id]));
  const teamGames={};
  for(const row of parseCsv(teamsCsv).filter(row=>row.season==='2027'&&row.lg==='NBA'&&row.team!=='League Average')) {
    const abbr=TEAM_ALIAS[row.abbreviation]||row.abbreviation,id=teamIds.get(abbr);
    if(!id||teamGames[id]!==undefined||numeric(row.w)===null||numeric(row.l)===null)throw new Error('BBRef team coverage mismatch');
    teamGames[id]=numeric(row.w)+numeric(row.l);
  }
  const qualification=qualify(teamGames);
  const names=new Map();
  for(const row of nbaPlayers){const key=nameKey(row.player_name);if(!names.has(key))names.set(key,[]);names.get(key).push(row);}
  const profiles=new Map(existingPlayers.map(player=>[player.player_id,player]));
  const previous=new Map(previousPlayers.map(player=>[player.source_player_id,player]));
  const groups=new Map();
  for(const row of current){if(!/^[a-z0-9]+$/.test(row.player_id))throw new Error('BBRef stable ID missing');if(!groups.has(row.player_id))groups.set(row.player_id,[]);groups.get(row.player_id).push(row);}
  const players=[];
  for(const [id,group] of groups) {
    const row=fullSeasonRow(group);
    const teams=group.filter(item=>!/^(?:\d+TM|TOT)$/.test(item.team)).map(item=>TEAM_ALIAS[item.team]||item.team);
    if(!teams.length||teams.some(team=>!teamIds.has(team)))throw new Error(`BBRef team unavailable: ${id}`);
    const candidates=names.get(nameKey(row.player))||[];
    const prior=previous.get(id);
    const {mapped,match}=resolveIdentity(row,teams,candidates,prior);
    const games=numeric(row.g),minutes=numeric(row.mp);
    if(!Number.isInteger(games)||games<1||minutes===null||minutes<0||
      (teams.length===1&&games>teamGames[teamIds.get(teams[0])]))throw new Error(`BBRef games/minutes inconsistent: ${id}`);
    const metrics=Object.fromEntries(Object.entries(fields).map(([field,key])=>[key,numeric(row[field])]));
    // A later verified NBA link must not split an already archived source identity.
    const playerId=prior?.player_id||mapped||`bbref:${id}`;
    players.push({player_id:playerId,source_player_id:id,player_name:row.player,nba_player_id:mapped,
      profile_slug:mapped?profiles.get(mapped)?.slug??null:null,
      identity_match:match,
      team:teams.length===1?teams[0]:`${teams.length}队合计`,team_id:teams.length===1?teamIds.get(teams[0]):null,
      team_ids:teams.map(team=>teamIds.get(team)),games_included:games,minutes_per_game:minutes/games,
      series_key:seriesKey(playerId),metrics,raw_stats:Object.fromEntries(['g','mp',...Object.keys(fields)].map(field=>[field,row[field]]))});
  }
  if(new Set(players.map(player=>player.player_id)).size!==players.length)throw new Error('Multiple source players map to one NBA ID');
  const mappedIds=players.map(player=>player.nba_player_id).filter(Boolean);
  if(new Set(mappedIds).size!==mappedIds.length)throw new Error('Multiple source identities map to one NBA ID');
  for(const metric of Object.values(fields))if(players.filter(player=>player.metrics[metric]!==null).length<100)
    throw new Error(`BBRef column missing or incomplete: ${metric}`);
  return {players:players.sort((a,b)=>a.player_id.localeCompare(b.player_id)),qualification};
}

export function verifyCutoff(teamGames,schedule) {
  if(schedule?.leagueSchedule?.seasonYear!=='2026-27')return {date:null,status:'unconfirmed',reason:'Official season schedule unavailable'};
  const groups=new Map();
  for(const bucket of schedule.leagueSchedule.gameDates||[])for(const game of bucket.games||[]) {
    if(!/^00226/.test(game.gameId)||Number(game.gameStatus)!==3)continue;
    const match=/^(\d{2})\/(\d{2})\/(\d{4})/.exec(bucket.gameDate);
    if(!match)throw new Error('Official schedule date changed');
    const date=`${match[3]}-${match[1]}-${match[2]}`;
    if(!groups.has(date))groups.set(date,[]);groups.get(date).push(game);
  }
  const counts=Object.fromEntries(Object.keys(teamGames).map(id=>[id,0]));
  for(const [date,games] of [...groups].sort(([a],[b])=>a.localeCompare(b))) {
    for(const game of games)for(const team of [game.homeTeam,game.awayTeam]){
      if(counts[String(team.teamId)]===undefined)throw new Error('Official NBA team ID mismatch');counts[String(team.teamId)]++;
    }
    if(Object.entries(teamGames).every(([id,gp])=>counts[id]===gp))return {date,status:'verified_team_counts',
      timezone:'America/New_York',basis:'All 30 source team game counts match completed NBA regular-season schedule through this official date; individual publication time is not asserted',
      total_games:Object.values(counts).reduce((a,b)=>a+b,0)/2};
  }
  return {date:null,status:'unconfirmed',reason:'No complete official game date matches all 30 source team counts'};
}

export const readJson=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
export async function verifyParticipation(root,players,cutoff,teamGames) {
  if(!cutoff.date)return cutoff;
  const manifest=await readJson(path.join(root,'data/games/manifest.json'));
  const games=Object.values(manifest?.games||{}).filter(game=>game.game_type==='regular'&&game.status==='final'&&game.official_date<=cutoff.date);
  const expected=Object.values(teamGames).reduce((sum,value)=>sum+value,0)/2;
  const unconfirmed=reason=>({...cutoff,date:null,status:'unconfirmed',team_count_date:cutoff.date,reason});
  if(games.length!==expected)return unconfirmed('Saved official box scores do not yet cover the team-matched statistical cutoff');
  const counts=new Map();
  for(const game of games) {
    const box=await readJson(path.join(root,`data/games/boxscores/${game.game_id}.json`));
    if(box?.completeness?.status!=='complete')return unconfirmed('Official participation archive is incomplete');
    if(!box?.teams?.home||!box?.teams?.away)return unconfirmed('Official participation archive is incomplete');
    for(const team of Object.values(box.teams))for(const player of team.players)if(player.played)
      counts.set(player.player_id,(counts.get(player.player_id)||0)+1);
  }
  const matched=players.filter(player=>player.nba_player_id);
  if(matched.some(player=>player.games_included!==(counts.get(player.nba_player_id)||0)))
    return unconfirmed('Player and team statistics may have different cutoffs; official participation counts disagree');
  return {...cutoff,player_games_check:{status:'verified',official_boxscores:games.length,matched_players:matched.length,
    unmatched_source_players:players.length-matched.length}};
}
export async function writeJson(file,value) {
  const text=JSON.stringify(value)+'\n';
  if(await readFile(file,'utf8').catch(error=>{if(error.code==='ENOENT')return null;throw error;})===text)return false;
  await mkdir(path.dirname(file),{recursive:true});const temporary=`${file}.tmp`;
  await writeFile(temporary,text);await rename(temporary,file);return true;
}

export async function archiveSource(directory,source,input,{now=new Date().toISOString(),dryRun=false}={}) {
  const manifest=await readJson(path.join(directory,'manifest.json'))||{schema_version:1,season:SEASON,season_type:SEASON_TYPE,sources:{}};
  const before=manifest.sources[source.id]||{snapshots:[]};
  const canonical={season:SEASON,season_type:SEASON_TYPE,players:input.players,qualification:input.qualification,
    data_as_of:input.cutoff.date,model_versions:input.model_versions};
  const digest=fingerprint(canonical),changed=before.fingerprint!==digest;
  if(before.latest&&input.cutoff.date&&before.data_as_of&&input.cutoff.date<before.data_as_of)
    throw new Error('Source rolled back to an earlier verified statistical cutoff');
  const status=input.cutoff.date ? input.latest_official_date&&input.cutoff.date<input.latest_official_date?'waiting_for_source':'ready':'cutoff_unconfirmed';
  const observedDate=dateInZone(now);
  let snapshot;
  if(changed) {
    const previous=before.latest?await readJson(path.join(directory,before.latest)):null;
    if(previous&&input.players.length<previous.players.length*.8)throw new Error('Source unexpectedly lost over 20% of players');
    const id=`${observedDate}-r${before.snapshots.length+1}-${digest.slice(0,10)}`;
    snapshot={schema_version:1,snapshot_id:id,season:SEASON,season_type:SEASON_TYPE,source,
      model_versions:input.model_versions,data_as_of:input.cutoff.date,cutoff_verification:input.cutoff,
      fetched_at:now,observed_date:observedDate,source_release:input.source_release,
      qualification:input.qualification,previous_snapshot:before.latest??null,players:input.players};
    snapshot.records=input.players.flatMap(player=>Object.entries(player.metrics).map(([metric,value])=>({
      player_id:player.player_id,source_player_id:player.source_player_id,season:SEASON,season_type:SEASON_TYPE,
      metric,value,source:source.id,model_version:input.model_versions[metric],data_as_of:input.cutoff.date,
      fetched_at:now,games_included:player.games_included,snapshot_id:id})));
    const relative=`snapshots/${source.id}/${id}.json`;
    before.latest=relative;before.fingerprint=digest;before.data_as_of=input.cutoff.date;
    before.snapshots.push({snapshot_id:id,path:relative,observed_date:observedDate,data_as_of:input.cutoff.date,fetched_at:now});
    if(!dryRun) {
      await writeJson(path.join(directory,relative),snapshot);
      for(const metric of Object.keys(input.model_versions))await writeJson(path.join(directory,`latest/${metric}.json`),metricTable(snapshot,previous,metric));
      const ranks=Object.fromEntries(Object.keys(input.model_versions).map(metric=>[metric,ranksFor(snapshot,metric)]));
      for(const player of input.players) {
        const file=path.join(directory,`series/${source.id}/${player.series_key}.json`);
        const series=await readJson(file)||{schema_version:1,season:SEASON,season_type:SEASON_TYPE,source:source.id,player_id:player.player_id,points:[]};
        series.points.push({snapshot_id:id,data_as_of:input.cutoff.date,observed_date:observedDate,fetched_at:now,
          games_included:player.games_included,metrics:player.metrics,model_versions:input.model_versions,
          ranks:Object.fromEntries(Object.entries(ranks).map(([key,item])=>[key,item.ranks.get(player.player_id)??null]))});
        await writeJson(file,series);
      }
    }
  }
  before.observations??=[];
  const observation={observed_date:observedDate,path:before.latest,snapshot_id:before.snapshots.at(-1).snapshot_id,
    data_as_of:input.cutoff.date,first_verified_at:now};
  const dayIndex=before.observations.findIndex(item=>item.observed_date===observedDate);
  if(dayIndex<0)before.observations.push(observation);
  else if(before.observations[dayIndex].path!==before.latest)before.observations[dayIndex]=observation;
  manifest.sources[source.id]={...before,label:source.label,url:source.url,status,
    latest_valid_fetched_at:snapshot?.fetched_at??before.latest_valid_fetched_at,
    cutoff_verification:input.cutoff,last_error:null};
  if(!dryRun)await writeJson(path.join(directory,'manifest.json'),manifest);
  return {changed,status,source:source.id,players:input.players.length,data_as_of:input.cutoff.date,
    cutoff_verification:input.cutoff,qualification:input.qualification,source_release:input.source_release,
    snapshot_id:snapshot?.snapshot_id??before.snapshots.at(-1)?.snapshot_id,samples:input.players.filter(player=>['201939','203999','1641705'].includes(player.nba_player_id))};
}

export async function recordFailure(directory,source,error,{dryRun=false}={}) {
  const manifest=await readJson(path.join(directory,'manifest.json'))||{schema_version:1,season:SEASON,season_type:SEASON_TYPE,sources:{}};
  const before=manifest.sources[source.id]||{snapshots:[]};
  manifest.sources[source.id]={...before,label:source.label,url:source.url,status:before.latest?'failed_with_snapshot':'unavailable',
    last_error:String(error.message).replace(/https?:\/\/\S+/g,'[source URL]').slice(0,300)};
  if(!dryRun)await writeJson(path.join(directory,'manifest.json'),manifest);
  return {source:source.id,error:error.message,preserved:!!before.latest};
}

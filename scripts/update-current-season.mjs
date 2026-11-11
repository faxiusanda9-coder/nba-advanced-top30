import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {mkdir,writeFile} from 'node:fs/promises';
import {qualify} from '../assets/current-season-core.mjs';
import {ROOT_DIRECTORY,nbaRows,nbaTeams,normalizeNba,normalizeBbref,verifyCutoff,
  archiveSource,recordFailure,readJson,verifyParticipation,primaryBbrefCsv} from './lib/current-season.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const directory=path.join(root,ROOT_DIRECTORY);
const config=await readJson(path.join(directory,'config.json'));
await mkdir(path.join(root,'out'),{recursive:true});
const args=process.argv.slice(2),dryRun=args.includes('--dry-run');
const source=args.find(arg=>arg.startsWith('--source='))?.slice(9)||'all';
if(!['all','bbref','nba','epm'].includes(source))throw new Error('Invalid --source; choose all, bbref, nba or epm');
const now=new Date().toISOString();
const report={schema_version:1,checked_at:now,season:'2026-27',dry_run:dryRun,http:[],sources:[]};
const headers={'User-Agent':'NBA-Advanced-Stats/1.0 (+https://github.com/faxiusanda9-coder/nba-advanced-top30)'};
let active=0;const waiting=[];
async function request(url) {
  if(active>=2)await new Promise(resolve=>waiting.push(resolve));else active++;
  try {
    for(let attempt=0;attempt<2;attempt++) {
      try {
        const requestHeaders=url.startsWith('https://cdn.nba.com/')?{'User-Agent':'Mozilla/5.0','Referer':'https://www.nba.com/'}:headers;
        const response=await fetch(url,{headers:requestHeaders,signal:AbortSignal.timeout(20000)});
        report.http.push({url,status:response.status,last_modified:response.headers.get('last-modified')});
        if(!response.ok){const error=new Error(`HTTP ${response.status}`);error.permanent=[400,401,403,404,429].includes(response.status);throw error;}
        return {text:await response.text(),last_modified:response.headers.get('last-modified'),etag:response.headers.get('etag')};
      } catch(error) {if(attempt===1||error.permanent)throw error;}
    }
  } finally {if(waiting.length)waiting.shift()();else active--;}
}
const json=async url=>JSON.parse((await request(url)).text);
const dataset='https://www.kaggle.com/api/v1/datasets/download/sumitrodatta/nba-aba-baa-stats/';
const nbaRelease='https://github.com/sportsdataverse/sportsdataverse-data/releases/download/';
const metadataUrl='https://www.kaggle.com/api/v1/datasets/view/sumitrodatta/nba-aba-baa-stats';
const existing=(await readJson(path.join(root,'api/_data/players.json'))).players;
let schedule;
try{schedule=await json('https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json');}
catch(error){
  report.schedule_error=error.message;
  const saved=await readJson(path.join(root,'data/games/manifest.json'));
  if(saved?.games) {
    const buckets=new Map();
    for(const game of Object.values(saved.games)) {
      const [year,month,day]=game.official_date.split('-');
      const date=`${month}/${day}/${year}`;
      if(!buckets.has(date))buckets.set(date,[]);
      buckets.get(date).push({gameId:game.game_id,gameStatus:game.status==='final'?3:1,
        homeTeam:{teamId:game.home.team_id},awayTeam:{teamId:game.away.team_id}});
    }
    schedule={leagueSchedule:{seasonYear:'2026-27',gameDates:[...buckets].map(([gameDate,games])=>({gameDate,games}))}};
    report.schedule_fallback='Saved NBA official schedule summaries; cutoff is confirmed only if all 30 team totals match';
  }
}
const latestOfficialDate=schedule?.leagueSchedule?.gameDates?.filter(bucket=>bucket.games.some(game=>/^00226/.test(game.gameId)&&Number(game.gameStatus)===3))
  .map(bucket=>{const [month,day,year]=bucket.gameDate.slice(0,10).split('/');return `${year}-${month}-${day}`;}).sort().at(-1)??null;

let nbaResponse,nbaIdentity;
if(source!=='epm') {
  try {
    nbaResponse=await request(`${nbaRelease}nba_stats_player_season_stats/player_season_stats_2027.csv`);
    nbaIdentity=nbaRows(nbaResponse.text);
  }catch(error){
    nbaResponse=null;
    report.identity_error=error.message;
    const savedManifest=await readJson(path.join(directory,'manifest.json'));
    const savedPath=savedManifest?.sources.nba?.latest;
    const saved=savedPath?await readJson(path.join(directory,savedPath)):null;
    if(saved?.season==='2026-27') {
      nbaIdentity=saved.players.map(player=>({player_id:player.nba_player_id,player_name:player.player_name,
        team_id:player.team_id,team_abbreviation:player.team}));
      report.identity_fallback='Previously verified NBA identities only; old statistics are not imported as new NBA data';
    }
  }
}
if(source==='all'||source==='nba') {
  try {
    if(!nbaResponse||!nbaIdentity)throw new Error(`NBA current-season statistics unavailable: ${report.identity_error}`);
    const teams=await request(`${nbaRelease}nba_stats_team_season_stats/team_season_stats_2027.csv`);
    const teamGames=nbaTeams(teams.text);
    const players=normalizeNba(nbaIdentity,teamGames,existing);
    const cutoff=await verifyParticipation(root,players,verifyCutoff(teamGames,schedule),teamGames);
    const result=await archiveSource(directory,config.sources.nba,{players,qualification:qualify(teamGames),cutoff,
      model_versions:{TS_PCT:'nba-stats-advanced-v1',USG_PCT:'nba-stats-advanced-v1'},
      source_release:{players_last_modified:nbaResponse.last_modified,teams_last_modified:teams.last_modified},
      latest_official_date:latestOfficialDate},{now,dryRun});
    report.sources.push(result);
  }catch(error){report.sources.push(await recordFailure(directory,config.sources.nba,error,{dryRun}));}
}
if(source==='all'||source==='bbref') {
  try {
    if(!nbaIdentity)throw new Error('Current NBA identities and team IDs unavailable; refusing name guessing');
    let raw,sourceInfo=config.sources.bbref,release;
    try {
      const advanced=await request(config.sources.bbref.reference);
      await writeFile(path.join(root,'out/current-season-primary-advanced.html'),advanced.text);
      const teams=await request('https://www.basketball-reference.com/leagues/NBA_2027.html');
      await writeFile(path.join(root,'out/current-season-primary-teams.html'),teams.text);
      raw=primaryBbrefCsv(advanced.text,teams.text);
      sourceInfo={...config.sources.bbref,provider:'basketball-reference',label:'Basketball Reference · 原始高阶表',
        url:config.sources.bbref.reference,note:'自动化运行环境可公开访问原始高阶表与同赛季球队页面。'};
      release={provider:'basketball-reference',advanced_last_modified:advanced.last_modified,teams_last_modified:teams.last_modified};
    }catch(error){report.bbref_primary_access=error.message;}
    if(!raw) {
      const before=await json(metadataUrl);
      const version=before.currentVersionNumberNullable??before.currentVersionNumber;
      if(!Number.isInteger(version))throw new Error('Kaggle dataset version missing');
      const [advanced,teams]=await Promise.all([request(`${dataset}Advanced.csv`),request(`${dataset}Team%20Summaries.csv`)]);
      const after=await json(metadataUrl);
      if(version!==(after.currentVersionNumberNullable??after.currentVersionNumber))throw new Error('Dataset changed during capture; retry later');
      raw={players:advanced.text,teams:teams.text};
      release={dataset_version:version,published_at:before.lastUpdated,advanced_last_modified:advanced.last_modified,
        teams_last_modified:teams.last_modified,license:before.licenseName};
    }
    const manifest=await readJson(path.join(directory,'manifest.json'));
    const previousPath=manifest?.sources.bbref?.latest;
    const previous=previousPath?await readJson(path.join(directory,previousPath)):null;
    const {players,qualification}=normalizeBbref(raw.players,raw.teams,nbaIdentity,existing,previous?.players);
    const cutoff=await verifyParticipation(root,players,verifyCutoff(qualification.team_games,schedule),qualification.team_games);
    const model_versions={BPM:'bbref-bpm2',OBPM:'bbref-bpm2',DBPM:'bbref-bpm2',VORP:'bbref-bpm2-vorp',
      WS:'bbref-win-shares',OWS:'bbref-win-shares',DWS:'bbref-win-shares',WS_48:'bbref-win-shares',PER:'bbref-per'};
    report.sources.push(await archiveSource(directory,sourceInfo,{players,qualification,cutoff,model_versions,
      source_release:release,
      latest_official_date:latestOfficialDate},{now,dryRun}));
  }catch(error){report.sources.push(await recordFailure(directory,config.sources.bbref,error,{dryRun}));}
}
if(source==='epm'||source==='all') {
  const result={source:'epm',status:'not_connected',reason:config.sources.epm.reason,imported_ratings:0};
  try {
    const methodology=await request(config.sources.epm.url);
    const page=await request('https://dunksandthrees.com/epm/actual?season=2027');
    result.public_methodology_accessible=true;
    result.author_api_subscription_required=/API subscription/i.test(methodology.text);
    result.public_page_title=page.text.match(/<title>([^<]+)<\/title>/)?.[1]??null;
  }catch(error){result.public_access_check_error=error.message;}
  report.sources.push(result);
}
await mkdir(path.join(root,'out'),{recursive:true});
await writeFile(path.join(root,'out/current-season-source-check.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(report.sources.some(item=>item.error))process.exitCode=1;

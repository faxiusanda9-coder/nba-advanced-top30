import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {qualify,metricTable,ranksFor,seriesSegments,METRICS} from '../assets/current-season-core.mjs';
import {archiveSource,recordFailure,readJson,writeJson,resolveIdentity,fullSeasonRow,verifyCutoff,parseCsv,normalizeNba,verifyParticipation,primaryBbrefCsv} from '../scripts/lib/current-season.mjs';
const dataRoot=new URL('../data/current-season/2026-27/',import.meta.url);
const load=async relative=>JSON.parse(await readFile(new URL(relative,dataRoot),'utf8'));
const source={id:'test',label:'Test fixture, never published',url:'https://example.test'};
const teamGames=Object.fromEntries(Array.from({length:30},(_,i)=>[String(i),10]));
const player=(id,value,options={})=>({player_id:id,source_player_id:id,player_name:`Fixture ${id}`,
  games_included:8,minutes_per_game:25,series_key:id,metrics:{BPM:value,TS_PCT:value},...options});
const snapshot=(players,options={})=>({season:'2026-27',season_type:'REG',source,model_versions:{BPM:'bpm2',TS_PCT:'nba-v1'},
  qualification:qualify(teamGames),players,snapshot_id:'fixture',...options});

test('ongoing season qualification uses all thirty same-snapshot teams, not a fixed 58 games',()=>{
  const q=qualify(teamGames);assert.equal(q.min_games,8);assert.equal(q.average_team_games,10);assert.equal(q.custom_rule,true);
  assert.equal(qualify(Object.fromEntries(Object.keys(teamGames).map(id=>[id,0]))).min_games,1);
  assert.throws(()=>qualify({'1':10}));
});

test('ranks preserve ties, negatives, true zero and missing values; search-ineligible players retain values',()=>{
  const s=snapshot([player('a',3),player('b',3),player('c',0),player('d',-1),player('e',null),player('f',99,{games_included:7}),player('g',100,{minutes_per_game:19.9})]);
  const ranks=ranksFor(s,'BPM');assert.equal(ranks.participants,4);
  assert.deepEqual([...ranks.ranks],[['a',1],['b',1],['c',3],['d',4]]);
  const rows=metricTable(s,null,'BPM').rows;
  assert.equal(rows.find(row=>row.player_id==='f').value,99);
  assert.equal(rows.find(row=>row.player_id==='f').state,'ineligible');
  assert.equal(rows.find(row=>row.player_id==='a').state,'first_seen');
  assert.equal(rows.find(row=>row.player_id==='c').value,0);
  assert.equal(rows.find(row=>row.player_id==='e').state,'missing');
});

test('changes distinguish first capture, new entry, loss of qualification and percentage points',()=>{
  const old=snapshot([player('a',50),player('b',60),player('c',55,{games_included:7}),player('d',40)]);
  const current=snapshot([player('a',61),player('b',62,{minutes_per_game:19}),player('c',56),player('d',40),player('new',70)]);
  const rows=metricTable(current,old,'TS_PCT').rows,map=new Map(rows.map(row=>[row.player_id,row]));
  assert.equal(map.get('a').value_change,11);assert.equal(map.get('a').previous_rank,2);assert.equal(map.get('a').rank,2);
  assert.equal(map.get('a').rank_change,0);assert.equal(map.get('c').state,'new_entry');assert.equal(map.get('c').rank_change,null);
  assert.equal(map.get('b').state,'ineligible');assert.equal(map.get('b').left_ranking,true);
  assert.equal(map.get('new').state,'first_seen');assert.equal(map.get('new').value_change,null);
  const changedSource=metricTable(snapshot([player('a',61,{games_included:1})],{source:{...source,provider:'new'}}),old,'TS_PCT');
  assert.equal(changedSource.rows[0].state,'ineligible');
  assert.equal(METRICS.find(metric=>metric.key==='TS_PCT').percentage,true);
});

test('different seasons, source identities, model versions and rule versions never produce deltas',()=>{
  const old=snapshot([player('a',3)]);
  for(const patch of [{season:'2025-26'},{season_type:'PST'},{source:{...source,id:'other'}},
    {source:{...source,provider:'different-provider'}},{model_versions:{BPM:'different'}},{qualification:{...old.qualification,version:'new-rule'}}]) {
    const result=metricTable(snapshot([player('a',5)],patch),old,'BPM');
    assert.equal(result.rows[0].value_change,null);assert.equal(result.rows[0].rank_change,null);assert.equal(result.rows[0].state,'incomparable');
  }
  const segments=seriesSegments([{metrics:{BPM:1},model_versions:{BPM:'v1'}},{metrics:{BPM:null},model_versions:{BPM:'v1'}},
    {metrics:{BPM:3},model_versions:{BPM:'v2'}}],'BPM');assert.equal(segments.length,2);
});

test('identity matching rejects similar names and namesakes, preserves verified IDs through transfers',()=>{
  const row={player:'Stephen Curry',player_id:'curryst01'};
  assert.equal(resolveIdentity(row,['GSW'],[{player_name:'Stephen Curry',team_abbreviation:'GSW',player_id:'201939'}]).mapped,'201939');
  assert.equal(resolveIdentity(row,['GSW'],[{player_name:'Steph Curry',team_abbreviation:'GSW',player_id:'201939'}]).mapped,null);
  assert.equal(resolveIdentity(row,['GSW'],[{player_name:'Stephen Curry',team_abbreviation:'GSW',player_id:'1'},{player_name:'Stephen Curry',team_abbreviation:'GSW',player_id:'2'}]).mapped,null);
  const prior={player_name:'Stephen Curry',nba_player_id:'201939'};
  assert.equal(resolveIdentity(row,['OTHER'],[],prior).mapped,'201939');
  assert.throws(()=>resolveIdentity(row,['GSW'],[{player_name:'Stephen Curry',team_abbreviation:'GSW',player_id:'wrong'}],prior));
  const group=[{team:'GSW',g:5},{team:'PHI',g:3},{team:'2TM',g:8}];assert.equal(fullSeasonRow(group).g,8);
  assert.throws(()=>fullSeasonRow(group.slice(0,2)));
});

test('a cutoff is confirmed only when every team count matches one full official game date',()=>{
  const teams=Object.fromEntries(Array.from({length:30},(_,i)=>[String(i+1),1]));
  const games=Array.from({length:15},(_,i)=>({gameId:`00226${String(i).padStart(5,'0')}`,gameStatus:3,homeTeam:{teamId:i*2+1},awayTeam:{teamId:i*2+2}}));
  const schedule={leagueSchedule:{seasonYear:'2026-27',gameDates:[{gameDate:'11/01/2026',games}]}};
  assert.equal(verifyCutoff(teams,schedule).date,'2026-11-01');
  assert.equal(verifyCutoff({...teams,'1':2},schedule).date,null);
  assert.equal(verifyCutoff(teams,{leagueSchedule:{seasonYear:'2025-26'}}).date,null);
});

test('CSV parsing keeps quoted names and blanks; missing fields never become zero',()=>{
  assert.deepEqual(parseCsv('id,name,value\n1,"Name, Jr.",\n2,"A""B",0\n'),[{id:'1',name:'Name, Jr.',value:''},{id:'2',name:'A"B',value:'0'}]);
  assert.throws(()=>parseCsv('id,name\n1,"cut off'));
});

test('primary HTML adapter validates season, complete player table, stable IDs and thirty team standings',()=>{
  const rows=Array.from({length:301},(_,i)=>`<tr><td data-stat="name_display"><a href="/players/a/player${i}.html">Name &amp; Test</a></td><td data-stat="team_name_abbr">AAA</td><td data-stat="games">8</td><td data-stat="mp">240</td><td data-stat="bpm">1.2</td><td data-stat="vorp">0.2</td><td data-stat="ws_per_48">.120</td></tr>`).join('');
  const advanced=`<title>2026-27 NBA Player Stats: Advanced</title><table id="advanced_stats">${rows}</table>`;
  const team=(letter,index)=>`<tr><th data-stat="team_name"><a href="/teams/A${letter}${String.fromCharCode(65+index)}/2027.html">Team ${index}</a></th><td data-stat="wins">4</td><td data-stat="losses">4</td></tr>`;
  const league='<title>2026-27 NBA Season Summary</title>'+['E','W'].map((side,index)=>`<table id="confs_standings_${side}">${Array.from({length:15},(_,i)=>team(index?'B':'A',i)).join('')}</table>`).join('');
  const result=primaryBbrefCsv(advanced,league),players=parseCsv(result.players),teams=parseCsv(result.teams);
  assert.equal(players.length,301);assert.equal(players[0].player,'Name & Test');assert.equal(players[0].player_id,'player0');
  assert.equal(players[0].ws_48,'.120');assert.equal(teams.length,30);
  assert.throws(()=>primaryBbrefCsv(advanced.replaceAll('2026-27','2025-26'),league));
  assert.throws(()=>primaryBbrefCsv(advanced,league.replace('confs_standings_W','missing_standings_W')));
  assert.throws(()=>primaryBbrefCsv('<title>Just a moment...</title>',league));
});

test('NBA percentages preserve real zero, missing values and true shooting over 100%',()=>{
  const rows=[{player_id:'1',player_name:'Fixture',team_id:'1',team_abbreviation:'X',gp:'1',min:'2',team_count:'1',ts_pct:'1.5',usg_pct:'0'},
    {player_id:'2',player_name:'Missing',team_id:'1',team_abbreviation:'X',gp:'1',min:'1',team_count:'1',ts_pct:'',usg_pct:''}];
  const players=normalizeNba(rows,{'1':1});assert.equal(players[0].metrics.TS_PCT,150);assert.equal(players[0].metrics.USG_PCT,0);
  assert.equal(players[1].metrics.TS_PCT,null);assert.equal(players[1].metrics.USG_PCT,null);
});

test('a delayed, revised or incomplete official participation archive cannot confirm player coverage',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'nba-current-test-'));
  const games={};
  try{
    for(let i=0;i<15;i++){
      const id=`00226${String(i).padStart(5,'0')}`;
      games[id]={game_id:id,game_type:'regular',status:'final',official_date:'2026-11-10'};
      await writeJson(path.join(directory,`data/games/boxscores/${id}.json`),{completeness:{status:'complete'},teams:{home:{players:[{player_id:String(i*2+1),played:true}]},away:{players:[{player_id:String(i*2+2),played:true}]}}});
    }
    await writeJson(path.join(directory,'data/games/manifest.json'),{games});
    const counts=Object.fromEntries(Object.keys(teamGames).map(id=>[id,1]));
    const cutoff={date:'2026-11-10',status:'verified_team_counts'};
    const good=await verifyParticipation(directory,[{nba_player_id:'1',games_included:1}],cutoff,counts);
    assert.equal(good.player_games_check.status,'verified');
    const mismatch=await verifyParticipation(directory,[{nba_player_id:'1',games_included:2}],cutoff,counts);
    assert.equal(mismatch.status,'unconfirmed');assert.equal(mismatch.date,null);
    delete games[Object.keys(games)[0]];await writeJson(path.join(directory,'data/games/manifest.json'),{games});
    assert.equal((await verifyParticipation(directory,[{nba_player_id:'1',games_included:1}],cutoff,counts)).date,null);
  }finally{assert(directory.startsWith(path.join(tmpdir(),'nba-current-test-')));await rm(directory,{recursive:true,force:true});}
});

test('archiving is idempotent, preserves valid data on failure, records daily checks and accepts corrections',async()=>{
  const directory=await mkdtemp(path.join(tmpdir(),'nba-current-test-'));
  const input={players:[player('1',2)],qualification:qualify(teamGames),cutoff:{date:'2026-11-10',status:'verified_team_counts'},
    model_versions:{BPM:'v1',TS_PCT:'v1'},latest_official_date:'2026-11-10'};
  try{
    const first=await archiveSource(directory,source,input,{now:'2026-11-11T01:00:00Z'});
    const manifestFile=path.join(directory,'manifest.json'),unchanged=await readFile(manifestFile,'utf8');
    assert.equal((await archiveSource(directory,source,input,{now:'2026-11-11T02:00:00Z'})).changed,false);
    assert.equal(await readFile(manifestFile,'utf8'),unchanged);
    const initialTable=await readFile(path.join(directory,'latest/BPM.json'),'utf8');
    await recordFailure(directory,source,new Error('HTTP 403'));
    assert.equal(await readFile(path.join(directory,'latest/BPM.json'),'utf8'),initialTable);
    let manifest=await readJson(manifestFile);assert.equal(manifest.sources.test.status,'failed_with_snapshot');
    assert.equal(manifest.sources.test.snapshots.length,1);
    const corrected={...input,players:[player('1',1)]};
    const second=await archiveSource(directory,source,corrected,{now:'2026-11-11T03:00:00Z'});
    assert.notEqual(first.snapshot_id,second.snapshot_id);
    assert.equal((await readJson(path.join(directory,'latest/BPM.json'))).rows[0].value_change,-1);
    await archiveSource(directory,source,corrected,{now:'2026-11-12T01:00:00Z'});
    manifest=await readJson(manifestFile);assert.equal(manifest.sources.test.snapshots.length,2);
    assert.equal(manifest.sources.test.observations.length,2);
    assert.equal(manifest.sources.test.latest_valid_fetched_at,'2026-11-11T03:00:00Z');
    await assert.rejects(archiveSource(directory,source,{...corrected,cutoff:{date:'2026-11-09'}},{now:'2026-11-12T02:00:00Z'}),/rolled back/);
  }finally{assert(directory.startsWith(path.join(tmpdir(),'nba-current-test-')));await rm(directory,{recursive:true,force:true});}
});

test('saved production snapshots are genuinely 2026–27, contain all metric lineage and preserve EPM limits',async()=>{
  const config=await load('config.json'),manifest=await load('manifest.json');
  assert.equal(config.season,'2026-27');assert.equal(config.sources.epm.status,'not_connected');
  assert.equal(config.sources.epm.types.EPM_EXPECTED,'expected_predictive');
  for(const [id,source] of Object.entries(manifest.sources)){
    const snapshot=await load(source.latest);assert.equal(snapshot.season,'2026-27');assert.equal(snapshot.season_type,'REG');
    assert(snapshot.players.length>300);assert.equal(Object.keys(snapshot.qualification.team_games).length,30);
    assert.equal(new Set(snapshot.players.map(player=>player.player_id)).size,snapshot.players.length);
    for(const record of snapshot.records){assert.equal(record.season,'2026-27');assert(record.model_version);assert.equal(record.source,id);assert.equal(record.snapshot_id,snapshot.snapshot_id);assert(Number.isInteger(record.games_included));assert(!record.metric.startsWith('EPM'));}
    for(const playerId of ['201939','203999','1641705']){
      const player=snapshot.players.find(player=>player.player_id===playerId);assert(player);
      if(id==='nba'){assert.equal(player.games_included,Number(player.raw_stats.gp));assert.equal(player.metrics.TS_PCT,Number(player.raw_stats.ts_pct)*100);}
      else{assert.equal(player.metrics.BPM,Number(player.raw_stats.bpm));assert.equal(player.games_included,Number(player.raw_stats.g));}
    }
  }
});

test('two actually captured NBA releases independently reproduce value and global-rank changes',async()=>{
  const manifest=await load('manifest.json'),latest=await load(manifest.sources.nba.snapshots[1].path);
  const first=await load(manifest.sources.nba.snapshots[0].path),table=metricTable(latest,first,'TS_PCT');
  assert(first.fetched_at<latest.fetched_at);assert(first.data_as_of<latest.data_as_of);
  const previousPlayers=new Map(first.players.map(player=>[player.player_id,player]));
  const rank=(snapshot,player)=>{
    if(player.games_included<snapshot.qualification.min_games||player.minutes_per_game<20||player.metrics.TS_PCT===null)return null;
    return 1+snapshot.players.filter(other=>other.games_included>=snapshot.qualification.min_games&&other.minutes_per_game>=20&&other.metrics.TS_PCT!==null&&other.metrics.TS_PCT>player.metrics.TS_PCT).length;
  };
  let changed=0;
  for(const row of table.rows){
    const player=latest.players.find(item=>item.player_id===row.player_id),old=previousPlayers.get(row.player_id);
    assert.equal(row.rank,rank(latest,player));
    if(old&&row.value!==null&&old.metrics.TS_PCT!==null){assert.equal(row.value_change,row.value-old.metrics.TS_PCT);if(row.value_change!==0)changed++;}
    if(row.rank!==null&&old&&rank(first,old)!==null)assert.equal(row.rank_change,rank(first,old)-row.rank);
  }
  assert(changed>0);
  const proof=JSON.parse(await readFile(new URL('../sources/current-season/2026-27/initial-nba-capture.json',import.meta.url),'utf8'));
  assert.equal(first.fetched_at,proof.fetched_at);assert.equal(proof.season,'2026-27');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { metrics, sortSeasons, trendSegments, formatMetric } from '../assets/player-profile-core.mjs';
import { applyBasic, extractBasic, parseCsv } from '../scripts/lib/player-basic.mjs';
import { applySnapshot, validateSnapshot } from '../scripts/add-estimated-raptor-playoffs.mjs';
const root=new URL('../',import.meta.url);
const read=async file=>JSON.parse(await readFile(new URL(file,root),'utf8'));
const handler=createRequire(import.meta.url)('../api/player.js');
async function api(slug){const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};await handler({method:'GET',query:{slug}},res);return res;}

test('all individual archives equal the original ID/season/phase records and basic snapshots',async()=>{
  const database=await read('api/_data/players.json');
  const profiles=new Map();
  let count=0;
  for(let year=1997;year<=2026;year++){
    const archive=await read(`data/${year}.json`),snapshot=await read(`sources/player-basic/${year}.json`);
    for(const phase of ['REG','PST']){
      const basic=new Map(snapshot.rows[phase].map(row=>[row.player_id,row]));
      for(const row of archive.rows[phase]){
        const id=String(row.playerId);
        if(!profiles.has(id))profiles.set(id,await read(`api/_data/profiles/${id}.json`));
        const profile=profiles.get(id),record=profile.seasons[phase].find(item=>item.ending_year===year);
        assert.equal(record.player_id,id);assert.equal(record.phase,phase);assert.equal(profile.player_id,id);
        assert.equal(record.stats.PTS,basic.get(id).PTS);assert.equal(record.stats.REB,basic.get(id).REB);assert.equal(record.stats.AST,basic.get(id).AST);
        for(const metric of metrics.filter(item=>!item.key.startsWith('RAPTOR_PHASE')))assert.equal(record.stats[metric.key],row[metric.key]??null,`${year} ${phase} ${id} ${metric.key}`);
        const prefix=record.raptor_source?.label.startsWith('FiveThirtyEight')?'RAPTOR':record.raptor_source?.label.includes('Estimated')?'EST_RAPTOR':record.raptor_source?'LAKER':null;
        for(const suffix of ['','_OFF','_DEF','_WAR'])assert.equal(record.stats[`RAPTOR_PHASE${suffix}`],prefix?row[prefix+suffix]??null:null);
        assert(!('RAPTOR_538' in record.stats));
        if(record.raptor_source)assert.equal(record.raptor_source.phase_specific,true);
        assert.equal(record.team_count,row.TEAM_COUNT);
        if(row.TEAM_COUNT>1)assert.equal(record.aggregation,'multi_team_season_total');
        count++;
      }
    }
  }
  assert.equal(profiles.size,database.player_count);
  assert.equal([...profiles.values()].reduce((n,p)=>n+p.seasons.REG.length+p.seasons.PST.length,0),count);
});

test('Jordan, LeBron, Curry and a role player have independent profiles; comeback and phase gaps remain real',async()=>{
  const cases=[['michael-jordan','893'],['lebron-james','2544'],['stephen-curry','201939'],['alex-caruso','1627936']];
  for(const [slug,id] of cases){const result=await api(slug);assert.equal(result.code,200);assert.equal(result.body.player.player_id,id);assert.equal(result.body.career.player_id,id);for(const phase of ['REG','PST'])assert(result.body.career.seasons[phase].every(row=>row.player_id===id));}
  const jordan=(await api('michael-jordan')).body.career;
  assert.deepEqual(jordan.seasons.REG.map(row=>row.ending_year),[1997,1998,2002,2003]);
  assert.deepEqual(jordan.seasons.PST.map(row=>row.ending_year),[1997,1998]);
  assert.equal(jordan.seasons.REG[0].stats.PTS,29.6);assert.equal(jordan.seasons.PST[0].stats.PTS,31.1);
  assert.equal(jordan.coverage.complete_career_verified,false);
  assert.equal(trendSegments(jordan.seasons.REG,'BPM').length,2);
  const curry=(await api('stephen-curry')).body.career;
  assert.equal(curry.seasons.PST.find(row=>row.ending_year===2025).stats.RAPTOR_PHASE,2.079392342);
  const lebron=(await api('lebron-james')).body.career;
  assert.equal(lebron.seasons.REG.at(-1).raptor_source.label,'Neil Paine LAKER');
  assert.equal(lebron.seasons.REG.at(-1).stats.PTS,20.9);
  // Namesakes never share files or profiles.
  const database=await read('api/_data/players.json');
  const ewings=database.players.filter(p=>p.full_name==='Patrick Ewing');
  assert.equal(ewings.length,2);assert.notEqual((await api(ewings[0].slug)).body.career.player_id,(await api(ewings[1].slug)).body.career.player_id);
});

test('2024-25 playoff RAPTOR keeps the complete final leaderboard, stable IDs and separate regular-season stats',async()=>{
  const snapshot=await read('sources/estimated-raptor/2025-PST.json');
  const archive=await read('data/2025.json');
  const regular=structuredClone(archive.rows.REG), original=structuredClone(archive.rows.PST);
  const target=structuredClone(archive);
  for(const row of target.rows.PST)for(const key of ['EST_RAPTOR','EST_RAPTOR_OFF','EST_RAPTOR_DEF','EST_RAPTOR_WAR'])delete row[key];
  assert.equal(applySnapshot(target,snapshot),219);assert.deepEqual(target.rows.REG,regular);
  for(const source of snapshot.records){
    const row=target.rows.PST.find(row=>String(row.playerId)===source.player_id);
    const profile=await read(`api/_data/profiles/${source.player_id}.json`);
    const season=profile.seasons.PST.find(row=>row.ending_year===2025);
    assert.equal(row.EST_RAPTOR,source.total);assert.equal(row.EST_RAPTOR_OFF,source.offense);
    assert.equal(row.EST_RAPTOR_DEF,source.defense);assert.equal(row.EST_RAPTOR_WAR,source.war);
    assert.equal(season.stats.RAPTOR_PHASE,source.total);assert.equal(season.raptor_source.url,snapshot.chartUrl);
    const before=original.find(row=>String(row.playerId)===source.player_id);
    for(const key of ['GP','MIN','PTS','BPM','VORP'])assert.equal(row[key],before[key]);
  }
  assert.equal(snapshot.records.find(row=>row.player_id==='1628983').total,4.806357679);
  assert.equal(snapshot.records.find(row=>row.player_id==='2544').total,4.927340952);
  const bad=structuredClone(snapshot);bad.records[0].player_id=bad.records[1].player_id;
  assert.throws(()=>validateSnapshot(bad),/记录异常/);
  const partial=structuredClone(snapshot);partial.records.find(row=>row.player_id==='1628983').games=22;
  assert.throws(()=>validateSnapshot(partial),/完整 23 场/);
  const switched=structuredClone(archive);switched.rows.PST[0].GP++;
  assert.throws(()=>applySnapshot(switched,snapshot),/不一致/);
  assert.deepEqual(switched.rows.PST[0].EST_RAPTOR,archive.rows.PST[0].EST_RAPTOR);
});

test('LeBron 2019-20 regular season and playoffs retain distinct games, averages, advanced stats and honors',async()=>{
  const result=await api('lebron-james'),{career,honors}=result.body;
  const regular=career.seasons.REG.find(row=>row.ending_year===2020);
  const playoffs=career.seasons.PST.find(row=>row.ending_year===2020);
  assert.equal(regular.player_id,'2544');assert.equal(playoffs.player_id,'2544');
  assert.equal(regular.phase,'REG');assert.equal(playoffs.phase,'PST');
  assert.equal(regular.stats.GP,67);assert.equal(playoffs.stats.GP,21);
  assert.equal(regular.stats.PTS,25.3);assert.equal(playoffs.stats.PTS,27.6);
  assert.equal(regular.stats.BPM,8.4);assert.equal(playoffs.stats.BPM,10.7);
  const regAwards=honors.records.filter(row=>row.award_year===2020&&row.phase==='REG').map(row=>row.award_type);
  const pstAwards=honors.records.filter(row=>row.award_year===2020&&row.phase==='PST').map(row=>row.award_type);
  assert(regAwards.includes('all_nba_1'));assert(!regAwards.includes('championship'));assert(!regAwards.includes('finals_mvp'));
  assert(pstAwards.includes('championship'));assert(pstAwards.includes('finals_mvp'));assert(!pstAwards.includes('mvp'));
});

test('sorting, missing values and chart discontinuities do not fabricate data',()=>{
  const make=(year,value,source='A')=>({ending_year:year,stats:{BPM:value,RAPTOR_PHASE:value},raptor_source:{label:source}});
  const list=[make(1997,-1),make(1998,0),make(1999,null),make(2000,2),make(2001,3,'B')];
  assert.deepEqual(sortSeasons(list,'BPM','desc').map(r=>r.ending_year),[2001,2000,1998,1997,1999]);
  assert.deepEqual(sortSeasons(list,'BPM','asc').map(r=>r.ending_year),[1997,1998,2000,2001,1999]);
  assert.equal(trendSegments(list,'BPM').length,2);assert.equal(trendSegments(list,'RAPTOR_PHASE').length,3);
  assert.equal(formatMetric(null,'PTS'),'—');assert.equal(formatMetric(0,'PTS'),'0.0');assert.equal(formatMetric(52.3,'TS_PCT'),'52.3%');assert.equal(formatMetric(.231,'WS_48'),'0.231');
});

test('basic importer matches stable IDs and phases, rejects duplicates and stale snapshots',()=>{
  const text='player_id,player_name,season,season_type,measure_type,per_mode,gp,min,pts,reb,ast,team_count\n1,"Same, Name",2026,regular-season,base,pergame,10,20,7,3,2,2\n2,"Same, Name",2026,playoffs,base,pergame,7,30,14,5,4,1\n';
  const snapshot=extractBasic(parseCsv(text),2026);
  const archive={rows:{REG:[{playerId:'1',GP:10,MIN:20},{playerId:'2',GP:10,MIN:20}],PST:[{playerId:'2',GP:7,MIN:30}]}};
  assert.equal(applyBasic(archive,snapshot),2);assert.equal(archive.rows.REG[0].PTS,7);assert.equal(archive.rows.PST[0].PTS,14);assert.equal(archive.rows.REG[1].PTS,undefined);
  archive.rows.REG[0].GP=11;applyBasic(archive,snapshot);assert.equal(archive.rows.REG[0].PTS,undefined);
  assert.throws(()=>extractBasic([...parseCsv(text),parseCsv(text)[0]],2026),/重复/);
});

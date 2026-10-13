import test from'node:test';import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';import{createRequire}from'node:module';
import{awardTypes,classifyPlayerAward,summarizeHonors,honorsForSeason,seasonYear}from'../assets/player-honors-core.mjs';
const root=new URL('../',import.meta.url),read=async file=>JSON.parse(await readFile(new URL(file,root),'utf8'));
const snapshots=await read('sources/honors/player-awards.json'),titles=await read('sources/honors/statistical-titles.json');
const database=await read('api/_data/players.json');
const honors=async id=>read(`api/_data/honors/${id}.json`);
// Fixed official acceptance fixtures must remain valid after annual updates
// add legitimate new awards. Validate these examples through 2025-26.
const honorsThrough2026=async id=>{const data=await honors(id);return{...data,records:data.records.filter(row=>row.award_year<=2026)};};
const count=(data,key)=>summarizeHonors(data).find(item=>item.key===key).count;

test('all indexed players have ID-bound official snapshots; only the fifteen requested honor categories appear',async()=>{
  const keys=new Set(awardTypes.map(type=>type.key));assert.equal(keys.size,15);
  assert.equal(Object.keys(snapshots.players).length,database.player_count);
  for(const player of database.players){
    const snapshot=snapshots.players[player.player_id],data=await honors(player.player_id);
    assert.equal(snapshot.player_id,player.player_id);assert.equal(data.player_id,player.player_id);
    const unique=new Set();
    for(const record of data.records){
      assert.equal(record.player_id,player.player_id);assert(keys.has(record.award_type));assert.equal(record.award_year,seasonYear(record.season));
      assert.equal(record.phase,awardTypes.find(t=>t.key===record.award_type).phase);
      assert(/^https:\/\/(?:(?:www|stats)\.)?nba\.com\//.test(record.source));assert(record.updated_at);
      const key=record.award_type+'|'+record.season;assert(!unique.has(key));unique.add(key);
      if(record.award_type.endsWith('_title'))assert.equal(titles.seasons[record.award_year].leaders[record.award_type].player_id,player.player_id);
      else assert(snapshot.records.some(row=>classifyPlayerAward(row)===record.award_type&&row.SEASON===record.season&&String(row.PERSON_ID)===player.player_id));
    }
    for(const type of awardTypes)assert.equal(data.coverage[type.key].status,'complete');
  }
});

test('the three core lifetime honors and winning years match official records, including pre-1996 wins',async()=>{
  for(const[id,champ,mvp,finals]of[
    ['893',[1991,1992,1993,1996,1997,1998],[1988,1991,1992,1996,1998],[1991,1992,1993,1996,1997,1998]],
    ['2544',[2012,2013,2016,2020],[2009,2010,2012,2013],[2012,2013,2016,2020]],
    ['201939',[2015,2017,2018,2022],[2015,2016],[2022]],
    ['203926',[],[],[]]
  ]){
    const data=await honorsThrough2026(id);
    for(const[key,years]of[['championship',champ],['mvp',mvp],['finals_mvp',finals]]){
      assert.equal(count(data,key),years.length);assert.deepEqual(data.records.filter(r=>r.award_type===key).map(r=>r.award_year),years);
    }
  }
  assert.equal(count(await honorsThrough2026('2544'),'championship'),4,'NBA Cup MVP is not an NBA championship');
});

test('All-NBA levels, All-Defensive levels, statistical titles and multiple same-season awards stay distinct',async()=>{
  for(const[id,nba,defense]of[['893',[10,1,0],[9,0]],['2544',[13,4,4],[5,1]],['201939',[4,5,2],[0,0]]]){
    const data=await honorsThrough2026(id);assert.deepEqual([1,2,3].map(level=>count(data,`all_nba_${level}`)),nba);
    assert.deepEqual([1,2].map(level=>count(data,`all_defensive_${level}`)),defense);
  }
  const jordan=await honorsThrough2026('893');assert.equal(count(jordan,'dpoy'),1);assert.equal(count(jordan,'roy'),1);assert.equal(count(jordan,'scoring_title'),10);
  const lebron=await honorsThrough2026('2544');assert.deepEqual(lebron.records.filter(r=>r.award_type==='assists_title').map(r=>r.award_year),[2020]);
  const curry=await honorsThrough2026('201939');assert.deepEqual(curry.records.filter(r=>r.award_type==='scoring_title').map(r=>r.award_year),[2016,2021]);
  const reg=honorsForSeason(lebron,2012,'REG').map(r=>r.award_type),pst=honorsForSeason(lebron,2012,'PST').map(r=>r.award_type);
  assert(reg.includes('mvp')&&reg.includes('all_nba_1')&&reg.includes('all_defensive_1'));assert(!reg.includes('championship'));
  assert.deepEqual(pst,['championship','finals_mvp']);assert.deepEqual(honorsForSeason(jordan,2003,'PST'),[]);
});

test('voting ranks and unrelated awards are never promoted to wins; missing values do not become zero',()=>{
  const base={PERSON_ID:2544,DESCRIPTION:'NBA Most Valuable Player',TYPE:'Award',SEASON:'2011-12'};
  assert.equal(classifyPlayerAward(base),'mvp');
  for(const row of[{...base,TYPE:'Voting',RANK:2},{...base,DESCRIPTION:'NBA Most Valuable Player Voting - 2nd'},
    {...base,DESCRIPTION:'NBA Sporting News Most Valuable Player of the Year'},{...base,DESCRIPTION:'NBA Cup Most Valuable Player'},
    {...base,DESCRIPTION:'NBA Player of the Month',MONTH:'01/01/2012'},{...base,SEASON:'2011-13'}])assert.equal(classifyPlayerAward(row),null);
  assert.equal(classifyPlayerAward({...base,DESCRIPTION:'All-NBA',ALL_NBA_TEAM_NUMBER:'2'}),'all_nba_2');
  assert.equal(classifyPlayerAward({...base,DESCRIPTION:'All-Defensive Team',ALL_NBA_TEAM_NUMBER:'3'}),null);
  const missing=summarizeHonors({records:[],coverage:{}});assert(missing.every(item=>item.count===null));
  const partial=summarizeHonors({records:[{award_type:'mvp'}],coverage:{mvp:{status:'partial'}}}).find(item=>item.key==='mvp');assert.equal(partial.count,null);assert.equal(partial.known_count,1);
});

const require=createRequire(import.meta.url),handler=require('../api/player.js');
async function request(slug){const res={setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};await handler({method:'GET',query:{slug}},res);return res;}
test('single-player API keeps careers intact, separates namesakes, and tolerates missing or foreign honor files',async()=>{
  const lebron=await request('lebron-james');assert.equal(lebron.code,200);assert.equal(lebron.body.honors.player_id,'2544');
  assert.deepEqual(lebron.body.career,await read('api/_data/profiles/2544.json'));
  const ewings=database.players.filter(p=>p.full_name==='Patrick Ewing');
  assert.equal(ewings.length,2);for(const player of ewings){const res=await request(player.slug);assert.equal(res.body.honors.player_id,player.player_id);assert(res.body.honors.records.every(r=>r.player_id===player.player_id));}
  const fs=require('node:fs/promises'),original=fs.readFile;
  try{
    fs.readFile=async(file,...args)=>String(file).includes('_data')&&String(file).includes('honors')?Promise.reject(new Error('Missing honors')):original(file,...args);
    const res=await request('lebron-james');assert.equal(res.code,200);assert.equal(res.body.career.player_id,'2544');assert.equal(count(res.body.honors,'championship'),null);
    fs.readFile=async(file,...args)=>String(file).includes('_data')&&String(file).includes('honors')?JSON.stringify({player_id:'893',records:[]}):original(file,...args);
    const bad=await request('lebron-james');assert.equal(bad.code,200);assert.equal(count(bad.body.honors,'championship'),null);
  }finally{fs.readFile=original;}
});

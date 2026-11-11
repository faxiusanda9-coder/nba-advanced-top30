import {METRICS,finite,formatValue,metricTable,seriesSegments} from './current-season-core.mjs';
import {createExplanationButton,loadExplanationCatalog} from './metric-explanations.mjs';
const $=id=>document.getElementById(id);
const node=(tag,text,cls)=>{const element=document.createElement(tag);if(text!=null)element.textContent=text;if(cls)element.className=cls;return element;};
const root='/data/current-season/2026-27';
let config,manifest,table,selectedMetric='BPM',selectedDate='',sortKey='rank',sortDirection=1,requestNumber=0,trendNumber=0;
const dates=new Set(),cache=new Map();
const number=value=>finite(value)!==null;
const chineseTime=value=>value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚未确认';
const statusLabel={ready:'已核验统计进度',waiting_for_source:'等待来源更新',cutoff_unconfirmed:'统计截止日期尚未确认',failed_with_snapshot:'抓取失败 · 保留上次有效快照',unavailable:'暂时无法获取'};
async function json(url){if(cache.has(url))return cache.get(url);const response=await fetch(url,{signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`数据暂时无法读取（HTTP ${response.status}）`);const result=await response.json();cache.set(url,result);return result;}
const currentMetric=()=>METRICS.find(item=>item.key===selectedMetric);
function link(text,href,external=false){const a=node('a',text);a.href=href;if(external){a.target='_blank';a.rel='noopener noreferrer';}return a;}

function renderSources(){
  $('sourceSummary').replaceChildren(...['bbref','nba','epm'].map(id=>{
    const info=config.sources[id],state=manifest.sources[id];
    const card=node('article',null,`source-card source-${id}`);
    if(id==='epm') {
      const details=node('details'),summary=node('summary','EPM · 暂未接入（Actual / Expected）');
      details.append(summary,node('p','Actual / Expected 分开核验，当前均不提供数值。'),node('p',info.reason),link('作者方法与 API 说明 ↗',info.url,true));card.append(details);return card;
    }
    card.append(node('h2',id==='bbref'?'BPM / WS / VORP / PER':'TS% / USG%'),node('span',statusLabel[state?.status]||'暂未收录',`source-status ${state?.status==='ready'?'':'waiting'}`),
      node('strong',state?.data_as_of||'尚未确认','source-cutoff'),node('p','统计截止 · NBA 官方比赛日期（美东）'),
      node('p',id==='bbref'?'Basketball Reference 衍生档案':'NBA Stats 公开档案'));
    const details=node('details');details.append(node('summary','来源与更新时间'),node('p',info.label),
      node('p',`${info.metrics.map(key=>METRICS.find(metric=>metric.key===key)?.label).join(' · ')}`),
      node('p',`有效快照抓取于 ${chineseTime(state?.latest_valid_fetched_at)}（北京时间）`),link('查看数据来源 ↗',info.url,true));
    if(state?.last_error)details.append(node('p',`本次获取失败：${state.last_error}`));
    if(id==='bbref')details.append(node('p','公开衍生档案可能落后于原站。这里不将抓取时间标为统计截止时间。'));
    card.append(details);
    return card;
  }));
}
function signed(value,metric){if(!number(value))return '—';const digits=METRICS.find(item=>item.key===metric)?.decimals??1;
  const rounded=Number(value.toFixed(digits));return `${rounded>0?'+':''}${rounded.toFixed(digits)}${metric.endsWith('_PCT')?' 个百分点':''}`;}
function stateLabel(row){return ({missing:'暂无数据',ineligible:row.left_ranking?'未达排名门槛 · 已离榜':'未达排名门槛',
  first_seen:'首次收录',new_entry:'新入榜',incomparable:'来源或模型口径变化 · 不比较',ranked:''})[row.state]||'';}
function rankChange(row){if(!number(row.rank_change))return stateLabel(row)||'—';return row.rank_change>0?`↑ 上升 ${row.rank_change} 位`:row.rank_change<0?`↓ 下降 ${-row.rank_change} 位`:'持平';}
function filteredRows(){
  const term=$('trackerSearch').value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim(),team=$('trackerTeam').value;
  return (table?.rows||[]).filter(row=>(!team||row.team_ids.includes(team))&&(!term||`${row.player_name} ${row.player_id} ${row.source_player_id}`.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().includes(term)))
    .sort((a,b)=>{
      const av=a[sortKey],bv=b[sortKey];
      if(av===null||av===undefined)return bv===null||bv===undefined?a.player_name.localeCompare(b.player_name):1;
      if(bv===null||bv===undefined)return -1;
      return (typeof av==='string'?av.localeCompare(bv):av-bv)*sortDirection||a.player_id.localeCompare(b.player_id);
    });
}
function renderRows(){
  const fragment=document.createDocumentFragment(),rows=filteredRows();
  for(const row of rows){
    const tr=node('tr',null,row.eligible?'':'ineligible');tr.dataset.playerId=row.player_id;
    const first=node('td'),identity=node('div',null,'tracker-player'),portrait=node('span',row.player_name.split(/\s+/).map(word=>word[0]).slice(0,2).join(''),'player-portrait');
    if(row.nba_player_id){const image=node('img');image.loading='lazy';image.decoding='async';image.src=`/assets/player-headshots/${row.nba_player_id}.png`;image.alt='';image.addEventListener('error',()=>image.remove(),{once:true});portrait.append(image);}
    const name=node('div',null,'tracker-player-name');name.append(row.profile_slug?link(row.player_name,`/player/${row.profile_slug}`):node('span',row.player_name));
    const team=node('small');if(row.team_id){const logo=node('img');logo.loading='lazy';logo.src=`/assets/team-logos/${row.team_id}.svg`;logo.alt='';logo.className='tracker-team-logo';logo.addEventListener('error',()=>logo.remove(),{once:true});team.append(logo);}team.append(document.createTextNode(row.team));name.append(team);
    if(!row.nba_player_id)name.append(node('small',`来源 ID：${row.source_player_id}`));identity.append(portrait,name);first.append(identity);tr.append(first);
    tr.append(node('td',row.games_included),node('td',row.minutes_per_game.toFixed(1)),node('td',formatValue(row.value,selectedMetric),'current-value'),
      node('td',row.previous_value===null?'—':formatValue(row.previous_value,selectedMetric)));
    const delta=node('td'),deltaText=node('span',signed(row.value_change,selectedMetric),row.value_change>0?'up':row.value_change<0?'down':'neutral');delta.append(deltaText);tr.append(delta,
      node('td',row.rank===null?'—':`第 ${row.rank}`),node('td',row.previous_rank===null?'—':`第 ${row.previous_rank}`));
    const movement=node('td');movement.append(node('span',rankChange(row),row.rank_change>0?'up':row.rank_change<0?'down':'neutral'));
    if(row.state==='ranked'&&row.rank_change===null)movement.append(node('small',stateLabel(row),'row-state'));
    tr.append(movement);const action=node('td'),button=node('button','查看曲线','trend-open');button.type='button';button.addEventListener('click',()=>openTrend(row));action.append(button);tr.append(action);
    const source=node('td');source.append(link('来源 ↗',table.source.url,true));source.className='record-source';tr.append(source);fragment.append(tr);
  }
  $('trackerRows').replaceChildren(fragment);
  $('trackerCount').textContent=`显示 ${rows.length} / ${table?.rows.length||0} 名球员；本指标有 ${table?.participants||0} 名合格球员参与联盟排名。筛选只改变显示，不重新计算联盟排名。`;
  for(const button of document.querySelectorAll('[data-sort]')){button.parentElement.removeAttribute('aria-sort');if(button.dataset.sort===sortKey)button.parentElement.setAttribute('aria-sort',sortDirection===1?'ascending':'descending');}
}

async function loadMetric(){
  const request=++requestNumber;trendNumber++;$('trackerTrend').hidden=true;$('trackerTableScroll').hidden=true;table=null;
  $('trackerCount').textContent='';$('qualificationNote').textContent='';$('comparisonNote').textContent='';
  const metric=currentMetric(),source=manifest.sources[metric.source];
  $('metricHeading').replaceChildren(node('h3',metric.label),node('span',metric.chinese));
  const explanation=createExplanationButton(metric.key,metric.label);if(explanation)$('metricHeading').append(explanation);
  $('sourceBadge').textContent=config.sources[metric.source].label;$('trackerState').className='tracker-state';
  if(metric.source==='epm'){
    $('trackerState').textContent=`暂未接入：${config.sources.epm.reason}`;$('trackerState').classList.add('warning');
    try{const catalog=await loadExplanationCatalog();if(request===requestNumber)$('trackerState').textContent+=` ${catalog.metrics[metric.key].short_description}`;}catch{}
    return;
  }
  if(!source?.latest){$('trackerState').textContent='该来源尚无有效数据。获取失败不能解释为没有球员或没有比赛。';return;}
  $('trackerState').textContent='正在读取有效统计快照…';
  try{
    let loaded;
    if(selectedDate){
      const chosen=(source.observations||source.snapshots).filter(item=>item.observed_date===selectedDate).at(-1);
      if(!chosen){$('trackerState').textContent=`${selectedDate} 尚未收录该来源的快照；不能用今天的值反向填补。`;return;}
      const snapshot=await json(`${root}/${chosen.path}`);
      const previous=snapshot.previous_snapshot?await json(`${root}/${snapshot.previous_snapshot}`):null;
      loaded=metricTable(snapshot,previous,metric.key);
    }else {
      loaded=await json(`${root}/latest/${metric.key}.json`);
      if(loaded.snapshot_id!==source.snapshots.at(-1).snapshot_id){
        const snapshot=await json(`${root}/${source.latest}`);
        const previous=snapshot.previous_snapshot?await json(`${root}/${snapshot.previous_snapshot}`):null;
        loaded=metricTable(snapshot,previous,metric.key);
      }
    }
    if(request!==requestNumber)return;
    table=loaded;
    const stale=source.status!=='ready';$('trackerState').classList.toggle('warning',stale);
    $('trackerState').textContent=`${selectedDate?`查询核验日 ${selectedDate} 的有效统计版本`:'最新有效快照'}：原始收录于北京时间 ${table.observed_date}；统计截至 ${table.data_as_of||'尚未确认'}（NBA 官方比赛日期，美东）。${statusLabel[source.status]||''}。`;
    const q=table.qualification;
    $('qualificationNote').textContent=`本站自定义排名规则：场均 ≥ ${q.min_minutes} 分钟，已出场 ≥ ${q.min_games} 场。最低场次 = max(1, ceil(${q.average_team_games.toFixed(3)} × 58 / 82))；平均场次取本来源同批 30 支球队，非 NBA 官方资格标准。${table.cutoff_verification?.status!=='verified_team_counts'?'统计截止日期尚未确认，未声称包含最新比赛。':'球队已赛场次已与 NBA 官方赛程逐队交叉核验。'}`;
    $('comparisonNote').textContent=table.previous_snapshot?`比较快照：${table.previous_snapshot.observed_date} / ${table.previous_snapshot.snapshot_id} → ${table.observed_date} / ${table.snapshot_id}；对应统计截止 ${table.previous_snapshot.data_as_of||'尚未确认'} → ${table.data_as_of||'尚未确认'}。`
      :`首次有效收录；尚无同来源、同模型及同规则的旧快照，数值和排名变化暂不显示。抓取时间：${chineseTime(table.fetched_at)}（北京时间）。`;
    const teamValue=$('trackerTeam').value,teams=new Map();
    table.rows.forEach(row=>row.team_ids.forEach(id=>{if(!teams.has(id)||row.team_ids.length===1)teams.set(id,row.team_ids.length===1?row.team:id);}));
    $('trackerTeam').replaceChildren(new Option('全部球队',''),...[...teams].sort(([,a],[,b])=>a.localeCompare(b)).map(([id,name])=>new Option(name,id)));
    if(teams.has(teamValue))$('trackerTeam').value=teamValue;
    $('trackerTableScroll').hidden=false;renderRows();
  }catch(error){if(request!==requestNumber)return;$('trackerState').textContent=error.message;$('trackerState').classList.add('warning');}
}

async function openTrend(row){
  const token=++trendNumber,metric=selectedMetric;$('trackerTrend').hidden=false;
  $('trendTitle').textContent=`${row.player_name} · ${currentMetric().label}`;$('trackerChart').replaceChildren();$('trendPoints').replaceChildren();
  $('trendReadout').textContent='正在读取已保存观察…';$('trendNote').textContent='横轴是实际收录时间。每一点另列来源统计截止日期；不同来源和模型不连线。';
  $('trackerTrend').scrollIntoView({behavior:'smooth',block:'start'});
  try{
    const series=await json(`${root}/series/${currentMetric().source}/${row.series_key}.json`);
    if(token!==trendNumber)return;
    const savedIds=new Set(manifest.sources[currentMetric().source].snapshots.map(item=>item.snapshot_id));
    const points=series.points.filter(point=>savedIds.has(point.snapshot_id)&&(!selectedDate||point.observed_date<=selectedDate));
    const read=point=>{const rank=point.ranks[metric];$('trendReadout').textContent=`收录 ${chineseTime(point.fetched_at)}（北京时间） · 统计截至 ${point.data_as_of||'尚未确认'}（美东比赛日期） · ${point.games_included} 场 · ${formatValue(point.metrics[metric],metric)} · ${rank?`联盟第 ${rank}`:'未参与合格排名'}`;for(const button of $('trendPoints').children)button.setAttribute('aria-pressed',String(button.dataset.snapshotId===point.snapshot_id));};
    points.forEach(point=>{const button=node('button',`${point.observed_date}\n${formatValue(point.metrics[metric],metric)} · ${point.games_included}场`);button.type='button';button.dataset.snapshotId=point.snapshot_id;button.addEventListener('click',()=>read(point));$('trendPoints').append(button);});
    if(points.filter(point=>number(point.metrics[metric])).length<2)$('trackerChart').append(node('p','目前不足两份包含真实数值的观察。下次来源发布新统计后，才会形成变化曲线。','one-observation'));
    else{
      const svgNS='http://www.w3.org/2000/svg',svg=document.createElementNS(svgNS,'svg'),width=Math.max(240,$('trackerChart').clientWidth||900);svg.setAttribute('viewBox',`0 0 ${width} 270`);svg.setAttribute('role','img');svg.setAttribute('aria-label',`${row.player_name}已保存的${metric}变化`);
      const values=points.map(point=>point.metrics[metric]).filter(number),min=Math.min(...values),max=Math.max(...values),pad=Math.max((max-min)*.2,.1);
      const times=points.map(point=>new Date(point.fetched_at).getTime()),start=Math.min(...times),end=Math.max(...times);
      const x=point=>60+(end===start?points.indexOf(point)/(points.length-1):(new Date(point.fetched_at).getTime()-start)/(end-start))*(width-80),y=value=>225-(value-min+pad)/(max-min+2*pad)*185;
      const shape=(tag,attrs)=>{const element=document.createElementNS(svgNS,tag);Object.entries(attrs).forEach(([key,value])=>element.setAttribute(key,String(value)));return element;};
      for(let i=0;i<4;i++){const value=min-pad+(max-min+2*pad)*i/3;svg.append(shape('line',{x1:60,x2:width-20,y1:y(value),y2:y(value),stroke:'#304453'}));const label=shape('text',{x:48,y:y(value)+4,fill:'#9aafbb','text-anchor':'end','font-size':12});label.textContent=value.toFixed(currentMetric().decimals);svg.append(label);}
      for(const [index,point]of [[0,points[0]],[1,points.at(-1)]]){const label=shape('text',{x:index?width-20:60,y:253,fill:'#9aafbb','text-anchor':index?'end':'start','font-size':11});label.textContent=new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(point.fetched_at));svg.append(label);}
      for(const segment of seriesSegments(points,metric)){
        if(segment.length>1)svg.append(shape('polyline',{points:segment.map(point=>`${x(point)},${y(point.metrics[metric])}`).join(' '),fill:'none',stroke:'#a5f0c5','stroke-width':3}));
        segment.forEach(point=>{const circle=shape('circle',{cx:x(point),cy:y(point.metrics[metric]),r:7,fill:'#a5f0c5',tabindex:0,role:'button','aria-label':`${point.observed_date} ${formatValue(point.metrics[metric],metric)}`});circle.addEventListener('click',()=>read(point));circle.addEventListener('focus',()=>read(point));circle.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();read(point);}});svg.append(circle);});
      }
      $('trackerChart').append(svg);
    }
    if(points.length)read(points.at(-1));else $('trendReadout').textContent='该日期以前尚未收录。';
  }catch(error){if(token===trendNumber)$('trendReadout').textContent=error.message;}
}

async function start(){
  try{
    [config,manifest]=await Promise.all([json(`${root}/config.json`),json(`${root}/manifest.json`)]);
    if(config.season!=='2026-27'||manifest.season!=='2026-27'||manifest.season_type!=='REG')throw new Error('本赛季数据的赛季或赛制不匹配，已停止显示。');
    $('trackerMetric').replaceChildren(...METRICS.map(metric=>new Option(`${metric.label} · ${metric.chinese}`,metric.key)));
    for(const source of Object.values(manifest.sources))for(const snapshot of source.observations||source.snapshots)dates.add(snapshot.observed_date);
    const saved=[...dates].sort();if(saved.length){$('trackerDate').min=saved[0];$('trackerDate').max=saved.at(-1);}
    renderSources();await loadMetric();
  }catch(error){$('trackerState').textContent=`读取失败：${error.message}`;}
}
$('trackerMetric').addEventListener('change',()=>{selectedMetric=$('trackerMetric').value;sortKey='rank';sortDirection=1;loadMetric();});
$('trackerSearch').addEventListener('input',renderRows);$('trackerTeam').addEventListener('change',renderRows);
$('trackerDate').addEventListener('change',()=>{selectedDate=$('trackerDate').value;loadMetric();});
$('trackerLatest').addEventListener('click',()=>{selectedDate='';$('trackerDate').value='';loadMetric();});
$('closeTrend').addEventListener('click',()=>{$('trackerTrend').hidden=true;trendNumber++;});
document.querySelectorAll('[data-sort]').forEach(button=>button.addEventListener('click',()=>{const key=button.dataset.sort;if(sortKey===key)sortDirection*=-1;else{sortKey=key;sortDirection=['player_name','rank','previous_rank'].includes(key)?1:-1;}renderRows();}));
start();

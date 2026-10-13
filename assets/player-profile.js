import { metrics, numeric, formatMetric, sortSeasons, metricSource, trendSegments } from './player-profile-core.mjs';
const $ = id => document.getElementById(id);
const element = (tag, text, className) => { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; };
let player, career, phase = 'REG', selectedYear, metricKey = 'BPM', tableGroup = 'basic', sortKey = 'season', sortDirection = 'desc';
const rows = () => career?.seasons[phase] || [];
const selected = () => rows().find(row => row.ending_year === selectedYear);
function teamLabel(row) { return row.team_count > 1 ? `${row.team_count} 队合计 · 登记 ${row.registered_team || '未知'}` : row.registered_team || '球队未提供'; }
function sourceLink(label, url) {
  if (!url || !/^https:\/\//.test(url)) return element('span', `${label}（来源未提供）`);
  const link = element('a',label); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; return link;
}
function renderSeason() {
  const row = selected(); if (!row) return;
  $('profileSeason').value = String(selectedYear);
  $('seasonTitle').textContent = `${row.season} · ${phase === 'REG' ? '常规赛' : '季后赛'}`;
  $('seasonTeam').textContent = teamLabel(row);
  $('seasonStats').replaceChildren(...['PTS','REB','AST','MIN','TS_PCT','USG_PCT','BPM','VORP','WS_48','RAPTOR_PHASE'].map(key => {
    const item = metrics.find(item => item.key === key), tile = element('div',null,'stat-tile');
    tile.append(element('span',item.label,'stat-label'),element('span',formatMetric(row.stats[key],key),'stat-value'));
    tile.title = numeric(row.stats[key]) == null ? '来源缺失，未用 0 填充' : metricSource(row,key); return tile;
  }));
  $('seasonModel').textContent = `${row.stats.GP ?? '—'} 场 · ${row.raptor_source ? `影响力模型：${row.raptor_source.label}（${phase === 'REG' ? '常规赛' : '季后赛'}）` : '本季缺少分赛制 RAPTOR / LAKER，未使用共享赛季评级替代。'}`;
  const sources = [['基础及 NBA 高阶统计 · NBA Stats / SportsDataverse',row.sources.nba], ['BPM、WS、VORP 等 · Basketball Reference 衍生档案',row.sources.basketball_reference]];
  if (row.raptor_source) sources.push([row.raptor_source.label,row.raptor_source.url]);
  $('seasonSources').replaceChildren(...sources.map(([label,url]) => { const li=element('li'); li.append(sourceLink(label,url)); return li; }));
}
function selectYear(year) { selectedYear = year; renderSeason(); renderTable(); renderChart(); }
function renderPhase() {
  const list = rows();
  document.querySelectorAll('[data-phase]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.phase === phase)));
  $('phaseCount').textContent = `${phase === 'REG' ? '常规赛' : '季后赛'} · ${list.length} 个已收录赛季 · 不套用 TOP30 入榜门槛`;
  $('profileSeason').disabled = !list.length; $('phaseEmpty').hidden = Boolean(list.length); $('phaseContent').hidden = !list.length;
  $('profileSeason').replaceChildren(...[...list].reverse().map(row => new Option(row.season,String(row.ending_year))));
  if (!list.length) return;
  if (!list.some(row => row.ending_year === selectedYear)) selectedYear = list.at(-1).ending_year;
  const available = metrics.filter(item => list.some(row => numeric(row.stats[item.key]) != null));
  if (!available.some(item => item.key === metricKey)) metricKey = available.some(item => item.key === 'BPM') ? 'BPM' : available[0]?.key;
  $('profileMetric').replaceChildren(...available.map(item => new Option(item.label,item.key))); $('profileMetric').value = metricKey;
  renderSeason(); renderChart(); renderTable();
}
function renderTable() {
  const table = $('seasonTable'), columns = metrics.filter(item => item.group === tableGroup);
  document.querySelectorAll('[data-table]').forEach(button => button.setAttribute('aria-pressed',String(button.dataset.table === tableGroup)));
  table.querySelector('caption').textContent = `${player.full_name} ${phase === 'REG' ? '常规赛' : '季后赛'}逐赛季${tableGroup === 'basic' ? '基础' : '高阶'}统计`;
  const tr = element('tr');
  for (const column of [{ key:'season',label:'赛季' },{key:'team',label:'球队 / 合计'},...columns,...(tableGroup === 'advanced' ? [{key:'model',label:'RAPTOR / LAKER 来源'}] : [])]) {
    const th = element('th'); th.scope = 'col';
    if (!['team','model'].includes(column.key)) {
      th.setAttribute('aria-sort',sortKey === column.key ? sortDirection === 'asc' ? 'ascending' : 'descending' : 'none');
      const button = element('button',`${column.label}${sortKey === column.key ? sortDirection === 'asc' ? ' ↑' : ' ↓' : ''}`);
      button.addEventListener('click',() => { sortDirection = sortKey === column.key && sortDirection === 'desc' ? 'asc' : 'desc'; sortKey=column.key; renderTable(); }); th.append(button);
    } else th.textContent = column.label;
    tr.append(th);
  }
  table.querySelector('thead').replaceChildren(tr);
  table.querySelector('tbody').replaceChildren(...sortSeasons(rows(),sortKey,sortDirection).map(row => {
    const tr=element('tr'); tr.dataset.year=String(row.ending_year); tr.classList.toggle('is-selected',row.ending_year === selectedYear);
    const td=element('td'), button=element('button',row.season,'season-link'); button.setAttribute('aria-label',`查看 ${row.season} 赛季速览`);
    button.addEventListener('click',() => { selectYear(row.ending_year); $('seasonTitle').scrollIntoView({block:'start',behavior:'auto'}); }); td.append(button); tr.append(td,element('td',teamLabel(row)));
    for (const item of columns) { const cell=element('td',formatMetric(row.stats[item.key],item.key)); cell.title=numeric(row.stats[item.key]) == null ? '来源未提供此指标' : metricSource(row,item.key); tr.append(cell); }
    if (tableGroup === 'advanced') tr.append(element('td',row.raptor_source?.label || '—','model-cell')); return tr;
  }));
}
function renderChart() {
  const container = $('trendChart'), list=rows(), segments=trendSegments(list,metricKey), points=segments.flat();
  container.replaceChildren(); $('chartModels').replaceChildren();
  if (!points.length) { container.append(element('div','该赛制没有此指标的真实数据。','chart-empty')); $('chartReadout').textContent='缺失值未补零。'; return; }
  const ns='http://www.w3.org/2000/svg';
  const svgNode=(tag,attrs,text) => { const node=document.createElementNS(ns,tag); for(const [key,value] of Object.entries(attrs)) node.setAttribute(key,String(value)); if(text!=null)node.textContent=text; return node; };
  const width = window.matchMedia('(max-width:760px)').matches ? 380 : 960, height=300, left=45,right=15,top=20,bottom=43;
  const start=Math.min(...list.map(row=>row.ending_year)), end=Math.max(...list.map(row=>row.ending_year));
  const values=points.map(point=>point.value); let low=Math.min(...values), high=Math.max(...values);
  const pad=Math.max((high-low)*.14,high===low ? Math.abs(high)*.1 : .01,.1); low-=pad;high+=pad;
  const x=year=>end===start ? (left+width-right)/2 : left+(year-start)/(end-start)*(width-left-right);
  const y=value=>top+(high-value)/(high-low)*(height-top-bottom);
  const svg=svgNode('svg',{viewBox:`0 0 ${width} ${height}`,role:'group','aria-label':`${player.full_name} ${phase==='REG'?'常规赛':'季后赛'} ${metrics.find(item=>item.key===metricKey)?.label}趋势`});
  for(let i=0;i<=4;i++){
    const value=low+(high-low)*i/4;
    svg.append(svgNode('line',{x1:left,x2:width-right,y1:y(value),y2:y(value),stroke:'#263547','stroke-dasharray':'3 4'}));
    svg.append(svgNode('text',{x:left-8,y:y(value)+4,'text-anchor':'end',fill:'#91a6b4','font-size':11},value.toFixed(metricKey==='WS_48'?3:1)));
  }
  if(low<0&&high>0)svg.append(svgNode('line',{x1:left,x2:width-right,y1:y(0),y2:y(0),stroke:'#62758a'}));
  const maxLabels=width<500?4:8, step=Math.max(1,Math.ceil((end-start)/Math.max(1,maxLabels-1)));
  for(let year=start;year<=end;year+=step)svg.append(svgNode('text',{x:x(year),y:height-15,'text-anchor':'middle',fill:'#91a6b4','font-size':11},String(year)));
  if(end!==start&&(end-start)%step)svg.append(svgNode('text',{x:x(end),y:height-15,'text-anchor':'end',fill:'#91a6b4','font-size':11},String(end)));
  for(const segment of segments){
    if(segment.length>1)svg.append(svgNode('polyline',{points:segment.map(point=>`${x(point.row.ending_year)},${y(point.value)}`).join(' '),fill:'none',stroke:'#a5f0c5','stroke-width':2.5,'stroke-linejoin':'round'}));
    for(const {row,value} of segment){
      const group=svgNode('g',{role:'button',tabindex:0,'aria-label':`${row.season} ${formatMetric(value,metricKey)}，查看本季`, 'aria-pressed':String(row.ending_year===selectedYear)});
      const description=`${row.season} · ${teamLabel(row)} · ${formatMetric(value,metricKey)} · ${metricSource(row,metricKey)}`;
      group.append(svgNode('title',{},description),svgNode('circle',{cx:x(row.ending_year),cy:y(value),r:13,fill:'transparent'}),svgNode('circle',{cx:x(row.ending_year),cy:y(value),r:row.ending_year===selectedYear?6:4,fill:row.ending_year===selectedYear?'#56d4ff':'#a5f0c5',stroke:'#111923','stroke-width':2,'pointer-events':'none'}));
      const read=()=>{$('chartReadout').textContent=description;};group.addEventListener('mouseenter',read);group.addEventListener('focus',read);
      group.addEventListener('click',()=>selectYear(row.ending_year));group.addEventListener('keydown',event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();selectYear(row.ending_year);}});svg.append(group);
    }
  }
  container.append(svg);
  const active=selected(); $('chartReadout').textContent=active?`${active.season} · ${formatMetric(active.stats[metricKey],metricKey)} · ${numeric(active.stats[metricKey])==null?'本季此指标缺失':metricSource(active,metricKey)}`:'轻触数据点查看';
  if(metricKey.startsWith('RAPTOR_PHASE')) $('chartModels').append(...[...new Set(points.map(point=>metricSource(point.row,metricKey)))].map(label=>element('span',label)),element('span','各版本口径不同；模型切换处不连线'));
  else $('chartModels').append(element('span','横轴：赛季结束年份'),element('span',metricSource(points[0].row,metricKey)));
}
function renderIdentity() {
  document.title=`${player.full_name} · NBA 球员档案`; $('profileName').textContent=player.full_name; $('playerId').textContent=`NBA ID · ${player.player_id}`;
  const avatar=$('profileAvatar');avatar.textContent=player.full_name.split(/\s+/).map(part=>part[0]).slice(0,2).join('').toUpperCase();
  if(/^\d+$/.test(String(player.player_id))){const image=element('img');image.src=`https://cdn.nba.com/headshots/nba/latest/260x190/${player.player_id}.png`;image.alt='';image.addEventListener('error',()=>image.remove(),{once:true});avatar.append(image);}
  $('profileFacts').replaceChildren(...[['末次登记球队',player.last_team||'未提供'],['位置',player.position||'来源未提供'],['本站生涯记录',`${player.career_range.first_season} — ${player.career_range.last_season}`]].map(([label,value])=>{const item=element('div');item.append(element('dt',label),element('dd',value));return item;}));
  $('teamHistory').replaceChildren(...player.team_history.map(team=>{const item=element('div',null,'history-item');item.append(element('strong',team.team),element('span',team.seasons.join('、')));return item;}));
}
async function loadProfile() {
  $('retryProfile').hidden=true; $('profileState').hidden=false; $('profileContent').hidden=true; $('careerContent').hidden=true;
  document.querySelector('.hero').setAttribute('aria-busy','true');
  try{
    const path=location.pathname.match(/^\/player\/([^/]+)\/?$/),slug=path?decodeURIComponent(path[1]):new URLSearchParams(location.search).get('slug');
    if(!slug||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))throw new Error('请通过球员搜索打开有效的球员档案。');
    const response=await fetch(`/api/player?slug=${encodeURIComponent(slug)}`,{signal:AbortSignal.timeout(15000)});
    if(response.status===404)throw new Error('未找到这位球员，试试右上角的搜索框。');
    if(!response.ok)throw new Error('档案暂时无法读取，请稍后重试。');
    const payload=await response.json();player=payload.player;career=payload.career;
    if(!player?.full_name||career?.player_id!==player.player_id||!Array.isArray(career.seasons?.REG)||!Array.isArray(career.seasons?.PST))throw new Error('档案格式异常，暂时无法显示。');
    renderIdentity(); $('profileState').hidden=true; $('profileContent').hidden=false; $('careerContent').hidden=false;renderPhase();
  }catch(error){$('profileState').textContent=error.message; $('retryProfile').hidden=false;}
  finally{document.querySelector('.hero').setAttribute('aria-busy','false');}
}
document.querySelectorAll('[data-phase]').forEach(button=>button.addEventListener('click',()=>{phase=button.dataset.phase;renderPhase();}));
document.querySelectorAll('[data-table]').forEach(button=>button.addEventListener('click',()=>{tableGroup=button.dataset.table;sortKey='season';sortDirection='desc';renderTable();}));
$('profileSeason').addEventListener('change',()=>selectYear(Number($('profileSeason').value)));
$('profileMetric').addEventListener('change',()=>{metricKey=$('profileMetric').value;renderChart();});
$('retryProfile').addEventListener('click',loadProfile);window.addEventListener('resize',()=>{if(career&&rows().length)renderChart();});
loadProfile();

import {spawn} from 'node:child_process';
import {mkdtemp, readFile, writeFile, rm, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = await mkdtemp(path.join(tmpdir(), 'nba-daily-edge-'));
const output = path.join(root, 'out', 'browser');
await mkdir(output, {recursive:true});
const edge = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const browser = spawn(edge, ['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check',
  '--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'], {windowsHide:true, stdio:'ignore'});
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
let socket;
try {
  let port;
  for (let attempt=0; attempt<100; attempt++) {
    try {port=Number((await readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]); break;}
    catch {await sleep(100);}
  }
  if (!port) throw new Error('Edge debugging port unavailable');
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = tabs.find(tab=>tab.type==='page');
  if (!page) throw new Error('Edge page target unavailable');
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
  let nextId=1;
  const pending = new Map();
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const {resolve,reject}=pending.get(message.id);pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
  });
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const id=nextId++;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}));
  });
  const evaluate=async expression=>(await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value;
  await send('Page.enable');await send('Runtime.enable');
  const scenarios=[
    {name:'home-320',width:320,height:844,url:'http://127.0.0.1:4173/',kind:'home'},
    {name:'home-390',width:390,height:844,url:'http://127.0.0.1:4173/',kind:'home'},
    {name:'daily-320',width:320,height:844,url:'http://127.0.0.1:4173/daily-games?date=2026-11-11',kind:'daily'},
    {name:'daily-390',width:390,height:844,url:'http://127.0.0.1:4173/daily-games?date=2026-11-11',kind:'daily'},
    {name:'game-320',width:320,height:844,url:'http://127.0.0.1:4173/game/0022600211',kind:'game'},
    {name:'game-390',width:390,height:844,url:'http://127.0.0.1:4173/game/0022600211',kind:'game'},
    {name:'game-1280',width:1280,height:900,url:'http://127.0.0.1:4173/game/0022600211',kind:'game'}
  ];
  if (process.env.CHECK_CURRENT_ONLY === '1') scenarios.splice(0,scenarios.length);
  if (process.env.CHECK_CURRENT_SEASON === '1') scenarios.push(...[320,390,1280].map(width=>({
    name:`current-${width}`,width,height:900,url:'http://127.0.0.1:4173/current-season/',kind:'current'})));
  if (process.env.CHECK_STATIC_MIRROR === '1') scenarios.push(
    {name:'mirror-player-390',width:390,height:844,url:'http://127.0.0.1:4173/player/lebron-james',kind:'player'});
  const origin = process.env.CHECK_SITE_ORIGIN || 'http://127.0.0.1:4173';
  const basePath = (process.env.SITE_BASE_PATH || '').replace(/\/$/, '');
  for (const scenario of scenarios) {
    scenario.url = scenario.url.replace('http://127.0.0.1:4173', `${origin}${basePath}`);
  }
  const requests=[];
  await send('Network.enable');
  socket.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(message.method==='Network.requestWillBeSent')requests.push(message.params.request.url);
  });
  async function waitFor(expression) {
    for(let attempt=0;attempt<150;attempt++) {
      if(await evaluate(expression))return;
      await sleep(200);
    }
    throw new Error(`Interaction did not finish: ${expression}`);
  }
  const report=[];
  for(const scenario of scenarios){
    await send('Emulation.setDeviceMetricsOverride',{width:scenario.width,height:scenario.height,
      deviceScaleFactor:1,mobile:scenario.width<600,screenWidth:scenario.width,screenHeight:scenario.height});
    await send('Emulation.setTouchEmulationEnabled',{enabled:scenario.width<600});
    await send('Page.navigate',{url:scenario.url});
    for(let attempt=0;attempt<60;attempt++){
      await sleep(100);
      const ready=await evaluate(`document.readyState==='complete' && ${scenario.kind==='daily'
        ? "document.querySelectorAll('.game-card').length>0" : scenario.kind==='game'
          ? "document.querySelectorAll('#playerTable tbody tr').length>0" : scenario.kind==='current'
            ? "document.querySelectorAll('#trackerRows tr').length>300" : scenario.kind==='player'
            ? "document.querySelector('#profileContent')?.hidden===false"
            : "document.querySelectorAll('#rows tr').length>1"}`);
      if(ready)break;
      if(attempt===59)throw new Error(`${scenario.name}: page did not finish loading`);
    }
    await sleep(350);
    const metrics=await evaluate(`({width:innerWidth,documentWidth:document.documentElement.scrollWidth,
      bodyWidth:document.body.scrollWidth,cards:document.querySelectorAll('.game-card').length,
      players:document.querySelectorAll('#playerTable tbody tr').length,
      loadedImages:[...document.images].filter(img=>img.complete&&img.naturalWidth>0).length,
      chartRows:document.querySelectorAll('.chart-row').length,
      navItems:document.querySelectorAll('.view-tabs > *, .section-tabs > *').length,
      basicHeaders:document.querySelectorAll('.ranking-table th.basic-stat').length,
      highlightCards:document.querySelectorAll('.basic-highlight').length,
      profileName:document.querySelector('#profileName')?.textContent,
      currentRows:document.querySelectorAll('#trackerRows tr').length,
      tableScroll:document.querySelector('.game-table-scroll')?.scrollWidth,
      tableViewport:document.querySelector('.game-table-scroll')?.clientWidth,
      chartOverlap:[...document.querySelectorAll('.chart-row')].some(row=>{
        let name=row.querySelector('.chart-player').getBoundingClientRect();
        let bar=row.querySelector('.bar-track').getBoundingClientRect();
        let value=row.querySelector('.chart-value').getBoundingClientRect();
        return name.right>bar.left+1||bar.right>value.left+1;
      })})`);
    const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(path.join(output,`${scenario.name}.png`),Buffer.from(shot.data,'base64'));
    if(scenario.kind==='game'){
      const interaction=await evaluate(`(()=>{
        document.querySelector('#showAllChart').click();
        const allRows=document.querySelectorAll('.chart-row').length;
        document.querySelector('#playerTable th:nth-child(2) button').click();
        const sorted=document.querySelector('#playerTable th:nth-child(2)').getAttribute('aria-sort');
        const table=document.querySelector('.game-table-scroll');
        table.scrollLeft=0;table.scrollIntoView({block:'start',inline:'nearest'});
        return {allRows,sorted,tableScrollLeft:table.scrollLeft};
      })()`);
      metrics.allChartRows=interaction.allRows;metrics.pointsSorted=interaction.sorted;
      const tableShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      await writeFile(path.join(output,`${scenario.name}-table.png`),Buffer.from(tableShot.data,'base64'));
    }
    report.push({scenario:scenario.name,...metrics});
    if(metrics.width!==scenario.width || metrics.documentWidth>scenario.width+1 || metrics.bodyWidth>scenario.width+1
        || (scenario.kind!=='home'&&scenario.kind!=='player'&&metrics.loadedImages<2) || metrics.chartOverlap
        || (scenario.kind==='home'&&(metrics.navItems!==4||metrics.basicHeaders!==6))
        || (scenario.kind==='player'&&metrics.profileName!=='LeBron James')
        || (scenario.kind==='current'&&(metrics.currentRows<300||metrics.navItems!==4))
        || (scenario.kind==='daily'&&(metrics.cards!==6||metrics.navItems!==4))
        || (scenario.kind==='game'&&(metrics.players<10 || metrics.highlightCards!==6 ||
          metrics.allChartRows!==metrics.players || metrics.pointsSorted!=='descending')))
      throw new Error(`${scenario.name}: layout/data check failed ${JSON.stringify(metrics)}`);
  }
  if(process.env.CHECK_STATIC_MIRROR==='1') {
    const honors=await evaluate(`!document.querySelector('#honorsSection').hidden && document.querySelectorAll('.core-honor').length===3`);
    if(!honors)throw new Error('Player honors missing');
    await evaluate(`document.querySelector('[data-phase="PST"]').click()`);
    await waitFor(`document.querySelector('[data-phase="PST"]').getAttribute('aria-pressed')==='true' && document.querySelector('#phaseCount').textContent.includes('季后赛')`);
    await evaluate(`document.querySelector('.metric-info[data-explanation-key="BPM"]').click()`);
    await waitFor(`document.querySelector('#metricExplanationDialog')?.open && document.querySelector('#metricExplanationTitle').textContent!=='指标解释'`);
    const guideLink=await evaluate(`document.querySelector('.metric-guide-link').href`);
    if(!guideLink.startsWith(`${origin}${basePath}/advanced-guide#`))throw new Error('Explanation guide left site prefix');
    await send('Page.navigate',{url:`${origin}${basePath}/advanced-guide/`});
    await waitFor(`document.querySelector('#guideContent')?.hidden===false`);
    await send('Page.navigate',{url:`${origin}${basePath}/`});
    await waitFor(`document.querySelector('.player-search-input') && document.querySelectorAll('#rows tr').length>1`);
    await evaluate(`(()=>{const input=document.querySelector('.player-search-input');input.focus();input.value='curry';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await waitFor(`document.querySelector('.player-search-result')?.textContent.includes('Curry')`);
    const result=await evaluate(`document.querySelector('.player-search-result').href`);
    if(!result.startsWith(`${origin}${basePath}/player/`))throw new Error('Search result left site prefix');
    await evaluate(`document.querySelector('#careerTab').click()`);
    await waitFor(`!document.querySelector('#careerView').hidden && document.querySelectorAll('#playerNames option').length>100`);
    await evaluate(`(()=>{document.querySelector('#playerA').value='LeBron James';document.querySelector('#playerB').value='Stephen Curry';document.querySelector('#comparePlayers').click();})()`);
    await waitFor(`document.querySelectorAll('#careerChart circle').length>2`);
    const external=requests.filter(url=>/^https?:/.test(url)&&!url.startsWith(`${origin}/`));
    if(external.length)throw new Error(`Runtime requests left new host: ${external.join(', ')}`);
    report.push({scenario:'migration-features',honors:true,playoffs:true,explanation:true,guide:true,
      search:true,career_comparison:true,external_runtime_requests:external.length});
  }
  if(process.env.CHECK_CURRENT_SEASON==='1') {
    await send('Page.navigate',{url:`${origin}${basePath}/current-season/`});
    await waitFor(`document.querySelectorAll('#trackerRows tr').length>300`);
    await evaluate(`(()=>{const search=document.querySelector('#trackerSearch');search.value='Stephen Curry';search.dispatchEvent(new Event('input'));})()`);
    const firstSeen=await evaluate(`/首次收录|口径变化/.test(document.querySelector('#trackerRows tr').textContent)`);
    if(!firstSeen)throw new Error('BPM invented a previous snapshot');
    await evaluate(`(()=>{const metric=document.querySelector('#trackerMetric');metric.value='TS_PCT';metric.dispatchEvent(new Event('change'));})()`);
    await waitFor(`!document.querySelector('#trackerTableScroll').hidden && document.querySelector('#metricHeading h3').textContent==='TS%' && document.querySelectorAll('#trackerRows tr').length===1`);
    const actual=await evaluate(`(async()=>{const latest=await (await fetch(${JSON.stringify(`${origin}${basePath}/data/current-season/2026-27/latest/TS_PCT.json`)})).json();const row=latest.rows.find(item=>item.player_id==='201939');const cells=document.querySelector('#trackerRows tr').cells;return {expected:row.value.toFixed(1)+'%',value:cells[3].textContent,rank:cells[6].textContent,expectedRank:'第 '+row.rank,comparison:document.querySelector('#comparisonNote').textContent};})()`);
    if(actual.value!==actual.expected||actual.rank!==actual.expectedRank||!actual.comparison.includes('2026-11-09'))throw new Error(`Current-season player data mismatch ${JSON.stringify(actual)}`);
    await evaluate(`document.querySelector('.trend-open').click()`);
    await waitFor(`document.querySelectorAll('#trendPoints button').length>=2 && document.querySelectorAll('#trackerChart circle').length>=2`);
    await evaluate(`document.querySelector('#trendPoints button').click()`);
    if(!(await evaluate(`document.querySelector('#trendReadout').textContent.includes('2026-11-09')`)))throw new Error('Touch chart failed to read saved cutoff');
    for(const key of ['EPM_ACTUAL','EPM_EXPECTED']){
      await evaluate(`(()=>{const metric=document.querySelector('#trackerMetric');metric.value=${JSON.stringify(key)};metric.dispatchEvent(new Event('change'));})()`);
      await waitFor(`document.querySelector('#trackerTableScroll').hidden && document.querySelector('#trackerState').textContent.includes('暂未接入')`);
    }
    await evaluate(`(()=>{const metric=document.querySelector('#trackerMetric');metric.value='BPM';metric.dispatchEvent(new Event('change'));})()`);
    await waitFor(`!document.querySelector('#trackerTableScroll').hidden`);
    await evaluate(`(()=>{const date=document.querySelector('#trackerDate');date.value='2026-10-01';date.dispatchEvent(new Event('change'));})()`);
    await waitFor(`document.querySelector('#trackerState').textContent.includes('尚未收录') && document.querySelector('#trackerTableScroll').hidden`);
    const external=requests.filter(url=>/^https?:/.test(url)&&!url.startsWith(`${origin}/`));
    if(external.length)throw new Error(`Current-season external runtime request: ${external.join(', ')}`);
    report.push({scenario:'current-season-interactions',search:true,source_values:true,global_rank:true,
      real_snapshot_comparison:true,touch_trend:true,epm_missing:true,unarchived_date:true,external_runtime_requests:external.length});
  }
  console.log(JSON.stringify(report,null,2));
} catch (error) {
  console.error(error); process.exitCode=1;
} finally {
  socket?.close(); browser.kill();
  if(profile.startsWith(tmpdir())) await Promise.race([
    rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{}), sleep(2000)
  ]);
}
process.exit(process.exitCode || 0);

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
          ? "document.querySelectorAll('#playerTable tbody tr').length>0"
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
        || (scenario.kind!=='home'&&metrics.loadedImages<2) || metrics.chartOverlap
        || (scenario.kind==='home'&&(metrics.navItems!==3||metrics.basicHeaders!==6))
        || (scenario.kind==='daily'&&(metrics.cards!==6||metrics.navItems!==3))
        || (scenario.kind==='game'&&(metrics.players<10 || metrics.highlightCards!==6 ||
          metrics.allChartRows!==metrics.players || metrics.pointsSorted!=='descending')))
      throw new Error(`${scenario.name}: layout/data check failed ${JSON.stringify(metrics)}`);
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

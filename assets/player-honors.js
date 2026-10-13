import {awardTypes,summarizeHonors,honorsForSeason} from './player-honors-core.mjs';
const $=id=>document.getElementById(id);
const node=(tag,text,className)=>{const el=document.createElement(tag);if(text!=null)el.textContent=text;if(className)el.className=className;return el;};
function link(label,url){const a=node('a',label);if(/^https:\/\/(?:(?:www|stats)\.)?nba\.com\//.test(url||'')){a.href=url;a.target='_blank';a.rel='noopener noreferrer';}return a;}
function yearList(item){
  const list=node('ul',null,'honor-years');
  if(!item.records.length){list.append(node('li',item.status==='complete'?'尚未获得':'数据暂缺，无法确认获奖次数'));return list;}
  for(const record of item.records){const li=node('li');li.append(link(String(record.award_year),record.source),node('span',record.season,'honor-season-label'));list.append(li);}
  return list;
}
export function renderHonors(honors){
  const items=summarizeHonors(honors);$('honorsSection').hidden=false;
  $('coreHonors').replaceChildren(...items.filter(item=>item.group==='core').map(item=>{
    const card=node('article',null,'core-honor');card.dataset.award=item.key;
    card.append(node('h3',item.label),node('span',item.count==null?'数据暂缺':String(item.count),`honor-count${item.count==null?' is-missing':''}`));
    if(item.count==null&&item.known_count)card.append(node('p',`已确认 ${item.known_count} 次`,'honor-partial'));
    const details=node('details');details.append(node('summary','获奖年份'),yearList(item));card.append(details);return card;
  }));
  const other=items.filter(item=>item.group==='other'&&(item.known_count>0||item.status!=='complete'));
  $('otherHonorsList').replaceChildren(...other.map(item=>{
    const details=node('details',null,'honor-extra-item');details.dataset.award=item.key;
    const summary=node('summary');summary.append(node('span',item.label,'honor-extra-label'),node('strong',item.count==null?'数据暂缺':`${item.count} 次`,`honor-extra-count${item.count==null?' is-missing':''}`),node('span','查看年份 ⌄','honor-extra-action'));
    details.append(summary);if(item.count==null&&item.known_count)details.append(node('p',`已确认 ${item.known_count} 次，名单仍待补齐。`,'honors-note'));details.append(yearList(item));return details;
  }));
  if(!other.length)$('otherHonorsList').append(node('p','暂无已记录的其他指定荣誉。','honors-note'));
  const coverage=honors?.coverage?.championship;
  $('honorsCoverage').textContent=coverage?.status==='complete'?`核心荣誉：NBA 官方 PlayerAwards，核验至 ${coverage.through_year} 年。统计王使用官方赛季回顾名单。展开年份可打开来源。`:'核心荣誉来源暂缺，未把未知次数填为 0。已有赛季统计仍可正常查看。';
}
let lastTrigger;
function openSeasonHonors(records,row,trigger){
  lastTrigger=trigger;
  $('seasonHonorsTitle').textContent=`${row.season} · ${row.phase==='PST'?'季后赛':'常规赛'}荣誉`;
  $('seasonHonorsList').replaceChildren(...records.map(record=>{
    const item=node('li');item.append(node('strong',awardTypes.find(type=>type.key===record.award_type)?.label||record.award_type),link('NBA 官方来源 ↗',record.source));return item;
  }));
  $('seasonHonorsDialog').showModal();
}
export function seasonHonorMarker(honors,row){
  if(String(honors?.player_id)!==String(row.player_id))return null;
  const records=honorsForSeason(honors,row.ending_year,row.phase).filter(record=>record.season===row.season&&String(record.player_id)===String(row.player_id));
  if(!records.length)return null;
  const isTrophy=row.phase==='PST'?records.some(record=>record.award_type==='championship'):records.some(record=>record.award_type==='mvp');
  const button=node('button',isTrophy?'🏆':'🏅','season-honor-marker');button.type='button';button.setAttribute('aria-label',`查看 ${row.season} ${row.phase==='PST'?'季后赛':'常规赛'}的 ${records.length} 项荣誉`);
  button.setAttribute('aria-haspopup','dialog');button.addEventListener('click',()=>openSeasonHonors(records,row,button));return button;
}
$('closeSeasonHonors').addEventListener('click',()=>$('seasonHonorsDialog').close());
$('seasonHonorsDialog').addEventListener('close',()=>lastTrigger?.focus());

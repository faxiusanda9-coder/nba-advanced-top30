import {beijingToday, relativeDate, beijingTime, typeName, statusName, shown, dateViewState} from './daily-games-core.mjs';

const $ = id => document.getElementById(id);
const today = beijingToday();
let request = 0;
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00Z`).getTime());
const initial = new URLSearchParams(location.search).get('date');
let selected = validDate(initial) ? initial : today;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function logo(team) {
  const wrap = element('span', team.tricode || '?', 'team-logo');
  if (/^\d{10}$/.test(team.team_id)) {
    const image = element('img');
    image.src = `/assets/team-logos/${team.team_id}.svg`;
    image.alt = ''; image.loading = 'lazy'; image.onerror = () => image.remove(); wrap.append(image);
  }
  return wrap;
}

function teamNode(team) {
  const block = element('div', undefined, 'team');
  block.append(logo(team), element('div', team.name || team.tricode || '待定', 'team-name'));
  return block;
}

function card(game) {
  const link = element('a', undefined, 'game-card');
  link.href = `/game/${game.game_id}`;
  const top = element('div', undefined, 'card-top');
  top.append(element('span', typeName[game.game_type] || '比赛', 'game-type'),
    element('span', statusName[game.status] || '状态待核实', `status ${game.status}`));
  const matchup = element('div', undefined, 'matchup');
  const score = element('div', `${shown(game.away.score)} : ${shown(game.home.score)}`,
    `score ${game.away.score === null || game.home.score === null ? 'pending' : ''}`);
  matchup.append(teamNode(game.away), score, teamNode(game.home));
  const bottom = element('div', undefined, 'card-bottom');
  const dataState = game.status === 'final' && game.boxscore_state !== 'complete' ? ' · 技术统计待补' : '';
  bottom.append(element('span', `${beijingTime(game.start_utc)}${dataState}`), element('span', '查看比赛数据 →', 'open'));
  link.append(top, matchup, bottom);
  return link;
}

async function getJson(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(10000)});
  if (!response.ok) return {status: response.status, data: null};
  return {status: response.status, data: await response.json()};
}

async function loadDate() {
  const token = ++request;
  $('gameList').replaceChildren(); $('loadState').className = 'load-state';
  $('loadState').textContent = '正在读取比赛归档…';
  $('dateTitle').textContent = `${selected} · 北京时间`;
  $('dateSummary').textContent = ''; $('lastUpdated').textContent = '';
  $('gameDate').value = selected;
  $('todayButton').setAttribute('aria-pressed', String(selected === today));
  $('yesterdayButton').setAttribute('aria-pressed', String(selected === relativeDate(today, -1)));
  try {
    const [dateResult, manifestResult] = await Promise.all([
      getJson(`/data/games/dates/${selected}.json`), getJson('/data/games/manifest.json')
    ]);
    if (token !== request) return;
    const index = dateResult.data, manifest = manifestResult.data;
    const state = dateViewState(dateResult.status, index, manifest, selected, today);
    if (state === 'games') {
      $('loadState').textContent = '';
      $('dateSummary').textContent = `${index.game_count} 场比赛 · ${index.final_count} 场已结束${index.complete ? ' · 当日统计已完整归档' : ''}`;
      $('gameList').replaceChildren(...index.games.map(card));
      $('lastUpdated').textContent = `数据最后更新：${index.last_updated_at ? beijingTime(index.last_updated_at) : '暂无记录'}（北京时间）`;
      if (manifest?.sync?.status !== 'ok') $('loadState').textContent = '最近一次数据检查部分失败，当前显示已保存的比赛快照。';
    } else {
      const messages = {no_games: '这一天确实没有已排定的 NBA 正式比赛。',
        source_failed: '比赛数据暂时获取失败。已有归档未被覆盖，请稍后重试。',
        not_archived: '所选历史日期尚未收录。', not_available: '所选日期尚无可用的比赛归档。'};
      $('loadState').textContent = messages[state];
      if (state === 'source_failed') $('loadState').classList.add('error');
      if (state === 'no_games') {
        $('dateSummary').textContent = '0 场比赛';
        $('lastUpdated').textContent = `数据最后更新：${index.last_updated_at ? beijingTime(index.last_updated_at) : '暂无记录'}（北京时间）`;
      }
    }
  } catch {
    if (token !== request) return;
    $('loadState').className = 'load-state error';
    $('loadState').textContent = '数据暂时获取失败，请检查网络后重试。';
  }
}

function setDate(date) {
  if (!validDate(date)) return;
  selected = date;
  history.pushState(null, '', `/daily-games?date=${date}`);
  loadDate();
}

$('todayButton').addEventListener('click', () => setDate(today));
$('yesterdayButton').addEventListener('click', () => setDate(relativeDate(today, -1)));
$('gameDate').addEventListener('change', event => setDate(event.target.value));
window.addEventListener('popstate', () => {const date = new URLSearchParams(location.search).get('date'); selected = validDate(date) ? date : today; loadDate();});
loadDate();

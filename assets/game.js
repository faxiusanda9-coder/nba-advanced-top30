import {beijingTime, typeName, statusName, shown, shownGmsc, sortPlayers, chartScale} from './daily-games-core.mjs';
import {createExplanationButton} from './metric-explanations.mjs';

const $ = id => document.getElementById(id);
const id = new URLSearchParams(location.search).get('id') || location.pathname.match(/^\/game\/(\d{10})\/?$/)?.[1];
const node = (tag, text, className) => {const result = document.createElement(tag); if (text !== undefined) result.textContent = text; if (className) result.className = className; return result;};
const field = (player, key) => shown(player.stats?.[key]);
const pair = (player, a, b) => `${field(player, a)}/${field(player, b)}`;
let snapshot, summary, playerLinks = new Map(), sortKey = 'gmsc', sortDirection = 'desc', chartAll = false;

function logo(team) {
  const wrap = node('span', team.tricode || '?', 'team-logo');
  if (/^\d{10}$/.test(team.team_id)) {
    const image = node('img'); image.alt = ''; image.loading = 'lazy';
    image.src = `/assets/team-logos/${team.team_id}.svg`;
    image.onerror = () => image.remove(); wrap.append(image);
  }
  return wrap;
}

function portrait(player, className = '') {
  const fallback = player.player_name?.split(/\s+/).map(part => part[0]).slice(0, 2).join('') || '?';
  const wrap = node('span', fallback, `player-portrait ${className}`);
  if (/^\d+$/.test(player.player_id)) {
    const image = node('img'); image.alt = ''; image.loading = 'lazy';
    image.src = `/assets/player-headshots/${player.player_id}.png`;
    image.onerror = () => image.remove(); wrap.append(image);
  }
  return wrap;
}

function teamNode(team) {
  const wrap = node('div', undefined, 'team');
  wrap.append(logo(team), node('div', team.name || team.tricode || '待定', 'team-name'));
  return wrap;
}

function renderHero() {
  $('gameTitle').textContent = `${summary.away.tricode || '客队'} vs ${summary.home.tricode || '主队'}`;
  $('gameMeta').textContent = `${typeName[summary.game_type] || 'NBA 比赛'} · 北京时间 ${beijingTime(summary.start_utc)} · NBA 官方比赛日期 ${summary.official_date}`;
  document.querySelector('.back-link').href = `/daily-games?date=${summary.beijing_date}`;
  const scoreboard = $('gameScoreboard');
  const info = node('div', undefined, 'game-meta-row');
  info.append(node('span', statusName[summary.status] || '状态待核实'), node('span', `NBA Game ID ${id}`));
  const matchup = node('div', undefined, 'matchup');
  const score = node('div', `${shown(summary.away.score)} : ${shown(summary.home.score)}`,
    `score ${summary.away.score === null || summary.home.score === null ? 'pending' : ''}`);
  matchup.append(teamNode(summary.away), score, teamNode(summary.home));
  scoreboard.replaceChildren(info, matchup);
  $('gameUpdated').textContent = `数据最后更新：${beijingTime(snapshot?.source?.fetched_at || summary.updated_at)}（北京时间）`;
}

const columns = [
  ['姓名', null, player => player.player_name], ['PTS', 'points', player => field(player, 'points')],
  ['REB', 'rebounds', player => field(player, 'rebounds')], ['AST', 'assists', player => field(player, 'assists')],
  ['+/-', 'plus_minus', player => player.stats.plus_minus === null ? '—' : `${player.stats.plus_minus > 0 ? '+' : ''}${player.stats.plus_minus}`],
  ['球队', null, player => player.team_tricode], ['MIN', 'minutes', player => shown(player.minutes)],
  ['STL', 'steals', player => field(player, 'steals')], ['BLK', 'blocks', player => field(player, 'blocks')],
  ['FGM/FGA', null, player => pair(player, 'field_goals_made', 'field_goals_attempted')],
  ['3PM/3PA', null, player => pair(player, 'three_pointers_made', 'three_pointers_attempted')],
  ['FTM/FTA', null, player => pair(player, 'free_throws_made', 'free_throws_attempted')],
  ['ORB', 'offensive_rebounds', player => field(player, 'offensive_rebounds')],
  ['DRB', 'defensive_rebounds', player => field(player, 'defensive_rebounds')],
  ['TOV', 'turnovers', player => field(player, 'turnovers')],
  ['PF', 'personal_fouls', player => field(player, 'personal_fouls')],
  ['GmSc', 'gmsc', player => shownGmsc(player.gmsc.value)]
];

function allPlayers() {
  return ['away', 'home'].flatMap(side => snapshot.teams[side].players.map(player => ({
    ...player, team_tricode: snapshot.teams[side].tricode, side
  })));
}

function renderTable() {
  const table = $('playerTable');
  const header = node('tr');
  for (const [label, key] of columns) {
    const th = node('th');
    if (key) {
      const button = node('button', `${label}${sortKey === key ? sortDirection === 'desc' ? ' ↓' : ' ↑' : ''}`);
      button.type = 'button'; button.addEventListener('click', () => {
        sortDirection = sortKey === key && sortDirection === 'desc' ? 'asc' : 'desc'; sortKey = key; renderTable();
      });
      th.setAttribute('aria-sort', sortKey === key ? sortDirection === 'desc' ? 'descending' : 'ascending' : 'none');
      th.append(button);
    } else th.textContent = label;
    header.append(th);
  }
  table.tHead.replaceChildren(header);
  const played = sortPlayers(allPlayers().filter(player => player.played), sortKey, sortDirection);
  const body = played.map(player => {
    const tr = node('tr');
    columns.forEach(([label, , get], index) => {
      const td = node('td', undefined, index === 0 ? 'player-name' : label === 'GmSc' ? 'gmsc' : '');
      if (index === 0) {
        const slug = playerLinks.get(player.player_id);
        const label = node('span', undefined, 'table-player-label'); label.append(portrait(player));
        if (slug) {const link = node('a', player.player_name); link.href = `/player/${encodeURIComponent(slug)}`; label.append(link);}
        else {label.append(node('span', player.player_name)); td.title = `NBA ID ${player.source_player_id}`;}
        td.append(label);
      } else {
        td.textContent = get(player);
        if (label === 'GmSc' && player.gmsc.value === null) td.classList.add('missing');
      }
      tr.append(td);
    });
    return tr;
  });
  table.tBodies[0].replaceChildren(...body);
  const dnp = allPlayers().filter(player => !player.played);
  $('dnpDetails').hidden = dnp.length === 0;
  $('dnpDetails').querySelector('summary').textContent = `未出场球员（${dnp.length}） · GmSc 不计算`;
  const list = node('div', undefined, 'dnp-list');
  list.append(...dnp.map(player => {
    const item=node('span',undefined,'dnp-player'); item.append(portrait(player),node('span',`${player.team_tricode} · ${player.player_name} · NBA ID ${player.source_player_id}`)); return item;
  }));
  $('dnpList').replaceChildren(list);
}

function renderChart() {
  const players = sortPlayers(allPlayers().filter(player => player.played && Number.isFinite(player.gmsc?.value)), 'gmsc');
  const target = $('gmscChart');
  if (!players.length) {target.replaceChildren(node('p', '暂无可计算的单场 GmSc。', 'chart-empty')); return;}
  const scale = chartScale(players);
  const rows = (chartAll ? players : players.slice(0, 10)).map(player => {
    const row = node('div', undefined, 'chart-row');
    const name = node('div', undefined, 'chart-player');
    const label = node('span', player.player_name, 'chart-player-name'); label.title = player.player_name;
    name.append(portrait(player, 'chart-portrait'), label, node('small', player.team_tricode));
    const track = node('div', undefined, 'bar-track');
    const axis = node('span', undefined, 'zero-axis'); axis.style.left = `${scale.zero}%`;
    track.append(axis);
    if (player.gmsc.value === 0) {
      const dot = node('span', undefined, 'zero-dot'); dot.style.left = `${scale.zero}%`; track.append(dot);
    } else {
      const segment = scale.segment(player.gmsc.value);
      const bar = node('span', undefined, `bar ${player.side}`);
      bar.style.left = `${segment.left}%`; bar.style.width = `${segment.width}%`; track.append(bar);
    }
    const score = node('span', shownGmsc(player.gmsc.value), `chart-value ${player.gmsc.value < 0 ? 'negative' : ''}`);
    const summary = node('div', undefined, 'chart-stats');
    const basic = [['PTS', player.stats.points], ['REB', player.stats.rebounds], ['AST', player.stats.assists],
      ['+/−', player.stats.plus_minus === null ? null : `${player.stats.plus_minus > 0 ? '+' : ''}${player.stats.plus_minus}`]];
    for (const [label, value] of basic) summary.append(node('span', `${label} ${shown(value)}`));
    row.append(name, track, score, summary); return row;
  });
  target.replaceChildren(...rows);
  $('showAllChart').hidden = players.length <= 10;
  $('showAllChart').textContent = chartAll ? '仅显示前 10 名' : `查看全部 ${players.length} 名出场球员`;
}

async function getJson(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(12000)});
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Game archive HTTP ${response.status}`);
  return response.json();
}

async function load() {
  if (!/^\d{10}$/.test(id || '')) {$('gameState').textContent = '比赛 ID 无效。'; return;}
  try {
    const [manifest, index] = await Promise.all([getJson('/data/games/manifest.json'), getJson('/data/player-index.json')]);
    if (!manifest) throw new Error('Game manifest unavailable');
    summary = manifest?.games?.[id];
    if (!summary) {$('gameState').textContent = '这场比赛尚未收录。'; return;}
    if (Array.isArray(index?.players)) playerLinks = new Map(index.players.map(player => [String(player.player_id), player.slug]));
    snapshot = await getJson(`/data/games/boxscores/${id}.json`);
    if (snapshot && (snapshot.game_id !== id || snapshot.teams.home.team_id !== summary.home.team_id || snapshot.teams.away.team_id !== summary.away.team_id))
      throw new Error('Game identity mismatch');
    $('gameContent').hidden = false;
    renderHero();
    if (!snapshot) {
      $('gameState').textContent = summary.status === 'final' ? '这场比赛已结束，完整技术统计尚未归档；请稍后再看。'
        : '比赛尚未结束。赛后完整技术统计和 GmSc 将在归档后显示。';
      $('gameContent').children[1].hidden = true; $('gameContent').children[2].hidden = true;
      return;
    }
    $('gameState').textContent = snapshot.completeness.status === 'complete' ? '' : '官方技术统计尚不完整；缺失的 GmSc 显示为“暂无数据”。';
    const info = createExplanationButton('GMSC', 'GmSc'); if (info) $('gmscInfo').append(info);
    const legend = $('chartLegend');
    for (const side of ['away', 'home']) {
      const item = node('span'); item.append(node('span', undefined, `legend-swatch ${side}`),
        node('span', snapshot.teams[side].tricode)); legend.append(item);
    }
    renderChart(); renderTable();
  } catch {
    $('gameState').classList.add('error'); $('gameState').textContent = '比赛数据暂时获取失败，请稍后重试。';
  }
}

$('showAllChart').addEventListener('click', () => {chartAll = !chartAll; renderChart();});
load();

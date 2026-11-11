import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {gameScore} from './lib/daily-games.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const date = process.argv.find(arg => arg.startsWith('--date='))?.slice(7) || '2026-11-11';
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Expected --date=YYYY-MM-DD');
const local = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const index = await local(`data/games/dates/${date}.json`);
if (index.game_count < 3 || index.final_count < 3) throw new Error('Need at least three final games');
const games = index.games.filter(game => game.status === 'final').slice(0, 3);
const headers = {'User-Agent':'Mozilla/5.0', 'Referer':'https://www.nba.com/'};
const fetchJson = async (url, options = {}) => {
  const response = await fetch(url, {signal: AbortSignal.timeout(12000), ...options});
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
};
const espnCache = new Map();
const rawStats = athlete => {
  const row = athlete.stats || [];
  const pair = index => row[index]?.split('-').map(Number) || [NaN, NaN];
  const [fgm, fga] = pair(2), [ftm, fta] = pair(4);
  return {points:Number(row[1]), field_goals_made:fgm, field_goals_attempted:fga,
    free_throws_made:ftm, free_throws_attempted:fta, offensive_rebounds:Number(row[10]),
    defensive_rebounds:Number(row[11]), steals:Number(row[8]), assists:Number(row[6]),
    blocks:Number(row[9]), personal_fouls:Number(row[12]), turnovers:Number(row[7])};
};
const manualScore = s => s.points + .4*s.field_goals_made - .7*s.field_goals_attempted
  - .4*(s.free_throws_attempted-s.free_throws_made) + .7*s.offensive_rebounds
  + .3*s.defensive_rebounds + s.steals + .7*s.assists + .7*s.blocks
  - .4*s.personal_fouls - s.turnovers;
const checks = [];
for (const game of games) {
  const saved = await local(`data/games/boxscores/${game.game_id}.json`);
  const nbaUrl = `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${game.game_id}.json`;
  const live = (await fetchJson(nbaUrl, {headers})).game;
  if (live.gameId !== game.game_id || live.homeTeam.teamId !== Number(game.home.team_id)
      || live.awayTeam.teamId !== Number(game.away.team_id)) throw new Error(`${game.game_id}: NBA identity mismatch`);
  const official = game.official_date.replaceAll('-', '');
  if (!espnCache.has(official)) espnCache.set(official,
    (await fetchJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${official}&limit=1000`)).events);
  const event = espnCache.get(official).find(item => {
    const competitors = item.competitions?.[0]?.competitors || [];
    return competitors.find(team => team.homeAway === 'home')?.team.name === game.home.name
      && competitors.find(team => team.homeAway === 'away')?.team.name === game.away.name
      && Math.abs(new Date(item.date).getTime() - new Date(game.start_utc).getTime()) <= 600000;
  });
  if (!event) throw new Error(`${game.game_id}: no exact ESPN team/time match`);
  const espnUrl = `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${event.id}`;
  const espn = await fetchJson(espnUrl);
  const eScore = side => Number(event.competitions[0].competitors.find(team => team.homeAway === side).score);
  const scoresAgree = saved.teams.home.score === live.homeTeam.score && saved.teams.away.score === live.awayTeam.score
    && saved.teams.home.score === eScore('home') && saved.teams.away.score === eScore('away');
  const selected = ['away','home'].map(side => saved.teams[side].players.find(player => player.played));
  const athletes = espn.boxscore.players.flatMap(team => team.statistics.flatMap(stat => stat.athletes));
  const playerChecks = selected.map(player => {
    const officialPlayer = [...live.homeTeam.players, ...live.awayTeam.players].find(item => String(item.personId) === player.player_id);
    const athlete = athletes.find(item => item.athlete.displayName === player.player_name);
    if (!officialPlayer || !athlete) throw new Error(`${game.game_id}: missing independent player match ${player.player_name}`);
    const espnStats = rawStats(athlete), espnScore = manualScore(espnStats);
    const statsAgree = Object.entries(espnStats).every(([key, value]) => player.stats[key] === value);
    const nbaScore = gameScore(player.stats);
    return {name:player.player_name, nba_player_id:player.player_id, saved_gmsc:player.gmsc.value,
      independent_espn_gmsc:Number(espnScore.toFixed(1)), nba_score_recalculated:nbaScore,
      source_stats_agree:statsAgree, gmsc_agrees:Math.abs(espnScore-player.gmsc.value)<1e-8 && nbaScore===player.gmsc.value,
      differences:statsAgree ? [] : Object.entries(espnStats).filter(([key, value]) => player.stats[key] !== value)
        .map(([key,value]) => ({field:key,nba:player.stats[key],espn:value}))};
  });
  checks.push({game_id:game.game_id, nba_url:nbaUrl, espn_url:espnUrl, start_utc:game.start_utc,
    official_date:game.official_date, beijing_date:game.beijing_date,
    final_score:`${game.away.tricode} ${game.away.score} - ${game.home.tricode} ${game.home.score}`,
    scores_agree:scoresAgree, saved_player_count:saved.teams.home.players.length+saved.teams.away.players.length,
    official_player_count:live.homeTeam.players.length+live.awayTeam.players.length, players:playerChecks});
}
const report = {checked_at:new Date().toISOString(), date, date_game_count:index.game_count,
  date_final_count:index.final_count, date_complete:index.complete, games:checks};
const file = path.join(root, 'docs', 'daily-games-live-check.json');
await writeFile(file, `${JSON.stringify(report,null,2)}\n`);
console.log(JSON.stringify({file, date, games:checks.length, players:checks.flatMap(game=>game.players).length,
  scores_agree:checks.every(game=>game.scores_agree), stats_and_gmsc_agree:checks.every(game=>game.players.every(player=>player.source_stats_agree&&player.gmsc_agrees))}));
if (checks.some(game => !game.scores_agree || game.saved_player_count !== game.official_player_count
  || game.players.some(player=>!player.source_stats_agree||!player.gmsc_agrees))) process.exitCode=1;

import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {dateInZone, gameScore, scheduleGames, seasonArchiveDates} from './lib/daily-games.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async relative => JSON.parse(await readFile(path.join(root, relative), 'utf8'));
const response = await fetch('https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json', {
  signal: AbortSignal.timeout(15000),
  headers: {'User-Agent': 'Mozilla/5.0', Referer: 'https://www.nba.com/'}
});
if (!response.ok) throw new Error(`NBA schedule HTTP ${response.status}`);
const schedule = scheduleGames(await response.json());
const today = dateInZone(new Date());
const dates = seasonArchiveDates(schedule, today).filter(date => date <= today);
const manifest = await read('data/games/manifest.json');
const checked = new Set();
let playedPlayers = 0, zeroDates = 0, games = 0;
for (const date of dates) {
  if (!manifest.dates.includes(date)) throw new Error(`${date}: missing from manifest`);
  const index = await read(`data/games/dates/${date}.json`);
  const expected = [...schedule.values()].filter(game => game.beijing_date === date);
  const expectedIds = expected.map(game => game.game_id).sort();
  const actualIds = index.games.map(game => game.game_id).sort();
  if (JSON.stringify(expectedIds) !== JSON.stringify(actualIds))
    throw new Error(`${date}: missing or extra game IDs`);
  if (!expected.length) {
    zeroDates++;
    if (index.state !== 'no_games') throw new Error(`${date}: rest day not labeled no_games`);
  }
  for (const game of index.games) {
    if (checked.has(game.game_id)) throw new Error(`${game.game_id}: duplicate game`);
    checked.add(game.game_id);
    if (game.status !== 'final') {
      if (game.status === 'scheduled' || game.status === 'live') continue;
      throw new Error(`${game.game_id}: unresolved ${game.status}`);
    }
    const box = await read(`data/games/boxscores/${game.game_id}.json`);
    if (box.game_id !== game.game_id || box.beijing_date !== date ||
        box.completeness.status !== 'complete') throw new Error(`${game.game_id}: incomplete or wrong date`);
    for (const side of ['home', 'away']) {
      if (box.teams[side].team_id !== game[side].team_id ||
          box.teams[side].score !== game[side].score) throw new Error(`${game.game_id}: ${side} identity or score mismatch`);
      for (const player of box.teams[side].players) {
        if (!player.played) {
          if (player.gmsc.value !== null) throw new Error(`${game.game_id}/${player.player_id}: DNP has GmSc`);
          continue;
        }
        playedPlayers++;
        if (player.gmsc.value !== gameScore(player.stats))
          throw new Error(`${game.game_id}/${player.player_id}: GmSc mismatch`);
      }
    }
    games++;
  }
  if (index.games.length && index.games.every(game => game.status === 'final') && !index.complete)
    throw new Error(`${date}: final date incorrectly marked incomplete`);
}
console.log(JSON.stringify({source: response.url, first: dates[0], last: dates.at(-1),
  dates: dates.length, no_game_dates: zeroDates, games, played_players: playedPlayers,
  result: 'official schedule IDs, dates, teams, scores and all archived GmSc matched'}, null, 2));

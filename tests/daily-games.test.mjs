import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dateInZone, gameScore, gameStatus, gameSummary, scheduleGames, boxscoreSnapshot,
  playerRecord, dateIndex} from '../scripts/lib/daily-games.mjs';
import {beijingToday, sortPlayers, chartScale, dateViewState, shownGmsc} from '../assets/daily-games-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const homeId = '1610612744', awayId = '1610612743', gameId = '0022600211';
const start = '2026-11-11T00:30:00Z';
const team = (id, code, score = 0) => ({teamId: Number(id), teamName: code, teamCity: 'Test', teamTricode: code, score});
const sampleGame = (status = 3, utc = start, text = status === 3 ? 'Final' : '7:30 pm ET') => ({
  gameId, gameDateTimeUTC: utc, gameStatus: status, gameStatusText: text,
  postponedStatus: 'N', homeTeam: team(homeId, 'GSW', status === 3 ? 108 : 0),
  awayTeam: team(awayId, 'DEN', status === 3 ? 101 : 0)
});
const sourceStats = overrides => ({points: 25, fieldGoalsMade: 9, fieldGoalsAttempted: 18,
  freeThrowsMade: 4, freeThrowsAttempted: 5, reboundsOffensive: 2, reboundsDefensive: 7,
  reboundsTotal: 9, steals: 1, assists: 8, blocks: 1, foulsPersonal: 3,
  turnovers: 3, threePointersMade: 3, threePointersAttempted: 8,
  plusMinusPoints: 10, minutes: 'PT34M22.00S', ...overrides});
const player = (id, overrides = {}, played = '1') => ({personId: id, name: `Player ${id}`,
  played, statistics: sourceStats(overrides)});
const box = (utc = start, correction = 0) => ({game: {
  ...sampleGame(3, utc), gameTimeUTC: utc,
  homeTeam: {...team(homeId, 'GSW', 108 + correction), players: Array.from({length: 6}, (_, i) => player(100 + i, i === 0 ? {points: 25 + correction} : {}))},
  awayTeam: {...team(awayId, 'DEN', 101), players: [...Array.from({length: 5}, (_, i) => player(200 + i)), player(299, {}, '0')]}
}});

test('Game Score uses original single-game fields, preserves negative and true zero, and does not fill missing inputs', () => {
  const stats = playerRecord(player(100), homeId).stats;
  assert.equal(gameScore(stats), 22.2);
  const zero = playerRecord(player(101, Object.fromEntries(Object.keys(sourceStats()).map(key => [key, key === 'minutes' ? 'PT01M00S' : 0]))), homeId);
  assert.equal(zero.gmsc.value, 0); assert.equal(zero.gmsc.status, 'calculated'); assert.equal(shownGmsc(0), '0.0');
  const negative = playerRecord(player(102, {points: 0, fieldGoalsMade: 0, fieldGoalsAttempted: 3,
    freeThrowsMade: 0, freeThrowsAttempted: 0, reboundsOffensive: 0, reboundsDefensive: 0,
    steals: 0, assists: 0, blocks: 0, foulsPersonal: 2, turnovers: 1}), homeId);
  assert.equal(negative.gmsc.value, -3.9);
  const absent = playerRecord(player(103, {turnovers: undefined}), homeId);
  assert.equal(absent.gmsc.value, null); assert.equal(absent.gmsc.status, 'missing_inputs');
  const dnp = playerRecord(player(104, {}, '0'), homeId);
  assert.equal(dnp.played, false); assert.equal(dnp.gmsc.value, null); assert.equal(dnp.gmsc.status, 'dnp');
});

test('Beijing dates use UTC instants, including midnight and US daylight saving transitions', () => {
  assert.equal(dateInZone('2026-11-10T01:00:00Z'), '2026-11-10');
  assert.equal(dateInZone('2026-11-10T23:30:00Z'), '2026-11-11');
  assert.equal(beijingToday(new Date('2026-11-10T23:30:00Z')), '2026-11-11');
  assert.equal(dateInZone('2026-03-08T06:30:00Z', 'America/New_York'), '2026-03-08');
  assert.equal(dateInZone('2026-03-08T07:30:00Z', 'Asia/Shanghai'), '2026-03-08');
  assert.equal(dateInZone('2026-11-01T05:30:00Z', 'Asia/Shanghai'), '2026-11-01');
  assert.equal(gameSummary(sampleGame(), '2026-11-10').beijing_date, '2026-11-11');
  assert.equal(gameSummary(sampleGame(), '2026-11-10').official_date, '2026-11-10');
});

test('status and game types separate future, live, final, postponed, canceled, and excluded preseason', () => {
  assert.equal(gameStatus(sampleGame(1)), 'scheduled');
  assert.equal(gameStatus(sampleGame(2)), 'live');
  assert.equal(gameStatus(sampleGame(3)), 'final');
  assert.equal(gameStatus(sampleGame(1, start, 'Postponed')), 'postponed');
  assert.equal(gameStatus(sampleGame(1, start, 'Canceled')), 'canceled');
  const dates = {leagueSchedule: {gameDates: [{gameDate: '11/10/2026 00:00:00',
    games: [sampleGame(), {...sampleGame(), gameId: '0012600001'},
      {...sampleGame(), gameId: '0042600001'}, {...sampleGame(), gameId: '0052600001'}]}]}};
  const parsed = scheduleGames(dates);
  assert.equal(parsed.size, 3);
  assert.equal(parsed.get('0042600001').game_type, 'playoffs');
  assert.equal(parsed.get('0052600001').game_type, 'play_in');
});

test('box score keeps every played player, DNP, NBA IDs and final scores; partial source cannot be complete', () => {
  const summary = gameSummary(sampleGame(), '2026-11-10');
  const snapshot = boxscoreSnapshot(box(), summary, '2026-11-11T12:00:00Z');
  assert.equal(snapshot.completeness.status, 'complete');
  assert.equal(snapshot.teams.home.players.length, 6);
  assert.equal(snapshot.teams.away.players.length, 6);
  assert.equal(snapshot.teams.away.players.at(-1).gmsc.status, 'dnp');
  assert.equal(snapshot.teams.home.players[0].player_id, '100');
  assert.equal(snapshot.teams.home.score, 108);
  const incomplete = box(); delete incomplete.game.homeTeam.players[0].statistics.turnovers;
  const partial = boxscoreSnapshot(incomplete, summary, '2026-11-11T12:00:00Z');
  assert.equal(partial.completeness.status, 'partial');
  assert.equal(partial.teams.home.players[0].gmsc.value, null);
  assert.throws(() => boxscoreSnapshot({...box(), game: {...box().game, gameId: '0022609999'}}, summary, '2026-11-11T12:00:00Z'));
});

test('date and chart states keep zero, negative values, no games, failure and unarchived history distinct', () => {
  const game = gameSummary(sampleGame(), '2026-11-10'); game.boxscore_state = 'complete';
  assert.equal(dateIndex('2026-11-11', [game], '2026-11-11T12:00:00Z').state, 'complete');
  assert.equal(dateIndex('2026-11-10', [], '2026-11-11T12:00:00Z').state, 'no_games');
  assert.equal(dateViewState(200, {state:'no_games'}, null, '2026-11-10', '2026-11-11'), 'no_games');
  assert.equal(dateViewState(404, null, {sync:{status:'failed'}}, '2026-11-11', '2026-11-11'), 'source_failed');
  assert.equal(dateViewState(404, null, {sync:{status:'ok'}}, '2026-11-09', '2026-11-11'), 'not_archived');
  const rows = [{player_name:'zero',gmsc:{value:0}}, {player_name:'neg',gmsc:{value:-2.4}},
    {player_name:'missing',gmsc:{value:null}}, {player_name:'pos',gmsc:{value:8.2}}];
  assert.deepEqual(sortPlayers(rows).map(row => row.player_name), ['pos','zero','neg','missing']);
  const scale = chartScale(rows);
  assert(scale.zero > 0 && scale.zero < 100);
  assert(scale.segment(-2.4).left < scale.zero);
  assert.equal(scale.segment(0).width, 0);
});

test('archiver is repeatable, moves rescheduled games, preserves a valid snapshot on failure and absorbs corrections', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nba-games-test-'));
  let utc = start, status = 1, correction = 0, failBox = false;
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/schedule') response.end(JSON.stringify({leagueSchedule:{gameDates:[{
      gameDate: utc.slice(0,10) === '2026-11-12' ? '11/11/2026 00:00:00' : '11/10/2026 00:00:00',
      games:[sampleGame(status, utc)]}]}}));
    else if (request.url === '/scoreboard') response.end(JSON.stringify({scoreboard:{games:[]}}));
    else if (request.url === `/boxscore_${gameId}.json`) {
      if (failBox) {response.statusCode = 500; response.end('{}');}
      else response.end(JSON.stringify(box(utc, correction)));
    } else {response.statusCode = 404; response.end('{}');}
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const run = args => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/update-daily-games.mjs', '--now=2026-11-11T12:00:00Z', ...args], {
      cwd: root, env: {...process.env, NBA_GAMES_DATA_DIR: directory, NBA_SCHEDULE_URLS:`${base}/schedule`,
        NBA_SCOREBOARD_URL:`${base}/scoreboard`, NBA_BOXSCORE_BASE_URL:`${base}/boxscore_`}});
    let output = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => output += data);
    child.on('error', reject); child.on('close', code => resolve({code, output}));
  });
  const read = async file => JSON.parse(await readFile(path.join(directory, file), 'utf8'));
  try {
    let result = await run(['--date=2026-11-11']); assert.equal(result.code, 0, result.output);
    assert.equal((await read('dates/2026-11-11.json')).state, 'incomplete');
    utc = '2026-11-12T00:30:00Z';
    result = await run(['--date=2026-11-12']); assert.equal(result.code, 0, result.output);
    assert.equal((await read('dates/2026-11-11.json')).state, 'no_games');
    assert.equal((await read('dates/2026-11-12.json')).game_count, 1);
    status = 3;
    result = await run(['--date=2026-11-12']); assert.equal(result.code, 0, result.output);
    assert.equal((await read('dates/2026-11-12.json')).state, 'complete');
    const first = await read(`boxscores/${gameId}.json`);
    result = await run(['--date=2026-11-12']); assert.equal(result.code, 0, result.output);
    assert.match(result.output, /"boxscores_changed":0/);
    assert.match(result.output, /"manifest_changed":false/);
    failBox = true;
    result = await run(['--date=2026-11-12']); assert.equal(result.code, 1);
    assert.equal((await read(`boxscores/${gameId}.json`)).teams.home.score, first.teams.home.score);
    assert.equal((await read('dates/2026-11-12.json')).state, 'complete');
    failBox = false; correction = 1;
    result = await run(['--date=2026-11-12']); assert.equal(result.code, 0, result.output);
    assert.equal((await read(`boxscores/${gameId}.json`)).teams.home.score, 109);
    assert.equal((await read(`boxscores/${gameId}.json`)).teams.home.players[0].gmsc.value, 23.2);
  } finally {server.close(); await rm(directory, {recursive:true, force:true});}
});

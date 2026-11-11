export const SCHEMA_VERSION = 1;
export const GMSC_FORMULA_VERSION = 'hollinger-game-score-v1';
export const TIME_ZONE = 'Asia/Shanghai';

const requiredStats = ['points', 'field_goals_made', 'field_goals_attempted', 'free_throws_made',
  'free_throws_attempted', 'offensive_rebounds', 'defensive_rebounds', 'steals', 'assists',
  'blocks', 'personal_fouls', 'turnovers'];

export function dateInZone(value, zone = TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid UTC instant: ${value}`);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function shiftDate(iso, days) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`Invalid date: ${iso}`);
  const date = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) throw new Error(`Invalid date: ${iso}`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function officialDate(raw) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(raw || '');
  if (!match) throw new Error(`Invalid official date: ${raw}`);
  return `${match[3]}-${match[1]}-${match[2]}`;
}

export function gameType(game) {
  const prefix = String(game.gameId || '').slice(0, 3);
  if (prefix === '002') return 'regular';
  if (prefix === '004') return 'playoffs';
  if (prefix === '005') return 'play_in';
  return null;
}

export function gameStatus(game) {
  const text = String(game.gameStatusText || '').toLowerCase();
  const postponed = String(game.postponedStatus || '').toUpperCase();
  if (/cancel/.test(text) || postponed === 'C') return 'canceled';
  if (Number(game.gameStatus) === 3) return 'final';
  if (/postpon|delay|suspend/.test(text) || (postponed && postponed !== 'N' && postponed !== 'C')) return 'postponed';
  if (Number(game.gameStatus) === 2) return 'live';
  return 'scheduled';
}

const number = value => value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
  ? null : Number(value);

export function gameSummary(game, nbaDate, previous = null) {
  const id = String(game.gameId || '');
  const type = gameType(game);
  if (!/^\d{10}$/.test(id) || !type) return null;
  const start = game.gameDateTimeUTC || game.gameTimeUTC;
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(start || '')) throw new Error(`${id}: missing UTC start`);
  const startUtc = new Date(start).toISOString();
  const status = gameStatus(game);
  const team = t => ({team_id: String(t?.teamId ?? ''), name: String(t?.teamName || ''),
    city: String(t?.teamCity || ''), tricode: String(t?.teamTricode || ''),
    score: status === 'scheduled' || status === 'postponed' || status === 'canceled' ? null : number(t?.score)});
  const result = {game_id: id, official_date: nbaDate, beijing_date: dateInZone(startUtc),
    start_utc: startUtc, game_type: type, status, status_text: String(game.gameStatusText || ''),
    home: team(game.homeTeam), away: team(game.awayTeam),
    boxscore_state: previous?.boxscore_state || 'not_due', boxscore_fetched_at: previous?.boxscore_fetched_at || null,
    updated_at: previous?.updated_at || null};
  const validTeam = teamId => /^\d{10}$/.test(teamId) || (status !== 'final' && teamId === '0');
  if (!validTeam(result.home.team_id) || !validTeam(result.away.team_id)) throw new Error(`${id}: invalid team IDs`);
  return result;
}

export function scheduleGames(document) {
  const dates = document?.leagueSchedule?.gameDates;
  if (!Array.isArray(dates) || dates.length < 1) throw new Error('NBA schedule schema changed: gameDates missing');
  const games = new Map();
  for (const bucket of dates) {
    const nbaDate = officialDate(bucket.gameDate);
    if (!Array.isArray(bucket.games)) throw new Error(`${nbaDate}: games missing`);
    for (const game of bucket.games) {
      const summary = gameSummary(game, nbaDate);
      if (!summary) continue;
      if (games.has(summary.game_id)) throw new Error(`Duplicate game ID: ${summary.game_id}`);
      games.set(summary.game_id, summary);
    }
  }
  return games;
}

export function applyScoreboard(games, document) {
  const rows = document?.scoreboard?.games;
  if (!Array.isArray(rows)) throw new Error('NBA scoreboard schema changed: games missing');
  for (const game of rows) {
    const previous = games.get(String(game.gameId));
    if (!previous) continue;
    const updated = gameSummary({...game, gameDateTimeUTC: game.gameTimeUTC}, previous.official_date, previous);
    if (updated) games.set(updated.game_id, updated);
  }
  return games;
}

export function gameScore(stats) {
  if (!stats || requiredStats.some(key => !Number.isFinite(stats[key]))) return null;
  return (10 * stats.points + 4 * stats.field_goals_made - 7 * stats.field_goals_attempted
    - 4 * (stats.free_throws_attempted - stats.free_throws_made)
    + 7 * stats.offensive_rebounds + 3 * stats.defensive_rebounds + 10 * stats.steals
    + 7 * stats.assists + 7 * stats.blocks - 4 * stats.personal_fouls - 10 * stats.turnovers) / 10;
}

function minutes(value) {
  if (typeof value !== 'string') return null;
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)(?:\.\d+)?S)?$/.exec(value);
  if (!match) return null;
  return `${Number(match[1] || 0) * 60 + Number(match[2] || 0)}:${String(Number(match[3] || 0)).padStart(2, '0')}`;
}

export function playerRecord(player, teamId) {
  const source = player?.statistics || {};
  const stats = {
    points: number(source.points), rebounds: number(source.reboundsTotal), assists: number(source.assists),
    steals: number(source.steals), blocks: number(source.blocks),
    field_goals_made: number(source.fieldGoalsMade), field_goals_attempted: number(source.fieldGoalsAttempted),
    three_pointers_made: number(source.threePointersMade), three_pointers_attempted: number(source.threePointersAttempted),
    free_throws_made: number(source.freeThrowsMade), free_throws_attempted: number(source.freeThrowsAttempted),
    offensive_rebounds: number(source.reboundsOffensive), defensive_rebounds: number(source.reboundsDefensive),
    turnovers: number(source.turnovers), personal_fouls: number(source.foulsPersonal),
    plus_minus: number(source.plusMinusPoints)
  };
  const played = player?.played === '1' || player?.played === 1 || player?.played === true;
  const score = played ? gameScore(stats) : null;
  return {player_id: String(player?.personId || ''), source_player_id: String(player?.personId || ''),
    player_name: String(player?.name || '').trim(), team_id: teamId, played,
    participation: played ? 'played' : 'dnp', minutes: played ? minutes(source.minutes) : null,
    stats, gmsc: {value: score, status: played ? score === null ? 'missing_inputs' : 'calculated' : 'dnp',
      formula_version: GMSC_FORMULA_VERSION}};
}

export function boxscoreSnapshot(document, summary, fetchedAt) {
  const game = document?.game;
  if (String(game?.gameId) !== summary.game_id) throw new Error(`${summary.game_id}: box score game ID mismatch`);
  const issues = [];
  const teams = {};
  const seen = new Set();
  for (const side of ['home', 'away']) {
    const team = game[`${side}Team`];
    const id = String(team?.teamId || '');
    if (id !== summary[side].team_id) throw new Error(`${summary.game_id}: ${side} team ID mismatch`);
    if (!Array.isArray(team.players)) throw new Error(`${summary.game_id}: ${side} players missing`);
    const players = team.players.map(player => playerRecord(player, id));
    for (const player of players) {
      if (!/^\d+$/.test(player.player_id) || !player.player_name || seen.has(player.player_id))
        throw new Error(`${summary.game_id}: missing or duplicate player ID`);
      seen.add(player.player_id);
      if (player.played && (player.gmsc.status !== 'calculated' || player.minutes === null ||
          Object.values(player.stats).some(value => value === null))) issues.push(`${player.player_id}: missing stats`);
    }
    if (players.filter(player => player.played).length < 5) issues.push(`${side}: fewer than five played players`);
    const score = number(team.score);
    if (score === null) issues.push(`${side}: score missing`);
    teams[side] = {team_id: id, name: String(team.teamName || summary[side].name),
      city: String(team.teamCity || summary[side].city), tricode: String(team.teamTricode || summary[side].tricode),
      score, players};
  }
  if (gameStatus(game) !== 'final') issues.push('game not final');
  return {schema_version: SCHEMA_VERSION, game_id: summary.game_id, official_date: summary.official_date,
    beijing_date: summary.beijing_date, start_utc: summary.start_utc, game_type: summary.game_type,
    status: gameStatus(game), teams, gmsc_formula_version: GMSC_FORMULA_VERSION,
    source: {provider: 'NBA CDN LiveData', url: `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${summary.game_id}.json`, fetched_at: fetchedAt},
    completeness: {status: issues.length ? 'partial' : 'complete', issues}};
}

export function dateIndex(date, games, createdAt, previous = null) {
  const rows = [...games].sort((a, b) => a.start_utc.localeCompare(b.start_utc) || a.game_id.localeCompare(b.game_id));
  const finalCount = rows.filter(game => game.status === 'final').length;
  const complete = rows.length > 0 && rows.every(game => game.status === 'final' && game.boxscore_state === 'complete');
  const comparable = {schema_version: SCHEMA_VERSION, date, timezone: TIME_ZONE,
    game_count: rows.length, final_count: finalCount, complete,
    state: rows.length ? complete ? 'complete' : 'incomplete' : 'no_games', games: rows};
  const same = previous && JSON.stringify({...previous, last_updated_at: null})
    === JSON.stringify({...comparable, last_updated_at: null});
  return {...comparable, last_updated_at: same ? previous.last_updated_at : createdAt};
}

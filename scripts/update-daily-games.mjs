import {readFile, writeFile, mkdir} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {SCHEMA_VERSION, TIME_ZONE, dateInZone, shiftDate, scheduleGames, seasonArchiveDates, applyScoreboard,
  boxscoreSnapshot, dateIndex} from './lib/daily-games.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataRoot = process.env.NBA_GAMES_DATA_DIR || path.join(root, 'data', 'games');
const scheduleUrls = (process.env.NBA_SCHEDULE_URLS || [
  'https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json',
  'https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_1.json'
].join(',')).split(',').filter(Boolean);
const scoreboardUrl = process.env.NBA_SCOREBOARD_URL || 'https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json';
const boxscoreBase = process.env.NBA_BOXSCORE_BASE_URL || 'https://cdn.nba.com/static/json/liveData/boxscore/boxscore_';
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
  if (!match) throw new Error(`Unknown argument: ${arg}`);
  return [match[1], match[2] ?? true];
}));
for (const key of Object.keys(args)) if (!['date', 'game-id', 'now', 'dry-run'].includes(key)) throw new Error(`Unknown option: --${key}`);
const now = args.now ? new Date(args.now) : new Date();
if (Number.isNaN(now.getTime())) throw new Error('Invalid --now instant');
const nowIso = now.toISOString();
const today = dateInZone(now);
if (args.date) shiftDate(args.date, 0);
if (args['game-id'] && !/^\d{10}$/.test(args['game-id'])) throw new Error('Invalid --game-id');
const targetDates = args.date ? new Set([args.date]) : new Set();
const dryRun = Boolean(args['dry-run']);

async function load(file, fallback) {
  try { return JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}

async function save(file, value) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  let old = null;
  try { old = await readFile(file, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (old === content) return false;
  if (!dryRun) {
    await mkdir(path.dirname(file), {recursive: true});
    await writeFile(file, content);
  }
  return true;
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function fetchJson(url) {
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {signal: AbortSignal.timeout(12000), headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NBAAdvancedDailyGames/1.0)',
        'Referer': 'https://www.nba.com/', 'Accept': 'application/json'
      }});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = await response.json();
      if (!json || typeof json !== 'object') throw new Error('Invalid JSON document');
      return json;
    } catch (error) {
      last = error;
      if (attempt < 3) await sleep(350 * attempt);
    }
  }
  throw new Error(`${url}: ${last?.message || 'fetch failed'}`);
}

async function mapLimit(values, limit, task) {
  const result = new Array(values.length);
  let cursor = 0;
  await Promise.all(Array.from({length: Math.min(limit, values.length)}, async () => {
    while (cursor < values.length) {
      const index = cursor++;
      result[index] = await task(values[index]);
    }
  }));
  return result;
}

const manifestFile = path.join(dataRoot, 'manifest.json');
const manifest = await load(manifestFile, {schema_version: SCHEMA_VERSION, timezone: TIME_ZONE,
  source: {schedule: null, scoreboard: scoreboardUrl}, dates: [], games: {}, sync: {status: 'never', errors: [], updated_at: null}});
if (manifest.schema_version !== SCHEMA_VERSION || !Array.isArray(manifest.dates) || !manifest.games)
  throw new Error('Existing games manifest schema is incompatible');
const errors = [];
let scheduleDocument, scheduleUrl;
for (const url of scheduleUrls) {
  try {
    const document = await fetchJson(url);
    scheduleGames(document);
    scheduleDocument = document; scheduleUrl = url; break;
  } catch (error) { errors.push(`schedule ${url}: ${error.message}`); }
}

if (!scheduleDocument) {
  const signature = {status: 'failed', errors};
  if (manifest.sync.status !== signature.status || JSON.stringify(manifest.sync.errors) !== JSON.stringify(errors))
    manifest.sync = {...signature, updated_at: nowIso};
  await save(manifestFile, manifest);
  console.error('Official NBA schedule unavailable; saved snapshots preserved.');
  process.exitCode = 1;
} else {
  // A working fallback supersedes an earlier failed schedule candidate.
  errors.length = 0;
  const schedule = scheduleGames(scheduleDocument);
  try { applyScoreboard(schedule, await fetchJson(scoreboardUrl)); }
  catch (error) { console.warn(`Scoreboard overlay unavailable: ${error.message}`); }

  // Maintain a continuous Beijing-date archive, including dates with no games.
  // This also repairs gaps left by a delayed or failed scheduled run.
  if (!args.date) for (const date of seasonArchiveDates(schedule, today)) targetDates.add(date);

  const scheduleDays = [...schedule.values()].map(game => game.beijing_date).sort();
  const first = scheduleDays[0], last = scheduleDays.at(-1);
  const selected = new Map();
  const affectedDates = new Set();
  for (const [id, game] of schedule) {
    const previous = manifest.games[id];
    if (targetDates.has(game.beijing_date) || previous || id === args['game-id']) {
      selected.set(id, game);
      if (previous?.beijing_date !== game.beijing_date && previous) affectedDates.add(previous.beijing_date);
      affectedDates.add(game.beijing_date);
    }
  }
  if (args['game-id'] && !selected.has(args['game-id'])) throw new Error(`Game ${args['game-id']} not found in current official schedule`);
  for (const date of targetDates) {
    if (date >= first && date <= last) affectedDates.add(date);
    else if (args.date) throw new Error(`${date}: outside current NBA schedule; only saved history can be queried`);
  }

  const due = [];
  for (const [id, source] of selected) {
    const previous = manifest.games[id] || null;
    const game = {...source,
      boxscore_state: previous?.boxscore_state || 'not_due',
      boxscore_fetched_at: previous?.boxscore_fetched_at || null,
      updated_at: previous?.updated_at || null};
    if (game.status === 'final') {
      const ageHours = (now.getTime() - new Date(game.start_utc).getTime()) / 3600000;
      if (game.boxscore_state !== 'complete' || ageHours <= 54 ||
          (args.date && game.beijing_date === args.date) || id === args['game-id']) due.push(game);
    } else if (game.status === 'scheduled' || game.status === 'live') game.boxscore_state = 'not_due';
    else game.boxscore_state = game.status;
    selected.set(id, game);
  }

  const results = await mapLimit(due, 3, async game => {
    const url = `${boxscoreBase}${game.game_id}.json`;
    try { return {game, snapshot: boxscoreSnapshot(await fetchJson(url), game, nowIso)}; }
    catch (error) { return {game, error: `${game.game_id}: ${error.message}`}; }
  });
  let boxscoreChanges = 0;
  for (const result of results) {
    const game = selected.get(result.game.game_id);
    const file = path.join(dataRoot, 'boxscores', `${game.game_id}.json`);
    const existing = await load(file, null);
    if (result.error) {
      errors.push(result.error);
      game.boxscore_state = existing?.completeness?.status || 'failed';
      game.boxscore_fetched_at = existing?.source?.fetched_at || null;
      continue;
    }
    const incoming = result.snapshot;
    const existingRank = existing?.completeness?.status === 'complete' ? 2 : existing ? 1 : 0;
    const newRank = incoming.completeness.status === 'complete' ? 2 : 1;
    const oldIssues = existing?.completeness?.issues?.length ?? Infinity;
    const newIssues = incoming.completeness.issues.length;
    const chosen = newRank < existingRank || (newRank === existingRank && newIssues > oldIssues) ? existing : incoming;
    if (chosen === incoming && existing) {
      const oldContent = JSON.stringify({...existing, source: {...existing.source, fetched_at: null}});
      const newContent = JSON.stringify({...incoming, source: {...incoming.source, fetched_at: null}});
      if (oldContent === newContent) chosen.source.fetched_at = existing.source.fetched_at;
    }
    if (chosen === incoming && await save(file, incoming)) boxscoreChanges++;
    game.boxscore_state = chosen.completeness.status;
    game.boxscore_fetched_at = chosen.source.fetched_at;
    if (chosen.teams.home.score !== null) game.home.score = chosen.teams.home.score;
    if (chosen.teams.away.score !== null) game.away.score = chosen.teams.away.score;
    if (chosen.completeness.status !== 'complete') errors.push(`${game.game_id}: incomplete box score (${chosen.completeness.issues.join('; ')})`);
  }

  for (const [id, game] of selected) {
    const previous = manifest.games[id];
    const before = previous ? JSON.stringify({...previous, updated_at: null}) : null;
    const after = JSON.stringify({...game, updated_at: null});
    game.updated_at = before === after ? previous.updated_at : nowIso;
    manifest.games[id] = game;
  }
  const dates = new Set(manifest.dates);
  let indexChanges = 0;
  for (const date of affectedDates) {
    const file = path.join(dataRoot, 'dates', `${date}.json`);
    const previous = await load(file, null);
    const rows = Object.values(manifest.games).filter(game => game.beijing_date === date);
    if (await save(file, dateIndex(date, rows, nowIso, previous))) indexChanges++;
    dates.add(date);
  }
  manifest.dates = [...dates].sort();
  manifest.source = {schedule: scheduleUrl, scoreboard: scoreboardUrl};
  manifest.coverage = {first, last};
  const status = errors.length ? 'partial' : 'ok';
  const syncErrors = errors.map(error => error.replace(/: The operation was aborted.*/, ': timeout'));
  if (manifest.sync.status !== status || JSON.stringify(manifest.sync.errors) !== JSON.stringify(syncErrors))
    manifest.sync = {status, errors: syncErrors, updated_at: nowIso};
  const manifestChanged = await save(manifestFile, manifest);
  console.log(JSON.stringify({today, selected: selected.size, boxscores_checked: due.length,
    boxscores_changed: boxscoreChanges, date_indexes_changed: indexChanges, manifest_changed: manifestChanged,
    sync: status, errors: errors.length, dry_run: dryRun}));
  if (errors.length) { errors.forEach(error => console.error(error)); process.exitCode = 1; }
}

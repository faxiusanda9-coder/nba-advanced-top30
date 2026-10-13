import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { normalizeName, preparePlayerIndex, searchPlayers } from '../assets/player-search-core.mjs';

const database = JSON.parse(await readFile(new URL('../api/_data/players.json', import.meta.url), 'utf8'));
const index = JSON.parse(await readFile(new URL('../data/player-index.json', import.meta.url), 'utf8'));
const prepared = preparePlayerIndex(index);
const require = createRequire(import.meta.url);
const handler = require('../api/player.js');

test('every archived ID appears exactly once; namesakes have distinct stable routes', async () => {
  const ids = new Set();
  for (let year = 1997; year <= 2026; year++) {
    const archive = JSON.parse(await readFile(new URL(`../data/${year}.json`, import.meta.url), 'utf8'));
    for (const phase of ['REG', 'PST']) for (const row of archive.rows[phase]) ids.add(String(row.playerId));
  }
  assert.equal(database.players.length, ids.size);
  assert.equal(new Set(database.players.map(player => player.player_id)).size, ids.size);
  assert.equal(new Set(database.players.map(player => player.slug)).size, ids.size);
  assert.equal(index.players.length, ids.size);
  assert(database.players.every(player => ids.has(player.player_id) && player.team_history.length
    && player.career_range.first_season && player.career_range.last_season));
  const ewing = searchPlayers(prepared, 'Patrick Ewing');
  assert.equal(ewing.length, 2);
  assert.notEqual(ewing[0].player_id, ewing[1].player_id);
  assert.notEqual(ewing[0].slug, ewing[1].slug);
});

test('English keywords, partial names, accents, reordered words and small typos work', () => {
  for (const query of ['LeBron James', 'lebr', 'JAMES LEB', 'lebrn james']) {
    assert.equal(searchPlayers(prepared, query)[0]?.full_name, 'LeBron James', query);
  }
  for (const query of ['jokic', 'Jokić', 'JOKCI']) {
    assert.equal(searchPlayers(prepared, query)[0]?.full_name, 'Nikola Jokić', query);
  }
  assert.equal(searchPlayers(prepared, 'curry')[0].full_name, 'Stephen Curry');
  assert.equal(normalizeName('Egor Dёmin'), normalizeName('Egor Dëmin'));
  assert.deepEqual(searchPlayers(prepared, 'zzzzzqqqq'), []);
  assert.deepEqual(searchPlayers(prepared, '<script>alert(1)</script>'), []);
  assert.deepEqual(searchPlayers(prepared, '詹姆斯'), []);
});

test('matching results are ordered by declared popularity; lightweight index contains no histories', () => {
  for (const query of ['', 'james', 'jordan', 'curry']) {
    const results = searchPlayers(prepared, query);
    assert(results.length <= 8);
    for (let i = 1; i < results.length; i++) assert(results[i - 1].popularity_score >= results[i].popularity_score);
  }
  const score = name => index.players.find(player => player.full_name === name).popularity_score;
  assert(score('LeBron James') > score('Nikola Jokić'));
  assert(score('Nikola Jokić') > score('Stephen Curry'));
  assert.equal(searchPlayers(prepared, 'jordan')[0].full_name, 'Michael Jordan');
  assert(index.players.every(player => !('team_history' in player) && !('popularity_components' in player)));
});

async function request(slug, method = 'GET') {
  const response = { statusCode: 200, headers: {}, setHeader(name, value) { this.headers[name] = value; },
    status(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; }, end() { return this; } };
  await handler({ method, query: { slug } }, response);
  return response;
}

test('profile API returns one player, handles missing/invalid slugs and rejects writes', async () => {
  const response = await request('lebron-james');
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.player.full_name, 'LeBron James');
  assert(!response.body.players);
  assert(!('popularity_components' in response.body.player));
  assert.equal((await request('unknown-nba-player')).statusCode, 404);
  assert.equal((await request('../_data/players.json')).statusCode, 400);
  assert.equal((await request(['lebron-james'])).statusCode, 400);
  assert.equal((await request('lebron-james', 'POST')).statusCode, 405);
  const head = await request('lebron-james', 'HEAD');
  assert.equal(head.statusCode, 200);
  assert.equal(head.body, undefined);
});

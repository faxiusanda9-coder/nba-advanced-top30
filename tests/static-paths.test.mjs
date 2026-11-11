import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeBasePath, rebaseStaticPaths} from '../scripts/lib/static-paths.mjs';

test('a project-site prefix preserves external sources, imports and route regexes', () => {
  const input = '<a href="/">Home</a><script src="/assets/game.js"></script>' +
    '<a href="https://www.nba.com/">Source</a><img alt=""/>' +
    "fetch('/data/games/manifest.json'); import './game-core.mjs';" +
    '`/player/${slug}`; `/daily-games?date=${date}`; ' +
    'location.pathname.match(/\\/game\\/(\\d{10})\\/?$/);';
  const output = rebaseStaticPaths(input, '/nba-advanced-top30/');
  assert.match(output, /href="\/nba-advanced-top30\/"/);
  assert.ok(output.includes('src="/nba-advanced-top30/assets/game.js"'));
  assert.ok(output.includes("fetch('/nba-advanced-top30/data/games/manifest.json')"));
  assert.ok(output.includes('`/nba-advanced-top30/player/${slug}`'));
  assert.ok(output.includes('`/nba-advanced-top30/daily-games?date=${date}`'));
  assert.ok(output.includes('href="https://www.nba.com/"'));
  assert.ok(output.includes("import './game-core.mjs'"));
  assert.ok(output.includes('<img alt=""/>'));
  assert.ok(output.includes('match(/\\/game\\/(\\d{10})\\/?$/)'));
  assert.equal(rebaseStaticPaths(input, ''), input);
  assert.equal(normalizeBasePath('/'), '');
  assert.throws(() => normalizeBasePath('/../secret'));
  assert.throws(() => normalizeBasePath('https://example.com'));
});

const fs = require('node:fs/promises');
const path = require('node:path');
let databasePromise;

async function loadPlayers() {
  if (!databasePromise) databasePromise = fs.readFile(path.join(process.cwd(), 'api', '_data', 'players.json'), 'utf8')
    .then(text => {
      const database = JSON.parse(text);
      if (!Array.isArray(database.players)) throw new Error('Invalid player database');
      return new Map(database.players.map(player => [player.slug, player]));
    }).catch(error => { databasePromise = null; throw error; });
  return databasePromise;
}

module.exports = async function handler(req, res) {
  if (!['GET', 'HEAD'].includes(req.method)) {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const slug = req.query?.slug;
  if (typeof slug !== 'string' || slug.length > 120 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return res.status(400).json({ error: 'Invalid player slug' });
  }
  try {
    const player = (await loadPlayers()).get(slug);
    if (!player) return res.status(404).json({ error: 'Player not found' });
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600');
    if (req.method === 'HEAD') return res.status(200).end();
    // Return only the selected player. Search never downloads this database.
    const { popularity_components, ...profile } = player;
    return res.status(200).json({ player: profile });
  } catch (error) {
    console.error('Player database could not be read');
    return res.status(503).json({ error: 'Player profile temporarily unavailable' });
  }
};

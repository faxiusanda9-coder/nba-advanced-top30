const ENDPOINT = 'https://api.server.nbaapi.com/api/playeradvancedstats';

module.exports = async function handler(req, res) {
  const season = String(req.query.season || '2025-26');
  const type = String(req.query.type || 'REG');
  if (!/^\d{4}-\d{2}$/.test(season)) return res.status(400).json({ error: '赛季参数需类似 2025-26' });
  if (!['REG', 'PST'].includes(type)) return res.status(400).json({ error: '赛制参数无效' });

  const params = new URLSearchParams({
    season: season.slice(0, 4),
    isPlayoff: String(type === 'PST'),
    page: '1',
    pageSize: '100',
    sortBy: 'win_shares',
    ascending: 'false'
  });

  try {
    const firstResponse = await fetch(`${ENDPOINT}?${params}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(20000)
    });
    if (!firstResponse.ok) throw new Error(`NBA API HTTP ${firstResponse.status}`);
    const firstPage = await firstResponse.json();
    if (!Array.isArray(firstPage.data)) throw new Error('NBA API 响应格式变化');

    const pageCount = Math.max(1, Math.min(Number(firstPage.pagination?.pages) || 1, 10));
    const otherPages = await Promise.all(Array.from({ length: pageCount - 1 }, async (_, index) => {
      const pageParams = new URLSearchParams(params);
      pageParams.set('page', String(index + 2));
      const response = await fetch(`${ENDPOINT}?${pageParams}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(20000)
      });
      if (!response.ok) throw new Error(`NBA API HTTP ${response.status}`);
      const body = await response.json();
      if (!Array.isArray(body.data)) throw new Error('NBA API 响应格式变化');
      return body.data;
    }));

    const rows = [...firstPage.data, ...otherPages.flat()].map(player => ({
      PLAYER_NAME: player.playerName,
      TEAM_ABBREVIATION: player.team || '',
      GP: player.games ?? null,
      MIN: player.minutesPlayed ?? null,
      PER: player.per ?? null,
      TS_PCT: player.tsPercent ?? null,
      USG_PCT: player.usagePercent ?? null,
      REB_PCT: player.totalRBPercent ?? null,
      AST_PCT: player.assistPercent ?? null,
      WS: player.winShares ?? null,
      VORP: player.vorp ?? null,
      OBPM: player.offensiveBox ?? null,
      DBPM: player.defensiveBox ?? null,
      playerId: player.playerId
    }));

    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json({ rows, season, type, source: 'NBA Stats API (community beta)' });
  } catch (error) {
    return res.status(502).json({
      error: 'NBA 球员数据获取失败',
      detail: String(error.message || error).slice(0, 240)
    });
  }
};


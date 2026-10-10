const ENDPOINT = 'https://stats.nba.com/stats/leaguedashplayerstats';

module.exports = async function handler(req, res) {
  const season = String(req.query.season || '2025-26');
  const type = String(req.query.type || 'Regular Season');
  if (!/^\d{4}-\d{2}$/.test(season)) {
    return res.status(400).json({ error: '无效的赛季参数' });
  }
  if (!['Regular Season', 'Playoffs'].includes(type)) {
    return res.status(400).json({ error: '无效的赛制参数' });
  }

  const params = new URLSearchParams({
    College: '', Conference: '', Country: '', DateFrom: '', DateTo: '', Division: '',
    DraftPick: '', DraftYear: '', GameScope: '', GameSegment: '', Height: '', ISTRound: '',
    LastNGames: '0', LeagueID: '00', Location: '', MeasureType: 'Advanced', Month: '0',
    OpponentTeamID: '0', Outcome: '', PORound: '0', PaceAdjust: 'N', PerMode: 'PerGame',
    Period: '0', PlayerExperience: '', PlayerPosition: '', PlusMinus: 'N', Rank: 'N',
    Season: season, SeasonSegment: '', SeasonType: type, ShotClockRange: '', StarterBench: '',
    TeamID: '0', VsConference: '', VsDivision: '', Weight: ''
  });

  try {
    const response = await fetch(`${ENDPOINT}?${params}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; NBAAdvancedTop30/1.0)',
        Referer: 'https://www.nba.com/',
        Origin: 'https://www.nba.com',
        Accept: 'application/json, text/plain, */*'
      }
    });
    if (!response.ok) throw new Error(`NBA Stats HTTP ${response.status}`);
    const payload = await response.json();
    const result = payload.resultSets?.[0];
    if (!result?.headers || !result?.rowSet) throw new Error('NBA Stats 响应格式变化');
    const rows = result.rowSet.map(row => Object.fromEntries(result.headers.map((key, i) => [key, row[i]])));
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    return res.status(200).json({ rows, season, type, source: 'NBA Stats' });
  } catch (error) {
    return res.status(502).json({ error: 'NBA Stats 请求失败或响应格式变化', detail: String(error.message).slice(0, 240) });
  }
};

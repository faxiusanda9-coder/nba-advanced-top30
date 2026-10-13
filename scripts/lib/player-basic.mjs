export const basicFields = { pts: 'PTS', reb: 'REB', ast: 'AST', stl: 'STL', blk: 'BLK', tov: 'TOV',
  fg_pct: 'FG_PCT', fg3_pct: 'FG3_PCT', ft_pct: 'FT_PCT', age: 'AGE', team_count: 'TEAM_COUNT' };
export const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);

// Quoted CSV cells are parsed once per line, including escaped quotes.
export function parseCsv(text) {
  const cellList = line => {
    const cells = []; let cell = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (quoted && line[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
      } else if (char === ',' && !quoted) { cells.push(cell); cell = ''; } else cell += char;
    }
    cells.push(cell); return cells;
  };
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const headers = cellList(lines.shift());
  return lines.map(line => { const cells = cellList(line); return Object.fromEntries(headers.map((key, i) => [key, cells[i] ?? ''])); });
}

export function extractBasic(rows, year) {
  const result = { REG: [], PST: [] };
  for (const row of rows) {
    if (row.measure_type !== 'base' || row.per_mode !== 'pergame') continue;
    const phase = row.season_type === 'regular-season' ? 'REG' : row.season_type === 'playoffs' ? 'PST' : null;
    if (!phase || Number(row.season) !== year) continue;
    result[phase].push({ player_id: String(row.player_id), team: row.team_abbreviation || null,
      GP: number(row.gp), MIN: number(row.min),
      ...Object.fromEntries(Object.entries(basicFields).map(([input, output]) => [output, number(row[input])])) });
  }
  for (const phase of ['REG', 'PST']) {
    if (new Set(result[phase].map(row => row.player_id)).size !== result[phase].length) {
      throw new Error(`${year} ${phase}: 基础统计存在重复 ID，不能把合计行和球队行相加`);
    }
  }
  return result;
}

export function applyBasic(archive, basic) {
  let matched = 0;
  for (const phase of ['REG', 'PST']) {
    const byId = new Map(basic[phase].map(row => [row.player_id, row]));
    for (const row of archive.rows[phase]) {
      const source = byId.get(String(row.playerId));
      // A stale snapshot must never attach a different phase or partial season.
      if (!source || source.GP == null || source.MIN == null || number(row.GP) == null || number(row.MIN) == null
          || source.GP !== number(row.GP) || Math.abs(source.MIN - number(row.MIN)) > 0.11) {
        for (const key of Object.values(basicFields)) delete row[key];
        continue;
      }
      for (const key of Object.values(basicFields)) row[key] = source[key];
      matched++;
    }
  }
  return matched;
}

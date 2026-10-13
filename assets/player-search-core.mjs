export function normalizeName(value) {
  return String(value ?? '').replace(/[ёЁ]/g, 'e').normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[øłđðæœßþ]/g, char => ({ ø: 'o', ł: 'l', đ: 'd', ð: 'd', æ: 'ae', œ: 'oe', ß: 'ss', þ: 'th' })[char])
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

export function nameSlug(value) {
  return normalizeName(value).replace(/ /g, '-');
}

export function preparePlayerIndex(index) {
  if (!Array.isArray(index?.players)) throw new Error('球员索引格式异常');
  return index.players.map(player => ({
    ...player,
    _forms: [...new Set([player.normalized_name, player.full_name, ...(player.aliases || [])]
      .filter(Boolean).map(normalizeName))].map(name => ({ name, compact: name.replace(/ /g, ''), words: name.split(' ') }))
  })).sort((a, b) => Number(b.popularity_score || 0) - Number(a.popularity_score || 0)
    || a.full_name.localeCompare(b.full_name, 'en') || String(a.player_id).localeCompare(String(b.player_id), 'en', { numeric: true }));
}

function editDistance(a, b) {
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) current[j] = Math.min(current[j - 1] + 1, previous[j] + 1,
      previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    previous = current;
  }
  return previous[b.length];
}

function approximateWord(query, word) {
  if (word.includes(query)) return true;
  if (query.length < 3) return false;
  const tolerance = query.length >= 5 ? 2 : 1;
  // Compare against word prefixes too, so partial spellings and small typos
  // can find full names without downloading any player profiles.
  for (let length = Math.max(1, query.length - tolerance); length <= Math.min(word.length, query.length + tolerance); length++) {
    if (editDistance(query, word.slice(0, length)) <= tolerance) return true;
  }
  return false;
}

export function searchPlayers(prepared, input, limit = 8) {
  const query = normalizeName(String(input ?? '').slice(0, 80));
  if (!query) return String(input ?? '').trim() ? [] : prepared.slice(0, limit);
  const words = query.split(' ');
  const compact = query.replace(/ /g, '');
  const exact = prepared.filter(player => player._forms.some(form => form.name === query));
  if (exact.length) return exact.slice(0, limit);
  const matches = prepared.filter(player => player._forms.some(form => form.name.includes(query)
    || form.compact.includes(compact) || words.every(word => form.words.some(part => part.includes(word)))));
  if (matches.length) return matches.slice(0, limit);
  return prepared.filter(player => player._forms.some(form => words.every(word =>
    form.words.some(part => approximateWord(word, part))))).slice(0, limit);
}

const beijingParts = instant => Object.fromEntries(new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
}).formatToParts(new Date(instant)).map(part => [part.type, part.value]));

export function beijingToday(instant = new Date()) {
  const parts = beijingParts(instant);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function relativeDate(iso, offset) {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export const typeName = {regular: '常规赛', play_in: '附加赛', playoffs: '季后赛'};
export const statusName = {scheduled: '未开始', live: '进行中 · 尚未结束', final: '已结束',
  postponed: '延期', canceled: '取消'};

export function beijingTime(instant) {
  if (!instant) return '时间待定';
  return new Intl.DateTimeFormat('zh-CN', {timeZone: 'Asia/Shanghai', month: 'numeric',
    day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false}).format(new Date(instant));
}

export const shown = value => value === null || value === undefined ? '—' : String(value);
export const shownGmsc = value => value === null || value === undefined ? '暂无数据' : Number(value).toFixed(1);

export function sortPlayers(players, key = 'gmsc', direction = 'desc') {
  const value = player => key === 'gmsc' ? player.gmsc?.value
    : key === 'minutes' ? player.minutes ? Number(player.minutes.split(':')[0]) * 60 + Number(player.minutes.split(':')[1]) : null
      : player.stats?.[key];
  return [...players].sort((a, b) => {
    const av = value(a), bv = value(b);
    if (av === null || av === undefined) return bv === null || bv === undefined ? a.player_name.localeCompare(b.player_name) : 1;
    if (bv === null || bv === undefined) return -1;
    const difference = direction === 'asc' ? av - bv : bv - av;
    return difference || a.player_name.localeCompare(b.player_name);
  });
}

export function chartScale(players) {
  const values = players.map(player => player.gmsc?.value).filter(Number.isFinite);
  const minimum = Math.min(0, ...values), maximum = Math.max(0, ...values);
  const span = maximum - minimum || 1;
  return {minimum, maximum, zero: -minimum / span * 100,
    segment(value) {
      const at = (value - minimum) / span * 100;
      const zero = -minimum / span * 100;
      return {left: Math.min(at, zero), width: Math.abs(at - zero)};
    }};
}

export function dateViewState(responseStatus, index, manifest, selected, today) {
  if (responseStatus === 200 && index) return index.state === 'no_games' ? 'no_games' : 'games';
  if (manifest?.sync?.status === 'failed' || (manifest?.sync?.status === 'partial' && selected >= today)) return 'source_failed';
  return selected < today ? 'not_archived' : 'not_available';
}

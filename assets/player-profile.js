const state = document.getElementById('profileState');
const content = document.getElementById('profileContent');
const card = document.querySelector('.profile-card');

async function loadProfile() {
  try {
    const path = window.location.pathname.match(/^\/player\/([^/]+)\/?$/);
    const slug = path ? decodeURIComponent(path[1]) : new URLSearchParams(window.location.search).get('slug');
    if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('请通过球员搜索打开有效的球员主页。');
    const response = await fetch(`/api/player?slug=${encodeURIComponent(slug)}`, { signal: AbortSignal.timeout(15000) });
    if (response.status === 404) throw new Error('未找到这位球员，试试右上角的搜索框。');
    if (!response.ok) throw new Error('球员主页暂时无法读取，请稍后刷新。');
    const { player } = await response.json();
    if (!player?.full_name) throw new Error('球员主页暂时无法读取，请稍后刷新。');
    document.title = `${player.full_name} · NBA 球员主页`;
    document.getElementById('profileName').textContent = player.full_name;
    const avatar = document.getElementById('profileAvatar');
    avatar.textContent = player.full_name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
    if (/^\d+$/.test(String(player.player_id))) {
      const image = document.createElement('img');
      image.src = `https://cdn.nba.com/headshots/nba/latest/260x190/${player.player_id}.png`;
      image.alt = '';
      image.addEventListener('error', () => image.remove(), { once: true });
      avatar.append(image);
    }
    state.hidden = true;
    content.hidden = false;
  } catch (error) {
    state.textContent = error.message;
    content.hidden = true;
  } finally {
    card.setAttribute('aria-busy', 'false');
  }
}

loadProfile();

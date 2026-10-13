import { preparePlayerIndex, searchPlayers } from './player-search-core.mjs';

let indexPromise;
let widgetNumber = 0;
async function loadIndex() {
  if (!indexPromise) indexPromise = (async () => {
    const response = await fetch('/data/player-index.json', { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('球员索引暂时无法读取');
    return preparePlayerIndex(await response.json());
  })().catch(error => { indexPromise = null; throw error; });
  return indexPromise;
}

class PlayerSearch extends HTMLElement {
  connectedCallback() {
    if (this.initialized) return;
    this.initialized = true;
    const id = `player-search-${++widgetNumber}`;
    this.innerHTML = `
      <label class="player-search-label" for="${id}-input">搜索球员 · 1996–2026</label>
      <div class="player-search-field">
        <svg class="player-search-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" stroke-width="2"/><path d="m16 16 5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <input id="${id}-input" class="player-search-input" type="search" placeholder="输入英文姓名或关键词…" maxlength="80" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-list">
      </div>
      <div class="player-search-panel" hidden>
        <div class="player-search-heading"></div>
        <div id="${id}-list" class="player-search-list" role="listbox" aria-label="球员搜索结果"></div>
        <div class="player-search-footnote">1996–97 至 2025–26 档案球员<br>按近期活跃度与历史影响力排序</div>
      </div>
      <div class="player-search-live" aria-live="polite" aria-atomic="true"></div>`;
    this.input = this.querySelector('input');
    this.panel = this.querySelector('.player-search-panel');
    this.list = this.querySelector('.player-search-list');
    this.heading = this.querySelector('.player-search-heading');
    this.live = this.querySelector('.player-search-live');
    this.listId = `${id}-list`;
    this.results = [];
    this.active = -1;
    this.requestNumber = 0;
    this.input.addEventListener('focus', () => this.refresh());
    this.input.addEventListener('click', () => { if (this.panel.hidden) this.refresh(); });
    this.input.addEventListener('input', () => {
      clearTimeout(this.debounce);
      // Invalidate earlier requests immediately, before the debounce starts.
      this.requestNumber++;
      this.message('正在搜索…');
      this.debounce = setTimeout(() => this.refresh(), 100);
    });
    this.input.addEventListener('keydown', event => this.keydown(event));
    this.addEventListener('focusout', event => {
      if (!this.contains(event.relatedTarget)) this.close();
    });
    this.outsideClick = event => { if (!this.contains(event.target)) this.close(); };
    document.addEventListener('pointerdown', this.outsideClick);
    this.list.addEventListener('pointerdown', event => {
      // Keep the combobox focused until the link's normal click navigation.
      if (event.target.closest('a')) event.preventDefault();
    });
  }

  disconnectedCallback() {
    clearTimeout(this.debounce);
    this.requestNumber++;
    document.removeEventListener('pointerdown', this.outsideClick);
  }

  open() {
    this.panel.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
  }

  close() {
    clearTimeout(this.debounce);
    this.requestNumber++;
    this.panel.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
    this.active = -1;
  }

  message(text) {
    const note = document.createElement('div');
    note.className = 'player-search-empty';
    note.textContent = text;
    this.list.replaceChildren(note);
    this.results = [];
    this.active = -1;
    this.input.removeAttribute('aria-activedescendant');
  }

  async refresh() {
    const request = ++this.requestNumber;
    const query = this.input.value;
    this.open();
    this.heading.textContent = query.trim() ? '搜索结果' : '热门球员';
    if (!this.players) this.message('正在读取球员索引…');
    try {
      this.players = await loadIndex();
      if (request !== this.requestNumber || document.activeElement !== this.input) return;
      this.results = searchPlayers(this.players, query);
      this.active = -1;
      this.input.removeAttribute('aria-activedescendant');
      if (!this.results.length) {
        this.message('没有找到匹配球员，试试姓名中的另一部分。');
        this.live.textContent = '没有找到匹配球员';
        return;
      }
      this.list.replaceChildren(...this.results.map((player, index) => {
        const link = document.createElement('a');
        link.href = `/player/${encodeURIComponent(player.slug)}`;
        link.className = 'player-search-result';
        link.id = `${this.listId}-option-${index}`;
        link.setAttribute('role', 'option');
        link.setAttribute('aria-selected', 'false');
        link.tabIndex = -1;
        const avatar = document.createElement('span');
        avatar.className = 'player-search-avatar';
        avatar.setAttribute('aria-hidden', 'true');
        avatar.textContent = player.full_name.split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase();
        const copy = document.createElement('span');
        const name = document.createElement('span');
        name.className = 'player-search-name';
        name.textContent = player.full_name;
        const meta = document.createElement('span');
        meta.className = 'player-search-meta';
        meta.textContent = `${player.last_team || 'NBA'} · 最后收录 ${player.last_season}`;
        copy.append(name, meta);
        link.append(avatar, copy);
        return link;
      }));
      this.live.textContent = `找到 ${this.results.length} 个球员建议，可按上下键选择，回车打开主页`;
    } catch (error) {
      if (request !== this.requestNumber) return;
      this.message('球员搜索暂时无法加载，请重新点击搜索框重试。');
      this.live.textContent = '球员搜索暂时无法加载';
    }
  }

  keydown(event) {
    if (event.isComposing) return;
    if (event.key === 'Escape') { this.close(); return; }
    if (event.key === 'Enter') {
      if (!this.panel.hidden && this.results.length) {
        event.preventDefault();
        window.location.assign(`/player/${encodeURIComponent(this.results[Math.max(0, this.active)].slug)}`);
      }
      return;
    }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    if (this.panel.hidden) { this.refresh(); return; }
    if (!this.results.length) return;
    this.active = event.key === 'ArrowDown' ? (this.active + 1) % this.results.length
      : (this.active < 0 ? this.results.length - 1 : (this.active - 1 + this.results.length) % this.results.length);
    [...this.list.children].forEach((link, index) => {
      link.classList.toggle('is-active', index === this.active);
      link.setAttribute('aria-selected', String(index === this.active));
    });
    const option = this.list.children[this.active];
    this.input.setAttribute('aria-activedescendant', option.id);
    option.scrollIntoView({ block: 'nearest' });
  }
}

customElements.define('player-search', PlayerSearch);

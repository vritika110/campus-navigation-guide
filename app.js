/* ============================================================
   Campus Navigation Guide – app logic
   One source of truth (`state`). Every user action updates the
   state and calls render(), so the map, list and info panel can
   never get out of sync.
   ============================================================ */
(() => {
  'use strict';

  const STORAGE_KEY = 'campus-guide:favorites:v1';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const state = {
    locations: [],
    selectedId: null,
    query: '',
    filter: 'all',   // 'all' | 'saved'
    tab: 'map',      // 'map' | 'list' (mobile only)
    favorites: new Set(),
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const els = {
    list: $('#location-list'),
    search: $('#search'),
    clearSearch: $('#clear-search'),
    count: $('#result-count'),
    zones: $('#zones'),
    route: $('#route'),
    info: $('#info-panel'),
    listView: $('#list-view'),
    mapView: $('#map-view'),
    error: $('#error-banner'),
    clock: $('#clock'),
    date: $('#date'),
    savedCount: $('#saved-count'),
    tabs: $$('[data-tab]'),
    filters: $$('[data-filter]'),
  };

  const zoneEls = new Map();
  let routeFor; // which location the drawn route belongs to

  /* ---------------- Helpers ---------------- */

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
  const byId = (id) => state.locations.find((l) => l.id === id);

  const toMins = (t) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const to12h = (t) => {
    const [h, m] = t.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  };

  function setHTML(el, html) {
    if (el._html === html) return false; // nothing changed – keep scroll/focus
    el.innerHTML = html;
    el._html = html;
    return true;
  }

  function svgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  }
  function svgText(cls, x, y, text) {
    const t = svgEl('text', { class: cls, x, y, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    t.textContent = text;
    return t;
  }

  const star = (filled, cls = 'h-5 w-5') =>
    `<svg viewBox="0 0 24 24" class="${cls}" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.5l2.6 5.3 5.9.86-4.25 4.14 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.66l5.9-.86L12 3.5z"/></svg>`;

  /* ---------------- Favorites (localStorage) ---------------- */

  function loadFavorites() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  }
  function saveFavorites() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([...state.favorites]));
    } catch { /* storage unavailable (private mode) – favorites last for this visit only */ }
  }
  function toggleFavorite(id) {
    if (!byId(id)) return;
    state.favorites.has(id) ? state.favorites.delete(id) : state.favorites.add(id);
    saveFavorites();
    render();
  }

  /* ---------------- Open / Closed status ---------------- */

  const STATUS_STYLES = {
    open:    { pill: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500' },
    closing: { pill: 'bg-amber-100 text-amber-800',     dot: 'bg-amber-500' },
    closed:  { pill: 'bg-rose-100 text-rose-800',       dot: 'bg-rose-500' },
  };

  function getStatus(loc, now = new Date()) {
    const h = loc.hours || {};
    if (h.always) return { state: 'open', text: 'Open now', detail: 'Open 24 hours' };

    const day = now.getDay();
    const mins = now.getHours() * 60 + now.getMinutes();
    const o = toMins(h.open);
    const c = toMins(h.close);
    const overnight = c <= o;

    const isOpen = overnight
      ? (h.days.includes(day) && mins >= o) || (h.days.includes((day + 6) % 7) && mins < c)
      : h.days.includes(day) && mins >= o && mins < c;

    if (isOpen) {
      const remaining = (c - mins + 1440) % 1440;
      if (remaining <= 60) {
        return { state: 'closing', text: 'Closes soon', detail: `Closes at ${to12h(h.close)} (in ${remaining} min)` };
      }
      return { state: 'open', text: 'Open now', detail: `Closes at ${to12h(h.close)}` };
    }

    for (let d = 0; d <= 7; d++) {
      const dd = (day + d) % 7;
      if (!h.days.includes(dd)) continue;
      if (d === 0 && mins >= o) continue;
      const when = d === 0 ? 'today' : d === 1 ? 'tomorrow' : SHORT_DAYS[dd];
      return { state: 'closed', text: 'Closed', detail: `Opens ${when} at ${to12h(h.open)}` };
    }
    return { state: 'closed', text: 'Closed', detail: 'Currently closed' };
  }

  const badge = (s) => {
    const st = STATUS_STYLES[s.state];
    return `<span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.pill}"><span class="h-1.5 w-1.5 rounded-full ${st.dot}"></span>${s.text}</span>`;
  };

  /* ---------------- Filtering ---------------- */

  function matches(loc) {
    if (state.filter === 'saved' && !state.favorites.has(loc.id)) return false;
    const q = state.query.trim().toLowerCase();
    if (!q) return true;
    return [loc.name, loc.short, loc.category, loc.description].join(' ').toLowerCase().includes(q);
  }

  /* ---------------- Selection ---------------- */

  function updateHash() {
    const url = state.selectedId ? `#${state.selectedId}` : location.pathname + location.search;
    try { history.replaceState(null, '', url); } catch { /* ignore */ }
  }

  function select(id, { fromMap = false } = {}) {
    const loc = byId(id);
    if (!loc) return;
    // Make sure the item is visible in the list so both views show the highlight
    if (!matches(loc)) {
      state.query = '';
      state.filter = 'all';
      els.search.value = '';
    }
    state.selectedId = id;
    updateHash();
    render();
    if (fromMap) {
      const row = els.list.querySelector(`[data-select="${CSS.escape(id)}"]`);
      if (row) row.scrollIntoView({ block: 'nearest' });
    }
  }

  function deselect() {
    state.selectedId = null;
    updateHash();
    render();
  }

  function setTab(tab) {
    state.tab = tab;
    renderTabs();
  }

  /* ---------------- Map ---------------- */

  function buildMap() {
    els.zones.replaceChildren();
    zoneEls.clear();

    for (const loc of state.locations) {
      const { x, y, w, h } = loc.map;
      const g = svgEl('g', {
        class: 'zone',
        'data-id': loc.id,
        tabindex: '0',
        role: 'button',
        'aria-label': `${loc.name}, ${loc.category}`,
        'aria-pressed': 'false',
        style: `--c:${loc.color}`,
      });
      const title = svgEl('title');
      title.textContent = loc.name;

      g.append(
        title,
        svgEl('rect', { class: 'pulse', x: x - w / 2, y: y - h / 2, width: w, height: h, rx: 1.6 }),
        svgEl('rect', { class: 'zone-bg', x: x - w / 2, y: y - h / 2, width: w, height: h, rx: 1.6 }),
        svgText('zone-icon', x, y - 1.1, loc.icon),
        svgText('zone-label', x, y + h / 2 - 2, loc.short || loc.name),
        svgEl('circle', { class: 'zone-dot open', cx: x - w / 2 + 1.9, cy: y - h / 2 + 1.9, r: 0.95 }),
        svgText('zone-fav', x + w / 2 - 1.9, y - h / 2 + 2.9, '★')
      );
      els.zones.append(g);
      zoneEls.set(loc.id, g);
    }
  }

  function renderMap(now) {
    for (const loc of state.locations) {
      const g = zoneEls.get(loc.id);
      if (!g) continue;
      const active = loc.id === state.selectedId;
      g.classList.toggle('active', active);
      g.classList.toggle('is-fav', state.favorites.has(loc.id));
      g.classList.toggle('dimmed', !matches(loc));
      g.setAttribute('aria-pressed', String(active));
      g.querySelector('.zone-dot').setAttribute('class', `zone-dot ${getStatus(loc, now).state}`);
    }
    renderRoute();
  }

  function renderRoute() {
    if (routeFor === state.selectedId) return;
    routeFor = state.selectedId;
    els.route.replaceChildren();

    const loc = byId(state.selectedId);
    if (!loc || !loc.route || loc.route.length < 2) return;

    const pts = loc.route.map((p) => p.join(',')).join(' ');
    const g = svgEl('g', { class: 'route-anim' });
    g.append(
      svgEl('polyline', { class: 'route-casing', points: pts }),
      svgEl('polyline', { class: 'route-line', points: pts }),
      svgEl('circle', { class: 'route-start', cx: loc.route[0][0], cy: loc.route[0][1], r: 1.1 })
    );
    els.route.append(g);
  }

  // Nearest building in the direction of an arrow key
  function neighbour(fromId, key) {
    const from = byId(fromId).map;
    let best = null;
    let bestScore = Infinity;
    for (const l of state.locations) {
      if (l.id === fromId) continue;
      const dx = l.map.x - from.x;
      const dy = l.map.y - from.y;
      const along = key === 'ArrowRight' ? dx : key === 'ArrowLeft' ? -dx : key === 'ArrowDown' ? dy : -dy;
      if (along <= 0) continue;
      const across = key === 'ArrowRight' || key === 'ArrowLeft' ? Math.abs(dy) : Math.abs(dx);
      const score = along + across * 2;
      if (score < bestScore) { bestScore = score; best = l.id; }
    }
    return best;
  }

  /* ---------------- List ---------------- */

  function rowHtml(loc, now) {
    const active = loc.id === state.selectedId;
    const fav = state.favorites.has(loc.id);
    const s = getStatus(loc, now);
    const st = STATUS_STYLES[s.state];
    const id = esc(loc.id);

    return `
      <li>
        <div class="flex items-stretch rounded-xl border transition ${
          active ? 'border-indigo-500 bg-indigo-50 ring-1 ring-indigo-500'
                 : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'}">
          <button type="button" data-select="${id}" ${active ? 'aria-current="true"' : ''}
            class="flex min-w-0 flex-1 items-center gap-3 rounded-l-xl p-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500">
            <span class="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-xl" style="background:${esc(loc.color)}22" aria-hidden="true">${loc.icon}</span>
            <span class="min-w-0">
              <span class="block truncate text-sm font-semibold">${esc(loc.name)}</span>
              <span class="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                <span class="h-2 w-2 shrink-0 rounded-full ${st.dot}"></span>
                <span class="truncate">${s.text} · ${esc(loc.category)}</span>
              </span>
            </span>
          </button>
          <button type="button" data-fav="${id}" aria-pressed="${fav}"
            aria-label="${fav ? 'Remove' : 'Save'} ${esc(loc.name)} ${fav ? 'from' : 'to'} favorites"
            class="grid w-12 shrink-0 place-items-center rounded-r-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
              fav ? 'text-amber-500' : 'text-slate-400 hover:text-amber-500'}">${star(fav)}</button>
        </div>
      </li>`;
  }

  function renderList(now) {
    const items = state.locations.filter(matches);
    const total = state.locations.length;
    els.count.textContent = items.length === total ? `${total} places` : `${items.length} of ${total} places`;

    let html;
    if (!items.length) {
      const onlySaved = state.filter === 'saved' && !state.query.trim();
      html = `<li class="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">${
        onlySaved
          ? 'No saved places yet.<br>Tap the ☆ on any place to save it.'
          : `No places match “${esc(state.query.trim())}”.`}</li>`;
    } else {
      html = items.map((l) => rowHtml(l, now)).join('');
    }

    // keep scroll position and keyboard focus across re-renders
    const scroll = els.list.scrollTop;
    const a = document.activeElement;
    let focusKey = null;
    if (a && els.list.contains(a)) {
      if (a.dataset.select) focusKey = ['select', a.dataset.select];
      else if (a.dataset.fav) focusKey = ['fav', a.dataset.fav];
    }
    if (setHTML(els.list, html)) {
      els.list.scrollTop = scroll;
      if (focusKey) {
        const el = els.list.querySelector(`[data-${focusKey[0]}="${CSS.escape(focusKey[1])}"]`);
        if (el) el.focus({ preventScroll: true });
      }
    }
  }

  /* ---------------- Info panel ---------------- */

  function renderInfo(now) {
    const loc = byId(state.selectedId);
    els.info.classList.toggle('is-empty', !loc);
    document.body.classList.toggle('has-sheet', !!loc);

    let html;
    if (!loc) {
      html = `
        <div class="p-8 text-center">
          <div class="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-indigo-50 text-3xl" aria-hidden="true">📍</div>
          <h2 class="mt-4 text-base font-bold">Select a location</h2>
          <p class="mt-1 text-sm text-slate-500">Click a building on the map or pick a place from the list to see its timings and step-by-step directions from the Main Gate.</p>
        </div>`;
    } else {
      const s = getStatus(loc, now);
      const fav = state.favorites.has(loc.id);
      const isGate = loc.id === 'main-gate';
      const steps = loc.directions.map((t, i) => `
        <li class="flex gap-3">
          <span class="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-indigo-600 text-xs font-bold text-white">${i + 1}</span>
          <span class="pt-0.5 text-sm text-slate-700">${esc(t)}</span>
        </li>`).join('');

      html = `
        <div class="fade-in">
          <div class="mx-auto mt-2 h-1.5 w-10 rounded-full bg-slate-300 lg:hidden" aria-hidden="true"></div>
          <div class="p-5">
            <div class="flex items-start gap-3">
              <div class="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-2xl" style="background:${esc(loc.color)}22" aria-hidden="true">${loc.icon}</div>
              <div class="min-w-0 flex-1">
                <p class="text-xs font-medium uppercase tracking-wide text-slate-500">${esc(loc.category)}</p>
                <h2 class="text-xl font-bold leading-tight">${esc(loc.name)}</h2>
                <div class="mt-2 flex flex-wrap items-center gap-2">
                  ${badge(s)}
                  <span class="text-xs text-slate-500">${esc(s.detail)}</span>
                </div>
              </div>
              <div class="flex shrink-0 gap-1">
                <button type="button" data-info-fav aria-pressed="${fav}"
                  aria-label="${fav ? 'Remove from favorites' : 'Save to favorites'}"
                  class="grid h-10 w-10 place-items-center rounded-full border focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    fav ? 'border-amber-300 bg-amber-50 text-amber-500' : 'border-slate-200 text-slate-400 hover:text-amber-500'}">${star(fav)}</button>
                <button type="button" data-close aria-label="Close details"
                  class="grid h-10 w-10 place-items-center rounded-full border border-slate-200 text-slate-400 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500">✕</button>
              </div>
            </div>

            <p class="mt-4 text-sm leading-relaxed text-slate-600">${esc(loc.description)}</p>

            <div class="mt-4 rounded-xl bg-slate-50 p-3">
              <p class="text-xs font-semibold uppercase tracking-wide text-slate-500">Timings</p>
              <p class="mt-0.5 text-sm font-medium">🕒 ${esc(loc.timings)}</p>
            </div>

            <h3 class="mt-5 text-sm font-bold">${isGate ? 'Getting started' : 'How to reach from the Main Gate'}</h3>
            <ol class="mt-3 space-y-3">${steps}</ol>

            <button type="button" data-show-map
              class="mt-5 w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 lg:hidden">🗺️ Show on map</button>
          </div>
        </div>`;
    }

    const hadFavFocus = els.info.contains(document.activeElement) && document.activeElement.hasAttribute('data-info-fav');
    if (setHTML(els.info, html) && hadFavFocus) {
      const btn = els.info.querySelector('[data-info-fav]');
      if (btn) btn.focus();
    }
  }

  /* ---------------- Tabs, filters, clock ---------------- */

  function renderTabs() {
    els.tabs.forEach((b) => {
      const on = b.dataset.tab === state.tab;
      b.setAttribute('aria-selected', String(on));
      b.classList.toggle('bg-white', on);
      b.classList.toggle('shadow-sm', on);
      b.classList.toggle('text-indigo-700', on);
      b.classList.toggle('text-slate-500', !on);
    });
    els.mapView.classList.toggle('hidden', state.tab !== 'map');
    els.listView.classList.toggle('hidden', state.tab !== 'list');
  }

  function renderFilters() {
    els.filters.forEach((b) => {
      const on = b.dataset.filter === state.filter;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('bg-white', on);
      b.classList.toggle('shadow-sm', on);
      b.classList.toggle('text-indigo-700', on);
      b.classList.toggle('text-slate-500', !on);
    });
    els.savedCount.textContent = state.favorites.size;
    els.clearSearch.classList.toggle('hidden', !state.query);
    els.clearSearch.classList.toggle('grid', !!state.query);
  }

  function renderClock(now) {
    els.clock.textContent = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    els.date.textContent = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
  }

  /* ---------------- Master render ---------------- */

  function render() {
    const now = new Date();
    renderClock(now);
    renderTabs();
    renderFilters();
    renderList(now);
    renderMap(now);
    renderInfo(now);
  }

  /* ---------------- Events ---------------- */

  function bindEvents() {
    // Search
    els.search.addEventListener('input', () => {
      state.query = els.search.value;
      render();
    });
    els.search.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (els.search.value) { els.search.value = ''; state.query = ''; render(); }
        else els.search.blur();
      } else if (e.key === 'ArrowDown') {
        const first = $('[data-select]', els.list);
        if (first) { e.preventDefault(); first.focus(); }
      }
    });
    els.clearSearch.addEventListener('click', () => {
      els.search.value = '';
      state.query = '';
      render();
      els.search.focus();
    });

    // Tabs & filters
    els.tabs.forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));
    els.filters.forEach((b) => b.addEventListener('click', () => { state.filter = b.dataset.filter; render(); }));

    // List: click (select / favorite)
    els.list.addEventListener('click', (e) => {
      const fav = e.target.closest('[data-fav]');
      if (fav) { toggleFavorite(fav.dataset.fav); return; }
      const sel = e.target.closest('[data-select]');
      if (sel) select(sel.dataset.select);
    });

    // List: keyboard navigation
    els.list.addEventListener('keydown', (e) => {
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
      const items = $$('[data-select]', els.list);
      if (!items.length) return;
      const current = e.target.closest('li') && e.target.closest('li').querySelector('[data-select]');
      const idx = items.indexOf(current);
      let next;
      if (e.key === 'ArrowDown') next = items[Math.min(idx + 1, items.length - 1)];
      else if (e.key === 'ArrowUp') next = idx <= 0 ? els.search : items[idx - 1];
      else if (e.key === 'Home') next = items[0];
      else next = items[items.length - 1];
      if (next) { e.preventDefault(); next.focus(); }
    });

    // Map: click & keyboard
    els.zones.addEventListener('click', (e) => {
      const g = e.target.closest('.zone');
      if (g) select(g.dataset.id, { fromMap: true });
    });
    els.zones.addEventListener('keydown', (e) => {
      const g = e.target.closest('.zone');
      if (!g) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select(g.dataset.id, { fromMap: true });
      } else if (e.key.startsWith('Arrow')) {
        e.preventDefault();
        const next = neighbour(g.dataset.id, e.key);
        if (next) zoneEls.get(next).focus();
      }
    });

    // Info panel buttons
    els.info.addEventListener('click', (e) => {
      if (e.target.closest('[data-info-fav]')) toggleFavorite(state.selectedId);
      else if (e.target.closest('[data-close]')) deselect();
      else if (e.target.closest('[data-show-map]')) setTab('map');
    });

    // Global shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (e.key === '/') {
        e.preventDefault();
        setTab('list');
        els.search.focus();
      } else if (e.key === 'Escape' && state.selectedId) {
        deselect();
      } else if ((e.key === 'f' || e.key === 'F') && state.selectedId) {
        toggleFavorite(state.selectedId);
      }
    });

    // Keep favorites in sync across browser tabs
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY) { state.favorites = loadFavorites(); render(); }
    });

    // Support back/forward or manual edits of #hash
    window.addEventListener('hashchange', () => {
      const id = decodeURIComponent(location.hash.slice(1));
      if (id !== state.selectedId && byId(id)) { state.selectedId = id; render(); }
    });
  }

  /* ---------------- Init ---------------- */

  function showError(err) {
    console.error(err);
    els.error.classList.remove('hidden');
    els.error.innerHTML = `<strong>Couldn't load <code>data.json</code>.</strong> ${esc(err.message || err)}<br>
      If you opened <code>index.html</code> directly from your files, run a local server instead
      (e.g. <code>python -m http.server</code>) or deploy the folder to a web host.`;
    els.list.innerHTML = '';
    els.count.textContent = '';
  }

  async function init() {
    state.favorites = loadFavorites();
    bindEvents();
    renderClock(new Date());
    renderTabs();

    try {
      const res = await fetch('data.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error(`Server responded with ${res.status}.`);
      const data = await res.json();
      if (!Array.isArray(data) || !data.length) throw new Error('data.json must contain a non-empty array.');
      state.locations = data;
    } catch (err) {
      showError(err);
      return;
    }

    // forget saved ids that no longer exist in the data
    state.favorites = new Set([...state.favorites].filter((id) => byId(id)));

    buildMap();
    const fromHash = decodeURIComponent(location.hash.slice(1));
    if (byId(fromHash)) state.selectedId = fromHash;

    render();
    setInterval(render, 30000); // keeps the clock and Open/Closed badges fresh
  }

  init();
})();

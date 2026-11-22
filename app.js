/* My games - static, dependency-free.
 *
 * Card-per-game, mobile first. One card per *game*, not per purchase: a title
 * owned on Steam and available through Game Pass is one card listing both.
 *
 * State lives in the URL hash so any view can be bookmarked or opened on a phone.
 */
(() => {
  'use strict';

  const STORE_CODE = {
    Steam: 'STEAM', Epic: 'EPIC', GOG: 'GOG', 'Ubisoft Connect': 'UPLAY',
    'EA app': 'EA_APP', 'Battle.net': 'BATTLENET', Xbox: 'XBOX', 'Xbox Game Pass': 'XBOX'
  };
  const ROMAN = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', xi: '11', xii: '12' };

  const GFN_RANK = { yes: 0, other: 1, no: 2, na: 3 };
  const SYNC_RANK = { auto: 0, mark: 1, 'claim+mark': 2 };

  const ACCESS_LABEL = {
    owned: 'Owned', gamepass: 'Game Pass', eaplay: 'EA Play',
    ubisoftplus: 'Ubisoft+', shared: 'Family share', unknown: 'Unknown'
  };

  const $ = sel => document.querySelector(sel);
  const asArray = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g,
      c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function normalize(s) {
    return String(s ?? '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(' ')
      .map(w => ROMAN[w] || w)
      .join(' ');
  }

  const fmt = n => new Intl.NumberFormat().format(n);
  const plural = (n, one, many) => `${fmt(n)} ${n === 1 ? one : many}`;

  function ago(iso) {
    if (!iso) return '';
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (!isFinite(days)) return '';
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return plural(days, 'day', 'days') + ' ago';
    if (days < 365) return plural(Math.floor(days / 30), 'month', 'months') + ' ago';
    return plural(Math.floor(days / 365), 'year', 'years') + ' ago';
  }

  // ------------------------------------------------------------------- state

  const state = {
    games: [], gamePass: [], meta: null,
    gfn: 'all', q: '', genre: '', store: '', sort: 'name',
    shown: 0, list: []
  };

  const PAGE = 120;

  function readHash() {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    const gfn = p.get('gfn');
    if (['all', 'yes', 'no'].includes(gfn)) state.gfn = gfn;
    state.q = p.get('q') ? normalize(p.get('q')) : '';
    state.genre = p.get('genre') || '';
    state.stores = new Set((p.get('stores') || '').split(',').filter(Boolean));
    const access = p.get('access');
    state.access = ['owned', 'gp'].includes(access) ? access : 'all';
    if (SORTS[p.get('sort')]) state.sort = p.get('sort');
    else state.sort = 'community';
  }

  function writeHash() {
    const p = new URLSearchParams();
    if (state.gfn !== 'all') p.set('gfn', state.gfn);
    if (state.q) p.set('q', state.q);
    if (state.genre) p.set('genre', state.genre);
    if (state.stores.size) p.set('stores', [...state.stores].join(','));
    if (state.access !== 'all') p.set('access', state.access);
    if (state.sort !== 'community') p.set('sort', state.sort);
    const hash = p.toString();
    history.replaceState(null, '', hash ? '#' + hash : location.pathname);
  }

  // --------------------------------------------------------- merging routes

  function routeRank(e) {
    return (GFN_RANK[e.gfn] ?? 4) * 10 + (SYNC_RANK[e.sync] ?? 3);
  }

  // Data files written before the `sync` field existed: derive it.
  function syncOf(raw) {
    if (raw.sync !== undefined) return raw.sync || null;
    if (raw.gfn !== 'yes') return null;
    const stores = asArray(raw.gfnStores);
    const own = STORE_CODE[raw.store] || 'XBOX';
    if (!stores.includes(own) && stores.includes('EA_APP')) return 'claim+mark';
    if (raw.store === 'Epic') return 'mark';
    return 'auto';
  }

  function buildMerged(library, gamePass) {
    const groups = new Map();

    const add = (raw, kind) => {
      if (!raw) return;
      const key = normalize(raw.name || '');
      if (!key) return;

      let group = groups.get(key);
      if (!group) {
        group = { key, name: raw.name, entries: [] };
        groups.set(key, group);
      }

      const rawStore = raw.store || (kind === 'gp' ? 'Xbox' : '');
      group.entries.push({
        kind,
        store: rawStore === 'Xbox Game Pass' ? 'Xbox' : rawStore,
        access: raw.access || (kind === 'gp' ? 'gamepass' : 'unknown'),
        gfn: raw.gfn || 'na',
        gfnStores: asArray(raw.gfnStores),
        gfnTitle: raw.gfnTitle || null,
        sync: syncOf(raw),
        genres: asArray(raw.genres),
        installed: !!raw.installed,
        favorite: !!raw.favorite,
        hidden: !!raw.hidden,
        critic: raw.criticScore ?? null,
        community: raw.communityScore ?? null,
        links: asArray(raw.links),
        releaseDate: raw.releaseDate || null,
        publisher: raw.publisher || null,
        categories: asArray(raw.genres),
        id: raw.id
      });
    };

    library.forEach(g => add(g, 'lib'));
    gamePass.forEach(g => add(g, 'gp'));

    for (const group of groups.values()) {
      // entitlement flags, before losing routes get dropped
      group.hasGP = group.entries.some(e => e.kind === 'gp');
      group.owned = group.entries.some(e => e.kind === 'lib' && e.access === 'owned');

      const byStore = new Map();
      for (const e of group.entries) {
        const prev = byStore.get(e.store);
        if (!prev || routeRank(e) < routeRank(prev)) byStore.set(e.store, e);
      }

      // A Game Pass entry only counts as a route if it beats what you own.
      const candidates = [...byStore.values()];
      const libRoutes = candidates.filter(e => e.kind === 'lib').sort((a, b) => routeRank(a) - routeRank(b));
      const gpRoutes = candidates.filter(e => e.kind === 'gp').sort((a, b) => routeRank(a) - routeRank(b));
      const bestLib = libRoutes[0] || null;
      const keep = libRoutes.slice();
      for (const gp of gpRoutes) {
        if (!bestLib || routeRank(gp) < routeRank(bestLib)) keep.push(gp);
      }

      group.entries = keep.sort((a, b) => routeRank(a) - routeRank(b));
      group.best = group.entries[0];
      group.gfn = group.best.gfn;
      group.sync = group.best.gfn === 'yes' ? group.best.sync : null;
      group.genres = [...new Set(group.entries.flatMap(e => [...e.genres, ...e.categories]))];
      group.installed = group.entries.some(e => e.installed);
      group.favorite = group.entries.some(e => e.favorite);
      group.hidden = group.entries.every(e => e.hidden);
      group.critic = group.entries.map(e => e.critic).find(v => v != null) ?? null;
      group.community = group.entries.map(e => e.community).find(v => v != null) ?? null;
      group.links = group.entries.map(e => e.links).find(v => v && v.length) || [];
      group.publisher = group.entries.map(e => e.publisher).find(Boolean) || null;
      group.releaseDate = group.entries.map(e => e.releaseDate).find(Boolean) || null;
      group.id = group.best.id;
      group.stores = group.entries.map(e => e.store);
      group.hay = normalize([group.name, ...group.entries.map(e => e.gfnTitle).filter(Boolean)].join(' '));
    }

    return [...groups.values()];
  }

  // ---------------------------------------------------------------- filters

  const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });

  const SORTS = {
    name: byName,
    critic: (a, b) => (b.critic ?? -1) - (a.critic ?? -1) || byName(a, b),
    community: (a, b) => (b.community ?? -1) - (a.community ?? -1) || byName(a, b),
    year: (a, b) => String(b.releaseDate || '').localeCompare(String(a.releaseDate || '')) || byName(a, b)
  };

  function matchesBasics(g, ignore = {}) {
    if (g.hidden) return false;
    if (!ignore.genre && state.genre && !g.genres.includes(state.genre)) return false;
    if (!ignore.stores && state.stores.size && !g.stores.some(s => state.stores.has(s))) return false;
    if (state.access === 'owned' && !g.owned) return false;
    if (state.access === 'gp' && !g.hasGP) return false;
    if (!ignore.q && state.q && !g.hay.includes(state.q)) return false;
    return true;
  }

  function matchesGfn(g) {
    if (state.gfn === 'yes') return g.gfn === 'yes';
    if (state.gfn === 'no') return g.gfn !== 'yes';
    return true;
  }

  function filteredRows() {
    const rows = state.games.filter(g => matchesBasics(g) && matchesGfn(g));
    rows.sort(SORTS[state.sort] || SORTS.name);
    return rows;
  }

  function segmentCounts() {
    const base = state.games.filter(g => matchesBasics(g, { q: false }));
    const yes = base.filter(g => g.gfn === 'yes').length;
    return { all: base.length, yes, no: base.length - yes };
  }

  // ------------------------------------------------------------------ cards

  const LINK_NAMES = {
    Steam: ['steam'], 'itch.io': ['itch'], GOG: ['gog'],
    Epic: ['epic games store', 'epic'], 'Ubisoft Connect': ['ubisoft store', 'uplay'],
    Xbox: ['xbox'], 'EA app': ['ea app', 'origin'], 'Battle.net': ['battle.net']
  };

  function storeLink(g) {
    const links = asArray(g.links);
    if (links.length) {
      const wanted = LINK_NAMES[(g.entries[0] || {}).store] || [];
      const hit = links.find(l => wanted.includes(String(l.name || '').toLowerCase()))
        || links.find(l => String(l.name || '').toLowerCase() === 'official website');
      if (hit) return hit.url;
    }
    // Game Pass titles only have the Microsoft product id - that is enough for a
    // working store page on phone and desktop.
    const gp = g.entries.find(e => e.kind === 'gp' && e.id);
    if (gp) return `https://apps.microsoft.com/detail/${encodeURIComponent(gp.id)}`;
    return null;
  }

  function gfnStatus(g) {
    if (g.gfn === 'yes') return { text: 'On GFN', cls: 'ok' };
    if (g.gfn === 'other') return { text: 'Other store only', cls: 'warn' };
    if (g.gfn === 'na') return { text: 'Not streamable', cls: 'dim' };
    return { text: 'Not on GFN', cls: 'no' };
  }

  const statusChip = (text, cls, title) =>
    `<span class="status ${cls}"${title ? ` title="${esc(title)}"` : ''}><i aria-hidden="true"></i>${text}</span>`;

  function gfnAction(g) {
    if (g.sync === 'claim+mark') return { text: 'EA app first', cls: 'act' };
    if (g.sync === 'mark') return { text: 'mark in GFN', cls: 'act' };
    return null;
  }

  function scoreChip(label, value) {
    if (value == null) return '';
    const band = value >= 85 ? 'good' : value >= 70 ? 'mid' : 'low';
    return `<span class="score ${band}" title="${label} score out of 100"><span class="score-k">${label}</span><b>${value}</b></span>`;
  }

  function card(g) {
    const status = gfnStatus(g);
    const action = gfnAction(g);
    const link = storeLink(g);

    const stores = g.entries.map(e => {
      const label = ACCESS_LABEL[e.access] || e.access;
      const access = e.access && e.access !== 'owned' && label !== e.store
        ? `<span class="access">${esc(label)}</span>` : '';
      const ok = e.gfn === 'yes' ? ' is-ok' : '';
      const title = e.gfn === 'yes' ? `Playable on GFN via ${asArray(e.gfnStores).join(', ')}`
        : e.gfn === 'other' ? 'On GeForce NOW for another store only'
          : e.gfn === 'no' ? 'Not on GeForce NOW' : 'Not streamable';
      return `<span class="store${ok}" title="${esc(title)}">${esc(e.store)}${access}</span>`;
    }).join('');

    const facts = [];
    if (g.releaseDate) facts.push(String(g.releaseDate).slice(0, 4));

    const scores = [scoreChip('Critics', g.critic), scoreChip('Community', g.community)].join('');

    const href = storeLink(g);
    const open = href
      ? `<a class="card" href="${esc(href)}" target="_blank" rel="noopener">`
      : '<article class="card">';

    return `${open}
      <h2 class="title">${esc(g.name)}</h2>

      <div class="row split">
        <div class="stores">${stores}</div>
        ${scores ? `<div class="scores">${scores}</div>` : ''}
      </div>

      <div class="row split">
        <div class="statuses">
          ${statusChip(status.text, status.cls)}
          ${action ? statusChip(action.text, 'act', g.sync === 'claim+mark'
            ? 'Add it in the EA app, then mark it as owned in GeForce NOW'
            : 'Epic has no library sync in GeForce NOW: mark it as owned there') : ''}
        </div>
        <div class="facts">
          ${facts.map(esc).join(' · ')}
          ${g.installed ? '<span class="pill">installed</span>' : ''}
          ${g.favorite ? '<span class="pill fav" title="Favourite">★</span>' : ''}
        </div>
      </div>
    ${href ? '</a>' : '</article>'}`;
  }

  // ----------------------------------------------------------------- render

  function renderMore() {
    const slice = state.list.slice(state.shown, state.shown + PAGE);
    if (!slice.length) return;
    $('#cards').insertAdjacentHTML('beforeend', slice.map(card).join(''));
    state.shown += slice.length;
    const sentinel = $('#sentinel');
    if (sentinel) sentinel.hidden = state.shown >= state.list.length;
    else $('#cards').insertAdjacentHTML('beforeend', '<div id="sentinel"></div>');
  }

  let observer = null;

  function watchSentinel() {
    if (!('IntersectionObserver' in window)) {
      // no observer: just render everything
      while (state.shown < state.list.length) renderMore();
      return;
    }
    if (!observer) {
      observer = new IntersectionObserver(entries => {
        if (entries.some(e => e.isIntersecting)) {
          renderMore();
          watchSentinel();
        }
      }, { rootMargin: '600px' });
    }
    const sentinel = $('#sentinel');
    if (sentinel) { observer.disconnect(); observer.observe(sentinel); }
  }

  function render() {
    state.list = filteredRows();
    state.shown = 0;
    $('#cards').innerHTML = '';
    renderMore();
    watchSentinel();

    $('#count').textContent = state.list.length === state.games.filter(g => !g.hidden).length
      ? plural(state.list.length, 'game', 'games')
      : `${fmt(state.list.length)} of ${fmt(state.games.filter(g => !g.hidden).length)} games`;

    $('#empty').hidden = state.list.length > 0;

    const counts = segmentCounts();
    document.querySelectorAll('.seg').forEach(seg => {
      seg.classList.toggle('is-active', seg.dataset.gfn === state.gfn);
      seg.querySelector('.n').textContent = fmt(counts[seg.dataset.gfn]);
    });

    // recovery: matches exist, but the filters hide them
    const note = $('#note');
    const hiddenBy = state.q ? state.games.filter(g => matchesBasics(g, { q: false, genre: false, store: false }) && !matchesGfn(g)) : [];
    if (state.list.length === 0 && hiddenBy.length) {
      note.hidden = false;
      note.innerHTML = `${plural(hiddenBy.length, 'match', 'matches')} hidden by the current filter`;
    } else {
      note.hidden = true;
    }

    writeHash();
  }

  function renderControls() {
    const genres = new Map();
    const stores = new Map();
    for (const g of state.games) {
      if (g.hidden) continue;
      for (const genre of g.genres) genres.set(genre, (genres.get(genre) || 0) + 1);
      for (const s of g.stores) stores.set(s, (stores.get(s) || 0) + 1);
    }
    const alpha = (a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' });

    $('#genre').innerHTML = '<option value="">All genres</option>' +
      [...genres.entries()].sort(alpha)
        .map(([n, c]) => `<option value="${esc(n)}"${n === state.genre ? ' selected' : ''}>${esc(n)} (${c})</option>`).join('');

    $('#stores-list').innerHTML = [...stores.entries()].sort(alpha).map(([name, count]) => {
      const on = state.stores.has(name);
      return `<label class="opt">
        <input type="checkbox" value="${esc(name)}" ${on ? 'checked' : ''}>
        <span class="opt-name">${esc(name)}</span>
        <span class="opt-count">${fmt(count)}</span>
      </label>`;
    }).join('');

    syncFilterUI();
  }

  function syncFilterUI() {
    const btn = $('#stores-btn');
    btn.classList.toggle('is-on', state.stores.size > 0);
    btn.querySelector('.menu-count').textContent = state.stores.size ? `(${state.stores.size})` : '';
    $('#access').value = state.access;
    renderChips();
  }

  function renderChips() {
    const chips = [];
    for (const s of [...state.stores].sort((a, b) => a.localeCompare(b))) {
      chips.push(`<button class="chip" data-clear-store="${esc(s)}">${esc(s)} <span aria-hidden="true">×</span></button>`);
    }
    if (state.access !== 'all') {
      chips.push(`<button class="chip" data-clear-access="1">${state.access === 'gp' ? 'On Game Pass' : 'Owned'} <span aria-hidden="true">×</span></button>`);
    }
    if (state.genre) {
      chips.push(`<button class="chip" data-clear-genre="1">${esc(state.genre)} <span aria-hidden="true">×</span></button>`);
    }
    const el = $('#chips');
    el.hidden = chips.length === 0;
    el.innerHTML = chips.length
      ? chips.join('') + '<button class="chip chip-clear" data-clear-all="1">Clear all</button>'
      : '';
  }

  function bind() {
    $('#q').addEventListener('input', e => {
      state.q = normalize(e.target.value);
      clearTimeout(bind._t);
      bind._t = setTimeout(() => { render(); if (window.scrollY > 0) window.scrollTo(0, 0); }, 90);
    });

    document.querySelector('.segments').addEventListener('click', e => {
      const seg = e.target.closest('[data-gfn]');
      if (!seg || seg.dataset.gfn === state.gfn) return;
      state.gfn = seg.dataset.gfn;
      render();
    });

    $('#genre').addEventListener('change', e => { state.genre = e.target.value; syncFilterUI(); render(); });
    $('#access').addEventListener('change', e => { state.access = e.target.value; syncFilterUI(); render(); });

    const pop = $('.menu-pop');
    const menuBtn = $('#stores-btn');
    const closeMenu = () => { pop.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); };

    menuBtn.addEventListener('click', e => {
      e.stopPropagation();
      pop.hidden = !pop.hidden;
      menuBtn.setAttribute('aria-expanded', String(!pop.hidden));
    });

    pop.addEventListener('click', e => {
      e.stopPropagation();
      const action = e.target.closest('[data-stores]');
      if (action) {
        const every = [...pop.querySelectorAll('input[type=checkbox]')].map(i => i.value);
        state.stores = new Set(action.dataset.stores === 'all' ? every : []);
        for (const box of pop.querySelectorAll('input[type=checkbox]')) {
          box.checked = state.stores.has(box.value);
        }
        syncFilterUI();
        render();
        return;
      }
      const box = e.target.closest('input[type=checkbox]');
      if (box) {
        box.checked ? state.stores.add(box.value) : state.stores.delete(box.value);
        syncFilterUI();
        render();
      }
    });

    document.addEventListener('click', closeMenu);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });

    $('#chips').addEventListener('click', e => {
      const chip = e.target.closest('button');
      if (!chip) return;
      if (chip.dataset.clearStore !== undefined) state.stores.delete(chip.dataset.clearStore);
      else if (chip.dataset.clearAccess) state.access = 'all';
      else if (chip.dataset.clearGenre) state.genre = '';
      else if (chip.dataset.clearAll) { state.stores = new Set(); state.access = 'all'; state.genre = ''; }
      renderControls(); render();
    });
    $('#sort').addEventListener('change', e => { state.sort = e.target.value; render(); });

    document.addEventListener('keydown', e => {
      if (e.key === '/' && document.activeElement !== $('#q')) { e.preventDefault(); $('#q').focus(); }
      if (e.key === 'Escape' && document.activeElement === $('#q')) {
        $('#q').value = ''; state.q = ''; render(); $('#q').blur();
      }
    });
  }

  // -------------------------------------------------------------------- boot

  async function boot() {
    const res = await fetch('data/games.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`data/games.json: HTTP ${res.status}`);
    const data = await res.json();

    state.meta = data;
    state.gamePass = data.gamePass || [];
    state.games = buildMerged(data.games || [], data.gamePass || []);

    readHash();

    const visible = state.games.filter(g => !g.hidden);
    const tv = visible.filter(g => g.gfn === 'yes').length;
    const never = visible.filter(g => g.gfn === 'na').length;
    $('#summary').textContent = `${fmt(visible.length)} games · ${fmt(tv)} on GeForce NOW`;

    $('#meta').textContent = `Updated ${ago(data.generatedAt)}` +
      (data.catalog ? ` · GeForce NOW ${data.catalog.country}, ${fmt(data.catalog.titles)} titles` : '') +
      (never ? ` · ${fmt(never)} from stores GFN never supports` : '');

    $('#q').value = state.q;
    bind();
    renderControls();
    render();
  }

  boot().catch(err => {
    $('#summary').textContent = 'Could not load data';
    $('#empty').textContent = err.message;
    $('#empty').hidden = false;
    console.error(err);
  });
})();

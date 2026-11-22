/* My games - static, dependency-free.
 *
 * Data: data/games.json, written by the Playnite "Collection publisher" extension.
 * One row per *game*, not per purchase: a game owned on Steam and available via
 * Game Pass is one line listing both routes.
 *
 * State lives in the URL hash so any view can be bookmarked or opened on a phone.
 */
(() => {
  'use strict';

  // GeForce NOW has 7 store connectors and not all of them sync by themselves.
  // NVIDIA does not publish per-store behaviour, so the only thing we can state
  // as a fact is the EA Play case: a Game Pass EA game has no licence in your EA
  // account until you add it in the EA app - that is blocking, everything else
  // is "if it does not show up, use Mark as owned".
  const SYNC_RANK = { auto: 0, mark: 1, 'claim+mark': 2 };
  // From the GFN "Game store accounts" screen: Steam/Ubisoft/Battle.net/GOG/Xbox
  // report "N games synced"; Epic reports "Game library sync - Not supported".
  const SYNC_BADGE = {
    'mark': { label: 'mark in GFN', cls: 'b-mark', title: 'Epic has no library sync in GeForce NOW: open the game in GFN and choose Mark as owned.' },
    'claim+mark': { label: 'EA app first', cls: 'b-claim', title: 'A Game Pass EA Play game has no licence in your EA account yet: add it in the EA app, then mark it as owned in GFN.' }
  };

  const GFN_ORDER = { yes: 0, other: 1, no: 2, na: 3 };
  const GFN_LABEL = { yes: 'playable', other: 'other store', no: 'not on GFN', na: 'not streamable' };
  const ACCESS_LABEL = {
    owned: 'Owned', gamepass: 'Game Pass', eaplay: 'EA Play',
    ubisoftplus: 'Ubisoft+', shared: 'Family share', unknown: 'Unknown'
  };
  const STORE_CODE = {
    Steam: 'STEAM', Epic: 'EPIC', GOG: 'GOG', 'Ubisoft Connect': 'UPLAY',
    'EA app': 'EA_APP', 'Battle.net': 'BATTLENET', Xbox: 'XBOX', 'Xbox Game Pass': 'XBOX'
  };
  const ROMAN = { ii: '2', iii: '3', iv: '4', v: '5', vi: '6', vii: '7', viii: '8', ix: '9', xi: '11', xii: '12' };

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

  function playtime(minutes) {
    if (!minutes) return '';
    if (minutes < 60) return minutes + ' min';
    const h = minutes / 60;
    return (h < 10 ? h.toFixed(1) : Math.round(h)) + ' h';
  }

  function ago(iso) {
    if (!iso) return '';
    const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
    if (!isFinite(days)) return '';
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return days + ' days ago';
    if (days < 365) return Math.floor(days / 30) + ' months ago';
    return Math.floor(days / 365) + ' years ago';
  }

  // ------------------------------------------------------------------- state

  const state = {
    data: null,
    games: [],        // merged: one per title, entries[] are the routes you have
    gamePass: [],     // raw catalogue
    gfn: 'all', q: '', genre: '', store: '', sort: 'name', dir: 'asc',
    expanded: new Set()
  };

  function readHash() {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    const gfn = p.get('gfn');
    if (['all', 'yes', 'no'].includes(gfn)) state.gfn = gfn;
    state.q = p.get('q') ? normalize(p.get('q')) : '';
    state.genre = p.get('genre') || '';
    state.store = p.get('store') || '';
    state.sort = p.get('sort') || 'name';
    state.dir = p.get('dir') === 'desc' ? 'desc' : 'asc';
  }

  function writeHash() {
    const p = new URLSearchParams();
    if (state.gfn !== 'all') p.set('gfn', state.gfn);
    if (state.q) p.set('q', state.q);
    if (state.genre) p.set('genre', state.genre);
    if (state.store) p.set('store', state.store);
    if (state.sort !== 'name') p.set('sort', state.sort);
    if (state.dir !== 'asc') p.set('dir', 'desc');
    const hash = p.toString();
    history.replaceState(null, '', hash ? '#' + hash : location.pathname);
  }

  // -------------------------------------------------------- merging routes

  function routeRank(e) {
    return (GFN_ORDER[e.gfn] ?? 4) * 10 + (SYNC_RANK[e.sync] ?? 3);
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
      const name = raw.name || '';
      const key = normalize(name);
      if (!key) return;

      let group = groups.get(key);
      if (!group) {
        group = { key, name, entries: [] };
        groups.set(key, group);
      }

      group.entries.push({
        kind,                                   // 'lib' | 'gp'
        store: raw.store || (kind === 'gp' ? 'Game Pass' : ''),
        access: raw.access || (kind === 'gp' ? 'gamepass' : 'unknown'),
        gfn: raw.gfn || 'na',
        gfnStores: asArray(raw.gfnStores),
        gfnTitle: raw.gfnTitle || null,
        sync: syncOf(raw),
        genres: asArray(raw.genres),
        playtime: raw.playtime || 0,
        lastPlayed: raw.lastPlayed || null,
        installed: !!raw.installed,
        favorite: !!raw.favorite,
        hidden: !!raw.hidden,
        publisher: raw.publisher || null,
        releaseDate: raw.releaseDate || null,
        id: raw.id,
        critic: raw.criticScore ?? null,
        community: raw.communityScore ?? null,
        links: asArray(raw.links)
      });
    };

    library.forEach(g => add(g, 'lib'));
    gamePass.forEach(g => add(g, 'gp'));

    for (const group of groups.values()) {
      // one route per store, keep the best one (Playnite can hold duplicates)
      const byStore = new Map();
      for (const e of group.entries) {
        const prev = byStore.get(e.store);
        if (!prev || routeRank(e) < routeRank(prev)) byStore.set(e.store, e);
      }
      group.entries = [...byStore.values()].sort((a, b) => routeRank(a) - routeRank(b));
      group.best = group.entries[0];
      group.stores = group.entries.map(e => e.store);

      group.gfn = group.best.gfn;
      group.sync = group.best.gfn === 'yes' ? group.best.sync : null;
      group.genres = [...new Set(group.entries.flatMap(e => e.genres))];
      group.playtime = Math.max(...group.entries.map(e => e.playtime || 0));
      group.lastPlayed = group.entries.map(e => e.lastPlayed).filter(Boolean).sort().pop() || null;
      group.installed = group.entries.some(e => e.installed);
      group.favorite = group.entries.some(e => e.favorite);
      group.hidden = group.entries.every(e => e.hidden);
      group.publisher = group.entries.map(e => e.publisher).filter(Boolean)[0] || null;
      group.critic = group.entries.map(e => e.critic).find(v => v != null) ?? null;
      group.community = group.entries.map(e => e.community).find(v => v != null) ?? null;
      group.links = group.entries.map(e => e.links).find(v => v && v.length) || [];
      group.id = group.best.id;

      group.hay = normalize([
        group.name,
        ...group.entries.map(e => e.gfnTitle).filter(Boolean)
      ].join(' '));
    }

    return [...groups.values()];
  }

  // -------------------------------------------------------------------- list

  const SORT_VALUE = {
    name: g => (g.name || '').toLowerCase(),
    store: g => (g.stores || []).join(' ').toLowerCase(),
    gfn: g => GFN_ORDER[g.gfn] ?? 9,
    critic: g => (g.critic == null ? -1 : g.critic),
    community: g => (g.community == null ? -1 : g.community)
  };
  const NUMERIC = new Set(['critic', 'community', 'gfn']);

  function matchesBasics(g) {
    if (g.hidden) return false;
    if (state.genre && !(g.genres || []).includes(state.genre)) return false;
    if (state.store && !(g.stores || []).includes(state.store)) return false;
    if (state.q && !g.hay.includes(state.q)) return false;
    return true;
  }

  function matchesGfn(g) {
    if (state.gfn === 'yes') return g.gfn === 'yes';
    if (state.gfn === 'no') return g.gfn !== 'yes';
    return true;
  }

  function filteredRows() {
    let rows = state.games.filter(g => matchesBasics(g) && matchesGfn(g));

    const key = SORT_VALUE[state.sort] || SORT_VALUE.name;
    const dir = state.dir === 'desc' ? -1 : 1;
    rows = rows.slice().sort((a, b) => {
      const av = key(a), bv = key(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });

    if (state.gfn === 'yes') {
      const rank = g => (g.sync === 'claim+mark' ? 0 : 1);
      rows = rows.slice().sort((a, b) => rank(a) - rank(b));
    }
    return rows;
  }

  function segmentCounts() {
    const base = state.games.filter(matchesBasics);
    const yes = base.filter(g => g.gfn === 'yes').length;
    return { all: base.length, yes, no: base.length - yes };
  }

  // ------------------------------------------------------------------ render

  const LINK_NAMES = {
    Steam: ['steam'], 'itch.io': ['itch'], GOG: ['gog'],
    Epic: ['epic games store', 'epic'], 'Ubisoft Connect': ['ubisoft store', 'uplay'],
    Xbox: ['xbox'], 'EA app': ['ea app', 'origin'], 'Battle.net': ['battle.net']
  };

  function storeLink(g) {
    const links = asArray(g.links);
    if (!links.length) return null;
    const wanted = LINK_NAMES[(g.entries[0] || {}).store] || [];
    const hit = links.find(l => wanted.includes(String(l.name || '').toLowerCase()))
      || links.find(l => String(l.name || '').toLowerCase() === 'official website');
    return hit ? hit.url : null;
  }

  function gfnBadge(g) {
    const status = g.gfn || 'na';
    const stores = asArray(g.entries[0]?.gfnStores);
    const label = status === 'yes' ? 'GFN' : status === 'other' ? 'GFN*' : status === 'no' ? '—' : 'n/a';
    const title = status === 'yes'
      ? `Playable on GeForce NOW via ${stores.join(', ') || 'streaming'}`
      : status === 'other'
        ? `On GeForce NOW only for ${stores.join(', ')} - not the store you have`
        : status === 'no' ? 'Not on GeForce NOW' : 'This store cannot be streamed';
    return `<span class="badge b-${status}" title="${esc(title)}">${label}</span>`;
  }

  function syncBadge(g) {
    const info = SYNC_BADGE[g.sync];
    return info ? `<span class="badge ${info.cls}" title="${esc(info.title)}">${esc(info.label)}</span>` : '';
  }

  function storeCell(g) {
    return asArray(g.stores).map(store => {
      const entry = (g.entries || []).find(e => e.store === store) || {};
      const label = ACCESS_LABEL[entry.access] || entry.access;
      const access = entry.access && entry.access !== 'owned' && label !== store
        ? `<span class="access">${esc(label)}</span>` : '';
      const ok = entry.gfn === 'yes' ? ' is-ok' : '';
      const title = entry.gfn === 'yes' ? `Playable on GFN via ${asArray(entry.gfnStores).join(', ')}`
        : entry.gfn === 'other' ? 'On GFN for another store only'
          : entry.gfn === 'no' ? 'Not on GFN' : 'Not streamable';
      return `<span class="store${ok}" title="${esc(title)}">${esc(store)}${access}</span>`;
    }).join('<span class="sep"> · </span>');
  }

  function row(g) {
    const pills = [];
    if (g.installed) pills.push('<span class="pill">installed</span>');
    if (g.favorite) pills.push('<span class="pill fav" title="Favourite">★</span>');
    const link = storeLink(g);

    return `<tr class="game">
      <td class="col-name"><span class="name">${esc(g.name)}</span>${pills.join('')}</td>
      <td class="col-stores">${storeCell(g)}</td>
      <td class="col-gfn">${gfnBadge(g)}${syncBadge(g)}</td>
      <td class="col-score num">${g.critic == null ? '<span class="dim">–</span>' : g.critic}</td>
      <td class="col-score num">${g.community == null ? '<span class="dim">–</span>' : g.community}</td>
      <td class="col-link">${link ? `<a href="${esc(link)}" target="_blank" rel="noopener" title="Open store page">↗</a>` : ''}</td>
    </tr>`;
  }

  function sortIndicator(key) {
    if (state.sort !== key) return '';
    return state.dir === 'desc' ? '▼' : '▲';
  }

  function renderList() {
    const rows = filteredRows();
    $('#rows').innerHTML = rows.map(row).join('');
    $('#empty').hidden = rows.length > 0;
    $('#count').textContent = `${fmt(rows.length)} games`;

    const counts = segmentCounts();
    document.querySelectorAll('.seg').forEach(seg => {
      seg.classList.toggle('is-active', seg.dataset.gfn === state.gfn);
      seg.querySelector('.n').textContent = fmt(counts[seg.dataset.gfn]);
    });

    document.querySelectorAll('th button[data-sort]').forEach(btn => {
      const key = btn.dataset.sort;
      btn.classList.toggle('sorted', state.sort === key);
      btn.dataset.ind = sortIndicator(key);
    });

    const hint = $('#hint');
    if (state.gfn === 'yes') {
      hint.hidden = false;
      hint.innerHTML = 'Steam, Ubisoft, Battle.net, GOG and Xbox sync by themselves. <strong>Epic has no library sync</strong> in GeForce NOW ' +
        '(NVIDIA: "Game library sync - Not supported"), so open the game in GFN and choose <strong>Mark as owned</strong>. ' +
        'EA Play games from Game Pass need the EA app first, then that same mark.';
    } else {
      hint.hidden = true;
    }

    if (state.q && window.scrollY > 0) window.scrollTo(0, 0);
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

    $('#store').innerHTML = '<option value="">All stores</option>' +
      [...stores.entries()].sort(alpha)
        .map(([n, c]) => `<option value="${esc(n)}"${n === state.store ? ' selected' : ''}>${esc(n)} (${c})</option>`).join('');
  }

  function renderVerdict() {
    const el = $('#verdict');
    if (!state.q) { el.innerHTML = ''; return; }

    const hits = state.games.filter(g => g.hay.includes(state.q));
    if (!hits.length) {
      el.className = 'verdict bad';
      el.textContent = 'Not in your collection, and not in PC Game Pass.';
      return;
    }

    const g = hits.find(x => normalize(x.name) === state.q)
      || hits.find(x => normalize(x.name).startsWith(state.q + ' '))
      || hits.slice().sort((a, b) => a.name.length - b.name.length)[0];

    const routes = g.entries.map(e => {
      const label = ACCESS_LABEL[e.access] || e.access;
      const acc = e.access && e.access !== 'owned' && label !== e.store ? ` (${label})` : '';
      return `${e.store}${acc}`;
    }).join(' + ');

    let tail;
    if (g.gfn === 'yes') {
      const via = asArray(g.entries[0].gfnStores).join(', ');
      tail = g.sync === 'claim+mark'
        ? 'playable on GeForce NOW, but two steps: add it in the EA app, then mark it as owned in GFN'
        : g.sync === 'mark'
          ? 'playable on GeForce NOW - mark it as owned once in GFN'
          : `playable on GeForce NOW (${via})`;
    } else if (g.gfn === 'other') {
      tail = `not playable on GeForce NOW (GFN has it only for ${asArray(g.entries[0].gfnStores).join(', ')})`;
    } else if (g.gfn === 'na') {
      tail = 'not streamable';
    } else {
      tail = 'not playable on GeForce NOW';
    }

    el.className = 'verdict ' + (g.gfn === 'yes' && g.sync === 'auto' ? 'ok' : g.gfn === 'yes' ? 'warn' : 'neutral');
    el.textContent = `${g.name} - you have it on ${routes} - ${tail}`;
  }

  function render() {
    renderVerdict();
    renderList();
  }

  // ------------------------------------------------------------------ events

  function bind() {
    $('#q').addEventListener('input', e => {
      state.q = normalize(e.target.value);
      clearTimeout(bind._t);
      bind._t = setTimeout(render, 80);
    });

    document.querySelector('.segments').addEventListener('click', e => {
      const seg = e.target.closest('[data-gfn]');
      if (!seg || seg.dataset.gfn === state.gfn) return;
      state.gfn = seg.dataset.gfn;
      render();
    });

    $('#genre').addEventListener('change', e => { state.genre = e.target.value; render(); });
    $('#store').addEventListener('change', e => { state.store = e.target.value; render(); });

    document.querySelector('table.games thead').addEventListener('click', e => {
      const btn = e.target.closest('button[data-sort]');
      if (!btn) return;
      const key = btn.dataset.sort;
      if (state.sort === key) {
        state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort = key;
        // numbers are more useful high-first, text A-Z
        state.dir = NUMERIC.has(key) ? 'desc' : 'asc';
      }
      render();
    });

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

    state.data = data;
    state.gamePass = (data.gamePass || []).map(g => ({ ...g, __hay: normalize(g.name) }));
    state.games = buildMerged(data.games || [], data.gamePass || []);

    readHash();

    const visible = state.games.filter(g => !g.hidden);
    const tv = visible.filter(g => g.gfn === 'yes').length;
    const laptop = visible.filter(g => g.gfn !== 'yes').length;
    const never = visible.filter(g => g.gfn === 'na').length;
    $('#summary').textContent =
      `${fmt(visible.length)} games - ${fmt(tv)} on the TV - ${fmt(laptop)} laptop only` +
      (never ? ` (${fmt(never)} from stores GeForce NOW never supports)` : '');

    $('#meta').textContent = `Updated ${ago(data.generatedAt)}` +
      (data.catalog ? ` - GeForce NOW ${data.catalog.country}, ${fmt(data.catalog.titles)} titles` : '');

    $('#q').value = state.q;
    bind();
    renderControls();
    render();
  }

  boot().catch(err => {
    $('#summary').textContent = 'Could not load data';
    $('#list').innerHTML = `<li class="empty">${esc(err.message)}</li>`;
    console.error(err);
  });
})();

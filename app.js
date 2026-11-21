/* My games - static, dependency-free.
 *
 * Data: data/games.json, written by the Playnite "Collection publisher" extension.
 * State: the URL hash, so any view can be bookmarked/shared (phone included).
 */
(() => {
  'use strict';

  const GFN_ORDER = { yes: 0, other: 1, no: 2, na: 3 };
  const GFN_LABEL = {
    yes: 'GeForce NOW',
    other: 'GFN, other store only',
    no: 'No GeForce NOW',
    na: 'Not streamable'
  };
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
    data: null, games: [], gamePass: [],
    view: 'all', q: '', genre: '', store: '', sort: 'name',
    expanded: new Set()
  };

  function readHash() {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    const view = p.get('view');
    if (['all', 'tv', 'laptop', 'gamepass'].includes(view)) state.view = view;
    state.q = p.get('q') ? normalize(p.get('q')) : '';
    state.genre = p.get('genre') || '';
    state.store = p.get('store') || '';
    state.sort = p.get('sort') || 'name';
  }

  function writeHash() {
    const p = new URLSearchParams();
    if (state.view !== 'all') p.set('view', state.view);
    if (state.q) p.set('q', state.q);
    if (state.genre) p.set('genre', state.genre);
    if (state.store) p.set('store', state.store);
    if (state.sort !== 'name') p.set('sort', state.sort);
    const hash = p.toString();
    history.replaceState(null, '', hash ? '#' + hash : location.pathname);
  }

  // ------------------------------------------------------------------- rows

  function prepare(games) {
    for (const g of games) {
      if (!g.id) g.id = 'gp:' + g.name;
      g.__hay = normalize([g.name, g.sortName, g.series, g.gfnTitle].filter(Boolean).join(' '));
      g.__gfn = g.gfn || 'na';
      if (g.needsClaim === undefined) {
        // Older data files do not carry the flag. GFN only lists an EA Play title
        // once it is in your EA library, and Game Pass titles run through the Xbox
        // app - so an EA-only match means it needs claiming.
        const stores = asArray(g.gfnStores);
        const own = STORE_CODE[g.store] || 'XBOX';
        g.needsClaim = g.__gfn === 'yes' && stores.includes('EA_APP') && !stores.includes(own);
        g.claimVia = g.needsClaim ? 'EA app' : null;
      }
    }
  }

  function baseRows() {
    const visible = g => !g.hidden;
    switch (state.view) {
      case 'tv': return state.games.filter(g => visible(g) && g.__gfn === 'yes');
      case 'laptop': return state.games.filter(g => visible(g) && (g.__gfn === 'no' || g.__gfn === 'other'));
      case 'gamepass': return state.gamePass;
      default: return state.games.filter(visible);
    }
  }

  function filteredRows() {
    let rows = baseRows();
    const onLibraryView = state.view !== 'gamepass';

    if (onLibraryView && state.genre) rows = rows.filter(g => asArray(g.genres).includes(state.genre));
    if (onLibraryView && state.store) rows = rows.filter(g => g.store === state.store);
    if (state.q) rows = rows.filter(g => (g.__hay || '').includes(state.q));

    const dir = 1;
    if (state.sort === 'playtime') {
      rows.sort((a, b) => (b.playtime || 0) - (a.playtime || 0));
    } else if (state.sort === 'recent') {
      rows.sort((a, b) => String(b.lastPlayed || '').localeCompare(String(a.lastPlayed || '')));
    } else {
      rows.sort((a, b) => (a.sortName || a.name).localeCompare(b.sortName || b.name) * dir);
    }

    // In "Play on the TV", games that need a claim come first - they're the
    // actionable ones (you can't see them in GFN until you add them).
    if (state.view === 'tv') {
      rows.sort((a, b) => Number(!!b.needsClaim) - Number(!!a.needsClaim));
    }
    return rows;
  }

  // ------------------------------------------------------------------ render

  function gfnBadge(g) {
    const stores = asArray(g.gfnStores);
    const label = g.__gfn === 'yes' ? 'GFN' : g.__gfn === 'other' ? 'GFN*' : g.__gfn === 'no' ? '—' : 'n/a';
    const title = g.__gfn === 'yes'
      ? `Playable on GeForce NOW via ${stores.join(', ') || 'streaming'}`
      : g.__gfn === 'other'
        ? `On GeForce NOW only for ${stores.join(', ')} - not the store you have`
        : g.__gfn === 'no' ? 'Not on GeForce NOW' : 'This store cannot be streamed';
    return `<span class="badge b-${g.__gfn}" title="${esc(title)}">${label}</span>`;
  }

  function syncBadge(g) {
    if (!g.needsClaim) return '';
    const via = g.claimVia || 'the launcher';
    return `<span class="badge b-claim" title="GeForce NOW only lists it once it is in your ${esc(via)} library">not synced</span>`;
  }

  function storeCell(g) {
    const store = g.store || (state.view === 'gamepass' ? 'Game Pass' : '');
    const access = g.access && g.access !== 'owned'
      ? `<span class="access">${esc(ACCESS_LABEL[g.access] || g.access)}</span>` : '';
    return `<span class="store">${esc(store)}</span>${access}`;
  }

  function details(g) {
    const bits = [];
    const add = (k, v) => { if (v) bits.push(`<div><span class="k">${k}</span>${v}</div>`); };

    if (g.needsClaim) {
      add('Heads up', `GeForce NOW only sees this once it is in your ${esc(g.claimVia || 'launcher')} library. Add it there, then it shows up in GFN.`);
    }
    if (g.__gfn === 'other') {
      add('GFN stores', esc(asArray(g.gfnStores).join(', ')) + ' - not the one you have');
    }
    if (g.gfnTitle && g.gfnTitle !== g.name) add('GFN lists it as', esc(g.gfnTitle));
    add('Genre', esc(asArray(g.genres).join(', ')));
    add('Developer', esc(asArray(g.developers).join(', ')));
    add('Publisher', esc(asArray(g.publishers).join(', ')));
    add('Released', esc(g.releaseDate));
    add('Played', g.playtime ? `${playtime(g.playtime)}${g.lastPlayed ? ' - last ' + esc(ago(g.lastPlayed)) : ''}` : '');
    add('Status', esc(g.completion));
    add('Tags', esc(asArray(g.tags).join(', ')));

    return `<li class="detail"><div>${bits.join('') || '<em>No extra details.</em>'}</div></li>`;
  }

  function row(g) {
    const open = state.expanded.has(g.id);
    const pills = [];
    if (g.installed) pills.push('<span class="pill">installed</span>');
    if (g.favorite) pills.push('<span class="pill fav" title="Favourite">★</span>');

    const html = `<li class="game${open ? ' is-open' : ''}" data-id="${esc(g.id)}" tabindex="0">
      <span class="name">${esc(g.name)}${pills.join('')}</span>
      <span class="store-cell">${storeCell(g)}</span>
      <span class="gfn-cell">${gfnBadge(g)}${syncBadge(g)}</span>
    </li>`;
    return open ? html + details(g) : html;
  }

  function renderList() {
    const rows = filteredRows();
    const out = [];
    let lastGroup = null;

    if (state.view === 'tv') {
      for (const g of rows) {
        const group = g.needsClaim ? 'claim' : 'ready';
        if (group !== lastGroup) {
          lastGroup = group;
          out.push(`<li class="section">${group === 'claim'
            ? `Add these in ${esc(rows.find(x => x.needsClaim).claimVia || 'the launcher')} first`
            : 'Ready to play'}</li>`);
        }
        out.push(row(g));
      }
    } else {
      for (const g of rows) out.push(row(g));
    }

    $('#list').innerHTML = out.join('');
    $('#empty').hidden = rows.length > 0;
    $('#count').textContent = `${fmt(rows.length)} ${state.view === 'gamepass' ? 'Game Pass titles' : 'games'}`;

    document.querySelectorAll('.tab').forEach(t =>
      t.classList.toggle('is-active', t.dataset.view === state.view));

    const libraryView = state.view !== 'gamepass';
    $('#genre').style.display = libraryView ? '' : 'none';
    $('#store').style.display = libraryView ? '' : 'none';

    writeHash();
  }

  function renderControls() {
    const genres = new Map();
    const stores = new Map();
    for (const g of state.games) {
      if (g.hidden) continue;
      for (const genre of asArray(g.genres)) genres.set(genre, (genres.get(genre) || 0) + 1);
      if (g.store) stores.set(g.store, (stores.get(g.store) || 0) + 1);
    }

    const genreSel = $('#genre');
    genreSel.innerHTML = '<option value="">All genres</option>' +
      [...genres.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)
        .map(([n, c]) => `<option value="${esc(n)}"${n === state.genre ? ' selected' : ''}>${esc(n)} (${c})</option>`).join('');

    const storeSel = $('#store');
    storeSel.innerHTML = '<option value="">All stores</option>' +
      [...stores.entries()].sort((a, b) => b[1] - a[1])
        .map(([n, c]) => `<option value="${esc(n)}"${n === state.store ? ' selected' : ''}>${esc(n)} (${c})</option>`).join('');

    $('#sort').value = state.sort;
  }

  function renderVerdict() {
    const el = $('#verdict');
    if (!state.q) { el.innerHTML = ''; return; }

    const pick = hits =>
      hits.find(g => normalize(g.name) === state.q) ||
      hits.find(g => normalize(g.name).startsWith(state.q + ' ')) ||
      hits.slice().sort((a, b) => a.name.length - b.name.length)[0];

    const libHits = state.games.filter(g => (g.__hay || '').includes(state.q));
    const gpHits = state.gamePass.filter(g => (g.__hay || '').includes(state.q));

    let text, cls;
    if (libHits.length) {
      const g = pick(libHits);
      const where = g.store ? ` on ${g.store}` : '';
      const access = g.access && g.access !== 'owned' ? ` (${ACCESS_LABEL[g.access] || g.access})` : '';
      const gfn = g.__gfn === 'yes'
        ? (g.needsClaim
            ? `playable on GeForce NOW - but not synced: add it in ${g.claimVia || 'the launcher'} first`
            : 'playable on GeForce NOW')
        : g.__gfn === 'other'
          ? `on GeForce NOW only for ${asArray(g.gfnStores).join(', ')}`
          : g.__gfn === 'na' ? 'this store cannot be streamed' : 'not playable on GeForce NOW';
      const gpOther = gpHits.filter(x => normalize(x.name) !== normalize(g.name));
      const extra = gpOther.length ? ` - also in Game Pass: ${gpOther.slice(0, 2).map(x => x.name).join(', ')}` : '';
      text = `${g.name} - you have it${where}${access} - ${gfn}${extra}`;
      cls = g.__gfn === 'yes' && !g.needsClaim ? 'ok' : g.__gfn === 'other' || g.needsClaim ? 'warn' : 'neutral';
    } else if (gpHits.length) {
      const g = pick(gpHits);
      const gfn = g.gfn === 'yes'
        ? (g.needsClaim ? `playable on GFN after adding it in ${g.claimVia}` : 'playable on GeForce NOW')
        : g.gfn === 'other' ? `on GFN only for ${asArray(g.gfnStores).join(', ')}` : 'not on GeForce NOW';
      text = `Not in your library - in PC Game Pass: ${g.name} (${gfn})`;
      cls = 'warn';
    } else {
      text = 'Not in your collection, and not in PC Game Pass.';
      cls = 'bad';
    }

    el.className = 'verdict ' + cls;
    el.textContent = text;
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

    document.querySelector('.tabs').addEventListener('click', e => {
      const tab = e.target.closest('[data-view]');
      if (!tab || tab.dataset.view === state.view) return;
      state.view = tab.dataset.view;
      state.genre = '';
      state.store = '';
      $('#genre').value = '';
      $('#store').value = '';
      render();
    });

    $('#genre').addEventListener('change', e => { state.genre = e.target.value; render(); });
    $('#store').addEventListener('change', e => { state.store = e.target.value; render(); });
    $('#sort').addEventListener('change', e => { state.sort = e.target.value; render(); });

    $('#list').addEventListener('click', e => {
      const li = e.target.closest('li.game');
      if (!li) return;
      const id = li.dataset.id;
      state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id);
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
    state.games = data.games || [];
    state.gamePass = data.gamePass || [];
    prepare(state.games);
    prepare(state.gamePass);

    readHash();

    const s = data.stats || {};
    const ready = state.games.filter(g => !g.hidden && g.__gfn === 'yes').length;
    const laptop = state.games.filter(g => !g.hidden && (g.__gfn === 'no' || g.__gfn === 'other')).length;
    $('#summary').textContent =
      `${fmt(state.games.filter(g => !g.hidden).length)} games - ${fmt(ready)} on the TV - ${fmt(laptop)} laptop only`;

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

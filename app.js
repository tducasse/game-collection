/* Game collection - static, dependency-free.
 *
 * Data: data/games.json, written by the Playnite "Collection Publisher" extension.
 * State: the URL hash, so every view is bookmarkable/shareable (incl. on a phone).
 */
(() => {
  'use strict';

  const GFN_ORDER = { yes: 0, other: 1, no: 2, na: 3 };
  const GFN_LABEL = {
    yes: 'Cloud ready',
    other: 'Other store only',
    no: 'Not on GFN',
    na: 'Not applicable'
  };
  const GFN_SHORT = { yes: '✓', other: '~', no: '✗', na: '–' };

  const ACCESS_LABEL = {
    owned: 'Owned',
    gamepass: 'Game Pass',
    eaplay: 'EA Play',
    ubisoftplus: 'Ubisoft+',
    shared: 'Family share',
    unknown: 'Unknown'
  };

  const PLAYTIME_BUCKETS = [
    { id: '0',    label: 'Never played', test: h => h === 0 },
    { id: 'lt5',  label: 'Under 5 h',    test: h => h > 0 && h < 5 },
    { id: '5-20', label: '5 – 20 h',     test: h => h >= 5 && h < 20 },
    { id: '20-100', label: '20 – 100 h', test: h => h >= 20 && h < 100 },
    { id: '100+', label: '100 h +',      test: h => h >= 100 }
  ];

  const FACETS = [
    { key: 'gfn', label: 'GeForce NOW', order: ['yes', 'other', 'no', 'na'] },
    { key: 'store', label: 'Store' },
    { key: 'access', label: 'Access', order: ['owned', 'gamepass', 'eaplay', 'ubisoftplus', 'shared', 'unknown'] },
    { key: 'completion', label: 'Completion' },
    { key: 'playtime', label: 'Playtime' },
    { key: 'flags', label: 'Flags', values: ['installed', 'favorite', 'hidden'] },
    { key: 'platforms', label: 'Platform', limit: 8 },
    { key: 'genres', label: 'Genre', limit: 12 },
    { key: 'features', label: 'Features', limit: 10 },
    { key: 'tags', label: 'Tags', limit: 14 },
    { key: 'decade', label: 'Released' }
  ];

  const PRESETS = [
    { id: 'all', label: 'Everything', apply: () => ({}) },
    { id: 'cloud', label: 'Cloud ready', apply: () => ({ gfn: ['yes'] }) },
    { id: 'laptop', label: 'Laptop only', apply: () => ({ gfn: ['no'] }) },
    { id: 'other', label: 'On GFN, wrong store', apply: () => ({ gfn: ['other'] }) },
    { id: 'backlog', label: 'Unplayed', apply: () => ({ playtime: ['0'] }) },
    { id: 'installed', label: 'Installed', apply: () => ({ flags: ['installed'] }) },
    { id: 'gp', label: 'Game Pass, not on GFN', apply: () => ({ __tab: 'gamepass', gfn: ['no'] }) }
  ];

  // ---------------------------------------------------------------- utilities

  const $ = sel => document.querySelector(sel);

  // PowerShell's ConvertTo-Json turns 1-element arrays into plain values.
  const asArray = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function normalize(s) {
    return String(s ?? '')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  const nf = new Intl.NumberFormat();
  const fmtInt = n => nf.format(n);

  function fmtPlaytime(minutes) {
    if (!minutes) return '';
    if (minutes < 60) return minutes + ' min';
    const h = minutes / 60;
    return (h < 10 ? h.toFixed(1) : Math.round(h)) + ' h';
  }

  function timeAgo(iso) {
    if (!iso) return '';
    const then = new Date(iso).getTime();
    if (!then) return '';
    const days = Math.floor((Date.now() - then) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return days + ' d ago';
    if (days < 365) return Math.floor(days / 30) + ' mo ago';
    return Math.floor(days / 365) + ' y ago';
  }

  // ------------------------------------------------------------------- state

  const EMPTY = { tab: 'library', sort: 'name', dir: 'asc', q: '', facets: {} };

  const state = {
    data: null,
    games: [],
    gamePass: [],
    tab: 'library',
    sort: 'name',
    dir: 'asc',
    q: '',
    facets: {},          // key -> Set(values)
    expanded: new Set(),
    preset: null
  };

  function readHash() {
    const raw = location.hash.replace(/^#/, '');
    const params = new URLSearchParams(raw);
    const next = { ...EMPTY, facets: {} };

    if (params.get('tab') === 'gamepass') next.tab = 'gamepass';
    if (params.get('sort')) next.sort = params.get('sort');
    if (params.get('dir') === 'desc') next.dir = 'desc';
    if (params.get('q')) next.q = params.get('q');

    for (const { key } of FACETS) {
      const v = params.get(key);
      if (v) next.facets[key] = new Set(v.split(',').filter(Boolean));
    }
    if (params.get('preset')) next.preset = params.get('preset');

    state.tab = next.tab;
    state.sort = next.sort;
    state.dir = next.dir;
    state.q = next.q;
    state.facets = next.facets;
    state.preset = next.preset;
  }

  function writeHash() {
    const params = new URLSearchParams();
    if (state.tab !== 'library') params.set('tab', state.tab);
    if (state.q) params.set('q', state.q);
    for (const { key } of FACETS) {
      const set = state.facets[key];
      if (set && set.size) params.set(key, [...set].join(','));
    }
    if (state.sort !== 'name') params.set('sort', state.sort);
    if (state.dir !== 'asc') params.set('dir', 'desc');
    if (state.preset) params.set('preset', state.preset);

    const hash = params.toString();
    history.replaceState(null, '', hash ? '#' + hash : location.pathname + location.search);
  }

  // ------------------------------------------------------------------ facets

  function facetValue(game, key) {
    if (key === 'flags') {
      const out = [];
      if (game.installed) out.push('installed');
      if (game.favorite) out.push('favorite');
      if (game.hidden) out.push('hidden');
      return out;
    }
    if (key === 'playtime') {
      const h = (game.playtime || 0) / 60;
      const bucket = PLAYTIME_BUCKETS.find(b => b.test(h));
      return bucket ? [bucket.id] : [];
    }
    if (key === 'decade') {
      if (!game.year) return [];
      return [game.year - (game.year % 10) + 's'];
    }
    return asArray(game[key]).filter(x => x !== '' && x != null);
  }

  function facetLabel(key, value) {
    if (key === 'gfn') return GFN_LABEL[value] || value;
    if (key === 'access') return ACCESS_LABEL[value] || value;
    if (key === 'playtime') return (PLAYTIME_BUCKETS.find(b => b.id === value) || {}).label || value;
    if (key === 'flags') return { installed: 'Installed', favorite: 'Favourite', hidden: 'Hidden' }[value] || value;
    return value;
  }

  function facetValues(key, rows) {
    const counts = new Map();
    for (const game of rows) {
      for (const v of facetValue(game, key)) {
        counts.set(v, (counts.get(v) || 0) + 1);
      }
    }
    const def = FACETS.find(f => f.key === key) || {};
    const values = [...counts.entries()];
    const order = def.order || def.values;
    if (order) {
      const idx = v => { const i = order.indexOf(v); return i === -1 ? 999 : i; };
      values.sort((a, b) => idx(a[0]) - idx(b[0]) || a[0].localeCompare(b[0]));
    } else {
      values.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    }
    return def.limit ? values.slice(0, def.limit) : values;
  }

  // ----------------------------------------------------------------- filters

  function matchesFilters(game, skipKey) {
    if (!game.__showHidden && game.hidden && (!state.facets.flags || !state.facets.flags.has('hidden'))) {
      return false;
    }

    for (const { key } of FACETS) {
      if (key === skipKey) continue;
      const wanted = state.facets[key];
      if (!wanted || !wanted.size) continue;
      const values = facetValue(game, key);
      if (!values.some(v => wanted.has(v))) return false;
    }

    if (state.q) {
      const needle = state.q; // already normalised
      if (!(game.__hay || '').includes(needle)) return false;
    }
    return true;
  }

  function currentRows() {
    return state.tab === 'gamepass' ? state.gamePass : state.games;
  }

  function filteredRows() {
    return currentRows().filter(g => matchesFilters(g));
  }

  // ------------------------------------------------------------------ render

  function prepare(games) {
    for (const g of games) {
      if (!g.id) g.id = 'gp:' + g.name;   // Game Pass rows have no Playnite id
      g.__hay = normalize([g.name, g.sortName, g.series, g.gfnTitle].filter(Boolean).join(' '));
      g.__gfn = g.gfn || 'na';
    }
  }

  function gfnCell(game) {
    const status = game.__gfn;
    const stores = asArray(game.gfnStores).join(', ');
    const title = status === 'yes' ? `Playable via ${stores || 'GFN'}`
      : status === 'other' ? `On GFN only for: ${stores}`
      : status === 'na' ? 'This store cannot be streamed'
      : 'Not in the GeForce NOW catalogue';
    return `<span class="badge gfn-${status}" title="${esc(title)}">${GFN_SHORT[status]} ${esc(GFN_LABEL[status])}</span>`;
  }

  function rowHtml(game) {
    const id = esc(game.id);
    const open = state.expanded.has(game.id);
    const meta = [
      game.series ? esc(game.series) : '',
      asArray(game.genres).slice(0, 3).map(esc).join(', '),
      asArray(game.developers)[0] ? esc(asArray(game.developers)[0]) : ''
    ].filter(Boolean).join(' · ');

    let detail = '';
    if (open) {
      const bits = [];
      if (game.gfnTitle && game.gfnTitle !== game.name) bits.push(`<div><span class="k">GFN listing</span> ${esc(game.gfnTitle)}</div>`);
      const stores = asArray(game.gfnStores);
      if (stores.length) bits.push(`<div><span class="k">GFN stores</span> ${esc(stores.join(', '))}</div>`);
      const tags = asArray(game.tags);
      if (tags.length) bits.push(`<div><span class="k">Tags</span> ${tags.map(esc).join(', ')}</div>`);
      const feats = asArray(game.features);
      if (feats.length) bits.push(`<div><span class="k">Features</span> ${feats.map(esc).join(', ')}</div>`);
      const pubs = asArray(game.publishers);
      if (pubs.length) bits.push(`<div><span class="k">Publisher</span> ${pubs.map(esc).join(', ')}</div>`);
      if (game.releaseDate) bits.push(`<div><span class="k">Released</span> ${esc(game.releaseDate)}</div>`);
      if (game.lastPlayed) bits.push(`<div><span class="k">Last played</span> ${esc(timeAgo(game.lastPlayed))}</div>`);
      if (game.playCount) bits.push(`<div><span class="k">Sessions</span> ${fmtInt(game.playCount)}</div>`);
      const scores = [
        game.criticScore != null ? `critics ${game.criticScore}` : '',
        game.communityScore != null ? `community ${game.communityScore}` : '',
        game.userScore != null ? `mine ${game.userScore}` : ''
      ].filter(Boolean).join(' · ');
      if (scores) bits.push(`<div><span class="k">Scores</span> ${esc(scores)}</div>`);
      if (game.sizeMb) bits.push(`<div><span class="k">Size</span> ${(game.sizeMb / 1024).toFixed(1)} GB</div>`);
      detail = `<tr class="detail"><td colspan="6"><div class="detail-inner">${bits.join('') || '<em>No extra metadata.</em>'}</div></td></tr>`;
    }

    return `<tr class="game${open ? ' is-open' : ''}" data-id="${id}" tabindex="0">
      <td class="col-name">
        <span class="name">${esc(game.name)}</span>
        ${meta ? `<span class="meta">${meta}</span>` : ''}
        ${game.installed ? '<span class="pill" title="Installed">installed</span>' : ''}
        ${game.favorite ? '<span class="pill fav" title="Favourite">★</span>' : ''}
      </td>
      <td class="col-store"><span class="store">${esc(game.store || '')}</span>${
        game.access && game.access !== 'owned'
          ? `<span class="access access-${esc(game.access)}" title="Access, not ownership">${esc(ACCESS_LABEL[game.access] || game.access)}</span>`
          : ''}</td>
      <td class="col-gfn">${gfnCell(game)}</td>
      <td class="col-playtime num">${fmtPlaytime(game.playtime)}</td>
      <td class="col-completion">${esc(game.completion || '')}</td>
      <td class="col-year num">${game.year || ''}</td>
    </tr>${detail}`;
  }

  function sortRows(rows) {
    const dir = state.dir === 'desc' ? -1 : 1;
    const key = state.sort;
    return rows.sort((a, b) => {
      let av, bv;
      switch (key) {
        case 'playtime': av = a.playtime || 0; bv = b.playtime || 0; break;
        case 'year': av = a.year || 0; bv = b.year || 0; break;
        case 'gfn': av = GFN_ORDER[a.__gfn] ?? 9; bv = GFN_ORDER[b.__gfn] ?? 9; break;
        case 'completion': av = a.completion || ''; bv = b.completion || ''; break;
        case 'store': av = a.store || ''; bv = b.store || ''; break;
        default: av = a.sortName || a.name || ''; bv = b.sortName || b.name || '';
      }
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }

  function renderFilters(rows) {
    const wrap = $('#filters');
    const html = FACETS.map(({ key, label }) => {
      const values = facetValues(key, rows);
      if (!values.length) return '';
      const active = state.facets[key] || new Set();
      const items = values.map(([value, count]) => {
        const on = active.has(value);
        return `<label class="opt${on ? ' is-on' : ''}">
          <input type="checkbox" data-facet="${key}" value="${esc(value)}" ${on ? 'checked' : ''}>
          <span class="opt-label">${esc(facetLabel(key, value))}</span>
          <span class="opt-count">${fmtInt(count)}</span>
        </label>`;
      }).join('');
      return `<section class="facet">
        <h2>${esc(label)}</h2>
        <div class="opts">${items}</div>
      </section>`;
    }).join('');

    wrap.innerHTML = html || '';
  }

  function renderPresets() {
    $('#presets').innerHTML = PRESETS.map(p =>
      `<button class="chip${state.preset === p.id ? ' is-active' : ''}" data-preset="${p.id}">${esc(p.label)}</button>`
    ).join('');
  }

  function renderVerdict(rows) {
    const el = $('#verdict');
    if (!state.q || state.tab !== 'library') { if (el) el.remove(); return; }
    const games = state.games.filter(g => (g.__hay || '').includes(state.q));
    let text, cls;
    if (games.length) {
      const g = games[0];
      const access = g.access && g.access !== 'owned'
        ? ` via ${ACCESS_LABEL[g.access] || g.access} (not owned)`
        : '';
      const where = g.store ? ` on ${g.store}` : '';
      const gfn = g.__gfn === 'yes'
        ? `playable on GeForce NOW (${asArray(g.gfnStores).join(', ') || 'streaming'})`
        : g.__gfn === 'other'
          ? `on GeForce NOW only for ${asArray(g.gfnStores).join(', ')}`
          : g.__gfn === 'na'
            ? 'this store cannot be streamed'
            : 'not playable on GeForce NOW';
      text = `${g.name} — in your library${where}${access} — ${gfn}`;
      cls = g.__gfn === 'yes' ? 'ok' : g.__gfn === 'other' || (g.access && g.access !== 'owned') ? 'warn' : 'neutral';
    } else {
      const gp = state.gamePass.filter(g => (g.__hay || '').includes(state.q));
      text = gp.length
        ? `Not in your library. In PC Game Pass: ${gp[0].name}`
        : 'Not in your collection.';
      cls = gp.length ? 'warn' : 'bad';
    }
    const node = el || document.createElement('div');
    node.id = 'verdict';
    node.className = 'verdict ' + cls;
    node.textContent = text;
    if (!el) $('.toolbar').after(node);
  }

  function render() {
    const rows = sortRows(filteredRows());
    const total = currentRows().length;

    $('#result-count').textContent =
      `${fmtInt(rows.length)} of ${fmtInt(total)} ${state.tab === 'gamepass' ? 'Game Pass titles' : 'games'}`;

    $('#rows').innerHTML = rows.map(rowHtml).join('');
    $('#empty').hidden = rows.length !== 0;
    renderVerdict(rows);

    document.querySelectorAll('.tab').forEach(t =>
      t.classList.toggle('is-active', t.dataset.tab === state.tab));

    const activeCount = Object.values(state.facets).reduce((n, s) => n + (s ? s.size : 0), 0);
    $('#filters-toggle').textContent = activeCount ? `Filters (${activeCount})` : 'Filters';

    writeHash();
  }

  function renderAll() {
    renderPresets();
    renderFilters(currentRows());
    render();
  }

  // ------------------------------------------------------------------ events

  function setFacet(key, value, on) {
    const set = state.facets[key] || (state.facets[key] = new Set());
    if (on) set.add(value); else set.delete(value);
    if (!set.size) delete state.facets[key];
    state.preset = null;
  }

  function applyPreset(id) {
    const preset = PRESETS.find(p => p.id === id);
    if (!preset) return;
    state.facets = {};
    state.q = '';
    $('#q').value = '';
    const spec = preset.apply();
    for (const [k, v] of Object.entries(spec)) {
      if (k === '__tab') state.tab = v;
      else state.facets[k] = new Set(v);
    }
    if (!spec.__tab) state.tab = 'library';
    state.preset = id;
    renderAll();
  }

  function bind() {
    $('#q').addEventListener('input', e => {
      const raw = e.target.value;
      $('#q-clear').hidden = !raw;
      state.q = normalize(raw);
      state.preset = null;
      clearTimeout(bind._t);
      bind._t = setTimeout(render, 90);
    });

    $('#q-clear').addEventListener('click', () => {
      $('#q').value = '';
      $('#q-clear').hidden = true;
      state.q = '';
      render();
      $('#q').focus();
    });

    $('#filters').addEventListener('change', e => {
      const input = e.target.closest('input[data-facet]');
      if (!input) return;
      setFacet(input.dataset.facet, input.value, input.checked);
      renderFilters(currentRows());
      render();
    });

    $('#presets').addEventListener('click', e => {
      const chip = e.target.closest('[data-preset]');
      if (chip) applyPreset(chip.dataset.preset);
    });

    document.querySelector('.tabs').addEventListener('click', e => {
      const tab = e.target.closest('[data-tab]');
      if (!tab) return;
      if (state.tab === tab.dataset.tab) return;
      state.tab = tab.dataset.tab;
      state.preset = null;
      // Facets are per-tab: a "store" filter means nothing on the Game Pass tab.
      state.facets = {};
      renderAll();
    });

    document.querySelector('#games thead').addEventListener('click', e => {
      const btn = e.target.closest('[data-sort]');
      if (!btn) return;
      const key = btn.dataset.sort;
      if (state.sort === key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      else { state.sort = key; state.dir = 'asc'; }
      render();
    });

    $('#rows').addEventListener('click', e => {
      const tr = e.target.closest('tr.game');
      if (!tr) return;
      const id = tr.dataset.id;
      if (state.expanded.has(id)) state.expanded.delete(id); else state.expanded.add(id);
      render();
    });

    $('#filters-toggle').addEventListener('click', () => {
      document.body.classList.toggle('filters-open');
    });

    $('#permalink').addEventListener('click', async e => {
      e.preventDefault();
      try {
        await navigator.clipboard.writeText(location.href);
        e.target.textContent = 'copied!';
        setTimeout(() => { e.target.textContent = 'link to this view'; }, 1500);
      } catch {
        e.target.textContent = location.href;
      }
    });

    document.addEventListener('keydown', e => {
      if (e.key === '/' && document.activeElement !== $('#q')) {
        e.preventDefault();
        $('#q').focus();
      }
      if (e.key === 'Escape' && document.activeElement === $('#q')) {
        $('#q').value = '';
        state.q = '';
        render();
        $('#q').blur();
      }
    });
  }

  // -------------------------------------------------------------------- boot

  async function boot() {
    const res = await fetch('data/games.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`data/games.json: HTTP ${res.status}`);
    const data = await res.json();

    state.games = data.games || [];
    state.gamePass = data.gamePass || [];
    prepare(state.games);
    prepare(state.gamePass);
    for (const g of state.gamePass) g.store = 'Game Pass';

    readHash();

    const s = data.stats || {};
    $('#summary').textContent =
      `${fmtInt(state.games.length)} games · ${fmtInt(s.streamable || 0)} cloud-ready · ` +
      `${fmtInt(s.notStreamable || 0)} laptop-only`;

    $('#meta').textContent =
      `Updated ${timeAgo(data.generatedAt)}` +
      (data.catalog ? ` · GeForce NOW ${data.catalog.country}, ${fmtInt(data.catalog.titles)} titles` : '');

    $('#q').value = state.q;
    bind();
    renderAll();

    if (!state.q) $('#q').focus();
  }

  boot().catch(err => {
    $('#summary').textContent = 'Could not load data';
    $('#rows').innerHTML = `<tr><td colspan="6" class="error">${esc(err.message)}</td></tr>`;
    console.error(err);
  });
})();

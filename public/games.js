// Games-Welt: Sammlung, Ranking und Empfehlungen.
// Gekapselt in einer IIFE; Onclick-Handler laufen über das globale Objekt GW.
(function () {
  const TIER_COLORS = { S: '#ff0066', A: '#ff6600', B: '#ffcc00', C: '#33cc33', D: '#3399ff', E: '#9966ff', F: '#666666' };
  const TIER_VALUES = { S: 7, A: 6, B: 5, C: 4, D: 3, E: 2, F: 1 };
  const TIERS = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];
  const PLACEHOLDER = 'https://via.placeholder.com/120x80?text=No+Image';

  // RAWG-Genre-Namen -> Slugs (für die Empfehlungs-Abfrage)
  const GENRE_SLUGS = {
    'action': 'action', 'indie': 'indie', 'adventure': 'adventure',
    'rpg': 'role-playing-games-rpg', 'role-playing': 'role-playing-games-rpg',
    'strategy': 'strategy', 'shooter': 'shooter', 'casual': 'casual',
    'simulation': 'simulation', 'puzzle': 'puzzle', 'arcade': 'arcade',
    'platformer': 'platformer', 'racing': 'racing',
    'massively multiplayer': 'massively-multiplayer',
    'sports': 'sports', 'fighting': 'fighting', 'family': 'family',
    'board games': 'board-games', 'educational': 'educational', 'card': 'card'
  };

  const token = Auth.requireAuth();
  if (!token) return;

  let games = [];
  let ranking = {};
  let currentModalItem = null;
  let itemsPerTier = 10;
  let expandedTiers = {};
  let searchTerm = '';
  let genreFilter = '';
  let tierFilter = '';
  let collectionSearch = '';
  let collectionSort = 'recent';
  let collectionGenre = '';
  let recommendations = [];
  let recommendationsLoaded = false;

  const $ = (id) => document.getElementById(id);
  const api = (path, options) => Auth.api(path, token, options || {});

  function notify(msg) {
    const bar = $('snackbar');
    if (!bar) return;
    bar.textContent = msg;
    bar.classList.add('show');
    clearTimeout(notify._t);
    notify._t = setTimeout(() => bar.classList.remove('show'), 3000);
  }

  // === INIT ===
  async function init() {
    try {
      const g = await api('/games');
      games = g.games || [];
      const r = await api('/game-ranking');
      const loaded = r.ranking || {};
      ranking = {};
      Object.entries(loaded).forEach(([id, value]) => {
        ranking[id] = typeof value === 'string' ? { tier: value, reason: '' } : value;
      });
      renderTiers();
      buildGenreFilter();
      buildCollectionGenres();
      renderCollection();
    } catch (e) {
      console.error('Games laden fehlgeschlagen:', e);
      notify('⚠️ Daten konnten nicht geladen werden');
    }

    document.querySelectorAll('.gtab').forEach(tab => {
      tab.addEventListener('click', () => showView(tab.dataset.view));
    });
    ['item-modal', 'add-modal', 'share-modal'].forEach(id => {
      $(id).addEventListener('click', e => { if (e.target.id === id) $(id).classList.remove('active'); });
    });
  }

  // === API-Speichern ===
  async function saveGames() {
    try {
      await api('/games', { method: 'POST', body: { games } });
      return true;
    } catch (e) {
      notify('⚠️ Sammlung konnte nicht gespeichert werden');
      return false;
    }
  }

  async function saveRanking(silent) {
    try {
      await api('/game-ranking', { method: 'POST', body: { ranking } });
      if (!silent) notify('💾 Gespeichert!');
      return true;
    } catch (e) {
      if (!silent) notify('⚠️ Speichern fehlgeschlagen');
      return false;
    }
  }

  // === VIEW-WECHSEL ===
  function showView(name) {
    document.querySelectorAll('.gtab').forEach(t => t.classList.toggle('active', t.dataset.view === name));
    $('view-collection').style.display = name === 'collection' ? '' : 'none';
    $('view-ranking').style.display = name === 'ranking' ? '' : 'none';
    $('view-recommend').style.display = name === 'recommend' ? '' : 'none';
    if (name === 'recommend' && !recommendationsLoaded) loadRecommendations(false);
  }

  // === SAMMLUNG ===
  function buildCollectionGenres() {
    const genres = new Set();
    games.forEach(g => (g.genres_text || '').split(',').map(s => s.trim()).filter(Boolean).forEach(x => genres.add(x)));
    const select = $('collection-genre');
    const current = select.value;
    select.innerHTML = '<option value="">Alle Genres</option>' +
      [...genres].sort().map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
    select.value = current;
  }

  function sortCollection(list) {
    const order = new Map(games.map((g, i) => [g.id, i]));
    const tierVal = (g) => TIER_VALUES[ranking[g.id] && ranking[g.id].tier] || 0;
    // Spiele mit addedAt nach Zeitstempel; ältere ohne Feld nach Array-Index
    const recentKey = (g) => (g.addedAt ? Date.parse(g.addedAt) : order.get(g.id));
    const arr = list.slice();
    switch (collectionSort) {
      case 'alpha':
        arr.sort((a, b) => (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase()));
        break;
      case 'tier':
        arr.sort((a, b) => tierVal(b) - tierVal(a));
        break;
      case 'rating':
        arr.sort((a, b) => (b.rating || 0) - (a.rating || 0));
        break;
      default: // 'recent'
        arr.sort((a, b) => recentKey(b) - recentKey(a));
    }
    return arr;
  }

  function renderCollection() {
    const grid = $('collection-grid');
    const term = collectionSearch;
    let list = games.filter(g => {
      if (term && !(g.name || '').toLowerCase().includes(term)) return false;
      if (collectionGenre && !(g.genres_text || '').toLowerCase().includes(collectionGenre.toLowerCase())) return false;
      return true;
    });
    list = sortCollection(list);

    $('collection-stats').textContent =
      `${games.length} Spiele in deiner Sammlung · ${Object.keys(ranking).length} davon gerankt`;

    if (list.length === 0) {
      grid.innerHTML = `<p class="empty-hint">${games.length === 0
        ? 'Noch keine Spiele. Klicke auf "➕ Spiel hinzufügen".'
        : 'Keine Treffer.'}</p>`;
      return;
    }

    grid.innerHTML = list.map(g => {
      const tier = ranking[g.id] && ranking[g.id].tier;
      const cover = g.background_image || PLACEHOLDER;
      const meta = [g.released ? g.released.slice(0, 4) : null, g.genres_text].filter(Boolean).join(' · ');
      const tierBadge = tier
        ? `<span class="gc-tier" style="background:${TIER_COLORS[tier]};color:${tier === 'B' ? '#1a1a1a' : '#fff'}">${tier}</span>`
        : '';
      return `
        <div class="game-card">
          <div class="gc-cover clickable" style="background-image:url('${cover}')" onclick="GW.openModal(${g.id})">${tierBadge}</div>
          <div class="gc-body">
            <strong>${escapeHtml(g.name || '')}</strong>
            <span class="gc-meta">${escapeHtml(meta || 'Spiel')}</span>
            <div class="gc-actions">
              <button onclick="GW.openModal(${g.id})" style="background:var(--gradient-accent)">🏆 Einordnen</button>
              <button onclick="GW.deleteGameById(${g.id})" style="background:linear-gradient(135deg,#b91c1c,#dc2626)">🗑️</button>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  function filterCollection() {
    collectionSearch = $('collection-search').value.toLowerCase();
    collectionSort = $('collection-sort').value;
    collectionGenre = $('collection-genre').value;
    renderCollection();
  }

  // === RANKING-ANSICHT ===
  function renderTiers() {
    $('tier-container').innerHTML = TIERS.map(tier => `
      <div class="tier-row" data-tier="${tier}">
        <div class="tier-label tier-${tier.toLowerCase()}" onclick="GW.toggleExpand('${tier}')">
          ${tier}
          <span class="tier-count" id="count-${tier}">0</span>
        </div>
        <div class="tier-items" data-tier="${tier}" id="tier-${tier}"></div>
      </div>
    `).join('');
    updateAllTiers();
  }

  function buildGenreFilter() {
    const genres = new Set();
    games.forEach(g => (g.genres_text || '').split(',').map(s => s.trim()).filter(Boolean).forEach(x => genres.add(x)));
    const select = $('rk-genre');
    const current = select.value;
    select.innerHTML = '<option value="">Alle Genres</option>' +
      [...genres].sort().map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
    select.value = current;
  }

  function matchesFilters(game) {
    if (searchTerm && !(game.name || '').toLowerCase().includes(searchTerm)) return false;
    if (genreFilter && !(game.genres_text || '').toLowerCase().includes(genreFilter.toLowerCase())) return false;
    return true;
  }

  function getFilteredItems(forTier) {
    return games.filter(game => {
      const itemTier = (ranking[game.id] && ranking[game.id].tier) || 'unranked';
      if (itemTier !== forTier) return false;
      if (tierFilter && tierFilter !== itemTier) return false;
      return matchesFilters(game);
    });
  }

  function createItemHTML(game) {
    const cover = game.background_image || PLACEHOLDER;
    const reason = (ranking[game.id] && ranking[game.id].reason) || '';
    return `
      <div class="tier-item" data-id="${game.id}" draggable="true" onclick="GW.openModal(${game.id})">
        <img src="${cover}" alt="${escapeHtml(game.name || '')}" draggable="false" onerror="this.src='${PLACEHOLDER}'">
        <div class="item-title">${escapeHtml(game.name || '')}</div>
        ${reason ? `<div class="item-reason">${escapeHtml(reason)}</div>` : ''}
      </div>`;
  }

  function updateAllTiers() {
    TIERS.forEach(tier => {
      const items = getFilteredItems(tier);
      const isExpanded = expandedTiers[tier];
      const visible = isExpanded ? items : items.slice(0, itemsPerTier);
      $('count-' + tier).textContent = items.length;

      let html = visible.map(createItemHTML).join('');
      if (items.length > itemsPerTier && !isExpanded) {
        html += `<button class="tier-expand-btn" onclick="event.stopPropagation();GW.toggleExpand('${tier}')">+${items.length - itemsPerTier} weitere</button>`;
      } else if (isExpanded && items.length > itemsPerTier) {
        html += `<button class="tier-expand-btn collapse" onclick="event.stopPropagation();GW.toggleExpand('${tier}')">▲ Einklappen</button>`;
      }
      $('tier-' + tier).innerHTML = html;
    });

    const unranked = getFilteredItems('unranked');
    $('tier-unranked').innerHTML = unranked.map(createItemHTML).join('')
      || '<p style="color:var(--text-muted);padding:20px;">Keine Spiele.</p>';
    $('unranked-count').textContent = unranked.length + ' Spiele';

    updateStats();
    initDragDrop();
  }

  function updateStats() {
    const filtered = games.filter(matchesFilters);
    let ranked = 0, unranked = 0, sum = 0;
    filtered.forEach(game => {
      if (ranking[game.id] && ranking[game.id].tier) {
        ranked++;
        sum += TIER_VALUES[ranking[game.id].tier] || 0;
      } else {
        unranked++;
      }
    });
    $('stat-games').textContent = filtered.length;
    $('stat-ranked').textContent = ranked;
    $('stat-unranked').textContent = unranked;
    $('stat-avg').textContent = ranked > 0
      ? (Object.keys(TIER_VALUES).find(k => TIER_VALUES[k] === Math.round(sum / ranked)) || '-')
      : '-';
  }

  function filterItems() {
    searchTerm = $('rk-search').value.toLowerCase();
    genreFilter = $('rk-genre').value;
    tierFilter = $('rk-tier').value;
    updateAllTiers();
  }

  function changeItemsPerTier() {
    itemsPerTier = parseInt($('rk-per-tier').value, 10);
    expandedTiers = {};
    updateAllTiers();
  }

  function toggleExpand(tier) {
    expandedTiers[tier] = !expandedTiers[tier];
    updateAllTiers();
  }

  // Aktualisiert alle datenabhängigen Ansichten nach einer Änderung
  function refresh() {
    updateAllTiers();
    buildGenreFilter();
    buildCollectionGenres();
    renderCollection();
  }

  // === MODAL ===
  function openModal(id) {
    const game = games.find(g => g.id === id);
    if (!game) return;
    currentModalItem = game;
    $('modal-poster').src = game.background_image || PLACEHOLDER;
    $('modal-title').textContent = game.name || '';
    const meta = [game.released ? game.released.slice(0, 4) : null, game.genres_text].filter(Boolean).join(' · ');
    $('modal-type').textContent = '🎮 ' + (meta || 'Spiel');
    $('modal-reason').value = (ranking[id] && ranking[id].reason) || '';
    const currentTier = ranking[id] && ranking[id].tier;
    $('tier-selector').innerHTML = TIERS.map(t => `
      <button onclick="GW.setTier('${t}')" class="${currentTier === t ? 'selected' : ''}"
        style="background:${TIER_COLORS[t]};color:${t === 'B' ? '#1a1a1a' : '#fff'}">${t}</button>
    `).join('');
    $('item-modal').classList.add('active');
  }

  function closeModal() {
    $('item-modal').classList.remove('active');
    currentModalItem = null;
  }

  function setTier(tier) {
    if (!currentModalItem) return;
    ranking[currentModalItem.id] = { tier, reason: $('modal-reason').value };
    saveRanking(true);
    const name = currentModalItem.name;
    closeModal();
    refresh();
    notify(`${name} → Tier ${tier}`);
  }

  function saveReasonOnly() {
    if (!currentModalItem) return;
    const currentTier = ranking[currentModalItem.id] && ranking[currentModalItem.id].tier;
    if (!currentTier) return notify('Erst ein Tier wählen');
    ranking[currentModalItem.id] = { tier: currentTier, reason: $('modal-reason').value };
    saveRanking(true);
    closeModal();
    refresh();
    notify('✓ Gespeichert');
  }

  function moveToUnranked() {
    if (!currentModalItem) return;
    delete ranking[currentModalItem.id];
    saveRanking(true);
    closeModal();
    refresh();
  }

  function deleteGame() {
    if (!currentModalItem) return;
    const id = currentModalItem.id;
    const name = currentModalItem.name;
    if (!confirm(`"${name}" aus der Sammlung löschen?`)) return;
    games = games.filter(g => g.id !== id);
    delete ranking[id];
    saveGames();
    saveRanking(true);
    closeModal();
    refresh();
    notify('🗑️ Aus Sammlung gelöscht');
  }

  function deleteGameById(id) {
    const game = games.find(g => g.id === id);
    if (!game) return;
    if (!confirm(`"${game.name}" aus der Sammlung löschen?`)) return;
    games = games.filter(g => g.id !== id);
    delete ranking[id];
    saveGames();
    saveRanking(true);
    refresh();
    notify('🗑️ Aus Sammlung gelöscht');
  }

  function resetRanking() {
    if (!confirm('Game-Ranking wirklich zurücksetzen? (Sammlung bleibt erhalten)')) return;
    ranking = {};
    saveRanking(true);
    refresh();
    notify('🔄 Zurückgesetzt');
  }

  // === SPIEL HINZUFÜGEN (RAWG-Suche) ===
  function openAddGameModal() {
    $('add-modal').classList.add('active');
    $('add-search-input').focus();
  }

  function closeAddModal() {
    $('add-modal').classList.remove('active');
  }

  async function searchGames() {
    const query = $('add-search-input').value.trim();
    const resultsEl = $('add-search-results');
    if (!query) {
      resultsEl.innerHTML = '<p style="text-align:center;color:var(--text-muted)">Bitte einen Suchbegriff eingeben.</p>';
      return;
    }
    resultsEl.innerHTML = '<p style="text-align:center;color:var(--text-muted)">⏳ Suche läuft...</p>';
    try {
      const data = await api('/rawg/search?query=' + encodeURIComponent(query));
      const results = data.results || [];
      if (results.length === 0) {
        resultsEl.innerHTML = '<p style="text-align:center;color:var(--text-muted)">Keine Spiele gefunden.</p>';
        return;
      }
      resultsEl.innerHTML = results.map(g => {
        const inCollection = games.some(x => x.id === g.id);
        const year = g.released ? g.released.slice(0, 4) : '—';
        const genres = (g.genres || []).map(x => x.name).join(', ');
        const img = g.background_image || PLACEHOLDER;
        return `
          <div class="search-result">
            <img src="${img}" alt="${escapeHtml(g.name || '')}" onerror="this.src='${PLACEHOLDER}'">
            <div class="sr-info">
              <strong>${escapeHtml(g.name || '')}</strong>
              <span>${year}${genres ? ' · ' + escapeHtml(genres) : ''}${g.rating ? ' · ⭐ ' + g.rating : ''}</span>
            </div>
            <button onclick='GW.addGame(${JSON.stringify(g).replace(/'/g, "&#39;")})' ${inCollection ? 'disabled' : ''}
              style="background:${inCollection ? '#4b5563' : 'var(--gradient-accent)'}">
              ${inCollection ? '✓ Drin' : '➕ Add'}
            </button>
          </div>`;
      }).join('');
    } catch (e) {
      resultsEl.innerHTML = '<p style="text-align:center;color:#ef4444">Fehler bei der Suche: ' + e.message + '</p>';
    }
  }

  function gameFromRawg(g) {
    return {
      id: g.id,
      name: g.name,
      background_image: g.background_image || '',
      released: g.released || '',
      rating: g.rating || 0,
      metacritic: g.metacritic || null,
      genres_text: (g.genres || []).map(x => x.name).join(', '),
      addedAt: new Date().toISOString()
    };
  }

  function addGame(rawgGame) {
    if (games.some(g => g.id === rawgGame.id)) {
      notify('Schon in der Sammlung');
      return;
    }
    games.push(gameFromRawg(rawgGame));
    saveGames();
    refresh();
    notify(`✓ "${rawgGame.name}" hinzugefügt`);
    if ($('add-modal').classList.contains('active')) searchGames();
    if (recommendationsLoaded) renderRecommendations();
  }

  // === DRAG & DROP ===
  function initDragDrop() {
    document.querySelectorAll('#view-ranking .tier-item').forEach(item => {
      item.addEventListener('dragstart', e => {
        e.currentTarget.classList.add('dragging');
        e.dataTransfer.setData('text/plain', e.currentTarget.dataset.id);
        e.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragend', e => e.currentTarget.classList.remove('dragging'));
    });
    document.querySelectorAll('#view-ranking .tier-items, #tier-unranked').forEach(container => {
      container.addEventListener('dragover', e => { e.preventDefault(); container.style.background = 'rgba(99,102,241,0.2)'; });
      container.addEventListener('dragleave', () => container.style.background = '');
      container.addEventListener('drop', e => {
        e.preventDefault();
        container.style.background = '';
        const id = parseInt(e.dataTransfer.getData('text/plain'), 10);
        const tier = container.dataset.tier;
        if (!tier || tier === 'unranked') {
          delete ranking[id];
        } else {
          ranking[id] = { tier, reason: (ranking[id] && ranking[id].reason) || '' };
        }
        saveRanking(true);
        refresh();
      });
    });
  }

  // === EMPFEHLUNGEN ===
  function topGenreSlugs() {
    let pool = games.filter(g => ['S', 'A'].includes(ranking[g.id] && ranking[g.id].tier));
    if (pool.length === 0) pool = games.filter(g => ranking[g.id] && ranking[g.id].tier);
    if (pool.length === 0) pool = games;

    const counts = {};
    pool.forEach(g => (g.genres_text || '').split(',').map(s => s.trim()).filter(Boolean)
      .forEach(name => { counts[name] = (counts[name] || 0) + 1; }));

    const topNames = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(e => e[0]);
    const slugs = topNames
      .map(n => GENRE_SLUGS[n.toLowerCase()] || n.toLowerCase().replace(/\s+/g, '-'))
      .filter(Boolean);
    return { names: topNames, slugs };
  }

  async function loadRecommendations(force) {
    if (recommendationsLoaded && !force) return;
    const grid = $('recommend-grid');
    grid.innerHTML = '<p class="empty-hint">⏳ Empfehlungen werden geladen...</p>';

    const { names, slugs } = topGenreSlugs();
    $('recommend-intro').textContent = names.length
      ? `Basierend auf deinen Lieblings-Genres: ${names.join(', ')}`
      : 'Beliebte Spiele für deinen Einstieg:';

    const owned = new Set(games.map(g => g.id));
    const fetchGames = async (withGenres) => {
      const qs = '/rawg/games?page_size=40' +
        (withGenres && slugs.length ? '&genres=' + encodeURIComponent(slugs.join(',')) : '');
      const data = await api(qs);
      return (data.results || []).filter(g => !owned.has(g.id)).slice(0, 24);
    };

    try {
      let results = [];
      try {
        results = await fetchGames(true);
      } catch (genreErr) {
        console.warn('Empfehlungen mit Genre-Filter fehlgeschlagen, versuche ohne Filter:', genreErr);
      }
      // Fallback: ohne Genre-Filter, falls die gefilterte Abfrage nichts brachte
      if (results.length === 0) {
        results = await fetchGames(false);
      }
      recommendations = results;
      recommendationsLoaded = true;
      renderRecommendations();
    } catch (e) {
      console.error('Empfehlungen:', e);
      grid.innerHTML =
        '<p class="empty-hint">⚠️ Empfehlungen konnten nicht geladen werden.<br>' +
        '<small style="color:var(--text-muted)">' + escapeHtml(e.message || 'Unbekannter Fehler') + '</small></p>';
    }
  }

  function renderRecommendations() {
    const grid = $('recommend-grid');
    const owned = new Set(games.map(g => g.id));
    const list = recommendations.filter(g => !owned.has(g.id));
    if (list.length === 0) {
      grid.innerHTML = '<p class="empty-hint">Keine neuen Empfehlungen – füge mehr Spiele hinzu oder aktualisiere.</p>';
      return;
    }
    grid.innerHTML = list.map((g, i) => {
      const cover = g.background_image || PLACEHOLDER;
      const year = g.released ? g.released.slice(0, 4) : '—';
      const genres = (g.genres || []).map(x => x.name).join(', ');
      const idx = recommendations.indexOf(g);
      return `
        <div class="game-card">
          <div class="gc-cover" style="background-image:url('${cover}')"></div>
          <div class="gc-body">
            <strong>${escapeHtml(g.name || '')}</strong>
            <span class="gc-meta">${year}${genres ? ' · ' + escapeHtml(genres) : ''}${g.rating ? ' · ⭐ ' + g.rating : ''}</span>
            <div class="gc-actions">
              <button onclick="GW.addRecommended(${idx})" style="background:var(--gradient-accent)">➕ Zur Sammlung</button>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  function addRecommended(index) {
    const g = recommendations[index];
    if (g) addGame(g);
  }

  // === SHARE ===
  function openShareModal() {
    $('share-preview').innerHTML = TIERS.map(tier => {
      const items = games.filter(g => ranking[g.id] && ranking[g.id].tier === tier);
      if (items.length === 0) return '';
      return `<div class="share-preview-tier"><div class="tier-badge" style="background:${TIER_COLORS[tier]}">${tier}</div><div class="tier-items-list">${items.map(i => escapeHtml(i.name)).join(', ')}</div></div>`;
    }).filter(Boolean).join('') || '<p style="text-align:center;color:var(--text-muted)">Noch nichts gerankt</p>';
    $('share-modal').classList.add('active');
  }

  function closeShareModal() {
    $('share-modal').classList.remove('active');
  }

  function copyShareText() {
    const text = '🎮 Mein Game-Ranking:\n\n' + TIERS.map(tier => {
      const items = games.filter(g => ranking[g.id] && ranking[g.id].tier === tier);
      return items.length ? `【${tier}】 ${items.map(i => i.name).join(', ')}` : '';
    }).filter(Boolean).join('\n');
    navigator.clipboard.writeText(text).then(() => notify('📋 Kopiert!'));
  }

  // === HELPER ===
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  // === PUBLIC API ===
  window.GW = {
    filterCollection, filterItems, changeItemsPerTier, toggleExpand,
    openModal, closeModal, setTier, saveReasonOnly, moveToUnranked, deleteGame, deleteGameById,
    resetRanking,
    openAddGameModal, closeAddModal, searchGames, addGame, addRecommended,
    openShareModal, closeShareModal, copyShareText,
    loadRecommendations,
    save: () => saveRanking(false)
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

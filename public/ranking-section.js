// Ranking als integrierte Sektion (portiert aus dem ehemaligen ranking.html).
// Komplett in einer IIFE gekapselt, damit es nicht mit index.js kollidiert.
// Onclick-Handler werden über das globale Objekt RK angesprochen.
(function () {
  const TMDB_IMG_BASE = 'https://image.tmdb.org/t/p/w300';
  const TIER_COLORS = { S: '#ff0066', A: '#ff6600', B: '#ffcc00', C: '#33cc33', D: '#3399ff', E: '#9966ff', F: '#666666' };
  const TIER_VALUES = { S: 7, A: 6, B: 5, C: 4, D: 3, E: 2, F: 1 };
  const TIERS = ['S', 'A', 'B', 'C', 'D', 'E', 'F'];

  let token = null;
  let watchlist = [];
  let ranking = {};
  let currentModalItem = null;
  let itemsPerTier = 10;
  let expandedTiers = {};
  let searchTerm = '';
  let typeFilter = '';
  let tierFilter = '';
  let initialized = false;

  const $ = (id) => document.getElementById(id);
  const notify = (msg) => (window.showSnackbar ? window.showSnackbar(msg) : console.log(msg));

  function api(endpoint, options) {
    return Auth.api(endpoint, token, options || {});
  }

  // === INIT ===
  async function init() {
    token = Auth.getToken();
    if (!token || initialized) return;
    if (!$('rk-tier-container')) return; // Sektion nicht vorhanden
    initialized = true;
    try {
      const wlData = await api('/watchlist');
      watchlist = wlData.watchlist || [];
      const rkData = await api('/ranking');
      const loaded = rkData.ranking || {};
      ranking = {};
      Object.entries(loaded).forEach(([id, value]) => {
        ranking[id] = typeof value === 'string' ? { tier: value, reason: '' } : value;
      });
      renderTiers();
    } catch (e) {
      console.error('❌ Ranking-Sektion:', e);
    }
  }

  async function saveRankingToServer(silent) {
    try {
      await api('/ranking', { method: 'POST', body: { ranking } });
      if (!silent) notify('💾 Ranking gespeichert!');
      return true;
    } catch (e) {
      console.error('Save error:', e);
      if (!silent) notify('⚠️ Speichern fehlgeschlagen');
      return false;
    }
  }

  // === RENDER ===
  function renderTiers() {
    $('rk-tier-container').innerHTML = TIERS.map(tier => `
      <div class="tier-row" data-tier="${tier}">
        <div class="tier-label tier-${tier.toLowerCase()}" onclick="RK.toggleExpand('${tier}')">
          ${tier}
          <span class="tier-count" id="rk-count-${tier}">0</span>
        </div>
        <div class="tier-items" data-tier="${tier}" id="rk-tier-${tier}"></div>
      </div>
    `).join('');
    updateAllTiers();
  }

  function updateAllTiers() {
    TIERS.forEach(tier => {
      const items = getFilteredItems(tier);
      const container = $('rk-tier-' + tier);
      const isExpanded = expandedTiers[tier];
      const visible = isExpanded ? items : items.slice(0, itemsPerTier);

      $('rk-count-' + tier).textContent = items.length;

      let html = visible.map(createItemHTML).join('');
      if (items.length > itemsPerTier && !isExpanded) {
        html += `<button class="tier-expand-btn" onclick="event.stopPropagation();RK.toggleExpand('${tier}')">+${items.length - itemsPerTier} weitere</button>`;
      } else if (isExpanded && items.length > itemsPerTier) {
        html += `<button class="tier-expand-btn collapse" onclick="event.stopPropagation();RK.toggleExpand('${tier}')">▲ Einklappen</button>`;
      }
      container.innerHTML = html;
    });

    const unranked = getFilteredItems('unranked');
    $('rk-tier-unranked').innerHTML = unranked.map(createItemHTML).join('');
    $('rk-unranked-count').textContent = unranked.length + ' Items';

    updateStats();
    initDragDrop();
  }

  function getItemKind(item) {
    const type = (item.media_type || item.type || '').toLowerCase();
    if (type === 'anime' || item.anilist_id || (item.poster_path || '').includes('anilist.co')) return 'anime';
    if (type === 'movie') return 'movie';
    if (type === 'tv') return 'tv';
    return '';
  }

  function matchesFilters(item) {
    if (searchTerm && !`${item.title || ''} ${item.name || ''}`.toLowerCase().includes(searchTerm)) return false;
    if (typeFilter && getItemKind(item) !== typeFilter) return false;
    return true;
  }

  function getFilteredItems(forTier) {
    return watchlist.filter(item => {
      const itemTier = (ranking[item.id] && ranking[item.id].tier) || 'unranked';
      if (itemTier !== forTier) return false;
      if (tierFilter && tierFilter !== itemTier) return false;
      return matchesFilters(item);
    });
  }

  function posterUrl(item) {
    const p = item.poster_path || '';
    return p.startsWith('http') ? p : (p ? TMDB_IMG_BASE + p : 'https://via.placeholder.com/70x100?text=No+Image');
  }

  function createItemHTML(item) {
    const reason = (ranking[item.id] && ranking[item.id].reason) || '';
    return `
      <div class="tier-item" data-id="${item.id}" draggable="true" onclick="RK.openModal(${item.id})">
        <img src="${posterUrl(item)}" alt="${item.title || item.name}" draggable="false" onerror="this.src='https://via.placeholder.com/70x100?text=Error'">
        <div class="item-title">${item.title || item.name}</div>
        ${reason ? `<div class="item-reason">${reason}</div>` : ''}
      </div>
    `;
  }

  function updateStats() {
    const filtered = watchlist.filter(matchesFilters);
    let ranked = 0, unranked = 0, sum = 0;
    filtered.forEach(item => {
      if (ranking[item.id] && ranking[item.id].tier) {
        ranked++;
        sum += TIER_VALUES[ranking[item.id].tier] || 0;
      } else {
        unranked++;
      }
    });
    $('rk-total-ranked').textContent = ranked;
    $('rk-total-unranked').textContent = unranked;
    if (ranked > 0) {
      const avg = sum / ranked;
      $('rk-avg-tier').textContent = Object.keys(TIER_VALUES).find(k => TIER_VALUES[k] === Math.round(avg)) || '-';
    } else {
      $('rk-avg-tier').textContent = '-';
    }
  }

  // === INTERACTIONS ===
  function filterItems() {
    searchTerm = $('rk-search-input').value.toLowerCase();
    typeFilter = $('rk-type-filter').value;
    tierFilter = $('rk-tier-filter').value;
    updateAllTiers();
  }

  function changeItemsPerTier() {
    itemsPerTier = parseInt($('rk-items-per-tier').value, 10);
    expandedTiers = {};
    updateAllTiers();
  }

  function toggleExpand(tier) {
    expandedTiers[tier] = !expandedTiers[tier];
    updateAllTiers();
  }

  function formatType(item) {
    const kind = getItemKind(item);
    if (kind === 'anime') return '🎌 Anime';
    if (kind === 'movie') return '🎬 Film';
    if (kind === 'tv') return '📺 Serie';
    return 'Unbekannt';
  }

  function openModal(id) {
    const item = watchlist.find(i => i.id === id);
    if (!item) return;
    currentModalItem = item;
    $('rk-modal-poster').src = posterUrl(item).replace('70x100', '150x225');
    $('rk-modal-title').textContent = item.title || item.name;
    $('rk-modal-type').textContent = formatType(item);
    $('rk-modal-reason').value = (ranking[id] && ranking[id].reason) || '';
    $('rk-tier-selector').innerHTML = TIERS.map(t => `
      <button onclick="RK.setTier('${t}')" class="tier-${t.toLowerCase()}" style="background:${TIER_COLORS[t]}">${t}</button>
    `).join('');
    $('rk-item-modal').classList.add('active');
  }

  function closeModal() {
    $('rk-item-modal').classList.remove('active');
    currentModalItem = null;
  }

  function setTier(tier) {
    if (!currentModalItem) return;
    ranking[currentModalItem.id] = { tier, reason: $('rk-modal-reason').value };
    saveRankingToServer(true);
    updateAllTiers();
    const name = currentModalItem.title || currentModalItem.name;
    closeModal();
    notify(`${name} → Tier ${tier}`);
  }

  function saveReasonOnly() {
    if (!currentModalItem) return;
    const currentTier = ranking[currentModalItem.id] && ranking[currentModalItem.id].tier;
    if (currentTier) {
      ranking[currentModalItem.id] = { tier: currentTier, reason: $('rk-modal-reason').value };
      saveRankingToServer(true);
      updateAllTiers();
      closeModal();
      notify('✓ Gespeichert');
    }
  }

  function moveToUnranked() {
    if (!currentModalItem) return;
    delete ranking[currentModalItem.id];
    saveRankingToServer(true);
    updateAllTiers();
    closeModal();
  }

  function resetRanking() {
    if (confirm('Ranking wirklich zurücksetzen?')) {
      ranking = {};
      saveRankingToServer(true);
      updateAllTiers();
      notify('🔄 Zurückgesetzt');
    }
  }

  // === DRAG & DROP ===
  function initDragDrop() {
    document.querySelectorAll('#ranking-section .tier-item').forEach(item => {
      item.addEventListener('dragstart', e => {
        e.currentTarget.classList.add('dragging');
        e.dataTransfer.setData('text/plain', e.currentTarget.dataset.id);
        e.dataTransfer.effectAllowed = 'move';
      });
      item.addEventListener('dragend', e => e.currentTarget.classList.remove('dragging'));
    });
    document.querySelectorAll('#ranking-section .tier-items, #rk-tier-unranked').forEach(container => {
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
        saveRankingToServer(true);
        updateAllTiers();
      });
    });
  }

  // === SHARE ===
  function openShareModal() {
    $('rk-share-preview').innerHTML = TIERS.map(tier => {
      const items = watchlist.filter(i => ranking[i.id] && ranking[i.id].tier === tier);
      if (items.length === 0) return '';
      return `<div class="share-preview-tier"><div class="tier-badge" style="background:${TIER_COLORS[tier]}">${tier}</div><div class="tier-items-list">${items.map(i => i.title || i.name).join(', ')}</div></div>`;
    }).filter(Boolean).join('') || '<p style="text-align:center;color:var(--text-muted)">Noch nichts gerankt</p>';
    $('rk-share-modal').classList.add('active');
  }

  function closeShareModal() {
    $('rk-share-modal').classList.remove('active');
  }

  function copyShareLink() {
    const text = '🎯 Mein Ranking:\n\n' + TIERS.map(tier => {
      const items = watchlist.filter(i => ranking[i.id] && ranking[i.id].tier === tier);
      return items.length ? `【${tier}】 ${items.map(i => i.title || i.name).join(', ')}` : '';
    }).filter(Boolean).join('\n');
    navigator.clipboard.writeText(text).then(() => notify('📋 Kopiert!'));
  }

  // === PUBLIC API ===
  window.RK = {
    filterItems, changeItemsPerTier, toggleExpand, openModal, closeModal,
    setTier, saveReasonOnly, moveToUnranked, resetRanking,
    openShareModal, closeShareModal, copyShareLink,
    save: () => saveRankingToServer(false)
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Modals per Klick auf den Hintergrund schließen
  document.addEventListener('click', e => {
    if (e.target.id === 'rk-item-modal') closeModal();
    if (e.target.id === 'rk-share-modal') closeShareModal();
  });
})();

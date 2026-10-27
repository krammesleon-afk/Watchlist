// Freunde & gemeinsame Listen. Gekapselt in einer IIFE; Handler über FR.
(function () {
  const TMDB_IMG = 'https://image.tmdb.org/t/p/w300';
  const PLACEHOLDER_P = 'https://via.placeholder.com/150x225?text=No+Image';
  const PLACEHOLDER_G = 'https://via.placeholder.com/300x170?text=No+Image';

  const token = Auth.requireAuth();
  if (!token) return;

  const me = jwtPayload(token); // { id, username }

  let friends = [];
  let incoming = [];
  let outgoing = [];
  let lists = [];
  let currentList = null;
  let searchDebounce = null;
  let myWatchlist = [];   // eigene Watchlist – für "Gemeinsam"-Vergleich
  let myGames = [];       // eigene Game-Sammlung – für "Gemeinsam"-Vergleich
  let profile = null;     // aktuell geöffnetes Freund-Profil
  let minePickerOpen = false; // "Aus meiner Sammlung"-Picker offen?

  const $ = (id) => document.getElementById(id);
  const api = (path, options) => Auth.api(path, token, options || {});

  function jwtPayload(t) {
    try {
      let p = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (p.length % 4) p += '=';
      return JSON.parse(atob(p));
    } catch (e) { return {}; }
  }

  function notify(msg) {
    const bar = $('snackbar');
    if (!bar) return;
    bar.textContent = msg;
    bar.classList.add('show');
    clearTimeout(notify._t);
    notify._t = setTimeout(() => bar.classList.remove('show'), 3000);
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function initials(name) {
    return (name || '?').trim().slice(0, 2).toUpperCase();
  }

  // === INIT ===
  async function init() {
    document.querySelectorAll('.ftab').forEach((tab) => {
      tab.addEventListener('click', () => showView(tab.dataset.view));
    });
    await loadFriends();
    await loadLists();
    await loadMyCollections();
  }

  function showView(name) {
    document.querySelectorAll('.ftab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
    $('view-friends').style.display = name === 'friends' ? '' : 'none';
    $('view-lists').style.display = name === 'lists' ? '' : 'none';
    if (name === 'friends') closeProfile(); // beim Tab-Wechsel zurück zur Übersicht
  }

  // Eigene Watchlist + Games laden (für den Gemeinsamkeiten-Vergleich im Profil)
  async function loadMyCollections() {
    try {
      const [wl, gm] = await Promise.all([api('/watchlist'), api('/games')]);
      myWatchlist = wl.watchlist || [];
      myGames = gm.games || [];
    } catch (e) {
      console.error('Eigene Sammlungen konnten nicht geladen werden:', e);
    }
  }

  // ================= FREUNDE =================
  async function loadFriends() {
    try {
      const data = await api('/friends');
      friends = data.friends || [];
      incoming = data.incoming || [];
      outgoing = data.outgoing || [];
      renderFriends();
    } catch (e) {
      console.error(e);
      notify('⚠️ Freunde konnten nicht geladen werden');
    }
  }

  function renderFriends() {
    // Eingehende Anfragen
    $('incoming-requests').innerHTML = incoming.length
      ? incoming.map((r) => `
        <div class="fr-row">
          <div class="fr-avatar">${initials(r.username)}</div>
          <div class="fr-name">${escapeHtml(r.username)}<div class="fr-sub">möchte dich hinzufügen</div></div>
          <button class="btn-pink" onclick="FR.respond(${r.requestId}, true)">✓ Annehmen</button>
          <button onclick="FR.respond(${r.requestId}, false)" style="background:linear-gradient(135deg,#374151,#4b5563)">✕ Ablehnen</button>
        </div>`).join('')
      : '<p class="fr-empty">Keine eingehenden Anfragen.</p>';

    // Ausgehende Anfragen
    $('outgoing-requests').innerHTML = outgoing.length
      ? '<p class="fr-sub" style="margin:14px 0 6px;">Gesendet:</p>' + outgoing.map((r) => `
        <div class="fr-row">
          <div class="fr-avatar">${initials(r.username)}</div>
          <div class="fr-name">${escapeHtml(r.username)}<div class="fr-sub">wartet auf Antwort</div></div>
          <button onclick="FR.removeFriend(${r.requestId})" style="background:linear-gradient(135deg,#374151,#4b5563)">Zurückziehen</button>
        </div>`).join('')
      : '';

    // Freundesliste
    $('friends-list').innerHTML = friends.length
      ? friends.map((f) => `
        <div class="fr-row fr-row-click" onclick="FR.openProfile(${f.id})" title="Profil ansehen">
          <div class="fr-avatar">${initials(f.username)}</div>
          <div class="fr-name">${escapeHtml(f.username)}<div class="fr-sub">Profil ansehen →</div></div>
          <button onclick="event.stopPropagation();FR.removeFriend(${f.friendshipId})" style="background:linear-gradient(135deg,#b91c1c,#dc2626)">Entfernen</button>
        </div>`).join('')
      : '<p class="fr-empty">Noch keine Freunde. Suche oben nach Benutzern.</p>';
  }

  // ================= FREUND-PROFIL =================
  function wlKey(it) {
    return (it.media_type || it.type || 'movie') + '_' + it.id;
  }

  function posterUrl(path) {
    if (!path) return PLACEHOLDER_P;
    return path.startsWith('http') ? path : TMDB_IMG + path;
  }

  function statCard(num, label) {
    return `<div class="stat-card"><div class="sc-num">${num}</div><div class="sc-label">${label}</div></div>`;
  }

  function movieCard(it) {
    const t = it.media_type || it.type;
    const typeLabel = t === 'tv' ? 'Serie' : t === 'anime' ? 'Anime' : 'Film';
    const flags = (it.seen ? '✅ Gesehen ' : '') + (it.favorite ? '⭐' : '');
    return `
      <div class="item-card">
        <div class="ic-cover" style="background-image:url('${posterUrl(it.poster_path)}')"></div>
        <div class="ic-body">
          <strong>${escapeHtml(it.title || it.name || 'Unbekannt')}</strong>
          <span class="ic-meta">${typeLabel}</span>
          ${flags ? `<span class="ic-meta">${flags}</span>` : ''}
        </div>
      </div>`;
  }

  function gameCard(g) {
    return `
      <div class="item-card game">
        <div class="ic-cover" style="background-image:url('${g.background_image || PLACEHOLDER_G}')"></div>
        <div class="ic-body">
          <strong>${escapeHtml(g.name || 'Unbekannt')}</strong>
          <span class="ic-meta">${escapeHtml(g.genres_text || '')}</span>
        </div>
      </div>`;
  }

  async function openProfile(friendId) {
    try {
      profile = await api('/friends/' + friendId + '/profile');
      $('friends-main').style.display = 'none';
      $('friend-profile').style.display = 'block';
      window.scrollTo(0, 0);
      renderProfile();
    } catch (e) {
      notify('⚠️ ' + e.message);
    }
  }

  function closeProfile() {
    profile = null;
    $('friend-profile').style.display = 'none';
    $('friends-main').style.display = 'block';
  }

  function renderProfile() {
    if (!profile) return;
    $('profile-avatar').textContent = initials(profile.username);
    $('profile-name').textContent = profile.username;

    const wl = profile.watchlist || [];
    const gm = profile.games || [];
    const seen = wl.filter((i) => i.seen).length;
    const favs = wl.filter((i) => i.favorite).length;

    $('profile-stats').innerHTML = [
      statCard(wl.length, '🎬 Filme & Serien'),
      statCard(seen, '✅ Gesehen'),
      statCard(favs, '⭐ Favoriten'),
      statCard(gm.length, '🎮 Games'),
    ].join('');

    // Gemeinsamkeiten mit der eigenen Sammlung
    const myWlKeys = new Set(myWatchlist.map(wlKey));
    const myGmIds = new Set(myGames.map((g) => g.id));
    const commonWl = wl.filter((i) => myWlKeys.has(wlKey(i)));
    const commonGm = gm.filter((g) => myGmIds.has(g.id));
    $('profile-common').innerHTML = (commonWl.length + commonGm.length)
      ? commonWl.map(movieCard).join('') + commonGm.map(gameCard).join('')
      : '<p class="fr-empty">Noch keine gemeinsamen Titel.</p>';

    $('profile-movies-title').textContent = `🎬 Filme & Serien (${wl.length})`;
    $('profile-movies').innerHTML = wl.length
      ? wl.map(movieCard).join('')
      : '<p class="fr-empty">Watchlist ist leer.</p>';

    $('profile-games-title').textContent = `🎮 Games (${gm.length})`;
    $('profile-games').innerHTML = gm.length
      ? gm.map(gameCard).join('')
      : '<p class="fr-empty">Keine Games in der Sammlung.</p>';
  }

  function relationOf(userId) {
    if (friends.some((f) => f.id === userId)) return 'friend';
    if (incoming.some((r) => r.id === userId)) return 'incoming';
    if (outgoing.some((r) => r.id === userId)) return 'outgoing';
    return 'none';
  }

  function searchUsers() {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(doSearchUsers, 300);
  }

  async function doSearchUsers() {
    const q = $('user-search').value.trim();
    const box = $('user-search-results');
    if (q.length < 2) { box.innerHTML = ''; return; }
    try {
      const data = await api('/users/search?q=' + encodeURIComponent(q));
      const users = data.users || [];
      if (users.length === 0) { box.innerHTML = '<p class="fr-empty">Keine Benutzer gefunden.</p>'; return; }
      box.innerHTML = users.map((u) => {
        const rel = relationOf(u.id);
        const label = { friend: '✓ Befreundet', incoming: 'Hat dir geschrieben', outgoing: 'Anfrage gesendet', none: '➕ Anfrage' }[rel];
        return `
          <div class="fr-row">
            <div class="fr-avatar">${initials(u.username)}</div>
            <div class="fr-name">${escapeHtml(u.username)}</div>
            <button class="btn-pink" onclick="FR.sendRequest('${escapeHtml(u.username)}')" ${rel === 'none' ? '' : 'disabled'}>${label}</button>
          </div>`;
      }).join('');
    } catch (e) {
      box.innerHTML = '<p class="fr-empty">Fehler bei der Suche.</p>';
    }
  }

  async function sendRequest(username) {
    try {
      await api('/friends/request', { method: 'POST', body: { username } });
      notify('✓ Anfrage gesendet');
      await loadFriends();
      doSearchUsers();
    } catch (e) {
      notify('⚠️ ' + e.message);
    }
  }

  async function respond(requestId, accept) {
    try {
      await api('/friends/respond', { method: 'POST', body: { requestId, accept } });
      notify(accept ? '✓ Freund hinzugefügt' : 'Anfrage abgelehnt');
      await loadFriends();
    } catch (e) {
      notify('⚠️ ' + e.message);
    }
  }

  async function removeFriend(id) {
    if (!confirm('Wirklich entfernen?')) return;
    try {
      await api('/friends/' + id, { method: 'DELETE' });
      notify('Entfernt');
      await loadFriends();
    } catch (e) {
      notify('⚠️ ' + e.message);
    }
  }

  // ================= GEMEINSAME LISTEN =================
  async function loadLists() {
    try {
      const data = await api('/shared-lists');
      lists = data.lists || [];
      renderLists();
    } catch (e) {
      console.error(e);
      notify('⚠️ Listen konnten nicht geladen werden');
    }
  }

  function kindLabel(kind) {
    return { movies: '🎬 Filme & Serien', games: '🎮 Games', mixed: '🎬🎮 Gemischt' }[kind] || kind;
  }

  function renderLists() {
    const grid = $('lists-grid');
    if (lists.length === 0) {
      grid.innerHTML = '<p class="fr-empty">Noch keine Listen. Erstelle oben eine neue.</p>';
      return;
    }
    grid.innerHTML = lists.map((l) => `
      <div class="list-card" onclick="FR.openList(${l.id})">
        <h3>${escapeHtml(l.name)}</h3>
        <div class="lc-meta">
          ${l.isOwner ? 'Deine Liste' : 'von ' + escapeHtml(l.owner_username)}
          · ${l.member_count + 1} Teilnehmer
        </div>
        <span class="list-kind">${kindLabel(l.kind)}</span>
      </div>`).join('');
  }

  async function createList() {
    const name = $('new-list-name').value.trim();
    const kind = $('new-list-kind').value;
    if (!name) { notify('Bitte einen Namen eingeben'); return; }
    try {
      const res = await api('/shared-lists', { method: 'POST', body: { name, kind } });
      $('new-list-name').value = '';
      notify('✓ Liste erstellt');
      await loadLists();
      if (res.id) openList(res.id);
    } catch (e) {
      notify('⚠️ ' + e.message);
    }
  }

  async function openList(id) {
    try {
      currentList = await api('/shared-lists/' + id);
      $('lists-overview').style.display = 'none';
      $('list-detail').style.display = 'block';
      renderDetail();
    } catch (e) {
      notify('⚠️ ' + e.message);
    }
  }

  function closeList() {
    currentList = null;
    $('list-detail').style.display = 'none';
    $('lists-overview').style.display = 'block';
    $('item-search-results').innerHTML = '';
    $('item-search').value = '';
    loadLists();
  }

  function renderDetail() {
    if (!currentList) return;
    $('detail-name').textContent = currentList.name;
    $('detail-kind').textContent = kindLabel(currentList.kind);
    $('detail-owner').textContent = currentList.isOwner
      ? 'Du bist Besitzer'
      : 'Besitzer: ' + currentList.owner_username;
    $('detail-delete').textContent = currentList.isOwner ? '🗑️ Liste löschen' : '🚪 Liste verlassen';

    // Mitglieder
    const memberRows = [
      `<div class="fr-row">
        <div class="fr-avatar">${initials(currentList.owner_username)}</div>
        <div class="fr-name">${escapeHtml(currentList.owner_username)}<div class="fr-sub">Besitzer</div></div>
      </div>`
    ].concat((currentList.members || []).map((m) => `
      <div class="fr-row">
        <div class="fr-avatar">${initials(m.username)}</div>
        <div class="fr-name">${escapeHtml(m.username)}</div>
        ${currentList.isOwner ? `<button onclick="FR.removeMember(${m.id})" style="background:linear-gradient(135deg,#374151,#4b5563)">Entfernen</button>` : ''}
      </div>`));
    $('detail-members').innerHTML = memberRows.join('');

    // Freund-hinzufügen (nur Besitzer)
    const addBar = $('add-member-bar');
    if (currentList.isOwner) {
      const memberIds = new Set((currentList.members || []).map((m) => m.id));
      const addable = friends.filter((f) => !memberIds.has(f.id));
      addBar.style.display = addable.length ? 'flex' : 'none';
      $('add-member-select').innerHTML = addable.map((f) => `<option value="${f.id}">${escapeHtml(f.username)}</option>`).join('');
    } else {
      addBar.style.display = 'none';
    }

    // Item-Quelle bei gemischten Listen
    $('item-source').style.display = currentList.kind === 'mixed' ? '' : 'none';

    // "Aus meiner Sammlung"-Picker zurücksetzen
    minePickerOpen = false;
    $('mine-picker').style.display = 'none';
    $('mine-toggle').textContent = '📥 Aus meiner Sammlung übernehmen';
    $('mine-search').value = '';
    $('mine-results').innerHTML = '';

    renderItems();
  }

  function itemCard(it) {
    const isGame = it.kind === 'game';
    const ph = isGame ? PLACEHOLDER_G : PLACEHOLDER_P;
    const hasComment = it.comment && it.comment.trim();
    const badge = hasComment
      ? `<span class="ic-comment" data-tip="${escapeHtml(it.comment)}">💬</span>`
      : '';
    return `
      <div class="item-card ${isGame ? 'game' : ''}">
        <div class="ic-cover" style="background-image:url('${it.image || ph}')">${badge}</div>
        <div class="ic-body">
          <strong>${escapeHtml(it.title)}</strong>
          <span class="ic-meta">${escapeHtml(it.meta || '')}</span>
          <span class="ic-meta">+ ${escapeHtml(it.addedBy || '?')}</span>
          <div class="ic-actions">
            <button class="ic-comment-btn" onclick="FR.editComment('${escapeHtml(it.key)}')">💬 ${hasComment ? 'Kommentar' : 'Notiz'}</button>
            <button onclick="FR.removeItem('${escapeHtml(it.key)}')">🗑️</button>
          </div>
        </div>
      </div>`;
  }

  function sectionHtml(title, items) {
    if (!items.length) return '';
    return `
      <div class="list-section">
        <h3 class="list-section-title">${title} (${items.length})</h3>
        <div class="item-grid">${items.map(itemCard).join('')}</div>
      </div>`;
  }

  function renderItems() {
    if (!currentList) return;
    const data = currentList.data || [];
    $('detail-items-title').textContent = `Einträge (${data.length})`;
    const grid = $('detail-items');
    if (data.length === 0) {
      grid.innerHTML = '<p class="fr-empty">Noch keine Einträge. Suche oben nach Titeln.</p>';
      return;
    }
    if (currentList.kind === 'mixed') {
      const movies = data.filter((it) => it.kind !== 'game');
      const games = data.filter((it) => it.kind === 'game');
      grid.innerHTML = sectionHtml('🎬 Filme & Serien', movies) + sectionHtml('🎮 Games', games);
    } else {
      grid.innerHTML = `<div class="item-grid">${data.map(itemCard).join('')}</div>`;
    }
  }

  // Kommentar zu einem Eintrag bearbeiten (per Hover lesbar)
  function editComment(key) {
    const it = (currentList.data || []).find((i) => i.key === key);
    if (!it) return;
    const val = prompt('Kommentar zu "' + it.title + '"\n(leer lassen zum Entfernen):', it.comment || '');
    if (val === null) return;
    it.comment = val.trim().slice(0, 280);
    saveListData();
    renderItems();
    notify(it.comment ? '✓ Kommentar gespeichert' : 'Kommentar entfernt');
  }

  async function addMember() {
    const userId = parseInt($('add-member-select').value, 10);
    if (!userId) return;
    try {
      await api('/shared-lists/' + currentList.id + '/members', { method: 'POST', body: { userId } });
      notify('✓ Mitglied hinzugefügt');
      currentList = await api('/shared-lists/' + currentList.id);
      renderDetail();
    } catch (e) {
      notify('⚠️ ' + e.message);
    }
  }

  async function removeMember(userId) {
    try {
      await api('/shared-lists/' + currentList.id + '/members/' + userId, { method: 'DELETE' });
      notify('Mitglied entfernt');
      currentList = await api('/shared-lists/' + currentList.id);
      renderDetail();
    } catch (e) {
      notify('⚠️ ' + e.message);
    }
  }

  async function deleteOrLeave() {
    if (currentList.isOwner) {
      if (!confirm('Liste "' + currentList.name + '" wirklich löschen?')) return;
      try {
        await api('/shared-lists/' + currentList.id, { method: 'DELETE' });
        notify('Liste gelöscht');
        closeList();
      } catch (e) { notify('⚠️ ' + e.message); }
    } else {
      if (!confirm('Liste wirklich verlassen?')) return;
      try {
        await api('/shared-lists/' + currentList.id + '/members/' + me.id, { method: 'DELETE' });
        notify('Liste verlassen');
        closeList();
      } catch (e) { notify('⚠️ ' + e.message); }
    }
  }

  // === Listeninhalt speichern (gemeinsame Bearbeitung) ===
  async function saveListData() {
    try {
      await api('/shared-lists/' + currentList.id, {
        method: 'PUT',
        body: { data: currentList.data, name: currentList.name },
      });
    } catch (e) {
      notify('⚠️ Speichern fehlgeschlagen: ' + e.message);
    }
  }

  // === Einträge suchen & hinzufügen ===
  function activeSource() {
    if (currentList.kind === 'games') return 'game';
    if (currentList.kind === 'movies') return 'movie';
    return $('item-source').value; // mixed
  }

  async function searchItems() {
    const q = $('item-search').value.trim();
    const box = $('item-search-results');
    if (!q) { box.innerHTML = '<p class="fr-empty">Bitte einen Suchbegriff eingeben.</p>'; return; }
    box.innerHTML = '<p class="fr-empty">⏳ Suche läuft...</p>';
    try {
      const source = activeSource();
      let items = [];
      if (source === 'game') {
        const data = await api('/rawg/search?query=' + encodeURIComponent(q));
        items = (data.results || []).map((g) => ({
          key: 'game_' + g.id, kind: 'game', refId: g.id,
          title: g.name || '',
          image: g.background_image || '',
          meta: (g.released ? g.released.slice(0, 4) : '') +
                ((g.genres || []).length ? ' · ' + g.genres.map((x) => x.name).join(', ') : ''),
        }));
      } else {
        const data = await api('/tmdb/search/multi?query=' + encodeURIComponent(q));
        items = (data.results || [])
          .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
          .map((r) => ({
            key: r.media_type + '_' + r.id, kind: r.media_type, refId: r.id,
            title: r.title || r.name || '',
            image: r.poster_path ? TMDB_IMG + r.poster_path : '',
            meta: (r.media_type === 'tv' ? 'Serie' : 'Film') +
                  ((r.release_date || r.first_air_date) ? ' · ' + (r.release_date || r.first_air_date).slice(0, 4) : ''),
          }));
      }
      renderSearchResults(items);
    } catch (e) {
      box.innerHTML = '<p class="fr-empty">Fehler bei der Suche: ' + escapeHtml(e.message) + '</p>';
    }
  }

  function renderSearchResults(items) {
    const box = $('item-search-results');
    if (items.length === 0) { box.innerHTML = '<p class="fr-empty">Keine Treffer.</p>'; return; }
    const existing = new Set((currentList.data || []).map((i) => i.key));
    // Suchergebnisse zwischenspeichern, damit addItem darauf zugreifen kann
    searchItems._cache = {};
    box.innerHTML = items.map((it) => {
      searchItems._cache[it.key] = it;
      const inList = existing.has(it.key);
      return `
        <div class="search-result">
          <img src="${it.image || (it.kind === 'game' ? PLACEHOLDER_G : PLACEHOLDER_P)}" alt=""
               onerror="this.src='${it.kind === 'game' ? PLACEHOLDER_G : PLACEHOLDER_P}'">
          <div class="sr-info">
            <strong>${escapeHtml(it.title)}</strong>
            <span>${escapeHtml(it.meta)}</span>
          </div>
          <button class="btn-pink" onclick="FR.addItem('${escapeHtml(it.key)}')" ${inList ? 'disabled' : ''}>
            ${inList ? '✓ Drin' : '➕ Add'}
          </button>
        </div>`;
    }).join('');
  }

  // Eintrag zur Liste hinzufügen – gemeinsam genutzt von Suche & Sammlung
  function addSharedItem(it) {
    if (!it) return false;
    currentList.data = currentList.data || [];
    if (currentList.data.some((i) => i.key === it.key)) {
      notify('Schon in der Liste');
      return false;
    }
    currentList.data.push(Object.assign({}, it, { addedBy: me.username || 'Ich' }));
    saveListData();
    renderItems();
    notify(`✓ "${it.title}" hinzugefügt`);
    return true;
  }

  function addItem(key) {
    const it = searchItems._cache && searchItems._cache[key];
    if (!it) return;
    addSharedItem(it);
    renderSearchResults(Object.values(searchItems._cache || {}));
  }

  function removeItem(key) {
    currentList.data = (currentList.data || []).filter((i) => i.key !== key);
    saveListData();
    renderItems();
    if (searchItems._cache) renderSearchResults(Object.values(searchItems._cache));
    if (minePickerOpen) renderMine();
  }

  // ====== Aus eigener Sammlung übernehmen ======
  // Wandelt einen Watchlist-Eintrag ins Format der geteilten Liste
  function watchlistToItem(it) {
    const t = it.media_type || it.type || 'movie';
    const kind = t === 'tv' || t === 'anime' ? 'tv' : 'movie';
    const year = String(it.release_date || it.first_air_date || '').slice(0, 4);
    let image = '';
    if (it.poster_path) image = it.poster_path.startsWith('http') ? it.poster_path : TMDB_IMG + it.poster_path;
    return {
      key: t + '_' + it.id,
      kind,
      refId: it.id,
      title: it.title || it.name || 'Unbekannt',
      image,
      meta: (kind === 'tv' ? 'Serie' : 'Film') + (year ? ' · ' + year : ''),
    };
  }

  // Wandelt einen Game-Eintrag ins Format der geteilten Liste
  function gameToItem(g) {
    return {
      key: 'game_' + g.id,
      kind: 'game',
      refId: g.id,
      title: g.name || 'Unbekannt',
      image: g.background_image || '',
      meta: g.genres_text || '',
    };
  }

  function toggleMinePicker() {
    minePickerOpen = !minePickerOpen;
    $('mine-picker').style.display = minePickerOpen ? '' : 'none';
    $('mine-toggle').textContent = minePickerOpen
      ? '✕ Schließen'
      : '📥 Aus meiner Sammlung übernehmen';
    if (minePickerOpen) renderMine();
  }

  // Bei gemischten Listen umschaltbar zwischen Filmen/Games
  function onSourceChange() {
    if (minePickerOpen) renderMine();
  }

  function renderMine() {
    const box = $('mine-results');
    if (!box) return;
    const source = activeSource();
    const q = ($('mine-search').value || '').trim().toLowerCase();
    let items = source === 'game' ? myGames.map(gameToItem) : myWatchlist.map(watchlistToItem);
    if (q) items = items.filter((it) => it.title.toLowerCase().includes(q));
    if (items.length === 0) {
      box.innerHTML = `<p class="fr-empty">${source === 'game'
        ? 'Keine Games in deiner Sammlung.'
        : 'Nichts in deiner Watchlist gefunden.'}</p>`;
      return;
    }
    const existing = new Set((currentList.data || []).map((i) => i.key));
    renderMine._cache = {};
    box.innerHTML = items.slice(0, 60).map((it) => {
      renderMine._cache[it.key] = it;
      const inList = existing.has(it.key);
      const ph = it.kind === 'game' ? PLACEHOLDER_G : PLACEHOLDER_P;
      return `
        <div class="search-result">
          <img src="${it.image || ph}" alt="" onerror="this.src='${ph}'">
          <div class="sr-info">
            <strong>${escapeHtml(it.title)}</strong>
            <span>${escapeHtml(it.meta)}</span>
          </div>
          <button class="btn-pink" onclick="FR.addMineItem('${escapeHtml(it.key)}')" ${inList ? 'disabled' : ''}>
            ${inList ? '✓ Drin' : '➕ Add'}
          </button>
        </div>`;
    }).join('');
  }

  function addMineItem(key) {
    const it = renderMine._cache && renderMine._cache[key];
    if (!it) return;
    if (addSharedItem(it)) renderMine();
  }

  // === PUBLIC API ===
  window.FR = {
    searchUsers, sendRequest, respond, removeFriend,
    openProfile, closeProfile,
    createList, openList, closeList, addMember, removeMember, deleteOrLeave,
    searchItems, addItem, removeItem, editComment,
    toggleMinePicker, onSourceChange, renderMine, addMineItem,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

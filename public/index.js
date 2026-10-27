// TMDB API - über Server-Proxy (sicherer!)
// TMDB-Anfragen laufen über den Server-Proxy, damit der API-Key nicht im Browser landet
function tmdbFetch(path) {
  return fetch('/api/tmdb' + path, { headers: { 'Authorization': 'Bearer ' + token } });
}
const TMDB_IMG_BASE = "https://image.tmdb.org/t/p/w300";

// Javis Easter Egg - Chat mit mir! 🤖
async function chatWithJavis() {
  try {
    const res = await fetch('/api/javis', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    const data = await res.json();
    showSnackbar("🤖 Javis: " + data.message, 5000);
  } catch (e) {
    showSnackbar("Javis schläft gerade... 😴", 3000);
  }
}
window.chatWithJavis = chatWithJavis;

// Konami Code Easter Egg: ↑↑↓↓←→←→BA
let konamiCode = [];
const konamiSequence = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];
document.addEventListener('keydown', (e) => {
  konamiCode.push(e.code);
  if (konamiCode.length > 10) konamiCode.shift();
  if (konamiCode.join(',') === konamiSequence.join(',')) {
    document.body.style.animation = 'rainbow 2s ease';
    showSnackbar("🎮 Konami Code aktiviert! Javis grüßt! 👌");
    chatWithJavis();
    konamiCode = [];
  }
});

// ============ DOM ELEMENTS ============
const elems = {
  authSection: document.getElementById('auth-section'),
  username: document.getElementById('username'),
  password: document.getElementById('password'),
  loginBtn: document.getElementById('login-btn'),
  registerBtn: document.getElementById('register-btn'),
  authMessage: document.getElementById('auth-message'),
  nav: document.querySelector('nav'),
  mainContent: document.querySelector('main.content'),
  snackbar: document.getElementById('snackbar'),
  watchlistSection: document.getElementById('watchlist'),
  toggleWatchlistBtn: document.getElementById('toggle-watchlist'),
  watchlistContent: document.getElementById('watchlist-content'),
  watchlistShowMore: document.getElementById('watchlist-showmore'),
  watchlistCollapseTop: document.getElementById('watchlist-collapse-top'),
  searchInput: document.getElementById('search-input'),
  searchResults: document.getElementById('search-results'),
  recommendationResults: document.getElementById('recommendation-results'),
  popularResults: document.getElementById('popular-results'),
  releasesResults: document.getElementById('releases-results'),
  episodesOverlay: document.getElementById('episodes-overlay'),
  episodesContent: document.getElementById('episodes-content'),
  episodesTitle: document.getElementById('episodes-title'),
  episodesCloseBtn: document.getElementById('episodes-close-btn'),
  logoutBtn: document.getElementById('logout-btn'),
  deleteAccountBtn: document.getElementById('delete-account-btn'),
};

// ============ STATE ============
let token = null;
let watchlist = [];
// Stand der Watchlist beim letzten Laden/Speichern – Grundlage zum Zusammenführen,
// falls ein anderes Gerät zwischendurch gespeichert hat
let watchlistBase = [];
let watchlistVersion = 0;
let lastSearchResults = { results: [], tmdbType: "multi" };
const WATCHLIST_PREVIEW_COUNT = 8;
let watchlistShowAll = false;
let searchTimeout = null;

// Video Background Variables
let watchlistVideos = [];
let currentVideoIndex = 0;
let lastVideoIndex = -1; // zuletzt gezeigter Trailer (für zufällige Auswahl ohne Wiederholung)
let videoRotationInterval = null;
let isVideoEnabled = true;
let videoDuration = 30000;

// Charts
let genreChart = null;
let typeChart = null;

// Episodes Management
var currentManagedSeries = null;
var episodesOverlayInitialized = false;

// ============ BASIC FUNCTIONS ============

function showSnackbar(msg, duration = 3500) {
  elems.snackbar.textContent = msg;
  elems.snackbar.classList.add('show');
  setTimeout(() => {
    elems.snackbar.classList.remove('show');
  }, duration);
}
window.showSnackbar = showSnackbar;

// ============ API FUNCTIONS ============

async function apiFetch(path, options = {}) {
  options.headers = options.headers || {};
  if(token) options.headers['Authorization'] = 'Bearer ' + token;
  if(options.body && typeof options.body !== 'string') {
    options.body = JSON.stringify(options.body);
    options.headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, options);
  if(!res.ok) {
    let errMsg = 'API Fehler';
    try {
      const err = await res.json();
      if(err.msg) errMsg = err.msg;
    } catch {}
    throw new Error(errMsg);
  }
  return await res.json();
}

function saveTokenToCache(token) {
  if (token) {
    localStorage.setItem('auth_token', token); document.cookie = 'auth_token=' + token + ';path=/';
    sessionStorage.setItem('auth_token', token);
    console.log('✅ Token im Cache gespeichert');
  }
}

function loadTokenFromCache() {
  const cachedToken = localStorage.getItem('auth_token');
  if (cachedToken) {
    console.log('✅ Token aus Cache geladen');
    return cachedToken;
  }
  return null;
}

function clearTokenFromCache() {
  localStorage.removeItem('auth_token');
  console.log('🗑️ Token aus Cache gelöscht');
}

async function attemptAutoLogin() {
  const cachedToken = loadTokenFromCache();
  
  if (!cachedToken) {
    console.log('ℹ️ Kein gespeicherter Token gefunden');
    return false;
  }
  
  try {
    const res = await fetch('/api/watchlist', {
      headers: { 'Authorization': 'Bearer ' + cachedToken }
    });
    
    if (res.ok) {
      token = cachedToken;

      // Dashboard-Umleitung deaktiviert: bei angemeldetem Nutzer direkt die
      // App zeigen. Kommt man über den Login-Gate einer anderen Seite
      // (?next=...), dorthin weiterleiten statt über ein Zwischen-Dashboard.
      const next = new URLSearchParams(window.location.search).get('next');
      if (next && next !== 'index.html') {
        window.location.href = next;
        return true;
      }

      elems.authSection.style.display = 'none';
      elems.nav.style.display = 'flex';
      elems.mainContent.style.display = 'block';
      
      const data = await res.json();
      setWatchlistFromServer(data);

      await loadRankingForSort();

      renderWatchlist();
      initWatchlistVisibility();
      await fixWatchlistEntries();
      
      renderPopular();
      renderRecommendations();
      renderReleases();
      
      initializeStatistics();
      setTimeout(() => initializeWatchlistBackground(), 600);
      
      showSnackbar("✅ Automatisch angemeldet!");
      console.log('✅ Auto-Login erfolgreich');
      
      return true;
    } else {
      console.log('❌ Gespeicherter Token ist ungültig');
      clearTokenFromCache();
      return false;
    }
  } catch(e) {
    console.error('❌ Auto-Login fehlgeschlagen:', e);
    clearTokenFromCache();
    return false;
  }
}


// ============ AUTH FUNCTIONS ============

async function login() {
  elems.authMessage.style.color = 'red';
  elems.authMessage.textContent = '';
  const username = elems.username.value.trim();
  const password = elems.password.value;
  if(!username || !password){
    elems.authMessage.textContent = 'Benutzername und Passwort eingeben.';
    return;
  }
  try {
    const data = await apiFetch('/api/login', { method: 'POST', body: { username, password } });
    token = data.token;
    saveTokenToCache(token);
    elems.authMessage.style.color = 'green';
    elems.authMessage.textContent = 'Erfolgreich eingeloggt! Weiterleitung...';
    // Dashboard deaktiviert: zum gemerkten Ziel (?next=...) oder direkt zur App.
    const next = new URLSearchParams(window.location.search).get('next');
    window.location.href = next && next !== 'index.html' ? next : 'index.html';

  } catch(e) {
    elems.authMessage.textContent = 'Login fehlgeschlagen: ' + e.message;
  }
}

async function register() {
  elems.authMessage.style.color = 'red';
  elems.authMessage.textContent = '';
  const username = elems.username.value.trim();
  const password = elems.password.value;
  if(!username || !password){
    elems.authMessage.textContent = 'Benutzername und Passwort eingeben.';
    return;
  }
  try {
    await apiFetch('/api/register', { method: 'POST', body: { username, password } });
    elems.authMessage.style.color = 'green';
    elems.authMessage.textContent = 'Registrierung erfolgreich! Bitte anmelden.';
  } catch(e) {
    elems.authMessage.textContent = 'Registrierung fehlgeschlagen: ' + e.message;
  }
}

elems.loginBtn.onclick = login;
elems.registerBtn.onclick = register;

// Login via Enter
elems.username.addEventListener('keydown', e => {
  if(e.key === 'Enter') { e.preventDefault(); login(); }
});
elems.password.addEventListener('keydown', e => {
  if(e.key === 'Enter') { e.preventDefault(); login(); }
});

function logout() {
  clearTokenFromCache();
  token = null;
  watchlist = [];
  watchlistBase = [];
  watchlistVersion = 0;
  elems.authSection.style.display = 'block';
  elems.nav.style.display = 'none';
  elems.mainContent.style.display = 'none';
  elems.authMessage.textContent = '';
  elems.username.value = '';
  elems.password.value = '';
  showSnackbar("Abgemeldet.");

  stopVideoBackground();

  if(genreChart) { genreChart.destroy(); genreChart = null; }
  if(typeChart) { typeChart.destroy(); typeChart = null; }
}
elems.logoutBtn?.addEventListener('click', logout);

async function deleteAccount() {
  if(!confirm("Willst du deinen Account wirklich unwiderruflich löschen?")) return;
  try {
    const res = await fetch('/api/user', {
      method: 'DELETE',
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if(!res.ok) {
      const err = await res.json().catch(() => ({}));
      alert('Fehler beim Löschen: ' + (err.msg || res.statusText));
      return;
    }
    alert('Account wurde gelöscht.');
    logout();
  } catch(e) {
    alert('Netzwerkfehler beim Löschen.');
  }
}
elems.deleteAccountBtn?.addEventListener('click', deleteAccount);

// ============ WATCHLIST FUNCTIONS ============

async function loadWatchlistFromServer() {
  try {
    const data = await apiFetch('/api/watchlist');
    setWatchlistFromServer(data);

    renderWatchlist();
  } catch(e) {
    console.error('Fehler beim Laden:', e);
    showSnackbar("Fehler beim Laden.");
    watchlist = [];
    renderWatchlist();
  }
}

// Text sicher ins HTML einsetzen (verhindert eingeschleusten Code, z. B. über Import)
function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

// Felder, die in onclick-Handlern oder Berechnungen landen, auf gültige Werte prüfen.
// Gibt null zurück, wenn der Eintrag unbrauchbar ist.
const WATCHLIST_TYPES = ['movie', 'tv', 'anime'];
function sanitizeWatchlistItem(item) {
  if(!isPlainObject(item)) return null;
  const id = Number(item.id);
  if(!Number.isInteger(id)) return null;
  item.id = id;
  for(const f of ['media_type', 'type']) {
    if(f in item && !WATCHLIST_TYPES.includes(item[f])) delete item[f];
  }
  if('vote_average' in item) item.vote_average = Math.min(10, Math.max(0, Number(item.vote_average) || 0));
  if('user_rating' in item) {
    const r = Math.round(Number(item.user_rating));
    if(r >= 1 && r <= 10) item.user_rating = r; else delete item.user_rating;
  }
  if('poster_path' in item && typeof item.poster_path !== 'string') item.poster_path = '';
  return item;
}

function sanitizeWatchlist(list) {
  return (Array.isArray(list) ? list : []).map(sanitizeWatchlistItem).filter(Boolean);
}

function setWatchlistFromServer(data) {
  watchlist = sanitizeWatchlist(data.watchlist);
  watchlistVersion = data.version || 0;
  watchlist.forEach(item => {
    if(!item.addedAt) item.addedAt = new Date().toISOString();
    if(item.seen && !item.seenAt) item.seenAt = new Date().toISOString();
  });
  watchlistBase = structuredClone(watchlist);
}

function watchlistKey(item) { return (item.media_type || item.type) + ':' + item.id; }
function isPlainObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
function sameValue(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

// Drei-Wege-Merge: übernimmt die eigenen Änderungen (local gegenüber base)
// auf den Stand eines anderen Geräts (remote). Objekte wie "episodes" werden
// Feld für Feld zusammengeführt.
function mergeValue(base, local, remote) {
  if(sameValue(local, base)) return remote;
  if(sameValue(remote, base)) return local;
  if(isPlainObject(local) && isPlainObject(remote)) {
    const b = isPlainObject(base) ? base : {};
    const out = {};
    for(const k of new Set([...Object.keys(b), ...Object.keys(local), ...Object.keys(remote)])) {
      const v = mergeValue(b[k], local[k], remote[k]);
      if(v !== undefined) out[k] = v;
    }
    return out;
  }
  return local;
}

function mergeWatchlists(base, local, remote) {
  const baseMap = new Map(base.map(i => [watchlistKey(i), i]));
  const localMap = new Map(local.map(i => [watchlistKey(i), i]));
  const result = [];
  for(const r of remote) {
    const k = watchlistKey(r);
    if(baseMap.has(k) && !localMap.has(k)) continue; // hier gelöscht
    result.push(localMap.has(k) ? mergeValue(baseMap.get(k), localMap.get(k), r) : r);
  }
  const resultKeys = new Set(result.map(watchlistKey));
  for(const l of local) {
    const k = watchlistKey(l);
    if(!baseMap.has(k) && !resultKeys.has(k)) result.push(l); // hier hinzugefügt
  }
  return result;
}

// Speichervorgänge nacheinander ausführen, damit jeder auf der neuesten Version aufbaut
let watchlistSaveChain = Promise.resolve();

function saveWatchlistToServer() {
  watchlistSaveChain = watchlistSaveChain.then(doSaveWatchlist);
  return watchlistSaveChain;
}

async function doSaveWatchlist() {
  try {
    for(let attempt = 0; ; attempt++) {
      const sent = structuredClone(watchlist);
      const res = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ watchlist: sent, baseVersion: watchlistVersion })
      });
      const data = await res.json().catch(() => ({}));
      if(res.status === 409 && attempt < 3) {
        // Ein anderes Gerät hat gespeichert: eigene Änderungen darauf übertragen
        const merged = mergeWatchlists(watchlistBase, watchlist, data.watchlist || []);
        watchlist = merged;
        watchlistBase = structuredClone(data.watchlist || []);
        watchlistVersion = data.version || 0;
        renderWatchlist();
        continue;
      }
      if(!res.ok) throw new Error(data.msg || 'API Fehler');
      watchlistVersion = data.version;
      watchlistBase = sent;
      break;
    }
    showSnackbar("Watchlist gespeichert");

    if(document.getElementById('statistics')?.classList.contains('active')) {
      updateStatistics();
    }
  } catch(e) {
    console.error('Fehler beim Speichern:', e);
    showSnackbar("Fehler beim Speichern.");
  }
}

function setWatchlistVisibility(isVisible) {
  if(isVisible) {
    elems.watchlistSection.classList.remove('closed');
    elems.toggleWatchlistBtn?.setAttribute('aria-pressed', 'true');
  } else {
    elems.watchlistSection.classList.add('closed');
    elems.toggleWatchlistBtn?.setAttribute('aria-pressed', 'false');
  }
  localStorage.setItem('watchlistVisible', isVisible ? 'true' : 'false');
}

elems.toggleWatchlistBtn?.addEventListener('click', () => {
  const currentlyVisible = !elems.watchlistSection.classList.contains('closed');
  setWatchlistVisibility(!currentlyVisible);
});

function initWatchlistVisibility() {
  const stored = localStorage.getItem('watchlistVisible');
  if(stored === 'false') setWatchlistVisibility(false);
  else setWatchlistVisibility(true);
}

async function fixWatchlistEntries() {
    let updated = false;
    for(let i=0; i < watchlist.length; i++) {
        const entry = watchlist[i];
        const needsUpdate = !entry.title || entry.title === '' || entry.title === 'Unbekannt' || !entry.overview;
        
        if(needsUpdate) {
            try {
                // Fallback: TMDB
                const tmdbType = entry.media_type === 'anime' ? 'tv' : (entry.media_type || entry.type || 'movie');
                const url = `/${tmdbType}/${entry.id}`;
                const res = await tmdbFetch(url);
                const data = await res.json();
                watchlist[i].title = data.title || data.name || 'Unbekannt';
                watchlist[i].name = data.name || data.title || 'Unbekannt';
                watchlist[i].overview = data.overview || '';
                watchlist[i].genres_text = (data.genres || []).map(g => g.name).join(", ");
                watchlist[i].poster_path = data.poster_path || '';
                watchlist[i].vote_average = data.vote_average || 0;
                updated = true;
            } catch(e) {
                console.warn("Fehler beim Aktualisieren ID " + entry.id, e);
            }
        }
        if(!entry.addedAt) {
            watchlist[i].addedAt = new Date().toISOString();
            updated = true;
        }
    }
    if(updated) await saveWatchlistToServer();
}

async function addToWatchlist(id, type) {
  try {
    console.log(`Füge hinzu: ID=${id}, Type=${type}`);

    // NUR TMDB verwenden
    const tmdbType = (type === 'anime') ? 'tv' : type;
    const url = `/${tmdbType}/${id}`;

    console.log(`API URL: ${url}`);

    const res = await tmdbFetch(url);
    if(!res.ok) {
      throw new Error(`TMDB API Fehler: ${res.status}`);
    }

    const itemData = await res.json();

    const exists = watchlist.find(w => w.id === id && (w.media_type || w.type) === type);
    if(exists){
      showSnackbar("Titel ist bereits in der Watchlist!");
      return;
    }

    watchlist.push({
      id: id,
      title: itemData.title || itemData.name || 'Unbekannt',
      name: itemData.name || itemData.title || 'Unbekannt',
      media_type: type,
      type: type,
      poster_path: itemData.poster_path || '',
      vote_average: itemData.vote_average || 0,
      genres_text: (itemData.genres || []).map(g => g.name).join(", "),
      favorite: false,
      seen: false,
      episodes: {},
      addedAt: new Date().toISOString(),
      overview: itemData.overview || ''
    });

    renderWatchlist();
    await saveWatchlistToServer();
    showSnackbar("Zur Watchlist hinzugefügt!");
    renderRecommendations();

    if(isVideoEnabled) {
      setTimeout(() => initializeWatchlistBackground(), 1000);
    }

    if(type === 'tv' || type === 'anime') {
      setTimeout(() => renderReleases(), 500);
    }
  } catch(e) {
    console.error("Fehler beim Hinzufügen:", e);
    showSnackbar(`Fehler: ${e.message}`);
  }
}

function removeFromWatchlist(id, media_type) {
  watchlist = watchlist.filter(i => !(i.id === id && (i.media_type || i.type) === media_type));
  renderWatchlist();
  saveWatchlistToServer();
  showSnackbar("Von Watchlist entfernt!");
  renderRecommendations();

  if(isVideoEnabled) setTimeout(() => initializeWatchlistBackground(), 1000);
  if(media_type === 'tv' || media_type === 'anime') setTimeout(() => renderReleases(), 500);
}

function toggleFavorite(id, media_type) {
  const item = watchlist.find(i => i.id === id && (i.media_type || i.type) === media_type);
  if(item) { 
    item.favorite = !item.favorite; 
    renderWatchlist(); 
    showSnackbar(item.favorite ? "Als Favorit markiert!" : "Favorit entfernt!"); 
    renderRecommendations();
    saveWatchlistToServer();

    if(isVideoEnabled) setTimeout(() => initializeWatchlistBackground(), 1000);
  }
}

function toggleSeen(id, media_type) {
  const item = watchlist.find(i => i.id === id && (i.media_type || i.type) === media_type);
  if(item) { 
    item.seen = !item.seen; 

    if(item.seen) {
      item.seenAt = new Date().toISOString();
    } else {
      delete item.seenAt;
    }

    renderWatchlist(); 
    showSnackbar(item.seen ? "Als gesehen markiert!" : "Markierung entfernt!"); 
    renderRecommendations();
    saveWatchlistToServer();
  }
  renderLastSearch();
  renderPopular();
}

// Trailer/Info Overlay
async function showInfoOverlay(item) {
  if (!item) return;

  const overlay = document.getElementById('info-overlay');
  const title = document.getElementById('info-title');
  const overview = document.getElementById('info-overview');
  const trailerLink = document.getElementById('info-trailer-link');

  if(!overlay || !title || !overview || !trailerLink) return;

  title.textContent = item.title || item.name || 'Unbekannt';
  overview.textContent = item.overview || 'Keine Beschreibung verfügbar';

  trailerLink.style.display = 'none';
  trailerLink.href = '#';

  overlay.style.display = 'flex';
  document.body.classList.add('overlay-open');
  document.body.style.overflow = 'hidden';

  let provType = item.media_type || item.type || 'movie';
  if (provType === 'anime') provType = 'tv';
  loadWatchProviders(provType, item.id, document.getElementById('info-providers'));

  try {
    let type = item.media_type || item.type || 'movie';
    if (type === 'anime') type = 'tv';

    const response = await tmdbFetch(`/${type}/${item.id}/videos`);
    if (response.ok) {
      const data = await response.json();
      const trailer = (data.results || []).find(v =>
        v.site === 'YouTube' && ['Trailer', 'Teaser', 'Clip'].includes(v.type)
      );
      if (trailer) {
        trailerLink.href = `https://www.youtube.com/watch?v=${trailer.key}`;
        trailerLink.textContent = '▶ Trailer ansehen';
        trailerLink.style.display = 'inline-block';
        trailerLink.setAttribute('target', '_blank');
        trailerLink.setAttribute('rel', 'noopener noreferrer');
      }
    }
  } catch (e) {
    trailerLink.style.display = 'none';
  }
}

// Streaming-Anbieter (TMDB watch/providers) für Deutschland laden
async function loadWatchProviders(type, id, container) {
  if (!container) return;
  container.innerHTML = '';
  if (type !== 'movie' && type !== 'tv') return;
  try {
    const res = await tmdbFetch(`/${type}/${id}/watch/providers`);
    if (!res.ok) return;
    const data = await res.json();
    const de = data.results && data.results.DE;
    if (!de) return;
    const IMG = 'https://image.tmdb.org/t/p/w45';
    const renderGroup = (label, list) => {
      if (!list || !list.length) return '';
      const seen = new Set();
      const chips = list
        .filter((p) => p.logo_path && !seen.has(p.provider_id) && seen.add(p.provider_id))
        .map((p) => `<span class="ip-chip" title="${escapeHtml(p.provider_name)}"><img src="${IMG}${escapeHtml(p.logo_path)}" alt="${escapeHtml(p.provider_name)}" loading="lazy"><span>${escapeHtml(p.provider_name)}</span></span>`)
        .join('');
      return chips ? `<div class="ip-group"><span class="ip-label">${label}</span><div class="ip-chips">${chips}</div></div>` : '';
    };
    const rentBuy = [...(de.rent || []), ...(de.buy || [])];
    const html = renderGroup('📺 Im Abo streamen', de.flatrate) + renderGroup('💰 Leihen / Kaufen', rentBuy);
    container.innerHTML = html || '<p class="ip-empty">Keine Streaming-Anbieter für Deutschland gefunden.</p>';
  } catch (e) {
    container.innerHTML = '';
  }
}

// AniList Daten abrufen
async function fetchAniListData(title) {
    if(!title) return null;
    try {
        const graphqlQuery = `query ($search: String) {
            Media(search: $search, type: ANIME, isAdult: false) {
                id
                title { romaji english native }
                description(asHtml: false)
                genres
                averageScore
                episodes
                coverImage { large medium }
            }
        }`;
        const res = await fetch('https://graphql.anilist.co', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: graphqlQuery, variables: { search: title } })
        });
        const data = await res.json();
        return data.data?.Media || null;
    } catch(e) {
        console.warn('AniList fetch error:', e);
        return null;
    }
}

// ============ VIDEO BACKGROUND FUNCTIONS ============

// Fisher-Yates-Shuffle (in place) – für zufällige Trailer-Reihenfolge
function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function initializeWatchlistBackground() {
  if(!isVideoEnabled || window.innerWidth <= 600) {
    console.log('Video-Hintergrund deaktiviert');
    return;
  }

  console.log('Initialisiere Video-Hintergrund (progressiv)...');

  // Laufende Rotation stoppen, falls neu initialisiert wird
  if (videoRotationInterval) { clearInterval(videoRotationInterval); videoRotationInterval = null; }
  watchlistVideos = [];
  lastVideoIndex = -1;

  try {
    await loadWatchlistVideosProgressive();
  } catch (e) {
    console.error('Fehler beim Laden der Videos:', e);
  }
}

// Lädt die Trailer nach und nach: sobald der ERSTE gefunden ist, startet der
// Hintergrund sofort – der Rest wird im Hintergrund weitergeladen. Das vermeidet
// die lange Wartezeit, bis alle Trailer geladen sind.
async function loadWatchlistVideosProgressive() {
  // Kandidaten: Favoriten oder gut bewertet. Reihenfolge zufällig, damit auch
  // der zuerst gezeigte Trailer variiert.
  const topItems = watchlist
    .filter(item => item.favorite || item.vote_average >= 7.0)
    .slice(0, 15);
  shuffleInPlace(topItems);

  const videoBg = document.querySelector('.dynamic-video-background');
  let started = false;

  for (const item of topItems) {
    // Abbrechen, falls der Nutzer den Hintergrund inzwischen deaktiviert hat
    if (!isVideoEnabled) return;

    try {
      const type = item.media_type === 'anime' ? 'tv' : (item.media_type || item.type);
      const res = await tmdbFetch(
        `/${type}/${item.id}/videos`
      );
      const videos = await res.json();

      const trailer = videos.results?.find(v =>
        v.site === 'YouTube' && (v.type === 'Trailer' || v.type === 'Teaser')
      );

      if (trailer) {
        watchlistVideos.push({
          title: item.title || item.name,
          videoId: trailer.key,
          type: trailer.type,
          item: item,
          isFavorite: item.favorite
        });

        // Sobald der erste Trailer da ist: sofort loslegen.
        if (!started) {
          started = true;
          if (videoBg) videoBg.style.display = 'block';
          startVideoRotation();
        }
      }
    } catch (e) {
      console.log(`Kein Video für ${item.title || item.name}`);
    }

    // Kurze Pause, damit TMDB nicht überrannt wird (deutlich kürzer als vorher)
    await new Promise(resolve => setTimeout(resolve, 60));
  }
}

function startVideoRotation() {
  if (watchlistVideos.length === 0) return;

  playNextWatchlistVideo();

  if(videoRotationInterval) clearInterval(videoRotationInterval);

  videoRotationInterval = setInterval(() => {
    playNextWatchlistVideo();
  }, videoDuration);
}

// Wählt einen ZUFÄLLIGEN Trailer (nie zweimal direkt hintereinander denselben).
function playNextWatchlistVideo() {
  const n = watchlistVideos.length;
  if (n === 0) return;

  let idx;
  if (n === 1) {
    idx = 0;
  } else {
    do {
      idx = Math.floor(Math.random() * n);
    } while (idx === lastVideoIndex);
  }
  lastVideoIndex = idx;

  updateBackgroundWithYouTube(watchlistVideos[idx]);
}

function updateBackgroundWithYouTube(video) {
  const container = document.getElementById('video-background-container');
  const titleElement = document.getElementById('current-video-title');

  if(!container) return;

  const opacity = document.getElementById('video-opacity')?.value / 100 || 0.25;

  container.innerHTML = `
    <iframe 
      src="https://www.youtube.com/embed/${video.videoId}?autoplay=1&mute=1&loop=1&controls=0&showinfo=0&rel=0&modestbranding=1&playlist=${video.videoId}&start=10"
      frameborder="0"
      allow="autoplay; encrypted-media"
      style="
        width: 120%; 
        height: 120%; 
        position: absolute; 
        top: -10%; 
        left: -10%;
        pointer-events: none;
        opacity: ${opacity};
        filter: blur(1px) grayscale(20%);
        transition: opacity 0.5s ease;
      "
    ></iframe>
  `;

  if(titleElement) {
    titleElement.textContent = `${video.title} (${video.type})${video.isFavorite ? ' ⭐' : ''}`;
  }
}

function stopVideoBackground() {
  if(videoRotationInterval) {
    clearInterval(videoRotationInterval);
    videoRotationInterval = null;
  }

  const container = document.getElementById('video-background-container');
  if(container) container.innerHTML = '';

  const bg = document.querySelector('.dynamic-video-background');
  if(bg) bg.style.display = 'none';
}

function toggleWatchlistVideos() {
  const checkbox = document.getElementById('enable-video-bg');
  if(!checkbox) return;

  isVideoEnabled = checkbox.checked;
  localStorage.setItem('videoBackgroundEnabled', isVideoEnabled);

  if (isVideoEnabled && watchlist.length > 0) {
    initializeWatchlistBackground();
    showSnackbar('Video-Hintergrund aktiviert!');
  } else {
    stopVideoBackground();
    showSnackbar('Video-Hintergrund deaktiviert');
  }
}

function adjustVideoOpacity(value) {
  const iframe = document.querySelector('#video-background-container iframe');
  const valueSpan = document.getElementById('opacity-value');

  if (iframe) iframe.style.opacity = value / 100;
  if (valueSpan) valueSpan.textContent = `${value}%`;

  localStorage.setItem('videoOpacity', value);
}

function updateVideoDuration(seconds) {
  videoDuration = seconds * 1000;
  localStorage.setItem('videoDuration', seconds);

  if(videoRotationInterval) {
    clearInterval(videoRotationInterval);
    startVideoRotation();
  }

  showSnackbar(`Video-Wechsel: ${seconds}s`);
}

// ============ HELPER FUNCTIONS ============

function formatType(type) {
  if(type === "movie") return "Film";
  if(type === "tv") return "Serie";
  if(type === "anime") return "Anime";
  return type || "";
}

function showStars(v) {
  if(!v) return "☆☆☆☆☆";
  const r = Math.round(v/2);
  return "★".repeat(r) + "☆".repeat(5 - r);
}

function guessGenres(item) {
  const map = {28:"Action",16:"Animation",35:"Comedy",99:"Doku",18:"Drama",10751:"Family",14:"Fantasy",36:"History",27:"Horror",10402:"Music",9648:"Mystery",10749:"Romance",878:"Science Fiction",53:"Thriller",10770:"TV-Film",10752:"Krieg",37:"Western"};
  if(item.genre_ids) return item.genre_ids.map(g=>map[g]||"").filter(Boolean).join(", ");
  if(item.genres) return item.genres.map(g=>g.name).join(", ");
  return "";
}

function generateExternalSearchLinks(title) {
  const enc = encodeURIComponent(title);
  return `<div class="external-links">
    <a href="https://s.to/search?query=${enc}" target="_blank" rel="noopener noreferrer">s.to</a>
    <a href="https://aniworld.to/search?query=${enc}" target="_blank" rel="noopener noreferrer">AniWorld</a>
    <a href="https://bs.to/search?query=${enc}" target="_blank" rel="noopener noreferrer">bs.to</a>
  </div>`;
}

// ============ EPISODES MANAGEMENT ============

function getEpisodesElements() {
  return {
    episodesOverlay: document.getElementById('episodes-overlay'),
    episodesCloseBtn: document.getElementById('episodes-close-btn'),
    episodesContent: document.getElementById('episodes-content'),
    episodesTitle: document.getElementById('episodes-title')
  };
}

function initEpisodesCloseListener() {
  const elements = getEpisodesElements();

  if (elements.episodesCloseBtn) {
    elements.episodesCloseBtn.onclick = null;

    elements.episodesCloseBtn.onclick = function(e) {
      elements.episodesOverlay.style.display = 'none';
      document.body.classList.remove('overlay-open');
      document.body.style.overflow = '';
      currentManagedSeries = null;
    };
  }
}

function changeSeason(seasonNumber) {
  if (!currentManagedSeries) return;

  const elements = getEpisodesElements();
  if (!elements.episodesContent) return;

  (async () => {
    elements.episodesContent.innerHTML = `
      <div style="text-align: center; padding: 20px; color: #888;">
        <p>🔄 Lade Episoden für Staffel ${seasonNumber}...</p>
      </div>
    `;

    try {
      const res = await tmdbFetch(`/tv/${currentManagedSeries.id}/season/${seasonNumber}`);

      if (!res.ok) throw new Error(`API-Fehler: ${res.status}`);

      const seasonData = await res.json();

      elements.episodesContent.innerHTML = '';

      if (!currentManagedSeries.episodes) currentManagedSeries.episodes = {};
      if (!currentManagedSeries.episodes[seasonNumber]) currentManagedSeries.episodes[seasonNumber] = [];

      if (!seasonData.episodes || seasonData.episodes.length === 0) {
        elements.episodesContent.innerHTML = `
          <div style="text-align: center; padding: 40px; color: #888;">
            <p>📺 Keine Episoden für Staffel ${seasonNumber} gefunden.</p>
          </div>
        `;
        return;
      }

      const episodesContainer = document.createElement('div');
      episodesContainer.style.cssText = `
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
        gap: 10px;
        max-height: 400px;
        overflow-y: auto;
        padding: 10px;
      `;

      seasonData.episodes.forEach((ep, index) => {
        const episodeNumber = ep.episode_number || (index + 1);
        const isWatched = currentManagedSeries.episodes[seasonNumber][episodeNumber] || false;

        const episodeItem = document.createElement('div');
        episodeItem.style.cssText = `
          background: ${isWatched ? 'rgba(34, 197, 94, 0.2)' : 'rgba(107, 114, 128, 0.2)'};
          border: 1px solid ${isWatched ? '#22c55e' : '#6b7280'};
          border-radius: 6px;
          padding: 12px;
          cursor: pointer;
          transition: all 0.3s ease;
          position: relative;
        `;

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = isWatched;
        checkbox.dataset.season = seasonNumber;
        checkbox.dataset.episode = episodeNumber;
        checkbox.style.cssText = `
          position: absolute;
          top: 8px;
          right: 8px;
          width: 18px;
          height: 18px;
          cursor: pointer;
        `;

        checkbox.addEventListener('change', (e) => {
          const sea = parseInt(e.target.dataset.season);
          const epNum = parseInt(e.target.dataset.episode);

          if (!currentManagedSeries.episodes[sea]) {
            currentManagedSeries.episodes[sea] = [];
          }

          currentManagedSeries.episodes[sea][epNum] = e.target.checked;

          if (e.target.checked) {
            episodeItem.style.background = 'rgba(34, 197, 94, 0.2)';
            episodeItem.style.borderColor = '#22c55e';
          } else {
            episodeItem.style.background = 'rgba(107, 114, 128, 0.2)';
            episodeItem.style.borderColor = '#6b7280';
          }

          saveWatchlistToServer();
          showSnackbar(`Episode ${episodeNumber} ${e.target.checked ? 'gesehen' : 'ungesehen'}`);
        });

        const episodeInfo = document.createElement('div');
        episodeInfo.style.cssText = 'margin-top: 25px; padding-right: 25px;';

        const episodeTitle = document.createElement('div');
        episodeTitle.style.cssText = 'font-weight: bold; margin-bottom: 5px;';
        episodeTitle.textContent = `E${episodeNumber.toString().padStart(2, '0')}: ${ep.name || 'Unbekannt'}`;

        episodeInfo.appendChild(episodeTitle);
        episodeItem.appendChild(checkbox);
        episodeItem.appendChild(episodeInfo);

        episodeItem.addEventListener('click', (e) => {
          if (e.target !== checkbox) {
            checkbox.checked = !checkbox.checked;
            checkbox.dispatchEvent(new Event('change'));
          }
        });

        episodesContainer.appendChild(episodeItem);
      });

      elements.episodesContent.appendChild(episodesContainer);

    } catch (error) {
      console.error('Fehler beim Laden der Episoden:', error);
      elements.episodesContent.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #ff6b6b;">
          <p>❌ Fehler beim Laden der Episoden</p>
        </div>
      `;
    }
  })();
}

function setupSeasonDropdown(series, seasons) {
  const elements = getEpisodesElements();

  const oldContainers = document.querySelectorAll('[id*="season"], .season-container');
  oldContainers.forEach(container => container.remove());

  if (!elements.episodesContent || !elements.episodesContent.parentNode) return;

  const selectContainer = document.createElement('div');
  selectContainer.id = 'season-dropdown-container';
  selectContainer.style.cssText = `
    margin-bottom: 20px;
    padding: 15px;
    background: rgba(99, 102, 241, 0.1);
    border-radius: 8px;
  `;

  const label = document.createElement('label');
  label.textContent = '📺 Staffel auswählen: ';
  label.style.cssText = 'display: block; margin-bottom: 8px; font-weight: bold;';

  const select = document.createElement('select');
  select.id = 'seasonDropdown';
  select.style.cssText = `
    width: 100%;
    padding: 8px 12px;
    border-radius: 6px;
    cursor: pointer;
  `;

  seasons.forEach(s => {
    if (s.season_number === 0) return;

    const option = document.createElement('option');
    option.value = s.season_number;
    option.textContent = `Staffel ${s.season_number} (${s.episode_count || '?'} Episoden)`;
    select.appendChild(option);
  });

  select.onchange = (e) => {
    const seasonNumber = parseInt(e.target.value);
    changeSeason(seasonNumber);
  };

  selectContainer.appendChild(label);
  selectContainer.appendChild(select);

  const parentNode = elements.episodesContent.parentNode;
  parentNode.insertBefore(selectContainer, elements.episodesContent);
}

async function openEpisodesManager(series) {
  if (!series) return;

  const elements = getEpisodesElements();
  if (!elements.episodesOverlay) return;

  initEpisodesCloseListener();

  elements.episodesOverlay.style.display = 'flex';
  document.body.classList.add('overlay-open');
  document.body.style.overflow = 'hidden';

  elements.episodesContent.innerHTML = `
    <div style="text-align: center; padding: 40px;">
      <p>🔄 Lade Serie-Informationen...</p>
    </div>
  `;

  elements.episodesTitle.textContent = `Episoden: ${series.title || series.name}`;

  try {
    const res = await tmdbFetch(`/tv/${series.id}`);

    if (!res.ok) throw new Error(`API-Fehler: ${res.status}`);

    const serieData = await res.json();

    currentManagedSeries = series;

    if (!series.episodes) series.episodes = {};

    const validSeasons = serieData.seasons.filter(s => s.season_number > 0);

    if (validSeasons.length === 0) {
      elements.episodesContent.innerHTML = '<p style="text-align:center;padding:40px;">Keine Staffeln gefunden.</p>';
      return;
    }

    setupSeasonDropdown(series, validSeasons);
    changeSeason(validSeasons[0].season_number);

  } catch (error) {
    elements.episodesContent.innerHTML = '<p style="text-align:center;padding:40px;color:#ff6b6b;">Fehler beim Laden.</p>';
  }
}

window.openEpisodesManager = openEpisodesManager;
window.changeSeason = changeSeason;

// ============ RENDER FUNCTIONS ============

// renderAsGridExtended ist die erweiterte Version weiter unten (Bulk, Rating, Notizen).

function renderWatchlist() {
  const typeFilter = document.getElementById("watchlist-type-filter")?.value || "";
  const genreFilter = document.getElementById("watchlist-genre-filter")?.value.trim().toLowerCase() || "";
  const seenFilter = document.getElementById("seen-filter-wl")?.value || "";

  let filtered = watchlist.filter(item => {
    if(typeFilter === "anime") {
      if (!((item.media_type || item.type) === "anime" || ((item.media_type || item.type) === "tv" && (item.genres_text || "").toLowerCase().includes("animation")))) return false;
    } else if (typeFilter && (item.media_type || item.type) !== typeFilter) return false;
    if(genreFilter) { 
      const genres = (item.genres_text || "").toLowerCase().split(",").map(s => s.trim()); 
      if(!genres.includes(genreFilter)) return false;
    }
    if(seenFilter === "seen" && !item.seen) return false;
    if(seenFilter === "notseen" && !!item.seen) return false;
    return true;
  });

  const hasMore = filtered.length > WATCHLIST_PREVIEW_COUNT;

  if(!watchlistShowAll && hasMore) {
    const toShow = filtered.slice(0, WATCHLIST_PREVIEW_COUNT);
    if(elems.watchlistCollapseTop) elems.watchlistCollapseTop.innerHTML = "";
    elems.watchlistShowMore.innerHTML = `<button onclick="expandWatchlist()">Mehr anzeigen (${filtered.length - WATCHLIST_PREVIEW_COUNT} weitere)</button>`;
    renderAsGridExtended(elems.watchlistContent, toShow, { showFav:true, showRemove:true, showSeen:true });
  }
  else {
    const collapseBtn = hasMore ? `<button onclick="collapseWatchlist()">▲ Weniger anzeigen</button>` : "";
    if(elems.watchlistCollapseTop) {
      elems.watchlistCollapseTop.innerHTML = collapseBtn;
      elems.watchlistCollapseTop.className = hasMore ? 'wl-collapse-bar' : '';
    }
    elems.watchlistShowMore.innerHTML = collapseBtn;
    renderAsGridExtended(elems.watchlistContent, filtered, { showFav:true, showRemove:true, showSeen:true });
  }
}

// Watchlist-Vorschau aufklappen / einklappen
function expandWatchlist() {
  watchlistShowAll = true;
  renderWatchlist();
}
window.expandWatchlist = expandWatchlist;

function collapseWatchlist() {
  watchlistShowAll = false;
  renderWatchlist();
  const sec = document.getElementById('watchlist');
  if(sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
window.collapseWatchlist = collapseWatchlist;

// ============ SEARCH - NUR TMDB ============

async function startTmdbSearchLive() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(async () => {
    const query = elems.searchInput.value.trim();
    const typeFilter = document.getElementById('search-type-filter')?.value || "";
    const genreFilter = document.getElementById('search-genre-filter')?.value.trim().toLowerCase() || "";

    elems.searchResults.innerHTML = "<i>Lade ...</i>";
    if(!query){ 
      elems.searchResults.innerHTML = "<i>Titel eingeben.</i>"; 
      return; 
    }

    try {
      const tmdbType = typeFilter === "anime" ? "tv" : (typeFilter || "multi");
      const url = `/search/${tmdbType}?query=${encodeURIComponent(query)}`;

      const res = await tmdbFetch(url);
      const data = await res.json();
      let results = data.results || [];

      if(genreFilter) {
        results = results.filter(item => { 
          const genres = guessGenres(item).toLowerCase().split(",").map(s=>s.trim()); 
          return genres.includes(genreFilter); 
        });
      }

      lastSearchResults = { results, tmdbType };
      renderLastSearch();

    } catch (error) {
      console.error('Suche fehlgeschlagen:', error);
      elems.searchResults.innerHTML = "<i>Fehler beim Laden.</i>";
    }
  }, 400);
}

function renderLastSearch() {
  const results = lastSearchResults.results || [];
  const seenFilter = document.getElementById("seen-filter-search")?.value || "";

  let filtered = results.map(it => {
    const wlIt = watchlist.find(w => w.id === it.id && (w.media_type || w.type) === it.media_type);
    return wlIt ? { ...it, seen: wlIt.seen } : it;
  });

  if(seenFilter === "seen") filtered = filtered.filter(it => !!it.seen);
  if(seenFilter === "notseen") filtered = filtered.filter(it => !it.seen);

  renderAsGridExtended(elems.searchResults, filtered, {
    showFav: false,
    showRemove: false,
    showAdd: true,
    disableBtn: item => watchlist.some(w => w.id === item.id && (w.media_type || w.type) === item.media_type)
  });
}

// ============ POPULAR - NUR TMDB ============

async function renderPopular() {
  const container = elems.popularResults;
  const typeFilter = document.getElementById('popular-type-filter')?.value || "";
  const genreFilter = document.getElementById('popular-genre-filter')?.value.trim().toLowerCase() || "";
  const seenFilter = document.getElementById('seen-filter-popular')?.value || "";

  container.innerHTML = "<i>Lade ...</i>";

  try {
    let popularAll = [];

    if(typeFilter === "movie" || typeFilter === "" || typeFilter === "anime") {
      let res = await tmdbFetch(`/movie/top_rated?page=1`);
      const moviesData = await res.json();
      const popularMovies = (moviesData.results || []).map(movie => ({
        ...movie,
        media_type: 'movie'
      }));
      popularAll = [...popularAll, ...popularMovies];
    }

    if(typeFilter === "tv" || typeFilter === "" || typeFilter === "anime") {
      let res = await tmdbFetch(`/tv/top_rated?page=1`);
      const seriesData = await res.json();
      const popularTV = (seriesData.results || []).map(series => ({
        ...series,
        media_type: 'tv'
      }));
      popularAll = [...popularAll, ...popularTV];
    }

    if(genreFilter) {
      popularAll = popularAll.filter(item => {
        const genres = guessGenres(item).toLowerCase().split(",").map(s => s.trim());
        return genres.includes(genreFilter);
      });
    }

    popularAll = popularAll.map(item => {
      const wlItem = watchlist.find(w => 
        w.id === item.id && (w.media_type || w.type) === item.media_type
      );
      return wlItem ? { ...item, seen: wlItem.seen } : item;
    });

    if(seenFilter === "seen") {
      popularAll = popularAll.filter(item => !!item.seen);
    } else if(seenFilter === "notseen") {
      popularAll = popularAll.filter(item => !item.seen);
    }

    popularAll = popularAll
      .sort((a,b) => (b.vote_average || 0) - (a.vote_average || 0))
      .slice(0, 16);

    renderAsGridExtended(container, popularAll, {
      showAdd: true,
      showFav: false,
      showRemove: false,
      disableBtn: item => watchlist.some(w => 
        w.id === item.id && (w.media_type || w.type) === item.media_type
      )
    });

  } catch (error) {
    console.error('Fehler:', error);
    container.innerHTML = "<i>Fehler beim Laden.</i>";
  }
}

// ============ RECOMMENDATIONS ============

function pickRandom(arr, n) {
  let copy = arr.slice();
  for(let i=copy.length-1; i>0; i--) {
    let j = Math.floor(Math.random() * (i+1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function renderRecommendations() {
  const container = elems.recommendationResults;
  container.innerHTML = "<i>Analysiere Watchlist ...</i>";
  if(!watchlist.length) { 
    container.innerHTML = "<i>Füge zuerst Titel hinzu!</i>";
    return; 
  }

  let favs = watchlist.filter(w => w.favorite);
  let candidateBase = favs.length ? pickRandom(favs, 5) : pickRandom(watchlist, 5);

  let suggestions = {};
  (async () => {
    for(let entry of candidateBase) {
      let type = entry.media_type || entry.type || "movie";
      let id = entry.id;
      let url = `/${type}/${id}/recommendations?page=1`;
      try {
        let res = await tmdbFetch(url);
        let data = await res.json();
        let arr = data?.results || [];
        for(let sug of arr) {
          if(watchlist.some(w => w.id === sug.id)) continue;
          if(!suggestions[sug.id]) suggestions[sug.id] = {...sug, score: 0, media_type: sug.media_type || type};
          suggestions[sug.id].score += entry.favorite ? 3 : 1;
        }
      } catch {}
    }

    let recommended = Object.values(suggestions).sort((a,b) =>
      (b.score || 0) !== (a.score || 0) ? (b.score || 0) - (a.score || 0) : (b.vote_average || 0) - (a.vote_average || 0)
    ).slice(0,16);

    renderAsGridExtended(container, recommended, {
      showAdd: true,
      showFav: false,
      showRemove: false,
      disableBtn: item => watchlist.some(w => w.id === item.id)
    });
  })();
}

// ============ RELEASES ============

async function renderReleases() {
  const container = elems.releasesResults;
  const timeframeSelect = document.getElementById('release-timeframe');
  const timeframe = timeframeSelect ? parseInt(timeframeSelect.value) : 30;

  container.innerHTML = "<i>Lade Releases...</i>";

  if (!watchlist.length) {
    container.innerHTML = '<p style="text-align:center;padding:40px;">Füge Serien zur Watchlist hinzu!</p>';
    return;
  }

  const tvShows = watchlist.filter(item => {
    const mediaType = item.media_type || item.type;
    return mediaType === 'tv' || mediaType === 'anime';
  });

  if (!tvShows.length) {
    container.innerHTML = '<p style="text-align:center;padding:40px;">Keine Serien in der Watchlist.</p>';
    return;
  }

  const releases = [];
  const today = new Date();
  const endDate = new Date(today.getTime() + (timeframe * 24 * 60 * 60 * 1000));

  try {
    for (const show of tvShows) {
      try {
        const res = await tmdbFetch(`/tv/${show.id}`);
        if (!res.ok) continue;

        const data = await res.json();

        if (data.next_episode_to_air?.air_date) {
          const releaseDate = new Date(data.next_episode_to_air.air_date);
          if (releaseDate >= today && releaseDate <= endDate) {
            releases.push({
              show: show,
              episode: data.next_episode_to_air,
              releaseDate: releaseDate,
              type: 'episode'
            });
          }
        }
      } catch (e) {}

      await new Promise(resolve => setTimeout(resolve, 100));
    }

    if(!releases.length) {
      container.innerHTML = '<p style="text-align:center;padding:40px;">Keine anstehenden Releases.</p>';
      return;
    }

    releases.sort((a, b) => a.releaseDate - b.releaseDate);

    const releasesList = document.createElement('div');
    releasesList.className = 'releases-list';

    releases.forEach(release => {
      const releaseItem = document.createElement('div');
      releaseItem.className = 'release-item';
      releaseItem.style.cssText = 'display:flex;gap:10px;padding:10px;margin:10px 0;background:rgba(0,0,0,0.3);border-radius:8px;cursor:pointer;';

      const poster = document.createElement('img');
      const posterPath = release.show.poster_path;
      if (posterPath) {
        poster.src = posterPath.startsWith("http") ? posterPath : TMDB_IMG_BASE + posterPath;
      } else {
        poster.src = "https://via.placeholder.com/60x90?text=No+Image";
      }
      poster.onerror = () => { poster.src = "https://via.placeholder.com/60x90?text=No+Image"; };
      poster.style.cssText = 'width:60px;height:90px;border-radius:4px;';

      const info = document.createElement('div');
      info.style.cssText = 'flex:1;';

      const title = document.createElement('h3');
      title.textContent = release.show.title || release.show.name;
      title.style.cssText = 'margin:0 0 5px 0;';

      const details = document.createElement('div');
      const dateStr = release.releaseDate.toLocaleDateString('de-DE');

      details.innerHTML = `
        <strong>🎬 Neue Folge:</strong> S${escapeHtml(release.episode.season_number)}E${escapeHtml(release.episode.episode_number)}<br>
        <strong>📺 Titel:</strong> ${escapeHtml(release.episode.name || 'Unbekannt')}<br>
        <strong>📅 Datum:</strong> ${dateStr}
      `;

      const daysUntil = Math.ceil((release.releaseDate - new Date()) / (1000 * 60 * 60 * 24));
      const countdown = document.createElement('div');

      if (daysUntil === 0) countdown.textContent = '🔴 Heute!';
      else if (daysUntil === 1) countdown.textContent = '🟡 Morgen';
      else countdown.textContent = `📅 in ${daysUntil} Tagen`;

      info.appendChild(title);
      info.appendChild(details);

      releaseItem.appendChild(poster);
      releaseItem.appendChild(info);
      releaseItem.appendChild(countdown);

      releaseItem.addEventListener('click', () => showInfoOverlay(release.show));

      releasesList.appendChild(releaseItem);
    });

    container.innerHTML = '';
    container.appendChild(releasesList);

  } catch (error) {
    console.error('Fehler:', error);
    container.innerHTML = '<p style="text-align:center;padding:40px;color:#ff6666;">Fehler beim Laden.</p>';
  }
}

// ============ STATISTICS ============

function initializeStatistics() {
  updateStatistics();
  createCharts();
}

function updateStatistics() {
  const stats = calculateBasicStats();
  updateDashboardCards(stats);
}

function calculateBasicStats() {
  const seenItems = watchlist.filter(item => item.seen);
  const favorites = watchlist.filter(item => item.favorite);

  const movies = seenItems.filter(item => (item.media_type || item.type) === 'movie');
  const series = seenItems.filter(item => {
    const type = item.media_type || item.type;
    return type === 'tv' || type === 'anime';
  });

  const genres = {};
  seenItems.forEach(item => {
    if(item.genres_text) {
      item.genres_text.split(',').forEach(genre => {
        const cleanGenre = genre.trim();
        if(cleanGenre) genres[cleanGenre] = (genres[cleanGenre] || 0) + 1;
      });
    }
  });

  const topGenre = Object.keys(genres).length > 0 ? 
    Object.keys(genres).reduce((a, b) => genres[a] > genres[b] ? a : b) : 
    'Keine Daten';

  const estimatedHours = (movies.length * 2) + (series.length * 10);

  return {
    totalMovies: movies.length,
    totalSeries: series.length,
    totalFavorites: favorites.length,
    watchlistTotal: watchlist.length,
    estimatedHours,
    topGenre,
    genres,
    seenItems
  };
}

function updateDashboardCards(stats) {
  const el = (id) => document.getElementById(id);
  if(el('total-movies')) el('total-movies').textContent = stats.totalMovies;
  if(el('total-series')) el('total-series').textContent = stats.totalSeries;
  if(el('total-favorites')) el('total-favorites').textContent = stats.totalFavorites;
  if(el('watchlist-total')) el('watchlist-total').textContent = stats.watchlistTotal;
  if(el('estimated-hours')) el('estimated-hours').textContent = `${stats.estimatedHours}h`;
  if(el('top-genre')) el('top-genre').textContent = stats.topGenre;
}

function createCharts() {
  if(genreChart) genreChart.destroy();
  if(typeChart) typeChart.destroy();

  setTimeout(() => {
    createGenreChart();
    createTypeChart();
  }, 100);
}

function createGenreChart() {
  const genreCanvas = document.getElementById('genreChart');
  if(!genreCanvas) return;

  const stats = calculateBasicStats();
  const genreData = Object.entries(stats.genres)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 8);

  if(genreData.length === 0) return;

  const colors = ['#6366f1', '#a855f7', '#38bdf8', '#2dd4bf', '#f59e0b', '#f43f5e', '#c084fc', '#6b7280'];

  genreChart = new Chart(genreCanvas, {
    type: 'doughnut',
    data: {
      labels: genreData.map(([genre]) => genre),
      datasets: [{
        data: genreData.map(([, count]) => count),
        backgroundColor: colors,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom' }
      }
    }
  });
}

function createTypeChart() {
  const typeCanvas = document.getElementById('typeChart');
  if(!typeCanvas) return;

  const seenItems = watchlist.filter(item => item.seen);
  const movies = seenItems.filter(item => (item.media_type || item.type) === 'movie').length;
  const tv = seenItems.filter(item => (item.media_type || item.type) === 'tv').length;
  const anime = seenItems.filter(item => (item.media_type || item.type) === 'anime').length;

  if(movies === 0 && tv === 0 && anime === 0) return;

  typeChart = new Chart(typeCanvas, {
    type: 'bar',
    data: {
      labels: ['Filme', 'Serien', 'Anime'],
      datasets: [{
        label: 'Anzahl gesehen',
        data: [movies, tv, anime],
        backgroundColor: ['#6366f1', '#38bdf8', '#a855f7'],
        borderRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, ticks: { stepSize: 1 } }
      }
    }
  });
}

// ============ UTILITY FUNCTIONS ============

function exportWatchlist() {
  const blob = new Blob([JSON.stringify(watchlist, null, 2)], {type: "application/json"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); 
  a.href = url; 
  a.download = `watchlist-${new Date().toISOString().split('T')[0]}.json`; 
  a.click();
  URL.revokeObjectURL(url);
  showSnackbar("Watchlist exportiert!");
}

function importWatchlist() {
  const file = document.getElementById("import-file")?.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if(Array.isArray(data)) {
        watchlist = sanitizeWatchlist(data);
        watchlist.forEach(item => {
          if(!item.addedAt) item.addedAt = new Date().toISOString();
          if(item.seen && !item.seenAt) item.seenAt = new Date().toISOString();
        });
        renderWatchlist();
        saveWatchlistToServer();
        showSnackbar("Watchlist importiert!");
      }
    } catch {
      alert("Import fehlgeschlagen.");
    }
  };
  reader.readAsText(file);
}

function toggleTheme() {
  document.documentElement.classList.toggle('light-mode');
  const isLight = document.documentElement.classList.contains('light-mode');
  localStorage.setItem("theme", isLight ? "light" : "dark");
  showSnackbar(isLight ? "Heller Modus" : "Dunkler Modus");

  setTimeout(() => {
    if(genreChart || typeChart) createCharts();
  }, 500);
}

// ============ NAVIGATION ============

(function() {
  function initSimpleNav() {
    const nav = document.getElementById('sidebar-nav');
    if (!nav) {
      setTimeout(initSimpleNav, 500);
      return;
    }

    const items = nav.querySelectorAll('.menu-item[data-section]');

    if (items.length === 0) {
      setTimeout(initSimpleNav, 500);
      return;
    }

    items.forEach(item => {
      const sectionId = item.getAttribute('data-section');

      item.onclick = function(e) {
        e.preventDefault();
        items.forEach(i => i.classList.remove('active'));
        this.classList.add('active');

        const target = document.getElementById(sectionId);
        if (target) target.scrollIntoView({ behavior: 'smooth' });
      };
    });

    if (items[0]) items[0].classList.add('active');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSimpleNav);
      attemptAutoLogin(); 
  } else {
    initSimpleNav();
  }
})();

// ============ INITIALIZATION ============

document.addEventListener('DOMContentLoaded', () => {
  setTimeout(initEpisodesCloseListener, 1000);

  const storedTheme = localStorage.getItem("theme");
  if(storedTheme === "light") document.documentElement.classList.add('light-mode');

  const storedVideoEnabled = localStorage.getItem('videoBackgroundEnabled');
  if(storedVideoEnabled !== null) isVideoEnabled = storedVideoEnabled === 'true';

  const videoCheckbox = document.getElementById('enable-video-bg');
  if(videoCheckbox) videoCheckbox.checked = isVideoEnabled;
});

console.log('✅ TMDB-Only Watchlist geladen');

// =====================================================
// NEUE FUNKTIONEN
// =====================================================

// 1. ⭐ EIGENE BEWERTUNG (User Rating)
function setUserRating(id, media_type, rating) {
    const item = watchlist.find(i => i.id === id && (i.media_type || i.type) === media_type);
    if(item) {
        item.user_rating = rating;
        renderWatchlist();
        saveWatchlistToServer();
        showSnackbar(`Bewertung: ${rating}/10 ⭐`);
    }
}
window.setUserRating = setUserRating;

// Rating-Modal öffnen
function openRatingModal(id, media_type) {
    const item = watchlist.find(i => i.id === id && (i.media_type || i.type) === media_type);
    if(!item) return;
    
    const currentRating = item.user_rating || 0;
    let html = '<div class="rating-modal" style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:var(--card-bg);padding:20px;border-radius:12px;z-index:10000;min-width:280px;box-shadow:0 10px 40px rgba(0,0,0,0.5);">';
    html += `<h3 style="margin:0 0 15px 0;">Bewerte: ${escapeHtml(item.title || item.name)}</h3>`;
    html += '<div class="rating-stars" style="display:flex;gap:5px;justify-content:center;margin:20px 0;">';
    for(let i=1; i<=10; i++) {
        const filled = i <= currentRating ? 'color:#fbbf24;' : 'color:#4b5563;';
        html += `<span onclick="setUserRating(${id},'${media_type}',${i})" style="cursor:pointer;font-size:28px;${filled}" data-rating="${i}">★</span>`;
    }
    html += '</div>';
    html += '<button onclick="closeRatingModal()" style="width:100%;padding:10px;border:none;background:var(--accent-primary);color:white;border-radius:6px;cursor:pointer;">Fertig</button>';
    html += '</div>';
    
    const overlay = document.createElement('div');
    overlay.id = 'rating-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);
}
window.openRatingModal = openRatingModal;

function closeRatingModal() {
    const overlay = document.getElementById('rating-overlay');
    if(overlay) overlay.remove();
}
window.closeRatingModal = closeRatingModal;

// 2. 📝 NOTIZEN PRO EINTRAG
function openNotesModal(id, media_type) {
    const item = watchlist.find(i => i.id === id && (i.media_type || i.type) === media_type);
    if(!item) return;
    
    const currentNote = item.notes || '';
    let html = '<div style="background:var(--card-bg);padding:20px;border-radius:12px;min-width:320px;max-width:90%;">';
    html += `<h3 style="margin:0 0 15px 0;">Notiz: ${escapeHtml(item.title || item.name)}</h3>`;
    html += `<textarea id="note-input" style="width:100%;height:120px;background:var(--bg-secondary);border:1px solid var(--border-color);border-radius:8px;padding:10px;color:var(--text-primary);resize:vertical;" placeholder="Deine Notiz...">${escapeHtml(currentNote)}</textarea>`;
    html += '<div style="display:flex;gap:10px;margin-top:15px;">';
    html += '<button onclick="saveNoteAndClose('+id+',\''+media_type+'\')" style="flex:1;padding:10px;border:none;background:var(--accent-primary);color:white;border-radius:6px;cursor:pointer;">Speichern</button>';
    html += '<button onclick="closeRatingModal()" style="flex:1;padding:10px;border:none;background:var(--bg-tertiary);color:var(--text-primary);border-radius:6px;cursor:pointer;">Abbrechen</button>';
    html += '</div></div>';
    
    const overlay = document.createElement('div');
    overlay.id = 'rating-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);
}
window.openNotesModal = openNotesModal;

function saveNoteAndClose(id, media_type) {
    const note = document.getElementById('note-input')?.value || '';
    const item = watchlist.find(i => i.id === id && (i.media_type || i.type) === media_type);
    if(item) {
        item.notes = note;
        saveWatchlistToServer();
        showSnackbar('Notiz gespeichert!');
    }
    closeRatingModal();
}
window.saveNoteAndClose = saveNoteAndClose;

// 3. 📊 SORTIEREN
let currentSort = { field: 'addedAt', direction: 'desc' };

// Tier-Daten aus /api/ranking – nur für die Sortierung "Tier-Ranking"
const WL_TIER_VALUES = { S: 7, A: 6, B: 5, C: 4, D: 3, E: 2, F: 1 };
let watchlistRanking = {};

async function loadRankingForSort() {
  try {
    const data = await apiFetch('/api/ranking');
    const loaded = data.ranking || {};
    watchlistRanking = {};
    Object.entries(loaded).forEach(([id, v]) => {
      watchlistRanking[id] = typeof v === 'string' ? v : (v && v.tier);
    });
  } catch (e) {
    console.warn('Ranking für Sortierung nicht geladen:', e);
  }
}

// Sortiermodus aus dem Dropdown übernehmen (feste Richtung je Feld)
function applyWatchlistSort(field) {
  const directions = { addedAt: 'desc', title: 'asc', rating: 'desc', tier: 'desc' };
  currentSort = { field, direction: directions[field] || 'desc' };
  renderWatchlist();
}
window.applyWatchlistSort = applyWatchlistSort;

function sortWatchlist(field) {
    if(currentSort.field === field) {
        currentSort.direction = currentSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        currentSort.field = field;
        currentSort.direction = 'desc';
    }
    renderWatchlist();
    showSnackbar(`Sortiert nach: ${field} (${currentSort.direction === 'asc' ? '↑' : '↓'})`);
}
window.sortWatchlist = sortWatchlist;

function getSortedWatchlist(items) {
    const { field, direction } = currentSort;
    const sorted = [...items].sort((a, b) => {
        let valA, valB;
        
        switch(field) {
            case 'title':
                valA = (a.title || a.name || '').toLowerCase();
                valB = (b.title || b.name || '').toLowerCase();
                break;
            case 'rating':
                valA = a.user_rating || a.vote_average || 0;
                valB = b.user_rating || b.vote_average || 0;
                break;
            case 'addedAt':
                valA = new Date(a.addedAt || 0).getTime();
                valB = new Date(b.addedAt || 0).getTime();
                break;
            case 'type':
                valA = (a.media_type || a.type || '').toLowerCase();
                valB = (b.media_type || b.type || '').toLowerCase();
                break;
            case 'seen':
                valA = a.seen ? 1 : 0;
                valB = b.seen ? 1 : 0;
                break;
            case 'tier':
                valA = WL_TIER_VALUES[watchlistRanking[a.id]] || 0;
                valB = WL_TIER_VALUES[watchlistRanking[b.id]] || 0;
                break;
            default:
                valA = a[field] || 0;
                valB = b[field] || 0;
        }
        
        if(valA < valB) return direction === 'asc' ? -1 : 1;
        if(valA > valB) return direction === 'asc' ? 1 : -1;
        return 0;
    });
    return sorted;
}

// 4. 🎲 ZUFÄLLIGER EINTRAG
function pickRandomFromWatchlist() {
    const notSeen = watchlist.filter(i => !i.seen);
    if(notSeen.length === 0) {
        showSnackbar('Keine ungesehenen Einträge vorhanden!');
        return;
    }
    const random = notSeen[Math.floor(Math.random() * notSeen.length)];
    
    // Modal anzeigen
    const posterUrl = random.poster_path 
        ? (random.poster_path.startsWith('http') ? random.poster_path : TMDB_IMG_BASE + random.poster_path)
        : 'https://via.placeholder.com/200x300?text=No+Image';
    
    let html = '<div style="text-align:center;min-width:300px;">';
    html += '<h2 style="margin-bottom:20px;">🎬 Was du schauen solltest:</h2>';
    html += `<img src="${escapeHtml(posterUrl)}" style="width:150px;border-radius:12px;margin-bottom:15px;" onerror="this.src='https://via.placeholder.com/150x225?text=No+Image'">`;
    html += `<h3 style="margin:10px 0;">${escapeHtml(random.title || random.name)}</h3>`;
    html += `<p style="color:var(--text-secondary);">${escapeHtml(formatType(random.media_type || random.type))} • ${showStars(random.vote_average)}</p>`;
    if(random.notes) html += `<p style="color:var(--accent-primary);font-style:italic;margin-top:10px;">"${escapeHtml(random.notes)}"</p>`;
    html += '<div style="margin-top:20px;display:flex;gap:10px;justify-content:center;">';
    html += `<button onclick="closeRatingModal();showInfoOverlay(watchlist.find(i=>i.id===${random.id}))" style="padding:10px 20px;border:none;background:var(--accent-primary);color:white;border-radius:6px;cursor:pointer;">ℹ️ Details</button>`;
    html += '<button onclick="pickRandomFromWatchlist()" style="padding:10px 20px;border:none;background:var(--bg-tertiary);color:var(--text-primary);border-radius:6px;cursor:pointer;">🎲 Nochmal</button>';
    html += '</div></div>';
    
    const overlay = document.createElement('div');
    overlay.id = 'rating-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);
}
window.pickRandomFromWatchlist = pickRandomFromWatchlist;

// 5. 📈 VERBESSERTE STATISTIKEN
function calculateAdvancedStats() {
    const stats = calculateBasicStats();
    
    // Eigene Durchschnittsbewertung
    const ratedItems = watchlist.filter(i => i.user_rating);
    stats.avgUserRating = ratedItems.length > 0 
        ? (ratedItems.reduce((sum, i) => sum + i.user_rating, 0) / ratedItems.length).toFixed(1)
        : '-';
    
    // Zeit "gespart" durch gesehen (angenommen 2h pro Film, 45min pro Serienepisode)
    const seenMovies = watchlist.filter(i => i.seen && (i.media_type || i.type) === 'movie').length;
    stats.timeWatched = seenMovies * 2;
    stats.timeWatchedFormatted = `${stats.timeWatched}h`;
    
    // Lieblings-Genre (basierend auf Favoriten)
    const favorites = watchlist.filter(i => i.favorite);
    const genreCount = {};
    favorites.forEach(i => {
        if(i.genres_text) {
            i.genres_text.split(',').forEach(g => {
                const clean = g.trim();
                genreCount[clean] = (genreCount[clean] || 0) + 1;
            });
        }
    });
    stats.favoriteGenre = Object.keys(genreCount).length > 0 
        ? Object.keys(genreCount).reduce((a, b) => genreCount[a] > genreCount[b] ? a : b)
        : '-';
    
    // Bewertungen Verteilung
    stats.ratingDistribution = {};
    for(let i=1; i<=10; i++) stats.ratingDistribution[i] = 0;
    ratedItems.forEach(i => {
        if(i.user_rating >= 1 && i.user_rating <= 10) {
            stats.ratingDistribution[i.user_rating]++;
        }
    });
    
    // Oldest/Newest
    const sortedByDate = [...watchlist].sort((a,b) => new Date(a.addedAt) - new Date(b.addedAt));
    stats.oldestEntry = sortedByDate[0];
    stats.newestEntry = sortedByDate[sortedByDate.length - 1];
    
    return stats;
}

function updateAdvancedDashboard() {
    const stats = calculateAdvancedStats();
    
    // Zusätzliche Stats-Card
    const statsContainer = document.getElementById('statistics');
    if(!statsContainer) return;
    
    // Check if advanced stats already exist
    if(document.getElementById('advanced-stats-section')) return;
    
    let html = '<div id="advanced-stats-section" style="margin-top:20px;padding:20px;background:var(--card-bg);border-radius:12px;">';
    html += '<h3>📈 Erweiterte Statistiken</h3>';
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:15px;margin-top:15px;">';
    html += `<div style="background:var(--bg-secondary);padding:15px;border-radius:8px;text-align:center;">
        <div style="font-size:28px;color:var(--accent-primary);">⭐</div>
        <div style="font-size:24px;font-weight:bold;">${stats.avgUserRating}</div>
        <div style="font-size:12px;color:var(--text-secondary);">Ø Deine Bewertung</div>
    </div>`;
    html += `<div style="background:var(--bg-secondary);padding:15px;border-radius:8px;text-align:center;">
        <div style="font-size:28px;">❤️</div>
        <div style="font-size:24px;font-weight:bold;">${stats.favoriteGenre}</div>
        <div style="font-size:12px;color:var(--text-secondary);">Lieblings-Genre</div>
    </div>`;
    html += `<div style="background:var(--bg-secondary);padding:15px;border-radius:8px;text-align:center;">
        <div style="font-size:28px;">⏱️</div>
        <div style="font-size:24px;font-weight:bold;">${stats.timeWatchedFormatted}</div>
        <div style="font-size:12px;color:var(--text-secondary);">Gesehen</div>
    </div>`;
    html += '</div></div>';
    
    statsContainer.insertAdjacentHTML('beforeend', html);
}

// 6. 🔗 WATCHLIST TEILEN
async function shareWatchlist() {
    const shareData = {
        title: 'Meine Watchlist',
        text: `Schau mal meine Watchlist! ${watchlist.length} Einträge.`,
        url: window.location.href
    };
    
    if(navigator.share) {
        try {
            await navigator.share(shareData);
            showSnackbar('Watchlist geteilt! 🎉');
        } catch(e) {
            if(e.name !== 'AbortError') {
                copyShareLink();
            }
        }
    } else {
        copyShareLink();
    }
}
window.shareWatchlist = shareWatchlist;

function copyShareLink() {
    const text = `Meine Watchlist (${watchlist.length} Einträge):\n\n` + 
        watchlist.slice(0, 10).map(i => `• ${i.title || i.name} (${formatType(i.media_type || i.type)})`).join('\n') +
        (watchlist.length > 10 ? `\n... und ${watchlist.length - 10} weitere` : '');
    
    navigator.clipboard.writeText(text).then(() => {
        showSnackbar('In Zwischenablage kopiert! 📋');
    }).catch(() => {
        showSnackbar('Teilen nicht möglich');
    });
}

// 7. 🌙 THEME TOGGLE VERBESSERT
function toggleThemeAdvanced() {
    const themes = ['dark', 'light', 'midnight', 'forest'];
    const current = localStorage.getItem('theme') || 'dark';
    const nextIndex = (themes.indexOf(current) + 1) % themes.length;
    const nextTheme = themes[nextIndex];
    
    document.documentElement.className = nextTheme + '-mode';
    localStorage.setItem('theme', nextTheme);
    
    const themeNames = { dark: '🌑 Dunkel', light: '☀️ Hell', midnight: '🌃 Mitternacht', forest: '🌲 Wald' };
    showSnackbar(`Theme: ${themeNames[nextTheme]}`);
    
    // Charts neu zeichnen
    setTimeout(() => {
        if(genreChart || typeChart) createCharts();
    }, 300);
}
window.toggleThemeAdvanced = toggleThemeAdvanced;

// 8. 🔍 DUPLIKATE FINDEN
function findDuplicates() {
    const seen = {};
    const duplicates = [];
    
    watchlist.forEach((item, index) => {
        const key = `${item.title || item.name}_${item.media_type || item.type}`.toLowerCase();
        if(seen[key]) {
            duplicates.push({ original: seen[key], duplicate: item });
        } else {
            seen[key] = item;
        }
    });
    
    if(duplicates.length === 0) {
        showSnackbar('Keine Duplikate gefunden! ✅');
        return;
    }
    
    // Modal mit Duplikaten
    let html = '<div style="min-width:350px;max-width:90%;max-height:80vh;overflow-y:auto;">';
    html += `<h3 style="margin:0 0 15px 0;">🔍 ${duplicates.length} Duplikat(e) gefunden</h3>`;
    
    duplicates.forEach(d => {
        html += `<div style="background:var(--bg-secondary);padding:12px;border-radius:8px;margin-bottom:10px;">`;
        html += `<p style="margin:0 0 10px 0;font-weight:bold;">${escapeHtml(d.original.title || d.original.name)}</p>`;
        html += `<button onclick="removeFromWatchlist(${d.duplicate.id},'${d.duplicate.media_type || d.duplicate.type}');closeRatingModal();findDuplicates();" style="padding:8px 12px;border:none;background:var(--accent-danger);color:white;border-radius:6px;cursor:pointer;">🗑️ Duplikat entfernen</button>`;
        html += '</div>';
    });
    
    html += '<button onclick="closeRatingModal()" style="width:100%;padding:10px;border:none;background:var(--bg-tertiary);color:var(--text-primary);border-radius:6px;cursor:pointer;margin-top:10px;">Schließen</button>';
    html += '</div>';
    
    const overlay = document.createElement('div');
    overlay.id = 'rating-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:center;justify-content:center;';
    overlay.innerHTML = html;
    document.body.appendChild(overlay);
}
window.findDuplicates = findDuplicates;

// 9. ✅ BULK-AKTIONEN
let selectedItems = new Set();
let bulkMode = false;

function toggleBulkMode() {
    bulkMode = !bulkMode;
    selectedItems.clear();
    
    const btn = document.getElementById('bulk-mode-btn');
    if(btn) btn.textContent = bulkMode ? '✅ Fertig' : '☑️ Auswählen';
    
    renderWatchlist();
    showSnackbar(bulkMode ? 'Bulk-Modus aktiviert' : 'Bulk-Modus deaktiviert');
}
window.toggleBulkMode = toggleBulkMode;

function toggleItemSelection(id, media_type) {
    const key = `${id}_${media_type}`;
    if(selectedItems.has(key)) {
        selectedItems.delete(key);
    } else {
        selectedItems.add(key);
    }
    renderWatchlist();
}
window.toggleItemSelection = toggleItemSelection;

function bulkMarkAsSeen() {
    if(selectedItems.size === 0) {
        showSnackbar('Nichts ausgewählt!');
        return;
    }
    
    selectedItems.forEach(key => {
        const [id, media_type] = key.split('_');
        const item = watchlist.find(i => i.id == id && (i.media_type || i.type) === media_type);
        if(item) {
            item.seen = true;
            item.seenAt = new Date().toISOString();
        }
    });
    
    selectedItems.clear();
    saveWatchlistToServer();
    renderWatchlist();
    showSnackbar('Als gesehen markiert! ✅');
}
window.bulkMarkAsSeen = bulkMarkAsSeen;

function bulkDelete() {
    if(selectedItems.size === 0) {
        showSnackbar('Nichts ausgewählt!');
        return;
    }
    
    if(!confirm(`${selectedItems.size} Einträge wirklich löschen?`)) return;
    
    selectedItems.forEach(key => {
        const [id, media_type] = key.split('_');
        watchlist = watchlist.filter(i => !(i.id == id && (i.media_type || i.type) === media_type));
    });
    
    selectedItems.clear();
    saveWatchlistToServer();
    renderWatchlist();
    showSnackbar('Einträge gelöscht! 🗑️');
}
window.bulkDelete = bulkDelete;

function selectAll() {
    watchlist.forEach(i => {
        selectedItems.add(`${i.id}_${i.media_type || i.type}`);
    });
    renderWatchlist();
    showSnackbar('Alle ausgewählt');
}
window.selectAll = selectAll;

// 10. ERWEITERTE RENDERASGRID FUNKTION
function renderAsGridExtended(container, entries, options = {}) {
    container.innerHTML = '';
    
    if (!entries.length) {
        container.innerHTML = "<i>Keine Einträge.</i>";
        return;
    }
    
    // Sortieren anwenden
    const sortedEntries = options.skipSort ? entries : getSortedWatchlist(entries);
    
    const grid = document.createElement("div");
    grid.className = "grid-list";
    
    sortedEntries.forEach(item => {
        const card = document.createElement("div");
        card.className = "card";
        
        const disableBtn = options.disableBtn && options.disableBtn(item);
        let isSeen = !!item.seen;
        const isSelected = selectedItems.has(`${item.id}_${item.media_type || item.type}`);

        // Status-Klassen für die Karten-Optik (siehe index.css)
        if (isSeen) card.classList.add('is-seen');
        if (item.favorite) card.classList.add('is-fav');

        const posterUrl = item.poster_path 
            ? (item.poster_path.startsWith('http') ? item.poster_path : TMDB_IMG_BASE + item.poster_path)
            : 'https://via.placeholder.com/100?text=No+Image';
        
        let cardHtml = '';
        
        // Bulk-Mode Checkbox
        if(bulkMode && options.showBulk !== false) {
            cardHtml += `<input type="checkbox" class="bulk-checkbox" ${isSelected ? 'checked' : ''} onclick="toggleItemSelection(${item.id},'${item.media_type || item.type}')" style="position:absolute;top:8px;left:8px;width:20px;height:20px;cursor:pointer;z-index:10;">`;
        }
        
        // Poster mit Status-Badges (Bewertung auf dem Poster statt als Text)
        cardHtml += `<div class="card-poster">`;
        cardHtml += `<img src="${escapeHtml(posterUrl)}" alt="${escapeHtml(item.title || item.name)}" onerror="this.src='https://via.placeholder.com/100?text=No+Image'">`;
        if(item.user_rating) {
            cardHtml += `<span class="poster-rating" title="Deine Bewertung">${escapeHtml(item.user_rating)}<small>/10</small></span>`;
        }
        if(isSeen) {
            cardHtml += `<span class="poster-seen" title="Schon gesehen">✓</span>`;
        }
        cardHtml += `</div>`;
        cardHtml += `<div class="info">`;
        cardHtml += `<h3>${escapeHtml(item.title || item.name || "Unbekannt")}</h3>`;
        cardHtml += `<p class="small">Typ: ${escapeHtml(formatType(item.media_type || item.type))}</p>`;
        cardHtml += `<div class="stars">${showStars(item.vote_average)}</div>`;
        cardHtml += `<div class="small">${escapeHtml(item.genres_text || guessGenres(item))}</div>`;
        
        // Notiz anzeigen
        if(item.notes) {
            cardHtml += `<p class="small" style="color:var(--text-secondary);font-style:italic;margin-top:5px;">📝 ${escapeHtml(String(item.notes).substring(0,50))}${item.notes.length > 50 ? '...' : ''}</p>`;
        }
        
        // Favorit bleibt direkt auf der Karte (Schnellzugriff)
        if(options.showFav !== false && item.hasOwnProperty("favorite")) {
            cardHtml += `<span class="favorite" title="Favorit" onclick="toggleFavorite(${item.id}, '${item.media_type || item.type}')">${item.favorite ? "⭐" : "☆"}</span>`;
        }

        // Hinzufügen-Button bleibt direkt auf der Karte
        if(options.showAdd) {
            cardHtml += `<button onclick="addToWatchlist(${item.id}, '${item.media_type || item.type || 'movie'}')" ${disableBtn ? "disabled" : ""}>${disableBtn ? "✓ Drin" : "➕ Zur Watchlist"}</button>`;
        }

        // Direkter "Gesehen"-Umschalter (nur in der Watchlist)
        if(options.showSeen) {
            cardHtml += `<button class="seen-toggle ${isSeen ? 'is-seen-active' : ''}" onclick="toggleSeen(${item.id}, '${item.media_type || item.type}')">${isSeen ? '✓ Gesehen' : '👁️ Als gesehen markieren'}</button>`;
        }

        cardHtml += `</div>`;
        card.innerHTML = cardHtml;

        // Alle übrigen Aktionen (Info, Episoden, Bewerten, Notiz, Gesehen,
        // Entfernen, Streaming-Links) liegen hinter dem "⋯"-Button.
        const actionsBtn = document.createElement("button");
        actionsBtn.className = "card-actions-btn";
        actionsBtn.textContent = "⋯ Aktionen";
        actionsBtn.addEventListener("click", e => {
            e.stopPropagation();
            const menu = document.getElementById('card-action-menu');
            if (menu && menu.style.display === 'block' && menu._anchor === actionsBtn) {
                closeCardMenu();
            } else {
                openCardMenu(item, actionsBtn, options);
            }
        });
        card.querySelector(".info").appendChild(actionsBtn);

        grid.appendChild(card);
    });

    container.appendChild(grid);
}

// ============ KARTEN-AKTIONSMENÜ (Dropdown an der Karte) ============

function getCardMenuEl() {
    let menu = document.getElementById('card-action-menu');
    if (!menu) {
        menu = document.createElement('div');
        menu.id = 'card-action-menu';
        menu.className = 'card-action-menu';
        document.body.appendChild(menu);
    }
    return menu;
}

function closeCardMenu() {
    const menu = document.getElementById('card-action-menu');
    if (menu) { menu.style.display = 'none'; menu._anchor = null; }
}
window.closeCardMenu = closeCardMenu;

function openCardMenu(item, anchorEl, options = {}) {
    const menu = getCardMenuEl();
    const type = item.media_type || item.type;
    const isSeen = !!item.seen;
    const isSeries = type === 'tv' || type === 'anime';

    const rows = [`<button type="button" data-act="info">ℹ️ Info &amp; Trailer</button>`];
    if (isSeries) rows.push(`<button type="button" data-act="episodes">📺 Episoden verwalten</button>`);
    if (options.showActions !== false) {
        rows.push(`<button type="button" data-act="rate">⭐ Bewerten</button>`);
        rows.push(`<button type="button" data-act="note">📝 Notiz</button>`);
    }
    if (options.showRemove) {
        rows.push(`<button type="button" data-act="seen">${isSeen ? '↩️ Als ungesehen markieren' : '✅ Als gesehen markieren'}</button>`);
        rows.push(`<button type="button" data-act="remove" class="cam-danger">🗑️ Aus Watchlist entfernen</button>`);
    }

    menu.innerHTML =
        `<div class="cam-title">${escapeHtml(item.title || item.name || 'Titel')}</div>` +
        rows.join('') +
        `<div class="cam-label">Streaming suchen</div>` +
        generateExternalSearchLinks(item.title || item.name);

    menu.querySelectorAll('button[data-act]').forEach(b => {
        b.addEventListener('click', () => {
            const act = b.dataset.act;
            closeCardMenu();
            if (act === 'info') showInfoOverlay(item);
            else if (act === 'episodes') openEpisodesManager(item);
            else if (act === 'rate') openRatingModal(item.id, type);
            else if (act === 'note') openNotesModal(item.id, type);
            else if (act === 'seen') toggleSeen(item.id, type);
            else if (act === 'remove') removeFromWatchlist(item.id, type);
        });
    });

    // Positionieren: an den Button angedockt, bei Platzmangel umklappen
    menu.style.display = 'block';
    menu.style.visibility = 'hidden';
    menu._anchor = anchorEl;
    const r = anchorEl.getBoundingClientRect();
    const mw = menu.offsetWidth;
    const mh = menu.offsetHeight;
    let left = r.left;
    let top = r.bottom + 6;
    if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
    if (left < 8) left = 8;
    if (top + mh > window.innerHeight - 8) top = r.top - mh - 6;
    if (top < 8) top = 8;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.visibility = 'visible';
}
window.openCardMenu = openCardMenu;

// Menü schließen bei Klick außerhalb, Escape oder Scrollen
document.addEventListener('click', e => {
    const menu = document.getElementById('card-action-menu');
    if (!menu || menu.style.display !== 'block') return;
    if (menu.contains(e.target)) return;
    if (e.target.closest && e.target.closest('.card-actions-btn')) return;
    closeCardMenu();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeCardMenu(); });
window.addEventListener('scroll', () => closeCardMenu(), true);

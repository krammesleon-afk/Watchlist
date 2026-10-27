// Watch-Party: hält einen YouTube-Player synchron mit dem Raumzustand vom Server.
//
// Der Server schickt { videoId, playing, position } – die Position gilt für
// den Moment, in dem die Nachricht ankommt. Daraus rechnet der Browser die
// aktuelle Soll-Position aus und zieht den Player nach, wenn er abweicht.
// Eigene Klicks im Player (Play, Pause, Spulen) gehen als Aktion an den Server.
(function () {
  const token = Auth.requireAuth();
  if (!token) return;

  const { toast, escapeHtml, copyText } = Satho;
  const $ = (id) => document.getElementById(id);
  const api = (path, opts) => Auth.api(path, token, opts);

  const code = (new URLSearchParams(location.search).get('r') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  // ===== Lobby =====
  if (!code) {
    $('lobby').classList.remove('hidden');
    $('create-btn').addEventListener('click', async () => {
      try {
        const { code } = await api('/party', { method: 'POST' });
        location.search = '?r=' + code;
      } catch (e) { toast(e.message, true); }
    });
    const join = () => {
      const c = $('join-code').value.trim().toUpperCase();
      if (c) location.search = '?r=' + encodeURIComponent(c);
    };
    $('join-btn').addEventListener('click', join);
    $('join-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
    return;
  }

  // ===== Raum =====
  $('room').classList.remove('hidden');
  $('room-code').textContent = code;
  $('share-btn').addEventListener('click', () => copyText(location.origin + '/party.html?r=' + code));

  let state = null;       // letzter Zustand vom Server
  let stateAt = 0;        // wann er angekommen ist (Date.now())
  let player = null;
  let playerReady = false;
  let loadedVideo = null;
  let suppressUntil = 0;  // Player-Ereignisse kurz nach eigenem Nachziehen ignorieren
  let started = false;

  function expectedPosition() {
    if (!state) return 0;
    return state.playing ? state.position + (Date.now() - stateAt) / 1000 : state.position;
  }

  function action(body) {
    return api(`/party/${code}/action`, { method: 'POST', body }).catch((e) => toast(e.message, true));
  }

  // ===== Verbindung =====
  let events = null;
  async function connect() {
    try {
      const { ticket } = await api(`/party/${code}/ticket`, { method: 'POST' });
      events = new EventSource(`/api/party/${code}/events?ticket=${encodeURIComponent(ticket)}`);
    } catch (e) {
      $('start-overlay').innerHTML = `<div class="big">😕</div><p class="muted">${escapeHtml(e.message)}</p>
        <a class="btn" href="/party.html" style="text-decoration:none">Zur Übersicht</a>`;
      return;
    }
    events.addEventListener('state', (e) => {
      state = JSON.parse(e.data);
      stateAt = Date.now();
      renderNow();
      renderQueue();
      applyState();
    });
    events.addEventListener('members', (e) => renderMembers(JSON.parse(e.data)));
    events.addEventListener('chat-history', (e) => {
      $('chat-log').innerHTML = '';
      JSON.parse(e.data).forEach(addChat);
    });
    events.addEventListener('chat', (e) => addChat(JSON.parse(e.data)));
    events.onerror = () => {
      events.close();
      setTimeout(connect, 3000);
    };
  }

  // ===== YouTube-Player =====
  function loadYouTubeApi() {
    return new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) return resolve();
      window.onYouTubeIframeAPIReady = resolve;
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      s.onerror = () => reject(new Error('YouTube konnte nicht geladen werden'));
      document.head.appendChild(s);
      setTimeout(() => reject(new Error('YouTube antwortet nicht')), 15000);
    });
  }

  $('start-btn').addEventListener('click', async () => {
    $('start-btn').disabled = true;
    try {
      await loadYouTubeApi();
    } catch (e) {
      $('start-btn').disabled = false;
      toast(e.message + ' – blockiert ein Werbeblocker youtube.com?', true);
      return;
    }
    player = new YT.Player('player', {
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
      events: {
        onReady: () => {
          playerReady = true;
          started = true;
          $('start-overlay').classList.add('hidden');
          applyState();
        },
        onStateChange: onPlayerState,
      },
    });
  });

  function applyState() {
    $('idle-overlay').classList.toggle('hidden', !started || !!(state && state.videoId));
    if (!playerReady || !state) return;
    const target = expectedPosition();

    if (!state.videoId) {
      if (loadedVideo) { player.stopVideo(); loadedVideo = null; }
      return;
    }

    suppressUntil = Date.now() + 1500;
    if (state.videoId !== loadedVideo) {
      loadedVideo = state.videoId;
      if (state.playing) player.loadVideoById({ videoId: state.videoId, startSeconds: target });
      else player.cueVideoById({ videoId: state.videoId, startSeconds: target });
      return;
    }

    const ps = player.getPlayerState();
    if (Math.abs(player.getCurrentTime() - target) > 1.5) player.seekTo(target, true);
    if (state.playing && ps !== YT.PlayerState.PLAYING && ps !== YT.PlayerState.BUFFERING) player.playVideo();
    if (!state.playing && ps === YT.PlayerState.PLAYING) player.pauseVideo();
  }

  function onPlayerState(e) {
    if (!state || !state.videoId) return;
    const S = YT.PlayerState;

    // Titel nachreichen, sobald YouTube ihn kennt
    if (e.data === S.PLAYING && !state.title) {
      const title = (player.getVideoData() || {}).title;
      if (title) action({ type: 'title', videoId: state.videoId, title });
    }

    if (e.data === S.ENDED) {
      action({ type: 'ended', videoId: state.videoId });
      return;
    }
    if (Date.now() < suppressUntil) return;

    const pos = player.getCurrentTime();
    if (e.data === S.PLAYING && !state.playing) action({ type: 'play', position: pos });
    else if (e.data === S.PAUSED && state.playing) action({ type: 'pause', position: pos });
    else if (e.data === S.PLAYING && Math.abs(pos - expectedPosition()) > 2) action({ type: 'seek', position: pos });
  }

  // Regelmäßig nachziehen, falls ein Browser hinterherhinkt
  setInterval(() => {
    if (!playerReady || !state || !state.videoId || !state.playing || Date.now() < suppressUntil) return;
    if (player.getPlayerState() !== YT.PlayerState.PLAYING) return;
    const drift = player.getCurrentTime() - expectedPosition();
    if (Math.abs(drift) > 1.5) {
      suppressUntil = Date.now() + 1500;
      player.seekTo(expectedPosition(), true);
    }
  }, 2000);

  // ===== Anzeige =====
  function renderNow() {
    const el = $('now');
    if (!state || !state.videoId) { el.textContent = ''; return; }
    el.innerHTML = `${state.playing ? '▶' : '⏸'} <strong>${escapeHtml(state.title || 'YouTube-Video')}</strong>` +
      (state.by ? ` <span class="faint">· zuletzt gesteuert von ${escapeHtml(state.by)}</span>` : '');
  }

  function renderQueue() {
    const q = (state && state.queue) || [];
    $('queue-empty').classList.toggle('hidden', q.length > 0);
    $('queue').innerHTML = q.map((item, i) => `
      <li>
        <img src="https://i.ytimg.com/vi/${escapeHtml(item.videoId)}/mqdefault.jpg" alt="">
        <span class="q-title">${escapeHtml(item.title || item.videoId)}<br><span class="faint">von ${escapeHtml(item.by)}</span></span>
        <button class="btn ghost small" data-unqueue="${i}" title="Entfernen">✕</button>
      </li>`).join('');
  }
  $('queue').addEventListener('click', (e) => {
    const b = e.target.closest('[data-unqueue]');
    if (b) action({ type: 'unqueue', index: Number(b.dataset.unqueue) });
  });

  function renderMembers(list) {
    $('members').innerHTML = list.map((m) =>
      `<span class="member${m.owner ? ' owner' : ''}">${escapeHtml(m.username)}</span>`).join('');
  }

  function addChat(m) {
    const log = $('chat-log');
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const div = document.createElement('div');
    const time = new Date(m.at).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    if (m.system) {
      div.className = 'msg sys';
      div.textContent = m.text;
    } else {
      div.className = 'msg';
      div.innerHTML = `<b>${escapeHtml(m.user)}</b>: ${escapeHtml(m.text)}<time>${time}</time>`;
    }
    log.appendChild(div);
    if (atBottom) log.scrollTop = log.scrollHeight;
  }

  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('chat-input').value.trim();
    if (!text) return;
    $('chat-input').value = '';
    api(`/party/${code}/chat`, { method: 'POST', body: { text } }).catch((err) => toast(err.message, true));
  });

  // ===== Videos hinzufügen =====
  function parseYouTubeId(input) {
    const s = String(input || '').trim();
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s;
    const m = s.match(/(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/|\/live\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  function addFromInput(type) {
    const id = parseYouTubeId($('yt-input').value);
    if (!id) return toast('Das sieht nicht nach einem YouTube-Link aus', true);
    $('yt-input').value = '';
    action({ type, videoId: id });
  }
  $('yt-play').addEventListener('click', () => addFromInput('load'));
  $('yt-queue').addEventListener('click', () => addFromInput('queue'));
  $('yt-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') addFromInput('load'); });

  // Trailer über die vorhandene TMDB-Anbindung finden
  let searchResults = [];
  async function search() {
    const q = $('search-input').value.trim();
    if (!q) return;
    try {
      const data = await api('/tmdb/search/multi?query=' + encodeURIComponent(q));
      searchResults = (data.results || []).filter((r) => r.media_type === 'movie' || r.media_type === 'tv').slice(0, 8);
      $('search-results').innerHTML = searchResults.length ? searchResults.map((r, i) => `
        <div class="result">
          <img src="${r.poster_path ? 'https://image.tmdb.org/t/p/w92' + escapeHtml(r.poster_path) : ''}" alt="">
          <div>
            <div class="r-title">${escapeHtml(r.title || r.name)}</div>
            <div class="r-year">${escapeHtml((r.release_date || r.first_air_date || '').slice(0, 4))} · ${r.media_type === 'tv' ? 'Serie' : 'Film'}</div>
            <div class="row">
              <button class="btn small" data-trailer="${i}" data-type="load" title="Trailer jetzt abspielen">▶</button>
              <button class="btn ghost small" data-trailer="${i}" data-type="queue" title="In die Warteschlange">+</button>
            </div>
          </div>
        </div>`).join('') : '<p class="faint">Nichts gefunden.</p>';
    } catch (e) { toast(e.message, true); }
  }
  $('search-btn').addEventListener('click', search);
  $('search-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });

  $('search-results').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-trailer]');
    if (!b) return;
    const r = searchResults[Number(b.dataset.trailer)];
    try {
      const data = await api(`/tmdb/${r.media_type}/${r.id}/videos`);
      const vids = (data.results || []).filter((v) => v.site === 'YouTube');
      const best = vids.find((v) => v.type === 'Trailer') || vids.find((v) => v.type === 'Teaser') || vids[0];
      if (!best) return toast('Für diesen Titel gibt es keinen deutschen Trailer bei TMDB', true);
      action({ type: b.dataset.type, videoId: best.key, title: `${r.title || r.name} – ${best.name}` });
      toast(b.dataset.type === 'load' ? 'Trailer startet …' : 'In die Warteschlange gelegt');
    } catch (err) { toast(err.message, true); }
  });

  connect();
})();

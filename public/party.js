// Watch-Party: hält den Player (YouTube oder <video>) synchron mit dem Raumzustand vom Server.
//
// Der Server schickt { videoId, kind, playing, position } – die Position gilt für
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

  // ===== Player =====
  // Zwei Player teilen sich die Fläche: der YouTube-Player für kind 'yt' und ein
  // <video>-Element für direkte Links ('url') und lokale Dateien ('file').
  // Bei 'file' wählt jeder seine eigene Kopie der Datei, synchronisiert wird nur der Stand.
  const video = $('html-player');
  const localFiles = new Map(); // Dateiname -> Object-URL
  let hls = null;

  function loadScript(src, timeoutMsg) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => reject(new Error(timeoutMsg));
      document.head.appendChild(s);
      setTimeout(() => reject(new Error(timeoutMsg)), 15000);
    });
  }

  function loadYouTubeApi() {
    return new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) return resolve();
      window.onYouTubeIframeAPIReady = resolve;
      loadScript('https://www.youtube.com/iframe_api', 'YouTube antwortet nicht').catch(reject);
    });
  }

  $('start-btn').addEventListener('click', async () => {
    $('start-btn').disabled = true;
    // Direkte Videos laufen auch ohne YouTube – also trotzdem starten
    const ready = () => {
      started = true;
      $('start-overlay').classList.add('hidden');
      applyState();
    };
    try {
      await loadYouTubeApi();
    } catch (e) {
      toast(e.message + ' – blockiert ein Werbeblocker youtube.com? Direkte Videos gehen trotzdem.', true);
      ready();
      return;
    }
    player = new YT.Player('player', {
      playerVars: { playsinline: 1, rel: 0, modestbranding: 1 },
      events: {
        onReady: () => { playerReady = true; ready(); },
        onStateChange: onPlayerState,
      },
    });
  });

  function showPlayer(kind) {
    $('player-yt').classList.toggle('hidden', kind !== 'yt');
    video.classList.toggle('hidden', kind === 'yt' || !kind);
  }

  function stopHtml() {
    if (hls) { hls.destroy(); hls = null; }
    video.pause();
    video.removeAttribute('src');
    video.load();
  }

  async function setHtmlSource(src, target, playing) {
    if (hls) { hls.destroy(); hls = null; }
    const isHls = /\.m3u8(\?|#|$)/i.test(src);
    if (isHls && !video.canPlayType('application/vnd.apple.mpegurl')) {
      try {
        if (!window.Hls) await loadScript('https://cdn.jsdelivr.net/npm/hls.js@1/dist/hls.min.js', 'HLS-Player konnte nicht geladen werden');
        hls = new Hls();
        hls.loadSource(src);
        hls.attachMedia(video);
      } catch (e) { toast(e.message, true); return; }
    } else {
      video.src = src;
    }
    video.currentTime = target;
    if (playing) video.play().catch(() => {});
  }

  function applyState() {
    $('idle-overlay').classList.toggle('hidden', !started || !!(state && state.videoId));
    $('file-overlay').classList.add('hidden');
    if (!started || !state) return;
    const target = expectedPosition();

    if (!state.videoId) {
      if (loadedVideo) {
        if (playerReady) player.stopVideo();
        stopHtml();
        loadedVideo = null;
      }
      showPlayer(null);
      return;
    }

    const kind = state.kind || 'yt';
    showPlayer(kind);
    if (kind === 'yt') applyYouTube(target);
    else applyHtml(kind, target);
  }

  function applyYouTube(target) {
    if (!video.paused || video.src) stopHtml();
    if (!playerReady) {
      $('now').textContent = 'YouTube ist blockiert – dieses Video kann hier nicht laufen.';
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

  function applyHtml(kind, target) {
    if (playerReady && player.getPlayerState() === YT.PlayerState.PLAYING) player.pauseVideo();
    const key = kind + ':' + state.videoId;
    const src = kind === 'url' ? state.videoId : localFiles.get(state.videoId);

    if (!src) {
      // Diese Datei hat man selbst noch nicht ausgewählt
      if (loadedVideo !== key) stopHtml();
      loadedVideo = null;
      $('file-name').textContent = state.videoId;
      $('file-overlay').classList.remove('hidden');
      return;
    }

    suppressUntil = Date.now() + 1500;
    if (loadedVideo !== key) {
      loadedVideo = key;
      setHtmlSource(src, target, state.playing);
      return;
    }
    if (video.readyState < 1) return;
    if (Math.abs(video.currentTime - target) > 1.5) video.currentTime = target;
    if (state.playing && video.paused) video.play().catch(() => {});
    if (!state.playing && !video.paused) video.pause();
  }

  // Eigene Klicks im YouTube-Player an den Server melden
  function onPlayerState(e) {
    if (!state || !state.videoId || (state.kind || 'yt') !== 'yt') return;
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

  // Eigene Klicks im <video> an den Server melden
  const htmlActive = () => state && state.videoId && state.kind && state.kind !== 'yt' && loadedVideo;
  video.addEventListener('play', () => {
    if (htmlActive() && Date.now() >= suppressUntil && !state.playing) action({ type: 'play', position: video.currentTime });
  });
  video.addEventListener('pause', () => {
    if (htmlActive() && Date.now() >= suppressUntil && state.playing && !video.ended) action({ type: 'pause', position: video.currentTime });
  });
  video.addEventListener('seeked', () => {
    if (htmlActive() && Date.now() >= suppressUntil && Math.abs(video.currentTime - expectedPosition()) > 2) {
      action({ type: 'seek', position: video.currentTime });
    }
  });
  video.addEventListener('ended', () => {
    if (htmlActive()) action({ type: 'ended', videoId: state.videoId });
  });
  // Manche Browser ignorieren currentTime vor dem Laden – hier sicher nachziehen
  video.addEventListener('loadedmetadata', () => {
    if (!htmlActive()) return;
    suppressUntil = Date.now() + 1500;
    video.currentTime = expectedPosition();
    if (state.playing) video.play().catch(() => {});
  });
  video.addEventListener('error', () => {
    if (!htmlActive()) return;
    toast('Video lässt sich nicht abspielen – ist es ein direkter Link auf eine Videodatei (mp4, webm, m3u8)? Manche Seiten sperren das Einbetten.', true);
  });

  // Regelmäßig nachziehen, falls ein Browser hinterherhinkt
  setInterval(() => {
    if (!started || !state || !state.videoId || !state.playing || Date.now() < suppressUntil) return;
    let current;
    if ((state.kind || 'yt') === 'yt') {
      if (!playerReady || player.getPlayerState() !== YT.PlayerState.PLAYING) return;
      current = player.getCurrentTime();
    } else {
      if (!htmlActive() || video.paused) return;
      current = video.currentTime;
    }
    if (Math.abs(current - expectedPosition()) > 1.5) {
      suppressUntil = Date.now() + 1500;
      if (state.kind === 'yt' || !state.kind) player.seekTo(expectedPosition(), true);
      else video.currentTime = expectedPosition();
    }
  }, 2000);

  // ===== Anzeige =====
  function renderNow() {
    const el = $('now');
    if (!state || !state.videoId) { el.textContent = ''; return; }
    el.innerHTML = `${state.playing ? '▶' : '⏸'} <strong>${escapeHtml(state.title || (state.kind === 'yt' ? 'YouTube-Video' : 'Video'))}</strong>` +
      (state.by ? ` <span class="faint">· zuletzt gesteuert von ${escapeHtml(state.by)}</span>` : '');
  }

  function renderQueue() {
    const q = (state && state.queue) || [];
    $('queue-empty').classList.toggle('hidden', q.length > 0);
    $('queue').innerHTML = q.map((item, i) => `
      <li>
        ${(item.kind || 'yt') === 'yt'
          ? `<img src="https://i.ytimg.com/vi/${escapeHtml(item.videoId)}/mqdefault.jpg" alt="">`
          : `<span class="q-icon">${item.kind === 'file' ? '📁' : '🔗'}</span>`}
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

  // YouTube-Link -> YouTube-Player, jeder andere http(s)-Link -> <video>
  function parseSource(input) {
    const s = String(input || '').trim();
    const yt = parseYouTubeId(s);
    if (yt && (s.length === 11 || /youtu\.?be/i.test(s))) return { kind: 'yt', videoId: yt };
    try {
      const u = new URL(s);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      const name = decodeURIComponent(u.pathname.split('/').pop() || u.hostname);
      return { kind: 'url', videoId: u.href, title: name };
    } catch { return null; }
  }

  function addFromInput(type) {
    const src = parseSource($('yt-input').value);
    if (!src) return toast('Bitte einen YouTube-Link oder einen direkten Video-Link (http…) einfügen', true);
    $('yt-input').value = '';
    action({ type, ...src });
  }
  $('yt-play').addEventListener('click', () => addFromInput('load'));
  $('yt-queue').addEventListener('click', () => addFromInput('queue'));
  $('yt-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') addFromInput('load'); });

  // Lokale Datei: läuft nur bei denen, die dieselbe Datei auch auswählen
  function useFile(file, type) {
    if (!file) return;
    if (!file.type.startsWith('video/') && !file.type.startsWith('audio/') && !/\.(mkv|mp4|webm|mov|m4v|ogv|mp3|m4a)$/i.test(file.name)) {
      return toast('Das ist keine Video-Datei', true);
    }
    if (localFiles.has(file.name)) URL.revokeObjectURL(localFiles.get(file.name));
    localFiles.set(file.name, URL.createObjectURL(file));
    if (type && !(state && state.videoId === file.name && state.kind === 'file')) {
      action({ type, kind: 'file', videoId: file.name, title: file.name });
    } else {
      applyState();
    }
  }
  $('file-input').addEventListener('change', (e) => { useFile(e.target.files[0], 'load'); e.target.value = ''; });
  $('file-pick').addEventListener('change', (e) => { useFile(e.target.files[0], null); e.target.value = ''; });

  // Datei oder Link auf den Player ziehen
  const wrap = document.querySelector('.player-wrap');
  wrap.addEventListener('dragover', (e) => { e.preventDefault(); wrap.classList.add('dragging'); });
  wrap.addEventListener('dragleave', () => wrap.classList.remove('dragging'));
  wrap.addEventListener('drop', (e) => {
    e.preventDefault();
    wrap.classList.remove('dragging');
    const file = e.dataTransfer.files[0];
    if (file) {
      // Fehlt gerade genau diese Datei, nur lokal einsetzen statt neu zu starten
      const waiting = state && state.kind === 'file' && state.videoId === file.name;
      return useFile(file, waiting ? null : 'load');
    }
    const text = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    const src = parseSource(text.split('\n')[0]);
    if (src) action({ type: 'load', ...src });
    else toast('Damit kann der Player nichts anfangen', true);
  });

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

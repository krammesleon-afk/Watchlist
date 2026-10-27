// Datei-Drop: WebRTC-Datenkanal zwischen zwei Browsern.
// Der Server (/api/drop/...) vermittelt nur Offer/Answer, die Daten selbst
// fließen direkt von Gerät zu Gerät.
(function () {
  const token = Auth.requireAuth();
  if (!token) return;

  const { toast, escapeHtml, formatBytes, copyText } = Satho;
  const $ = (id) => document.getElementById(id);

  const ICE_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
  ];
  const CHUNK = 64 * 1024;
  const MAX_BUFFER = 4 * 1024 * 1024;

  let myId = null;
  let events = null;
  let peers = [];
  let deviceName = loadDeviceName();
  const transfers = new Map(); // id -> { pc, dc, el, ... }

  // ===== Gerätename =====
  function guessDeviceName() {
    const ua = navigator.userAgent;
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android-Handy' : 'Android-Tablet';
    const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : '';
    return os ? `${browser} auf ${os}` : browser;
  }
  function loadDeviceName() {
    try { return localStorage.getItem('drop_device_name') || guessDeviceName(); } catch (e) { return guessDeviceName(); }
  }
  function renderMe() { $('me-name').textContent = deviceName; }

  $('rename-btn').addEventListener('click', () => {
    const name = (window.prompt('Wie soll dieses Gerät heißen?', deviceName) || '').trim().slice(0, 40);
    if (!name || name === deviceName) return;
    deviceName = name;
    try { localStorage.setItem('drop_device_name', name); } catch (e) {}
    renderMe();
    reconnect();
  });

  // ===== Verbindung zum Server =====
  async function connect() {
    $('me-state').textContent = 'Verbinde …';
    $('me-dot').classList.remove('on');
    try {
      const { ticket } = await Auth.api('/drop/ticket', token, { method: 'POST' });
      events = new EventSource(`/api/drop/events?ticket=${encodeURIComponent(ticket)}&name=${encodeURIComponent(deviceName)}`);
    } catch (e) {
      $('me-state').textContent = 'Keine Verbindung – neuer Versuch …';
      setTimeout(connect, 5000);
      return;
    }
    events.addEventListener('hello', (e) => {
      myId = JSON.parse(e.data).id;
      $('me-state').textContent = 'Online';
      $('me-dot').classList.add('on');
    });
    events.addEventListener('peers', (e) => { peers = JSON.parse(e.data); renderPeers(); });
    events.addEventListener('signal', (e) => onSignal(JSON.parse(e.data)));
    // Das Ticket gilt nur einmal, darum selbst neu verbinden statt dem
    // automatischen Wiederverbinden von EventSource zu vertrauen.
    events.onerror = () => {
      events.close();
      myId = null;
      $('me-state').textContent = 'Verbindung verloren – neuer Versuch …';
      $('me-dot').classList.remove('on');
      setTimeout(connect, 3000);
    };
  }
  function reconnect() {
    if (events) events.close();
    connect();
  }

  async function signal(to, data) {
    if (!myId) throw new Error('Nicht verbunden');
    return Auth.api('/drop/signal', token, { method: 'POST', body: { from: myId, to, data } });
  }

  // ===== Geräteliste =====
  let pendingTarget = null;

  function renderPeers() {
    const box = $('peers');
    $('peers-empty').classList.toggle('hidden', peers.length > 0);
    box.innerHTML = peers.map((p) => `
      <div class="peer" data-id="${escapeHtml(p.id)}">
        <div class="peer-ico">${p.own ? deviceIcon(p.name) : '👤'}</div>
        <div class="peer-name">${escapeHtml(p.name)}</div>
        <div class="peer-sub">${p.own ? 'Dein Gerät' : escapeHtml(p.username)}</div>
        <div class="row">
          <button class="btn small" data-act="file">Datei</button>
          <button class="btn ghost small" data-act="text">Text</button>
        </div>
      </div>`).join('');
  }

  function deviceIcon(name) {
    return /iphone|android|handy|phone/i.test(name) ? '📱' : /ipad|tablet/i.test(name) ? '📲' : '💻';
  }

  function peerById(id) { return peers.find((p) => p.id === id); }

  $('peers').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const peer = peerById(btn.closest('.peer').dataset.id);
    if (!peer) return;
    pendingTarget = peer;
    if (btn.dataset.act === 'file') {
      $('file-input').value = '';
      $('file-input').click();
    } else {
      $('text-title').textContent = `Text an ${peer.name} senden`;
      $('text-input').value = '';
      $('text-dialog').showModal();
      $('text-input').focus();
    }
  });

  $('file-input').addEventListener('change', () => {
    const files = [...$('file-input').files];
    if (files.length && pendingTarget) startSend(pendingTarget, { files });
  });

  $('text-cancel').addEventListener('click', () => $('text-dialog').close());
  $('text-send').addEventListener('click', () => {
    const text = $('text-input').value;
    $('text-dialog').close();
    if (text.trim() && pendingTarget) startSend(pendingTarget, { text });
  });

  // Dateien direkt auf ein Gerät ziehen
  $('peers').addEventListener('dragover', (e) => {
    const card = e.target.closest('.peer');
    if (!card) return;
    e.preventDefault();
    card.classList.add('dragover');
  });
  $('peers').addEventListener('dragleave', (e) => {
    const card = e.target.closest('.peer');
    if (card && !card.contains(e.relatedTarget)) card.classList.remove('dragover');
  });
  $('peers').addEventListener('drop', (e) => {
    const card = e.target.closest('.peer');
    if (!card) return;
    e.preventDefault();
    card.classList.remove('dragover');
    const peer = peerById(card.dataset.id);
    const files = [...(e.dataTransfer.files || [])];
    if (peer && files.length) startSend(peer, { files });
  });

  // ===== Übertragungs-Anzeige =====
  function addTransferEl(id, dir, peerName, title) {
    $('transfers-empty').classList.add('hidden');
    const el = document.createElement('div');
    el.className = 'transfer';
    el.innerHTML = `
      <div class="transfer-dir">${dir === 'out' ? '⬆️' : '⬇️'}</div>
      <div>
        <div class="transfer-title"></div>
        <div class="transfer-status"></div>
        <div class="bar"><span></span></div>
        <div class="received"></div>
      </div>
      <button class="btn ghost small" data-cancel>Abbrechen</button>`;
    el.querySelector('.transfer-title').textContent = `${dir === 'out' ? 'An' : 'Von'} ${peerName}: ${title}`;
    el.querySelector('[data-cancel]').addEventListener('click', () => finish(id, 'Abgebrochen', 'err'));
    $('transfers').prepend(el);
    return el;
  }

  function setStatus(t, text, cls) {
    const s = t.el.querySelector('.transfer-status');
    s.textContent = text;
    s.className = 'transfer-status' + (cls ? ' ' + cls : '');
  }
  function setProgress(t, done, total) {
    t.el.querySelector('.bar > span').style.width = total ? Math.min(100, (done / total) * 100) + '%' : '100%';
  }

  function finish(id, text, cls) {
    const t = transfers.get(id);
    if (!t) return;
    transfers.delete(id);
    setStatus(t, text, cls);
    if (cls === 'ok') setProgress(t, 1, 1);
    else t.el.querySelector('.bar').classList.add('hidden');
    t.el.querySelector('[data-cancel]').remove();
    clearTimeout(t.timeout);
    try { t.dc && t.dc.close(); } catch (e) {}
    try { t.pc && t.pc.close(); } catch (e) {}
  }

  function summary(meta) {
    if (meta.text != null) return 'Text';
    if (meta.files.length === 1) return `${meta.files[0].name} (${formatBytes(meta.files[0].size)})`;
    const total = meta.files.reduce((s, f) => s + f.size, 0);
    return `${meta.files.length} Dateien (${formatBytes(total)})`;
  }

  // ===== WebRTC-Helfer =====
  function newPeerConnection(t, id) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    pc.addEventListener('connectionstatechange', () => {
      if (pc.connectionState === 'failed' && transfers.has(id)) {
        finish(id, 'Keine direkte Verbindung möglich (Netzwerk blockiert, z. B. Mobilfunk oder Firmen-WLAN). Versuch es im selben WLAN.', 'err');
      }
    });
    return pc;
  }

  // Wartet, bis alle Verbindungswege gesammelt sind, damit Offer/Answer in
  // einer einzigen Nachricht verschickt werden können.
  function iceGathered(pc) {
    if (pc.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => { pc.removeEventListener('icegatheringstatechange', check); resolve(); };
      const check = () => { if (pc.iceGatheringState === 'complete') done(); };
      pc.addEventListener('icegatheringstatechange', check);
      setTimeout(done, 3000);
    });
  }

  function newId() {
    return Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(16).padStart(2, '0')).join('');
  }

  // ===== Senden =====
  async function startSend(peer, payload) {
    const id = newId();
    const meta = payload.text != null
      ? { text: true }
      : { files: payload.files.map((f) => ({ name: f.name, size: f.size, type: f.type })) };
    const label = payload.text != null ? 'Text' : summary(meta);
    const t = { id, dir: 'out', peer, payload, meta };
    t.el = addTransferEl(id, 'out', peer.name, label);
    transfers.set(id, t);
    setStatus(t, 'Warte auf Bestätigung …');

    try {
      t.pc = newPeerConnection(t, id);
      t.dc = t.pc.createDataChannel('drop', { ordered: true });
      t.dc.binaryType = 'arraybuffer';
      t.dc.bufferedAmountLowThreshold = 1024 * 1024;
      t.dc.addEventListener('open', () => sendPayload(t));
      t.dc.addEventListener('message', (e) => {
        if (typeof e.data === 'string' && JSON.parse(e.data).t === 'ack') finish(id, 'Gesendet ✓', 'ok');
      });
      t.dc.addEventListener('close', () => { if (transfers.has(id) && t.sending) finish(id, 'Verbindung abgebrochen', 'err'); });

      await t.pc.setLocalDescription(await t.pc.createOffer());
      await iceGathered(t.pc);
      await signal(peer.id, { kind: 'offer', id, sdp: t.pc.localDescription, meta: meta.text ? { text: true } : meta });
      // Wer nicht reagiert, hat wohl die Seite zu
      t.timeout = setTimeout(() => finish(id, 'Keine Antwort', 'err'), 2 * 60 * 1000);
    } catch (e) {
      finish(id, 'Fehler: ' + e.message, 'err');
    }
  }

  async function sendPayload(t) {
    t.sending = true;
    clearTimeout(t.timeout);
    const dc = t.dc;
    const send = (obj) => dc.send(JSON.stringify(obj));

    try {
      if (t.payload.text != null) {
        setStatus(t, 'Sende …');
        send({ t: 'text', text: t.payload.text });
      } else {
        const total = t.payload.files.reduce((s, f) => s + f.size, 0);
        let sent = 0;
        for (let i = 0; i < t.payload.files.length; i++) {
          const file = t.payload.files[i];
          send({ t: 'file', i, name: file.name, size: file.size, type: file.type });
          for (let off = 0; off < file.size; off += CHUNK) {
            if (!transfers.has(t.id)) return; // abgebrochen
            if (dc.bufferedAmount > MAX_BUFFER) {
              await new Promise((r) => dc.addEventListener('bufferedamountlow', r, { once: true }));
            }
            const buf = await file.slice(off, off + CHUNK).arrayBuffer();
            dc.send(buf);
            sent += buf.byteLength;
            setProgress(t, sent, total);
            setStatus(t, `Sende ${formatBytes(sent)} von ${formatBytes(total)}`);
          }
          send({ t: 'eof', i });
        }
      }
      send({ t: 'done' });
      setStatus(t, 'Warte auf Empfangsbestätigung …');
    } catch (e) {
      finish(t.id, 'Fehler beim Senden: ' + e.message, 'err');
    }
  }

  // ===== Empfangen =====
  const incomingQueue = [];
  let incomingOpen = false;

  function onSignal({ from, data }) {
    if (!data || !data.id) return;
    const t = transfers.get(data.id);
    if (data.kind === 'offer') {
      // Von eigenen Geräten automatisch annehmen, bei Freunden nachfragen
      if (from.own) acceptOffer(from, data);
      else { incomingQueue.push({ from, data }); showNextIncoming(); }
    } else if (data.kind === 'answer' && t && t.dir === 'out') {
      setStatus(t, 'Verbinde …');
      t.pc.setRemoteDescription(data.sdp).catch((e) => finish(t.id, 'Fehler: ' + e.message, 'err'));
    } else if (data.kind === 'decline' && t) {
      finish(t.id, 'Abgelehnt', 'err');
    }
  }

  function showNextIncoming() {
    if (incomingOpen || !incomingQueue.length) return;
    const { from, data } = incomingQueue.shift();
    incomingOpen = true;
    const meta = data.meta || {};
    $('incoming-title').textContent = `${from.username} (${from.name}) möchte dir etwas schicken`;
    $('incoming-body').innerHTML = meta.text
      ? '<p class="muted">Einen Text</p>'
      : `<p class="muted">${escapeHtml(summary(meta))}</p><ul>${(meta.files || []).slice(0, 8).map((f) => `<li>${escapeHtml(f.name)}</li>`).join('')}</ul>`;
    const dlg = $('incoming');
    const close = (accept) => {
      dlg.close();
      incomingOpen = false;
      $('incoming-yes').onclick = $('incoming-no').onclick = null;
      if (accept) acceptOffer(from, data);
      else signal(from.id, { kind: 'decline', id: data.id }).catch(() => {});
      showNextIncoming();
    };
    $('incoming-yes').onclick = () => close(true);
    $('incoming-no').onclick = () => close(false);
    dlg.oncancel = (e) => { e.preventDefault(); close(false); };
    dlg.showModal();
  }

  async function acceptOffer(from, data) {
    const meta = data.meta || {};
    const id = data.id;
    const t = { id, dir: 'in', peer: from, meta, received: 0, total: meta.text ? 0 : (meta.files || []).reduce((s, f) => s + f.size, 0) };
    t.el = addTransferEl(id, 'in', from.name, meta.text ? 'Text' : summary(meta));
    transfers.set(id, t);
    setStatus(t, 'Verbinde …');

    try {
      t.pc = newPeerConnection(t, id);
      t.pc.addEventListener('datachannel', (e) => {
        t.dc = e.channel;
        t.dc.binaryType = 'arraybuffer';
        setupReceiver(t);
      });
      await t.pc.setRemoteDescription(data.sdp);
      await t.pc.setLocalDescription(await t.pc.createAnswer());
      await iceGathered(t.pc);
      await signal(from.id, { kind: 'answer', id, sdp: t.pc.localDescription });
    } catch (e) {
      finish(id, 'Fehler: ' + e.message, 'err');
    }
  }

  function setupReceiver(t) {
    let current = null; // { name, size, type, chunks: [] }
    const out = t.el.querySelector('.received');

    t.dc.addEventListener('message', (e) => {
      if (typeof e.data !== 'string') {
        if (!current) return;
        current.chunks.push(e.data);
        t.received += e.data.byteLength;
        setProgress(t, t.received, t.total);
        setStatus(t, `Empfange ${formatBytes(t.received)} von ${formatBytes(t.total)}`);
        return;
      }
      const msg = JSON.parse(e.data);
      if (msg.t === 'text') {
        const pre = document.createElement('pre');
        pre.textContent = msg.text;
        const copy = document.createElement('button');
        copy.className = 'btn ghost small';
        copy.textContent = 'Kopieren';
        copy.style.alignSelf = 'flex-start';
        copy.onclick = () => copyText(msg.text);
        out.append(pre, copy);
      } else if (msg.t === 'file') {
        current = { name: String(msg.name || 'datei'), type: String(msg.type || ''), chunks: [] };
      } else if (msg.t === 'eof' && current) {
        showFile(out, current);
        current = null;
      } else if (msg.t === 'done') {
        t.dc.send(JSON.stringify({ t: 'ack' }));
        // Kurz warten, damit die Bestätigung noch rausgeht
        setTimeout(() => finish(t.id, 'Empfangen ✓', 'ok'), 300);
      }
    });
    t.dc.addEventListener('close', () => { if (transfers.has(t.id)) finish(t.id, 'Verbindung abgebrochen', 'err'); });
  }

  function showFile(out, file) {
    const blob = new Blob(file.chunks, { type: file.type || 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    if (/^image\//.test(file.type)) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = file.name;
      out.append(img);
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.textContent = `💾 ${file.name} speichern (${formatBytes(blob.size)})`;
    out.append(a);
  }

  window.addEventListener('beforeunload', (e) => {
    if ([...transfers.values()].some((t) => t.sending || t.received)) {
      e.preventDefault();
      e.returnValue = '';
    }
  });

  renderMe();
  renderPeers();
  connect();
})();

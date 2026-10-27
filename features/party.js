// Watch-Party: YouTube-Videos (z. B. Trailer) gemeinsam und synchron schauen.
//
// Der Server hält pro Raum den "wahren" Abspielstand: welches Video, läuft es,
// an welcher Stelle stand es zu welchem Zeitpunkt. Daraus kann jeder Browser
// die aktuelle Position selbst ausrechnen und nachziehen, wenn er abweicht.
// Räume leben nur im Arbeitsspeicher und verschwinden, wenn sie leer bleiben.
const crypto = require('crypto');
const live = require('./live');

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne 0/O, 1/I
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_ROOMS_PER_USER = 5;
const EMPTY_ROOM_TTL = 30 * 60 * 1000;

module.exports = function mountParty({ app, authenticateToken }) {
  const rooms = new Map();

  function newCode() {
    let code;
    do {
      code = Array.from(crypto.randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
    } while (rooms.has(code));
    return code;
  }

  // Aktuelle Position (Sekunden) unter Berücksichtigung der verstrichenen Zeit
  function currentPosition(s) {
    return s.playing ? s.position + (Date.now() - s.updatedAt) / 1000 : s.position;
  }

  function stateFor(room) {
    const s = room.state;
    return {
      videoId: s.videoId,
      title: s.title,
      playing: s.playing,
      position: currentPosition(s),
      serverTime: Date.now(),
      by: s.by,
      queue: room.queue,
    };
  }

  function members(room) {
    const seen = new Map();
    for (const m of room.members.values()) seen.set(m.user.id, m.user.username);
    return [...seen.entries()].map(([id, username]) => ({ id, username, owner: id === room.ownerId }));
  }

  function broadcast(room, event, data) {
    for (const m of room.members.values()) m.stream.send(event, data);
  }

  function isInRoom(room, userId) {
    for (const m of room.members.values()) if (m.user.id === userId) return true;
    return false;
  }

  function loadVideo(room, video, by) {
    room.state = { videoId: video.videoId, title: video.title || '', playing: true, position: 0, updatedAt: Date.now(), by };
  }

  function cleanTitle(t) {
    return String(t || '').replace(/[\u0000-\u001f]/g, '').slice(0, 120);
  }

  app.post('/api/party', authenticateToken, (req, res) => {
    let own = 0;
    for (const r of rooms.values()) if (r.ownerId === req.user.id) own++;
    if (own >= MAX_ROOMS_PER_USER) return res.status(429).json({ msg: 'Du hast schon zu viele offene Räume' });

    const code = newCode();
    rooms.set(code, {
      code,
      ownerId: req.user.id,
      state: { videoId: null, title: '', playing: false, position: 0, updatedAt: Date.now(), by: null },
      queue: [],
      chat: [],
      members: new Map(),
      emptySince: Date.now(),
    });
    res.json({ code });
  });

  app.post('/api/party/:code/ticket', authenticateToken, (req, res) => {
    const room = rooms.get(String(req.params.code).toUpperCase());
    if (!room) return res.status(404).json({ msg: 'Raum nicht gefunden – vielleicht ist er abgelaufen' });
    res.json({ ticket: live.issueTicket(req.user, 'party:' + room.code), code: room.code });
  });

  app.get('/api/party/:code/events', (req, res) => {
    const room = rooms.get(String(req.params.code).toUpperCase());
    if (!room) return res.status(404).end();
    const user = live.redeemTicket(String(req.query.ticket || ''), 'party:' + room.code);
    if (!user) return res.status(401).end();

    const connId = crypto.randomBytes(9).toString('base64url');
    const wasInRoom = isInRoom(room, user.id);
    const member = { user };
    member.stream = live.openStream(req, res, () => {
      room.members.delete(connId);
      if (room.members.size === 0) room.emptySince = Date.now();
      if (!isInRoom(room, user.id)) systemMessage(room, `${user.username} hat den Raum verlassen`);
      broadcast(room, 'members', members(room));
    });
    room.members.set(connId, member);
    room.emptySince = null;

    member.stream.send('state', stateFor(room));
    member.stream.send('chat-history', room.chat);
    if (!wasInRoom) systemMessage(room, `${user.username} ist dabei`);
    broadcast(room, 'members', members(room));
  });

  function systemMessage(room, text) {
    const msg = { system: true, text, at: Date.now() };
    room.chat.push(msg);
    if (room.chat.length > 100) room.chat.shift();
    broadcast(room, 'chat', msg);
  }

  // Nur wer gerade im Raum ist, darf steuern oder schreiben
  function withRoom(req, res, fn) {
    const room = rooms.get(String(req.params.code).toUpperCase());
    if (!room) return res.status(404).json({ msg: 'Raum nicht gefunden' });
    if (!isInRoom(room, req.user.id)) return res.status(409).json({ msg: 'Du bist nicht im Raum' });
    fn(room);
  }

  app.post('/api/party/:code/action', authenticateToken, (req, res) => {
    withRoom(req, res, (room) => {
      const { type, videoId, position, title } = req.body || {};
      const s = room.state;
      const by = req.user.username;
      const pos = Math.max(0, Number(position) || 0);

      switch (type) {
        case 'load':
          if (!YT_ID.test(videoId)) return res.status(400).json({ msg: 'Ungültiges Video' });
          loadVideo(room, { videoId, title: cleanTitle(title) }, by);
          systemMessage(room, `${by} startet ein neues Video`);
          break;
        case 'queue':
          if (!YT_ID.test(videoId)) return res.status(400).json({ msg: 'Ungültiges Video' });
          if (room.queue.length >= 50) return res.status(400).json({ msg: 'Warteschlange ist voll' });
          if (!s.videoId) loadVideo(room, { videoId, title: cleanTitle(title) }, by);
          else room.queue.push({ videoId, title: cleanTitle(title), by });
          break;
        case 'unqueue':
          room.queue.splice(Number(req.body.index), 1);
          break;
        case 'play':
        case 'pause':
        case 'seek':
          if (!s.videoId) return res.status(400).json({ msg: 'Kein Video geladen' });
          s.position = pos;
          s.playing = type === 'seek' ? s.playing : type === 'play';
          s.updatedAt = Date.now();
          s.by = by;
          break;
        case 'ended':
          // Mehrere Browser melden das Ende gleichzeitig – nur der erste zählt
          if (videoId !== s.videoId) return res.json({ ok: true });
          if (room.queue.length) loadVideo(room, room.queue.shift(), by);
          else Object.assign(s, { playing: false, position: 0, updatedAt: Date.now() });
          break;
        case 'title':
          // Titel nachreichen, sobald der Player ihn kennt
          if (videoId === s.videoId && !s.title) s.title = cleanTitle(title);
          return res.json({ ok: true });
        default:
          return res.status(400).json({ msg: 'Unbekannte Aktion' });
      }
      broadcast(room, 'state', stateFor(room));
      res.json({ ok: true });
    });
  });

  app.post('/api/party/:code/chat', authenticateToken, (req, res) => {
    withRoom(req, res, (room) => {
      const text = String((req.body || {}).text || '').trim().slice(0, 500);
      if (!text) return res.status(400).json({ msg: 'Leere Nachricht' });
      const msg = { user: req.user.username, text, at: Date.now() };
      room.chat.push(msg);
      if (room.chat.length > 100) room.chat.shift();
      broadcast(room, 'chat', msg);
      res.json({ ok: true });
    });
  });

  setInterval(() => {
    const now = Date.now();
    for (const [code, room] of rooms) {
      if (room.emptySince && now - room.emptySince > EMPTY_ROOM_TTL) rooms.delete(code);
    }
  }, 5 * 60 * 1000).unref();
};

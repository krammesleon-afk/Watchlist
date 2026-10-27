// Datei-Drop: Dateien und Text direkt von Gerät zu Gerät schicken (WebRTC).
//
// Der Server sieht keine Dateien. Er führt nur Buch, welche Geräte gerade
// online sind, und reicht die WebRTC-Verbindungsdaten (Offer/Answer) zwischen
// zwei Geräten weiter. Sichtbar sind die eigenen Geräte und die von Freunden.
const crypto = require('crypto');
const live = require('./live');

module.exports = function mountDrop({ app, db, authenticateToken }) {
  const peers = new Map(); // peerId -> { id, user, name, friendIds:Set, stream }

  function friendIdsOf(userId, cb) {
    db.all(
      `SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS fid
       FROM friendships WHERE status = 'accepted' AND (requester_id = ? OR addressee_id = ?)`,
      [userId, userId, userId],
      (err, rows) => cb(err, new Set((rows || []).map((r) => r.fid)))
    );
  }

  function canSee(a, b) {
    return a.user.id === b.user.id || a.friendIds.has(b.user.id);
  }

  function publicPeer(p, viewer) {
    return { id: p.id, name: p.name, username: p.user.username, own: p.user.id === viewer.user.id };
  }

  // Jedem Gerät die aktuelle Liste der für es sichtbaren Geräte schicken
  function broadcastPeers() {
    for (const viewer of peers.values()) {
      const list = [];
      for (const p of peers.values()) {
        if (p.id !== viewer.id && canSee(viewer, p)) list.push(publicPeer(p, viewer));
      }
      viewer.stream.send('peers', list);
    }
  }

  app.post('/api/drop/ticket', authenticateToken, (req, res) => {
    res.json({ ticket: live.issueTicket(req.user, 'drop') });
  });

  app.get('/api/drop/events', (req, res) => {
    const user = live.redeemTicket(String(req.query.ticket || ''), 'drop');
    if (!user) return res.status(401).json({ msg: 'Ticket ungültig' });
    const name = String(req.query.name || 'Gerät').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) || 'Gerät';

    friendIdsOf(user.id, (err, friendIds) => {
      if (err) return res.status(500).json({ msg: 'Serverfehler' });
      const id = crypto.randomBytes(9).toString('base64url');
      const peer = { id, user, name, friendIds };
      peer.stream = live.openStream(req, res, () => {
        peers.delete(id);
        broadcastPeers();
      });
      peers.set(id, peer);
      peer.stream.send('hello', { id, name });
      broadcastPeers();
    });
  });

  // WebRTC-Signal (Offer, Answer, Absage …) an ein anderes Gerät weiterreichen
  app.post('/api/drop/signal', authenticateToken, (req, res) => {
    const { from, to, data } = req.body || {};
    const sender = peers.get(from);
    const target = peers.get(to);
    if (!sender || sender.user.id !== req.user.id) return res.status(409).json({ msg: 'Unbekanntes Gerät' });
    if (!target || !canSee(sender, target)) return res.status(404).json({ msg: 'Gerät nicht mehr online' });
    target.stream.send('signal', { from: publicPeer(sender, target), data });
    res.json({ ok: true });
  });
};

// Push-Benachrichtigungen aufs Handy/den PC über den Web-Push-Standard.
//
// Es braucht kein Entwicklerkonto bei Google oder Apple: Der Server weist sich
// mit einem selbst erzeugten VAPID-Schlüsselpaar aus. Fehlt es in der .env,
// wird es beim ersten Start erzeugt und in der Datenbank abgelegt, damit
// bestehende Abos nach einem Neustart gültig bleiben.
const crypto = require('crypto');
const webpush = require('web-push');

module.exports = function mountPush({ app, db, authenticateToken }) {
  // Entwickler wie im Server-Cockpit: Benutzernamen aus DEVELOPER_USERS
  const developers = (process.env.DEVELOPER_USERS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const isDeveloper = (user) => !!user && developers.includes(String(user.username || '').toLowerCase());

  let ready = false;
  let vapidPublicKey = null;

  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS push_subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      endpoint TEXT UNIQUE NOT NULL,
      keys TEXT NOT NULL,
      label TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    // Pro Nutzer: geheimer Webhook-Token und welche Ereignisse gemeldet werden
    db.run(`CREATE TABLE IF NOT EXISTS push_settings (
      user_id INTEGER PRIMARY KEY,
      hook_token TEXT UNIQUE,
      notify_login INTEGER DEFAULT 1,
      notify_friends INTEGER DEFAULT 1,
      notify_server INTEGER DEFAULT 1,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    // Spalte nachrüsten, falls die Tabelle schon ohne sie existiert
    db.run('ALTER TABLE push_settings ADD COLUMN notify_server INTEGER DEFAULT 1', () => {});
    db.run('CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT)');
    initVapid();
  });

  function initVapid() {
    const subject = process.env.VAPID_SUBJECT || 'mailto:admin@localhost';
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
      webpush.setVapidDetails(subject, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
      vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
      ready = true;
      return;
    }
    db.get("SELECT value FROM app_config WHERE key = 'vapid'", (err, row) => {
      if (err) return console.error('❌ VAPID-Schlüssel konnten nicht geladen werden:', err);
      let keys = row && JSON.parse(row.value);
      if (!keys) {
        keys = webpush.generateVAPIDKeys();
        db.run("INSERT INTO app_config (key, value) VALUES ('vapid', ?)", [JSON.stringify(keys)]);
        console.log('🔔 Neues VAPID-Schlüsselpaar für Push erzeugt und gespeichert');
      }
      webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
      vapidPublicKey = keys.publicKey;
      ready = true;
    });
  }

  // Schickt eine Nachricht an alle Geräte eines Nutzers. Abgelaufene Abos
  // (Browser deinstalliert, Berechtigung entzogen) werden dabei aufgeräumt.
  function notifyUser(userId, payload) {
    if (!ready) return Promise.resolve(0);
    return new Promise((resolve) => {
      db.all('SELECT id, endpoint, keys FROM push_subscriptions WHERE user_id = ?', [userId], async (err, rows) => {
        if (err || !rows || !rows.length) return resolve(0);
        const body = JSON.stringify({ url: '/', ...payload });
        let sent = 0;
        await Promise.all(rows.map(async (row) => {
          try {
            await webpush.sendNotification({ endpoint: row.endpoint, keys: JSON.parse(row.keys) }, body, { TTL: 24 * 3600 });
            sent++;
          } catch (e) {
            if (e.statusCode === 404 || e.statusCode === 410) {
              db.run('DELETE FROM push_subscriptions WHERE id = ?', [row.id]);
            } else {
              console.error('❌ Push fehlgeschlagen:', e.statusCode || e.message);
            }
          }
        }));
        resolve(sent);
      });
    });
  }

  function getSettings(userId, cb) {
    db.get('SELECT * FROM push_settings WHERE user_id = ?', [userId], (err, row) => {
      if (err) return cb(err);
      if (row) return cb(null, row);
      const fresh = { user_id: userId, hook_token: crypto.randomBytes(24).toString('base64url'), notify_login: 1, notify_friends: 1 };
      db.run(
        'INSERT OR IGNORE INTO push_settings (user_id, hook_token, notify_login, notify_friends) VALUES (?, ?, 1, 1)',
        [userId, fresh.hook_token],
        (err) => (err ? cb(err) : getSettings(userId, cb))
      );
    });
  }

  // Ereignis-Benachrichtigung, sofern der Nutzer sie nicht abgeschaltet hat
  function notifyEvent(userId, setting, payload) {
    db.get(`SELECT ${setting} AS on_ FROM push_settings WHERE user_id = ?`, [userId], (err, row) => {
      if (err) return;
      if (row && !row.on_) return;
      notifyUser(userId, payload);
    });
  }

  function describeClient(req) {
    const ua = String(req.headers['user-agent'] || '');
    const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
      : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows'
      : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : 'unbekanntem System';
    return `${browser} auf ${os}`;
  }

  // Server-Warnungen an alle Entwickler, die sie nicht abgeschaltet haben
  function notifyDevelopers(payload) {
    if (!developers.length) return;
    db.all(
      `SELECT id FROM users WHERE LOWER(username) IN (${developers.map(() => '?').join(',')})`,
      developers,
      (err, rows) => (rows || []).forEach((r) => notifyEvent(r.id, 'notify_server', payload))
    );
  }

  // ===== Hooks für server.js =====
  function onLogin(user, req) {
    const time = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
    notifyEvent(user.id, 'notify_login', {
      title: '🔐 Neue Anmeldung',
      body: `${user.username} hat sich um ${time} angemeldet – ${describeClient(req)}, IP ${req.ip}`,
      tag: 'login',
    });
  }

  function onFriendRequest(toUserId, fromUsername) {
    notifyEvent(toUserId, 'notify_friends', {
      title: '👥 Neue Freundschaftsanfrage',
      body: `${fromUsername} möchte dich als Freund hinzufügen`,
      url: '/friends.html',
    });
  }

  // ===== Routen =====
  app.get('/api/push/key', (req, res) => {
    if (!ready) return res.status(503).json({ msg: 'Push ist noch nicht bereit' });
    res.json({ publicKey: vapidPublicKey });
  });

  app.post('/api/push/subscribe', authenticateToken, (req, res) => {
    const sub = (req.body || {}).subscription || {};
    if (typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      return res.status(400).json({ msg: 'Ungültiges Abo' });
    }
    const keys = JSON.stringify({ p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) });
    db.run(
      `INSERT INTO push_subscriptions (user_id, endpoint, keys, label) VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, keys = excluded.keys, label = excluded.label`,
      [req.user.id, sub.endpoint, keys, describeClient(req)],
      (err) => {
        if (err) return res.status(500).json({ msg: 'Fehler beim Speichern' });
        res.json({ ok: true });
      }
    );
  });

  app.post('/api/push/unsubscribe', authenticateToken, (req, res) => {
    db.run('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', [String((req.body || {}).endpoint || ''), req.user.id], () => res.json({ ok: true }));
  });

  app.get('/api/push/devices', authenticateToken, (req, res) => {
    db.all('SELECT id, endpoint, label, created_at FROM push_subscriptions WHERE user_id = ? ORDER BY created_at', [req.user.id], (err, rows) => {
      if (err) return res.status(500).json({ msg: 'Serverfehler' });
      res.json({ devices: rows });
    });
  });

  app.delete('/api/push/devices/:id', authenticateToken, (req, res) => {
    db.run('DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?', [req.params.id, req.user.id], () => res.json({ ok: true }));
  });

  app.get('/api/push/settings', authenticateToken, (req, res) => {
    getSettings(req.user.id, (err, s) => {
      if (err) return res.status(500).json({ msg: 'Serverfehler' });
      res.json({
        hookToken: s.hook_token,
        notifyLogin: !!s.notify_login,
        notifyFriends: !!s.notify_friends,
        notifyServer: s.notify_server !== 0,
        developer: isDeveloper(req.user),
      });
    });
  });

  app.put('/api/push/settings', authenticateToken, (req, res) => {
    getSettings(req.user.id, (err) => {
      if (err) return res.status(500).json({ msg: 'Serverfehler' });
      const b = req.body || {};
      db.run(
        'UPDATE push_settings SET notify_login = ?, notify_friends = ?, notify_server = ? WHERE user_id = ?',
        [b.notifyLogin ? 1 : 0, b.notifyFriends ? 1 : 0, b.notifyServer === false ? 0 : 1, req.user.id],
        (err) => (err ? res.status(500).json({ msg: 'Serverfehler' }) : res.json({ ok: true }))
      );
    });
  });

  // Neuen Webhook-Token erzeugen (der alte wird damit ungültig)
  app.post('/api/push/hook-token', authenticateToken, (req, res) => {
    getSettings(req.user.id, (err) => {
      if (err) return res.status(500).json({ msg: 'Serverfehler' });
      const token = crypto.randomBytes(24).toString('base64url');
      db.run('UPDATE push_settings SET hook_token = ? WHERE user_id = ?', [token, req.user.id], (err) =>
        err ? res.status(500).json({ msg: 'Serverfehler' }) : res.json({ hookToken: token })
      );
    });
  });

  app.post('/api/push/test', authenticateToken, async (req, res) => {
    const sent = await notifyUser(req.user.id, { title: '✅ Test', body: 'Push-Benachrichtigungen funktionieren!' });
    res.json({ sent });
  });

  // Webhook für eigene Skripte, z. B.:
  //   curl -d "Backup fertig" https://watchlist.satho-net.de/api/push/hook/<token>
  // Text als Rohtext oder JSON { "title": "...", "message": "...", "url": "..." }.
  const hookHits = new Map();
  app.post('/api/push/hook/:token', require('express').text({ type: () => true, limit: '8kb' }), (req, res) => {
    const token = String(req.params.token);
    const now = Date.now();
    const hit = hookHits.get(token) || { count: 0, since: now };
    if (now - hit.since > 60 * 1000) Object.assign(hit, { count: 0, since: now });
    if (++hit.count > 30) return res.status(429).json({ msg: 'Zu viele Nachrichten pro Minute' });
    hookHits.set(token, hit);

    db.get('SELECT user_id FROM push_settings WHERE hook_token = ?', [token], async (err, row) => {
      if (err) return res.status(500).json({ msg: 'Serverfehler' });
      if (!row) return res.status(404).json({ msg: 'Unbekannter Token' });

      // JSON hat der globale JSON-Parser schon gelesen, alles andere kommt als Text
      let data = req.body;
      if (typeof data === 'string') {
        try { data = JSON.parse(data); } catch (_) { data = { message: data }; }
      }
      if (typeof data !== 'object' || data === null) data = { message: String(data ?? '') };
      const title = String(data.title || req.query.title || '📣 Satho-Net').slice(0, 100);
      const body = String(data.message || data.body || '').trim().slice(0, 500) || '(ohne Text)';
      const url = typeof data.url === 'string' && /^(https?:\/\/|\/)/.test(data.url) ? data.url : '/';

      const sent = await notifyUser(row.user_id, { title, body, url });
      res.json({ ok: true, sent });
    });
  });

  setInterval(() => hookHits.clear(), 10 * 60 * 1000).unref();

  return { notifyUser, notifyDevelopers, onLogin, onFriendRequest };
};

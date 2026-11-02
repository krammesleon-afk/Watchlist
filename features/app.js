// Alles, was nur die Android-App braucht.
//
// Benachrichtigungen: Ein WebView kann kein Web-Push. Deshalb landet jede
// Benachrichtigung zusätzlich in einem Postfach (Tabelle `notifications`),
// und die App fragt es im Hintergrund ab. Damit sie dafür nicht das Login-
// Token (läuft nach 12 h ab) speichern muss, bekommt jedes App-Gerät einen
// eigenen, langlebigen Geräte-Schlüssel. In der Datenbank liegt davon nur
// der SHA-256-Hash.
//
// App-Links: /.well-known/assetlinks.json erlaubt Android, Links auf diese
// Seite (z. B. Watch-Party-Einladungen) direkt in der App zu öffnen.
const crypto = require('crypto');

const KEEP_NOTIFICATIONS = 50;

// SHA-256 des Signaturschlüssels der App (keytool -list -v). Ist öffentlich,
// steht in jeder APK. Für einen eigenen Schlüssel ANDROID_CERT_SHA256 setzen.
const DEFAULT_CERT_SHA256 = '74:F9:7F:0C:4F:9D:97:8F:4D:21:29:9B:2A:59:4A:AA:17:BE:0F:DF:13:1A:B1:EE:B4:93:22:BC:91:9A:0F:CB';

const hash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

module.exports = function mountApp({ app, db, authenticateToken }) {
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
    db.run('CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, id)');
    db.run(`CREATE TABLE IF NOT EXISTS app_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      token_hash TEXT UNIQUE NOT NULL,
      label TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen DATETIME,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    )`);
  });

  // Legt eine Benachrichtigung ins Postfach und gibt zurück, wie viele
  // App-Geräte sie abholen werden.
  function store(userId, { title, body, url }) {
    return new Promise((resolve) => {
      db.run(
        'INSERT INTO notifications (user_id, title, body, url) VALUES (?, ?, ?, ?)',
        [userId, String(title || 'Satho-Net').slice(0, 100), String(body || '').slice(0, 500), url || '/'],
        () => {
          db.run(
            `DELETE FROM notifications WHERE user_id = ? AND id NOT IN
               (SELECT id FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT ${KEEP_NOTIFICATIONS})`,
            [userId, userId]
          );
          db.get('SELECT COUNT(*) AS n FROM app_devices WHERE user_id = ?', [userId], (err, row) => resolve(row ? row.n : 0));
        }
      );
    });
  }

  function deviceFromRequest(req, cb) {
    const token = req.headers['x-device-token'];
    if (!token) return cb(null);
    db.get('SELECT id, user_id FROM app_devices WHERE token_hash = ?', [hash(token)], (err, row) => cb(err ? null : row));
  }

  // ===== Routen =====

  // App meldet sich nach dem Login an und bekommt ihren Geräte-Schlüssel
  app.post('/api/app/device', authenticateToken, (req, res) => {
    const token = crypto.randomBytes(32).toString('base64url');
    const label = String((req.body || {}).label || 'Android-App').slice(0, 60);
    db.run(
      'INSERT INTO app_devices (user_id, token_hash, label, last_seen) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
      [req.user.id, hash(token), label],
      (err) => (err ? res.status(500).json({ msg: 'Serverfehler' }) : res.json({ deviceToken: token, username: req.user.username }))
    );
  });

  // Abmelden in der App: Gerät vergessen
  app.delete('/api/app/device', (req, res) => {
    deviceFromRequest(req, (device) => {
      if (!device) return res.json({ ok: true });
      db.run('DELETE FROM app_devices WHERE id = ?', [device.id], () => res.json({ ok: true }));
    });
  });

  // Neue Benachrichtigungen seit `after`. Ohne `after` nur die letzte ID,
  // damit eine frische Installation nicht den ganzen Verlauf meldet.
  app.get('/api/app/notifications', (req, res) => {
    deviceFromRequest(req, (device) => {
      if (!device) return res.status(401).json({ msg: 'Gerät unbekannt' });
      db.run('UPDATE app_devices SET last_seen = CURRENT_TIMESTAMP WHERE id = ?', [device.id]);
      const after = Number.parseInt(req.query.after, 10);
      if (!Number.isFinite(after)) {
        db.get('SELECT MAX(id) AS last FROM notifications WHERE user_id = ?', [device.user_id], (err, row) =>
          res.json({ last: (row && row.last) || 0, notifications: [] })
        );
        return;
      }
      db.all(
        'SELECT id, title, body, url, created_at FROM notifications WHERE user_id = ? AND id > ? ORDER BY id LIMIT 20',
        [device.user_id, after],
        (err, rows) => {
          if (err) return res.status(500).json({ msg: 'Serverfehler' });
          res.json({ last: rows.length ? rows[rows.length - 1].id : after, notifications: rows });
        }
      );
    });
  });

  // Verlauf für die Benachrichtigungs-Seite (Web und App)
  app.get('/api/notifications', authenticateToken, (req, res) => {
    db.all(
      'SELECT id, title, body, url, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30',
      [req.user.id],
      (err, rows) => (err ? res.status(500).json({ msg: 'Serverfehler' }) : res.json({ notifications: rows }))
    );
  });

  app.delete('/api/notifications', authenticateToken, (req, res) => {
    db.run('DELETE FROM notifications WHERE user_id = ?', [req.user.id], () => res.json({ ok: true }));
  });

  // express.static liefert keine Punkt-Ordner aus, daher eine eigene Route
  app.get('/.well-known/assetlinks.json', (req, res) => {
    const fingerprints = (process.env.ANDROID_CERT_SHA256 || DEFAULT_CERT_SHA256)
      .split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    res.json([{
      relation: ['delegate_permission/common.handle_all_urls'],
      target: { namespace: 'android_app', package_name: 'de.sathonet.watchlist', sha256_cert_fingerprints: fingerprints },
    }]);
  });

  return { store };
};

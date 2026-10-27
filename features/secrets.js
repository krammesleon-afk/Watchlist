// Einmal-Geheimlinks: Text wird im Browser verschlüsselt (AES-GCM), der
// Schlüssel steckt nur im #Teil des Links und kommt nie beim Server an.
// Der Server speichert nur den verschlüsselten Blob und löscht ihn beim
// ersten Abruf bzw. nach Ablauf.
const crypto = require('crypto');

const MAX_CIPHERTEXT = 140 * 1024; // ~100 KB Klartext nach Base64
const EXPIRY_OPTIONS = { '1h': 3600, '1d': 86400, '7d': 7 * 86400 };

module.exports = function mountSecrets({ app, db, authenticateToken }) {
  db.run(`CREATE TABLE IF NOT EXISTS secrets (
    id TEXT PRIMARY KEY,
    user_id INTEGER,
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);

  // Erstellen nur mit Login, damit niemand den Server als Ablage missbraucht
  app.post('/api/secrets', authenticateToken, (req, res) => {
    const { ciphertext, iv, expiresIn } = req.body || {};
    if (typeof ciphertext !== 'string' || typeof iv !== 'string' || !ciphertext || !iv) {
      return res.status(400).json({ msg: 'Ungültige Daten' });
    }
    if (ciphertext.length > MAX_CIPHERTEXT) return res.status(413).json({ msg: 'Text ist zu lang' });
    const ttl = EXPIRY_OPTIONS[expiresIn] || EXPIRY_OPTIONS['1d'];
    const id = crypto.randomBytes(16).toString('base64url');
    const expiresAt = Date.now() + ttl * 1000;

    db.run(
      'INSERT INTO secrets (id, user_id, ciphertext, iv, expires_at) VALUES (?, ?, ?, ?, ?)',
      [id, req.user.id, ciphertext, iv.slice(0, 64), expiresAt],
      (err) => {
        if (err) return res.status(500).json({ msg: 'Fehler beim Speichern' });
        res.json({ id, expiresAt });
      }
    );
  });

  // Nur nachsehen, ob es das Geheimnis (noch) gibt – ohne es zu verbrauchen.
  // So zerstören Link-Vorschauen in Messengern nichts.
  app.get('/api/secrets/:id/exists', (req, res) => {
    db.get('SELECT expires_at FROM secrets WHERE id = ?', [req.params.id], (err, row) => {
      if (err) return res.status(500).json({ msg: 'Serverfehler' });
      res.json({ exists: !!row && row.expires_at > Date.now() });
    });
  });

  // Abrufen = löschen. Bei zwei gleichzeitigen Abrufen gewinnt nur einer,
  // weil nur ein DELETE tatsächlich eine Zeile entfernt.
  app.post('/api/secrets/:id/open', (req, res) => {
    db.get('SELECT ciphertext, iv, expires_at FROM secrets WHERE id = ?', [req.params.id], (err, row) => {
      if (err) return res.status(500).json({ msg: 'Serverfehler' });
      if (!row || row.expires_at <= Date.now()) return res.status(404).json({ msg: 'Nicht (mehr) vorhanden' });
      db.run('DELETE FROM secrets WHERE id = ?', [req.params.id], function (err) {
        if (err) return res.status(500).json({ msg: 'Serverfehler' });
        if (this.changes !== 1) return res.status(404).json({ msg: 'Nicht (mehr) vorhanden' });
        res.set('Cache-Control', 'no-store');
        res.json({ ciphertext: row.ciphertext, iv: row.iv });
      });
    });
  });

  setInterval(() => {
    db.run('DELETE FROM secrets WHERE expires_at <= ?', [Date.now()]);
  }, 10 * 60 * 1000).unref();
};

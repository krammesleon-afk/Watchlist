require('dotenv').config({ quiet: true });
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const morgan = require('morgan');
const path = require('path');

const app = express();
app.set('trust proxy', 1); // hinter Reverse-Proxy: korrekte Client-IP für Rate-Limiting
const PORT = process.env.PORT || 3000;
const SECRET_KEY = process.env.JWT_SECRET;
if (!SECRET_KEY) {
  console.error('❌ FATAL: JWT_SECRET ist nicht gesetzt. Bitte in der .env-Datei konfigurieren.');
  process.exit(1);
}
const CORS_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim());

// ============ MIDDLEWARE SETUP ============
app.use(morgan('dev'));
app.use(
  cors({
    origin: CORS_ORIGINS,
    credentials: true,
  })
);
// Standard-Limit 1 MB; nur die Startseiten-Einstellungen dürfen größer sein,
// weil dort das eigene Hintergrundbild als Data-URL mitkommt.
const jsonSmall = bodyParser.json({ limit: '1mb' });
const jsonLarge = bodyParser.json({ limit: '10mb' });
app.use((req, res, next) => (req.path === '/api/prefs' ? jsonLarge : jsonSmall)(req, res, next));

// Security Headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Startseite: Portal-/Hub-Seite statt direkt der Watchlist-App
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.use(express.static('public'));

// ============ DATABASE SETUP ============
const db = new sqlite3.Database('./watchlist.db');
const resetCodes = new Map();

db.serialize(() => {
  // Performance & Integrität
  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA busy_timeout = 5000');
  db.run('PRAGMA foreign_keys = ON');

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    email TEXT UNIQUE,
    password TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    data TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS ranking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    data TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    data TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS game_ranking (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    data TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Startseiten-Einstellungen (Shortcuts, To-Dos, Wetter, Hintergrund …) pro Account
  db.run(`CREATE TABLE IF NOT EXISTS user_prefs (
    user_id INTEGER PRIMARY KEY,
    data TEXT DEFAULT '{}',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Freunde & gemeinsame Listen
  db.run(`CREATE TABLE IF NOT EXISTS friendships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    requester_id INTEGER,
    addressee_id INTEGER,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(requester_id) REFERENCES users(id),
    FOREIGN KEY(addressee_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS shared_lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    owner_id INTEGER,
    kind TEXT DEFAULT 'mixed',
    data TEXT DEFAULT '[]',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(owner_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS shared_list_members (
    list_id INTEGER,
    user_id INTEGER,
    PRIMARY KEY(list_id, user_id),
    FOREIGN KEY(list_id) REFERENCES shared_lists(id),
    FOREIGN KEY(user_id) REFERENCES users(id)
  )`);

  // Indizes für schnellere user_id-Abfragen
  db.run('CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_ranking_user ON ranking(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_games_user ON games(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_game_ranking_user ON game_ranking(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships(requester_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships(addressee_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_shared_members_user ON shared_list_members(user_id)');
  db.run('CREATE INDEX IF NOT EXISTS idx_shared_lists_owner ON shared_lists(owner_id)');

  // Migration: Email-Column falls nicht vorhanden
  db.all("PRAGMA table_info(users)", (err, columns) => {
    if (err) {
      console.error('❌ Error checking table structure:', err);
      return;
    }
    const hasEmailColumn = columns.some((col) => col.name === 'email');
    if (!hasEmailColumn) {
      console.log('🔧 Adding missing email column...');
      db.run("ALTER TABLE users ADD COLUMN email TEXT UNIQUE", (err) => {
        if (err) console.error('❌ Error adding email column:', err);
        else console.log('✅ Email column added successfully');
      });
    }
  });

  // Versionszähler, damit gleichzeitige Änderungen sich nicht gegenseitig überschreiben
  addColumnIfMissing('watchlist', 'version', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('shared_lists', 'version', 'INTEGER NOT NULL DEFAULT 0');
});

function addColumnIfMissing(table, column, definition) {
  db.all(`PRAGMA table_info(${table})`, (err, columns) => {
    if (err) return console.error(`❌ Error checking ${table} structure:`, err);
    if (columns.some((col) => col.name === column)) return;
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, (err) => {
      if (err) console.error(`❌ Error adding ${table}.${column}:`, err);
      else console.log(`✅ Column ${table}.${column} added`);
    });
  });
}

// ============ AUTH MIDDLEWARE ============
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ msg: 'Kein Token' });

  const token = authHeader.split(' ')[1];
  jwt.verify(token, SECRET_KEY, (err, user) => {
    if (err) return res.status(403).json({ msg: 'Token ungültig' });
    req.user = user;
    next();
  });
}

// ============ RATE LIMITING ============
const loginAttempts = new Map();
const tmdbRateLimiter = {
  requests: new Map(),
  maxRequests: 40,
  windowMs: 10000,

  check(identifier = 'global') {
    const now = Date.now();
    const window = this.requests.get(identifier) || { count: 0, resetAt: now + this.windowMs };

    if (now > window.resetAt) {
      window.count = 0;
      window.resetAt = now + this.windowMs;
    }

    if (window.count >= this.maxRequests) {
      return { allowed: false, retryAfter: Math.ceil((window.resetAt - now) / 1000) };
    }

    window.count++;
    this.requests.set(identifier, window);
    return { allowed: true, remaining: this.maxRequests - window.count };
  },
};

function checkRateLimit(identifier, maxAttempts = 5, windowMs = 15 * 60 * 1000) {
  const now = Date.now();
  const attempts = loginAttempts.get(identifier) || { count: 0, firstAttempt: now };

  if (now - attempts.firstAttempt > windowMs) {
    loginAttempts.set(identifier, { count: 1, firstAttempt: now });
    return { allowed: true, remaining: maxAttempts - 1 };
  }

  if (attempts.count >= maxAttempts) {
    const retryAfter = Math.ceil((attempts.firstAttempt + windowMs - now) / 1000);
    return { allowed: false, retryAfter };
  }

  attempts.count++;
  loginAttempts.set(identifier, attempts);
  return { allowed: true, remaining: maxAttempts - attempts.count };
}

// Zähler nach erfolgreicher Aktion zurücksetzen (z. B. nach gelungenem Login)
function resetRateLimit(identifier) {
  loginAttempts.delete(identifier);
}

// ============ API CONFIG ============
const TMDB_API_KEY = process.env.TMDB_API_KEY;
if (!TMDB_API_KEY) console.warn('⚠️  TMDB_API_KEY ist nicht gesetzt – TMDB-Endpunkte werden fehlschlagen.');
const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
const RAWG_API_KEY = process.env.RAWG_API_KEY || '';
const RAWG_BASE_URL = 'https://api.rawg.io/api';
const ANILIST_API_URL = 'https://graphql.anilist.co';

// ============ ROUTES: AUTH ============

// Registrierung
app.post('/api/register', async (req, res) => {
  const { username, email, password } = req.body;

  // Rate Limiting: max. 10 Registrierungen pro Stunde und IP
  const regCheck = checkRateLimit('register:' + req.ip, 10, 60 * 60 * 1000);
  if (!regCheck.allowed) {
    return res.status(429).json({
      msg: `Zu viele Registrierungen. Bitte warte ${regCheck.retryAfter} Sekunden.`,
      retryAfter: regCheck.retryAfter,
    });
  }

  if (!username || !email || !password) {
    return res.status(400).json({ msg: 'Alle Felder sind erforderlich' });
  }

  if (username.length < 3) {
    return res.status(400).json({ msg: 'Benutzername muss mindestens 3 Zeichen lang sein' });
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ msg: 'Ungültige E-Mail-Adresse' });
  }

  if (password.length < 6) {
    return res.status(400).json({ msg: 'Passwort muss mindestens 6 Zeichen lang sein' });
  }

  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return res.status(400).json({ msg: 'Passwort muss mindestens einen Buchstaben und eine Zahl enthalten' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const stmt = db.prepare('INSERT INTO users (username, email, password) VALUES (?, ?, ?)');

    stmt.run(username, email, hashedPassword, function (err) {
      if (err) {
        console.error('Registration error:', err);
        if (err.message.includes('username')) {
          return res.status(400).json({ msg: 'Benutzername bereits vergeben' });
        } else if (err.message.includes('email')) {
          return res.status(400).json({ msg: 'E-Mail-Adresse bereits registriert' });
        }
        return res.status(400).json({ msg: 'Registrierung fehlgeschlagen' });
      }

      console.log(`✅ Neuer User registriert: ${username} (${email})`);
      res.status(201).json({
        msg: 'Registrierung erfolgreich',
        user: { id: this.lastID, username, email },
      });
    });

    stmt.finalize();
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ msg: 'Server-Fehler' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ msg: 'Username und Password erforderlich' });
  }

  // Rate Limiting: an Username UND IP gekoppelt, damit Fremde kein Konto aussperren können
  const loginKey = 'login:' + username + ':' + req.ip;
  const rateCheck = checkRateLimit(loginKey);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      msg: `Zu viele Versuche. Bitte warte ${rateCheck.retryAfter} Sekunden.`,
      retryAfter: rateCheck.retryAfter,
    });
  }

  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, row) => {
    if (err || !row) {
      console.log(`❌ Login fehlgeschlagen für: ${username}`);
      return res.status(401).json({ msg: 'Ungültige Anmeldedaten' });
    }

    try {
      const match = await bcrypt.compare(password, row.password);
      if (!match) {
        console.log(`❌ Falsches Passwort für: ${username}`);
        return res.status(401).json({ msg: 'Ungültige Anmeldedaten' });
      }

      resetRateLimit(loginKey);
      const token = jwt.sign({ id: row.id, username: row.username }, SECRET_KEY, { expiresIn: '12h' });
      console.log(`✅ Login erfolgreich: ${username}`);
      res.json({ token, user: { id: row.id, username: row.username, email: row.email } });
    } catch (e) {
      console.error('Login error:', e);
      res.status(500).json({ msg: 'Server-Fehler' });
    }
  });
});

// Password Reset Request
app.post('/api/password-reset/request', async (req, res) => {
  const { identifier } = req.body;
  console.log('🔄 Password reset request received for:', identifier);

  if (!identifier) {
    return res.status(400).json({ msg: 'Identifier erforderlich' });
  }

  // Rate Limiting: max. 5 Reset-Anfragen pro Stunde und IP
  const rateCheck = checkRateLimit('reset:' + req.ip, 5, 60 * 60 * 1000);
  if (!rateCheck.allowed) {
    return res.status(429).json({
      msg: `Zu viele Anfragen. Bitte warte ${rateCheck.retryAfter} Sekunden.`,
      retryAfter: rateCheck.retryAfter,
    });
  }

  // Generische Antwort, um keine existierenden Konten preiszugeben
  const genericResponse = {
    msg: 'Falls ein Konto existiert, wurde ein Reset-Code generiert',
    hint: 'Code wurde in der Konsole geloggt (Dev-Modus)',
  };

  db.get('SELECT * FROM users WHERE username = ? OR email = ?', [identifier, identifier], (err, user) => {
    if (err) {
      console.error('❌ Database error:', err);
      return res.status(500).json({ msg: 'Server-Fehler' });
    }

    if (!user) {
      console.log(`❌ User not found for identifier: ${identifier}`);
      return res.json(genericResponse);
    }

    const resetCode = crypto.randomInt(100000, 999999).toString();
    const expires = Date.now() + 15 * 60 * 1000;

    resetCodes.set(identifier, { code: resetCode, expires, userId: user.id, attempts: 0 });

    console.log(`🔑 Reset-Code für ${identifier}: ${resetCode}`);
    console.log(`⏰ Code läuft ab in 15 Minuten`);

    res.json(genericResponse);
  });
});

// Code Verification
app.post('/api/password-reset/verify', async (req, res) => {
  const { identifier, code } = req.body;
  console.log('🔍 Code verification for:', identifier);

  if (!identifier || !code) {
    return res.status(400).json({ msg: 'Identifier und Code erforderlich' });
  }

  const resetData = resetCodes.get(identifier);

  if (!resetData) {
    return res.status(404).json({ msg: 'Kein Reset-Request gefunden' });
  }

  if (Date.now() > resetData.expires) {
    resetCodes.delete(identifier);
    return res.status(400).json({ msg: 'Code abgelaufen' });
  }

  if (resetData.code !== code) {
    resetData.attempts = (resetData.attempts || 0) + 1;
    if (resetData.attempts >= 5) {
      resetCodes.delete(identifier);
      console.log(`🚫 Zu viele Fehlversuche – Reset-Code für ${identifier} verworfen`);
      return res.status(429).json({ msg: 'Zu viele Fehlversuche. Bitte fordere einen neuen Code an.' });
    }
    return res.status(400).json({ msg: 'Ungültiger Code' });
  }

  const resetToken = crypto.randomBytes(32).toString('hex');
  resetData.token = resetToken;
  resetData.tokenExpires = Date.now() + 10 * 60 * 1000;

  console.log('✅ Code verified for:', identifier);
  res.json({ token: resetToken });
});

// Password Reset Confirmation
app.post('/api/password-reset/confirm', async (req, res) => {
  const { token, newPassword } = req.body;
  console.log('🔐 Password reset confirmation');

  if (!token || !newPassword) {
    return res.status(400).json({ msg: 'Token und neues Passwort erforderlich' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ msg: 'Passwort muss mindestens 6 Zeichen lang sein' });
  }

  let resetData = null;
  let identifier = null;

  for (let [key, value] of resetCodes.entries()) {
    if (value.token === token) {
      resetData = value;
      identifier = key;
      break;
    }
  }

  if (!resetData) {
    return res.status(404).json({ msg: 'Ungültiger Token' });
  }

  if (Date.now() > resetData.tokenExpires) {
    resetCodes.delete(identifier);
    return res.status(400).json({ msg: 'Token abgelaufen' });
  }

  try {
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    db.run('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, resetData.userId], function (err) {
      if (err) {
        console.error('❌ Password update error:', err);
        return res.status(500).json({ msg: 'Server-Fehler beim Passwort-Update' });
      }

      resetCodes.delete(identifier);
      console.log('✅ Password successfully reset for user ID:', resetData.userId);
      res.json({ msg: 'Passwort erfolgreich zurückgesetzt' });
    });
  } catch (error) {
    console.error('❌ Password reset confirm error:', error);
    res.status(500).json({ msg: 'Server-Fehler' });
  }
});

// ============ ROUTES: WATCHLIST ============

// Watchlist speichern
// Speichert die komplette Watchlist. Mit baseVersion wird nur gespeichert, wenn
// seit dem letzten Laden niemand (z. B. ein anderes Gerät) gespeichert hat –
// sonst 409 mit dem aktuellen Stand, damit der Client zusammenführen kann.
app.post('/api/watchlist', authenticateToken, (req, res) => {
  const watchlistData = JSON.stringify(req.body.watchlist || []);
  const baseVersion = req.body.baseVersion;

  db.get('SELECT data, version FROM watchlist WHERE user_id = ?', [req.user.id], (err, row) => {
    if (err) {
      console.error('❌ Error loading watchlist:', err);
      return res.status(500).json({ msg: 'Fehler beim Laden der Watchlist' });
    }

    if (!row) {
      return db.run('INSERT INTO watchlist (user_id, data, version) VALUES (?, ?, 1)', [req.user.id, watchlistData], (err) => {
        if (err) {
          console.error('❌ Error creating watchlist:', err);
          return res.status(500).json({ msg: 'Fehler beim Erstellen der Watchlist' });
        }
        console.log(`💾 New watchlist created for user: ${req.user.username}`);
        res.json({ msg: 'Watchlist gespeichert', version: 1 });
      });
    }

    // Ohne baseVersion (alte Clients) wird wie bisher überschrieben
    const sql = baseVersion === undefined
      ? 'UPDATE watchlist SET data = ?, version = version + 1 WHERE user_id = ?'
      : 'UPDATE watchlist SET data = ?, version = version + 1 WHERE user_id = ? AND version = ?';
    const params = baseVersion === undefined
      ? [watchlistData, req.user.id]
      : [watchlistData, req.user.id, baseVersion];

    db.run(sql, params, function (err) {
      if (err) {
        console.error('❌ Error updating watchlist:', err);
        return res.status(500).json({ msg: 'Fehler beim Speichern der Watchlist' });
      }
      if (this.changes === 0) {
        // Zwischenzeitlich anderswo gespeichert → aktuellen Stand zurückgeben
        return db.get('SELECT data, version FROM watchlist WHERE user_id = ?', [req.user.id], (err, current) => {
          if (err || !current) return res.status(500).json({ msg: 'Fehler beim Laden der Watchlist' });
          let watchlist = [];
          try { watchlist = JSON.parse(current.data || '[]'); } catch (e) {}
          res.status(409).json({ msg: 'Watchlist wurde zwischenzeitlich geändert', watchlist, version: current.version });
        });
      }
      console.log(`💾 Watchlist updated for user: ${req.user.username}`);
      db.get('SELECT version FROM watchlist WHERE user_id = ?', [req.user.id], (err, current) => {
        res.json({ msg: 'Watchlist gespeichert', version: current ? current.version : null });
      });
    });
  });
});

// ============ ROUTES: RANKING ============

// Ranking speichern
app.post('/api/ranking', authenticateToken, (req, res) => {
  const rankingData = JSON.stringify(req.body.ranking || {});

  db.get('SELECT * FROM ranking WHERE user_id = ?', [req.user.id], (err, row) => {
    if (err) {
      console.error('❌ Error loading ranking:', err);
      return res.status(500).json({ msg: 'Fehler beim Laden des Rankings' });
    }

    if (row) {
      db.run('UPDATE ranking SET data = ? WHERE user_id = ?', [rankingData, req.user.id], (err) => {
        if (err) {
          console.error('❌ Error updating ranking:', err);
          return res.status(500).json({ msg: 'Fehler beim Speichern des Rankings' });
        }
        console.log(`💾 Ranking updated for user: ${req.user.username}`);
        res.json({ msg: 'Ranking gespeichert' });
      });
    } else {
      db.run('INSERT INTO ranking (user_id, data) VALUES (?, ?)', [req.user.id, rankingData], (err) => {
        if (err) {
          console.error('❌ Error creating ranking:', err);
          return res.status(500).json({ msg: 'Fehler beim Erstellen des Rankings' });
        }
        console.log(`💾 New ranking created for user: ${req.user.username}`);
        res.json({ msg: 'Ranking gespeichert' });
      });
    }
  });
});

// Ranking laden
app.get('/api/ranking', authenticateToken, (req, res) => {
  db.get('SELECT data FROM ranking WHERE user_id = ?', [req.user.id], (err, row) => {
    if (err) {
      console.error('❌ Error loading ranking:', err);
      return res.status(500).json({ msg: 'Fehler beim Laden des Rankings' });
    }

    if (row && row.data) {
      try {
        const ranking = JSON.parse(row.data);
        console.log(`📖 Ranking loaded for user: ${req.user.username}`);
        res.json({ ranking });
      } catch (parseError) {
        console.error('❌ Error parsing ranking data:', parseError);
        res.json({ ranking: {} });
      }
    } else {
      console.log(`📖 Empty ranking for user: ${req.user.username}`);
      res.json({ ranking: {} });
    }
  });
});

// Watchlist laden
app.get('/api/watchlist', authenticateToken, (req, res) => {
  db.get('SELECT data, version FROM watchlist WHERE user_id = ?', [req.user.id], (err, row) => {
    if (err) {
      console.error('❌ Error loading watchlist:', err);
      return res.status(500).json({ msg: 'Fehler beim Laden der Watchlist' });
    }

    const version = row ? row.version : 0;
    if (row && row.data) {
      try {
        const watchlist = JSON.parse(row.data);
        console.log(`📖 Watchlist loaded for user: ${req.user.username} (${watchlist.length} items)`);
        res.json({ watchlist, version });
      } catch (parseError) {
        console.error('❌ Error parsing watchlist data:', parseError);
        res.json({ watchlist: [], version });
      }
    } else {
      console.log(`📖 Empty watchlist for user: ${req.user.username}`);
      res.json({ watchlist: [], version });
    }
  });
});

// User löschen – Kind-Datensätze zuerst, dann der User selbst (FKs sind aktiv),
// alles in einer Transaktion, damit kein halb gelöschter Account zurückbleibt.
app.delete('/api/user', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const username = req.user.username;
  console.log(`🗑️ Delete request for user: ${username} (ID: ${userId})`);

  const steps = [
    ['DELETE FROM shared_list_members WHERE user_id = ?', [userId]],
    ['DELETE FROM shared_list_members WHERE list_id IN (SELECT id FROM shared_lists WHERE owner_id = ?)', [userId]],
    ['DELETE FROM shared_lists WHERE owner_id = ?', [userId]],
    ['DELETE FROM friendships WHERE requester_id = ? OR addressee_id = ?', [userId, userId]],
    ['DELETE FROM user_prefs WHERE user_id = ?', [userId]],
    ['DELETE FROM game_ranking WHERE user_id = ?', [userId]],
    ['DELETE FROM games WHERE user_id = ?', [userId]],
    ['DELETE FROM ranking WHERE user_id = ?', [userId]],
    ['DELETE FROM watchlist WHERE user_id = ?', [userId]],
    ['DELETE FROM users WHERE id = ?', [userId]],
  ];

  db.serialize(() => {
    db.run('BEGIN IMMEDIATE', (err) => {
      if (err) {
        console.error('❌ Fehler beim Starten der Transaktion:', err);
        return res.status(500).json({ msg: 'Serverfehler beim Löschen.' });
      }

      const runStep = (i) => {
        if (i >= steps.length) {
          return db.run('COMMIT', (err) => {
            if (err) {
              console.error('❌ Fehler beim Commit:', err);
              return db.run('ROLLBACK', () => res.status(500).json({ msg: 'Serverfehler beim Löschen.' }));
            }
            console.log(`✅ User ${username} successfully deleted`);
            res.json({ msg: 'User erfolgreich gelöscht.' });
          });
        }

        const [sql, params] = steps[i];
        db.run(sql, params, (err) => {
          if (err) {
            console.error('❌ Fehler beim Löschen:', sql, err);
            return db.run('ROLLBACK', () => res.status(500).json({ msg: 'Serverfehler beim Löschen.' }));
          }
          runStep(i + 1);
        });
      };

      runStep(0);
    });
  });
});

// ============ ROUTES: FRIENDS & SHARED LISTS ============

// Nutzer per Username suchen
app.get('/api/users/search', authenticateToken, (req, res) => {
  const q = (req.query.q || '').trim();
  if (q.length < 2) return res.json({ users: [] });
  db.all(
    'SELECT id, username FROM users WHERE username LIKE ? AND id != ? LIMIT 15',
    ['%' + q + '%', req.user.id],
    (err, rows) => {
      if (err) return res.status(500).json({ msg: 'Fehler bei der Suche' });
      res.json({ users: rows || [] });
    }
  );
});

// Freundschaftsanfrage senden
app.post('/api/friends/request', authenticateToken, (req, res) => {
  const username = (req.body.username || '').trim();
  if (!username) return res.status(400).json({ msg: 'Benutzername fehlt' });
  db.get('SELECT id, username FROM users WHERE username = ?', [username], (err, target) => {
    if (err) return res.status(500).json({ msg: 'Serverfehler' });
    if (!target) return res.status(404).json({ msg: 'Benutzer nicht gefunden' });
    if (target.id === req.user.id) return res.status(400).json({ msg: 'Du kannst dich nicht selbst hinzufügen' });
    db.get(
      `SELECT * FROM friendships WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`,
      [req.user.id, target.id, target.id, req.user.id],
      (err, existing) => {
        if (err) return res.status(500).json({ msg: 'Serverfehler' });
        if (existing) {
          return res.status(409).json({
            msg: existing.status === 'accepted' ? 'Ihr seid bereits befreundet' : 'Anfrage besteht bereits',
          });
        }
        db.run(
          'INSERT INTO friendships (requester_id, addressee_id, status) VALUES (?, ?, ?)',
          [req.user.id, target.id, 'pending'],
          (err) => {
            if (err) return res.status(500).json({ msg: 'Fehler beim Senden' });
            res.json({ msg: 'Anfrage gesendet' });
          }
        );
      }
    );
  });
});

// Auf Freundschaftsanfrage antworten
app.post('/api/friends/respond', authenticateToken, (req, res) => {
  const { requestId, accept } = req.body;
  db.get('SELECT * FROM friendships WHERE id = ?', [requestId], (err, fr) => {
    if (err) return res.status(500).json({ msg: 'Serverfehler' });
    if (!fr) return res.status(404).json({ msg: 'Anfrage nicht gefunden' });
    if (fr.addressee_id !== req.user.id) return res.status(403).json({ msg: 'Nicht erlaubt' });
    if (fr.status !== 'pending') return res.status(409).json({ msg: 'Anfrage bereits bearbeitet' });
    if (accept) {
      db.run('UPDATE friendships SET status = ? WHERE id = ?', ['accepted', requestId], (err) => {
        if (err) return res.status(500).json({ msg: 'Fehler' });
        res.json({ msg: 'Freund hinzugefügt' });
      });
    } else {
      db.run('DELETE FROM friendships WHERE id = ?', [requestId], (err) => {
        if (err) return res.status(500).json({ msg: 'Fehler' });
        res.json({ msg: 'Anfrage abgelehnt' });
      });
    }
  });
});

// Freunde + offene Anfragen laden
app.get('/api/friends', authenticateToken, (req, res) => {
  const uid = req.user.id;
  const sql = `
    SELECT f.id, f.status, f.requester_id, f.addressee_id,
           u.id AS other_id, u.username AS other_username
    FROM friendships f
    JOIN users u ON u.id = CASE WHEN f.requester_id = ? THEN f.addressee_id ELSE f.requester_id END
    WHERE f.requester_id = ? OR f.addressee_id = ?`;
  db.all(sql, [uid, uid, uid], (err, rows) => {
    if (err) return res.status(500).json({ msg: 'Fehler beim Laden' });
    const friends = [], incoming = [], outgoing = [];
    (rows || []).forEach((r) => {
      if (r.status === 'accepted') {
        friends.push({ friendshipId: r.id, id: r.other_id, username: r.other_username });
      } else if (r.addressee_id === uid) {
        incoming.push({ requestId: r.id, id: r.other_id, username: r.other_username });
      } else {
        outgoing.push({ requestId: r.id, id: r.other_id, username: r.other_username });
      }
    });
    res.json({ friends, incoming, outgoing });
  });
});

// Prüft, ob zwei Nutzer befreundet sind (Status 'accepted'). userA === userB gilt als ok.
function areFriends(userA, userB, cb) {
  if (userA === userB) return cb(null, true);
  db.get(
    `SELECT 1 FROM friendships WHERE status = 'accepted' AND
     ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))`,
    [userA, userB, userB, userA],
    (err, row) => cb(err, !!row)
  );
}

// Profil eines Freundes: Watchlist + Games (nur sichtbar, wenn befreundet)
app.get('/api/friends/:id/profile', authenticateToken, (req, res) => {
  const friendId = parseInt(req.params.id, 10);
  if (!friendId) return res.status(400).json({ msg: 'Ungültige ID' });

  areFriends(req.user.id, friendId, (err, ok) => {
    if (err) return res.status(500).json({ msg: 'Serverfehler' });
    if (!ok) return res.status(403).json({ msg: 'Nur Freunde können Profile sehen' });

    db.get('SELECT username FROM users WHERE id = ?', [friendId], (err, user) => {
      if (err) return res.status(500).json({ msg: 'Serverfehler' });
      if (!user) return res.status(404).json({ msg: 'Benutzer nicht gefunden' });

      db.get('SELECT data FROM watchlist WHERE user_id = ?', [friendId], (err, wl) => {
        db.get('SELECT data FROM games WHERE user_id = ?', [friendId], (err, gm) => {
          let watchlist = [], games = [];
          try { watchlist = JSON.parse((wl && wl.data) || '[]'); } catch (e) {}
          try { games = JSON.parse((gm && gm.data) || '[]'); } catch (e) {}
          res.json({ id: friendId, username: user.username, watchlist, games });
        });
      });
    });
  });
});

// Freund entfernen / Anfrage zurückziehen
app.delete('/api/friends/:id', authenticateToken, (req, res) => {
  db.get('SELECT * FROM friendships WHERE id = ?', [req.params.id], (err, fr) => {
    if (err) return res.status(500).json({ msg: 'Serverfehler' });
    if (!fr) return res.status(404).json({ msg: 'Nicht gefunden' });
    if (fr.requester_id !== req.user.id && fr.addressee_id !== req.user.id) {
      return res.status(403).json({ msg: 'Nicht erlaubt' });
    }
    db.run('DELETE FROM friendships WHERE id = ?', [req.params.id], (err) => {
      if (err) return res.status(500).json({ msg: 'Fehler' });
      res.json({ msg: 'Entfernt' });
    });
  });
});

// Hilfsfunktion: Liste laden, wenn der Nutzer Mitglied (oder Besitzer) ist
function getListIfMember(listId, userId, cb) {
  db.get('SELECT * FROM shared_lists WHERE id = ?', [listId], (err, list) => {
    if (err) return cb(err);
    if (!list) return cb(null, null, false);
    if (list.owner_id === userId) return cb(null, list, true);
    db.get(
      'SELECT 1 FROM shared_list_members WHERE list_id = ? AND user_id = ?',
      [listId, userId],
      (err, m) => {
        if (err) return cb(err);
        cb(null, list, !!m);
      }
    );
  });
}

// Eigene + geteilte Listen auflisten
app.get('/api/shared-lists', authenticateToken, (req, res) => {
  const uid = req.user.id;
  const sql = `
    SELECT sl.id, sl.name, sl.kind, sl.owner_id, sl.updated_at,
           ou.username AS owner_username,
           (SELECT COUNT(*) FROM shared_list_members m WHERE m.list_id = sl.id) AS member_count
    FROM shared_lists sl
    JOIN users ou ON ou.id = sl.owner_id
    WHERE sl.owner_id = ?
       OR sl.id IN (SELECT list_id FROM shared_list_members WHERE user_id = ?)
    ORDER BY sl.updated_at DESC`;
  db.all(sql, [uid, uid], (err, rows) => {
    if (err) return res.status(500).json({ msg: 'Fehler beim Laden' });
    res.json({ lists: (rows || []).map((r) => ({ ...r, isOwner: r.owner_id === uid })) });
  });
});

// Neue gemeinsame Liste anlegen
app.post('/api/shared-lists', authenticateToken, (req, res) => {
  const name = (req.body.name || '').trim();
  const kind = ['movies', 'games', 'mixed'].includes(req.body.kind) ? req.body.kind : 'mixed';
  if (!name) return res.status(400).json({ msg: 'Name fehlt' });
  db.run(
    "INSERT INTO shared_lists (name, owner_id, kind, data, updated_at) VALUES (?, ?, ?, '[]', CURRENT_TIMESTAMP)",
    [name, req.user.id, kind],
    function (err) {
      if (err) return res.status(500).json({ msg: 'Fehler beim Erstellen' });
      res.json({ msg: 'Liste erstellt', id: this.lastID });
    }
  );
});

// Eine Liste mit Inhalt + Mitgliedern laden
app.get('/api/shared-lists/:id', authenticateToken, (req, res) => {
  getListIfMember(req.params.id, req.user.id, (err, list, isMember) => {
    if (err) return res.status(500).json({ msg: 'Serverfehler' });
    if (!list) return res.status(404).json({ msg: 'Liste nicht gefunden' });
    if (!isMember) return res.status(403).json({ msg: 'Kein Zugriff' });
    let data = [];
    try { data = JSON.parse(list.data || '[]'); } catch (e) {}
    const sql = `SELECT u.id, u.username FROM shared_list_members m
                 JOIN users u ON u.id = m.user_id WHERE m.list_id = ?`;
    db.all(sql, [list.id], (err, members) => {
      if (err) return res.status(500).json({ msg: 'Fehler' });
      db.get('SELECT username FROM users WHERE id = ?', [list.owner_id], (err, owner) => {
        res.json({
          id: list.id,
          name: list.name,
          kind: list.kind,
          owner_id: list.owner_id,
          owner_username: owner ? owner.username : '?',
          isOwner: list.owner_id === req.user.id,
          updated_at: list.updated_at,
          data,
          members: members || [],
        });
      });
    });
  });
});

// Listeninhalt aktualisieren (gemeinsame Bearbeitung)
// Nur noch Umbenennen – Einträge werden über die /items-Routen einzeln geändert,
// damit gleichzeitige Änderungen mehrerer Mitglieder nicht verloren gehen.
app.put('/api/shared-lists/:id', authenticateToken, (req, res) => {
  getListIfMember(req.params.id, req.user.id, (err, list, isMember) => {
    if (err) return res.status(500).json({ msg: 'Serverfehler' });
    if (!list) return res.status(404).json({ msg: 'Liste nicht gefunden' });
    if (!isMember) return res.status(403).json({ msg: 'Kein Zugriff' });
    const name = String(req.body.name || list.name).trim().slice(0, 100) || list.name;
    db.run(
      'UPDATE shared_lists SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [name, list.id],
      (err) => {
        if (err) return res.status(500).json({ msg: 'Fehler beim Speichern' });
        res.json({ msg: 'Gespeichert' });
      }
    );
  });
});

// Liest die Einträge einer Liste, wendet mutate(data) an und speichert nur, wenn
// die Liste dazwischen nicht von jemand anderem geändert wurde (sonst neu versuchen).
// mutate gibt eine Fehlermeldung (String) zurück oder nichts.
function updateListItems(listId, mutate, cb, attempt = 0) {
  db.get('SELECT data, version FROM shared_lists WHERE id = ?', [listId], (err, row) => {
    if (err || !row) return cb(err || new Error('Liste nicht gefunden'));
    let data = [];
    try { data = JSON.parse(row.data || '[]'); } catch (e) {}
    const problem = mutate(data);
    if (problem) return cb(null, null, problem);
    db.run(
      'UPDATE shared_lists SET data = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ?',
      [JSON.stringify(data), listId, row.version],
      function (err) {
        if (err) return cb(err);
        if (this.changes === 0) {
          if (attempt >= 5) return cb(new Error('Liste wird gerade zu oft geändert'));
          return updateListItems(listId, mutate, cb, attempt + 1);
        }
        cb(null, data);
      }
    );
  });
}

function requireListMember(req, res, next) {
  getListIfMember(req.params.id, req.user.id, (err, list, isMember) => {
    if (err) return res.status(500).json({ msg: 'Serverfehler' });
    if (!list) return res.status(404).json({ msg: 'Liste nicht gefunden' });
    if (!isMember) return res.status(403).json({ msg: 'Kein Zugriff' });
    req.list = list;
    next();
  });
}

function sendListItems(res) {
  return (err, data, problem) => {
    if (err) return res.status(500).json({ msg: 'Fehler beim Speichern' });
    if (problem) return res.status(400).json({ msg: problem });
    res.json({ data });
  };
}

// Eintrag hinzufügen
app.post('/api/shared-lists/:id/items', authenticateToken, requireListMember, (req, res) => {
  const it = req.body.item || {};
  // key hat immer die Form "typ_id" (z. B. movie_603) – landet im Frontend in onclick-Handlern
  const match = typeof it.key === 'string' && it.key.match(/^(movie|tv|anime|game)_(\d{1,12})$/);
  if (!match) return res.status(400).json({ msg: 'Ungültiger Eintrag' });
  const item = {
    key: it.key,
    kind: match[1],
    refId: Number(match[2]),
    title: String(it.title || '').slice(0, 300),
    image: /^https:\/\/[^'"\s()]+$/.test(it.image || '') ? it.image.slice(0, 500) : '',
    meta: String(it.meta || '').slice(0, 300),
    addedBy: req.user.username,
  };
  updateListItems(req.list.id, (data) => {
    if (data.some((i) => i.key === item.key)) return 'Schon in der Liste';
    data.push(item);
  }, sendListItems(res));
});

// Eintrag entfernen
app.delete('/api/shared-lists/:id/items/:key', authenticateToken, requireListMember, (req, res) => {
  const key = req.params.key;
  updateListItems(req.list.id, (data) => {
    const idx = data.findIndex((i) => i.key === key);
    if (idx !== -1) data.splice(idx, 1);
  }, sendListItems(res));
});

// Kommentar eines Eintrags setzen
app.patch('/api/shared-lists/:id/items/:key', authenticateToken, requireListMember, (req, res) => {
  const key = req.params.key;
  const comment = String(req.body.comment || '').trim().slice(0, 280);
  updateListItems(req.list.id, (data) => {
    const it = data.find((i) => i.key === key);
    if (!it) return 'Eintrag nicht gefunden';
    it.comment = comment;
  }, sendListItems(res));
});

// Mitglied (Freund) zu einer Liste hinzufügen – nur Besitzer
app.post('/api/shared-lists/:id/members', authenticateToken, (req, res) => {
  const userId = req.body.userId;
  db.get('SELECT * FROM shared_lists WHERE id = ?', [req.params.id], (err, list) => {
    if (err) return res.status(500).json({ msg: 'Serverfehler' });
    if (!list) return res.status(404).json({ msg: 'Liste nicht gefunden' });
    if (list.owner_id !== req.user.id) {
      return res.status(403).json({ msg: 'Nur der Besitzer darf Mitglieder hinzufügen' });
    }
    areFriends(req.user.id, userId, (err, ok) => {
        if (err) return res.status(500).json({ msg: 'Serverfehler' });
        if (!ok) return res.status(400).json({ msg: 'Nur Freunde können hinzugefügt werden' });
        db.run(
          'INSERT OR IGNORE INTO shared_list_members (list_id, user_id) VALUES (?, ?)',
          [list.id, userId],
          (err) => {
            if (err) return res.status(500).json({ msg: 'Fehler' });
            res.json({ msg: 'Mitglied hinzugefügt' });
          }
        );
      }
    );
  });
});

// Mitglied entfernen (Besitzer) oder Liste verlassen (Mitglied selbst)
app.delete('/api/shared-lists/:id/members/:userId', authenticateToken, (req, res) => {
  const targetUser = parseInt(req.params.userId, 10);
  db.get('SELECT * FROM shared_lists WHERE id = ?', [req.params.id], (err, list) => {
    if (err) return res.status(500).json({ msg: 'Serverfehler' });
    if (!list) return res.status(404).json({ msg: 'Liste nicht gefunden' });
    const isOwner = list.owner_id === req.user.id;
    const isSelf = targetUser === req.user.id;
    if (!isOwner && !isSelf) return res.status(403).json({ msg: 'Nicht erlaubt' });
    db.run(
      'DELETE FROM shared_list_members WHERE list_id = ? AND user_id = ?',
      [list.id, targetUser],
      (err) => {
        if (err) return res.status(500).json({ msg: 'Fehler' });
        res.json({ msg: 'Mitglied entfernt' });
      }
    );
  });
});

// Gemeinsame Liste löschen – nur Besitzer
app.delete('/api/shared-lists/:id', authenticateToken, (req, res) => {
  db.get('SELECT * FROM shared_lists WHERE id = ?', [req.params.id], (err, list) => {
    if (err) return res.status(500).json({ msg: 'Serverfehler' });
    if (!list) return res.status(404).json({ msg: 'Liste nicht gefunden' });
    if (list.owner_id !== req.user.id) {
      return res.status(403).json({ msg: 'Nur der Besitzer darf löschen' });
    }
    db.run('DELETE FROM shared_list_members WHERE list_id = ?', [list.id], () => {
      db.run('DELETE FROM shared_lists WHERE id = ?', [list.id], (err) => {
        if (err) return res.status(500).json({ msg: 'Fehler' });
        res.json({ msg: 'Liste gelöscht' });
      });
    });
  });
});

// ============ ROUTES: STARTSEITEN-EINSTELLUNGEN ============
// Ein JSON-Blob pro User: Shortcuts, To-Dos, Wetterort, Suchmaschine,
// Hintergrundbild und Kalender-Einträge der Startseite.

// Einstellungen laden
app.get('/api/prefs', authenticateToken, (req, res) => {
  db.get('SELECT data, updated_at FROM user_prefs WHERE user_id = ?', [req.user.id], (err, row) => {
    if (err) {
      console.error('❌ Error loading prefs:', err);
      return res.status(500).json({ msg: 'Fehler beim Laden der Einstellungen' });
    }
    if (!row || !row.data) return res.json({ prefs: null, updated_at: null });
    try {
      res.json({ prefs: JSON.parse(row.data), updated_at: row.updated_at });
    } catch (e) {
      console.error('❌ Error parsing prefs:', e);
      res.json({ prefs: null, updated_at: null });
    }
  });
});

// Einstellungen speichern (kompletter Stand, Upsert)
app.put('/api/prefs', authenticateToken, (req, res) => {
  const prefs = req.body && req.body.prefs;
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) {
    return res.status(400).json({ msg: 'prefs-Objekt erforderlich' });
  }

  const data = JSON.stringify(prefs);
  db.run(
    `INSERT INTO user_prefs (user_id, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP`,
    [req.user.id, data],
    (err) => {
      if (err) {
        console.error('❌ Error saving prefs:', err);
        return res.status(500).json({ msg: 'Fehler beim Speichern der Einstellungen' });
      }
      console.log(`💾 Startseiten-Einstellungen gespeichert für: ${req.user.username} (${data.length} Bytes)`);
      res.json({ msg: 'Einstellungen gespeichert' });
    }
  );
});

// ============ ROUTES: GAMES (RAWG) ============

// Game-Sammlung speichern
app.post('/api/games', authenticateToken, (req, res) => {
  const gamesData = JSON.stringify(req.body.games || []);
  db.get('SELECT id FROM games WHERE user_id = ?', [req.user.id], (err, row) => {
    if (err) return res.status(500).json({ msg: 'Fehler beim Laden der Games' });
    if (row) {
      db.run('UPDATE games SET data = ? WHERE user_id = ?', [gamesData, req.user.id], (err) => {
        if (err) return res.status(500).json({ msg: 'Fehler beim Speichern der Games' });
        res.json({ msg: 'Games gespeichert' });
      });
    } else {
      db.run('INSERT INTO games (user_id, data) VALUES (?, ?)', [req.user.id, gamesData], (err) => {
        if (err) return res.status(500).json({ msg: 'Fehler beim Erstellen der Games' });
        res.json({ msg: 'Games gespeichert' });
      });
    }
  });
});

// Game-Sammlung laden
app.get('/api/games', authenticateToken, (req, res) => {
  db.get('SELECT data FROM games WHERE user_id = ?', [req.user.id], (err, row) => {
    if (err) return res.status(500).json({ msg: 'Fehler beim Laden der Games' });
    if (row && row.data) {
      try {
        res.json({ games: JSON.parse(row.data) });
      } catch (e) {
        res.json({ games: [] });
      }
    } else {
      res.json({ games: [] });
    }
  });
});

// Game-Ranking speichern
app.post('/api/game-ranking', authenticateToken, (req, res) => {
  const rankingData = JSON.stringify(req.body.ranking || {});
  db.get('SELECT id FROM game_ranking WHERE user_id = ?', [req.user.id], (err, row) => {
    if (err) return res.status(500).json({ msg: 'Fehler beim Laden des Game-Rankings' });
    if (row) {
      db.run('UPDATE game_ranking SET data = ? WHERE user_id = ?', [rankingData, req.user.id], (err) => {
        if (err) return res.status(500).json({ msg: 'Fehler beim Speichern des Game-Rankings' });
        res.json({ msg: 'Game-Ranking gespeichert' });
      });
    } else {
      db.run('INSERT INTO game_ranking (user_id, data) VALUES (?, ?)', [req.user.id, rankingData], (err) => {
        if (err) return res.status(500).json({ msg: 'Fehler beim Erstellen des Game-Rankings' });
        res.json({ msg: 'Game-Ranking gespeichert' });
      });
    }
  });
});

// Game-Ranking laden
app.get('/api/game-ranking', authenticateToken, (req, res) => {
  db.get('SELECT data FROM game_ranking WHERE user_id = ?', [req.user.id], (err, row) => {
    if (err) return res.status(500).json({ msg: 'Fehler beim Laden des Game-Rankings' });
    if (row && row.data) {
      try {
        res.json({ ranking: JSON.parse(row.data) });
      } catch (e) {
        res.json({ ranking: {} });
      }
    } else {
      res.json({ ranking: {} });
    }
  });
});

// RAWG Suche (Proxy)
app.get('/api/rawg/search', authenticateToken, async (req, res) => {
  const query = (req.query.query || '').trim();
  if (!query) return res.status(400).json({ msg: 'Query erforderlich' });

  if (!RAWG_API_KEY) return res.status(500).json({ msg: 'RAWG API Key nicht konfiguriert' });

  const rateCheck = tmdbRateLimiter.check(req.user.id);
  if (!rateCheck.allowed) {
    return res.status(429).json({ msg: 'Zu viele Anfragen', retryAfter: rateCheck.retryAfter });
  }

  try {
    const url = `${RAWG_BASE_URL}/games?key=${RAWG_API_KEY}&search=${encodeURIComponent(query)}&page_size=20`;
    const response = await fetch(url);
    if (!response.ok) {
      console.error('RAWG API Error:', response.status);
      return res.status(502).json({ msg: 'RAWG Service nicht erreichbar' });
    }
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('RAWG Error:', error);
    res.status(500).json({ msg: 'RAWG API Fehler' });
  }
});

// RAWG: Spiele nach Genres (für Game-Empfehlungen)
app.get('/api/rawg/games', authenticateToken, async (req, res) => {
  if (!RAWG_API_KEY) return res.status(500).json({ msg: 'RAWG API Key nicht konfiguriert' });

  const rateCheck = tmdbRateLimiter.check(req.user.id);
  if (!rateCheck.allowed) {
    return res.status(429).json({ msg: 'Zu viele Anfragen', retryAfter: rateCheck.retryAfter });
  }

  const genres = (req.query.genres || '').trim();
  const ordering = (req.query.ordering || '-added').trim();
  const pageSize = Math.min(parseInt(req.query.page_size, 10) || 30, 40);

  try {
    let url = `${RAWG_BASE_URL}/games?key=${RAWG_API_KEY}&page_size=${pageSize}&ordering=${encodeURIComponent(ordering)}`;
    if (genres) url += `&genres=${encodeURIComponent(genres)}`;
    const response = await fetch(url);
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error('RAWG API Error (games):', response.status, body.slice(0, 300));
      return res.status(502).json({ msg: `RAWG nicht erreichbar (Status ${response.status})` });
    }
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('RAWG Error (games):', error);
    res.status(500).json({ msg: 'RAWG API Fehler: ' + (error.message || error) });
  }
});

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    resetCodesActive: resetCodes.size,
    corsOrigins: CORS_ORIGINS,
  });
});

// ============ ROUTES: TMDB PROXY ============

const TMDB_SEARCH_TYPES = ['movie', 'tv', 'person', 'multi'];
const TMDB_MEDIA_TYPES = ['movie', 'tv'];

// Validiert Typ + numerische ID, um manipulierte Pfade zu verhindern
function validTmdbMedia(type, id) {
  return TMDB_MEDIA_TYPES.includes(type) && /^\d+$/.test(String(id));
}

// Hilfsfunktion für TMDB Requests mit Rate Limiting und Error Handling
async function fetchTmdb(endpoint, res) {
  try {
    const url = `${TMDB_BASE_URL}${endpoint}${endpoint.includes('?') ? '&' : '?'}api_key=${TMDB_API_KEY}&language=de-DE`;
    const response = await fetch(url);

    if (!response.ok) {
      console.error('TMDB API Error:', response.status);
      return res.status(502).json({ msg: 'TMDB Service nicht erreichbar' });
    }

    const data = await response.json();
    return res.json(data);
  } catch (error) {
    console.error('TMDB Error:', error);
    return res.status(500).json({ msg: 'TMDB API Fehler' });
  }
}

// TMDB Search
app.get('/api/tmdb/search/:type', authenticateToken, async (req, res) => {
  const { type } = req.params;
  const { query, page = 1 } = req.query;

  if (!TMDB_SEARCH_TYPES.includes(type)) return res.status(400).json({ msg: 'Ungültiger Typ' });
  if (!query) return res.status(400).json({ msg: 'Query erforderlich' });

  // Rate Limiting
  const rateCheck = tmdbRateLimiter.check(req.user.id);
  if (!rateCheck.allowed) {
    return res.status(429).json({ msg: 'Zu viele Anfragen', retryAfter: rateCheck.retryAfter });
  }

  await fetchTmdb(`/search/${type}?query=${encodeURIComponent(query)}&page=${page}`, res);
});

// TMDB Top Rated (vor :type/:id registriert, damit "top_rated" nicht als ID interpretiert wird)
app.get('/api/tmdb/:type/top_rated', authenticateToken, async (req, res) => {
  const { type } = req.params;
  if (!TMDB_MEDIA_TYPES.includes(type)) return res.status(400).json({ msg: 'Ungültiger Typ' });
  await fetchTmdb(`/${type}/top_rated`, res);
});

// TMDB Videos (Trailer)
app.get('/api/tmdb/:type/:id/videos', authenticateToken, async (req, res) => {
  const { type, id } = req.params;
  if (!validTmdbMedia(type, id)) return res.status(400).json({ msg: 'Ungültiger Typ oder ID' });
  await fetchTmdb(`/${type}/${id}/videos`, res);
});

// TMDB Recommendations
app.get('/api/tmdb/:type/:id/recommendations', authenticateToken, async (req, res) => {
  const { type, id } = req.params;
  if (!validTmdbMedia(type, id)) return res.status(400).json({ msg: 'Ungültiger Typ oder ID' });
  await fetchTmdb(`/${type}/${id}/recommendations`, res);
});

// TMDB Watch Providers (Streaming-Anbieter)
app.get('/api/tmdb/:type/:id/watch/providers', authenticateToken, async (req, res) => {
  const { type, id } = req.params;
  if (!validTmdbMedia(type, id)) return res.status(400).json({ msg: 'Ungültiger Typ oder ID' });
  await fetchTmdb(`/${type}/${id}/watch/providers`, res);
});

// TMDB Detail
app.get('/api/tmdb/:type/:id',authenticateToken, async (req, res) => {
  const { type, id } = req.params;
  if (!validTmdbMedia(type, id)) return res.status(400).json({ msg: 'Ungültiger Typ oder ID' });
  await fetchTmdb(`/${type}/${id}`, res);
});

// TMDB TV Season
app.get('/api/tmdb/tv/:id/season/:season', authenticateToken, async (req, res) => {
  const { id, season } = req.params;
  if (!/^\d+$/.test(id) || !/^\d+$/.test(season)) {
    return res.status(400).json({ msg: 'Ungültige ID oder Staffel' });
  }
  await fetchTmdb(`/tv/${id}/season/${season}`, res);
});

// ============ ROUTES: ANILIST PROXY ============

async function fetchAniList(graphqlQuery, variables, res) {
  try {
    const response = await fetch(ANILIST_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: graphqlQuery, variables }),
    });

    const data = await response.json();

    if (data.errors) {
      console.error('AniList Error:', data.errors);
      return res.status(500).json({ msg: 'AniList API Fehler', errors: data.errors });
    }

    return data.data;
  } catch (error) {
    console.error('AniList Error:', error);
    throw error;
  }
}

// AniList Suche
app.post('/api/anilist/search', authenticateToken, async (req, res) => {
  const { query } = req.body;
  if (!query) return res.status(400).json({ msg: 'Query erforderlich' });

  const graphqlQuery = `
    query ($search: String) {
      Media(search: $search, type: ANIME, isAdult: false) {
        id
        title { romaji english native }
        description(asHtml: false)
        genres
        averageScore
        popularity
        episodes
        status
        seasonYear
        coverImage { large medium }
        bannerImage
        studios { nodes { name } }
      }
    }
  `;

  try {
    const data = await fetchAniList(graphqlQuery, { search: query }, res);
    res.json(data?.Media || null);
  } catch (error) {
    res.status(500).json({ msg: 'AniList API Fehler' });
  }
});

// AniList by ID
app.get('/api/anilist/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;

  const graphqlQuery = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        title { romaji english native }
        description(asHtml: false)
        genres
        averageScore
        popularity
        episodes
        status
        seasonYear
        coverImage { large medium }
        bannerImage
        studios { nodes { name } }
        recommendations(sort: RATING_DESC, perPage: 5) {
          nodes {
            mediaRecommendation {
              id
              title { romaji english }
              coverImage { medium }
            }
          }
        }
      }
    }
  `;

  try {
    const data = await fetchAniList(graphqlQuery, { id: parseInt(id) }, res);
    res.json(data?.Media || null);
  } catch (error) {
    res.status(500).json({ msg: 'AniList API Fehler' });
  }
});

// AniList Bulk
app.post('/api/anilist/bulk', authenticateToken, async (req, res) => {
  const { ids } = req.body;
  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ msg: 'IDs Array erforderlich' });
  }

  const graphqlQuery = `
    query ($ids: [Int]) {
      Page(page: 1, perPage: 50) {
        media(id_in: $ids, type: ANIME) {
          id
          title { romaji english native }
          description(asHtml: false)
          genres
          averageScore
          episodes
          status
          seasonYear
          coverImage { large medium }
          bannerImage
          studios { nodes { name } }
        }
      }
    }
  `;

  try {
    const data = await fetchAniList(graphqlQuery, { ids: ids.map(Number) }, res);
    res.json(data?.Page?.media || []);
  } catch (error) {
    res.status(500).json({ msg: 'AniList API Fehler' });
  }
});

// ============ EASTER EGG: JAVIS ============
const javisResponses = [
  'Alles läuft optimal, Leon! 👌',
  'Ich beobachte deine Watchlist... sieht gut aus!',
  "Hast du 'The Last of Us' schon gesehen? Empfehlung!",
  'Systemintegration wird klappen - du schaffst das!',
  'Brauchst du Hilfe bei den Prüfungen? Frag einfach!',
  'Mein Favorit: Sci-Fi Filme. Was ist deiner?',
  'Javis meldet sich zum Dienst! 🤖',
  'Die Datenbank läuft wie geschmiert.',
  'Screenshot genommen - danke fürs Vertrauen!',
  'Noch ein Kaffee? ☕',
];

app.get('/api/javis', authenticateToken, (req, res) => {
  const randomResponse = javisResponses[Math.floor(Math.random() * javisResponses.length)];
  res.json({
    message: randomResponse,
    mood: Math.random() > 0.5 ? 'happy' : 'focused',
    suggestions: ['watchlist', 'stats', 'recommendations'],
  });
});

// ============ SERVER-COCKPIT (nur Entwickler) ============
require('./cockpit')(app, db, authenticateToken);

// ============ ERROR HANDLER ============
app.use((err, req, res, next) => {
  console.error('💥 Unhandled error:', err);
  res.status(500).json({ msg: 'Unbekannter Server-Fehler' });
});

// ============ CLEANUP: abgelaufene In-Memory-Einträge ============
setInterval(() => {
  const now = Date.now();
  for (const [key, data] of resetCodes.entries()) {
    const expired = now > data.expires && (!data.tokenExpires || now > data.tokenExpires);
    if (expired) resetCodes.delete(key);
  }
  for (const [key, data] of loginAttempts.entries()) {
    if (now - data.firstAttempt > 60 * 60 * 1000) loginAttempts.delete(key);
  }
}, 10 * 60 * 1000).unref();

// ============ SERVER START ============
app.listen(PORT, () => {
  console.log('\n🚀 ================================');
  console.log(` Watchlist Server gestartet!`);
  console.log(` http://localhost:${PORT}`);
  console.log('🚀 ================================\n');
  console.log('📡 Verfügbare API-Endpoints:');
  console.log(' 🔐 POST /api/register - Registrierung');
  console.log(' 🔑 POST /api/login - Anmeldung');
  console.log(' 📧 POST /api/password-reset/request - Reset anfordern');
  console.log(' 🔢 POST /api/password-reset/verify - Code bestätigen');
  console.log(' 🔐 POST /api/password-reset/confirm - Passwort ändern');
  console.log(' 📝 GET /api/watchlist - Watchlist laden');
  console.log(' 💾 POST /api/watchlist - Watchlist speichern');
  console.log(' 🗑️ DELETE /api/user - User löschen');
  console.log(' 💓 GET /api/health - Server-Status');
  console.log('\n🎬 Watchlist-App bereit!\n');
});

// Graceful Shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Server wird heruntergefahren...');
  db.close((err) => {
    if (err) {
      console.error('❌ Error closing database:', err);
    } else {
      console.log('✅ Database connection closed.');
    }
    process.exit(0);
  });
});

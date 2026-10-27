// ============ SERVER-COCKPIT ============
// Live-Messwerte (CPU, RAM, Temperatur, Netzwerk, Festplatte) und ein Verlauf
// der Ausfälle. Nur für Entwickler-Accounts sichtbar.
//
// Der Server läuft als LXC-Container: CPU und RAM kommen aus der cgroup bzw.
// dem (von lxcfs virtualisierten) /proc/meminfo, die Temperatur vom Host.

const fs = require('fs');
const os = require('os');

const SAMPLE_MS = 5000;               // Messintervall
const HISTORY_POINTS = 720;           // 720 × 5 s = 1 Stunde Live-Verlauf
const HEARTBEAT_MS = 30 * 1000;       // Lebenszeichen in die Datenbank
const OUTAGE_THRESHOLD_MS = 90 * 1000; // längere Lücke = Ausfall

function readFile(path) {
  try { return fs.readFileSync(path, 'utf8'); } catch (e) { return null; }
}

// CPU-Zeit des Containers in Mikrosekunden (cgroup v2), sonst null
function readCpuUsageUsec() {
  const stat = readFile('/sys/fs/cgroup/cpu.stat');
  const m = stat && stat.match(/^usage_usec (\d+)/m);
  return m ? Number(m[1]) : null;
}

function readMemory() {
  const info = readFile('/proc/meminfo');
  const get = (key) => {
    const m = info && info.match(new RegExp('^' + key + ':\\s+(\\d+) kB', 'm'));
    return m ? Number(m[1]) * 1024 : null;
  };
  const total = get('MemTotal') || os.totalmem();
  const available = get('MemAvailable') ?? os.freemem();
  return { total, used: total - available };
}

// Bevorzugt die CPU-Package-Temperatur (coretemp), sonst den höchsten Sensorwert
function readTemperature() {
  let best = null;
  let fallback = null;
  let dirs = [];
  try { dirs = fs.readdirSync('/sys/class/hwmon'); } catch (e) { return null; }
  for (const d of dirs) {
    const base = '/sys/class/hwmon/' + d;
    const name = (readFile(base + '/name') || '').trim();
    for (let i = 1; i <= 16; i++) {
      const raw = readFile(`${base}/temp${i}_input`);
      if (raw === null) continue;
      const celsius = Number(raw) / 1000;
      if (!Number.isFinite(celsius) || celsius <= 0) continue;
      const label = (readFile(`${base}/temp${i}_label`) || '').trim();
      if (name === 'coretemp' && /^Package/.test(label)) best = celsius;
      if (fallback === null || celsius > fallback) fallback = celsius;
    }
  }
  return best ?? fallback;
}

// Summe empfangener/gesendeter Bytes aller Schnittstellen außer loopback
function readNetworkBytes() {
  const dev = readFile('/proc/net/dev');
  if (!dev) return null;
  let rx = 0;
  let tx = 0;
  for (const line of dev.split('\n').slice(2)) {
    const [iface, rest] = line.split(':');
    if (!rest || iface.trim() === 'lo') continue;
    const cols = rest.trim().split(/\s+/).map(Number);
    rx += cols[0];
    tx += cols[8];
  }
  return { rx, tx };
}

function readDisk() {
  try {
    const s = fs.statfsSync('/');
    const total = s.blocks * s.bsize;
    return { total, used: total - s.bavail * s.bsize };
  } catch (e) {
    return null;
  }
}

function readSystemUptime() {
  const raw = readFile('/proc/uptime');
  return raw ? Math.round(Number(raw.split(' ')[0])) : Math.round(os.uptime());
}

module.exports = function setupCockpit(app, db, authenticateToken, alerts) {
  // Entwickler: Benutzernamen aus DEVELOPER_USERS in der .env (kommagetrennt)
  const developers = new Set(
    (process.env.DEVELOPER_USERS || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
  );
  const isDeveloper = (user) => !!user && developers.has(String(user.username || '').toLowerCase());

  function requireDeveloper(req, res, next) {
    if (!isDeveloper(req.user)) return res.status(403).json({ msg: 'Nur für Entwickler' });
    next();
  }

  // ---- Live-Messung ----
  const cpuCount = os.cpus().length || 1;
  const history = [];
  let prev = { time: Date.now(), cpu: readCpuUsageUsec(), net: readNetworkBytes() };

  function sample() {
    const time = Date.now();
    const cpu = readCpuUsageUsec();
    const net = readNetworkBytes();
    const seconds = (time - prev.time) / 1000;
    const mem = readMemory();

    const point = {
      t: time,
      cpu: cpu !== null && prev.cpu !== null && seconds > 0
        ? Math.min(100, Math.max(0, ((cpu - prev.cpu) / 1e6 / seconds / cpuCount) * 100))
        : null,
      ram: mem.total ? (mem.used / mem.total) * 100 : null,
      temp: readTemperature(),
      rx: net && prev.net && seconds > 0 ? Math.max(0, (net.rx - prev.net.rx) / seconds) : null,
      tx: net && prev.net && seconds > 0 ? Math.max(0, (net.tx - prev.net.tx) / seconds) : null,
    };
    for (const k of ['cpu', 'ram', 'temp']) if (point[k] !== null) point[k] = Math.round(point[k] * 10) / 10;
    for (const k of ['rx', 'tx']) if (point[k] !== null) point[k] = Math.round(point[k]);

    history.push(point);
    if (history.length > HISTORY_POINTS) history.shift();
    prev = { time, cpu, net };
    if (alerts) alerts.onSample(point, readDisk()); // Push-Warnungen (features/server-alerts.js)
  }
  setInterval(sample, SAMPLE_MS).unref();

  // ---- Ausfälle über Lebenszeichen erkennen ----
  // Der Server schreibt regelmäßig einen Zeitstempel. Ist die Lücke beim Start
  // größer als OUTAGE_THRESHOLD_MS, war er so lange nicht erreichbar.
  const startedAt = Date.now();
  db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS server_heartbeat (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      first_seen INTEGER NOT NULL,  -- Beginn der Aufzeichnung
      last_seen INTEGER NOT NULL
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS server_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,          -- 'outage' oder 'restart'
      started_at INTEGER NOT NULL,
      ended_at INTEGER NOT NULL
    )`);
    db.get('SELECT last_seen FROM server_heartbeat WHERE id = 1', (err, row) => {
      if (err) return console.error('❌ Cockpit heartbeat:', err);
      if (row) {
        const gap = startedAt - row.last_seen;
        const kind = gap > OUTAGE_THRESHOLD_MS ? 'outage' : 'restart';
        db.run('INSERT INTO server_events (kind, started_at, ended_at) VALUES (?, ?, ?)', [kind, row.last_seen, startedAt]);
        if (kind === 'outage') console.log(`⚠️  Ausfall erkannt: ${Math.round(gap / 60000)} Minuten offline`);
        if (alerts) alerts.onStartup(kind, row.last_seen, startedAt);
      }
      heartbeat();
    });
  });

  function heartbeat() {
    db.run(
      'INSERT INTO server_heartbeat (id, first_seen, last_seen) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen',
      [Date.now(), Date.now()],
      (err) => err && console.error('❌ Cockpit heartbeat:', err)
    );
  }
  setInterval(heartbeat, HEARTBEAT_MS).unref();

  // ---- Routen ----
  // Darf der angemeldete Nutzer das Cockpit sehen? (für den Link auf der Startseite)
  app.get('/api/cockpit/access', authenticateToken, (req, res) => {
    res.json({ developer: isDeveloper(req.user) });
  });

  // Aktuelle Werte + Live-Verlauf. Mit ?since=<ms> nur neuere Messpunkte.
  app.get('/api/cockpit/metrics', authenticateToken, requireDeveloper, (req, res) => {
    const since = Number(req.query.since) || 0;
    const mem = readMemory();
    res.json({
      now: Date.now(),
      intervalMs: SAMPLE_MS,
      cpuCount,
      load: os.loadavg().map((l) => Math.round(l * 100) / 100),
      memory: mem,
      disk: readDisk(),
      uptime: { system: readSystemUptime(), app: Math.round((Date.now() - startedAt) / 1000) },
      history: history.filter((p) => p.t > since),
    });
  });

  // Ausfälle und Neustarts der letzten 90 Tage
  app.get('/api/cockpit/events', authenticateToken, requireDeveloper, (req, res) => {
    const from = Date.now() - 90 * 24 * 60 * 60 * 1000;
    db.get('SELECT first_seen FROM server_heartbeat WHERE id = 1', (err, hb) => {
      if (err) return res.status(500).json({ msg: 'Fehler beim Laden' });
      db.all(
        'SELECT kind, started_at, ended_at FROM server_events WHERE ended_at >= ? ORDER BY ended_at DESC LIMIT 200',
        [from],
        (err, rows) => {
          if (err) return res.status(500).json({ msg: 'Fehler beim Laden' });
          res.json({ now: Date.now(), trackingSince: hb ? hb.first_seen : startedAt, events: rows });
        }
      );
    });
  });

};

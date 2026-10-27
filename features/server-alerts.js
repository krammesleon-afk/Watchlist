// Server-Warnungen per Push an Entwickler (DEVELOPER_USERS).
//
// cockpit.js misst, dieses Modul entscheidet, wann daraus eine Nachricht wird:
// Werte müssen eine Weile über der Schwelle liegen (kein Alarm bei kurzen
// Spitzen), danach ist pro Regel eine Stunde Ruhe. Fällt der Wert wieder,
// kommt eine Entwarnung.

const COOLDOWN_MS = 60 * 60 * 1000;

const RULES = [
  { key: 'cpu', label: 'CPU-Last', unit: ' %', limit: 90, holdMs: 5 * 60 * 1000 },
  { key: 'ram', label: 'Arbeitsspeicher', unit: ' %', limit: 90, holdMs: 5 * 60 * 1000 },
  { key: 'temp', label: 'Temperatur', unit: ' °C', limit: 80, holdMs: 2 * 60 * 1000 },
  { key: 'disk', label: 'Festplatte', unit: ' % belegt', limit: 90, holdMs: 0 },
];

module.exports = function createServerAlerts(push) {
  const state = {}; // key -> { overSince, alerted, lastAlert }

  function send(title, body) {
    push.notifyDevelopers({ title, body, url: '/cockpit.html', tag: 'server' });
  }

  function check(rule, value, now) {
    if (value === null || value === undefined) return;
    const s = state[rule.key] || (state[rule.key] = { overSince: null, alerted: false, lastAlert: -Infinity });

    if (value >= rule.limit) {
      if (s.overSince === null) s.overSince = now;
      if (!s.alerted && now - s.overSince >= rule.holdMs && now - s.lastAlert >= COOLDOWN_MS) {
        s.alerted = true;
        s.lastAlert = now;
        const mins = Math.round((now - s.overSince) / 60000);
        send(`⚠️ ${rule.label} hoch`, `${rule.label}: ${Math.round(value)}${rule.unit}` + (mins ? ` – seit ${mins} Minuten über ${rule.limit}${rule.unit}` : ''));
      }
    } else if (value < rule.limit - 5) {
      // Etwas Abstand zur Schwelle, damit es nicht hin und her springt
      if (s.alerted) send(`✅ ${rule.label} wieder normal`, `${rule.label}: ${Math.round(value)}${rule.unit}`);
      s.overSince = null;
      s.alerted = false;
    }
  }

  return {
    // Von cockpit.js nach jeder Messung aufgerufen
    onSample(point, disk) {
      const now = point.t || Date.now();
      check(RULES[0], point.cpu, now);
      check(RULES[1], point.ram, now);
      check(RULES[2], point.temp, now);
      if (disk && disk.total) check(RULES[3], (disk.used / disk.total) * 100, now);
    },

    // Von cockpit.js beim Start aufgerufen, wenn eine Lücke erkannt wurde
    onStartup(kind, from, to) {
      const fmt = (t) => new Date(t).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Berlin' });
      const mins = Math.max(1, Math.round((to - from) / 60000));
      if (kind === 'outage') {
        send('🔴 Server war offline', `Etwa ${mins} Minuten nicht erreichbar (${fmt(from)} bis ${fmt(to)}). Läuft jetzt wieder.`);
      } else {
        send('🔄 Server neu gestartet', `Der Watchlist-Server wurde um ${fmt(to)} neu gestartet.`);
      }
    },
  };
};

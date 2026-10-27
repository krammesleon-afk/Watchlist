# 🎬 Watchlist

Eine selbst gehostete Watchlist für **Filme, Serien, Anime und Spiele** – mit eigenen Rankings, Freunden und geteilten Listen.

Live: https://watchlist.satho-net.de · 📜 [Changelog](CHANGELOG.md) · ⚖️ [Lizenz](LICENSE)

## Features

- **Filme & Serien** über [TMDB](https://www.themoviedb.org/) – Suche, Details, Trailer, Empfehlungen, Streaming-Anbieter (DE)
- **Episoden-Tracking** pro Staffel, inklusive anstehender Folgen
- **Anime** über [AniList](https://anilist.co/)
- **Spiele** über [RAWG](https://rawg.io/) mit eigenem Spiele-Ranking
- **Rankings** für Filme/Serien und Spiele
- **Freunde** – Nutzer suchen, Anfragen senden, Profile ansehen
- **Geteilte Listen** mit mehreren Mitgliedern
- **Konten** mit Login, Registrierung und Passwort-Reset
- **Datei-Drop** (`/drop.html`) – Dateien und Text direkt zwischen eigenen Geräten und zu Freunden schicken (WebRTC, Daten gehen nicht über den Server)
- **Watch-Party** (`/party.html`) – Videos gemeinsam und synchron schauen: YouTube, Trailer, direkte Video-Links (mp4, webm, m3u8) oder eigene Dateien per Drag & Drop, mit Chat und Warteschlange
- **Geheimlink** (`/secret.html`) – Text im Browser verschlüsseln, Link funktioniert genau einmal
- **Benachrichtigungen** (`/push.html`) – Web-Push aufs Handy/den PC bei Logins und Freundschaftsanfragen, plus Webhook für eigene Skripte

## Technik

| Bereich  | Verwendet |
|----------|-----------|
| Server   | Node.js (≥ 18), Express 5 |
| Datenbank | SQLite (`watchlist.db`) |
| Login    | JWT + bcrypt |
| Frontend | HTML, CSS, Vanilla JS (`public/`) |

Alle Anfragen an TMDB, RAWG und AniList laufen über den Server. Die API-Keys bleiben dadurch auf dem Server und sind im Browser nicht sichtbar.

## Projektstruktur

```
server.js             Express-Server mit den Watchlist-API-Routen
features/             Zusatzfunktionen: Datei-Drop, Watch-Party, Geheimlinks, Push
cockpit.js            Messwerte & Ausfall-Erkennung fürs Server-Cockpit
public/               Frontend (wird statisch ausgeliefert)
scripts/              .env ver-/entschlüsseln, Datenbank-Backup
.env.example          Vorlage für die Umgebungsvariablen
.env.gpg              Verschlüsselte .env (nur mit Passwort lesbar)
CHANGELOG.md          Änderungsverlauf
```

Nicht im Repo (siehe `.gitignore`): `.env`, `watchlist.db`, `node_modules/`.

## Installation

```bash
git clone https://github.com/krammesleon-afk/Watchlist.git
cd Watchlist
npm install
```

Danach die `.env` anlegen – **eine** der beiden Varianten:

```bash
# a) Aus der verschlüsselten Datei (fragt nach dem Passwort)
npm run env:decrypt

# b) Neu aus der Vorlage
cp .env.example .env   # und Werte eintragen
```

Starten:

```bash
npm start
```

Der Server läuft dann auf `http://localhost:3000` (bzw. dem `PORT` aus der `.env`). Die Datenbank `watchlist.db` wird beim ersten Start automatisch angelegt.

## Umgebungsvariablen

| Variable       | Beschreibung |
|----------------|--------------|
| `JWT_SECRET`   | Langer, zufälliger String zum Signieren der Login-Tokens |
| `PORT`         | Port des Servers (Standard: 3000) |
| `CORS_ORIGINS` | Erlaubte Domains, kommagetrennt |
| `TMDB_API_KEY` | Key von [themoviedb.org](https://www.themoviedb.org/settings/api) |
| `RAWG_API_KEY` | Key von [rawg.io](https://rawg.io/apidocs) |
| `DEVELOPER_USERS` | Benutzernamen mit Zugriff aufs Server-Cockpit (kommagetrennt) |

Einen sicheren `JWT_SECRET` erzeugen:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Keys verschlüsselt im Repo

Die `.env` selbst wird nie hochgeladen. Damit die Keys trotzdem von überall verfügbar sind, liegt eine verschlüsselte Kopie als `.env.gpg` im Repo (GPG, AES-256, mit Passwort).

```bash
npm run env:encrypt   # .env  -> .env.gpg   (danach committen & pushen)
npm run env:decrypt   # .env.gpg -> .env
```

Nach jeder Änderung an der `.env` neu verschlüsseln. Ohne das Passwort lässt sich die Datei nicht wiederherstellen.

## Betrieb als Dienst (systemd)

Auf dem Server läuft die App als `watchlist.service`:

```ini
[Unit]
Description=Watchlist Node.js Application
After=network-online.target

[Service]
Type=simple
User=leon
WorkingDirectory=/home/leon/server
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl restart watchlist.service   # neu starten
journalctl -u watchlist.service -f         # Logs ansehen
```

**Passwort-Reset:** Es wird keine E-Mail verschickt. Der Reset-Code erscheint im Server-Log (`journalctl`) und muss dem Nutzer manuell weitergegeben werden.

## Backup

`scripts/backup.js` erstellt eine konsistente Kopie der Datenbank (auch während der Server läuft) nach `~/backups/watchlist/` und behält die letzten 8 Sicherungen.

```bash
npm run backup
```

Auf dem Server läuft es automatisch jeden **Sonntag um 03:30** per Cronjob (`crontab -l`). Das Log steht in `~/backups/watchlist/backup.log`.

Wiederherstellen: Dienst stoppen, Sicherung als `watchlist.db` zurückkopieren (und vorhandene `watchlist.db-wal`/`-shm` löschen), Dienst starten.

> Die Backups liegen auf demselben Server. Gegen einen Plattenausfall hilft nur, sie ab und zu woanders hin zu kopieren.

## Server-Cockpit

`/cockpit.html` zeigt CPU, RAM, Temperatur, Netzwerk und Festplatte live (alle 5 s, Verlauf bis 60 Minuten) sowie Ausfälle und Neustarts der letzten 90 Tage.

- **Nur für Entwickler:** Zugriff haben die Benutzernamen in `DEVELOPER_USERS` (`.env`, kommagetrennt). Für alle anderen ist die Kachel auf der Startseite unsichtbar und die API antwortet mit `403`.
- **Ausfälle:** Der Server schreibt alle 30 s ein Lebenszeichen in die Datenbank. Liegt beim Start eine Lücke von mehr als 90 s, wird sie als Ausfall verbucht, sonst als Neustart.
- Der Server läuft als LXC-Container: CPU und RAM sind die des Containers, die Temperatur und die „Host-Last“ die des Proxmox-Hosts.
- Code: `cockpit.js` (Server), `public/cockpit.html` + `public/cockpit.js` (Seite).

## Gleichzeitiges Bearbeiten

- **Watchlist:** Jede Speicherung trägt eine Versionsnummer. Hat ein anderes Gerät inzwischen gespeichert, antwortet der Server mit `409`, und der Browser führt beide Stände zusammen (Einträge und einzelne Felder, z. B. gesehene Episoden).
- **Geteilte Listen:** Einträge werden einzeln hinzugefügt, entfernt und kommentiert (`POST/DELETE/PATCH /api/shared-lists/:id/items`). Änderungen mehrerer Mitglieder überschreiben sich nicht.

## Benachrichtigungen (Web-Push)

Es wird **kein Entwicklerkonto** bei Google oder Apple gebraucht. Web-Push ist ein offener Standard: Der Server weist sich mit einem eigenen VAPID-Schlüsselpaar aus, die Browser-Hersteller stellen die Nachrichten kostenlos zu.

- Das Schlüsselpaar wird beim ersten Start automatisch erzeugt und in der Datenbank (`app_config`) gespeichert. Wer es lieber in der `.env` hat: `npx web-push generate-vapid-keys` und `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` setzen. **Nicht wechseln**, sonst müssen alle Geräte neu aktiviert werden.
- `VAPID_SUBJECT` (z. B. `mailto:du@example.de`) ist eine Kontaktadresse für die Push-Dienste, falls etwas schiefläuft.
- **iPhone/iPad:** ab iOS 16.4, und nur wenn die Seite über „Teilen → Zum Home-Bildschirm“ installiert und von dort geöffnet wurde.
- **Server-Warnungen für Entwickler:** Wer in `DEVELOPER_USERS` steht, bekommt (abschaltbar auf `/push.html`) Push bei Ausfällen und Neustarts sowie wenn CPU oder RAM 5 Minuten über 90 %, die Temperatur 2 Minuten über 80 °C oder die Festplatte über 90 % liegt. Pro Warnung höchstens eine Nachricht pro Stunde, plus Entwarnung. Ein Ausfall wird gemeldet, sobald der Server wieder läuft – während er aus ist, kann er selbst nichts schicken.
- Eigene Skripte schicken Nachrichten über die geheime Webhook-Adresse von `/push.html`:

```bash
curl -d "Backup fertig ✅" https://watchlist.satho-net.de/api/push/hook/<token>
```

## Live-Verbindungen hinter nginx

Datei-Drop und Watch-Party nutzen Server-Sent Events (`/api/drop/events`, `/api/party/:code/events`). Der Server setzt `X-Accel-Buffering: no` und schickt alle 25 s ein Ping, das reicht mit den nginx-Standardeinstellungen. Watch-Party-Räume und Drop-Geräte leben nur im Arbeitsspeicher – nach einem Neustart verbinden sich die Seiten von selbst neu, offene Räume sind dann aber weg.

Datei-Drop verbindet die Geräte direkt (STUN, kein eigener TURN-Server). Im selben WLAN klappt das immer; zwischen manchen Mobilfunknetzen kann die direkte Verbindung scheitern.

## Hinweis zu sqlite3

`sqlite3` ist bewusst auf Version 5 festgelegt. Version 6 braucht Node ≥ 20 und eine neuere glibc und startet auf dem aktuellen Server nicht.

## Changelog

Alle Änderungen stehen im [CHANGELOG.md](CHANGELOG.md).

## Lizenz

[Apache License 2.0](LICENSE)

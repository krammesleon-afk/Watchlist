# 🎬 Watchlist

Eine selbst gehostete Watchlist für **Filme, Serien, Anime und Spiele** – mit eigenen Rankings, Freunden und geteilten Listen.

Live: https://watchlist.satho-net.de

## Features

- **Filme & Serien** über [TMDB](https://www.themoviedb.org/) – Suche, Details, Trailer, Empfehlungen, Streaming-Anbieter (DE)
- **Episoden-Tracking** pro Staffel, inklusive anstehender Folgen
- **Anime** über [AniList](https://anilist.co/)
- **Spiele** über [RAWG](https://rawg.io/) mit eigenem Spiele-Ranking
- **Rankings** für Filme/Serien und Spiele
- **Freunde** – Nutzer suchen, Anfragen senden, Profile ansehen
- **Geteilte Listen** mit mehreren Mitgliedern
- **Konten** mit Login, Registrierung und Passwort-Reset

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
server.js             Express-Server mit allen API-Routen
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

## Gleichzeitiges Bearbeiten

- **Watchlist:** Jede Speicherung trägt eine Versionsnummer. Hat ein anderes Gerät inzwischen gespeichert, antwortet der Server mit `409`, und der Browser führt beide Stände zusammen (Einträge und einzelne Felder, z. B. gesehene Episoden).
- **Geteilte Listen:** Einträge werden einzeln hinzugefügt, entfernt und kommentiert (`POST/DELETE/PATCH /api/shared-lists/:id/items`). Änderungen mehrerer Mitglieder überschreiben sich nicht.

## Hinweis zu sqlite3

`sqlite3` ist bewusst auf Version 5 festgelegt. Version 6 braucht Node ≥ 20 und eine neuere glibc und startet auf dem aktuellen Server nicht.

## Lizenz

[Apache License 2.0](LICENSE)

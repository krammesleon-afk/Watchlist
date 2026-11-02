# Watchlist App - Changelog 🎬

## 2. November 2026 – App und Web getrennt, Benachrichtigungen in der App

### ✨ Neu
- **Benachrichtigungen in der App**: Die App holt Logins, Freundschaftsanfragen, Server-Warnungen und Webhook-Nachrichten selbst ab und zeigt sie als normale Android-Benachrichtigung – im Hintergrund etwa alle 15 Minuten und sofort beim Öffnen. Antippen öffnet die passende Seite. Nach dem ersten Login fragt die App einmal nach der Erlaubnis
- **Verlauf** auf der Benachrichtigungs-Seite (Web und App): die letzten 30 Benachrichtigungen, mit „Leeren“
- „Benachrichtigungen“ öffnet in der App jetzt in der App statt im Browser; App-Geräte stehen mit 📱 in der Geräteliste und lassen sich dort entfernen
- **Update-Hinweis**: Die App schaut einmal am Tag im GitHub-Release nach einer neuen Version und bietet den Download an; dazu „Mehr → Nach Updates suchen“
- **Verknüpfungen am App-Icon** (lange drücken): Watchlist, Games, Datei-Drop, Watch-Party
- **App-Links**: Links auf `watchlist.satho-net.de` (Watch-Party-Einladungen, Geheimlinks …) öffnen direkt in der App
- Startseite im Web: Kachel **„Android-App“** mit Download der neuesten APK (nicht in der App selbst und nicht auf dem iPhone)

### 🔀 Was ist wo
- **Nur Web**: Suchleiste, eigene Website-Shortcuts und Lesezeichen-Trick (Browser-Startseite), Google-Kalender (Google erlaubt die Anmeldung nicht im WebView), Webhook-Beispiele, „Bald verfügbar“, Android-App-Download
- **Nur App**: Leiste unten statt der Kacheln für Watchlist/Games/Freunde, Benachrichtigungen ohne Web-Push, Update-Hinweis, Icon-Verknüpfungen, App-Links

### 🔧 Technik
- Neues Modul `features/app.js`: Tabellen `notifications` (Postfach, max. 50 pro Nutzer) und `app_devices` (eigener Geräte-Schlüssel, nur als SHA-256 gespeichert – die App braucht so kein Login-Token im Hintergrund), Routen `/api/app/device`, `/api/app/notifications`, `/api/notifications` und `/.well-known/assetlinks.json`
- `notifyUser` in `features/push.js` legt jede Nachricht zusätzlich ins Postfach; der Test-Knopf zählt App-Geräte mit
- Android: `Notifier` + `NotificationJob` (JobScheduler, ohne Google-Dienste), neue Berechtigungen `POST_NOTIFICATIONS` und `RECEIVE_BOOT_COMPLETED`

---

## 2. November 2026 – Android-App: eigenes Design

### ✨ Neu
- **Eigenes App-Design** statt der Webseiten-Optik (alles in `app-mobile.css`, die Webseite bleibt unverändert): feste dunkle Flächen statt Glas und Hintergrundbild, eine Akzentfarbe (Orange) auf allen Seiten – auch die Watchlist ist nicht mehr lila –, Systemschrift, große Titel links, Reiter als Segment-Leiste, Meldungen als dunkle Leiste
- Startseite: Uhr und Wetter nebeneinander, Kacheln im Zwei-Spalten-Raster; Hintergrundbild-Knöpfe und der Lesezeichen-Hinweis fallen in der App weg

### 🐛 Behoben
- In der App ließ sich nur die Startseite scrollen: `overscroll-behavior` am `<body>` blockierte auf Watchlist, Games, Freunde & Co. das Wischen

---

## 2. November 2026 – Android-App fürs Handy

### ✨ Neu
- **Eigene Leiste unten** in der App: Start, Watchlist, Games, Freunde und „Mehr“ (Werkzeugkasten, Datei-Drop, Watch-Party, Geheimlink, Benachrichtigungen, Neu laden, Abmelden). Nochmal auf den aktiven Reiter tippen scrollt nach oben
- **Handy-Layout**, ohne dass die Webseite geändert wird: Die App spielt `android/app/src/main/assets/app-mobile.css` in jede Seite ein
  - Schwebende Knöpfe (Startseite, Abmelden, Helligkeitsregler) fallen weg, die Leiste ersetzt sie
  - Watchlist: Abschnitte als wischbare Reiter oben statt einer zweiten, gequetschten Leiste unten; Filter in zwei Spalten statt über den Rand hinaus
  - Startseite: obere Leiste kompakt in zwei Zeilen statt übereinander geschoben
  - Eingabefelder mit 16 px, damit nichts hineinzoomt
- **Ladebalken** oben beim Seitenwechsel

### 🐛 Behoben
- Ab Android 15 lag die Seite unter Status- und Navigationsleiste; die App hält die Ränder jetzt selbst frei, auch für die Tastatur

### 🔧 Technik
- `androidx.webkit` für `addDocumentStartJavaScript` (Stylesheet vor dem ersten Zeichnen, kein Aufblitzen); ältere WebViews bekommen es beim Sichtbarwerden der Seite
- Icons der Leiste aus `public/icons.js` als Vector-Drawables

---

## 28. Oktober 2026 – Android-App

### ✨ Neu
- **Android-App** (`android/`): Vollbild-WebView für `watchlist.satho-net.de` mit eigenem Icon, Datei-Auswahl, Downloads (auch `blob:`-Links aus Export und Datei-Drop), Kamera/Mikrofon für die Watch-Party, Vollbild-Videos, Zurück-Taste und Offline-Hinweis
- **APK über GitHub Releases**: der Workflow `android-apk.yml` baut die App bei Tags `app-v*` oder von Hand und hängt `satho-net.apk` ans Release

### ⚠️ Grenzen
- Kein Web-Push in der App (WebView-Einschränkung)

---

## 27. Oktober 2026 – Watch-Party: alle Videos

### ✨ Neu
- **Direkte Video-Links** in der Watch-Party: neben YouTube jetzt auch `.mp4`, `.webm` und `.m3u8`-Streams von beliebigen Seiten (HLS über `hls.js`, wo der Browser es nicht selbst kann) – synchron mit Play, Pause, Spulen und Warteschlange
- **Eigene Datei abspielen**: per Knopf oder per Drag & Drop auf den Player; die Datei wird nicht hochgeladen, jeder im Raum wählt seine eigene Kopie aus, synchronisiert wird nur der Abspielstand
- Links lassen sich ebenfalls auf den Player ziehen
- Ist YouTube blockiert (Werbeblocker), funktionieren direkte Videos und Dateien trotzdem

### 🔧 Technik
- Raumzustand und Warteschlange haben ein neues Feld `kind` (`yt` / `url` / `file`); der Server prüft je nach Art YouTube-ID, `http(s)`-Adresse oder Dateinamen
- Zweiter Player (`<video>`) neben dem YouTube-Player in `party.js`

### ⚠️ Grenzen
- Netflix, Disney+, Prime & Co. lassen sich nicht einbinden (Kopierschutz/Einbettungssperre) – es braucht einen direkten Link auf die Videodatei
- `.mkv` spielt nicht in jedem Browser

---

## 27. Oktober 2026 – Neue Werkzeuge

### ✨ Neu
- **Datei-Drop** (`/drop.html`): Dateien und Text per WebRTC direkt zwischen eigenen Geräten (ohne Nachfrage) und zu Freunden (mit Nachfrage) schicken
- **Watch-Party** (`/party.html`): Räume mit Code/Einladungslink, synchroner YouTube-Player, Trailer-Suche über TMDB, Warteschlange, Chat
- **Geheimlink** (`/secret.html`): AES-256-GCM-Verschlüsselung im Browser, Schlüssel nur im `#`-Teil des Links, Abruf löscht den Eintrag
- **Benachrichtigungen** (`/push.html`): Web-Push ohne Entwicklerkonto – bei Logins und Freundschaftsanfragen, Test-Button, Geräteverwaltung, Webhook für eigene Skripte
- **Server-Warnungen per Push** für Entwickler (`DEVELOPER_USERS`): Ausfall/Neustart, CPU/RAM > 90 %, Temperatur > 80 °C, Festplatte > 90 % – mit Entwarnung und 1 h Ruhezeit (`features/server-alerts.js`, eingehängt in `cockpit.js`)
- Startseite verlinkt die vier neuen Werkzeuge; App-Icons und Web-Manifest (für „Zum Home-Bildschirm“ auf dem iPhone)

### 🔧 Technik
- Neuer Ordner `features/` – `server.js` bindet ihn mit einer Zeile ein (plus je eine Zeile für Login- und Freundschafts-Benachrichtigung)
- Live-Kanal per Server-Sent Events mit Einmal-Tickets, damit das Login-Token nicht in URLs/Logs landet
- Neue Tabellen: `secrets`, `push_subscriptions`, `push_settings`, `app_config` (werden automatisch angelegt, löschen sich mit dem Konto)
- Neue Abhängigkeit: `web-push`

---

## 27. Oktober 2026 – Server-Cockpit

### 📊 Neu
- **Server-Cockpit** (`/cockpit.html`): CPU, RAM, Temperatur, Netzwerk und Festplatte als Live-Diagramme (5 / 15 / 60 Minuten), Kacheln mit Status, Tabellenansicht
- **Ausfall-Verlauf**: Lebenszeichen alle 30 s, Ausfälle und Neustarts werden beim Start erkannt; Verfügbarkeit der letzten 30 Tage
- Nur für Entwickler (`DEVELOPER_USERS` in `.env`); Kachel auf der Startseite erscheint nur für sie

---

## 27. Oktober 2026 – Aufräumen & GitHub

### 🛡️ Sicherheit
- **TMDB-Key aus dem Frontend entfernt** – alle TMDB-Anfragen laufen über den Server-Proxy (`tmdbFetch()` in `index.js`)
- Neuer Proxy-Endpunkt für Streaming-Anbieter: `/api/tmdb/:type/:id/watch/providers`
- `.env` kann verschlüsselt als `.env.gpg` ins Repo (`npm run env:encrypt` / `env:decrypt`)

### 🤝 Gleichzeitiges Bearbeiten
- **Watchlist** speichert mit Versionsnummer; bei Konflikten (Handy + PC) werden beide Stände zusammengeführt statt überschrieben
- **Geteilte Listen**: Einträge werden einzeln hinzugefügt/entfernt/kommentiert – kein Datenverlust mehr, wenn zwei Freunde gleichzeitig etwas ändern
- `PUT /api/shared-lists/:id` ändert nur noch den Namen

### 🛡️ XSS-Schutz
- `escapeHtml()` in `index.js`; Titel, Notizen, Genres, Anbieter usw. werden escaped
- Importierte und geladene Watchlist-Einträge werden geprüft (`sanitizeWatchlistItem`)
- Ranking und Freunde-Seite: Titel, Begründungen und Bild-URLs abgesichert
- Server lässt bei geteilten Listen nur gültige Keys (`movie_123`) und https-Bilder zu

### 🐛 Bugfixes
- Notiz-Dialog: „Speichern“-Button funktionierte wegen falscher Anführungszeichen nicht

### 💾 Backup
- `scripts/backup.js` + wöchentlicher Cronjob (Sonntag 03:30), behält 8 Sicherungen

### 🔧 Technik
- Git-Repo eingerichtet, `.gitignore` für `.env`, Datenbank und `node_modules`
- `sqlite3` auf Version 5 festgelegt (Version 6 läuft nicht mit Node 18)
- Ungenutztes Paket `nodemailer` entfernt
- `package.json` aufgeräumt, `README.md` hinzugefügt

---

## Version 3.0 - 23. März 2026 (Javis Cinema Edition)

### 🎨 Design - Cinema Vibe
- **Neon Glow Effects** – Buttons, Cards, Navigation leuchten bei Hover
- **Cinema Gradient Background** – Lila/Blau Verlauf mit radialen Akzenten
- **Glassmorphism verbessert** – Stärkere Blur-Effekte, bessere Transparenz
- **Gradient Headings** – Animierter Farbverlauf bei Überschriften
- **Star Glow Animation** – Favoriten-Sterne pulsieren sanft
- **Neon Progress Bars** – Leuchtende Fortschrittsanzeigen
- **Enhanced Loading States** – Shimmer-Animation mit Neon-Effekt
- **Cinema Scrollbar** – Neon-Gradient beim Scrollen

### 🛡️ Backend Verbesserungen
- **Server komplett neu formatiert** – Jetzt lesbar und wartbar!
- **Rate Limiting für TMDB API** – 40 Requests/10s pro User
- **Rate Limiting für Login** – Brute-Force Schutz (5 Versuche/15 Min)
- **Besseres Error Handling** – 429, 502 Status Codes
- **Referrer-Policy Header** – Zusätzlicher Security-Header
- **Hilfsfunktionen** – `fetchTmdb()` und `fetchAniList()` reduzieren Duplikate
- **User-Info bei Login** – `{ id, username, email }` wird zurückgegeben

### 📁 Neue Dateien
- `cinema-vibe.css` – Premium Design Addon
- `server.js.backup` – Backup der alten Version
- `public/index.js.backup` – Backup Frontend JS
- `public/index.css.backup` – Backup altes CSS

### 🔧 Technische Verbesserungen
- Saubere Code-Formatierung mit properen Einrückungen
- Konsistente Error-Responses
- Bessere Logging-Messages mit Emojis
- Graceful Shutdown verbessert

---

## Version 2.0 - 21. März 2026

### 🛡️ Security Verbesserungen
- **JWT Secret** jetzt aus `.env` Datei (nicht mehr hartcodiert)
- **CORS** eingeschränkt auf erlaubte Domains
- **Security Headers** hinzugefügt (XSS, Frame-Options, Content-Type)
- **bcrypt.compare** ist jetzt async (bessere Performance)
- **TMDB API Proxy** - API-Calls laufen über den Server (sicherer!)

### 🎮 Neue Features
- **Javis Easter Egg** - Chat mit mir! Tippe `chatWithJavis()` in der Console
- **Konami Code** - ↑↑↓↓←→←→BA für eine Überraschung! 🤖
- **Rate Limiting** - Login-Brute-Force Schutz (5 Versuche pro 15 Min)

### 📁 Neue Dateien
- `.env` - Environment Variables (JWT_SECRET, CORS_ORIGINS, TMDB_API_KEY)
- `.env.example` - Vorlage fürs Team/Git
- `CHANGELOG.md` - Diese Datei

### 🗑️ Entfernt
- TMDB API Key aus dem Frontend (war unsicher)

### 🐛 Bugfixes
- Server-Code formatiert und lesbar gemacht
- Login ist jetzt async (keine blocking calls mehr)

---

## Setup für Produktion

1. `.env` anpassen:
```
JWT_SECRET=<sicherer-zufälliger-string>
CORS_ORIGINS=https://deine-domain.de
TMDB_API_KEY=<dein-tmdb-key>
```

2. Server starten:
```bash
node server.js
```

3. Fertig! 🎉

---

Made with 💜 by Javis

# Watchlist App - Changelog 🎬

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

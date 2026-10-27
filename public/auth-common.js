// Gemeinsame Auth-/Token-Helfer für home.html, games.html, friends.html
// und die Ranking-Sektion. Wird vor den seiteneigenen Skripten geladen.
(function (global) {
  function getCookie(name) {
    const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return m ? m[2] : null;
  }

  function getToken() {
    return localStorage.getItem('auth_token')
      || sessionStorage.getItem('auth_token')
      || getCookie('auth_token');
  }

  function clearToken() {
    localStorage.removeItem('auth_token');
    sessionStorage.removeItem('auth_token');
    document.cookie = 'auth_token=;path=/;expires=Thu, 01 Jan 1970 00:00:00 GMT';
  }

  // Leitet zur Login-Seite weiter, wenn kein Token vorhanden ist.
  // Merkt sich die eigentlich gewünschte Seite (?next=...), damit man nach
  // dem Login direkt dort landet statt über ein Dashboard umgeleitet zu werden.
  // Gibt das Token zurück, wenn vorhanden, sonst null.
  function requireAuth() {
    const t = getToken();
    if (!t) {
      const here = window.location.pathname.split('/').pop() || '';
      const next = here && here !== 'index.html' ? '?next=' + encodeURIComponent(here) : '';
      window.location.href = 'index.html' + next;
      return null;
    }
    return t;
  }

  // Komfort-Wrapper für authentifizierte API-Aufrufe an /api/...
  async function api(path, token, options = {}) {
    options.headers = Object.assign(
      { 'Authorization': 'Bearer ' + token },
      options.headers || {}
    );
    if (options.body && typeof options.body !== 'string') {
      options.body = JSON.stringify(options.body);
      options.headers['Content-Type'] = 'application/json';
    }
    const res = await fetch('/api' + path, options);
    if (res.status === 401 || res.status === 403) {
      clearToken();
      window.location.href = 'index.html';
      throw new Error('Nicht angemeldet');
    }
    if (!res.ok) {
      let msg = 'API Fehler ' + res.status;
      try { const e = await res.json(); if (e.msg) msg = e.msg; } catch (_) {}
      throw new Error(msg);
    }
    return res.json();
  }

  global.Auth = { getCookie, getToken, clearToken, requireAuth, api };

  // Globaler Abmelden-Button unten rechts – erscheint auf jeder Seite,
  // die auth-common.js lädt, sofern ein Token vorhanden ist.
  function injectLogoutButton() {
    if (!getToken()) return;
    if (document.getElementById('global-logout-btn')) return;

    const style = document.createElement('style');
    style.textContent =
      '#global-logout-btn{position:fixed;bottom:16px;right:16px;z-index:1500;' +
      'padding:9px 16px;border:1px solid rgba(255,255,255,0.18);border-radius:999px;' +
      'cursor:pointer;font-size:0.88rem;font-weight:600;color:#fff;' +
      'background:rgba(20,22,30,0.85);backdrop-filter:blur(10px);' +
      'box-shadow:0 4px 16px rgba(0,0,0,0.45);' +
      'transition:transform 0.2s ease,background 0.2s ease;}' +
      '#global-logout-btn:hover{transform:translateY(-2px);' +
      'background:linear-gradient(135deg,#b91c1c,#dc2626);}' +
      '@media (max-width:1023px){#global-logout-btn{bottom:80px;}}';
    document.head.appendChild(style);

    const btn = document.createElement('button');
    btn.id = 'global-logout-btn';
    btn.type = 'button';
    btn.textContent = '🚪 Abmelden';
    btn.addEventListener('click', function () {
      clearToken();
      window.location.href = 'index.html';
    });
    document.body.appendChild(btn);
  }

  // Fixierter "Startseite"-Button oben links – auf jeder Seite, die auth-common.js
  // lädt (Watchlist, Games, Freunde). Bleibt beim Scrollen immer sichtbar.
  function injectHomeButton() {
    if (document.getElementById('global-home-btn')) return;

    const style = document.createElement('style');
    style.textContent =
      '#global-home-btn{position:fixed;top:14px;right:14px;z-index:1400;' +
      'display:inline-flex;align-items:center;gap:6px;' +
      'padding:9px 15px;border:1px solid rgba(244,237,228,0.16);border-radius:999px;' +
      'cursor:pointer;font-size:0.86rem;font-weight:600;color:#f4ede4;text-decoration:none;' +
      'background:rgba(20,18,15,0.6);backdrop-filter:blur(14px) saturate(140%);' +
      '-webkit-backdrop-filter:blur(14px) saturate(140%);' +
      'box-shadow:0 4px 16px rgba(0,0,0,0.35);' +
      'transition:transform 0.2s ease,border-color 0.2s ease,background 0.2s ease;}' +
      '#global-home-btn:hover{transform:translateY(-2px);' +
      'border-color:rgba(244,237,228,0.3);' +
      'background:linear-gradient(120deg,rgba(246,162,76,0.28),rgba(239,93,168,0.24));}' +
      // Etwas Platz oben schaffen, damit der Button keine Überschrift überdeckt
      '.games-app{padding-top:64px !important;}' +
      '.fr-app{padding-top:64px !important;}' +
      'main.content{padding-top:70px !important;}';
    document.head.appendChild(style);

    const btn = document.createElement('a');
    btn.id = 'global-home-btn';
    btn.href = '/';
    btn.innerHTML = '🏠 <span>Startseite</span>';
    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectLogoutButton);
    document.addEventListener('DOMContentLoaded', injectHomeButton);
  } else {
    injectLogoutButton();
    injectHomeButton();
  }

  // Übernimmt das auf der Startseite gewählte Hintergrundbild (falls vorhanden),
  // indem die CSS-Variable --wallpaper auf dem Body gesetzt wird. Games/Freunde
  // nutzen diese Variable im Body-Hintergrund; auf Seiten ohne entsprechende
  // CSS-Regel (z. B. der Watchlist) bleibt es wirkungslos.
  (function applySharedBackground() {
    try {
      const saved = localStorage.getItem('sathonet_bg_image');
      if (saved) document.body.style.setProperty('--wallpaper', 'url(' + saved + ')');
    } catch (e) {}
  })();
})(window);

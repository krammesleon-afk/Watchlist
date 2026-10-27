/* Aktiviert das Halo-Design (auth-theme.css) auf den Anmelde-Seiten.
   Muss im <head> stehen, damit die Klasse vor dem ersten Zeichnen gesetzt ist. */
(function () {
  var root = document.documentElement;
  root.classList.add('auth-halo');

  // Hintergrundbild und Verdunklungsstärke der Startseite übernehmen
  try {
    var wallpaper = localStorage.getItem('sathonet_bg_image');
    if (wallpaper) root.style.setProperty('--wallpaper', 'url("' + wallpaper + '")');
    var dim = localStorage.getItem('sathonet_bg_dim');
    if (dim !== null) root.style.setProperty('--bg-dim', dim);
  } catch (e) {}

  function onReady(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }

  onReady(function () {
    // Zurück zur Startseite – oben links. Nicht auf Seiten, die schon den
    // Startseiten-Button aus auth-common.js mitbringen (sonst doppelt).
    var hasCommonHomeBtn = !!document.querySelector('script[src*="auth-common"]');
    if (!hasCommonHomeBtn && !document.querySelector('.halo-home-link')) {
      var link = document.createElement('a');
      link.className = 'halo-home-link';
      link.href = '/';
      link.innerHTML = '🏠 <span>Startseite</span>';
      document.body.appendChild(link);
    }

    // Auf der Watchlist-Seite lebt der Login in der App: Halo nur so lange
    // zeigen, wie die Login-Karte sichtbar ist – danach übernimmt wieder
    // das Indigo-Design der App.
    var section = document.getElementById('auth-section');
    if (!section || !window.MutationObserver) return;

    var sync = function () {
      var visible = window.getComputedStyle(section).display !== 'none';
      root.classList.toggle('auth-halo', visible);
      document.body.classList.toggle('auth-screen', visible);
      var home = document.querySelector('.halo-home-link');
      if (home) home.style.display = visible ? '' : 'none';
      // Der "Passwort vergessen?"-Link liegt außerhalb der Login-Karte und
      // blieb deshalb auch nach dem Anmelden über der App stehen.
      var forgot = document.getElementById('forgot-password-link');
      if (forgot) forgot.style.display = visible ? 'block' : 'none';
    };

    sync();
    new MutationObserver(sync).observe(section, { attributes: true, attributeFilter: ['style', 'class'] });
  });
})();

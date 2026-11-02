// Wird von der Android-App in jede Seite eingefügt. Ein WebView kann
// Downloads von blob:- und data:-Links nicht selbst speichern, deshalb werden
// solche Klicks hier abgefangen und die Datei an die App übergeben.
(function () {
  if (window.__sathoNetApp || !window.SathoNetApp) return;
  window.__sathoNetApp = true;

  // Blobs merken, damit der Download auch klappt, wenn die Seite die URL
  // direkt nach dem Klick wieder freigibt (z. B. beim Watchlist-Export).
  var blobs = new Map();
  var create = URL.createObjectURL.bind(URL);
  var revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = function (obj) {
    var url = create(obj);
    if (obj instanceof Blob) blobs.set(url, obj);
    return url;
  };
  URL.revokeObjectURL = function (url) {
    setTimeout(function () { blobs.delete(url); }, 2000);
    return revoke(url);
  };

  function blobFor(href) {
    if (blobs.has(href)) return Promise.resolve(blobs.get(href));
    return fetch(href).then(function (r) { return r.blob(); });
  }

  function save(a) {
    var href = a.href || '';
    if (href.indexOf('blob:') !== 0 && href.indexOf('data:') !== 0) return false;
    var name = a.getAttribute('download') || 'download';
    blobFor(href)
      .then(function (blob) {
        return new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onload = function () { resolve([blob.type, reader.result]); };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      })
      .then(function (res) {
        var data = res[1];
        window.SathoNetApp.saveFile(name, res[0] || 'application/octet-stream', data.substring(data.indexOf(',') + 1));
      })
      .catch(function (err) { window.SathoNetApp.saveFailed(String(err)); });
    return true;
  }

  // Links im Dokument
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
    if (a && save(a)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }, true);

  // Links, die nur im Speicher erzeugt und per a.click() ausgelöst werden
  var click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (!this.isConnected && this.hasAttribute('download') && save(this)) return;
    return click.apply(this, arguments);
  };
})();

// Watchlist: Die Reiter-Leiste oben ist wischbar. Damit der aktive Reiter
// beim Scrollen durch die Abschnitte sichtbar bleibt, wird er mitgeführt.
(function () {
  if (window.__sathoNetNav) return;
  var nav = document.getElementById('sidebar-nav');
  if (!nav || !document.documentElement.classList.contains('sn-app')) return;
  window.__sathoNetNav = true;
  function follow() {
    var active = nav.querySelector('.menu-item.active');
    if (!active) return;
    var left = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
    nav.scrollTo({ left: Math.max(0, left), behavior: 'smooth' });
  }
  new MutationObserver(follow).observe(nav, { subtree: true, attributes: true, attributeFilter: ['class'] });
  follow();
})();

// Benachrichtigungen: Nach dem Login meldet sich die App beim Server an und
// bekommt einen eigenen Geräte-Schlüssel, mit dem sie im Hintergrund neue
// Benachrichtigungen abholt (features/app.js). Nach dem Abmelden auf der
// Webseite vergisst die App das Gerät wieder.
(function () {
  if (window.__sathoNetDevice || !window.SathoNetApp || !window.SathoNetApp.deviceUser) return;
  if (document.querySelector('meta[name=sn-offline]')) return; // Offline-Hinweis der App
  window.__sathoNetDevice = true;

  function readToken() {
    try {
      var t = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
      if (t) return t;
    } catch (e) {}
    var m = document.cookie.match(/(?:^|;\s*)auth_token=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function tokenUser(token) {
    try {
      var p = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (p.exp && p.exp * 1000 < Date.now()) return null;
      return p.username || null;
    } catch (e) { return null; }
  }

  var app = window.SathoNetApp;
  var token = readToken();
  var user = token && tokenUser(token);
  var registered = app.deviceUser(); // "" = kein Gerät

  if (!token) {
    if (registered) app.clearDevice();
    return;
  }
  if (!user || user === registered) return; // abgelaufen bzw. schon angemeldet

  fetch('/api/app/device', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ label: app.deviceLabel() }),
  })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) { if (d && d.deviceToken) app.setDevice(d.deviceToken, d.username || user); })
    .catch(function () {});
})();

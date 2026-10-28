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

// Wird von der Android-App so früh wie möglich in jede Seite eingefügt
// (vor dem ersten Zeichnen, wenn das WebView es kann). Hängt das
// Handy-Stylesheet app-mobile.css an die Seite und markiert sie mit
// html.sn-app und data-sn-page, damit die Regeln greifen.
// Die App setzt davor: var __snCss = "…Inhalt von app-mobile.css…";
(function (css) {
  if (window.__sathoNetStyle) return;
  window.__sathoNetStyle = true;

  var page = location.pathname.replace(/^\/+/, '').replace(/\.html$/, '') || 'landing';

  function apply(root) {
    root.classList.add('sn-app');
    root.setAttribute('data-sn-page', page);
    if (document.getElementById('sn-app-style')) return;
    var style = document.createElement('style');
    style.id = 'sn-app-style';
    style.textContent = css;
    // Ans Ende des <head>, sobald er da ist, damit die Regeln nach den
    // Stylesheets der Seite kommen; bis dahin direkt am <html>.
    (document.head || root).appendChild(style);
    if (!document.head) {
      document.addEventListener('DOMContentLoaded', function () {
        document.head.appendChild(style);
      });
    }
  }

  if (document.documentElement) {
    apply(document.documentElement);
  } else {
    new MutationObserver(function (_, obs) {
      if (!document.documentElement) return;
      obs.disconnect();
      apply(document.documentElement);
    }).observe(document, { childList: true });
  }
})(typeof __snCss === 'string' ? __snCss : '');

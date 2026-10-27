/* =============================================================
   Regler für die Hintergrund-Verdunklung (Games, Freunde, Werkzeugkasten)

   Der Wert steht in localStorage unter "sathonet_bg_dim" und wird als
   CSS-Variable --bg-dim gesetzt; die Seiten koppeln ihre Abdunklung
   per calc() daran. 0 = Bild unangetastet, 0.8 = Standard, 1 = dunkel.

   Muss im <head> stehen (ohne defer), damit der Wert vor dem ersten
   Zeichnen gesetzt ist und die Seite nicht kurz aufblitzt.

   Die Startseite bringt ihren eigenen Regler in der oberen Leiste mit;
   die Watchlist-App hat keinen Bildhintergrund und bleibt außen vor.
   ============================================================= */
(function (global) {
  'use strict';

  var KEY = 'sathonet_bg_dim';
  var STANDARD = '0.8';
  var root = document.documentElement;

  function lesen() {
    try { return localStorage.getItem(KEY) || STANDARD; } catch (e) { return STANDARD; }
  }

  function anwenden(wert) {
    root.style.setProperty('--bg-dim', wert);
  }

  // Sofort anwenden – noch bevor der Body existiert
  anwenden(lesen());

  function stileEinfuegen() {
    if (document.getElementById('bg-dim-style')) return;
    var style = document.createElement('style');
    style.id = 'bg-dim-style';
    style.textContent =
      '#bg-dim-control{position:fixed;left:16px;bottom:16px;z-index:1400;' +
      'display:inline-flex;align-items:center;gap:9px;padding:8px 14px 8px 12px;' +
      'border-radius:999px;border:1px solid rgba(244,237,228,0.16);' +
      'background:rgba(20,18,15,0.6);backdrop-filter:blur(14px) saturate(140%);' +
      '-webkit-backdrop-filter:blur(14px) saturate(140%);' +
      'box-shadow:0 4px 16px rgba(0,0,0,0.35);cursor:pointer;' +
      'transition:border-color 0.2s ease,background 0.2s ease;}' +
      '#bg-dim-control:hover{border-color:rgba(244,237,228,0.3);background:rgba(20,18,15,0.78);}' +
      '#bg-dim-control .bg-dim-ico{display:inline-flex;color:#b9ada0;}' +
      '#bg-dim-control .bg-dim-ico .ic{width:15px;height:15px;}' +
      '#bg-dim-range{-webkit-appearance:none;appearance:none;width:84px;height:4px;' +
      'border-radius:999px;background:linear-gradient(90deg,#f6a24c,#ef5da8);outline:none;cursor:pointer;}' +
      '#bg-dim-range::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:13px;height:13px;' +
      'border-radius:50%;background:#f4ede4;border:none;box-shadow:0 1px 5px rgba(0,0,0,0.5);cursor:grab;}' +
      '#bg-dim-range::-moz-range-thumb{width:13px;height:13px;border-radius:50%;background:#f4ede4;' +
      'border:none;box-shadow:0 1px 5px rgba(0,0,0,0.5);cursor:grab;}' +
      '#bg-dim-range:focus-visible{outline:2px solid #f6a24c;outline-offset:4px;}' +
      '@media (max-width:700px){#bg-dim-range{width:60px;}}';
    document.head.appendChild(style);
  }

  function reglerEinfuegen() {
    if (document.getElementById('bg-dim-control')) return;
    stileEinfuegen();

    var label = document.createElement('label');
    label.id = 'bg-dim-control';
    label.title = 'Hintergrund heller oder dunkler stellen';

    // Mond-Symbol: das Icon-Set füllt den Platzhalter, sonst bleibt er leer
    var ico = document.createElement('span');
    ico.className = 'bg-dim-ico';
    ico.setAttribute('data-ic', 'moon');

    var range = document.createElement('input');
    range.type = 'range';
    range.id = 'bg-dim-range';
    range.min = '0';
    range.max = '1';
    range.step = '0.05';
    range.value = lesen();
    range.setAttribute('aria-label', 'Verdunklung des Hintergrunds');

    function titelSetzen() {
      label.title = 'Verdunklung: ' + Math.round(parseFloat(range.value) * 100) +
                    ' % · Doppelklick setzt auf Standard zurück';
    }
    titelSetzen();

    range.addEventListener('input', function () { anwenden(range.value); titelSetzen(); });
    // Erst beim Loslassen speichern, nicht bei jeder Mausbewegung
    range.addEventListener('change', function () {
      try { localStorage.setItem(KEY, range.value); } catch (e) {}
    });
    // Notausgang, falls man sich verstellt hat
    label.addEventListener('dblclick', function () {
      range.value = STANDARD;
      anwenden(STANDARD);
      titelSetzen();
      try { localStorage.setItem(KEY, STANDARD); } catch (e) {}
    });

    label.appendChild(ico);
    label.appendChild(range);
    document.body.appendChild(label);

    if (global.Icons && global.Icons.fill) global.Icons.fill(label);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reglerEinfuegen);
  } else {
    reglerEinfuegen();
  }

  global.BgDim = { get: lesen, set: anwenden };
})(window);

/* =============================================================
   Icon-Set für Satho-Net
   Ersetzt die Emojis der Oberfläche durch einheitliche Strich-Icons.

   Funktionsweise: Alle Icons liegen einmal als <symbol> im Dokument,
   eingebunden werden sie über <svg class="ic"><use href="#ic-…">.
   Ein Beobachter ersetzt bekannte Emojis in Textknoten – auch in
   Inhalten, die erst später per JavaScript entstehen (Karten,
   Menüs, Meldungen). Nicht zugeordnete Emojis bleiben stehen.

   Zum Abschalten genügt es, icons.js/icons.css aus den Seiten zu nehmen.
   ============================================================= */
(function (global) {
  'use strict';

  // ---- Icon-Formen (24×24, Strich; gefüllte Teile tragen fill="currentColor") ----
  var ICONS = {
    tv: '<rect x="2.5" y="7" width="19" height="13" rx="2.2"/><path d="M7.5 3l4.5 4 4.5-4"/>',
    film: '<rect x="2.5" y="4" width="19" height="16" rx="2.2"/><path d="M7.5 4v16M16.5 4v16M2.5 12h19M2.5 8h5M2.5 16h5M16.5 8h5M16.5 16h5"/>',
    gamepad: '<rect x="2.5" y="7.5" width="19" height="10.5" rx="4"/><path d="M7 10.8v3.4M5.3 12.5h3.4"/><circle cx="15.6" cy="11.4" r="1.05" fill="currentColor" stroke="none"/><circle cx="18" cy="14" r="1.05" fill="currentColor" stroke="none"/>',
    users: '<circle cx="9.2" cy="8.2" r="3.4"/><path d="M2.8 20c0-3.5 2.9-5.4 6.4-5.4s6.4 1.9 6.4 5.4"/><path d="M16.4 5.4a3.3 3.3 0 0 1 0 6.4M18 14.9c2.1.6 3.2 2 3.2 4.3"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4.2 20.5c0-4 3.5-6 7.8-6s7.8 2 7.8 6"/>',
    search: '<circle cx="10.8" cy="10.8" r="6.8"/><path d="M15.8 15.8L21 21"/>',
    star: '<path d="M12 3.2l2.65 5.5 5.9.85-4.3 4.25 1.05 6.05L12 17l-5.3 2.85 1.05-6.05-4.3-4.25 5.9-.85z"/>',
    starFilled: '<path d="M12 3.2l2.65 5.5 5.9.85-4.3 4.25 1.05 6.05L12 17l-5.3 2.85 1.05-6.05-4.3-4.25 5.9-.85z" fill="currentColor"/>',
    target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r="1.15" fill="currentColor" stroke="none"/>',
    bulb: '<path d="M9.6 18.6h4.8M10.6 21.4h2.8"/><path d="M12 2.6a6.2 6.2 0 0 0-3.7 11.2c.5.4.8 1 .8 1.6v.3h5.8v-.3c0-.6.3-1.2.8-1.6A6.2 6.2 0 0 0 12 2.6z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2.4"/><path d="M8 2.6v4.8M16 2.6v4.8M3 10.2h18"/>',
    chartBar: '<path d="M3 20.6h18"/><path d="M6.5 20V12.5M12 20V4.8M17.5 20V9.4"/>',
    chartLine: '<path d="M3.4 20.6h17.2"/><path d="M5.5 16.4l4.6-4.6 3.4 3.4L20 8.4"/><path d="M20 12.4V8.4h-4"/>',
    sliders: '<path d="M5 21v-6.4M5 10.4V3M12 21v-8.6M12 8.2V3M19 21v-4.4M19 12.2V3"/><path d="M2.6 14.6h4.8M9.6 12.4h4.8M16.6 16.6h4.8"/>',
    home: '<path d="M3.4 10.6L12 3.4l8.6 7.2"/><path d="M5.6 9.8v10.8h12.8V9.8"/><path d="M9.8 20.6v-5.4h4.4v5.4"/>',
    logout: '<path d="M9.6 3.6H6a2 2 0 0 0-2 2v12.8a2 2 0 0 0 2 2h3.6"/><path d="M15.4 8l4 4-4 4M19.4 12H9.2"/>',
    image: '<rect x="3" y="4.6" width="18" height="14.8" rx="2.4"/><circle cx="8.6" cy="9.6" r="1.6"/><path d="M3.6 17.4l4.9-4.4 3.5 3 3.1-2.5 5.4 4.6"/>',
    check: '<path d="M4.6 12.6l5 5 9.8-10.6"/>',
    checkCircle: '<circle cx="12" cy="12" r="8.6"/><path d="M8 12.4l2.8 2.8L16.2 9.4"/>',
    eye: '<path d="M2.6 12S6.2 6 12 6s9.4 6 9.4 6-3.6 6-9.4 6-9.4-6-9.4-6z"/><circle cx="12" cy="12" r="2.6"/>',
    plus: '<path d="M12 5.2v13.6M5.2 12h13.6"/>',
    trash: '<path d="M4 6.6h16M9.4 6.6V4.4h5.2v2.2"/><path d="M6.6 6.6l.9 12.9a1.6 1.6 0 0 0 1.6 1.5h5.8a1.6 1.6 0 0 0 1.6-1.5l.9-12.9"/><path d="M10 10.4v7M14 10.4v7"/>',
    save: '<path d="M5 4.6h10.4l4 4V19a1.6 1.6 0 0 1-1.6 1.6H5A1.6 1.6 0 0 1 3.4 19V6.2A1.6 1.6 0 0 1 5 4.6z"/><path d="M8 4.6v5h7v-5M8 20.6v-5.4h8v5.4"/>',
    refresh: '<path d="M20.4 12a8.4 8.4 0 1 1-2.6-6.1"/><path d="M20.6 4.4v5.6H15"/>',
    upload: '<path d="M12 16V4.6M8.2 8.2L12 4.6l3.8 3.6"/><path d="M4.6 15v3.6a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2V15"/>',
    download: '<path d="M12 4.2v11.4M8.2 12L12 15.6 15.8 12"/><path d="M4.6 15.6v3a2 2 0 0 0 2 2h10.8a2 2 0 0 0 2-2v-3"/>',
    clipboard: '<rect x="5" y="4.6" width="14" height="16" rx="2"/><rect x="9" y="2.6" width="6" height="4" rx="1.3"/><path d="M9 11.4h6M9 15.4h4"/>',
    info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11.2v5.4"/><circle cx="12" cy="7.9" r="1.05" fill="currentColor" stroke="none"/>',
    pencil: '<path d="M4.2 19.8l1-4.4L15.9 4.7a2.1 2.1 0 0 1 3 3L8.6 18.8z"/><path d="M14.4 6.4l3.2 3.2"/>',
    trophy: '<path d="M8 3.8h8v5.1a4 4 0 0 1-8 0z"/><path d="M8 5.4H5.4v1.4a3 3 0 0 0 3 3M16 5.4h2.6v1.4a3 3 0 0 1-3 3"/><path d="M12 12.9v3.7M8.6 20.4h6.8M10 16.6h4"/>',
    box: '<path d="M3.6 7.6L12 3.6l8.4 4v8.8L12 20.4l-8.4-4z"/><path d="M3.6 7.6L12 11.6l8.4-4M12 11.6v8.8"/>',
    bookmark: '<path d="M6.6 3.6h10.8v17l-5.4-3.9-5.4 3.9z"/>',
    moon: '<path d="M20 14.6A8.6 8.6 0 0 1 9.4 4a8.6 8.6 0 1 0 10.6 10.6z"/>',
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.5M12 18.9v2.5M2.6 12h2.5M18.9 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M18.7 5.3l-1.8 1.8M7.1 16.9l-1.8 1.8"/>',
    rocket: '<path d="M12 2.6c3 2.1 4.7 5.4 4.7 9.1l-1.5 4.2H8.8l-1.5-4.2c0-3.7 1.7-7 4.7-9.1z"/><path d="M8.8 15.9l-2.4 2.7 2.1.6.7 2.2 2-2.4M15.2 15.9l2.4 2.7-2.1.6-.7 2.2-2-2.4"/><circle cx="12" cy="9.8" r="1.7"/>',
    link: '<path d="M10.2 13.4a4.2 4.2 0 0 0 5.9 0l2.5-2.5a4.2 4.2 0 0 0-5.9-5.9l-1.3 1.3"/><path d="M13.8 10.6a4.2 4.2 0 0 0-5.9 0l-2.5 2.5a4.2 4.2 0 0 0 5.9 5.9l1.3-1.3"/>',
    x: '<path d="M6.2 6.2l11.6 11.6M17.8 6.2L6.2 17.8"/>',
    xCircle: '<circle cx="12" cy="12" r="8.6"/><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6"/>',
    warning: '<path d="M12 3.6l8.8 15.2a1 1 0 0 1-.9 1.5H4.1a1 1 0 0 1-.9-1.5z"/><path d="M12 9.4v4.4"/><circle cx="12" cy="16.9" r="1.05" fill="currentColor" stroke="none"/>',
    hourglass: '<path d="M7 3.6h10M7 20.4h10"/><path d="M8.2 3.6v3.1c0 2 3.8 3.6 3.8 5.3s-3.8 3.3-3.8 5.3v3.1M15.8 3.6v3.1c0 2-3.8 3.6-3.8 5.3s3.8 3.3 3.8 5.3v3.1"/>',
    play: '<path d="M8.2 5.4l10 6.6-10 6.6z"/>',
    pause: '<path d="M9.2 5.2v13.6M14.8 5.2v13.6"/>',
    skip: '<path d="M6.2 5.4l9 6.6-9 6.6z"/><path d="M18 5.4v13.2"/>',
    clock: '<circle cx="12" cy="12.6" r="8"/><path d="M12 8.2v4.6l2.9 2M9 2.6h6"/>',
    heart: '<path d="M12 20.2s-7.6-4.7-7.6-9.6A4.2 4.2 0 0 1 12 8.2a4.2 4.2 0 0 1 7.6 2.4c0 4.9-7.6 9.6-7.6 9.6z"/>',
    message: '<path d="M20.6 15.8a2 2 0 0 1-2 2H8.2L4 21.4V6a2 2 0 0 1 2-2h12.6a2 2 0 0 1 2 2z"/>',
    folder: '<path d="M3.4 7a2 2 0 0 1 2-2h3.7l2 2.6h7.5a2 2 0 0 1 2 2v8.8a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2z"/>',
    sparkles: '<path d="M10 3.4l1.6 4.2 4.2 1.6-4.2 1.6L10 15l-1.6-4.2L4.2 9.2l4.2-1.6z"/><path d="M17.6 14.2l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z"/>',
    palette: '<path d="M12 3.4a8.6 8.6 0 0 0 0 17.2c1.5 0 2.1-1 2.1-1.9 0-1.3-1.1-1.8-1.1-2.8 0-.9.7-1.6 1.7-1.6h1.6a4.4 4.4 0 0 0 4.3-4.4c0-3.7-3.8-6.5-8.6-6.5z"/><circle cx="8.2" cy="11" r="1.15" fill="currentColor" stroke="none"/><circle cx="12" cy="7.9" r="1.15" fill="currentColor" stroke="none"/><circle cx="16" cy="10" r="1.15" fill="currentColor" stroke="none"/>',
    dice: '<rect x="4" y="4" width="16" height="16" rx="3.2"/><circle cx="9" cy="9" r="1.25" fill="currentColor" stroke="none"/><circle cx="15" cy="15" r="1.25" fill="currentColor" stroke="none"/>',
    robot: '<rect x="3.8" y="8" width="16.4" height="12" rx="3.2"/><path d="M12 4.6V8"/><circle cx="12" cy="3.4" r="1.15" fill="currentColor" stroke="none"/><circle cx="9" cy="13.4" r="1.3" fill="currentColor" stroke="none"/><circle cx="15" cy="13.4" r="1.3" fill="currentColor" stroke="none"/><path d="M9.6 17h4.8"/>',
    wallet: '<path d="M3.6 8.4a2 2 0 0 1 2-2h12.8a2 2 0 0 1 2 2v9.2a2 2 0 0 1-2 2H5.6a2 2 0 0 1-2-2z"/><path d="M3.6 9.6h13.2v5.6H3.6"/><circle cx="16.6" cy="12.4" r="1.15" fill="currentColor" stroke="none"/>',
    flag: '<path d="M5.2 21V3.4"/><path d="M5.2 4.6h11.4l-2.1 3.6 2.1 3.6H5.2z"/>',
    circle: '<circle cx="12" cy="12" r="8"/>',
    undo: '<path d="M9.2 6.8L4.6 11.4l4.6 4.6"/><path d="M4.6 11.4h9.6a5.4 5.4 0 0 1 0 10.8h-2.8"/>',
    books: '<path d="M4.4 4.4h4v15.2h-4z"/><path d="M9.6 4.4h4v15.2h-4z"/><path d="M15 5.4l3.9.9-3.1 14.1-3.3-.8"/>',
    tag: '<path d="M3.6 11.6V4.4h7.2l9.2 9.2-7.2 7.2z"/><circle cx="7.9" cy="7.9" r="1.45" fill="currentColor" stroke="none"/>',
    help: '<circle cx="12" cy="12" r="8.6"/><path d="M9.6 9.5a2.5 2.5 0 1 1 3.2 2.5c-.6.2-.8.6-.8 1.2v.5"/><circle cx="12" cy="16.4" r="1.05" fill="currentColor" stroke="none"/>',
    arrowLeft: '<path d="M19 12H5.2M10.8 6L4.8 12l6 6"/>',
    arrowRight: '<path d="M5 12h13.8M13.2 6l6 6-6 6"/>',
    arrowUp: '<path d="M12 19V5.2M6 10.8L12 4.8l6 6"/>',
    arrowDown: '<path d="M12 5v13.8M6 13.2l6 6 6-6"/>',
    arrowUpRight: '<path d="M6.6 17.4L17.4 6.6M8.2 6.6h9.2v9.2"/>',
    cloud: '<path d="M7.2 18.6h9.4a4.3 4.3 0 0 0 .5-8.6 6.1 6.1 0 0 0-11.5 1 3.9 3.9 0 0 0 1.6 7.6z"/>',
    cloudSun: '<circle cx="7.6" cy="7.2" r="2.8"/><path d="M7.6 2.4v1.4M2.8 7.2h1.4M4.2 3.8l1 1M11 3.8l-1 1"/><path d="M10.4 19.6h7.2a3.7 3.7 0 0 0 .4-7.4 5.3 5.3 0 0 0-10-.9 3.4 3.4 0 0 0 2.4 8.3z"/>',
    cloudRain: '<path d="M7.4 15.4h9a4 4 0 0 0 .5-8 5.8 5.8 0 0 0-10.9.9 3.7 3.7 0 0 0 1.4 7.1z"/><path d="M8.6 18.4l-1 2.6M12 18.4l-1 2.6M15.4 18.4l-1 2.6"/>',
    cloudLightning: '<path d="M7.4 15.4h9a4 4 0 0 0 .5-8 5.8 5.8 0 0 0-10.9.9 3.7 3.7 0 0 0 1.4 7.1z"/><path d="M13 17.4l-2.6 3.4h3l-1.4 2.2"/>',
    cloudSnow: '<path d="M7.4 15.4h9a4 4 0 0 0 .5-8 5.8 5.8 0 0 0-10.9.9 3.7 3.7 0 0 0 1.4 7.1z"/><path d="M9 19h.01M12 20.6h.01M15 19h.01"/>',
    fog: '<path d="M4 8.6h16M6 12.4h12M4 16.2h13M7 20h10"/>',
    shield: '<path d="M12 3.2l7.2 2.7v5.3c0 4.3-2.9 8.3-7.2 9.6-4.3-1.3-7.2-5.3-7.2-9.6V5.9z"/><path d="M9.2 12.1l2.1 2.1 4.1-4.4"/>',
    terminal: '<rect x="2.6" y="4.4" width="18.8" height="15.2" rx="2.4"/><path d="M6.9 9.4l3 2.6-3 2.6M12.8 15.1h4.4"/>',
    wifi: '<path d="M2.8 9.3a13.6 13.6 0 0 1 18.4 0M6 12.9a9 9 0 0 1 12 0M9.2 16.5a4.6 4.6 0 0 1 5.6 0"/><circle cx="12" cy="19.6" r="1.15" fill="currentColor" stroke="none"/>',
    hardDrive: '<rect x="2.6" y="12.6" width="18.8" height="7" rx="2"/><path d="M5.7 12.6l2.5-7.1a2 2 0 0 1 1.9-1.4h3.8a2 2 0 0 1 1.9 1.4l2.5 7.1"/><circle cx="17.4" cy="16.1" r="1.15" fill="currentColor" stroke="none"/>',
    bookOpen: '<path d="M12 6.6C10.4 5 8.2 4.4 4.4 4.4v13c3.8 0 6 .6 7.6 2.2 1.6-1.6 3.8-2.2 7.6-2.2v-13c-3.8 0-6 .6-7.6 2.2z"/><path d="M12 6.6v13.2"/>',
    wrench: '<path d="M17.4 2.9a5.5 5.5 0 0 0-5.1 7.4L4 18.6a2.1 2.1 0 0 0 3 3l8.3-8.3a5.5 5.5 0 0 0 7.4-5.1c0-.7-.1-1.3-.4-1.9l-3 3-2.7-.7-.7-2.7 3-3c-.6-.3-1.2-.4-1.9-.4z"/>',
    thermometer: '<path d="M13.8 13.6V5.2a2.4 2.4 0 0 0-4.8 0v8.4a4.2 4.2 0 1 0 4.8 0z"/><circle cx="11.4" cy="17.2" r="1.6" fill="currentColor" stroke="none"/>',
  };

  // ---- Emoji → Icon ----
  var MAP = {
    '📺': 'tv', '🎬': 'film', '🎞': 'film', '🎮': 'gamepad', '👥': 'users', '🤝': 'users',
    '👤': 'user', '🔍': 'search', '⭐': 'starFilled', '★': 'starFilled', '☆': 'star',
    '🌟': 'starFilled', '🎯': 'target', '💡': 'bulb', '📅': 'calendar', '🗓': 'calendar',
    '📊': 'chartBar', '📈': 'chartLine', '⚙️': 'sliders', '🏠': 'home', '🚪': 'logout',
    '🖼️': 'image', '🎨': 'palette', '✅': 'checkCircle', '✓': 'check', '☑️': 'checkCircle',
    '👁️': 'eye', '➕': 'plus', '🗑️': 'trash', '💾': 'save', '🔄': 'refresh', '↻': 'refresh',
    '📤': 'upload', '📥': 'download', '📋': 'clipboard', 'ℹ️': 'info', '📝': 'pencil',
    '🏆': 'trophy', '📦': 'box', '🔖': 'bookmark', '🌙': 'moon', '🌑': 'moon', '😴': 'moon',
    '☀️': 'sun', '🚀': 'rocket', '🔗': 'link', '❌': 'xCircle', '✕': 'x', '✖': 'x',
    '⚠️': 'warning', '⏳': 'hourglass', '⏱️': 'clock', '▶️': 'play', '▶': 'play',
    '⏸️': 'pause', '⏭️': 'skip', '❤️': 'heart', '💬': 'message', '🗂️': 'folder',
    '✨': 'sparkles', '🎉': 'sparkles', '🎆': 'sparkles', '🎲': 'dice', '🤖': 'robot',
    '💰': 'wallet', '🎌': 'flag', '⭕': 'circle', '↩️': 'undo', '📚': 'books',
    '🎭': 'tag', '🆘': 'help', '👌': 'checkCircle',
    '←': 'arrowLeft', '→': 'arrowRight', '↑': 'arrowUp', '↓': 'arrowDown', '↗': 'arrowUpRight',
    '☁️': 'cloud', '⛅': 'cloudSun', '🌤️': 'cloudSun', '🌥️': 'cloud', '🌦️': 'cloudRain',
    '🌧️': 'cloudRain', '⛈️': 'cloudLightning', '🌨️': 'cloudSnow', '🌫️': 'fog', '🌡️': 'thermometer',
  };

  // Zeichen, die ersetzt werden – nach Länge sortiert, damit Varianten
  // mit Selektor (z. B. "⚙️") vor der Grundform greifen.
  var CHARS = Object.keys(MAP).sort(function (a, b) { return b.length - a.length; });
  var SPLIT_RE = new RegExp('(' + CHARS.map(function (c) {
    return c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('|') + ')');

  var SKIP_TAGS = {
    SCRIPT: 1, STYLE: 1, TEXTAREA: 1, INPUT: 1, OPTION: 1, SELECT: 1,
    TITLE: 1, CODE: 1, PRE: 1, SVG: 1, svg: 1,
  };

  var spriteReady = false;
  var busy = false;

  function buildSprite() {
    if (spriteReady) return;
    var parts = ['<svg xmlns="http://www.w3.org/2000/svg" style="display:none" aria-hidden="true">'];
    Object.keys(ICONS).forEach(function (name) {
      parts.push('<symbol id="ic-' + name + '" viewBox="0 0 24 24">' + ICONS[name] + '</symbol>');
    });
    parts.push('</svg>');
    var host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    host.innerHTML = parts.join('');
    document.body.insertBefore(host, document.body.firstChild);
    spriteReady = true;
  }

  function iconEl(name) {
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'ic');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    var use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#ic-' + name);
    svg.appendChild(use);
    return svg;
  }

  // Markup-Variante für Stellen, die HTML-Strings zusammensetzen
  function markup(name, cls) {
    if (!ICONS[name]) return '';
    return '<svg class="ic ' + (cls || '') + '" aria-hidden="true" focusable="false"><use href="#ic-' + name + '"></use></svg>';
  }

  // Statisches HTML kann ein Icon über <span data-ic="name"></span> anfordern.
  function fillPlaceholders(root) {
    var nodes = (root && root.querySelectorAll) ? root.querySelectorAll('[data-ic]') : [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var name = el.getAttribute('data-ic');
      if (!ICONS[name] || el.firstElementChild) continue;
      el.appendChild(iconEl(name));
    }
  }

  function shouldSkip(el) {
    while (el && el.nodeType === 1) {
      if (SKIP_TAGS[el.tagName] || el.hasAttribute('data-no-icons')) return true;
      if (el.namespaceURI === 'http://www.w3.org/2000/svg') return true;
      el = el.parentNode;
    }
    return false;
  }

  function replaceIn(root) {
    if (!root || busy) return;
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        if (!node.nodeValue || !SPLIT_RE.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        if (shouldSkip(node.parentNode)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    var targets = [];
    var n;
    while ((n = walker.nextNode())) targets.push(n);
    if (!targets.length) return;

    busy = true;
    targets.forEach(function (node) {
      var parts = node.nodeValue.split(SPLIT_RE);
      var frag = document.createDocumentFragment();
      parts.forEach(function (part) {
        if (!part) return;
        if (MAP[part]) frag.appendChild(iconEl(MAP[part]));
        else frag.appendChild(document.createTextNode(part));
      });
      if (node.parentNode) node.parentNode.replaceChild(frag, node);
    });
    busy = false;
  }

  function start() {
    buildSprite();
    fillPlaceholders(document.body);
    replaceIn(document.body);

    if (!global.MutationObserver) return;
    var pending = [];
    var scheduled = false;

    var observer = new MutationObserver(function (records) {
      if (busy) return;
      records.forEach(function (r) {
        if (r.type === 'characterData') { if (r.target.parentNode) pending.push(r.target.parentNode); }
        else {
          for (var i = 0; i < r.addedNodes.length; i++) {
            var node = r.addedNodes[i];
            if (node.nodeType === 1) pending.push(node);
            else if (node.nodeType === 3 && node.parentNode) pending.push(node.parentNode);
          }
        }
      });
      if (!pending.length || scheduled) return;
      scheduled = true;
      requestAnimationFrame(function () {
        scheduled = false;
        var list = pending.slice();
        pending.length = 0;
        list.forEach(function (el) {
          if (el && el.isConnected === false) return;
          fillPlaceholders(el);
          replaceIn(el);
        });
      });
    });

    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  global.Icons = { markup: markup, apply: replaceIn, fill: fillPlaceholders, names: Object.keys(ICONS) };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);

// Kleine Helfer für die Satho-Net-Werkzeugseiten (Drop, Watch-Party,
// Geheimlinks, Push): Hintergrundbild, Toast-Meldungen, HTML-Escaping.
(function (global) {
  try {
    var wallpaper = localStorage.getItem('sathonet_bg_image');
    if (wallpaper) document.documentElement.style.setProperty('--wallpaper', 'url("' + wallpaper + '")');
  } catch (e) {}

  var toastTimer = null;
  function toast(msg, isError) {
    var el = document.getElementById('satho-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'satho-toast';
      el.className = 'toast';
      el.setAttribute('role', 'status');
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.toggle('err', !!isError);
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, 3500);
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
    return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast('In die Zwischenablage kopiert');
    } catch (e) {
      window.prompt('Zum Kopieren:', text);
    }
  }

  global.Satho = { toast: toast, escapeHtml: escapeHtml, formatBytes: formatBytes, copyText: copyText };
})(window);

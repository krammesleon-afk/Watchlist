// Push-Einstellungen: dieses Gerät an-/abmelden, Ereignisse wählen,
// Webhook-Adresse für eigene Skripte anzeigen.
(function () {
  const token = Auth.requireAuth();
  if (!token) return;

  const { toast, escapeHtml, copyText } = Satho;
  const $ = (id) => document.getElementById(id);
  const api = (path, opts) => Auth.api(path, token, opts);

  const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  // Android-App: kein Web-Push im WebView, die App holt die Benachrichtigungen
  // selbst ab (features/app.js). Die App stellt dafür window.SathoNetApp bereit.
  const nativeApp = window.SathoNetApp && typeof window.SathoNetApp.notificationState === 'function' ? window.SathoNetApp : null;

  let registration = null;
  let subscription = null;

  function setStatus(ico, title, sub) {
    $('status-ico').textContent = ico;
    $('status-title').textContent = title;
    $('status-sub').textContent = sub || '';
  }

  function urlBase64ToUint8Array(base64) {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }

  function refreshAppStatus() {
    const state = nativeApp.notificationState();
    const btn = $('toggle-btn');
    btn.classList.remove('ghost');
    btn.disabled = false;
    btn.classList.toggle('hidden', state === 'on' || state === 'nodevice');
    if (state === 'on') {
      setStatus('🔔', 'In der App aktiv', 'Die App schaut regelmäßig nach – auch wenn sie geschlossen ist (je nach Akku-Sparmodus mit etwas Verzögerung).');
    } else if (state === 'blocked') {
      setStatus('🚫', 'Benachrichtigungen sind blockiert', 'Erlaube sie in den Android-Einstellungen für Satho-Net.');
      btn.textContent = 'Einstellungen';
    } else if (state === 'nodevice') {
      setStatus('⏳', 'App wird angemeldet …', 'Einen Moment.');
    } else {
      setStatus('🔕', 'In der App aus', 'Erlaube der App, dir Benachrichtigungen zu zeigen.');
      btn.textContent = 'Erlauben';
    }
  }

  async function refreshStatus() {
    if (nativeApp) return refreshAppStatus();
    if (!supported) {
      if (isIOS && !isStandalone) {
        $('ios-hint').classList.remove('hidden');
        setStatus('📱', 'Erst zum Home-Bildschirm hinzufügen', 'Siehe Anleitung oben.');
      } else {
        setStatus('🚫', 'Dieser Browser kann keine Push-Benachrichtigungen', 'Probier Chrome, Edge, Firefox oder Safari.');
      }
      return;
    }
    registration = await navigator.serviceWorker.register('/sw.js');
    subscription = await registration.pushManager.getSubscription();

    $('toggle-btn').disabled = false;
    if (Notification.permission === 'denied') {
      setStatus('🚫', 'Benachrichtigungen sind blockiert', 'Erlaube sie in den Browser-Einstellungen für diese Seite.');
      $('toggle-btn').disabled = true;
    } else if (subscription) {
      setStatus('🔔', 'Auf diesem Gerät aktiv', 'Du bekommst hier Benachrichtigungen.');
      $('toggle-btn').textContent = 'Deaktivieren';
      $('toggle-btn').classList.add('ghost');
    } else {
      setStatus('🔕', 'Auf diesem Gerät aus', 'Aktivieren, um hier benachrichtigt zu werden.');
      $('toggle-btn').textContent = 'Aktivieren';
      $('toggle-btn').classList.remove('ghost');
    }
  }

  $('toggle-btn').addEventListener('click', async () => {
    if (nativeApp) return nativeApp.enableNotifications();
    $('toggle-btn').disabled = true;
    try {
      if (subscription) {
        await api('/push/unsubscribe', { method: 'POST', body: { endpoint: subscription.endpoint } });
        await subscription.unsubscribe();
        toast('Auf diesem Gerät deaktiviert');
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') throw new Error('Ohne Erlaubnis keine Benachrichtigungen');
        const { publicKey } = await api('/push/key');
        const sub = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
        await api('/push/subscribe', { method: 'POST', body: { subscription: sub.toJSON() } });
        toast('Aktiviert! Schick dir gleich mal einen Test.');
      }
    } catch (e) {
      toast(e.message, true);
    }
    await refreshStatus();
    loadDevices();
  });

  $('test-btn').addEventListener('click', async () => {
    try {
      const { sent } = await api('/push/test', { method: 'POST' });
      toast(sent ? `Test an ${sent} Gerät${sent === 1 ? '' : 'e'} geschickt` : 'Kein Gerät aktiv', !sent);
      loadHistory().catch(() => {});
    } catch (e) { toast(e.message, true); }
  });

  // ===== Geräte =====
  async function loadDevices() {
    const { devices } = await api('/push/devices');
    $('devices-empty').classList.toggle('hidden', devices.length > 0);
    $('test-btn').disabled = devices.length === 0;
    $('devices').innerHTML = devices.map((d) => `
      <li>
        <span class="grow">${d.kind === 'app' ? '📱 ' : ''}${escapeHtml(d.label || 'Gerät')}
          ${subscription && subscription.endpoint === d.endpoint ? '<span class="this">● dieses Gerät</span>' : ''}
          <br><span class="faint">seit ${escapeHtml(new Date(d.created_at.replace(' ', 'T') + 'Z').toLocaleDateString('de-DE'))}</span>
        </span>
        <button class="btn ghost small danger" data-remove="${d.id}">Entfernen</button>
      </li>`).join('');
  }
  $('devices').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-remove]');
    if (!b) return;
    await api('/push/devices/' + b.dataset.remove, { method: 'DELETE' });
    loadDevices();
  });

  // ===== Einstellungen & Webhook =====
  function renderHook(hookToken) {
    const url = `${location.origin}/api/push/hook/${hookToken}`;
    $('hook-url').value = url;
    $('ex-simple').textContent = `curl -d "Backup fertig ✅" ${url}`;
    $('ex-json').textContent = `curl -H "Content-Type: application/json" \\\n  -d '{"title":"Server","message":"Festplatte zu 90 % voll","url":"/"}' \\\n  ${url}`;
    $('ex-backup').textContent = `0 3 * * 0  cd /pfad/zu/Watchlist && npm run backup && curl -s -d "Backup ok" ${url} || curl -s -d "Backup FEHLGESCHLAGEN ❌" ${url}`;
  }

  async function loadSettings() {
    const s = await api('/push/settings');
    $('set-login').checked = s.notifyLogin;
    $('set-friends').checked = s.notifyFriends;
    $('set-server').checked = s.notifyServer;
    $('set-server-row').classList.toggle('hidden', !s.developer);
    renderHook(s.hookToken);
  }

  async function saveSettings() {
    try {
      await api('/push/settings', { method: 'PUT', body: {
        notifyLogin: $('set-login').checked,
        notifyFriends: $('set-friends').checked,
        notifyServer: $('set-server').checked,
      } });
      toast('Gespeichert');
    } catch (e) { toast(e.message, true); }
  }
  $('set-login').addEventListener('change', saveSettings);
  $('set-friends').addEventListener('change', saveSettings);
  $('set-server').addEventListener('change', saveSettings);

  $('hook-copy').addEventListener('click', () => copyText($('hook-url').value));
  $('hook-new').addEventListener('click', async () => {
    if (!confirm('Neue Adresse erzeugen? Skripte mit der alten Adresse funktionieren danach nicht mehr.')) return;
    const { hookToken } = await api('/push/hook-token', { method: 'POST' });
    renderHook(hookToken);
    toast('Neue Adresse erzeugt');
  });

  // ===== Verlauf =====
  function timeAgo(sqlDate) {
    const d = new Date(String(sqlDate).replace(' ', 'T') + 'Z');
    const min = Math.round((Date.now() - d) / 60000);
    if (min < 1) return 'gerade eben';
    if (min < 60) return `vor ${min} Min.`;
    if (min < 24 * 60) return `vor ${Math.round(min / 60)} Std.`;
    return d.toLocaleDateString('de-DE');
  }
  async function loadHistory() {
    const { notifications } = await api('/notifications');
    $('history-empty').classList.toggle('hidden', notifications.length > 0);
    $('history-clear').classList.toggle('hidden', notifications.length === 0);
    $('history').innerHTML = notifications.map((n) => {
      const href = /^\/(?!\/)/.test(n.url || '') && n.url !== '/' ? n.url : null;
      const inner = `<span class="faint when">${escapeHtml(timeAgo(n.created_at))}</span>
        <strong>${escapeHtml(n.title)}</strong><br><span class="muted">${escapeHtml(n.body || '')}</span>`;
      return `<li>${href ? `<a href="${escapeHtml(href)}">${inner}</a>` : inner}</li>`;
    }).join('');
  }
  $('history-clear').addEventListener('click', async () => {
    await api('/notifications', { method: 'DELETE' });
    loadHistory();
  });

  if (nativeApp) {
    $('intro-web').textContent = 'In der App ist dafür nichts weiter nötig – nur einmal erlauben.';
    // Die App meldet sich, wenn sich Erlaubnis oder Anmeldung ändern
    window.__snNotifyChanged = () => { refreshAppStatus(); loadDevices(); };
  }

  refreshStatus().catch((e) => setStatus('⚠️', 'Fehler', e.message)).finally(loadDevices);
  loadSettings().catch((e) => toast(e.message, true));
  loadHistory().catch(() => {});
})();

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

  async function refreshStatus() {
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
    } catch (e) { toast(e.message, true); }
  });

  // ===== Geräte =====
  async function loadDevices() {
    const { devices } = await api('/push/devices');
    $('devices-empty').classList.toggle('hidden', devices.length > 0);
    $('test-btn').disabled = devices.length === 0;
    $('devices').innerHTML = devices.map((d) => `
      <li>
        <span class="grow">${escapeHtml(d.label || 'Gerät')}
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

  refreshStatus().catch((e) => setStatus('⚠️', 'Fehler', e.message)).finally(loadDevices);
  loadSettings().catch((e) => toast(e.message, true));
})();

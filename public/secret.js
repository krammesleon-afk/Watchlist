// Geheimlinks: Ver- und Entschlüsselung passiert komplett hier im Browser.
// Link-Aufbau: /secret.html?s=<id>#<schlüssel>
(function () {
  const { toast, copyText } = Satho;
  const $ = (id) => document.getElementById(id);

  const b64url = {
    encode(buf) {
      let s = '';
      new Uint8Array(buf).forEach((b) => { s += String.fromCharCode(b); });
      return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    },
    decode(str) {
      const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
      return Uint8Array.from(s, (c) => c.charCodeAt(0));
    },
  };

  const id = new URLSearchParams(location.search).get('s');
  const keyStr = location.hash.slice(1);

  if (id) initView();
  else initCreate();

  // ===== Erstellen =====
  function initCreate() {
    const token = Auth.requireAuth();
    if (!token) return;
    $('create').classList.remove('hidden');

    $('create-btn').addEventListener('click', async () => {
      const text = $('secret-input').value;
      if (!text.trim()) return toast('Erst etwas eintippen', true);
      $('create-btn').disabled = true;
      try {
        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
        const rawKey = await crypto.subtle.exportKey('raw', key);

        const res = await Auth.api('/secrets', token, {
          method: 'POST',
          body: { ciphertext: b64url.encode(cipher), iv: b64url.encode(iv), expiresIn: $('expiry').value },
        });
        const link = `${location.origin}/secret.html?s=${res.id}#${b64url.encode(rawKey)}`;
        $('link-out').value = link;
        $('expires-out').textContent = 'Gültig bis ' + new Date(res.expiresAt).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
        $('result').classList.remove('hidden');
        $('secret-input').value = '';
        $('link-out').select();
      } catch (e) {
        toast(e.message, true);
      } finally {
        $('create-btn').disabled = false;
      }
    });
    $('copy-btn').addEventListener('click', () => copyText($('link-out').value));
  }

  // ===== Ansehen =====
  async function initView() {
    $('view').classList.remove('hidden');
    $('head-text').textContent = 'Eine Nachricht, die sich nach dem Lesen selbst zerstört.';
    const gone = () => {
      $('view-ask').classList.add('hidden');
      $('view-out').classList.add('hidden');
      $('view-gone').classList.remove('hidden');
    };
    if (!keyStr) return gone();

    try {
      const r = await fetch(`/api/secrets/${encodeURIComponent(id)}/exists`);
      if (!(await r.json()).exists) return gone();
    } catch (e) { return gone(); }

    $('reveal-btn').addEventListener('click', async () => {
      $('reveal-btn').disabled = true;
      try {
        const r = await fetch(`/api/secrets/${encodeURIComponent(id)}/open`, { method: 'POST' });
        if (!r.ok) return gone();
        const { ciphertext, iv } = await r.json();
        const key = await crypto.subtle.importKey('raw', b64url.decode(keyStr), 'AES-GCM', false, ['decrypt']);
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64url.decode(iv) }, key, b64url.decode(ciphertext));
        const text = new TextDecoder().decode(plain);
        $('secret-out').textContent = text;
        $('copy-secret').onclick = () => copyText(text);
        $('view-ask').classList.add('hidden');
        $('view-out').classList.remove('hidden');
        // Schlüssel aus der Adresszeile/Verlauf entfernen
        history.replaceState(null, '', location.pathname);
      } catch (e) {
        toast('Entschlüsseln fehlgeschlagen – ist der Link vollständig?', true);
        gone();
      }
    });
  }
})();

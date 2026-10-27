// Server-Cockpit: holt alle 5 s neue Messpunkte und zeichnet sie live.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const css = (name) => getComputedStyle(document.querySelector('.viz-root')).getPropertyValue(name).trim();
  const nf = (digits) => new Intl.NumberFormat('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const MAX_POINTS = 720;

  let token = null;
  let points = [];        // Live-Verlauf vom Server
  let lastT = 0;
  let rangeSec = 900;
  let charts = {};
  let failures = 0;

  // ---- Hilfsfunktionen ----
  async function get(path) {
    const res = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + token } });
    if (res.status === 401) {
      Auth.clearToken();
      window.location.href = 'index.html?next=cockpit.html';
      throw new Error('Nicht angemeldet');
    }
    if (res.status === 403) { showLocked(); throw new Error('Kein Zugriff'); }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res.json();
  }

  function showLocked() {
    $('cockpit').hidden = true;
    $('locked').hidden = false;
  }

  function bytes(n) {
    if (n == null) return '–';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return nf(i >= 3 ? 1 : 0).format(n) + ' ' + units[i];
  }

  function kbit(bytesPerSec) {
    return bytesPerSec == null ? null : (bytesPerSec * 8) / 1000;
  }

  function rate(bytesPerSec) {
    const k = kbit(bytesPerSec);
    if (k == null) return '–';
    return k >= 1000 ? nf(1).format(k / 1000) + ' Mbit/s' : nf(0).format(k) + ' kbit/s';
  }

  function duration(sec) {
    sec = Math.max(0, Math.round(sec));
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (d) return `${d} T ${h} Std`;
    if (h) return `${h} Std ${m} Min`;
    if (m) return `${m} Min`;
    return `${sec} Sek`;
  }

  const time = (t) => new Date(t).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const timeSec = (t) => new Date(t).toLocaleTimeString('de-DE');
  const dateTime = (t) => new Date(t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  // Status immer mit Text, nie nur Farbe
  function level(value, warnAt, critAt) {
    if (value == null) return null;
    if (value >= critAt) return { color: 'var(--critical)', text: 'kritisch' };
    if (value >= warnAt) return { color: 'var(--warning)', text: 'erhöht' };
    return { color: 'var(--good)', text: 'normal' };
  }

  function setTile(id, valueHtml, sub, status) {
    $(id).innerHTML = valueHtml;
    const subEl = $(id + '-sub');
    subEl.textContent = '';
    if (status) {
      const b = document.createElement('span');
      b.className = 'badge';
      b.style.setProperty('--badge', status.color);
      b.textContent = status.text;
      subEl.appendChild(b);
      if (sub) subEl.append(' · ' + sub);
    } else if (sub) {
      subEl.textContent = sub;
    }
  }

  // ---- Diagramme ----
  // Senkrechte Hilfslinie an der Mausposition
  const crosshair = {
    id: 'crosshair',
    afterDatasetsDraw(chart) {
      const active = chart.tooltip && chart.tooltip.getActiveElements();
      if (!active || !active.length) return;
      const x = active[0].element.x;
      const { top, bottom } = chart.chartArea;
      const ctx = chart.ctx;
      ctx.save();
      ctx.strokeStyle = css('--text-muted');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, bottom);
      ctx.stroke();
      ctx.restore();
    },
  };

  function makeChart(canvasId, series, yOptions, unit) {
    const muted = css('--text-muted');
    return new Chart($(canvasId), {
      type: 'line',
      data: {
        datasets: series.map((s) => ({
          label: s.label,
          data: [],
          borderColor: css(s.color),
          backgroundColor: css(s.color),
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBorderWidth: 2,
          pointHoverBorderColor: css('--surface-1'),
          tension: 0.25,
          spanGaps: false,
        })),
      },
      options: {
        animation: false,
        maintainAspectRatio: false,
        parsing: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(19, 17, 16, 0.95)',
            borderColor: 'rgba(244, 237, 228, 0.18)',
            borderWidth: 1,
            titleColor: css('--text-primary'),
            bodyColor: css('--text-secondary'),
            padding: 10,
            callbacks: {
              title: (items) => (items.length ? timeSec(items[0].parsed.x) : ''),
              label: (item) => ` ${item.dataset.label}: ${nf(unit.digits).format(item.parsed.y)} ${unit.text}`,
            },
          },
        },
        scales: {
          x: {
            type: 'linear',
            grid: { display: false },
            border: { color: css('--grid') },
            ticks: { color: muted, maxTicksLimit: 6, maxRotation: 0, callback: (v) => time(v) },
          },
          y: Object.assign({
            grid: { color: css('--grid') },
            border: { display: false },
            ticks: { color: muted, maxTicksLimit: 5 },
          }, yOptions),
        },
      },
      plugins: [crosshair],
    });
  }

  function initCharts() {
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    charts.cpu = makeChart('c-cpu', [{ label: 'CPU', color: '--series-1' }], { min: 0, max: 100 }, { text: '%', digits: 1 });
    charts.ram = makeChart('c-ram', [{ label: 'RAM', color: '--series-1' }], { min: 0, max: 100 }, { text: '%', digits: 1 });
    charts.temp = makeChart('c-temp', [{ label: 'Temperatur', color: '--series-1' }], { suggestedMin: 20, suggestedMax: 90 }, { text: '°C', digits: 1 });
    charts.net = makeChart('c-net', [
      { label: 'Empfangen', color: '--series-1' },
      { label: 'Gesendet', color: '--series-2' },
    ], { beginAtZero: true }, { text: 'kbit/s', digits: 0 });
  }

  // Lücken (z. B. nach Neustart) als Unterbrechung der Linie zeigen
  function series(key, transform, intervalMs) {
    const out = [];
    let prevT = null;
    for (const p of points) {
      if (prevT !== null && p.t - prevT > intervalMs * 3) out.push({ x: prevT + intervalMs, y: null });
      const v = p[key];
      out.push({ x: p.t, y: v == null ? null : (transform ? transform(v) : v) });
      prevT = p.t;
    }
    return out;
  }

  function drawCharts(now, intervalMs) {
    const min = now - rangeSec * 1000;
    const set = (chart, datasets) => {
      datasets.forEach((d, i) => { chart.data.datasets[i].data = d; });
      chart.options.scales.x.min = min;
      chart.options.scales.x.max = now;
      chart.update('none');
    };
    set(charts.cpu, [series('cpu', null, intervalMs)]);
    set(charts.ram, [series('ram', null, intervalMs)]);
    set(charts.temp, [series('temp', null, intervalMs)]);
    set(charts.net, [series('rx', kbit, intervalMs), series('tx', kbit, intervalMs)]);

    const shown = points.filter((p) => p.t >= min);
    const first = points.length ? points[0].t : now;
    $('range-hint').textContent = first > min
      ? `Live-Daten seit ${time(first)} (Verlauf beginnt beim Serverstart)`
      : `${shown.length} Messpunkte`;
  }

  function drawTable() {
    const rows = points.slice(-12).reverse();
    const f1 = nf(1);
    const f0 = nf(0);
    const cell = (v, f) => (v == null ? '–' : f.format(v));
    $('table-body').innerHTML = rows.map((p) => `<tr>
      <td>${timeSec(p.t)}</td><td>${cell(p.cpu, f1)}</td><td>${cell(p.ram, f1)}</td>
      <td>${cell(p.temp, f1)}</td><td>${cell(kbit(p.rx), f0)}</td><td>${cell(kbit(p.tx), f0)}</td></tr>`).join('');
  }

  function drawTiles(m) {
    const last = points[points.length - 1] || {};
    const f1 = nf(1);
    const f0 = nf(0);

    const loadPerCore = m.load[0] / m.cpuCount;
    setTile('t-cpu', last.cpu == null ? '–' : `${f1.format(last.cpu)}<small>%</small>`,
      `Host-Last ${nf(2).format(m.load[0])} bei ${m.cpuCount} Kernen`, level(last.cpu, 70, 90));
    $('n-cpu').textContent = last.cpu == null ? '' : `jetzt ${f1.format(last.cpu)} %`;
    if (loadPerCore > 4) $('t-cpu-sub').title = 'Die Last des Proxmox-Hosts ist sehr hoch.';

    const ramPct = m.memory.total ? (m.memory.used / m.memory.total) * 100 : null;
    setTile('t-ram', ramPct == null ? '–' : `${f0.format(ramPct)}<small>%</small>`,
      `${bytes(m.memory.used)} von ${bytes(m.memory.total)}`, level(ramPct, 80, 92));
    $('n-ram').textContent = ramPct == null ? '' : `jetzt ${f1.format(ramPct)} %`;

    setTile('t-temp', last.temp == null ? '–' : `${f0.format(last.temp)}<small>°C</small>`,
      'CPU-Package (Host)', level(last.temp, 75, 88));
    $('n-temp').textContent = last.temp == null ? '' : `jetzt ${f1.format(last.temp)} °C`;

    setTile('t-net', `${rate(last.rx).replace(/ (\S+)$/, '<small>$1</small>')}`, `empfangen · gesendet ${rate(last.tx)}`);
    $('n-net').textContent = `↓ ${rate(last.rx)} · ↑ ${rate(last.tx)}`;

    if (m.disk) {
      const diskPct = (m.disk.used / m.disk.total) * 100;
      setTile('t-disk', `${f0.format(diskPct)}<small>%</small>`,
        `${bytes(m.disk.total - m.disk.used)} frei`, level(diskPct, 80, 90));
    }

    setTile('t-up', duration(m.uptime.app).replace(/^(\d+) (\S+)/, '$1<small>$2</small>'),
      `App seit Neustart · System ${duration(m.uptime.system)}`);
  }

  function setStatus(ok, text) {
    $('status-dot').className = 'dot ' + (ok ? 'good' : 'critical');
    $('status-text').textContent = text;
  }

  async function refresh() {
    try {
      const m = await get('/cockpit/metrics?since=' + lastT);
      points = points.concat(m.history).slice(-MAX_POINTS);
      if (points.length) lastT = points[points.length - 1].t;
      drawTiles(m);
      drawCharts(m.now, m.intervalMs);
      drawTable();
      failures = 0;
      setStatus(true, 'Server online · aktualisiert ' + timeSec(m.now));
    } catch (e) {
      if ($('cockpit').hidden) return;
      failures++;
      setStatus(false, failures > 1 ? 'Server nicht erreichbar' : 'Verbindung wird erneut versucht…');
    }
  }

  // ---- Ausfälle ----
  async function loadEvents() {
    try {
      const data = await get('/cockpit/events');
      const now = data.now;
      const windowStart = Math.max(now - 30 * 86400000, data.trackingSince);
      const outages = data.events.filter((e) => e.kind === 'outage');
      const recent = outages.filter((e) => e.ended_at >= windowStart);
      const down = recent.reduce((sum, e) => sum + (e.ended_at - Math.max(e.started_at, windowStart)), 0);
      const total = now - windowStart;
      const avail = total > 0 ? Math.max(0, 1 - down / total) * 100 : 100;

      setTile('t-avail', `${nf(2).format(avail)}<small>%</small>`,
        data.trackingSince > now - 30 * 86400000 ? `gemessen seit ${dateTime(data.trackingSince)}` : 'letzte 30 Tage',
        level(100 - avail, 0.5, 2));
      setTile('t-outages', String(recent.length),
        down ? `zusammen ${duration(down / 1000)} offline` : 'keine Ausfallzeit');

      const list = $('events');
      if (!data.events.length) {
        list.innerHTML = '<li class="empty">Noch keine Ausfälle oder Neustarts aufgezeichnet.</li>';
        return;
      }
      list.innerHTML = '';
      for (const e of data.events) {
        const li = document.createElement('li');
        const when = document.createElement('span');
        when.className = 'when';
        when.textContent = dateTime(e.started_at);
        const kind = document.createElement('span');
        kind.className = 'badge';
        kind.style.setProperty('--badge', e.kind === 'outage' ? 'var(--critical)' : 'var(--ink-faint)');
        kind.textContent = e.kind === 'outage' ? 'Ausfall' : 'Neustart';
        const dur = document.createElement('span');
        dur.className = 'dur';
        dur.textContent = e.kind === 'outage'
          ? `${duration((e.ended_at - e.started_at) / 1000)} offline`
          : `wieder da um ${time(e.ended_at)}`;
        li.append(when, kind, dur);
        list.appendChild(li);
      }
    } catch (e) {
      if (!$('cockpit').hidden) $('events').innerHTML = '<li class="empty">Ausfälle konnten nicht geladen werden.</li>';
    }
  }

  // ---- Start ----
  async function init() {
    token = Auth.requireAuth();
    if (!token) return;
    let access;
    try { access = await get('/cockpit/access'); } catch (e) { return; }
    if (!access.developer) return showLocked();

    $('cockpit').hidden = false;
    initCharts();

    document.querySelectorAll('.seg button').forEach((b) => {
      b.addEventListener('click', () => {
        rangeSec = Number(b.dataset.range);
        document.querySelectorAll('.seg button').forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
        refresh();
      });
    });

    await refresh();
    loadEvents();
    setInterval(() => { if (!document.hidden) refresh(); }, 5000);
    setInterval(() => { if (!document.hidden) loadEvents(); }, 60000);
  }

  window.addEventListener('DOMContentLoaded', init);
})();

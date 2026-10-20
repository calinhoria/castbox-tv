(() => {
  const $ = (id) => document.getElementById(id);
  const fmt = (ms) => {
    const total = Math.max(0, Math.floor((ms || 0) / 1000));
    return Math.floor(total / 60) + ':' + String(total % 60).padStart(2, '0');
  };

  let current = {};
  let toastTimer = null;

  function toast(message) {
    const el = $('toast');
    el.textContent = message;
    el.classList.remove('opacity-0', 'translate-y-2');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('opacity-0', 'translate-y-2'), 1800);
  }

  async function post(url, params) {
    const body = new URLSearchParams(params);
    const res = await fetch(url, { method: 'POST', body });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return res;
  }

  async function send(key, value) {
    try {
      await post('/api/settings', { [key]: typeof value === 'boolean' ? String(value) : value });
      await refresh();
    } catch (e) {
      toast('Could not reach the TV');
    }
  }

  // ---- tabs --------------------------------------------------------------
  function showTab(id) {
    document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== id));
    document.querySelectorAll('[data-tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === id)));
    try { localStorage.setItem('castbox.tab', id); } catch (_) { /* private mode */ }
    window.scrollTo({ top: 0 });
  }

  // ---- rendering ----------------------------------------------------------
  function setSlider(el, value) {
    if (document.activeElement === el) return;
    el.value = value;
    const label = $(el.dataset.label);
    if (label) label.textContent = value + ' s';
  }

  function renderPacks(pack) {
    document.querySelectorAll('[data-pack]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pack === pack)));
  }

  function fillPresets(names, selected) {
    const sel = $('appVizPreset');
    const same = sel.options.length === names.length && names.every((n, i) => sel.options[i].value === n);
    if (!same) {
      sel.replaceChildren(...names.map((n) => {
        const o = document.createElement('option');
        o.value = n;
        o.textContent = n;
        return o;
      }));
    }
    if (names.length && document.activeElement !== sel) sel.value = selected;
    $('presetCount').textContent = names.length + ' presets in this pack';
  }

  function renderStatus(s) {
    $('deviceName').textContent = s.displayName || '';
    $('statusDot').className = 'h-2 w-2 rounded-full ' + (s.playing ? 'bg-emerald-400 shadow-[0_0_8px] shadow-emerald-400/70' : 'bg-slate-500');
    $('statusText').textContent = s.playing ? 'Playing' : 'Idle';

    $('title').textContent = s.title || 'Nothing playing';
    $('artist').textContent = s.title ? (s.artist || 'Unknown artist') : 'Cast something from your phone';
    $('album').textContent = s.album || '';
    $('position').textContent = fmt(s.position);
    $('duration').textContent = fmt(s.duration);
    $('progress').style.width = (s.duration > 0 ? Math.min(100, (s.position / s.duration) * 100) : 0) + '%';

    $('vizSummary').textContent = s.appVizEnabled ? s.appVizPreset : 'Off';
    $('crossfade').textContent = s.crossfadeEnabled ? s.crossfadeDuration + ' s · ' + s.crossfadeAlgorithm.replace(/_/g, ' ').toLowerCase() : 'Off';
  }

  function renderControls(s) {
    const checks = ['appVizEnabled', 'appVizCycle', 'appVizUseCoverPalette', 'appVizShowName', 'appVizShowFps', 'appVizMockAudio', 'crossfadeEnabled'];
    checks.forEach((id) => { $(id).checked = !!s[id]; });
    setSlider($('appVizCycleSecs'), s.appVizCycleSecs);
    setSlider($('crossfadeDuration'), s.crossfadeDuration);
    $('crossfadeAlgorithm').value = s.crossfadeAlgorithm;
    $('crossfadeOptions').classList.toggle('opacity-40', !s.crossfadeEnabled);
    renderPacks(s.appVizPack);
    fillPresets(s.appVizPresets || [], s.appVizPreset);

    const starred = !!s.appVizIsFavorite;
    $('favIcon').setAttribute('fill', starred ? 'currentColor' : 'none');
    $('favBtn').classList.toggle('!text-amber-300', starred);
    $('favLabel').textContent = starred ? 'Starred' : 'Favorite';
    if (document.activeElement !== $('displayName')) $('displayName').value = s.displayName || '';
  }

  async function refresh() {
    const res = await fetch('/api/status');
    current = await res.json();
    renderStatus(current);
    renderControls(current);
  }

  // ---- wiring -------------------------------------------------------------
  function wire() {
    document.querySelectorAll('[data-tab]').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

    document.querySelectorAll('[data-opt]').forEach((el) => {
      if (el.type === 'range') {
        el.addEventListener('input', () => { const l = $(el.dataset.label); if (l) l.textContent = el.value + ' s'; });
        el.addEventListener('change', () => send(el.dataset.opt, el.value));
      } else if (el.type === 'checkbox') {
        el.addEventListener('change', () => send(el.dataset.opt, el.checked));
      } else {
        el.addEventListener('change', () => send(el.dataset.opt, el.value));
      }
    });

    document.querySelectorAll('[data-flag]').forEach((b) => b.addEventListener('click', () => send(b.dataset.flag, true)));
    document.querySelectorAll('[data-pack]').forEach((b) => b.addEventListener('click', () => {
      renderPacks(b.dataset.pack);
      send('appVizPack', b.dataset.pack);
    }));
    document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => window.open(b.dataset.open, '_blank')));

    $('saveName').addEventListener('click', async () => {
      const name = $('displayName').value.trim();
      if (!name) return toast('Enter a name first');
      try {
        await post('/api/display', { name });
        toast('Saved. Controllers may take a moment to refresh');
        refresh();
      } catch (e) { toast('Could not save'); }
    });

    $('restart').addEventListener('click', async () => {
      if (!confirm('Restart CastBox TV?')) return;
      try { await post('/api/restart', {}); toast('Restarting…'); } catch (e) { toast('Could not reach the TV'); }
    });

    $('deviceHost').textContent = location.hostname;
  }

  wire();
  let startTab = 'now';
  try { startTab = localStorage.getItem('castbox.tab') || 'now'; } catch (_) { /* ignore */ }
  showTab(startTab);
  refresh().catch(() => toast('Could not reach the TV'));
  setInterval(() => refresh().catch(() => {}), 2000);
})();

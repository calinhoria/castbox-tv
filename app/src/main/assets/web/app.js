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

  const STAR_PATH = 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z';
  let listKey = '';

  function starIcon(on) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'h-5 w-5');
    svg.setAttribute('fill', on ? 'currentColor' : 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', STAR_PATH);
    svg.appendChild(path);
    return svg;
  }

  function fillPresets(names, selected, favorites, pack) {
    const query = $('presetSearch').value.trim().toLowerCase();
    const favs = new Set(favorites || []);
    const key = [pack, selected, query, names.join('\u0001'), [...favs].join('\u0001')].join('\u0002');
    const shown = query ? names.filter((n) => n.toLowerCase().includes(query)) : names;
    $('presetCount').textContent = pack === 'favorites'
      ? names.length + (names.length === 1 ? ' favorite' : ' favorites')
      : names.length + ' presets · ' + favs.size + ' starred';

    const empty = $('presetEmpty');
    empty.classList.toggle('hidden', shown.length > 0);
    empty.textContent = names.length === 0 && pack === 'favorites'
      ? 'No favorites yet. Star presets in any other pack and they will show up here.'
      : 'No presets match your search.';
    if (key === listKey) return;
    listKey = key;

    const list = $('presetList');
    list.classList.toggle('hidden', shown.length === 0);
    const scroll = list.scrollTop;
    list.replaceChildren(...shown.map((name) => {
      const active = name === selected;
      const on = favs.has(name);
      const li = document.createElement('li');
      li.className = 'flex items-center ' + (active ? 'bg-cyan-400/10' : '');
      const pick = document.createElement('button');
      pick.type = 'button';
      pick.className = 'min-w-0 flex-1 truncate px-3 py-3 text-left text-sm transition hover:bg-white/5 ' + (active ? 'font-medium text-cyan-200' : 'text-slate-200');
      pick.textContent = name;
      pick.addEventListener('click', () => send('appVizPreset', name));
      const star = document.createElement('button');
      star.type = 'button';
      star.setAttribute('aria-label', (on ? 'Unstar ' : 'Star ') + name);
      star.className = 'px-3 py-3 transition hover:bg-white/5 ' + (on ? 'text-amber-300' : 'text-slate-500 hover:text-slate-300');
      star.appendChild(starIcon(on));
      star.addEventListener('click', () => send('appVizFavoriteName', name));
      li.append(pick, star);
      return li;
    }));
    list.scrollTop = scroll;
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
    fillPresets(s.appVizPresets || [], s.appVizPreset, s.appVizFavorites, s.appVizPack);

    const starred = !!s.appVizIsFavorite;
    $('favIcon').setAttribute('fill', starred ? 'currentColor' : 'none');
    $('favBtn').classList.toggle('!text-amber-300', starred);
    $('favLabel').textContent = starred ? 'Starred' : 'Star';
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
    $('presetSearch').addEventListener('input', () => renderControls(current));
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

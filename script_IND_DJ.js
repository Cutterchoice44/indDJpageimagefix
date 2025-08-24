/* DJ Selects — full front-end using Radio Cult API directly (like DJ Profiles) */
(() => {
  const CFG = window.DJ_SELECTS || {};

  const $  = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];

  const stripList   = $('#stripList');
  const mainPreview = $('#mainPreview');
  const djNameText  = $('#djNameText');
  const djProfile   = $('#djProfileThumb');
  const nextWhen    = $('#nextShowWhen');
  const adminMount  = $('#adminMount');

  // RC base matches the profiles page pattern
  const RC_BASE = CFG.RC_BASE || 'https://api.radiocult.fm/api';

  let shared = {
    djName: 'DJ NAME',
    profileImage: '/images/default-dj.png',
    stationId: 'cutters-choice-radio',
    apiKey: '',        // publishable pk_… key
    tracks: []
  };

  /* ---------------- helpers ---------------- */

  const sha256hex = async (text) => {
    const enc = new TextEncoder().encode(text);
    const buf = await crypto.subtle.digest('SHA-256', enc);
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('');
  };

  const toEmbed = (url) => {
    if (!url) return null;
    try {
      const u = new URL(url.trim());
      if (u.hostname.includes('youtu')) {
        let id = '';
        if (u.hostname === 'youtu.be') id = u.pathname.slice(1);
        else if (u.pathname.startsWith('/shorts/')) id = u.pathname.split('/')[2] || '';
        else if (u.searchParams.get('v')) id = u.searchParams.get('v');
        else if (/^\/embed\//.test(u.pathname)) id = u.pathname.split('/').pop();
        id = (id || '').split('?')[0].split('&')[0];
        if (!id) return null;
        return `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`;
      }
      return url;
    } catch { return null; }
  };

  const iframeAttrs = (src, big=false) =>
    `<iframe src="${src}" title="YouTube video" loading="${big?'eager':'lazy'}"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;

  const setPreview = (src) => {
    mainPreview.innerHTML = `<div class="ratio big">${iframeAttrs(src, true)}</div>`;
  };

  const renderStrips = (embeds) => {
    stripList.innerHTML = '';
    embeds.slice(0,5).forEach((src, i) => {
      const strip = document.createElement('div');
      strip.className = 'strip';
      strip.innerHTML = iframeAttrs(src, false) + '<div class="select-overlay" aria-hidden="true"></div>';
      strip.querySelector('.select-overlay').addEventListener('click', () => {
        $$('.strip').forEach(s => s.classList.remove('selected'));
        strip.classList.add('selected');
        setPreview(src);
      });
      stripList.appendChild(strip);
      if (i === 0) {
        strip.classList.add('selected');
        setPreview(src);
      }
    });
    if (embeds.length === 0) mainPreview.innerHTML = '<div class="big-placeholder">Select a track</div>';
  };

  const fmtLocal = (iso) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString(undefined, {
        weekday:'short', day:'numeric', month:'short',
        hour:'2-digit', minute:'2-digit', hour12:false, timeZoneName:'short'
      });
    } catch { return ''; }
  };

  const slug = (s) => (s||'')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'');

  const nameEq = (a,b) => {
    const A=(a||'').trim().toLowerCase(), B=(b||'').trim().toLowerCase();
    return A && B && (A===B || slug(A)===slug(B));
  };

  const rcHeaders = () => (shared.apiKey
    ? { 'x-api-key': shared.apiKey }
    : {} // allow open endpoints if key not needed
  );

  const fetchJSON = async (url) => {
    const res = await fetch(url, { headers: rcHeaders(), cache:'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  /* ---------------- server config ---------------- */

  async function loadSharedConfig() {
    try {
      const res = await fetch(`${CFG.CONFIG_ENDPOINT}?action=load`, {cache:'no-store'});
      if (!res.ok) throw new Error('load failed');
      const data = await res.json();
      if (data && data.djName) shared = {...shared, ...data};
    } catch {
      const raw = localStorage.getItem('dj-selects-config');
      if (raw) shared = {...shared, ...JSON.parse(raw)};
    }
  }

  /* ---------------- Radio Cult (match artist, image, schedule) ---------------- */

  async function loadRcArtistAndImage() {
    try {
      const url = `${RC_BASE}/station/${encodeURIComponent(shared.stationId)}/artists`;
      const payload = await fetchJSON(url);

      const artists = payload?.artists || payload?.data || [];
      const nm = shared.djName;

      // match by exact or slug or contains
      let artist = artists.find(a => nameEq(a?.name, nm))
               || artists.find(a => slug(a?.name) === slug(nm))
               || artists.find(a => (a?.name||'').toLowerCase().includes(nm.toLowerCase()));

      if (!artist) return null;

      // Set image the same way the profiles page does (logo.512x512 or default)
      const logo = (artist.logo && (artist.logo['512x512'] || artist.logo.default)) || '';
      if (logo && (/default-dj\.png$/i.test(djProfile.src) || !djProfile.src)) {
        djProfile.src = logo;
      }
      return artist;
    } catch {
      return null;
    }
  }

  async function loadNextShowFromArtist(artist) {
    nextWhen.textContent = 'Loading…';
    if (!artist?.id) { nextWhen.textContent = 'No upcoming show found'; return; }

    try {
      // Follow the working profiles page: /artists/{id}/schedule with x-api-key
      const now = new Date().toISOString();
      const nextYear = new Date(Date.now() + 365*24*60*60*1000).toISOString();

      const url = `${RC_BASE}/station/${encodeURIComponent(shared.stationId)}/artists/${encodeURIComponent(artist.id)}/schedule?startDate=${encodeURIComponent(now)}&endDate=${encodeURIComponent(nextYear)}`;
      const payload = await fetchJSON(url);

      // profiles page uses { schedules: [...] } and reads startDateUtc
      const schedules = payload?.schedules || payload?.data || [];
      if (!Array.isArray(schedules) || !schedules.length) { nextWhen.textContent = 'TBA'; return; }

      // If not sorted, pick soonest future
      const getIso = (s) => s.startDateUtc || s.startDate || s.start || s.scheduledStart;
      const future = schedules
        .map(s => ({ s, t: new Date(getIso(s) || 0) }))
        .filter(x => x.t instanceof Date && !isNaN(x.t) && x.t > new Date())
        .sort((a,b)=>a.t-b.t);

      const chosen = (future[0] || { s: schedules[0] }).s;
      const whenISO = getIso(chosen);
      nextWhen.textContent = whenISO ? fmtLocal(whenISO) : 'TBA';
      if (whenISO) {
        nextWhen.setAttribute('data-utc', whenISO);
        nextWhen.title = `Start (UTC): ${new Date(whenISO).toUTCString()}`;
      }
    } catch {
      nextWhen.textContent = 'Unable to load schedule';
    }
  }

  async function loadArtistBits() {
    // If you manually set a profileImage (not default), we still try to fetch next show
    const artist = await loadRcArtistAndImage();
    await loadNextShowFromArtist(artist);
  }

  /* ---------------- admin (hidden until auth) ---------------- */

  function renderAdmin() {
    const btn = document.createElement('button');
    btn.className = 'admin-btn';
    btn.id = 'adminBtn';
    btn.title = 'Admin';
    btn.innerHTML = '<i class="fa-solid fa-gear" aria-hidden="true"></i>';

    const panel = document.createElement('div');
    panel.className = 'admin-panel';
    panel.id = 'adminPanel';
    panel.innerHTML = `
      <div class="admin-head">
        <strong>DJ SELECTS — Admin</strong>
        <button id="adminClose" class="admin-close" aria-label="Close">&times;</button>
      </div>
      <div class="admin-body">
        <label>DJ Name (as listed in Radio Cult)
          <input type="text" id="adminDjName" placeholder="e.g., MARIONETTE" value="${shared.djName}">
        </label>

        <div class="two-col">
          <label>Station ID
            <input type="text" id="adminStationId" placeholder="cutters-choice-radio" value="${shared.stationId}">
          </label>
          <label>Publishable API Key (required if RC needs it)
            <input type="text" id="adminApiKey" placeholder="pk_..." value="${shared.apiKey}">
          </label>
        </div>

        <label>Profile Image URL (optional)
          <input type="text" id="profileOverride" placeholder="https://..." value="${shared.profileImage || ''}">
        </label>

        <div class="admin-subhead" style="margin:.5rem 0 .25rem;font-family:'Bebas Neue',sans-serif;font-size:1.3rem;">YouTube Track URLs (up to 5)</div>
        <div id="adminTracks"></div>

        <div class="admin-actions">
          <button id="adminSave" class="primary">Save</button>
          <button id="adminLogout" class="ghost">Logout</button>
          <button id="adminReset" class="danger">Reset (local only)</button>
        </div>
      </div>
    `;

    adminMount.after(btn, panel);
    adminMount.remove();

    const close = () => panel.classList.remove('open');
    btn.addEventListener('click', () => panel.classList.add('open'));
    panel.querySelector('#adminClose').addEventListener('click', close);

    // tracks editor
    const tracksWrap = panel.querySelector('#adminTracks');
    const redraw = () => {
      tracksWrap.innerHTML = '';
      const current = [...shared.tracks, '', '', '', ''].slice(0,5);
      current.forEach((val) => {
        const row = document.createElement('div');
        row.className = 'track-input';
        row.innerHTML = `
          <input type="url" placeholder="https://www.youtube.com/watch?v=..." value="${val||''}">
          <button data-act="clear">Clear</button>
          <button data-act="paste">Paste</button>
        `;
        row.querySelector('[data-act="clear"]').addEventListener('click', () => {
          row.querySelector('input').value = '';
        });
        row.querySelector('[data-act="paste"]').addEventListener('click', async () => {
          try {
            const txt = await navigator.clipboard.readText();
            row.querySelector('input').value = txt;
          } catch {}
        });
        tracksWrap.appendChild(row);
      });
    };
    redraw();

    panel.querySelector('#adminSave').addEventListener('click', async () => {
      shared.djName       = panel.querySelector('#adminDjName').value.trim() || shared.djName;
      shared.stationId    = panel.querySelector('#adminStationId').value.trim() || shared.stationId;
      shared.apiKey       = panel.querySelector('#adminApiKey').value.trim();
      shared.profileImage = panel.querySelector('#profileOverride').value.trim();

      const urls = $$('.track-input input', panel).map(i => i.value.trim()).filter(Boolean);
      shared.tracks = urls.slice(0,5);

      localStorage.setItem('dj-selects-config', JSON.stringify(shared));

      if (CFG.SAVE_TOKEN) {
        try {
          const res = await fetch(`${CFG.CONFIG_ENDPOINT}?action=save`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: CFG.SAVE_TOKEN, data: shared })
          });
          if (!res.ok) throw new Error('save failed');
          alert('Saved to server. Live for everyone.');
        } catch (e) {
          alert('Saved locally. To save for everyone, ensure SAVE_TOKEN matches $SERVER_TOKEN in dj-selects-config.php.');
        }
      } else {
        alert('Saved locally. To save for everyone, set SAVE_TOKEN in this page and $SERVER_TOKEN in dj-selects-config.php.');
      }

      applyConfig(); // re-render tracks
      // and refresh RC bits immediately with new key/name
      loadArtistBits();
      close();
    });

    panel.querySelector('#adminLogout').addEventListener('click', () => {
      sessionStorage.removeItem('dj-selects-auth');
      location.reload();
    });

    panel.querySelector('#adminReset').addEventListener('click', () => {
      localStorage.removeItem('dj-selects-config');
      alert('Local data cleared. Reloading…'); location.reload();
    });
  }

  async function ensureAdmin() {
    const promptAuth = async () => {
      const pwd = window.prompt('Enter admin passphrase:');
      if (!pwd) return;
      const hex = await sha256hex(pwd);
      if (hex === CFG.ADMIN_HASH_HEX) {
        sessionStorage.setItem('dj-selects-auth','1');
        renderAdmin();
      } else {
        alert('Wrong passphrase.');
      }
    };
    if (new URLSearchParams(location.search).get('admin') === '1') await promptAuth();
    document.addEventListener('keydown', async (e) => {
      if (e.key.toLowerCase()==='a' && e.shiftKey) await promptAuth();
    });
    if (sessionStorage.getItem('dj-selects-auth') === '1') renderAdmin();
  }

  /* ---------------- apply + boot ---------------- */

  function applyConfig() {
    djNameText.textContent = shared.djName || 'DJ NAME';
    if (shared.profileImage) djProfile.src = shared.profileImage;

    const embeds = (shared.tracks || []).map(toEmbed).filter(Boolean);
    renderStrips(embeds);

    // Load RC image + schedule (both driven by the same artist match)
    loadArtistBits();
  }

  window.addEventListener('DOMContentLoaded', async () => {
    await loadSharedConfig();
    applyConfig();
    ensureAdmin();
  });
})();

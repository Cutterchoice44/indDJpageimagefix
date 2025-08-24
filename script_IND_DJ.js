/* DJ Selects — full front-end (viewer-local times + robust RC lookups) */
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

  let shared = {
    djName: 'DJ NAME',
    profileImage: '/images/default-dj.png',
    stationId: 'cutters-choice-radio',
    apiKey: '',
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

  const firstImageUrl = (o) => {
    if (!o) return '';
    return (
      o.image || o.imageUrl || o.avatar || o.avatarUrl ||
      (Array.isArray(o.images) && o.images.length && (o.images[0].url || o.images[0].src)) ||
      ''
    );
  };

  const keyParam = () => shared.apiKey ? `&key=${encodeURIComponent(shared.apiKey)}` : '';

  const fetchJSON = async (url) => {
    const res = await fetch(url, { headers:{'Accept':'application/json'}, cache:'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };

  /* ---------------- server config ---------------- */

  async function loadSharedConfig() {
    try {
      const data = await fetchJSON(`${CFG.CONFIG_ENDPOINT}?action=load`);
      if (data && data.djName) shared = {...shared, ...data};
    } catch {
      const raw = localStorage.getItem('dj-selects-config');
      if (raw) shared = {...shared, ...JSON.parse(raw)};
    }
  }

  /* ---------------- Radio Cult helpers ---------------- */

  async function findDjRecord() {
    // get both lists and try to match the DJ name
    const base = `${CFG.PROXY_ENDPOINT}?stationId=${encodeURIComponent(shared.stationId)}${keyParam()}`;
    let artists = [], presenters = [];
    try { artists    = (await fetchJSON(`${base}&fn=artists`))?.data || []; } catch {}
    try { presenters = (await fetchJSON(`${base}&fn=presenters`))?.data || []; } catch {}

    let rec = artists.find(x => nameEq(x?.name, shared.djName));
    if (rec) return { kind:'artist', rec };

    // try slug / contains for artists
    const djSlug = slug(shared.djName);
    rec = artists.find(x => slug(x?.name) === djSlug) || artists.find(x => (x?.name||'').toLowerCase().includes(shared.djName.toLowerCase()));
    if (rec) return { kind:'artist', rec };

    // presenters
    rec = presenters.find(x => nameEq(x?.name, shared.djName))
       || presenters.find(x => slug(x?.name) === djSlug)
       || presenters.find(x => (x?.name||'').toLowerCase().includes(shared.djName.toLowerCase()));
    if (rec) return { kind:'presenter', rec };

    return null;
  }

  async function fetchNextShowFor(recInfo) {
    if (!recInfo) return null;

    const now = new Date();
    const start = now.toISOString();
    const end   = new Date(now.getTime() + 90*24*60*60*1000).toISOString(); // +90 days

    const base = `${CFG.PROXY_ENDPOINT}?stationId=${encodeURIComponent(shared.stationId)}${keyParam()}`;
    let url;
    if (recInfo.kind === 'artist') {
      url = `${base}&fn=artist_schedule&artistId=${encodeURIComponent(recInfo.rec.id || recInfo.rec._id || recInfo.rec.slug || recInfo.rec.slugId || '')}&startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`;
    } else {
      url = `${base}&fn=presenter_schedule&presenterId=${encodeURIComponent(recInfo.rec.id || recInfo.rec._id || recInfo.rec.slug || recInfo.rec.slugId || '')}&startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`;
    }

    try {
      const data = await fetchJSON(url);
      const items = data?.data || data || [];
      // Normalize date field and pick soonest future
      const getStart = (e) => e.startDate || e.start || e.scheduledStart || e.start_time || e.start_at || null;
      const future = items
        .map(e => ({ e, t: new Date(getStart(e) || 0) }))
        .filter(x => x.t instanceof Date && !isNaN(x.t) && x.t > now)
        .sort((a,b)=>a.t-b.t);
      return future[0]?.e || null;
    } catch {
      return null;
    }
  }

  /* ---------------- image + next show ---------------- */

  async function loadDjImage() {
    // respect manual override if not default
    if (shared.profileImage && !/default-dj\.png$/i.test(shared.profileImage)) return;
    try {
      const match = await findDjRecord();
      const url = firstImageUrl(match?.rec);
      if (url) djProfile.src = url;
    } catch {}
  }

  async function loadNextShow() {
    nextWhen.textContent = 'Loading…';

    try {
      const match = await findDjRecord();
      const event = await fetchNextShowFor(match);

      if (!event) {
        nextWhen.textContent = 'No upcoming show found';
        return;
      }

      const whenISO = event.startDate || event.start || event.scheduledStart || event.start_time || event.start_at || '';
      if (!whenISO) { nextWhen.textContent = 'TBA'; return; }

      nextWhen.textContent = fmtLocal(whenISO);
      nextWhen.setAttribute('data-utc', whenISO);
      nextWhen.setAttribute('title', `Start (UTC): ${new Date(whenISO).toUTCString()}`);
    } catch (e) {
      nextWhen.textContent = 'Unable to load schedule';
    }
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
          <label>Publishable API Key (optional – proxy can use server env)
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

      // Local convenience for you
      localStorage.setItem('dj-selects-config', JSON.stringify(shared));

      // Server save (shared for everyone) if token configured
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

      applyConfig();
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

  /* ---------------- apply to UI ---------------- */

  function applyConfig() {
    djNameText.textContent = shared.djName || 'DJ NAME';
    if (shared.profileImage) djProfile.src = shared.profileImage;

    const embeds = (shared.tracks || []).map(toEmbed).filter(Boolean);
    renderStrips(embeds);

    // Radio Cult lookups
    loadDjImage();
    loadNextShow();
  }

  /* ---------------- BOOT ---------------- */

  window.addEventListener('DOMContentLoaded', async () => {
    await loadSharedConfig();
    applyConfig();
    ensureAdmin();
  });
})();

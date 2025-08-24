/* DJ Selects — front-end (times shown in viewer's local timezone) */
(() => {
  const CFG = window.DJ_SELECTS || {};

  const $ = (sel, root=document) => root.querySelector(sel);
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

  /* ---------- helpers ---------- */

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

  // NEW: format in the viewer's local timezone (no explicit timeZone set)
  const fmtLocal = (iso) => {
    try {
      const d = new Date(iso);
      const opts = {
        weekday:'short',
        day:'numeric',
        month:'short',
        hour:'2-digit',
        minute:'2-digit',
        hour12:false,
        timeZoneName:'short' // shows e.g., PDT, BST, AEST
      };
      return d.toLocaleString(undefined, opts);
    } catch { return ''; }
  };

  /* ---------- load shared config (server) ---------- */
  async function loadSharedConfig() {
    try {
      const res = await fetch(`${CFG.CONFIG_ENDPOINT}?action=load`, {cache:'no-store'});
      if (!res.ok) throw new Error('load failed');
      const data = await res.json();
      if (data && data.djName) shared = {...shared, ...data};
    } catch (e) {
      const raw = localStorage.getItem('dj-selects-config');
      if (raw) shared = {...shared, ...JSON.parse(raw)};
    }
  }

  /* ---------- next scheduled show via RC proxy ---------- */
  async function loadNextShow() {
    nextWhen.textContent = 'Loading…';
    try {
      const url = `${CFG.PROXY_ENDPOINT}?fn=upcoming&stationId=${encodeURIComponent(shared.stationId)}&limit=50`;
      const res = await fetch(url, { headers: { 'Accept':'application/json' }});
      if (!res.ok) throw new Error('proxy error');
      const payload = await res.json();
      const list = (payload?.data || payload || []);
      const target = list.find(evt => {
        const nm = (evt?.artist?.name || evt?.presenter?.name || evt?.name || '').toLowerCase();
        return nm.includes((shared.djName||'').toLowerCase());
      });
      if (!target) { nextWhen.textContent = 'No upcoming show found'; return; }

      const whenISO = target?.startDate || target?.start || target?.scheduledStart || target?.start_time || '';
      if (!whenISO) { nextWhen.textContent = 'TBA'; return; }

      // show in viewer's local time + zone abbreviation
      nextWhen.textContent = fmtLocal(whenISO);
      nextWhen.setAttribute('data-utc', whenISO); // useful for debugging/QA if needed
      nextWhen.setAttribute('title', `Start (UTC): ${new Date(whenISO).toUTCString()}`);
      
      // try profile image from event if present
      const img = target?.artist?.image || target?.presenter?.image || '';
      if (img && !shared.profileImage) djProfile.src = img;
    } catch (e) {
      nextWhen.textContent = 'Unable to load schedule';
    }
  }

  /* ---------- admin UI (hidden until auth) ---------- */
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
          <input type="text" id="adminDjName" placeholder="e.g., MARIONETTE" value="\${shared.djName}">
        </label>

        <div class="two-col">
          <label>Station ID
            <input type="text" id="adminStationId" placeholder="cutters-choice-radio" value="\${shared.stationId}">
          </label>
          <label>Publishable API Key (optional – proxy can use server env)
            <input type="text" id="adminApiKey" placeholder="pk_..." value="\${shared.apiKey}">
          </label>
        </div>

        <label>Profile Image URL (optional)
          <input type="text" id="profileOverride" placeholder="https://..." value="\${shared.profileImage || ''}">
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
          <input type="url" placeholder="https://www.youtube.com/watch?v=..." value="\${val||''}">
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
      shared.djName     = panel.querySelector('#adminDjName').value.trim() || shared.djName;
      shared.stationId  = panel.querySelector('#adminStationId').value.trim() || shared.stationId;
      shared.apiKey     = panel.querySelector('#adminApiKey').value.trim();
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
        } catch (e) {
          alert('Server save failed — check token & file permissions.');
        }
      } else {
        alert('Saved locally. To save for everyone, set SAVE_TOKEN in dj-selects.html and dj-selects-config.php.');
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

  /* ---------- apply to UI ---------- */
  function applyConfig() {
    djNameText.textContent = shared.djName || 'DJ NAME';
    if (shared.profileImage) djProfile.src = shared.profileImage;
    const embeds = (shared.tracks || []).map(toEmbed).filter(Boolean);
    renderStrips(embeds);
    loadNextShow();
  }

  /* ---------- BOOT ---------- */
  window.addEventListener('DOMContentLoaded', async () => {
    await loadSharedConfig();
    applyConfig();
    ensureAdmin();
  });
})();

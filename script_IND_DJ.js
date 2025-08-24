/* DJ Selects — robust schedule + equal-height strips (viewer-local times) */
(() => {
  const CFG = window.DJ_SELECTS || {};

  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => [...r.querySelectorAll(s)];

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
    return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
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
    sizeStripsSoon();
  };

  const renderStrips = (embeds) => {
    stripList.innerHTML = '';
    embeds.slice(0,5).forEach((src, i) => {
      const el = document.createElement('div');
      el.className = 'strip';
      el.innerHTML = iframeAttrs(src, false) + '<div class="select-overlay" aria-hidden="true"></div>';
      el.querySelector('.select-overlay').addEventListener('click', () => {
        $$('.strip').forEach(s => s.classList.remove('selected'));
        el.classList.add('selected');
        setPreview(src);
      });
      stripList.appendChild(el);
      if (i === 0) { el.classList.add('selected'); setPreview(src); }
    });
    if (!embeds.length) mainPreview.innerHTML = '<div class="big-placeholder">Select a track</div>';
    sizeStripsSoon();
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
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');

  const nameEq = (a,b) => {
    const A=(a||'').trim().toLowerCase(), B=(b||'').trim().toLowerCase();
    return A && B && (A===B || slug(A)===slug(B));
  };

  const firstImageUrl = (o) => {
    if (!o) return '';
    return (
      (o.logo && (o.logo['512x512'] || o.logo.default)) ||
      o.image || o.imageUrl || o.avatar || o.avatarUrl ||
      (Array.isArray(o.images) && o.images.length && (o.images[0].url || o.images[0].src)) ||
      ''
    );
  };

  const fetchJSON = async (url) => {
    const r = await fetch(url, { headers:{'Accept':'application/json'}, cache:'no-store' });
    if (!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  };

  /* ---------- config store (server) ---------- */
  async function loadSharedConfig() {
    try {
      const r = await fetch(`${CFG.CONFIG_ENDPOINT}?action=load`, {cache:'no-store'});
      if (!r.ok) throw 0;
      const data = await r.json();
      if (data && data.djName) shared = {...shared, ...data};
    } catch {
      const raw = localStorage.getItem('dj-selects-config');
      if (raw) shared = {...shared, ...JSON.parse(raw)};
    }
  }

  /* ---------- Radio Cult via proxy ---------- */
  // Return {kind:'artist'|'presenter', id, obj}
  async function findContributor() {
    const base = `${CFG.PROXY_ENDPOINT}?stationId=${encodeURIComponent(shared.stationId)}`;
    const [artists, presenters] = await Promise.all([
      fetchJSON(`${base}&fn=artists`).then(j => j?.artists || j?.data || j || []).catch(()=>[]),
      fetchJSON(`${base}&fn=presenters`).then(j => j?.presenters || j?.data || j || []).catch(()=>[])
    ]);

    const nm = shared.djName;

    const from = (arr, kind) => {
      const hit = arr.find(x => nameEq(x?.name, nm))
              || arr.find(x => slug(x?.name) === slug(nm))
              || arr.find(x => (x?.name||'').toLowerCase().includes(nm.toLowerCase()));
      return hit ? { kind, id: hit.id || hit._id || hit.slug || hit.uuid || hit.name, obj: hit } : null;
    };

    return from(artists, 'artist') || from(presenters, 'presenter');
  }

  async function loadDjImage() {
    if (shared.profileImage && !/default-dj\.png$/i.test(shared.profileImage)) return; // manual override in admin
    try {
      const who = await findContributor();
      const img = firstImageUrl(who?.obj);
      if (img) djProfile.src = img;
    } catch {/* keep default */}
  }

  async function loadNextShow() {
    nextWhen.textContent = 'Loading…';

    const pickSoonest = (arr) => {
      const getIso = (s) => s.startDateUtc || s.startDate || s.start || s.scheduledStart || s.start_time || s.start_at;
      const now = new Date();
      return arr
        .map(s => ({ raw:s, t: new Date(getIso(s) || 0) }))
        .filter(x => x.t instanceof Date && !isNaN(x.t) && x.t > now)
        .sort((a,b)=> a.t - b.t)[0]?.raw || null;
    };

    try {
      const who = await findContributor();

      // 1) Prefer direct schedule on artist/presenter
      if (who?.id) {
        const now = new Date().toISOString();
        const end = new Date(Date.now() + 365*24*60*60*1000).toISOString();
        const fn  = who.kind === 'presenter' ? 'presenter_schedule' : 'artist_schedule';
        const url = `${CFG.PROXY_ENDPOINT}?fn=${fn}&stationId=${encodeURIComponent(shared.stationId)}&${who.kind}Id=${encodeURIComponent(who.id)}&startDate=${encodeURIComponent(now)}&endDate=${encodeURIComponent(end)}`;

        const j = await fetchJSON(url);
        const schedules = j?.schedules || j?.data || j?.items || [];
        const next = pickSoonest(schedules) || schedules[0] || null;

        const whenISO = next && (next.startDateUtc || next.startDate || next.start || next.scheduledStart);
        if (whenISO) {
          nextWhen.textContent = fmtLocal(whenISO);
          nextWhen.setAttribute('data-utc', whenISO);
          nextWhen.title = `Start (UTC): ${new Date(whenISO).toUTCString()}`;
          // opportunistic image
          if (/default-dj\.png$/i.test(djProfile.src||'')) {
            const img = firstImageUrl(j?.artist) || firstImageUrl(j?.presenter) || firstImageUrl(who.obj);
            if (img) djProfile.src = img;
          }
          return;
        }
      }

      // 2) Fallback to station /upcoming expanded and match by name or tag
      const u = `${CFG.PROXY_ENDPOINT}?fn=upcoming&stationId=${encodeURIComponent(shared.stationId)}&limit=200&expand=artist,presenter`;
      const up = await fetchJSON(u);
      const list = up?.data || up?.items || up || [];
      const nm = shared.djName, djSlug = slug(nm);

      const byNameOrTag = list.filter(e => {
        const n = (e?.artist?.name || e?.presenter?.name || e?.name || e?.title || '').toLowerCase();
        const tagHit = (e?.tags || e?.categories || [])
          .map(t => typeof t === 'string' ? t : (t?.slug || t?.name || ''))
          .map(slug)
          .includes(djSlug);
        return n.includes(nm.toLowerCase()) || tagHit;
      });

      const next = pickSoonest(byNameOrTag) || pickSoonest(list);
      const whenISO = next && (next.startDate || next.start || next.startDateUtc || next.scheduledStart || next.start_time || next.start_at);

      if (whenISO) {
        nextWhen.textContent = fmtLocal(whenISO);
        nextWhen.setAttribute('data-utc', whenISO);
        nextWhen.title = `Start (UTC): ${new Date(whenISO).toUTCString()}`;
        if (/default-dj\.png$/i.test(djProfile.src||'')) {
          const img = firstImageUrl(next.artist) || firstImageUrl(next.presenter) || next.image || '';
          if (img) djProfile.src = img;
        }
      } else {
        nextWhen.textContent = 'No upcoming show found';
      }
    } catch {
      nextWhen.textContent = 'Unable to load schedule';
    }
  }

  /* ---------- even 5-row strips that fill the column ---------- */
  function sizeStrips() {
    // match the preview column height
    const h = mainPreview.getBoundingClientRect().height;
    if (h > 0) {
      stripList.style.height = `${h}px`;
      stripList.style.display = 'grid';
      stripList.style.gridTemplateRows = 'repeat(5, 1fr)';
    }
  }
  const sizeStripsSoon = () => setTimeout(sizeStrips, 60);
  window.addEventListener('resize', sizeStripsSoon);
  // in case the iframe reflows later
  const ro = new ResizeObserver(sizeStripsSoon);
  ro.observe(mainPreview);

  /* ---------- admin ---------- */
  function renderAdmin() {
    const btn = document.createElement('button');
    btn.className = 'admin-btn';
    btn.innerHTML = '<i class="fa-solid fa-gear" aria-hidden="true"></i>';

    const panel = document.createElement('div');
    panel.className = 'admin-panel';
    panel.innerHTML = `
      <div class="admin-head">
        <strong>DJ SELECTS — Admin</strong>
        <button id="x" class="admin-close" aria-label="Close">&times;</button>
      </div>
      <div class="admin-body">
        <label>DJ Name<input id="aDj" value="${shared.djName}"></label>
        <div class="two-col">
          <label>Station ID<input id="aSt" value="${shared.stationId}"></label>
          <label>Publishable API Key (optional)<input id="aKey" placeholder="pk_..." value="${shared.apiKey}"></label>
        </div>
        <label>Profile Image URL<input id="aImg" value="${shared.profileImage||''}"></label>
        <div class="admin-subhead" style="margin:.5rem 0 .25rem;font-family:'Bebas Neue',sans-serif;font-size:1.3rem;">YouTube Track URLs (up to 5)</div>
        <div id="aTracks"></div>
        <div class="admin-actions">
          <button id="save" class="primary">Save</button>
          <button id="logout" class="ghost">Logout</button>
          <button id="reset" class="danger">Reset (local only)</button>
        </div>
      </div>`;

    adminMount.after(btn, panel);
    adminMount.remove();

    const close = () => panel.classList.remove('open');
    btn.onclick = () => panel.classList.add('open');
    panel.querySelector('#x').onclick = close;

    const wrap = panel.querySelector('#aTracks');
    const draw = () => {
      wrap.innerHTML = '';
      [...shared.tracks, '', '', '', ''].slice(0,5).forEach(v => {
        const row = document.createElement('div');
        row.className = 'track-input';
        row.innerHTML = `
          <input type="url" value="${v||''}" placeholder="https://www.youtube.com/watch?v=...">
          <button data-a="clear">Clear</button>
          <button data-a="paste">Paste</button>`;
        row.querySelector('[data-a="clear"]').onclick = () => row.querySelector('input').value = '';
        row.querySelector('[data-a="paste"]').onclick = async () => {
          try { row.querySelector('input').value = await navigator.clipboard.readText(); } catch {}
        };
        wrap.appendChild(row);
      });
    };
    draw();

    panel.querySelector('#save').onclick = async () => {
      shared.djName       = panel.querySelector('#aDj').value.trim() || shared.djName;
      shared.stationId    = panel.querySelector('#aSt').value.trim() || shared.stationId;
      shared.apiKey       = panel.querySelector('#aKey').value.trim();
      shared.profileImage = panel.querySelector('#aImg').value.trim();
      shared.tracks       = $$('#aTracks input', panel).map(i=>i.value.trim()).filter(Boolean).slice(0,5);

      localStorage.setItem('dj-selects-config', JSON.stringify(shared));
      try {
        const r = await fetch(`${CFG.CONFIG_ENDPOINT}?action=save`, {
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ token: CFG.SAVE_TOKEN, data: shared })
        });
        if (!r.ok) throw 0;
        alert('Saved to server. Live for everyone.');
      } catch {
        alert('Saved locally. To save for everyone, ensure SAVE_TOKEN matches $SERVER_TOKEN in dj-selects-config.php.');
      }

      apply();
      close();
    };

    panel.querySelector('#logout').onclick = () => {
      sessionStorage.removeItem('dj-selects-auth');
      location.reload();
    };
    panel.querySelector('#reset').onclick = () => {
      localStorage.removeItem('dj-selects-config');
      alert('Local data cleared. Reloading…'); location.reload();
    };
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

  /* ---------- apply + boot ---------- */
  function apply() {
    djNameText.textContent = shared.djName || 'DJ NAME';
    if (shared.profileImage) djProfile.src = shared.profileImage;

    const embeds = (shared.tracks || []).map(toEmbed).filter(Boolean);
    renderStrips(embeds);

    loadDjImage();
    loadNextShow();
  }

  window.addEventListener('DOMContentLoaded', async () => {
    await loadSharedConfig();
    apply();
    ensureAdmin();
    sizeStripsSoon();
  });
})();

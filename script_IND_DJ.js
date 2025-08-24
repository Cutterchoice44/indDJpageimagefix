/* DJ Selects — robust schedule + equal-height strips */
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
    tracks: [],
    contributorId: '',           // NEW: manual artist/presenter id override
    contributorKind: 'auto'      // 'auto' | 'artist' | 'presenter'
  };

  /* ---------- utils ---------- */
  const sha256hex = async (t) => {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
    return [...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
  };
  const toEmbed = (u) => {
    if (!u) return null;
    try {
      const x = new URL(u.trim());
      if (x.hostname.includes('youtu')) {
        let id='';
        if (x.hostname==='youtu.be') id=x.pathname.slice(1);
        else if (x.pathname.startsWith('/shorts/')) id=x.pathname.split('/')[2]||'';
        else if (x.searchParams.get('v')) id=x.searchParams.get('v');
        else if (/^\/embed\//.test(x.pathname)) id=x.pathname.split('/').pop();
        id=(id||'').split('?')[0].split('&')[0];
        if (!id) return null;
        return `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1`;
      }
      return u;
    } catch { return null; }
  };
  const iframeAttrs = (src,big=false)=>`<iframe src="${src}" title="YouTube video" loading="${big?'eager':'lazy'}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>`;
  const setPreview = (src)=>{ mainPreview.innerHTML=`<div class="ratio big">${iframeAttrs(src,true)}</div>`; syncHeightsSoon(); };
  const renderStrips=(embeds)=>{ stripList.innerHTML=''; embeds.slice(0,5).forEach((src,i)=>{ const el=document.createElement('div'); el.className='strip'; el.innerHTML=iframeAttrs(src,false)+'<div class="select-overlay" aria-hidden="true"></div>'; el.querySelector('.select-overlay').addEventListener('click',()=>{ $$('.strip').forEach(s=>s.classList.remove('selected')); el.classList.add('selected'); setPreview(src); }); stripList.appendChild(el); if (i===0){ el.classList.add('selected'); setPreview(src); } }); if (!embeds.length) mainPreview.innerHTML='<div class="big-placeholder">Select a track</div>'; syncHeightsSoon(); };
  const fmtLocal = iso => { try{ const d=new Date(iso); return d.toLocaleString(undefined,{weekday:'short',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hour12:false,timeZoneName:'short'});}catch{ return ''; } };
  const slug = s => (s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  const nameEq=(a,b)=>{const A=(a||'').trim().toLowerCase(),B=(b||'').trim().toLowerCase();return A&&B&&(A===B||slug(A)===slug(B));};
  const firstImageUrl=o=> (o && ((o.logo && (o.logo['512x512']||o.logo.default)) || o.image || o.imageUrl || o.avatar || o.avatarUrl || (Array.isArray(o.images)&&o.images[0]&&(o.images[0].url||o.images[0].src)))) || '';

  const fetchJSON = async (url) => {
    const r = await fetch(url, {headers:{'Accept':'application/json'}, cache:'no-store'});
    if (!r.ok) throw new Error('HTTP '+r.status);
    return r.json();
  };

  /* ---------- persistence ---------- */
  async function loadSharedConfig(){
    try{
      const r=await fetch(`${CFG.CONFIG_ENDPOINT}?action=load`,{cache:'no-store'});
      if(!r.ok) throw 0;
      const data=await r.json();
      if (data && data.djName) shared={...shared, ...data};
    }catch{
      const raw=localStorage.getItem('dj-selects-config');
      if(raw) shared={...shared, ...JSON.parse(raw)};
    }
  }

  /* ---------- RC helpers ---------- */
  // Returns {kind,id,obj} using override or by name
  async function findContributor(){
    if (shared.contributorId) {
      return { kind: shared.contributorKind || 'auto', id: shared.contributorId, obj:null };
    }
    const base=`${CFG.PROXY_ENDPOINT}?stationId=${encodeURIComponent(shared.stationId)}`;
    const [artists,presenters]=await Promise.all([
      fetchJSON(`${base}&fn=artists`).then(j=>j?.artists||j?.data||j||[]).catch(()=>[]),
      fetchJSON(`${base}&fn=presenters`).then(j=>j?.presenters||j?.data||j||[]).catch(()=>[])
    ]);
    const nm=shared.djName;
    const from=(arr,kind)=>{
      const hit = arr.find(x=>nameEq(x?.name,nm)) || arr.find(x=>slug(x?.name)===slug(nm)) || arr.find(x=>(x?.name||'').toLowerCase().includes(nm.toLowerCase()));
      return hit ? {kind,id:(hit.id||hit._id||hit.slug||hit.uuid||hit.name),obj:hit} : null;
    };
    return from(artists,'artist') || from(presenters,'presenter') || {kind:'auto',id:'',obj:null};
  }

  async function trySchedule(kind, id, startISO, endISO){
    if (!id) return null;
    const fn = kind==='presenter' ? 'presenter_schedule' : 'artist_schedule';
    const url = `${CFG.PROXY_ENDPOINT}?fn=${fn}&stationId=${encodeURIComponent(shared.stationId)}&${kind}Id=${encodeURIComponent(id)}&startDate=${encodeURIComponent(startISO)}&endDate=${encodeURIComponent(endISO)}`;
    const j = await fetchJSON(url);
    const list = j?.schedules || j?.data || j?.items || [];
    if (!Array.isArray(list) || !list.length) return null;

    const getIso = (s)=> s.startDateUtc || s.startDate || s.start || s.scheduledStart || s.start_time || s.start_at;
    const now = new Date();
    const next = list
      .map(s=>({s, t:new Date(getIso(s)||0)}))
      .filter(x=>x.t instanceof Date && !isNaN(x.t) && x.t>now)
      .sort((a,b)=>a.t-b.t)[0]?.s || list[0];
    return {next, from: j};
  }

  async function loadDjImage(){
    if (shared.profileImage && !/default-dj\.png$/i.test(shared.profileImage)) return;
    try{
      const who=await findContributor();
      const img = firstImageUrl(who?.obj) || firstImageUrl(who?.artist) || firstImageUrl(who?.presenter);
      if (img) djProfile.src = img;
    }catch{}
  }

  async function loadNextShow(){
    nextWhen.textContent = 'Loading…';
    try{
      const who = await findContributor();
      const now = new Date();
      const end = new Date(now.getTime()+365*24*60*60*1000);
      const startISO = now.toISOString(), endISO = end.toISOString();

      let res = null;

      if (who.kind === 'artist' || who.kind === 'presenter') {
        res = await trySchedule(who.kind, who.id, startISO, endISO);
      } else {
        // auto: try artist then presenter with same id if user pasted one
        if (shared.contributorId) {
          res = await trySchedule('artist', shared.contributorId, startISO, endISO) ||
                await trySchedule('presenter', shared.contributorId, startISO, endISO);
        } else {
          // nothing certain; try name-derived: artist first then presenter
          const a = await trySchedule('artist', who.id, startISO, endISO);
          res = a || await trySchedule('presenter', who.id, startISO, endISO);
        }
      }

      if (!res) {
        // fallback to station upcoming expanded
        const u = `${CFG.PROXY_ENDPOINT}?fn=upcoming&stationId=${encodeURIComponent(shared.stationId)}&limit=200&expand=artist,presenter`;
        const up = await fetchJSON(u);
        const list = up?.data || up?.items || up || [];
        const nm = shared.djName, djSlug = slug(nm);
        const byName = list.filter(e=>{
          const n=(e?.artist?.name||e?.presenter?.name||e?.name||e?.title||'').toLowerCase();
          const tags=(e?.tags||e?.categories||[]).map(t=>typeof t==='string'?t:(t?.slug||t?.name||'')).map(slug);
          return n.includes(nm.toLowerCase()) || tags.includes(djSlug);
        });
        const getIso=e=>e.startDate||e.start||e.startDateUtc||e.scheduledStart||e.start_time||e.start_at;
        const future = byName
          .map(s=>({s, t:new Date(getIso(s)||0)}))
          .filter(x=>x.t>new Date())
          .sort((a,b)=>a.t-b.t)[0]?.s || null;
        if (future) res = {next: future, from: up};
      }

      if (res && res.next) {
        const whenISO = res.next.startDateUtc || res.next.startDate || res.next.start || res.next.scheduledStart || res.next.start_time || res.next.start_at;
        if (whenISO) {
          nextWhen.textContent = fmtLocal(whenISO);
          nextWhen.setAttribute('data-utc', whenISO);
          nextWhen.title = `Start (UTC): ${new Date(whenISO).toUTCString()}`;
        } else {
          nextWhen.textContent = 'TBA';
        }
        if (/default-dj\.png$/i.test(djProfile.src||'')) {
          const img = firstImageUrl(res.from?.artist) || firstImageUrl(res.from?.presenter) || firstImageUrl(res.next?.artist) || firstImageUrl(res.next?.presenter);
          if (img) djProfile.src = img;
        }
        return;
      }

      nextWhen.textContent = 'No upcoming show found';
    }catch{
      nextWhen.textContent = 'Unable to load schedule';
    }
  }

  /* ---------- equal-height 5-row sidebar ---------- */
  function syncHeights(){
    const ratio = mainPreview.querySelector('.ratio.big');
    const h = (ratio && ratio.getBoundingClientRect().height) || mainPreview.getBoundingClientRect().height;
    if (h > 0) {
      stripList.style.height = h + 'px';
      stripList.style.display = 'grid';
      stripList.style.gridTemplateRows = 'repeat(5, 1fr)';
    }
  }
  const syncHeightsSoon = () => setTimeout(syncHeights, 60);
  new ResizeObserver(syncHeights).observe(mainPreview);
  window.addEventListener('resize', syncHeightsSoon);
  setInterval(syncHeights, 800); // keep it in sync during dynamic loads

  /* ---------- admin ---------- */
  function renderAdmin(){
    const btn=document.createElement('button'); btn.className='admin-btn'; btn.innerHTML='<i class="fa-solid fa-gear"></i>';

    const panel=document.createElement('div'); panel.className='admin-panel';
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

        <div class="two-col">
          <label>Schedule type
            <select id="aKind">
              <option value="auto" ${shared.contributorKind==='auto'?'selected':''}>Auto (try both)</option>
              <option value="artist" ${shared.contributorKind==='artist'?'selected':''}>Artist</option>
              <option value="presenter" ${shared.contributorKind==='presenter'?'selected':''}>Presenter</option>
            </select>
          </label>
          <label>Artist/Presenter ID (optional)
            <input type="text" id="aId" placeholder="e.g. 25b015d2-01a5-4abb-8e2c-c5d425e0483d" value="${shared.contributorId||''}">
          </label>
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

    adminMount.after(btn, panel); adminMount.remove();

    const close=()=>panel.classList.remove('open'); btn.onclick=()=>panel.classList.add('open'); panel.querySelector('#x').onclick=close;

    const wrap=panel.querySelector('#aTracks');
    const draw=()=>{ wrap.innerHTML=''; [...shared.tracks,'','','',''].slice(0,5).forEach(v=>{ const row=document.createElement('div'); row.className='track-input'; row.innerHTML=`<input type="url" value="${v||''}" placeholder="https://www.youtube.com/watch?v=..."><button data-a="clear">Clear</button><button data-a="paste">Paste</button>`; row.querySelector('[data-a="clear"]').onclick=()=>row.querySelector('input').value=''; row.querySelector('[data-a="paste"]').onclick=async()=>{ try{ row.querySelector('input').value=await navigator.clipboard.readText(); }catch{} }; wrap.appendChild(row); }); };
    draw();

    panel.querySelector('#save').onclick = async () => {
      shared.djName        = panel.querySelector('#aDj').value.trim() || shared.djName;
      shared.stationId     = panel.querySelector('#aSt').value.trim() || shared.stationId;
      shared.apiKey        = panel.querySelector('#aKey').value.trim();
      shared.profileImage  = panel.querySelector('#aImg').value.trim();
      shared.contributorId = panel.querySelector('#aId').value.trim();
      shared.contributorKind = panel.querySelector('#aKind').value;
      shared.tracks        = $$('#aTracks input', panel).map(i=>i.value.trim()).filter(Boolean).slice(0,5);

      localStorage.setItem('dj-selects-config', JSON.stringify(shared));
      try {
        const r = await fetch(`${CFG.CONFIG_ENDPOINT}?action=save`, {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ token: CFG.SAVE_TOKEN, data: shared })
        });
        if (!r.ok) throw 0;
        alert('Saved to server. Live for everyone.');
      } catch {
        alert('Saved locally. To save for everyone, ensure tokens match.');
      }

      apply(); close();
    };

    panel.querySelector('#logout').onclick = () => { sessionStorage.removeItem('dj-selects-auth'); location.reload(); };
    panel.querySelector('#reset').onclick  = () => { localStorage.removeItem('dj-selects-config'); alert('Local data cleared. Reloading…'); location.reload(); };
  }

  async function ensureAdmin(){
    const prompt=async()=>{ const p=window.prompt('Enter admin passphrase:'); if(!p) return; const ok=await sha256hex(p)===CFG.ADMIN_HASH_HEX; if(ok){ sessionStorage.setItem('dj-selects-auth','1'); renderAdmin(); } else alert('Wrong passphrase.'); };
    if(new URLSearchParams(location.search).get('admin')==='1') await prompt();
    document.addEventListener('keydown', async e=>{ if(e.key.toLowerCase()==='a' && e.shiftKey) await prompt(); });
    if(sessionStorage.getItem('dj-selects-auth')==='1') renderAdmin();
  }

  function apply(){
    djNameText.textContent = shared.djName || 'DJ NAME';
    if (shared.profileImage) djProfile.src = shared.profileImage;
    const embeds=(shared.tracks||[]).map(toEmbed).filter(Boolean);
    renderStrips(embeds);
    loadDjImage();
    loadNextShow();
  }

  window.addEventListener('DOMContentLoaded', async ()=>{
    await loadSharedConfig();
    apply();
    ensureAdmin();
    syncHeightsSoon();
  });
})();

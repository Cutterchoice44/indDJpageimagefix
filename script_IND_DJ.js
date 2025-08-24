/* DJ SELECTS — proxy-first, robust endpoints, silent fallbacks */

(function(){
  const DEFAULTS = {
    djName: "MARIONETTE",
    stationSlug: "cutters-choice-radio",
    tracks: ["","","","",""],
    profileImageOverride: "" // admin manual override if API image is unavailable
  };
  const ADMIN = { passphrase: "scissors", isAuthed: false };

  const els = {
    djNameText:  document.getElementById('djNameText'),
    nextWhen:    document.getElementById('nextShowWhen'),
    profileImg:  document.getElementById('djProfileImg'),
    profileCred: document.getElementById('djProfileCredit'),
    trackList:   document.getElementById('trackList'),

    adminBtn:    document.getElementById('adminBtn'),
    adminPanel:  document.getElementById('adminPanel'),
    adminClose:  document.getElementById('adminClose'),
    adminPass:   document.getElementById('adminPass'),
    adminDjName: document.getElementById('adminDjName'),
    adminStation:document.getElementById('adminStation'),
    adminApiKey: document.getElementById('adminApiKey'), // ignored now
    adminTracks: document.getElementById('adminTracks'),
    adminSave:   document.getElementById('adminSave'),
    adminLogout: document.getElementById('adminLogout'),
    adminReset:  document.getElementById('adminReset')
  };

  const STORAGE_KEY = 'djSelects.config';
  const normalizeTracks = a => { a = Array.isArray(a)?a.slice(0,5):[]; while(a.length<5)a.push(""); return a; };
  const loadConfig = () => { try{ const raw=localStorage.getItem(STORAGE_KEY); if(!raw) return {...DEFAULTS}; const p=JSON.parse(raw); return {...DEFAULTS, ...p, tracks: normalizeTracks(p.tracks||[]) }; }catch{ return {...DEFAULTS}; } };
  const saveConfig = cfg => localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  let CONFIG = loadConfig();

  const fmt = new Intl.DateTimeFormat(undefined,{weekday:'short', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'});

  function toEmbed(url){
    if(!url) return null; try{
      const u=new URL(url); let id='';
      if(u.hostname.includes('youtu.be')) id=u.pathname.slice(1);
      else if(u.searchParams.get('v')) id=u.searchParams.get('v');
      else if(u.pathname.includes('/shorts/')) id=u.pathname.split('/shorts/')[1];
      else if(u.pathname.includes('/embed/')) id=u.pathname.split('/embed/')[1];
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }catch{return null;}
  }

  function renderTracks(){
    els.trackList.innerHTML='';
    normalizeTracks(CONFIG.tracks).forEach((u)=>{
      const card=document.createElement('div'); card.className='yt-card';
      const ratio=document.createElement('div'); ratio.className='ratio';
      const embed=toEmbed(u);
      if(embed){
        const ifr=document.createElement('iframe');
        ifr.src=embed; ifr.loading='lazy';
        ifr.allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        ifr.referrerPolicy='strict-origin-when-cross-origin';
        ratio.appendChild(ifr);
      }else{
        const ph=document.createElement('div'); ph.style.display='grid'; ph.style.placeItems='center';
        ph.style.color='#777'; ph.style.fontFamily="'Bebas Neue', sans-serif"; ph.style.fontSize='1.2rem';
        ph.textContent='Add YouTube URL'; ratio.appendChild(ph);
      }
      card.appendChild(ratio); els.trackList.appendChild(card);
    });
  }

  // ---- proxy helpers ----
  const ENDPOINTS = {
    upcoming:   slug => `/rc-proxy.php?fn=upcoming&slug=${encodeURIComponent(slug)}&t=${Date.now()}`,
    djs:        slug => `/rc-proxy.php?fn=djs&slug=${encodeURIComponent(slug)}&t=${Date.now()}`,
    artists:    slug => `/rc-proxy.php?fn=artists&slug=${encodeURIComponent(slug)}&t=${Date.now()}`,
    presenters: slug => `/rc-proxy.php?fn=presenters&slug=${encodeURIComponent(slug)}&t=${Date.now()}`
  };
  const asJson = async (res) => { const text=await res.text(); try{ return JSON.parse(text); } catch { return { error:'parse_failed', body:text, status:res.status }; } };
  const jget = async url => asJson(await fetch(url, { headers:{'Accept':'application/json'} }));

  async function fetchNextShow(djName, slug){
    const data = await jget(ENDPOINTS.upcoming(slug));
    const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
    let next = null;
    if (djName) {
      const needle = djName.toLowerCase();
      next = items.find(it => (it?.djName || it?.artist || it?.title || '').toString().toLowerCase().includes(needle));
    }
    if (!next) next = items[0];
    if (next && (next.startTime || next.start || next.startsAt)) {
      const t = new Date(next.startTime || next.start || next.startsAt);
      els.nextWhen.textContent = fmt.format(t);
    } else {
      els.nextWhen.textContent = 'No upcoming show found';
    }
    return next || null;
  }

  const extractImage = o => !o || typeof o!=='object' ? '' :
    (o.imageUrl || o.avatar || o.photoUrl || o.artworkUrl || (o.images && (o.images.large || o.images.medium || o.images.small)) || '');

  async function fetchDjProfile(djName, slug, nextFromSchedule){
    if (CONFIG.profileImageOverride) {
      els.profileImg.src = CONFIG.profileImageOverride;
      els.profileImg.alt = djName;
      els.profileCred.textContent = djName ? `Artist: ${djName}` : '';
      return;
    }
    const needle = (djName||'').trim().toLowerCase();
    const order = ['djs','artists','presenters'];
    let hit=null;

    for (const fn of order){
      const data = await jget(ENDPOINTS[fn](slug));
      const arr = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
      if (!arr || arr.length===0 || data?.error) { console.warn('Endpoint failed', fn, data?.error || data?.status); continue; }
      hit = arr.find(d => (d?.name||d?.displayName||'').toString().toLowerCase() === needle)
         || arr.find(d => (d?.name||d?.displayName||'').toString().toLowerCase().includes(needle));
      if (hit) break;
    }

    let url = extractImage(hit);
    if (!url && nextFromSchedule) {
      url = extractImage(nextFromSchedule) || extractImage(nextFromSchedule?.dj) || extractImage(nextFromSchedule?.artist);
    }

    if (url){
      els.profileImg.src = url;
      els.profileImg.alt = (hit?.displayName || hit?.name || djName || 'DJ');
      els.profileCred.textContent = hit?.displayName || hit?.name || djName ? `Artist: ${hit?.displayName || hit?.name || djName}` : '';
    } else {
      els.profileCred.textContent = ''; // silent on failure
    }
  }

  // Admin UI (adds Profile Image Override field)
  function openAdmin(){
    els.adminPanel.classList.add('open');
    els.adminDjName.value  = CONFIG.djName || '';
    els.adminStation.value = CONFIG.stationSlug || '';

    els.adminTracks.innerHTML='';
    normalizeTracks(CONFIG.tracks).forEach((u,i)=>{
      const row=document.createElement('div');
      row.className='track-input';
      row.innerHTML = `
        <input type="text" data-idx="${i}" value="${u||''}" placeholder="YouTube URL #${i+1}">
        <button data-up="${i}">&#8593;</button>
        <button data-down="${i}">&#8595;</button>
      `;
      els.adminTracks.appendChild(row);
    });

    if (!document.getElementById('profileOverride')) {
      const wrap=document.createElement('label');
      wrap.innerHTML = \`Profile Image Override (optional)<input type="text" id="profileOverride" placeholder="https://..." value="\${CONFIG.profileImageOverride||''}">\`;
      els.adminPanel.querySelector('.admin-body').insertBefore(wrap, els.adminTracks);
    } else {
      document.getElementById('profileOverride').value = CONFIG.profileImageOverride || '';
    }
  }
  function closeAdmin(){ els.adminPanel.classList.remove('open'); }
  function reorderTracks(from,to){
    const t=normalizeTracks(CONFIG.tracks);
    if(to<0||to>=t.length) return;
    const [m]=t.splice(from,1); t.splice(to,0,m);
    CONFIG.tracks=t; openAdmin();
  }

  els.adminBtn.addEventListener('click', ()=>{
    if(!ADMIN.isAuthed){
      const entered = prompt('Enter admin passphrase:');
      if(entered===ADMIN.passphrase){ ADMIN.isAuthed=true; document.body.classList.add('admin-mode'); openAdmin(); }
      else alert('Incorrect passphrase');
    } else openAdmin();
  });
  els.adminClose.addEventListener('click', closeAdmin);
  els.adminLogout.addEventListener('click', ()=>{ ADMIN.isAuthed=false; document.body.classList.remove('admin-mode'); closeAdmin(); });
  els.adminTracks.addEventListener('click', (e)=>{ const up=e.target.getAttribute('data-up'); const down=e.target.getAttribute('data-down'); if(up!==null) reorderTracks(parseInt(up,10), parseInt(up,10)-1); if(down!==null) reorderTracks(parseInt(down,10), parseInt(down,10)+1); });
  els.adminTracks.addEventListener('input', (e)=>{ if(e.target.tagName==='INPUT'){ const idx=parseInt(e.target.getAttribute('data-idx'),10); const t=normalizeTracks(CONFIG.tracks); t[idx]=e.target.value.trim(); CONFIG.tracks=t; }});
  els.adminSave.addEventListener('click', ()=>{
    CONFIG.djName      = els.adminDjName.value.trim()  || DEFAULTS.djName;
    CONFIG.stationSlug = els.adminStation.value.trim() || DEFAULTS.stationSlug;
    const ovr = document.getElementById('profileOverride'); CONFIG.profileImageOverride = ovr ? ovr.value.trim() : '';
    saveConfig(CONFIG); closeAdmin(); boot();
  });
  els.adminReset.addEventListener('click', ()=>{ if(confirm('Reset DJ Selects to defaults?')){ CONFIG={...DEFAULTS}; saveConfig(CONFIG); closeAdmin(); boot(); } });

  async function boot(){
    CONFIG = loadConfig();
    els.djNameText.textContent = CONFIG.djName || 'DJ NAME';
    renderTracks();
    const next = await fetchNextShow(CONFIG.djName, CONFIG.stationSlug);
    await fetchDjProfile(CONFIG.djName, CONFIG.stationSlug, next);
  }

  boot();
})();

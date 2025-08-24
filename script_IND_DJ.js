/* DJ SELECTS — uses server-side rc-proxy.php now (no browser API key needed) */

(function(){
  const DEFAULTS = {
    djName: "MARIONETTE",
    stationSlug: "cutters-choice-radio",
    // apiKey kept for backward compatibility but not used by the proxy:
    apiKey: "",
    tracks: ["","","","",""]
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
    adminApiKey: document.getElementById('adminApiKey'), // harmless if present
    adminTracks: document.getElementById('adminTracks'),
    adminSave:   document.getElementById('adminSave'),
    adminLogout: document.getElementById('adminLogout'),
    adminReset:  document.getElementById('adminReset')
  };

  const STORAGE_KEY = 'djSelects.config';
  function normalizeTracks(arr){ const t = Array.isArray(arr)?arr.slice(0,5):[]; while(t.length<5)t.push(""); return t; }
  function loadConfig(){
    try{ const raw = localStorage.getItem(STORAGE_KEY);
      if(!raw) return {...DEFAULTS};
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed, tracks: normalizeTracks(parsed.tracks||[]) };
    }catch{ return {...DEFAULTS}; }
  }
  function saveConfig(cfg){ localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); }
  let CONFIG = loadConfig();

  // Formatting
  const fmt = new Intl.DateTimeFormat(undefined, { weekday:'short', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });

  // YouTube embedder
  function toEmbed(url){
    if(!url) return null;
    try{
      const u = new URL(url);
      let id='';
      if(u.hostname.includes('youtu.be')) id=u.pathname.slice(1);
      else if(u.searchParams.get('v')) id=u.searchParams.get('v');
      else if(u.pathname.includes('/shorts/')) id=u.pathname.split('/shorts/')[1];
      else if(u.pathname.includes('/embed/')) id=u.pathname.split('/embed/')[1];
      return id ? `https://www.youtube-nocookie.com/embed/${id}` : null;
    }catch{return null;}
  }

  // Render tracks
  function renderTracks(){
    els.trackList.innerHTML = '';
    normalizeTracks(CONFIG.tracks).forEach((u)=>{
      const wrap = document.createElement('div'); wrap.className='yt-card';
      const ratio = document.createElement('div'); ratio.className='ratio';
      const embed = toEmbed(u);
      if(embed){
        const ifr = document.createElement('iframe');
        ifr.src = embed;
        ifr.loading='lazy';
        ifr.allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        ifr.referrerPolicy='strict-origin-when-cross-origin';
        ratio.appendChild(ifr);
      }else{
        const ph = document.createElement('div');
        ph.style.display='grid'; ph.style.placeItems='center'; ph.style.color='#777';
        ph.style.fontFamily="'Bebas Neue', sans-serif"; ph.style.fontSize='1.2rem';
        ph.textContent='Add YouTube URL';
        ratio.appendChild(ph);
      }
      wrap.appendChild(ratio);
      els.trackList.appendChild(wrap);
    });
  }

  // ----- PROXY endpoints -----
  const ENDPOINTS = {
    upcoming: (slug)=> `/rc-proxy.php?fn=upcoming&slug=${encodeURIComponent(slug)}&t=${Date.now()}`,
    djs:      (slug)=> `/rc-proxy.php?fn=djs&slug=${encodeURIComponent(slug)}&t=${Date.now()}`
  };
  async function jfetch(url){
    const res = await fetch(url, { headers: { 'Accept':'application/json' }});
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function fetchNextShow(djName, slug){
    try{
      const data = await jfetch(ENDPOINTS.upcoming(slug));
      const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
      let next = null;
      if (djName){
        const needle = djName.toLowerCase();
        next = items.find(it => (it?.djName || it?.artist || it?.title || '')
          .toString().toLowerCase().includes(needle));
      }
      if(!next) next = items[0];
      if (next?.startTime || next?.start || next?.startsAt) {
        const t = new Date(next.startTime || next.start || next.startsAt);
        els.nextWhen.textContent = fmt.format(t);
      } else {
        els.nextWhen.textContent = 'No upcoming show found';
      }
    }catch(e){
      console.warn('Next-show error', e);
      els.nextWhen.textContent = 'Unable to load';
    }
  }

  async function fetchDjProfile(djName, slug){
    try{
      const list = await jfetch(ENDPOINTS.djs(slug));
      const arr = Array.isArray(list?.items) ? list.items : (Array.isArray(list) ? list : []);
      const needle = (djName||'').trim().toLowerCase();
      let hit = arr.find(d => (d?.name||d?.displayName||'').toString().toLowerCase() === needle);
      if (!hit) hit = arr.find(d => (d?.name||d?.displayName||'').toString().toLowerCase().includes(needle));
      const url = hit?.imageUrl || hit?.avatar || hit?.photoUrl || hit?.artworkUrl;
      if (url){
        els.profileImg.src = url;
        els.profileImg.alt = hit?.displayName || hit?.name || djName;
        els.profileCred.textContent = hit?.displayName || hit?.name ? `Artist: ${hit.displayName || hit.name}` : '';
      } else {
        els.profileCred.textContent = '';
      }
    }catch(e){
      console.warn('DJ profile error', e);
      // keep default image
      els.profileCred.textContent = '';
    }
  }

  // Admin UI
  function openAdmin(){
    els.adminPanel.classList.add('open');
    els.adminDjName.value  = CONFIG.djName || '';
    els.adminStation.value = CONFIG.stationSlug || '';
    if (els.adminApiKey) els.adminApiKey.value = ''; // ignored now
    els.adminTracks.innerHTML = '';
    normalizeTracks(CONFIG.tracks).forEach((u,i)=>{
      const row = document.createElement('div');
      row.className='track-input';
      row.innerHTML = `
        <input type="text" data-idx="${i}" value="${u||''}" placeholder="YouTube URL #${i+1}">
        <button data-up="${i}">&#8593;</button>
        <button data-down="${i}">&#8595;</button>
      `;
      els.adminTracks.appendChild(row);
    });
  }
  function closeAdmin(){ els.adminPanel.classList.remove('open'); }
  function reorderTracks(from,to){
    const t = normalizeTracks(CONFIG.tracks);
    if (to<0||to>=t.length) return;
    const [m] = t.splice(from,1); t.splice(to,0,m);
    CONFIG.tracks = t; openAdmin();
  }

  // Events
  els.adminBtn.addEventListener('click', ()=>{
    if(!ADMIN.isAuthed){
      const entered = prompt('Enter admin passphrase:');
      if (entered === ADMIN.passphrase){ ADMIN.isAuthed=true; document.body.classList.add('admin-mode'); openAdmin(); }
      else alert('Incorrect passphrase');
    } else openAdmin();
  });
  els.adminClose.addEventListener('click', closeAdmin);
  els.adminLogout.addEventListener('click', ()=>{ ADMIN.isAuthed=false; document.body.classList.remove('admin-mode'); closeAdmin(); });
  els.adminTracks.addEventListener('click', (e)=>{
    const up=e.target.getAttribute('data-up'); const down=e.target.getAttribute('data-down');
    if(up!==null) reorderTracks(parseInt(up,10), parseInt(up,10)-1);
    if(down!==null) reorderTracks(parseInt(down,10), parseInt(down,10)+1);
  });
  els.adminTracks.addEventListener('input', (e)=>{
    if(e.target.tagName==='INPUT'){
      const idx=parseInt(e.target.getAttribute('data-idx'),10);
      const t=normalizeTracks(CONFIG.tracks); t[idx]=e.target.value.trim(); CONFIG.tracks=t;
    }
  });
  els.adminSave.addEventListener('click', ()=>{
    CONFIG.djName      = els.adminDjName.value.trim()  || DEFAULTS.djName;
    CONFIG.stationSlug = els.adminStation.value.trim() || DEFAULTS.stationSlug;
    saveConfig(CONFIG); closeAdmin(); boot();
  });
  els.adminReset.addEventListener('click', ()=>{
    if(confirm('Reset DJ Selects to defaults?')){ CONFIG={...DEFAULTS}; saveConfig(CONFIG); closeAdmin(); boot(); }
  });

  async function boot(){
    CONFIG = loadConfig();
    els.djNameText.textContent = CONFIG.djName || 'DJ NAME';
    renderTracks();
    fetchNextShow(CONFIG.djName, CONFIG.stationSlug);
    fetchDjProfile(CONFIG.djName, CONFIG.stationSlug);
  }

  boot();
})();

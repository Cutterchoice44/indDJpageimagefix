(function(){
  const DEFAULTS = {
    djName: "MARIONETTE",
    stationId: "",                // REQUIRED (from RC API page)
    apiKey: "pk_0b8abc6f834b444f949f727e88a728e0", // safe publishable key
    tracks: ["","","","",""],
    profileImageOverride: ""
  };
  const ADMIN = { passphrase: "scissors", isAuthed:false };

  const els = {
    djNameText:  document.getElementById('djNameText'),
    nextWhen:    document.getElementById('nextShowWhen'),
    profileImg:  document.getElementById('djProfileImg'),
    profileCred: document.getElementById('djProfileCredit'),
    trackList:   document.getElementById('trackList'),
    // admin
    adminBtn:    document.getElementById('adminBtn'),
    adminPanel:  document.getElementById('adminPanel'),
    adminClose:  document.getElementById('adminClose'),
    adminPass:   document.getElementById('adminPass'),
    adminDjName: document.getElementById('adminDjName'),
    adminStationId: document.getElementById('adminStationId'),
    adminApiKey: document.getElementById('adminApiKey'),
    profileOverride: document.getElementById('profileOverride'),
    adminTracks: document.getElementById('adminTracks'),
    adminSave:   document.getElementById('adminSave'),
    adminLogout: document.getElementById('adminLogout'),
    adminReset:  document.getElementById('adminReset')
  };

  const STORAGE_KEY = 'djSelects.config';
  const normalizeTracks=a=>{a=Array.isArray(a)?a.slice(0,5):[];while(a.length<5)a.push("");return a;};
  const loadConfig=()=>{try{const raw=localStorage.getItem(STORAGE_KEY);if(!raw)return{...DEFAULTS};const p=JSON.parse(raw);return{...DEFAULTS,...p,tracks:normalizeTracks(p.tracks||[])};}catch{return{...DEFAULTS};}};
  const saveConfig=cfg=>localStorage.setItem(STORAGE_KEY,JSON.stringify(cfg));
  let CONFIG=loadConfig();

  const fmt=new Intl.DateTimeFormat(undefined,{weekday:'short',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'});

  // --- helpers
  function toEmbed(url){ if(!url) return null; try{ const u=new URL(url); let id=''; if(u.hostname.includes('youtu.be')) id=u.pathname.slice(1); else if(u.searchParams.get('v')) id=u.searchParams.get('v'); else if(u.pathname.includes('/shorts/')) id=u.pathname.split('/shorts/')[1]; else if(u.pathname.includes('/embed/')) id=u.pathname.split('/embed/')[1]; return id?`https://www.youtube-nocookie.com/embed/${id}`:null; }catch{return null;} }
  function renderTracks(){ els.trackList.innerHTML=''; normalizeTracks(CONFIG.tracks).forEach(u=>{ const card=document.createElement('div');card.className='yt-card'; const ratio=document.createElement('div');ratio.className='ratio'; const embed=toEmbed(u); if(embed){ const ifr=document.createElement('iframe'); ifr.src=embed; ifr.loading='lazy'; ifr.allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'; ifr.referrerPolicy='strict-origin-when-cross-origin'; ratio.appendChild(ifr);} else { const ph=document.createElement('div'); ph.style.display='grid'; ph.style.placeItems='center'; ph.style.color='#777'; ph.style.fontFamily="'Bebas Neue', sans-serif"; ph.style.fontSize='1.2rem'; ph.textContent='Add YouTube URL'; ratio.appendChild(ph);} card.appendChild(ratio); els.trackList.appendChild(card); }); }

  // --- proxy endpoints
  const EP={
    artists:(id,key)=> `/rc-proxy.php?fn=artists&stationId=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}&t=${Date.now()}`,
    live:(id,key)=>    `/rc-proxy.php?fn=schedule_live&stationId=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}&t=${Date.now()}`,
    range:(id,key,from,to)=> `/rc-proxy.php?fn=schedule_range&stationId=${encodeURIComponent(id)}&startDate=${encodeURIComponent(from)}&endDate=${encodeURIComponent(to)}&key=${encodeURIComponent(key)}&t=${Date.now()}`,
    artistSched:(id,key,artistId,from,to)=> `/rc-proxy.php?fn=artist_schedule&stationId=${encodeURIComponent(id)}&artistId=${encodeURIComponent(artistId)}&startDate=${encodeURIComponent(from)}&endDate=${encodeURIComponent(to)}&key=${encodeURIComponent(key)}&t=${Date.now()}`
  };
  const jget = async url => { const r=await fetch(url,{headers:{'Accept':'application/json'}}); const t=await r.text(); try{ return JSON.parse(t);}catch{ return {error:'parse_failed', body:t, status:r.status}; } };

  function pickImage(obj){
    if(!obj) return '';
    if (obj.logo) {
      return obj.logo['1024x1024'] || obj.logo.default || obj.logo['512x512'] || '';
    }
    return obj.imageUrl || obj.avatar || obj.photoUrl || obj.artworkUrl || '';
  }

  async function fetchNextShowAndProfile(){
    if(!CONFIG.stationId){ els.nextWhen.textContent='Set Station ID in admin'; return; }

    const now=new Date();
    const from=now.toISOString();
    const to=new Date(now.getTime()+1000*60*60*24*60).toISOString(); // 60 days

    // 1) try to find artist by name
    const list = await jget(EP.artists(CONFIG.stationId, CONFIG.apiKey));
    let artist = null;
    if (list && list.artists && Array.isArray(list.artists)) {
      const needle = (CONFIG.djName||'').trim().toLowerCase();
      artist = list.artists.find(a => (a.name||'').toLowerCase()===needle) ||
               list.artists.find(a => (a.name||'').toLowerCase().includes(needle));
    }

    // 2) use artist schedule if we have id; else scan schedule range and match by expanded artist names
    let next=null, img='';
    if (artist && artist.id){
      const sch = await jget(EP.artistSched(CONFIG.stationId, CONFIG.apiKey, artist.id, from, to));
      const arr = Array.isArray(sch?.schedules) ? sch.schedules : [];
      next = arr.find(ev => new Date(ev.startDateUtc) > now) || null;
      img = pickImage(artist);
    }
    if (!next){
      const rng = await jget(EP.range(CONFIG.stationId, CONFIG.apiKey, from, to));
      const items = Array.isArray(rng?.events) ? rng.events : (Array.isArray(rng) ? rng : []);
      const needle = (CONFIG.djName||'').trim().toLowerCase();
      next = items.find(ev => (ev.artist && (ev.artist.name||'').toLowerCase().includes(needle)) ||
                              (Array.isArray(ev.artists) && ev.artists.some(a => (a.name||'').toLowerCase().includes(needle)))) ||
             items[0] || null;
      if (!img && next){
        img = pickImage(next.artist) || (Array.isArray(next.artists) ? pickImage(next.artists[0]) : '');
      }
    }

    // Fill UI
    if (next && next.startDateUtc){
      els.nextWhen.textContent = fmt.format(new Date(next.startDateUtc));
    } else {
      els.nextWhen.textContent = 'No upcoming show found';
    }

    const override = (CONFIG.profileImageOverride||'').trim();
    if (override){
      els.profileImg.src = override;
      els.profileImg.alt = CONFIG.djName || 'DJ';
      els.profileCred.textContent = CONFIG.djName ? `Artist: ${CONFIG.djName}` : '';
    } else if (img){
      els.profileImg.src = img;
      els.profileImg.alt = CONFIG.djName || 'DJ';
      els.profileCred.textContent = CONFIG.djName ? `Artist: ${CONFIG.djName}` : '';
    } else {
      els.profileCred.textContent = '';
    }
  }

  // --- admin UI
  function openAdmin(){
    els.adminPanel.classList.add('open');
    els.adminDjName.value   = CONFIG.djName || '';
    els.adminStationId.value= CONFIG.stationId || '';
    els.adminApiKey.value   = CONFIG.apiKey || '';
    els.profileOverride.value = CONFIG.profileImageOverride || '';
    els.adminTracks.innerHTML='';
    normalizeTracks(CONFIG.tracks).forEach((u,i)=>{
      const row=document.createElement('div'); row.className='track-input';
      row.innerHTML=`<input type="text" data-idx="${i}" value="${u||''}" placeholder="YouTube URL #${i+1}">
                     <button data-up="${i}">&#8593;</button><button data-down="${i}">&#8595;</button>`;
      els.adminTracks.appendChild(row);
    });
  }
  function closeAdmin(){ els.adminPanel.classList.remove('open'); }
  function reorderTracks(from,to){ const t=normalizeTracks(CONFIG.tracks); if(to<0||to>=t.length)return; const [m]=t.splice(from,1); t.splice(to,0,m); CONFIG.tracks=t; openAdmin(); }

  els.adminBtn.addEventListener('click', ()=>{ if(!ADMIN.isAuthed){ const p=prompt('Enter admin passphrase:'); if(p===ADMIN.passphrase){ ADMIN.isAuthed=true; openAdmin(); } else alert('Incorrect passphrase'); } else openAdmin(); });
  els.adminClose.addEventListener('click', closeAdmin);
  els.adminLogout.addEventListener('click', ()=>{ ADMIN.isAuthed=false; closeAdmin(); });
  els.adminTracks.addEventListener('click', e=>{ const up=e.target.getAttribute('data-up'); const down=e.target.getAttribute('data-down'); if(up!==null) reorderTracks(+up,+up-1); if(down!==null) reorderTracks(+down,+down+1); });
  els.adminTracks.addEventListener('input', e=>{ if(e.target.tagName==='INPUT'){ const idx=+e.target.getAttribute('data-idx'); const t=normalizeTracks(CONFIG.tracks); t[idx]=e.target.value.trim(); CONFIG.tracks=t; }});
  els.adminSave.addEventListener('click', ()=>{ 
    CONFIG.djName = els.adminDjName.value.trim() || DEFAULTS.djName;
    CONFIG.stationId = els.adminStationId.value.trim();
    CONFIG.apiKey = els.adminApiKey.value.trim() || DEFAULTS.apiKey;
    CONFIG.profileImageOverride = els.profileOverride.value.trim();
    saveConfig(CONFIG); closeAdmin(); boot();
  });
  els.adminReset.addEventListener('click', ()=>{ if(confirm('Reset DJ Selects to defaults?')){ CONFIG={...DEFAULTS}; saveConfig(CONFIG); closeAdmin(); boot(); }});

  async function boot(){
    CONFIG = loadConfig();
    // Always show hero text immediately
    els.djNameText.textContent = CONFIG.djName || 'DJ NAME';
    renderTracks();
    // Then enhance with API
    fetchNextShowAndProfile();
  }

  boot();
})();

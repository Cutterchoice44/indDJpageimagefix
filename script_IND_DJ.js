/* DJ SELECTS — compact layout with small strips + big preview, profile under title */

(function(){
  const DEFAULTS = {
    djName: "MARIONETTE",
    stationId: "cutters-choice-radio",                 // you can change in Admin
    apiKey: "pk_0b8abc6f834b444f949f727e88a728e0",     // publishable key
    tracks: ["","","","",""],
    profileImageOverride: ""
  };
  const ADMIN = { passphrase: "scissors", isAuthed:false };
  let SELECTED = 0;

  const els = {
    djNameText:  document.getElementById('djNameText'),
    nextWhen:    document.getElementById('nextShowWhen'),
    profileImg:  document.getElementById('djProfileThumb'),
    trackList:   document.getElementById('stripList'),
    preview:     document.getElementById('mainPreview'),
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

  // --- YouTube parsing ---
  function toEmbed(url){
    if(!url) return null;
    try{
      const u = new URL(url.trim());
      const host = u.hostname.replace(/^m\./,'');
      let id = '';
      if (u.pathname.startsWith('/results')) return null;     // search pages not allowed
      if (host.includes('youtu.be')) { id = u.pathname.slice(1).split('/')[0]; }
      else if (host.includes('youtube.com') || host.includes('music.youtube.com')){
        if (u.searchParams.get('v')) id = u.searchParams.get('v');
        else if (u.pathname.includes('/shorts/')) id = u.pathname.split('/shorts/')[1].split('/')[0];
        else if (u.pathname.includes('/embed/'))  id = u.pathname.split('/embed/')[1].split('/')[0];
        else if (u.pathname.includes('/live/'))   id = u.pathname.split('/live/')[1].split('/')[0];
      }
      id = (id||'').split('?')[0].split('&')[0];
      return id ? `https://www.youtube-nocookie.com/embed/${id}?rel=0&modestbranding=1&playsinline=1` : null;
    }catch{ return null; }
  }

  // --- Render small strips + big preview ---
  function renderTracks(){
    els.trackList.innerHTML='';
    const t = normalizeTracks(CONFIG.tracks);
    t.forEach((u, i)=>{
      const embed = toEmbed(u);
      const strip = document.createElement('div');
      strip.className = 'strip' + (i===SELECTED ? ' selected' : '');
      if (embed){
        const ifr = document.createElement('iframe');
        // Small, inline player (100px tall via CSS)
        ifr.src = embed;
        ifr.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        ifr.loading = 'lazy';
        strip.appendChild(ifr);
      } else {
        const ph = document.createElement('div');
        ph.className = 'yt-placeholder';
        ph.textContent = 'Add YouTube URL';
        strip.appendChild(ph);
      }
      strip.addEventListener('click', ()=>{
        SELECTED = i;
        updatePreview(true);
        [...els.trackList.children].forEach((c,idx)=>c.classList.toggle('selected', idx===SELECTED));
      });
      els.trackList.appendChild(strip);
    });
    updatePreview(false);
  }

  function updatePreview(autoplay){
    const embed = toEmbed(normalizeTracks(CONFIG.tracks)[SELECTED]);
    els.preview.innerHTML = '';
    if (!embed){
      const ph = document.createElement('div');
      ph.className='big-placeholder'; ph.textContent='Select a track';
      els.preview.appendChild(ph);
      return;
    }
    const url = embed + (autoplay ? '&autoplay=1' : '');
    const wrap = document.createElement('div');
    wrap.className='ratio big';
    const ifr = document.createElement('iframe');
    ifr.src = url;
    ifr.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
    ifr.loading = 'lazy';
    wrap.appendChild(ifr);
    els.preview.appendChild(wrap);
  }

  // ---- Radio Cult via proxy (for next show + profile) ----
  const EP={
    artists:(id,key)=> `/rc-proxy.php?fn=artists&stationId=${encodeURIComponent(id)}&key=${encodeURIComponent(key)}&t=${Date.now()}`,
    range:(id,key,from,to)=> `/rc-proxy.php?fn=schedule_range&stationId=${encodeURIComponent(id)}&startDate=${encodeURIComponent(from)}&endDate=${encodeURIComponent(to)}&key=${encodeURIComponent(key)}&t=${Date.now()}`
  };
  const jget = async url => { const r=await fetch(url,{headers:{'Accept':'application/json'}}); const t=await r.text(); try{ return JSON.parse(t);}catch{ return {error:'parse_failed', body:t, status:r.status}; } };
  const pickImage = o => !o? '' : (o.logo?.['1024x1024'] || o.logo?.default || o.logo?.['512x512'] || o.imageUrl || o.avatar || o.photoUrl || o.artworkUrl || '');

  async function hydrateFromAPI(){
    try{
      if(!CONFIG.stationId) { els.nextWhen.textContent='Set Station ID in admin'; return; }
      const now=new Date(), from=now.toISOString(), to=new Date(now.getTime()+1000*60*60*24*60).toISOString();

      // Artist image
      let img='';
      const list = await jget(EP.artists(CONFIG.stationId, CONFIG.apiKey));
      if (Array.isArray(list?.artists)){
        const needle=(CONFIG.djName||'').toLowerCase();
        const artist = list.artists.find(a => (a.name||'').toLowerCase()===needle) ||
                       list.artists.find(a => (a.name||'').toLowerCase().includes(needle));
        img = pickImage(artist);
      }

      // Next show
      const rng = await jget(EP.range(CONFIG.stationId, CONFIG.apiKey, from, to));
      const items = Array.isArray(rng?.events) ? rng.events : [];
      let next = null;
      if (items.length){
        const needle=(CONFIG.djName||'').toLowerCase();
        next = items.find(ev => (ev.artist && (ev.artist.name||'').toLowerCase().includes(needle)) ||
                                (Array.isArray(ev.artists) && ev.artists.some(a => (a.name||'').toLowerCase().includes(needle))))
            || items[0];
      }
      if (next?.startDateUtc) els.nextWhen.textContent = fmt.format(new Date(next.startDateUtc));
      else els.nextWhen.textContent = 'No upcoming show found';

      // Apply profile image (override wins)
      const override = (CONFIG.profileImageOverride||'').trim();
      const useImg = override || img || pickImage(next?.artist) || (Array.isArray(next?.artists) ? pickImage(next.artists[0]) : '');
      if (useImg){ els.profileImg.src = useImg; els.profileImg.alt = CONFIG.djName || 'DJ'; }
    }catch(e){ console.warn('Hydrate failed', e); }
  }

  // ---- Admin UI ----
  function openAdmin(){
    els.adminPanel.classList.add('open');
    els.adminDjName.value   = CONFIG.djName || '';
    els.adminStationId.value= CONFIG.stationId || '';
    els.adminApiKey.value   = CONFIG.apiKey || '';
    els.profileOverride.value = CONFIG.profileImageOverride || '';
    els.adminTracks.innerHTML='';
    normalizeTracks(CONFIG.tracks).forEach((u,i)=>{
      const row=document.createElement('div');
      row.className='track-input';
      row.innerHTML = `
        <input type="text" data-idx="${i}" value="${u||''}" placeholder="YouTube URL #${i+1} (watch?v=… or youtu.be/…)">
        <button data-up="${i}">&#8593;</button><button data-down="${i}">&#8595;</button>`;
      els.adminTracks.appendChild(row);
    });
  }
  function closeAdmin(){ els.adminPanel.classList.remove('open'); }
  function reorderTracks(from,to){
    const t=normalizeTracks(CONFIG.tracks); if(to<0||to>=t.length)return;
    const [m]=t.splice(from,1); t.splice(to,0,m); CONFIG.tracks=t; saveConfig(CONFIG);
    SELECTED = Math.min(SELECTED, t.length-1);
    openAdmin(); renderTracks();
  }

  // open/close
  els.adminBtn.addEventListener('click', ()=>{
    if(!ADMIN.isAuthed){
      const entered = prompt('Enter admin passphrase:');
      if(entered===ADMIN.passphrase){ ADMIN.isAuthed=true; openAdmin(); }
      else alert('Incorrect passphrase');
    } else openAdmin();
  });
  els.adminClose.addEventListener('click', closeAdmin);
  els.adminLogout.addEventListener('click', ()=>{ ADMIN.isAuthed=false; closeAdmin(); });

  // live input preview
  els.adminTracks.addEventListener('input', (e)=>{
    if(e.target.tagName==='INPUT'){
      const idx = +e.target.getAttribute('data-idx');
      const t = normalizeTracks(CONFIG.tracks);
      t[idx] = e.target.value.trim();
      CONFIG.tracks = t; saveConfig(CONFIG);
      renderTracks(); // live
    }
  });
  // up/down
  els.adminTracks.addEventListener('click', (e)=>{
    const up=e.target.getAttribute('data-up'); const down=e.target.getAttribute('data-down');
    if(up!==null) reorderTracks(+up, +up-1);
    if(down!==null) reorderTracks(+down, +down+1);
  });

  // save/reset
  els.adminSave.addEventListener('click', ()=>{
    CONFIG.djName = els.adminDjName.value.trim() || DEFAULTS.djName;
    CONFIG.stationId = els.adminStationId.value.trim() || DEFAULTS.stationId;
    CONFIG.apiKey = els.adminApiKey.value.trim() || DEFAULTS.apiKey;
    CONFIG.profileImageOverride = els.profileOverride.value.trim();
    saveConfig(CONFIG); closeAdmin(); boot();

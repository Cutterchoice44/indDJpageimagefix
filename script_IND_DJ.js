/* DJ SELECTS — data, API calls, admin mode + rendering
   Storage model (localStorage key: 'djSelects.config'):
   {
     djName: "MARIONETTE",
     stationSlug: "cutters-choice-radio",
     apiKey: "pk_...",
     tracks: ["https://youtu.be/...", ... up to 5]
   }
*/

(function(){
  const DEFAULTS = {
    djName: "MARIONETTE",
    stationSlug: "cutters-choice-radio",
    apiKey: "pk_0b8abc6f834b444f949f727e88a728e0",
    tracks: [
      "", "", "", "", ""
    ]
  };

  const ADMIN = {
    passphrase: "scissors", // <- change this if you like
    isAuthed: false
  };

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
    adminApiKey: document.getElementById('adminApiKey'),
    adminTracks: document.getElementById('adminTracks'),
    adminSave:   document.getElementById('adminSave'),
    adminLogout: document.getElementById('adminLogout'),
    adminReset:  document.getElementById('adminReset')
  };

  // ----- persistence -----
  const STORAGE_KEY = 'djSelects.config';
  function loadConfig(){
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return {...DEFAULTS};
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed, tracks: normalizeTracks(parsed.tracks || []) };
    } catch(e){ console.warn('Config parse error', e); return {...DEFAULTS}; }
  }
  function saveConfig(cfg){
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
  }
  function normalizeTracks(arr){
    const a = Array.isArray(arr) ? arr.slice(0,5) : [];
    while (a.length < 5) a.push("");
    return a;
  }

  let CONFIG = loadConfig();

  // ----- utilities -----
  const fmt = new Intl.DateTimeFormat(undefined, {
    weekday: 'short', day:'2-digit', month:'short',
    hour:'2-digit', minute:'2-digit'
  });

  function toEmbed(url){
    if(!url) return null;
    try{
      // Support youtu.be, youtube.com/watch?v=, youtube.com/shorts/…
      const u = new URL(url);
      let id = '';
      if (u.hostname.includes('youtu.be')) {
        id = u.pathname.replace('/','').trim();
      } else if (u.searchParams.get('v')) {
        id = u.searchParams.get('v');
      } else if (u.pathname.includes('/shorts/')) {
        id = u.pathname.split('/shorts/')[1];
      } else if (u.pathname.includes('/embed/')) {
        id = u.pathname.split('/embed/')[1];
      }
      if(!id) return null;
      return `https://www.youtube-nocookie.com/embed/${id}`;
    }catch(e){ return null; }
  }

  function h(tag, cls){
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    return el;
  }

  // ----- rendering -----
  function render(){
    els.djNameText.textContent = CONFIG.djName || 'DJ NAME';

    // Tracks
    els.trackList.innerHTML = '';
    normalizeTracks(CONFIG.tracks).forEach((u) => {
      const embed = toEmbed(u);
      const card = h('div','yt-card');
      const ratio = h('div','ratio');
      if (embed){
        const ifr = document.createElement('iframe');
        ifr.src = embed;
        ifr.loading = 'lazy';
        ifr.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
        ifr.referrerPolicy = 'strict-origin-when-cross-origin';
        ratio.appendChild(ifr);
      } else {
        const placeholder = h('div');
        placeholder.style.display='grid';
        placeholder.style.placeItems='center';
        placeholder.style.color='#777';
        placeholder.style.fontFamily="'Bebas Neue', sans-serif";
        placeholder.style.fontSize='1.2rem';
        placeholder.textContent = 'Add YouTube URL';
        ratio.appendChild(placeholder);
      }
      card.appendChild(ratio);
      els.trackList.appendChild(card);
    });
  }

  // ----- Radio Cult API (profile + next show) -----
  // NOTE: These endpoints work for most stations; if your Radio Cult
  // account uses different paths, tweak ENDPOINTS below (kept in one place).
  const ENDPOINTS = {
    // Find upcoming shows for the station; optionally filter by DJ name
    upcoming: (slug) => `https://app.radiocult.fm/api/v1/stations/${encodeURIComponent(slug)}/schedule/upcoming?limit=25`,
    // List station DJs / artists (for avatar lookup)
    djs:      (slug) => `https://app.radiocult.fm/api/v1/stations/${encodeURIComponent(slug)}/djs?limit=200`
  };

  async function rcFetch(url, apiKey){
    const res = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept':'application/json' }
    });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  async function fetchNextShow(djName, slug, apiKey){
    try{
      const data = await rcFetch(ENDPOINTS.upcoming(slug), apiKey);
      // Try to find the first upcoming show by this DJ; otherwise next station show
      const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
      let next = null;
      if (djName){
        const name = djName.toLowerCase();
        next = items.find(it => (it?.djName || it?.artist || it?.title || '')
          .toString().toLowerCase().includes(name));
      }
      if (!next) next = items[0];

      if (next?.startTime || next?.start || next?.startsAt){
        const t = new Date(next.startTime || next.start || next.startsAt);
        els.nextWhen.textContent = fmt.format(t);
      } else {
        els.nextWhen.textContent = 'No upcoming show found';
      }
    }catch(e){
      console.warn('Next-show fetch error', e);
      els.nextWhen.textContent = 'Unable to load';
    }
  }

  async function fetchDjProfile(djName, slug, apiKey){
    if (!djName) return;
    try{
      const list = await rcFetch(ENDPOINTS.djs(slug), apiKey);
      const arr = Array.isArray(list?.items) ? list.items : (Array.isArray(list) ? list : []);
      const name = djName.toLowerCase();
      const hit = arr.find(d =>
        (d?.name || d?.displayName || '').toString().toLowerCase() === name ||
        (d?.name || d?.displayName || '').toString().toLowerCase().includes(name)
      );
      const url = hit?.imageUrl || hit?.avatar || hit?.photoUrl || hit?.artworkUrl;
      if (url){
        els.profileImg.src = url;
        els.profileImg.alt = hit?.displayName || hit?.name || djName;
        els.profileCred.textContent = (hit?.credit || hit?.displayName || hit?.name) ? `Artist: ${hit.displayName || hit.name}` : '';
      } else {
        els.profileCred.textContent = '';
      }
    }catch(e){
      console.warn('DJ profile fetch error', e);
      // leave default image
    }
  }

  // ----- admin panel -----
  function openAdmin(){
    els.adminPanel.classList.add('open');
    // hydrate inputs from CONFIG
    els.adminDjName.value  = CONFIG.djName || '';
    els.adminStation.value = CONFIG.stationSlug || '';
    els.adminApiKey.value  = CONFIG.apiKey || '';
    // tracks editor
    els.adminTracks.innerHTML = '';
    normalizeTracks(CONFIG.tracks).forEach((u, i) => {
      const row = document.createElement('div');
      row.className = 'track-input';
      row.innerHTML = `
        <input type="text" data-idx="${i}" value="${u || ''}" placeholder="YouTube URL #${i+1}">
        <button data-up="${i}">&#8593;</button>
        <button data-down="${i}">&#8595;</button>
      `;
      els.adminTracks.appendChild(row);
    });
  }
  function closeAdmin(){ els.adminPanel.classList.remove('open'); }

  function reorderTracks(from, to){
    const t = normalizeTracks(CONFIG.tracks);
    if (to < 0 || to >= t.length) return;
    const [moved] = t.splice(from,1);
    t.splice(to,0,moved);
    CONFIG.tracks = t;
    openAdmin(); // re-render panel
  }

  // events
  els.adminBtn.addEventListener('click', () => {
    if (!ADMIN.isAuthed){
      const entered = prompt('Enter admin passphrase:');
      if (entered === ADMIN.passphrase){
        ADMIN.isAuthed = true;
        document.body.classList.add('admin-mode'); // ties into your existing CSS
        openAdmin();
      } else {
        alert('Incorrect passphrase');
      }
    } else {
      openAdmin();
    }
  });

  els.adminClose.addEventListener('click', closeAdmin);
  els.adminLogout.addEventListener('click', () => {
    ADMIN.isAuthed = false;
    document.body.classList.remove('admin-mode');
    closeAdmin();
  });

  els.adminTracks.addEventListener('click', (e) => {
    const up = e.target.getAttribute('data-up');
    const down = e.target.getAttribute('data-down');
    if (up !== null) reorderTracks(parseInt(up,10), parseInt(up,10)-1);
    if (down !== null) reorderTracks(parseInt(down,10), parseInt(down,10)+1);
  });

  els.adminTracks.addEventListener('input', (e) => {
    if (e.target.tagName === 'INPUT'){
      const idx = parseInt(e.target.getAttribute('data-idx'),10);
      const t = normalizeTracks(CONFIG.tracks);
      t[idx] = e.target.value.trim();
      CONFIG.tracks = t;
    }
  });

  els.adminSave.addEventListener('click', () => {
    if (els.adminPass.value !== '' && els.adminPass.value !== ADMIN.passphrase){
      alert('Passphrase mismatch — enter the same passphrase used to log in (or leave blank).');
      return;
    }
    CONFIG.djName      = els.adminDjName.value.trim()  || DEFAULTS.djName;
    CONFIG.stationSlug = els.adminStation.value.trim() || DEFAULTS.stationSlug;
    CONFIG.apiKey      = els.adminApiKey.value.trim()  || DEFAULTS.apiKey;
    // tracks are already kept in CONFIG on input
    saveConfig(CONFIG);
    closeAdmin();
    boot(); // re-run
  });

  els.adminReset.addEventListener('click', () => {
    if (confirm('Reset DJ Selects to defaults?')){
      CONFIG = {...DEFAULTS};
      saveConfig(CONFIG);
      closeAdmin();
      boot();
    }
  });

  // ----- boot -----
  async function boot(){
    CONFIG = loadConfig();
    render();
    // fetch API bits
    fetchNextShow(CONFIG.djName, CONFIG.stationSlug, CONFIG.apiKey);
    fetchDjProfile(CONFIG.djName, CONFIG.stationSlug, CONFIG.apiKey);
  }

  // init
  boot();
})();

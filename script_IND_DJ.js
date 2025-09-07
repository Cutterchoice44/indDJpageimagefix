// 1) GLOBAL CONFIG & MOBILE DETECTION
const API_KEY           = "pk_0b8abc6f834b444f949f727e88a728e0";              // ← Replace with your actual Radiocult API key
const STATION_ID        = "cutters-choice-radio";
const BASE_URL          = "https://api.radiocult.fm/api";
const FALLBACK_ART      = "/images/archives-logox.jpeg";
const MIXCLOUD_PASSWORD = "cutters44";
const STREAM_URL        = "https://cutters-choice-radio.radiocult.fm/stream";  // HLS stream URL
const isMobile          = /Mobi|Android/i.test(navigator.userAgent);

let chatPopupWindow;
let visitorId;

// ADMIN-MODE TOGGLE (URL hash #admin)
if (window.location.hash === "#admin") {
  document.body.classList.add("admin-mode");
}

// 2) BAN LOGIC (FingerprintJS v3+)
function blockChat() {
  document.getElementById("popOutBtn")?.remove();
  document.getElementById("chatModal")?.remove();
  const cont = document.getElementById("radiocult-chat-container");
  if (cont) cont.innerHTML = "<p>Chat disabled.</p>";
}

async function initBanCheck() {
  if (!window.FingerprintJS) return;
  try {
    const fp = await FingerprintJS.load();
    const { visitorId: id } = await fp.get();
    visitorId = id;

    const res = await fetch("/api/chat/checkban", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitorId })
    });
    const { banned } = await res.json();
    if (banned) blockChat();
  } catch (err) {
    console.warn("Ban check error:", err);
  }
}

async function sendBan() {
  if (!visitorId) return;
  try {
    await fetch("/api/chat/ban", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visitorId })
    });
    blockChat();
  } catch (err) {
    console.error("Error sending ban:", err);
  }
}
window.sendBan = sendBan;

// 3) Chromecast Web Sender SDK Initialization
window.__onGCastApiAvailable = isAvailable => {
  if (isAvailable) {
    cast.framework.CastContext.getInstance().setOptions({
      receiverApplicationId: '77E0F81B',                // ← Your Cast App ID
      autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
    });
  }
};

// 4) HELPERS
function createGoogleCalLink(title, startUtc, endUtc) {
  if (!startUtc || !endUtc) return "#";
  const fmt = dt => new Date(dt).toISOString().replace(/[-:]|\.\d{3}/g, "");
  return [
    "https://calendar.google.com/calendar/render?action=TEMPLATE",
    `&text=${encodeURIComponent(title)}`,
    `&dates=${fmt(startUtc)}/${fmt(endUtc)}`,
    `&details=Tune in live at https://cutterschoiceradio.com`,
    `&location=https://cutterschoiceradio.com`
  ].join("");
}

async function rcFetch(path) {
  const res = await fetch(BASE_URL + path, { headers: { "x-api-key": API_KEY } });
  if (!res.ok) throw new Error(`Fetch error ${res.status}`);
  return res.json();
}

/* Refuse Imgur (and the specific EHhS47F asset) for artwork and fall back locally */
function trustedArt(url) {
  if (!url) return FALLBACK_ART;
  try {
    const u = new URL(url, location.origin);
    const isImgur   = /(^|\.)imgur\.com$/i.test(u.hostname);
    const isBadFile = /EHhS47F/i.test(u.pathname);
    return (isImgur || isBadFile) ? FALLBACK_ART : url;
  } catch {
    return FALLBACK_ART;
  }
}

function shuffleIframesDaily() {
  const container = document.getElementById("mixcloud-list");
  if (!container) return;
  const HOUR = 3600000;
  const last = +localStorage.getItem("lastShuffleTime");
  if (last && Date.now() - last < HOUR) return;

  const iframes = Array.from(container.querySelectorAll("iframe"));
  for (let i = iframes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    container.appendChild(iframes[j]);
    iframes.splice(j, 1);
  }
  localStorage.setItem("lastShuffleTime", Date.now());
}

// 5) MIXCLOUD ARCHIVES
async function loadArchives() {
  try {
    const res = await fetch("get_archives.php");
    if (!res.ok) throw new Error("Failed to load archives");
    const archives = await res.json();
    const container = document.getElementById("mixcloud-list");
    if (!container) return;

    container.innerHTML = "";
    archives.forEach((entry, idx) => {
      const feed = encodeURIComponent(entry.url);
      const item = document.createElement("div");
      item.className = "mixcloud-item";

      const iframe = document.createElement("iframe");
      iframe.className = "mixcloud-iframe";
      iframe.src = `https://www.mixcloud.com/widget/iframe/?hide_cover=1&light=1&feed=${feed}`;
      iframe.loading = "lazy";
      iframe.width = "100%";
      iframe.height = "120";
      iframe.frameBorder = "0";
      item.appendChild(iframe);

      if (!isMobile) {
        const remove = document.createElement("a");
        remove.href = "#";
        remove.className = "remove-link";
        remove.textContent = "Remove show";
        remove.addEventListener("click", e => { e.preventDefault(); deleteMixcloud(idx); });
        item.appendChild(remove);
      }
      container.prepend(item);
    });
    shuffleIframesDaily();
  } catch (err) {
    console.error("Archive load error:", err);
  }
}

async function addMixcloud() {
  const input = document.getElementById("mixcloud-url");
  if (!input) return;
  const url = input.value.trim();
  if (!url) return alert("Please paste a valid Mixcloud URL");

  const pw = prompt("Enter archive password:");
  if (pw !== MIXCLOUD_PASSWORD) return alert("Incorrect password");

  try {
    const form = new FormData();
    form.append("url", url);
    form.append("password", pw);
    const res = await fetch("add_archive.php", { method: "POST", body: form });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    input.value = "";
    await loadArchives();
  } catch (err) {
    alert("Add failed: " + err.message);
  }
}

async function deleteMixcloud(index) {
  const pw = prompt("Enter archive password:");
  if (pw !== MIXCLOUD_PASSWORD) return alert("Incorrect password");
  try {
    const form = new FormData();
    form.append("index", index);
    form.append("password", pw);
    const res = await fetch("delete_archive.php", { method: "POST", body: form });
    if (!res.ok) throw new Error((await res.json()).error || res.statusText);
    await loadArchives();
  } catch (err) {
    alert("Delete failed: " + err.message);
  }
}

// 6) DATA FETCHERS
async function fetchLiveNow() {
  try {
    const { result } = await rcFetch(`/station/${STATION_ID}/schedule/live`);
    const { metadata: md = {}, content: ct = {} } = result;
    document.getElementById("now-dj").textContent =
      md.artist ? `${md.artist} – ${md.title}` : ct.title || "No live show";

    // sanitize artwork URL
    const art = trustedArt(md.artwork_url);
    document.getElementById("now-art").src = art;
  } catch (e) {
    console.error("Live fetch error:", e);
    document.getElementById("now-dj").textContent = "Error fetching live info";
    document.getElementById("now-art").src = FALLBACK_ART;
  }
}

async function fetchWeeklySchedule() {
  const container = document.getElementById("schedule-container");
  if (!container) return;
  container.innerHTML = "<p>Loading this week’s schedule…</p>";
  try {
    const now = new Date();
    const then = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const { schedules } = await rcFetch(
      `/station/${STATION_ID}/schedule?startDate=${now.toISOString()}&endDate=${then.toISOString()}`
    );
    if (!schedules.length) {
      container.innerHTML = "<p>No shows scheduled this week.</p>";
      return;
    }
    container.innerHTML = "";
    const fmt = iso => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    const byDay = schedules.reduce((acc, ev) => {
      const day = new Date(ev.startDateUtc).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
      (acc[day] = acc[day] || []).push(ev);
      return acc;
    }, {});
    Object.entries(byDay).forEach(([day, evs]) => {
      const h3 = document.createElement("h3"); h3.textContent = day;
      container.appendChild(h3);
      const ul = document.createElement("ul"); ul.style.listStyle = "none"; ul.style.padding = "0";
      evs.forEach(ev => {
        const li = document.createElement("li"); li.style.marginBottom = "1rem";
        const wrap = document.createElement("div"); wrap.style.display = "flex"; wrap.style.alignItems = "center"; wrap.style.gap = "8px";
        const t = document.createElement("strong"); t.textContent = `${fmt(ev.startDateUtc)}–${fmt(ev.endDateUtc)}`; wrap.appendChild(t);

        // sanitize artwork URL used in schedule list
        const rawArt = ev.metadata?.artwork?.default || ev.metadata?.artwork?.original;
        const artUrl = trustedArt(rawArt);
        if (artUrl) {
          const img = document.createElement("img"); img.src = artUrl; img.alt = `${ev.title} artwork`;
          img.style.cssText = "width:30px;height:30px;object-fit:cover;border-radius:3px;"; wrap.appendChild(img);
        }
        const span = document.createElement("span"); span.textContent = ev.title; wrap.appendChild(span);
        li.appendChild(wrap); ul.appendChild(li);
      });
      container.appendChild(ul);
    });
  } catch (e) {
    console.error("Schedule error:", e);
    document.getElementById("schedule-container").innerHTML = "<p>Error loading schedule.</p>";
  }
}

async function fetchNowPlayingArchive() {
  try {
    const { result } = await rcFetch(`/station/${STATION_ID}/schedule/live`);
    const { metadata: md = {}, content: ct = {} } = result;
    let text = "Now Playing: ";
    if (md.title) text += md.artist ? `${md.artist} – ${md.title}` : md.title;
    else if (md.filename) text += md.filename;
    else if (ct.title) text += ct.title;
    else if (ct.name) text += ct.name;
    else text += "Unknown Show";
    document.getElementById("now-archive").textContent = text;
  } catch (e) {
    console.error("Archive-now error:", e);
    document.getElementById("now-archive").textContent = "Unable to load archive show";
  }
}

// 7) ADMIN & UI ACTIONS
function openChatPopup() {
  const url = `https://app.radiocult.fm/embed/chat/${STATION_ID}?theme=midnight&primaryColor=%235A8785&corners=sharp`;
  if (isMobile) window.open(url, "CuttersChatMobile", "noopener");
  else if (chatPopupWindow && !chatPopupWindow.closed) chatPopupWindow.focus();
  else chatPopupWindow = window.open(url, "CuttersChatPopup", "width=400,height=700,resizable=yes,scrollbars=yes");
}

// 8) BANNER GIF ROTATION
const rightEl = document.querySelector(".header-gif-right");
const leftEl  = document.querySelector(".header-gif-left");
if (rightEl && leftEl) {
  const sets = [
    { right: "/images/Untitled design(4).gif", left: "/images/Untitled design(5).gif" },
    { right: "/images/Untitled design(7).gif", left: "/images/Untitled design(8).gif" }
  ];
  let current = 0, sweepCount = 0;
  const speedMs = (parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--gif-speed").replace("s", "")) || 12) * 1000;
  setInterval(() => {
    sweepCount++;
    if (sweepCount >= 2) {
      current = (current + 1) % sets.length;
      rightEl.style.backgroundImage = `url('${sets[current].right}')`;
      leftEl.style.backgroundImage = `url('${sets[current].left}')`;
      sweepCount = 0;
    }
  }, speedMs);
}

// 9) INITIALIZATION
document.addEventListener("DOMContentLoaded", () => {
  fetchLiveNow();
  fetchWeeklySchedule();
  fetchNowPlayingArchive();
  loadArchives();

  // ---- Chromecast controls: show official OR fallback (accessibility-clean) ----
  const officialBtn = document.querySelector('google-cast-button');
  const manualBtn   = document.getElementById('manualCastBtn');

  if (officialBtn && manualBtn && window.cast?.framework) {
    const context = cast.framework.CastContext.getInstance();

    // Toggle visibility based on availability
    const updateCastVisibility = () => {
      const hasDevices = context.getCastState() !== cast.framework.CastState.NO_DEVICES_AVAILABLE;
      officialBtn.style.display = hasDevices ? 'inline-block' : 'none';
      manualBtn.style.display   = hasDevices ? 'none'         : 'inline-flex';
    };
    updateCastVisibility();
    if (!window.__ccrCastStateBound) {
      context.addEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED, updateCastVisibility);
      window.__ccrCastStateBound = true;
    }

    // Manual fallback starts a session (only bind once)
    if (!manualBtn.dataset.ccrBound) {
      manualBtn.dataset.ccrBound = '1';
      manualBtn.addEventListener('click', () => {
        context.requestSession().catch(err => console.error('Fallback session error', err));
      });
    }

    // Official button: when session exists, load our stream (only bind once)
    if (!officialBtn.dataset.ccrBound) {
      officialBtn.dataset.ccrBound = '1';
      officialBtn.addEventListener('click', async () => {
        const session = context.getCurrentSession();
        if (!session) return; // the Cast UI will handle device picker
        const mediaInfo = new chrome.cast.media.MediaInfo(STREAM_URL, 'application/x-mpegurl');
        mediaInfo.streamType = chrome.cast.media.StreamType.LIVE;
        mediaInfo.metadata = new chrome.cast.media.MusicTrackMediaMetadata();
        mediaInfo.metadata.title = document.getElementById('now-dj')?.textContent || 'Cutters Choice Radio';
        mediaInfo.metadata.albumName = 'Cutters Choice Radio';
        const request = new chrome.cast.media.LoadRequest(mediaInfo);
        try { await session.loadMedia(request); console.log('Casting started'); }
        catch (err) { console.error('Chromecast error:', err); }
      });
    }
  }
  // ------------------------------------------------------------------------------

  // Cleanup & auto-refresh
  if (window.matchMedia("(max-width: 768px)").matches) {
    document.querySelectorAll("section.chat .chat-actions").forEach(el => el.remove());
  }
  setInterval(fetchLiveNow, 30000);
  setInterval(fetchNowPlayingArchive, 30000);

  if (isMobile) document.querySelector(".mixcloud")?.remove();

  // Inject Mixcloud widget script
  const mcScript = document.createElement("script");
  mcScript.src = "https://widget.mixcloud.com/widget.js";
  mcScript.async = true;
  document.body.appendChild(mcScript);

  // Pop-out player
  document.getElementById("popOutBtn")?.addEventListener("click", () => {
    const src = document.getElementById("inlinePlayer").src;
    const w = window.open("", "CCRPlayer", "width=400,height=200,resizable=yes");
    w.document.write(`
      <!DOCTYPE html>
      <html lang="en">
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Cutters Choice Player</title>
      <style>body{margin:0;background:#111;display:flex;align-items:center;justify-content:center;height:100vh}iframe{width:100%;height:180px;border:none;border-radius:4px}</style>
      </head>
      <body><iframe src="${src}" allow="autoplay"></iframe></body>
      </html>
    `);
    w.document.close();
  });

  // Chat ghost cleanup
  const ul = document.querySelector(".rc-user-list");
  if (ul) {
    new MutationObserver(() => {
      ul.querySelectorAll("li").forEach(li => { if (!li.textContent.trim()) li.remove(); });
    }).observe(ul, { childList: true });
  }

  // Ban check timing
  if ("requestIdleCallback" in window) requestIdleCallback(initBanCheck, { timeout: 2000 });
  else setTimeout(initBanCheck, 2000);
});

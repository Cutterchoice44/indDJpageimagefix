// 1) GLOBAL CONFIG & MOBILE DETECTION
const API_KEY           = "pk_0b8abc6f834b444f949f727e88a728e0"; // ← Radiocult API key
const STATION_ID        = "cutters-choice-radio";
const BASE_URL          = "https://api.radiocult.fm/api";
const FALLBACK_ART      = "/images/archives-logo.jpeg";
const MIXCLOUD_PASSWORD = "cutters44";
const STREAM_URL        = "https://cutters-choice-radio.radiocult.fm/stream"; // audio/HLS stream URL
const isMobile          = /Mobi|Android/i.test(navigator.userAgent);

// HLS TV stream (served via nginx alias /ccr-tv/current/ccr.m3u8 ➜ OBS or fallback)
const CCR_TV_M3U8       = "https://ccr-tv.cutterschoiceradio.com/ccr-tv/current/ccr.m3u8";

// If your HTML uses a different container id for the preview, change this:
const NEXT_PREVIEW_EL_ID = "next-week-shows"; // (was "This Week’s Shows" which is not a valid id)

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
if (!window.__onGCastApiAvailable) {
  window.__onGCastApiAvailable = isAvailable => {
    if (isAvailable) {
      cast.framework.CastContext.getInstance().setOptions({
        receiverApplicationId: "77E0F81B",
        autoJoinPolicy: chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED
      });
    }
  };
}

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

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function shuffleIframesHourly() {
  const container = document.getElementById("mixcloud-list");
  if (!container) return;
  const HOUR = 3600000;
  const last = +localStorage.getItem("lastShuffleTime");
  if (last && Date.now() - last < HOUR) return;

  const nodes = Array.from(container.children);
  shuffleInPlace(nodes).forEach(n => container.appendChild(n));
  localStorage.setItem("lastShuffleTime", Date.now());
}

// Normalise names for matching (artist directory ↔ schedule)
const normName = s => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");

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

    shuffleIframesHourly();
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
    const { metadata: md = {}, content: ct = {} } = result || {};
    document.getElementById("now-dj").textContent =
      md.artist ? `${md.artist} – ${md.title || ct.title || ""}`.trim() :
      ct.title || "No live show";

    // sanitize artwork URL
    const art = trustedArt(md.artwork_url || ct.artwork_url);
    const imgEl = document.getElementById("now-art");
    if (imgEl) imgEl.src = art;
  } catch (e) {
    console.error("Live fetch error:", e);
    const nd = document.getElementById("now-dj");
    const na = document.getElementById("now-art");
    if (nd) nd.textContent = "Error fetching live info";
    if (na) na.src = FALLBACK_ART;
  }
}

async function fetchWeeklySchedule() {
  const container = document.getElementById("schedule-container");
  if (!container) return;
  container.innerHTML = "<p>Loading this week’s schedule…</p>";

  try {
    const now  = new Date();
    const then = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const { schedules = [] } = await rcFetch(
      `/station/${STATION_ID}/schedule?startDate=${now.toISOString()}&endDate=${then.toISOString()}`
    );

    if (!schedules.length) {
      container.innerHTML = "<p>No shows scheduled this week.</p>";
      return;
    }

    container.innerHTML = "";
    const fmt = iso =>
      new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

    const byDay = schedules.reduce((acc, ev) => {
      const day = new Date(ev.startDateUtc)
        .toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
      (acc[day] = acc[day] || []).push(ev);
      return acc;
    }, {});

    Object.entries(byDay).forEach(([day, evs]) => {
      const h3 = document.createElement("h3");
      h3.textContent = day;
      container.appendChild(h3);

      const ul = document.createElement("ul");
      ul.style.listStyle = "none";
      ul.style.padding = "0";

      evs.forEach(ev => {
        const li = document.createElement("li");
        li.style.marginBottom = "1rem";

        const wrap = document.createElement("div");
        wrap.style.display = "flex";
        wrap.style.alignItems = "center";
        wrap.style.gap = "8px";

        const t = document.createElement("strong");
        t.textContent = `${fmt(ev.startDateUtc)}–${fmt(ev.endDateUtc)}`;
        wrap.appendChild(t);

        const span = document.createElement("span");
        span.textContent = ev.title || "Untitled show";
        wrap.appendChild(span);

        li.appendChild(wrap);
        ul.appendChild(li);
      });

      container.appendChild(ul);
    });
  } catch (e) {
    console.error("Schedule error:", e);
    container.innerHTML = "<p>Error loading schedule.</p>";
  }
}

async function fetchNowPlayingArchive() {
  try {
    const { result } = await rcFetch(`/station/${STATION_ID}/schedule/live`);
    const { metadata: md = {}, content: ct = {} } = result || {};
    let text = "Now Playing: ";
    if (md.title) text += md.artist ? `${md.artist} – ${md.title}` : md.title;
    else if (md.filename) text += md.filename;
    else if (ct.title) text += ct.title;
    else if (ct.name) text += ct.name;
    else text += "Unknown Show";
    const el = document.getElementById("now-archive");
    if (el) el.textContent = text;
  } catch (e) {
    console.error("Archive-now error:", e);
    const el = document.getElementById("now-archive");
    if (el) el.textContent = "Unable to load archive show";
  }
}

/** 6b) NEXT WEEK'S SHOWS PREVIEW (randomized) */
async function fetchNextWeekPreview() {
  const grid = document.getElementById(NEXT_PREVIEW_EL_ID);
  if (!grid) return;

  grid.innerHTML = "<p>Loading next week’s shows…</p>";

  const extractArtistFromEvent = ev =>
    ev.artist ||
    ev.metadata?.artist ||
    ev.content?.artist ||
    ev.content?.host ||
    ev.content?.hosts?.[0] ||
    ev.content?.name ||
    (typeof ev.title === "string" ? ev.title.split(" – ")[0] : "") ||
    "";

  const extractArtFromEvent = ev =>
    ev.artwork_url ||
    ev.metadata?.artwork_url ||
    ev.content?.artwork_url ||
    ev.content?.image_url ||
    ev.content?.cover_url ||
    null;

  async function fetchArtistDirectoryMap() {
    try {
      const { artists = [] } = await rcFetch(`/station/${STATION_ID}/artists`);
      const map = new Map();
      artists.forEach(a => {
        const name = normName(a.name || a.title || a.artist || "");
        const art =
          a.artwork_url || a.image_url || a.avatar_url || a.cover_url || a.picture_url || null;
        if (name) map.set(name, art);
      });
      return map;
    } catch {
      return new Map();
    }
  }

  try {
    const start = new Date();
    const end   = new Date(start.getTime() + 8 * 24 * 60 * 60 * 1000);

    const [{ schedules = [] }, artistMap] = await Promise.all([
      rcFetch(
        `/station/${STATION_ID}/schedule?startDate=${start.toISOString()}&endDate=${end.toISOString()}`
      ),
      fetchArtistDirectoryMap()
    ]);

    if (!schedules.length) {
      grid.innerHTML = "<p>No shows scheduled in the next 8 days.</p>";
      return;
    }

    const byArtist = new Map();
    schedules.forEach(ev => {
      const rawName = extractArtistFromEvent(ev);
      const name = normName(rawName);
      if (!name) return;
      if (!byArtist.has(name)) {
        const dirArt = artistMap.get(name);
        const evArt  = extractArtFromEvent(ev);
        byArtist.set(name, {
          name: rawName || "Unknown Artist",
          art: trustedArt(dirArt || evArt || FALLBACK_ART),
        });
      }
    });

    const cards = Array.from(byArtist.values());
    if (!cards.length) {
      grid.innerHTML = "<p>No artist profiles found for next 8 days.</p>";
      return;
    }

    shuffleInPlace(cards);

    const frag = document.createDocumentFragment();
    cards.forEach(({ name, art }) => {
      const item = document.createElement("div");
      item.className = "next-week-item";
      item.style.display = "inline-block";
      item.style.margin = "6px";
      item.style.width = "120px";
      item.style.textAlign = "center";

      const img = document.createElement("img");
      img.src = trustedArt(art);
      img.alt = name;
      img.loading = "lazy";
      img.decoding = "async";
      img.style.width = "100%";
      img.style.height = "120px";
      img.style.objectFit = "cover";
      img.style.borderRadius = "6px";

      const cap = document.createElement("div");
      cap.textContent = name;
      cap.style.fontSize = "12px";
      cap.style.marginTop = "6px";

      item.appendChild(img);
      item.appendChild(cap);
      frag.appendChild(item);
    });

    grid.innerHTML = "";
    grid.appendChild(frag);
  } catch (err) {
    console.error("Next-week preview error:", err);
    grid.innerHTML = "<p>Error loading next week’s shows.</p>";
  }
}

// 7) ADMIN & UI ACTIONS
function openChatPopup() {
  const url = `https://app.radiocult.fm/embed/chat/${STATION_ID}?theme=midnight&primaryColor=%235A8785&corners=sharp`;
  if (isMobile) window.open(url, "CuttersChatMobile", "noopener");
  else if (chatPopupWindow && !chatPopupWindow.closed) chatPopupWindow.focus();
  else chatPopupWindow = window.open(url, "CuttersChatPopup", "width=400,height=700,resizable=yes,scrollbars=yes");
}
window.openChatPopup = openChatPopup;

// 8) BANNER GIF ROTATION (kept if elements exist)
const rightEl = document.querySelector(".header-gif-right");
const leftEl  = document.querySelector(".header-gif-left");
if (rightEl && leftEl) {
  const sets = [
    { right: "/images/Untitled design(4).gif", left: "/images/Untitled design(5).gif" },
    { right: "/images/Untitled design(7).gif", left: "/images/Untitled design(8).gif" }
  ];
  let current = 0, sweepCount = 0;
  const speedVar = getComputedStyle(document.documentElement).getPropertyValue("--gif-speed");
  const speedMs = (parseFloat(String(speedVar).replace("s", "")) || 12) * 1000;
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

// 9) CCR TV — Robust HLS Player (autoplay, stall watchdog, fast OBS⇄fallback recovery)
function initCcrTv() {
  if (window.__ccrTvInitDone) return; // idempotent
  window.__ccrTvInitDone = true;

  const video = document.getElementById("ccrTv");
  if (!video) return;

  // Hard-cache-buster to force Chrome to pick up symlink switches quickly
  const makeURL = () => `${CCR_TV_M3U8}?t=${Date.now()}`;

  // Required for autoplay across browsers
  video.muted = true;
  video.setAttribute("muted", "");
  video.playsInline = true;

  let hls = null;
  let userPaused = false;
  let lastActive = Date.now();
  let lastReload  = 0;

  function attemptPlay() {
    const p = video.play();
    if (p && p.catch) p.catch(() => {});
  }

  function attachNative(url){
    video.src = url;
    video.addEventListener("loadedmetadata", attemptPlay, { once:true });
  }

  function destroyHls() {
    if (hls) {
      try { hls.destroy(); } catch(e){}
      hls = null;
    }
  }

  function attachHls(url){
    destroyHls();
    if (window.Hls && window.Hls.isSupported()) {
      hls = new Hls({
        lowLatencyMode: false,
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 10,
        maxBufferLength: 10,
        backBufferLength: 30,
        enableWorker: true,
        fragLoadingTimeOut: 20000,
        manifestLoadingTimeOut: 20000
      });
      hls.loadSource(url);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, attemptPlay);

      hls.on(Hls.Events.ERROR, (evt, data) => {
        const fatal = data?.fatal;
        const det   = data?.details || "";
        const type  = data?.type;
        const isFragOrLevelErr = /FRAG_|LEVEL_|MANIFEST_LOAD_ERROR|MANIFEST_PARSING_ERROR|MANIFEST_INCOMPATIBLE_CODECS_ERROR/i.test(det);

        // Gentle fix for buffer stalls (seen on Firefox sometimes)
        if (det === Hls.ErrorDetails.BUFFER_STALLED_ERROR) {
          try { hls.stopLoad(); } catch(e){}
          try { hls.startLoad(); } catch(e){}
          return;
        }

        // If manifest/frag/level went bad or fatal -> hard reload quickly (picks up symlink switch)
        if (fatal || isFragOrLevelErr) {
          destroyHls();
          setTimeout(() => attachHls(makeURL()), 400);
          return;
        }

        // Non-fatal hints
        if (type === Hls.ErrorTypes.NETWORK_ERROR) {
          try { hls.startLoad(); } catch(e){}
        } else if (type === Hls.ErrorTypes.MEDIA_ERROR) {
          try { hls.recoverMediaError(); } catch(e){}
        }
      });
    } else {
      // Native (Safari, some mobile)
      attachNative(url);
    }
  }

  function hardReloadIfNeeded(reason) {
    const now = Date.now();
    if (now - lastReload < 1200) return; // throttle
    lastReload = now;
    if (hls) {
      destroyHls();
      attachHls(makeURL());
    } else {
      const t = video.currentTime || 0;
      video.src = makeURL();
      video.currentTime = Math.max(0, t - 2);
      attemptPlay();
    }
    if (reason) console.warn("[CCR-TV] reload:", reason);
  }

  // Stall watchdog — kick loader if playback time hasn't advanced
  const STALL_MS = 6000;
  setInterval(() => {
    const stalled = (Date.now() - lastActive) > STALL_MS;
    const shouldBePlaying = !video.paused && !video.ended && !userPaused;
    if (stalled && shouldBePlaying) {
      if (hls) {
        try { hls.stopLoad(); } catch(e){}
        try { hls.startLoad(); } catch(e){}
        // If still stalled after a moment, do a hard reload (cache-busted)
        setTimeout(() => {
          if ((Date.now() - lastActive) > STALL_MS && !video.paused) {
            hardReloadIfNeeded("stalled");
          }
        }, 1200);
      } else {
        hardReloadIfNeeded("native-stalled");
      }
    }
  }, 2500);

  // Track activity & user intent
  video.addEventListener("timeupdate", () => { lastActive = Date.now(); }, { passive:true });
  video.addEventListener("playing",    () => { lastActive = Date.now(); }, { passive:true });
  video.addEventListener("waiting",    () => {}, { passive:true });
  video.addEventListener("pause",      () => { userPaused = true; });
  video.addEventListener("play",       () => { userPaused = false; });

  // If tab becomes visible again, nudge loader
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (hls) { try { hls.startLoad(); } catch(e){} }
      attemptPlay();
    }
  });

  // Video error -> reload quickly (handles OBS stop → fallback & vice versa)
  video.addEventListener("error", () => hardReloadIfNeeded("video-error"));

  // Kick it off
  const url = makeURL();
  if (video.canPlayType("application/vnd.apple.mpegURL")) attachNative(url);
  else attachHls(url);

  // Expose tiny debug helper
  window.CCRTV = {
    reload: () => hardReloadIfNeeded("manual"),
    status: () => ({ userPaused, lastActive, hls: !!hls })
  };
}

// 10) INITIALIZATION
document.addEventListener("DOMContentLoaded", () => {
  // Data/UI
  fetchLiveNow();
  fetchWeeklySchedule();
  fetchNowPlayingArchive();
  fetchNextWeekPreview();
  loadArchives();

  // ---- Chromecast controls: show official OR fallback (accessibility-clean) ----
  const officialBtn = document.querySelector("google-cast-button");
  const manualBtn   = document.getElementById("manualCastBtn");

  if (officialBtn && manualBtn && window.cast?.framework) {
    const context = cast.framework.CastContext.getInstance();

    const updateCastVisibility = () => {
      const hasDevices = context.getCastState() !== cast.framework.CastState.NO_DEVICES_AVAILABLE;
      officialBtn.style.display = hasDevices ? "inline-block" : "none";
      manualBtn.style.display   = hasDevices ? "none"         : "inline-flex";
    };
    updateCastVisibility();
    if (!window.__ccrCastStateBound) {
      context.addEventListener(cast.framework.CastContextEventType.CAST_STATE_CHANGED, updateCastVisibility);
      window.__ccrCastStateBound = true;
    }

    if (!manualBtn.dataset.ccrBound) {
      manualBtn.dataset.ccrBound = "1";
      manualBtn.addEventListener("click", () => {
        context.requestSession().catch(err => console.error("Fallback session error", err));
      });
    }

    if (!officialBtn.dataset.ccrBound) {
      officialBtn.dataset.ccrBound = "1";
      officialBtn.addEventListener("click", async () => {
        const session = context.getCurrentSession();
        if (!session) return;
        const mime = /\.m3u8($|\?)/i.test(STREAM_URL) ? "application/x-mpegurl" : "audio/mpeg";
        const mediaInfo = new chrome.cast.media.MediaInfo(STREAM_URL, mime);
        mediaInfo.streamType = chrome.cast.media.StreamType.LIVE;
        mediaInfo.metadata = new chrome.cast.media.MusicTrackMediaMetadata();
        mediaInfo.metadata.title = document.getElementById("now-dj")?.textContent || "Cutters Choice Radio";
        mediaInfo.metadata.albumName = "Cutters Choice Radio";
        const request = new chrome.cast.media.LoadRequest(mediaInfo);
        try { await session.loadMedia(request); console.log("Casting started"); }
        catch (err) { console.error("Chromecast error:", err); }
      });
    }
  }
  // ------------------------------------------------------------------------------

  // Mobile cleanup (hide desktop-only chat popout on small screens)
  if (window.matchMedia("(max-width: 768px)").matches) {
    document.querySelectorAll("section.chat .chat-actions").forEach(el => el.remove());
  }

  // Refreshers
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

  // Ban check timing (kept)
  if ("requestIdleCallback" in window) requestIdleCallback(initBanCheck, { timeout: 2000 });
  else setTimeout(initBanCheck, 2000);

  // CCR TV boot (robust HLS)
  initCcrTv();
});

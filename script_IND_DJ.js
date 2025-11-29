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

// 2) RADIocult BASE FETCH HELPER
async function rcFetch(path, options = {}) {
  const url = `${BASE_URL}${path}`;
  const opts = {
    ...options,
    headers: {
      "x-api-key": API_KEY,
      Accept: "application/json",
      ...(options.headers || {})
    }
  };
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

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
  if (!startUtc || !endUtc) return "";
  const fmt = iso =>
    new Date(iso).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title || "Show",
    dates: `${fmt(startUtc)}/${fmt(endUtc)}`,
    details: `Listen live on Cutters Choice Radio: https://cutterschoiceradio.com`,
    location: "Online"
  });

  return `https://www.google.com/calendar/render?${params.toString()}`;
}

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
    const res = await fetch("blocked_fingerprints.json", { cache: "no-store" });
    if (!res.ok) return;
    const { blocked = [] } = await res.json();
    if (blocked.includes(id)) blockChat();
  } catch (err) {
    console.warn("[CCR ban-check] error:", err);
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

  const items = Array.from(container.querySelectorAll(".mixcloud-item"));
  if (!items.length) return;

  shuffleInPlace(items);
  items.forEach(it => container.appendChild(it));
  localStorage.setItem("lastShuffleTime", String(Date.now()));
}

// 5) CCR TV / HLS PLAYER
function initCcrTv() {
  const video = document.getElementById("ccrTv");
  if (!video) return;

  const canUseNativeHls = video.canPlayType("application/vnd.apple.mpegurl");

  function attachSource(src) {
    if (canUseNativeHls) {
      video.src = src;
      video.addEventListener("error", () => {
        console.warn("Native HLS error, falling back poster.");
        video.removeAttribute("src");
        video.load();
      }, { once: true });
    } else if (window.Hls && window.Hls.isSupported()) {
      const hls = new Hls({
        enableWorker: true,
        lowLatencyMode: true
      });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (event, data) => {
        console.error("[Hls.js error]", event, data);
      });
    } else {
      console.warn("HLS not supported; leaving poster.");
    }
  }

  attachSource(CCR_TV_M3U8);
}

// 5b) Radio audio stream (for casting)
function createAudioElementForCast() {
  const audio = new Audio(STREAM_URL);
  audio.crossOrigin = "anonymous";
  audio.preload = "none";
  audio.autoplay = false;
  return audio;
}

// 6) DATA FETCHERS
async function fetchLiveNow() {
  try {
    const { result } = await rcFetch(`/station/${STATION_ID}/schedule/live`);
    return result || null;
  } catch (e) {
    console.warn("Live now fetch failed:", e);
    return null;
  }
}

async function fetchThisWeekSchedule() {
  const now = new Date();
  const then = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  try {
    const { schedules = [] } = await rcFetch(
      `/station/${STATION_ID}/schedule?` +
        new URLSearchParams({
          startDate: now.toISOString(),
          endDate: then.toISOString(),
          expand: "artist"
        })
    );
    return schedules;
  } catch (e) {
    console.error("Schedule fetch error:", e);
    return [];
  }
}

async function fetchNextWeekSchedule() {
  const now = new Date();
  const then = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);

  try {
    const { schedules = [] } = await rcFetch(
      `/station/${STATION_ID}/schedule?` +
        new URLSearchParams({
          startDate: now.toISOString(),
          endDate: then.toISOString(),
          expand: "artist"
        })
    );
    return schedules;
  } catch (e) {
    console.error("Next-week schedule fetch error:", e);
    return [];
  }
}

// 6a) FETCH: Artist directory map (id -> artist object)
async function fetchArtistDirectoryMap() {
  try {
    const { artists = [] } = await rcFetch(`/station/${STATION_ID}/artists?limit=200`);
    const map = new Map();
    for (const a of artists) {
      if (a && a.id) map.set(a.id, a);
    }
    return map;
  } catch (e) {
    console.error("Artist directory fetch error:", e);
    return new Map();
  }
}

// 7) DOM UPDATERS

// 7a) “This Week’s Lineup” (main schedule list)
async function renderThisWeekSchedule() {
  const container = document.getElementById("schedule-container");
  if (!container) return;

  container.innerHTML = "<p>Loading this week’s schedule…</p>";

  try {
    const now  = new Date();
    const then = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const { schedules = [] } = await rcFetch(
      `/station/${STATION_ID}/schedule?` +
        new URLSearchParams({
          startDate: now.toISOString(),
          endDate: then.toISOString(),
          expand: "artist"
        })
    );

    if (!schedules.length) {
      container.innerHTML = "<p>No shows scheduled this week.</p>";
      return;
    }

    container.innerHTML = "";
    const fmt = iso =>
      new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

    const byDay = new Map();
    schedules.forEach(ev => {
      const start = new Date(ev.startDateUtc || ev.startDate || ev.start);
      const key = start.toLocaleDateString("en-GB", {
        weekday: "short",
        day: "2-digit",
        month: "short"
      });
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(ev);
    });

    const frag = document.createDocumentFragment();
    for (const [dayLabel, dayEvents] of byDay.entries()) {
      const dayWrap = document.createElement("div");
      dayWrap.className = "schedule-day";

      const title = document.createElement("h3");
      title.textContent = dayLabel;
      dayWrap.appendChild(title);

      const ul = document.createElement("ul");
      dayEvents.forEach(ev => {
        const li = document.createElement("li");

        const startIso = ev.startDateUtc || ev.startDate || ev.start;
        const endIso   = ev.endDateUtc   || ev.endDate   || ev.end;
        const timeSpan = document.createElement("span");
        timeSpan.className = "schedule-time";
        timeSpan.textContent = `${fmt(startIso)} – ${fmt(endIso)}`;
        li.appendChild(timeSpan);

        const artistName =
          ev.artists && ev.artists.length && ev.artists[0].name
            ? ev.artists[0].name
            : "Resident DJ";

        const titleSpan = document.createElement("span");
        titleSpan.className = "schedule-title";
        titleSpan.textContent = `${artistName} — ${ev.title || ev.name || "Show"}`;
        li.appendChild(titleSpan);

        const link = createGoogleCalLink(
          `${artistName} — ${ev.title || ev.name || "Show"}`,
          startIso,
          endIso
        );
        if (link) {
          const a = document.createElement("a");
          a.href = link;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.className = "cal-link";
          a.textContent = "Add to Calendar";
          li.appendChild(a);
        }

        ul.appendChild(li);
      });

      dayWrap.appendChild(ul);
      frag.appendChild(dayWrap);
    }

    container.appendChild(frag);
  } catch (e) {
    console.error("Schedule error:", e);
    container.innerHTML = "<p>Error loading schedule.</p>";
  }
}

// 7b) Now-playing archive label under player
async function fetchNowPlayingArchive() {
  try {
    const { result } = await rcFetch(`/station/${STATION_ID}/schedule/live`);
    const { metadata: md = {}, content: ct = {} } = result || {};

    const title = md.title || ct.title || "Live show";
    const artist =
      (Array.isArray(ct.artists) && ct.artists.length && ct.artists[0].name) ||
      md.artist ||
      "";
    const label = [artist, title].filter(Boolean).join(" — ");

    const el = document.getElementById("now-archive");
    if (!el) return;
    el.textContent = label || "Live now";
  } catch (e) {
    console.warn("Now-playing archive fetch failed:", e);
  }
}

// 7c) Next-week preview grid (for slideshow / CCR TV companion)
async function renderNextWeekPreview() {
  const grid = document.getElementById(NEXT_PREVIEW_EL_ID);
  if (!grid) return;

  grid.innerHTML = "<p>Loading next week’s shows…</p>";

  const extractArtistFromEvent = ev =>
    (ev.artists && ev.artists.length && ev.artists[0].name) ||
    (ev.metadata && ev.metadata.artist) ||
    "";

  try {
    const [schedules, artistMap] = await Promise.all([
      fetchNextWeekSchedule(),
      fetchArtistDirectoryMap()
    ]);

    if (!schedules.length) {
      grid.innerHTML = "<p>No shows scheduled in the next 8 days.</p>";
      return;
    }

    // Build a map phonebook-style: artistName -> { artist, shows[] }
    const byArtist = new Map();
    for (const ev of schedules) {
      const name = extractArtistFromEvent(ev) || "Resident DJ";
      if (!byArtist.has(name)) {
        const artistObj =
          (ev.artists || [])
            .map(a => a && artistMap.get(a.id))
            .find(Boolean) || null;

        byArtist.set(name, { artist: artistObj, shows: [] });
      }
      byArtist.get(name).shows.push(ev);
    }

    const cards = Array.from(byArtist.values());
    if (!cards.length) {
      grid.innerHTML = "<p>No artist profiles found for next 8 days.</p>";
      return;
    }

    const frag = document.createDocumentFragment();
    cards.forEach(({ artist, shows }) => {
      const item = document.createElement("article");
      item.className = "next-artist-card";

      const img = document.createElement("img");
      img.className = "next-artist-img";
      img.loading = "lazy";
      img.decoding = "async";
      img.alt = artist?.name || "Resident DJ";
      img.src =
        (artist && (artist.imageUrl || artist.pictureUrl)) ||
        FALLBACK_ART;
      item.appendChild(img);

      const cap = document.createElement("div");
      cap.className = "next-artist-cap";

      const h3 = document.createElement("h3");
      h3.textContent = artist?.name || "Resident DJ";
      cap.appendChild(h3);

      const firstShow = shows[0];
      if (firstShow) {
        const when = document.createElement("p");
        const sISO = firstShow.startDateUtc || firstShow.startDate || firstShow.start;
        const d = new Date(sISO);
        when.textContent = d.toLocaleString("en-GB", {
          weekday: "short",
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit"
        });
        cap.appendChild(when);
      }

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

// 7d) ARCHIVE: Mixcloud list loader
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

// NEW: basic Mixcloud URL safety check
function isSafeMixcloudUrl(value) {
  if (!value) return false;
  let url;
  try {
    url = new URL(value.trim());
  } catch (e) {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (!["mixcloud.com", "www.mixcloud.com", "widget.mixcloud.com"].includes(host)) return false;
  // Basic path sanity: expect at least "/username/showname"
  if (!/^\/[^/]+\/[^/]+/.test(url.pathname)) return false;
  return true;
}

async function addMixcloud() {
  const input = document.getElementById("mixcloud-url");
  if (!input) return;
  const url = input.value.trim();
  if (!url) return alert("Please paste a valid Mixcloud URL");
  if (!isSafeMixcloudUrl(url)) {
    return alert("That doesn't look like a valid Mixcloud show URL. Please paste a URL like https://www.mixcloud.com/username/show-name/");
  }

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

// 8) ADMIN & UI ACTIONS
function openChatPopup() {
  const url = `https://app.radiocult.fm/embed/chat/${STATION_ID}?theme=midnight&primaryColor=%235A8785&corners=sharp`;
  const opts = "width=420,height=720,resizable=yes,scrollbars=yes";
  if (chatPopupWindow && !chatPopupWindow.closed) {
    chatPopupWindow.focus();
    chatPopupWindow.location.href = url;
  } else {
    chatPopupWindow = window.open(url, "CuttersChat", opts);
  }
}

function initPopOutPlayer() {
  const btn = document.getElementById("popOutBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const url = `https://app.radiocult.fm/embed/square-player/${STATION_ID}?theme=midnight&primaryColor=%235A8785&corners=sharp`;
    const opts = "width=420,height=420,resizable=yes";
    window.open(url, "CuttersPlayer", opts);
  });
}

function initChatPopupButton() {
  const btn = document.getElementById("chatPopupBtn");
  if (!btn) return;
  btn.addEventListener("click", openChatPopup);
}

// 9) PAGE INIT
document.addEventListener("DOMContentLoaded", () => {
  initBanCheck();
  initCcrTv();
  renderThisWeekSchedule();
  fetchNowPlayingArchive();
  renderNextWeekPreview();
  loadArchives();
  initPopOutPlayer();
  initChatPopupButton();
});

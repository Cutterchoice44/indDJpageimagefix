// script_IND_DJ.js
const API_KEY      = "pk_0b8abc6f834b444f949f727e88a728e0";
const BASE_URL     = "https://api.radiocult.fm/api";
const STATION_ID   = "cutters-choice-radio";
const MIXCLOUD_PW  = "cutters44";
const FALLBACK_ART = "https://i.imgur.com/qWOfxOS.png";

// Helpers
function showNotFound() {
  document.querySelector(".profile-wrapper").innerHTML = `
    <p style="color:white;text-align:center;margin:2rem;">
      Profile not found.
    </p>`;
}
function showError() {
  document.querySelector(".profile-wrapper").innerHTML = `
    <p style="color:white;text-align:center;margin:2rem;">
      Error loading profile.
    </p>`;
}
function createGoogleCalLink(title, s, e) {
  if (!s||!e) return "#";
  const fmt = dt=>new Date(dt).toISOString().replace(/-|:|\.\d{3}/g,'');
  return `https://www.google.com/calendar/render?action=TEMPLATE`
       + `&text=${encodeURIComponent(title)}`
       + `&dates=${fmt(s)}/${fmt(e)}`;
}

async function initPage() {
  const params   = new URLSearchParams(location.search);
  const artistId = params.get("id");
  if (!artistId) return showNotFound();

  // 1) Fetch artist
  let artist;
  try {
    const r = await fetch(
      `${BASE_URL}/station/${STATION_ID}/artists/${artistId}`,
      { headers: { "x-api-key": API_KEY } }
    );
    if (!r.ok) {
      if (r.status===404) return showNotFound();
      throw new Error(`Artist API ${r.status}`);
    }
    const body = await r.json();
    artist = body.artist || body.data || body;
    if (artist.attributes) artist = { ...artist, ...artist.attributes };
  } catch(err) {
    console.error(err);
    return showError();
  }

  // 2) Must have WEBSITE tag
  const tags = Array.isArray(artist.tags)
    ? artist.tags.map(t=>String(t).toLowerCase())
    : [];
  if (!tags.includes("website")) {
    return showNotFound();
  }

  // 3) Name
  document.getElementById("dj-name").textContent = artist.name || "";

  // 4) Bio/Description
  const bioEl = document.getElementById("dj-bio");
  let raw = null;
  for (const k of ["description","descriptionHtml","bio","bioHtml"]) {
    if (artist[k] != null) { raw = artist[k]; break; }
  }
  let bioHtml = "";
  if (raw) {
    if (typeof raw==="object" && Array.isArray(raw.content)) {
      const extract = node =>
        node.text ||
        (node.content||[]).map(extract).join("") ||
        "";
      bioHtml = raw.content.map(blk=>`<p>${extract(blk)}</p>`).join("");
    } else if (typeof raw==="string") {
      bioHtml = /<[a-z][\s\S]*>/i.test(raw)
        ? raw
        : raw.split(/\r?\n+/).map(p=>`<p>${p}</p>`).join("");
    }
  }
  bioEl.innerHTML = bioHtml || `<p>No bio available.</p>`;

  // 5) Artwork
  const art = document.getElementById("dj-artwork");
  art.src = artist.logo?.["512x512"]||artist.logo?.default||artist.avatar||FALLBACK_ART;
  art.alt = artist.name||"";

  // 6) Social links
  const sl = document.getElementById("social-links");
  sl.innerHTML = "";
  for (const [plat,url] of Object.entries(artist.socials||{})) {
    if (!url) continue;
    const label = plat.replace(/Handle$/,"").replace(/([A-Z])/g," $1").trim();
    const li = document.createElement("li");
    li.innerHTML = `<a href="${url}" target="_blank" rel="noopener">
      ${label.charAt(0).toUpperCase()+label.slice(1)}
    </a>`;
    sl.appendChild(li);
  }

  // 7) Add to Calendar button
  const calBtn = document.getElementById("calendar-btn");
  calBtn.disabled = true;
  calBtn.onclick  = null;
  try {
    const now     = new Date().toISOString();
    const inOneYr = new Date(Date.now()+365*24*60*60*1000).toISOString();
    const r2 = await fetch(
      `${BASE_URL}/station/${STATION_ID}/artists/${artistId}/schedule`
      + `?startDate=${now}&endDate=${inOneYr}`,
      { headers:{ "x-api-key": API_KEY } }
    );
    if (r2.ok) {
      const { schedules=[] } = await r2.json();
      if (schedules.length) {
        const { startDateUtc,endDateUtc } = schedules[0];
        calBtn.disabled = false;
        calBtn.onclick = () => {
          window.open(
            createGoogleCalLink(
              `DJ ${artist.name} Live Set`,
              startDateUtc,
              endDateUtc
            ), "_blank"
          );
        };
      }
    }
  } catch(err) {
    console.error("Schedule error:",err);
  }

  // 8) Mixcloud archive persistence
  const storageKey = `${artistId}-mixcloud-urls`;
  const listEl     = document.getElementById("mixes-list");

  function loadShows() {
    listEl.innerHTML = "";
    const urls = JSON.parse(localStorage.getItem(storageKey))||[];
    urls.forEach(url => {
      const wrapper = document.createElement("div");
      wrapper.className = "mix-show";

      const iframe = document.createElement("iframe");
      iframe.width      = "100%";
      iframe.height     = "60";
      iframe.frameBorder= "0";
      iframe.allow      = "autoplay";
      // **no line breaks in this string**
      iframe.src = "https://www.mixcloud.com/widget/iframe/?" +
                   "hide_cover=1&light=1&feed=" +
                   encodeURIComponent(url);
      wrapper.appendChild(iframe);
const btn = document.createElement("button");
btn.textContent = "Remove show";
btn.onclick = () => {
  const pwd = prompt("Enter password to remove this show:");
  if (pwd !== MIXCLOUD_PW) {
    return alert("Incorrect password");
  }
  const arr = JSON.parse(localStorage.getItem(storageKey)) || [];
  localStorage.setItem(
    storageKey,
    JSON.stringify(arr.filter(u => u !== url))
  );
  loadShows();
};
wrapper.appendChild(btn);

listEl.appendChild(wrapper);
    });
  }

  // initial load & add-show handler
  loadShows();
  document.getElementById("add-show-btn").onclick = () => {
    const pwd = prompt("Enter password to add a show:");
    if (pwd !== MIXCLOUD_PW) return alert("Incorrect password");
    const input = document.getElementById("mixcloud-url-input");
    const u = input.value.trim();
    if (!u) return;
    const arr = JSON.parse(localStorage.getItem(storageKey))||[];
    arr.push(u);
    localStorage.setItem(storageKey, JSON.stringify(arr));
    input.value = "";
    loadShows();
  };

} // initPage

window.addEventListener("DOMContentLoaded", initPage);

const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

const VIEW_THRESHOLD = parseInt(process.env.VIEW_THRESHOLD || "5000", 10);
const MAX_PER_KEYWORD = parseInt(process.env.MAX_PER_KEYWORD || "700", 10);
const YT_API_KEY =
  process.env.YT_API_KEY || process.env.YOUTUBE_API_KEY || null;

// --- cookie normalization ---
function normalizeCookieValue(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const obj = JSON.parse(trimmed);
      const parts = [];
      for (const [k, v] of Object.entries(obj)) {
        if (v) parts.push(`${k}=${v}`);
      }
      return parts.join("; ");
    } catch {}
  }
  return trimmed;
}
const rawCookies = [
  process.env.COOKIE1,
  process.env.COOKIE2,
  process.env.COOKIE3,
  process.env.COOKIE4,
  process.env.COOKIE5,
  process.env.COOKIE6,
  process.env.COOKIE7,
].filter(Boolean);
const cookies = rawCookies.map(normalizeCookieValue).filter(Boolean);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const kwDir = path.join(__dirname, "..", "data", "keywords");
const outCollected = path.join(__dirname, "..", "data", "collectedVideos.json");
const outMD = path.join(__dirname, "..", "data", "trending_videos.md");

fs.ensureDirSync(path.join(__dirname, "..", "data"));

function loadKeywords() {
  const result = {};
  if (!fs.existsSync(kwDir)) return result;
  const files = fs.readdirSync(kwDir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    const lang = path.basename(file, ".json");
    try {
      const data = fs.readJsonSync(path.join(kwDir, file));
      if (Array.isArray(data)) result[lang] = data;
      else if (typeof data === "object")
        result[lang] = Object.values(data).flat().filter(Boolean);
      else result[lang] = [];
    } catch {
      result[lang] = [];
    }
  }
  return result;
}

function dedupe(arr) {
  const map = new Map();
  for (const it of arr) {
    if (it && it.videoId && !map.has(it.videoId)) map.set(it.videoId, it);
  }
  return Array.from(map.values());
}

function parseHumanNumber(s) {
  if (!s) return 0;
  s = String(s).replace(/\u202f/g, "").replace(/,/g, "").trim();
  const last = s.slice(-1).toUpperCase();
  if (last === "K") return Math.round(parseFloat(s) * 1000);
  if (last === "M") return Math.round(parseFloat(s) * 1000000);
  if (last === "B") return Math.round(parseFloat(s) * 1000000000);
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? 0 : n;
}

/* --------- API SEARCH (supports pageToken) ---------- */
async function ytApiSearch(keyword, maxResults = 25) {
  let results = [];
  let pageToken = null;
  while (results.length < maxResults) {
    const resp = await axios.get(
      "https://www.googleapis.com/youtube/v3/search",
      {
        params: {
          key: YT_API_KEY,
          q: keyword,
          part: "snippet",
          type: "video",
          order: "date",
          maxResults: 50,
          pageToken: pageToken || "",
        },
        timeout: 20000,
      }
    );
    const ids = (resp.data.items || [])
      .map((i) => i.id?.videoId)
      .filter(Boolean);
    if (ids.length === 0) break;
    const vResp = await axios.get(
      "https://www.googleapis.com/youtube/v3/videos",
      {
        params: {
          key: YT_API_KEY,
          id: ids.join(","),
          part: "snippet,statistics",
        },
        timeout: 20000,
      }
    );
    results.push(
      ...(vResp.data.items || []).map((v) => ({
        videoId: v.id,
        title: v.snippet?.title || "",
        url: `https://www.youtube.com/watch?v=${v.id}`,
        views: parseInt(v.statistics?.viewCount || "0", 10),
        publishedAt: v.snippet?.publishedAt || null,
      }))
    );
    pageToken = resp.data.nextPageToken;
    if (!pageToken) break;
  }
  return results.slice(0, maxResults);
}

/* --------- SCRAPING SEARCH (with continuation) ---------- */
async function scrapeSearch(keyword, maxResults = 25) {
  const headers = { "User-Agent": "Mozilla/5.0" };
  if (cookies.length)
    headers["Cookie"] = cookies[Math.floor(Math.random() * cookies.length)];

  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(
    keyword
  )}&sp=EgIQAQ%3D%3D`;
  const resp = await axios.get(url, { headers, timeout: 20000 });
  const html = resp.data;

  const initMatch = html.match(
    /ytInitialData\s*=\s*(\{.+?\});<\/script>/s
  ) || html.match(/var ytInitialData = (\{.+?\});/s);
  const cfgMatch = html.match(/ytcfg\.set\(({.+?})\);/s);
  if (!initMatch || !cfgMatch) return [];

  const initialData = JSON.parse(initMatch[1]);
  const cfg = JSON.parse(cfgMatch[1]);
  const INNERTUBE_API_KEY = cfg?.INNERTUBE_API_KEY;
  const context = cfg?.INNERTUBE_CONTEXT;

  let videos = [];
  function collect(obj) {
    if (!obj || typeof obj !== "object") return;
    if (obj.videoRenderer && obj.videoRenderer.videoId) {
      const vr = obj.videoRenderer;
      const videoId = vr.videoId;
      const title = vr.title?.runs?.map((r) => r.text).join("") || "";
      let views = 0;
      const txt =
        vr.viewCountText?.simpleText ||
        vr.shortViewCountText?.simpleText ||
        "";
      if (txt) {
        const mm = txt.match(/([\d,.KMkmb]+)\s*views?/i);
        if (mm) views = parseHumanNumber(mm[1]);
      }
      videos.push({
        videoId,
        title,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        views,
        publishedAt: vr.publishedTimeText?.simpleText || null,
      });
    }
    for (const k in obj) collect(obj[k]);
  }
  collect(initialData);

  // continuation
  let contToken = null;
  function findContinuation(obj) {
    if (!obj || typeof obj !== "object") return;
    if (obj.continuationCommand?.token) {
      contToken = obj.continuationCommand.token;
    }
    for (const k in obj) findContinuation(obj[k]);
  }
  findContinuation(initialData);

  while (videos.length < maxResults && contToken) {
    const apiUrl = `https://www.youtube.com/youtubei/v1/search?key=${INNERTUBE_API_KEY}`;
    const body = { context, continuation: contToken };
    const r = await axios.post(apiUrl, body, { headers, timeout: 20000 });
    const data = r.data;
    contToken = null;
    findContinuation(data);

    function collect2(obj) {
      if (!obj || typeof obj !== "object") return;
      if (obj.videoRenderer && obj.videoRenderer.videoId) {
        const vr = obj.videoRenderer;
        const videoId = vr.videoId;
        const title = vr.title?.runs?.map((r) => r.text).join("") || "";
        let views = 0;
        const txt =
          vr.viewCountText?.simpleText ||
          vr.shortViewCountText?.simpleText ||
          "";
        if (txt) {
          const mm = txt.match(/([\d,.KMkmb]+)\s*views?/i);
          if (mm) views = parseHumanNumber(mm[1]);
        }
        videos.push({
          videoId,
          title,
          url: `https://www.youtube.com/watch?v=${videoId}`,
          views,
          publishedAt: vr.publishedTimeText?.simpleText || null,
        });
      }
      for (const k in obj) collect2(obj[k]);
    }
    collect2(data);
    await wait(1000);
  }
  return videos.slice(0, maxResults);
}

async function getVideoViews(videoId) {
  try {
    if (YT_API_KEY) {
      const resp = await axios.get(
        "https://www.googleapis.com/youtube/v3/videos",
        {
          params: { key: YT_API_KEY, id: videoId, part: "statistics" },
          timeout: 20000,
        }
      );
      const it = (resp.data.items || [])[0];
      return it?.statistics?.viewCount
        ? parseInt(it.statistics.viewCount, 10)
        : null;
    } else {
      const headers = { "User-Agent": "Mozilla/5.0" };
      if (cookies.length)
        headers["Cookie"] = cookies[Math.floor(Math.random() * cookies.length)];
      const r = await axios.get(
        `https://www.youtube.com/watch?v=${videoId}`,
        { headers, timeout: 20000 }
      );
      const mm = r.data.match(/"viewCount":"?(\d+)"?/);
      if (mm) return parseInt(mm[1], 10);
    }
  } catch {
    return null;
  }
  return null;
}

/* ---------------- MAIN ---------------- */
(async () => {
  console.log("--- Video monitor started ---");
  console.log(
    "VIEW_THRESHOLD=",
    VIEW_THRESHOLD,
    "MAX_PER_KEYWORD=",
    MAX_PER_KEYWORD
  );
  if (!YT_API_KEY && cookies.length === 0) {
    console.error("ERROR: No YT API key and no cookies.");
    process.exit(1);
  }
  console.log(`Using ${YT_API_KEY ? "API" : "Scraping"} method`);

  const keywordsByLang = loadKeywords();
  const langs = Object.keys(keywordsByLang);
  if (langs.length === 0) {
    console.error("No keyword files in data/keywords/");
    process.exit(1);
  }

  const collected = [];
  for (const [lang, kws] of Object.entries(keywordsByLang)) {
    for (const kw of kws) {
      try {
        let vids = [];
        if (YT_API_KEY)
          vids = await ytApiSearch(kw, MAX_PER_KEYWORD);
        else
          vids = await scrapeSearch(kw, MAX_PER_KEYWORD);
        vids = vids.map((v) => ({ ...v, language: lang }));
        collected.push(...vids);
        await wait(500);
      } catch (e) {
        console.warn("Error for", kw, e.message);
        await wait(1000);
      }
    }
  }

  const deduped = dedupe(collected);
  fs.writeJsonSync(outCollected, deduped, { spaces: 2 });
  console.log(`Collected ${deduped.length} videos`);

  console.log("Waiting 1 hour...");
  await wait(60 * 60 * 1000);

  const trendingByLang = {};
  for (const v of deduped) {
    const newViews = await getVideoViews(v.videoId);
    if (newViews !== null) {
      const growth = newViews - (v.views || 0);
      if (growth >= VIEW_THRESHOLD) {
        if (!trendingByLang[v.language]) trendingByLang[v.language] = [];
        trendingByLang[v.language].push({ ...v, newViews, growth });
      }
    }
    await wait(500);
  }

  for (const lang of Object.keys(trendingByLang)) {
    trendingByLang[lang].sort((a, b) => b.growth - a.growth);
  }

  const md = ["# Trending Videos", `Generated: ${new Date().toISOString()}`];
  for (const lang of Object.keys(trendingByLang)) {
    md.push(`## ${lang}`);
    for (const it of trendingByLang[lang]) {
      md.push(
        `- [${it.title}](${it.url}) — +${it.growth.toLocaleString()} views`
      );
    }
  }
  fs.writeFileSync(outMD, md.join("\n"));
  console.log("Done. Report in", outMD);
})();

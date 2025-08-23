const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

const VIEW_THRESHOLD = parseInt(process.env.VIEW_THRESHOLD || "3000", 10); // حداقل نرخ رشد (views/hour)
const MAX_PER_KEYWORD = parseInt(process.env.MAX_PER_KEYWORD || "1000", 10);

// ===== Cookie Normalization & Pool =====
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
    } catch (e) {
      console.warn("⚠️ Failed to parse cookie JSON:", e.message);
      return null;
    }
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
console.log(`🍪 Loaded ${cookies.length} cookies after normalization`);
if (!cookies.length) {
  console.error("❌ ERROR: No cookies provided. Scraping requires cookies.");
  process.exit(1);
}
const pickCookie = () => cookies[Math.floor(Math.random() * cookies.length)];

// ===== Paths & Utils =====
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
    } catch (e) {
      console.warn(`⚠️ Failed to load keywords for ${lang}:`, e.message);
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

function parsePublishedTime(text) {
  if (!text) return new Date();
  text = text.toLowerCase();
  const now = new Date();
  let match;
  if ((match = text.match(/(\d+)\s*hour/))) {
    return new Date(now.getTime() - parseInt(match[1], 10) * 3600000);
  }
  if ((match = text.match(/(\d+)\s*minute/))) {
    return new Date(now.getTime() - parseInt(match[1], 10) * 60000);
  }
  if ((match = text.match(/(\d+)\s*day/))) {
    return new Date(now.getTime() - parseInt(match[1], 10) * 86400000);
  }
  if ((match = text.match(/premiered\s+(.+)/))) {
    const d = new Date(match[1]);
    if (!isNaN(d)) return d;
  }
  return now;
}

function computeViewRate(video) {
  if (!video.views || !video.publishedAt) return 0;
  const publishedDate = parsePublishedTime(video.publishedAt);
  const ageHours = Math.max((Date.now() - publishedDate.getTime()) / 3600000, 0.5);
  return video.views / ageHours; // views per hour
}

function isViralCandidate(video) {
  return computeViewRate(video) >= VIEW_THRESHOLD;
}

// ===== Common Headers =====
function baseHeaders() {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  };
}

// ===== Scrape Function =====
async function scrapeSearch(keyword, maxResults = 25) {
  console.log(`🔎 Scraping keyword: "${keyword}" (max ${maxResults})`);
  const headers = { ...baseHeaders(), Cookie: pickCookie() };
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword)}&sp=EgIQAQ%3D%3D`;
  const resp = await axios.get(url, { headers, timeout: 20000 });
  const html = resp.data;

  const initMatch =
    html.match(/ytInitialData\s*=\s*(\{.+?\});<\/script>/s) ||
    html.match(/var ytInitialData = (\{.+?\});/s);
  if (!initMatch) {
    console.warn("⚠️ ytInitialData not found. Skipping.");
    return [];
  }

  const initialData = JSON.parse(initMatch[1]);
  let videos = [];

  function collect(obj) {
    if (!obj || typeof obj !== "object") return;
    if (obj.videoRenderer && obj.videoRenderer.videoId) {
      const vr = obj.videoRenderer;
      const videoId = vr.videoId;
      const title = vr.title?.runs?.map((r) => r.text).join("") || "";
      let views = 0;
      const txt = vr.viewCountText?.simpleText || vr.shortViewCountText?.simpleText || "";
      if (txt) {
        const mm = txt.match(/([\d,.KMkmb]+)\s*views?/i);
        if (mm) views = parseHumanNumber(mm[1]);
      }
      const video = {
        videoId,
        title,
        url: `https://www.youtube.com/watch?v=${videoId}`,
        views,
        publishedAt: vr.publishedTimeText?.simpleText || null,
        keyword,
      };
      if (isViralCandidate(video)) videos.push(video);
    }
    for (const k in obj) collect(obj[k]);
  }

  collect(initialData);
  console.log(`✅ Found ${videos.length} viral videos for "${keyword}"`);
  return videos.slice(0, maxResults);
}

// ===== Main =====
(async () => {
  console.log("--- Video monitor started ---");
  const keywordsByLang = loadKeywords();
  const langs = Object.keys(keywordsByLang);
  if (!langs.length) {
    console.error("❌ No keywords found.");
    process.exit(1);
  }

  const trendingByLang = {};

  for (const [lang, kws] of Object.entries(keywordsByLang)) {
    console.log(`🌐 Processing language: ${lang} (${kws.length} keywords)`);
    for (const kw of kws) {
      try {
        const vids = await scrapeSearch(kw, MAX_PER_KEYWORD);
        if (!trendingByLang[lang]) trendingByLang[lang] = [];
        trendingByLang[lang].push(...vids.map((v) => ({ ...v, language: lang })));
        console.log(`📝 Collected ${vids.length} viral candidates for keyword "${kw}"`);
        await wait(500 + Math.floor(Math.random() * 500));
      } catch (e) {
        console.warn("⚠️ Error scraping keyword", kw, e.message);
        await wait(1000);
      }
    }
  }

  // Deduplicate & Sort by view rate
  for (const lang of Object.keys(trendingByLang)) {
    trendingByLang[lang] = dedupe(trendingByLang[lang]);
    trendingByLang[lang].sort((a, b) => computeViewRate(b) - computeViewRate(a));
  }

  // Save JSON
  fs.writeJsonSync(outCollected, trendingByLang, { spaces: 2 });

  // Generate Markdown report
  const md = ["# Trending Videos", `Generated: ${new Date().toISOString()}`];
  for (const lang of Object.keys(trendingByLang)) {
    md.push(`## ${lang}`);
    for (const it of trendingByLang[lang]) {
      md.push(
        `- [${it.title}](${it.url}) — ${it.views.toLocaleString()} views — keyword: ${it.keyword}`
      );
    }
  }
  fs.writeFileSync(outMD, md.join("\n"));

  // Final log: viral videos per language
  console.log("🎯 Trending Videos by Language:");
  for (const lang of Object.keys(trendingByLang)) {
    console.log(`\n## ${lang}`);
    trendingByLang[lang].forEach((v) => {
      console.log(`- [${v.title}](${v.url}) — ${v.views.toLocaleString()} views`);
    });
  }

  console.log("🏁 Done. JSON and Markdown reports saved.");
})();

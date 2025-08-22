const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

const VIEW_THRESHOLD = parseInt(process.env.VIEW_THRESHOLD || "5000", 10);
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
const checkpointFile = path.join(__dirname, "..", "data", "views_checkpoint.json");

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

// ===== Common Headers =====
function baseHeaders() {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  };
}

// ===== Scrape (ytInitialData + continuation) =====
async function scrapeSearch(keyword, maxResults = 25) {
  console.log(`🔎 Starting scrape for keyword: "${keyword}" (max ${maxResults})`);
  const headers = { ...baseHeaders(), Cookie: pickCookie() };

  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(
    keyword
  )}&sp=EgIQAQ%3D%3D`;
  console.log("➡️ Fetching:", url);
  const resp = await axios.get(url, { headers, timeout: 20000 });
  const html = resp.data;

  const initMatch =
    html.match(/ytInitialData\s*=\s*(\{.+?\});<\/script>/s) ||
    html.match(/var ytInitialData = (\{.+?\});/s);
  const cfgMatch = html.match(/ytcfg\.set\((\{.+?\})\);/s);
  if (!initMatch || !cfgMatch) {
    console.warn(`⚠️ ytInitialData or ytcfg not found. Cookie may be invalid.`);
    return { videos: [], playerKey: null, context: null };
  }

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
  console.log(`✅ Found ${videos.length} initial videos for "${keyword}"`);

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

  let noNewVideosCount = 0;
  while (videos.length < maxResults && contToken) {
    console.log(`🔄 Fetching continuation (currently ${videos.length} videos)`);
    const apiUrl = `https://www.youtube.com/youtubei/v1/search?key=${INNERTUBE_API_KEY}`;
    const body = { context, continuation: contToken };
    const r = await axios.post(apiUrl, body, {
      headers: { ...baseHeaders(), Cookie: pickCookie() },
      timeout: 20000,
    });
    const data = r.data;
    contToken = null;
    findContinuation(data);

    const before = videos.length;
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

    if (videos.length === before) {
      noNewVideosCount++;
      if (noNewVideosCount >= 3) {
        console.log(`⚠️ No new videos after 3 continuations, breaking.`);
        break;
      }
    } else {
      noNewVideosCount = 0;
    }

    console.log(`➡️ Collected ${videos.length} videos so far for "${keyword}"`);
    await wait(1000 + Math.floor(Math.random() * 500));
  }
  console.log(`🎯 Final count for "${keyword}": ${videos.length} videos`);
  return { videos: videos.slice(0, maxResults), playerKey: INNERTUBE_API_KEY, context };
}

// ===== Player API (fast view count) with Retry & Jitter =====
async function getVideoViewsViaPlayer(videoId, key, context) {
  const maxAttempts = 4; // 4 تلاش با backoff نمایی
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const headers = { ...baseHeaders(), Cookie: pickCookie() };
      const body = {
        context,
        videoId,
        playbackContext: {
          contentPlaybackContext: { html5Preference: "HTML5_PREF_WANTS" },
        },
      };
      const url = `https://www.youtube.com/youtubei/v1/player?key=${key}`;
      const r = await axios.post(url, body, { headers, timeout: 15000 });

      const vd = r.data?.videoDetails;
      const vc = vd?.viewCount || vd?.shortViewCountText?.simpleText;
      if (!vc) {
        // گاهی پاسخ بدون ویوکانت است—به تلاش بعدی برو
        throw new Error("No viewCount in player response");
      }
      const numeric = /^\d+$/.test(vc) ? parseInt(vc, 10) : parseHumanNumber(vc);
      return Number.isFinite(numeric) ? numeric : null;
    } catch (e) {
      const status = e?.response?.status;
      const msg = e.message || String(e);
      console.warn(`⚠️ Player fetch failed for ${videoId} (attempt ${attempt}/${maxAttempts})${status ? " ["+status+"]" : ""}: ${msg}`);
      if (attempt < maxAttempts) {
        // backoff: 500ms * 2^(attempt-1) + jitter(0-400ms)
        const backoff = 500 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 400);
        await wait(backoff);
        continue;
      }
      return null;
    }
  }
  return null;
}

// ===== Batch Processor (High throughput, low 429 risk) =====
async function processInBatches(items, handler) {
  let idx = 0;
  let batchNo = 1;
  while (idx < items.length) {
    const batchSize = 50 + Math.floor(Math.random() * 31); // 50–80
    const batch = items.slice(idx, idx + batchSize);
    console.log(`📦 Batch #${batchNo}: items ${idx}–${idx + batch.length - 1} (${batch.length})`);

    await Promise.all(batch.map((x) => handler(x)));

    const delay = 200 + Math.floor(Math.random() * 300); // 200–500ms
    console.log(`⏸️ Waiting ${delay}ms before next batch...`);
    await wait(delay);

    idx += batchSize;
    batchNo++;
  }
}

// ================== MAIN ==================
(async () => {
  console.log("--- Video monitor started ---");
  console.log("VIEW_THRESHOLD=", VIEW_THRESHOLD, "MAX_PER_KEYWORD=", MAX_PER_KEYWORD);
  console.log("Using Scraping method (ytInitialData) + Player API for fast view checks");

  // 1) Load keywords
  const keywordsByLang = loadKeywords();
  const langs = Object.keys(keywordsByLang);
  if (!langs.length) {
    console.error("❌ No keyword files in data/keywords/");
    process.exit(1);
  }

  // 2) Resume collected videos (if exists)
  let collected = fs.existsSync(outCollected) ? fs.readJsonSync(outCollected) : [];

  // 3) Scrape per keyword with checkpoint per keyword
  for (const [lang, kws] of Object.entries(keywordsByLang)) {
    console.log(`🌐 Processing language: ${lang} (${kws.length} keywords)`);
    for (const kw of kws) {
      const already = collected.filter((v) => v.language === lang && v.keyword === kw);
      if (already.length >= MAX_PER_KEYWORD) {
        console.log(`⏭️ Skipping "${kw}" (already ${already.length} videos saved)`);
        continue;
      }

      try {
        const { videos, playerKey, context } = await scrapeSearch(kw, MAX_PER_KEYWORD);
        const vids = videos.map((v) => ({ ...v, language: lang, keyword: kw, _playerKey: playerKey, _ctx: context }));
        collected.push(...vids);
        const deduped = dedupe(collected);
        fs.writeJsonSync(outCollected, deduped, { spaces: 2 });
        console.log(`💾 Checkpoint saved: ${deduped.length} unique videos (after "${kw}")`);
        await wait(500 + Math.floor(Math.random() * 500));
      } catch (e) {
        console.warn("⚠️ Error for keyword", kw, e.message);
        await wait(1000);
      }
    }
  }

  // 4) Final save after collection
  const deduped = dedupe(collected);
  fs.writeJsonSync(outCollected, deduped, { spaces: 2 });
  console.log(`💾 Final save: ${deduped.length} unique videos to collectedVideos.json`);

  // 5) Wait 1 hour then re-check views
  console.log("⏳ Waiting 1 hour before re-checking views...");
  await wait(60 * 60 * 1000);

  // 6) Prepare Player API context/key:
  //    اگر برخی آیتم‌ها هنگام اسکرپ _playerKey/_ctx نداشته باشند، از یک سرچ کوتاه fallback می‌گیریم.
  let fallbackKey = null;
  let fallbackCtx = null;
  async function ensureFallbackKey() {
    if (fallbackKey && fallbackCtx) return;
    const probeKw = "news"; // هر چیزی
    const { playerKey, context } = await scrapeSearch(probeKw, 5);
    fallbackKey = playerKey;
    fallbackCtx = context;
    console.log("🔑 Fallback player key/context loaded.");
  }

  // 7) Load checkpoint for views
  let checkedIds = fs.existsSync(checkpointFile) ? fs.readJsonSync(checkpointFile) : {};

  const trendingByLang = {};
  let processedCount = 0;

  // Handler per item with Player API + retries + cookie rotation
  const handler = async (v) => {
    if (checkedIds[v.videoId]) return;

    let key = v._playerKey;
    let ctx = v._ctx;
    if (!key || !ctx) {
      await ensureFallbackKey();
      key = fallbackKey;
      ctx = fallbackCtx;
    }

    const newViews = await getVideoViewsViaPlayer(v.videoId, key, ctx);
    if (newViews !== null) {
      const growth = newViews - (v.views || 0);
      if (growth >= VIEW_THRESHOLD) {
        if (!trendingByLang[v.language]) trendingByLang[v.language] = [];
        trendingByLang[v.language].push({ ...v, newViews, growth });
        console.log(`🔥 Trending: ${v.title} (+${growth} views)`);
      }
    }

    checkedIds[v.videoId] = true;
    processedCount++;
    if (processedCount % 200 === 0) {
      fs.writeJsonSync(checkpointFile, checkedIds, { spaces: 2 });
      console.log(`🧭 Views checkpoint saved (${processedCount} processed).`);
    }
  };

  // 8) High-throughput, low-429 batch processing
  console.log("🚀 Starting fast view re-check with Player API (50–80 concurrency, 200–500ms between batches)...");
  await processInBatches(deduped, handler);

  // 9) Finalize
  fs.writeJsonSync(checkpointFile, checkedIds, { spaces: 2 });
  console.log(`✅ Views checkpoint saved (final, ${processedCount} processed).`);

  // Sort and write report
  for (const lang of Object.keys(trendingByLang)) {
    trendingByLang[lang].sort((a, b) => b.growth - a.growth);
  }
  const md = ["# Trending Videos", `Generated: ${new Date().toISOString()}`];
  for (const lang of Object.keys(trendingByLang)) {
    md.push(`## ${lang}`);
    for (const it of trendingByLang[lang]) {
      md.push(`- [${it.title}](${it.url}) — +${it.growth.toLocaleString()} views`);
    }
  }
  fs.writeFileSync(outMD, md.join("\n"));
  console.log("🏁 Done. Report generated at", outMD);
})();

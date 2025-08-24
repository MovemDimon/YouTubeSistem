const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

// --- thresholds (env overrideable)
const DAILY_THRESHOLD = parseInt(process.env.VIEW_DAILY_THRESHOLD || "20000", 10); // default 20k/day
const MIN_VIEWS = parseInt(process.env.MIN_VIEWS || "2000", 10); // default 2k views
const MAX_AGE_DAYS = parseInt(process.env.MAX_AGE_DAYS || "14", 10); // default 14 days
const MAX_CONT_PAGES = parseInt(process.env.MAX_CONT_PAGES || "1000", 10);

console.log("⚙️ Config:", { DAILY_THRESHOLD, MIN_VIEWS, MAX_AGE_DAYS, MAX_CONT_PAGES });

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
      else if (typeof data === "object") result[lang] = Object.values(data).flat().filter(Boolean);
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

// --- Text normalization for matching (remove diacritics, lower-case)
function normalizeText(s) {
  if (!s) return "";
  let t = String(s).toLowerCase().trim();
  // normalize unicode, remove combining marks
  try {
    t = t.normalize("NFD").replace(/\p{M}/gu, "");
  } catch (e) {
    // fallback if Unicode property escapes unsupported
    t = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
  return t;
}

// ===== Built-in multilingual crypto keyword whitelist =====
// you can extend these lists as needed
const BUILT_IN_KEYWORDS = {
  en: [
    "bitcoin","btc","ethereum","eth","altcoin","airdrop","presale","token","ico","defi","dex",
    "staking","yield","rug","scam","memecoin","shib","doge","solana","sol","bsc","binance",
    "uniswap","pancake","trading","trade","exchange","halving","whale","fomo","pump","dump",
    "nft","crypto","cryptocurrency","money","income","business","finance","stock","investing",
    "hustle","wealth","profit","cash","dollar","side"
  ],
  fa: [
    "بیت‌کوین","بیت","اتریوم","تتر","آلتکوین","ایردراپ","پرسیل","توکن","نهنگ","پامپ","دامپ",
    "ترید","تحلیل","صرافی","هاوینگ","میمکوین","شیبا","دوج","کیف","پول","تلگرام","ارز","دیجیتال",
    "درآمد","سرمایه","بورس","بازار","سهام","کسب","کار","پول","سود","سرمایه‌گذاری","مالی"
  ],
  es: [
    "bitcoin","btc","ethereum","eth","cripto","token","intercambio","trade","trading","exchange",
    "defi","dex","staking","halving","memecoin","shiba","doge","binance","bnb","solana","nft",
    "moneda","presale","pump","dump","whale","estafa","dinero","ingresos","negocio","finanzas",
    "bolsa","invertir","ahorro","trabajo","ganar","emprender","cash"
  ],
  ru: [
    "крипто","биткоин","btc","эфириум","eth","токен","трейд","биржа","майнинг","мемкоин","шиба",
    "доги","халвинг","памп","дамп","скам","монета","финансы","деньги","доход","бизнес","инвестиции",
    "акции","рынок","прибыль","капитал","экономия","работа"
  ],
  hi: [
    "क्रिप्टो","बिटकॉइन","btc","एथेरियम","eth","ट्रेड","टोकन","प्रेसैल","मेमकॉइन","शिबा","डोज",
    "वॉलेट","पैसा","आय","धन","काम","बिजनेस","फाइनेंस","निवेश","शेयर","मार्केट","लाभ","रोजगार",
    "सेविंग","इनकम","ऑनलाइन"
  ]
};

// flatten language fallback: if lang not defined, use English list
function getKeywordListForLang(lang) {
  if (!lang) return BUILT_IN_KEYWORDS.en;
  if (BUILT_IN_KEYWORDS[lang]) return BUILT_IN_KEYWORDS[lang];
  // try first 2 chars (e.g., "en-US" -> "en")
  const short = lang.slice(0, 2);
  return BUILT_IN_KEYWORDS[short] || BUILT_IN_KEYWORDS.en;
}

// check if title contains at least one keyword for language (or english fallback)
function titleMatchesWhitelist(title, lang) {
  if (!title) return false;
  const norm = normalizeText(title);
  const kws = getKeywordListForLang(lang);
  for (const kw of kws) {
    const nkw = normalizeText(kw);
    if (!nkw) continue;
    if (norm.includes(nkw)) return true;
  }
  return false;
}

// ===== Common Headers =====
function baseHeaders() {
  return {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
  };
}

// ===== Helpers for continuation token and renderer extraction (supports shorts) =====
function findContinuationToken(obj) {
  if (!obj || typeof obj !== "object") return null;
  let token = null;
  function walk(o) {
    if (!o || typeof o !== "object") return;
    if (o?.continuationItemRenderer?.continuationEndpoint?.continuationCommand?.token) {
      token = o.continuationItemRenderer.continuationEndpoint.continuationCommand.token;
      return;
    }
    if (o?.continuationCommand?.token) {
      token = o.continuationCommand.token;
      return;
    }
    for (const k in o) {
      if (token) return;
      walk(o[k]);
    }
  }
  walk(obj);
  return token;
}

function findFirst(obj, keyName) {
  if (!obj || typeof obj !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(obj, keyName)) return obj[keyName];
  for (const k of Object.keys(obj)) {
    const val = obj[k];
    if (val && typeof val === "object") {
      const found = findFirst(val, keyName);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function extractVideoFromRenderer(obj) {
  if (!obj || typeof obj !== "object") return null;

  // videoRenderer (regular)
  if (obj.videoRenderer && obj.videoRenderer.videoId) {
    const vr = obj.videoRenderer;
    const videoId = vr.videoId;
    const title = vr.title?.runs?.map((r) => r.text).join("") || findFirst(vr, "title") || "";
    let views = 0;
    const txt = vr.viewCountText?.simpleText || vr.shortViewCountText?.simpleText || findFirst(vr, "viewCountText") || "";
    if (txt) {
      const mm = String(txt).match(/([\d,.KMkmb]+)\s*views?/i);
      if (mm) views = parseHumanNumber(mm[1]);
    }
    const publishedAt = vr.publishedTimeText?.simpleText || findFirst(vr, "publishedTimeText") || null;
    return { videoId, title, url: `https://www.youtube.com/watch?v=${videoId}`, views, publishedAt };
  }

  // reelItemRenderer (Shorts)
  if (obj.reelItemRenderer) {
    const rr = obj.reelItemRenderer;
    let videoId = rr.videoId || findFirst(rr, "videoId") || null;
    if (!videoId) {
      const we = findFirst(rr, "watchEndpoint") || findFirst(rr, "navigationEndpoint");
      videoId = we?.videoId || (we?.watchEndpoint && we.watchEndpoint.videoId) || null;
    }
    let title = "";
    if (rr.headline?.runs) title = rr.headline.runs.map((r) => r.text).join("");
    if (!title) title = rr.title?.runs?.map((r) => r.text).join("") || findFirst(rr, "title") || "";
    let views = 0;
    const vtxt = rr.viewCountText?.simpleText || rr.shortViewCountText?.simpleText || findFirst(rr, "viewCountText") || "";
    if (vtxt) {
      const mm = String(vtxt).match(/([\d,.KMkmb]+)\s*views?/i);
      if (mm) views = parseHumanNumber(mm[1]);
    }
    const publishedAt = rr.publishedTimeText?.simpleText || findFirst(rr, "publishedTimeText") || null;
    if (videoId) return { videoId, title, url: `https://www.youtube.com/watch?v=${videoId}`, views, publishedAt };
  }

  // richItemRenderer -> try to find nested video or reel
  if (obj.richItemRenderer) {
    const vr = findFirst(obj.richItemRenderer, "videoRenderer");
    if (vr && vr.videoId) return extractVideoFromRenderer({ videoRenderer: vr });
    const rr = findFirst(obj.richItemRenderer, "reelItemRenderer");
    if (rr) return extractVideoFromRenderer({ reelItemRenderer: rr });
  }

  // fallback: find any videoId anywhere
  const anyId = findFirst(obj, "videoId");
  if (anyId) {
    const title = findFirst(obj, "title") || "";
    const vraw = findFirst(obj, "viewCountText") || findFirst(obj, "shortViewCountText") || "";
    let views = 0;
    if (vraw) {
      const mm = String(vraw).match(/([\d,.KMkmb]+)\s*views?/i);
      if (mm) views = parseHumanNumber(mm[1]);
    }
    const publishedAt = findFirst(obj, "publishedTimeText") || null;
    return { videoId: String(anyId), title: typeof title === "string" ? title : (title.runs ? title.runs.map(r=>r.text).join("") : ""), url: `https://www.youtube.com/watch?v=${anyId}`, views, publishedAt };
  }

  return null;
}

// ===== Published time parsing & scoring =====
function parsePublishedTime(text) {
  if (!text) return null;
  text = String(text).trim().toLowerCase();
  const now = new Date();
  let m;
  if ((m = text.match(/(\d+)\s*minute/))) return new Date(now.getTime() - parseInt(m[1],10)*60000);
  if ((m = text.match(/(\d+)\s*hour/))) return new Date(now.getTime() - parseInt(m[1],10)*3600000);
  if ((m = text.match(/(\d+)\s*day/))) return new Date(now.getTime() - parseInt(m[1],10)*86400000);
  if ((m = text.match(/(\d+)\s*week/))) return new Date(now.getTime() - parseInt(m[1],10)*7*86400000);
  if ((m = text.match(/(\d+)\s*month/))) return new Date(now.getTime() - parseInt(m[1],10)*30*86400000);
  if ((m = text.match(/(\d+)\s*year/))) return new Date(now.getTime() - parseInt(m[1],10)*365*86400000);
  if ((m = text.match(/streamed\s+(\d+)\s*hour/))) return new Date(now.getTime() - parseInt(m[1],10)*3600000);
  if ((m = text.match(/premiered\s+(.+)/))) {
    const d = new Date(m[1].trim());
    if (!isNaN(d)) return d;
  }
  const tryDate = new Date(text);
  if (!isNaN(tryDate)) return tryDate;
  return null;
}

function computeViewsPerDay(video) {
  if (!video.views || !video.publishedAt) return 0;
  const publishedDate = parsePublishedTime(video.publishedAt);
  if (!publishedDate) return 0;
  const ageMs = Date.now() - publishedDate.getTime();
  const ageDays = Math.max(ageMs / (1000*60*60*24), 0.020833333); // min 0.5 hour
  return video.views / ageDays;
}

function isViralCandidate(video) {
  const publishedDate = parsePublishedTime(video.publishedAt);
  if (!publishedDate) return false;
  const ageDays = (Date.now() - publishedDate.getTime())/(1000*60*60*24);
  if (ageDays < 0) return false;
  if (ageDays > MAX_AGE_DAYS) return false;
  if (!video.views || video.views < MIN_VIEWS) return false;
  const vpd = computeViewsPerDay(video);
  return vpd >= DAILY_THRESHOLD;
}

// ===== Scrape (ytInitialData + follow continuations when possible) =====
async function scrapeSearchAll(keyword) {
  const headers = { ...baseHeaders(), Cookie: pickCookie() };
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword)}&sp=EgIQAQ%3D%3D`;
  const resp = await axios.get(url, { headers, timeout: 30000 });
  const html = resp.data;

  // try to extract ytcfg (for continuation)
  const cfgMatch = html.match(/ytcfg\.set\((\{.+?\})\);/s);
  let INNERTUBE_API_KEY = null;
  let INNERTUBE_CONTEXT = null;
  if (cfgMatch) {
    try {
      const cfg = JSON.parse(cfgMatch[1]);
      INNERTUBE_API_KEY = cfg?.INNERTUBE_API_KEY || null;
      INNERTUBE_CONTEXT = cfg?.INNERTUBE_CONTEXT || cfg?.INNERTUBE_CONTEXT_CLIENT_NAME ? cfg?.INNERTUBE_CONTEXT : null;
    } catch (e) {}
  }

  const initMatch = html.match(/ytInitialData\s*=\s*(\{.+?\});<\/script>/s) || html.match(/var ytInitialData = (\{.+?\});/s);
  if (!initMatch) return { scrapedCount: 0, videos: [] };

  let initialData;
  try { initialData = JSON.parse(initMatch[1]); } catch (e) { return { scrapedCount: 0, videos: [] }; }

  const collected = [];
  function walkAndCollect(obj) {
    if (!obj || typeof obj !== "object") return;
    const extracted = extractVideoFromRenderer(obj);
    if (extracted && extracted.videoId) collected.push(extracted);
    for (const k in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) walkAndCollect(obj[k]);
    }
  }
  walkAndCollect(initialData);

  // follow continuations when possible
  let contToken = findContinuationToken(initialData);
  let contPages = 0;
  while (contToken && contPages < MAX_CONT_PAGES) {
    contPages++;
    if (!INNERTUBE_API_KEY || !INNERTUBE_CONTEXT) {
      console.warn("⚠️ INNERTUBE key/context not found — stopping continuations.");
      break;
    }
    try {
      const apiUrl = `https://www.youtube.com/youtubei/v1/search?key=${INNERTUBE_API_KEY}`;
      const body = { context: INNERTUBE_CONTEXT, continuation: contToken };
      const r = await axios.post(apiUrl, body, { headers: { ...baseHeaders(), Cookie: pickCookie() }, timeout: 30000 });
      const data = r.data;
      walkAndCollect(data);
      contToken = findContinuationToken(data);
      await wait(300 + Math.floor(Math.random()*400));
    } catch (e) {
      console.warn("⚠️ Continuation fetch failed:", e.message);
      break;
    }
  }

  const deduped = dedupe(collected);
  return { scrapedCount: deduped.length, videos: deduped };
}

// ===== MAIN =====
(async () => {
  console.log("--- Video monitor started (whitelist title matching + shorts) ---");
  const keywordsByLang = loadKeywords();
  const langs = Object.keys(keywordsByLang);
  if (!langs.length) {
    console.error("❌ No keywords found in data/keywords/");
    process.exit(1);
  }

  const trendingByLang = {};

  for (const [lang, kws] of Object.entries(keywordsByLang)) {
    console.log(`🌐 Processing language: ${lang} (${kws.length} keywords)`);
    for (const kw of kws) {
      try {
        const { scrapedCount, videos } = await scrapeSearchAll(kw);
        // only keep videos whose title matches built-in whitelist for this language
        let matched = [];
        for (const v of videos) {
          const title = v.title || "";
          if (titleMatchesWhitelist(title, lang)) {
            matched.push(v);
          }
        }
        console.log(`📝 Collected ${scrapedCount} videos (raw) for keyword "${kw}" — matched by whitelist: ${matched.length}`);
        // apply viral candidate filter to matched set
        const passed = [];
        for (const m of matched) {
          const vv = { ...m, keyword: kw, language: lang };
          if (isViralCandidate(vv)) {
            vv.views_per_day = Math.round(computeViewsPerDay(vv));
            passed.push(vv);
          }
        }
        if (!trendingByLang[lang]) trendingByLang[lang] = [];
        trendingByLang[lang].push(...passed);
        await wait(400 + Math.floor(Math.random()*600));
      } catch (e) {
        console.warn("⚠️ Error processing keyword", kw, e.message);
        await wait(1000);
      }
    }
  }

  // dedupe & sort
  for (const lang of Object.keys(trendingByLang)) {
    trendingByLang[lang] = dedupe(trendingByLang[lang]);
    trendingByLang[lang].sort((a,b) => (b.views_per_day||0) - (a.views_per_day||0));
  }

  // save JSON & MD
  fs.writeJsonSync(outCollected, trendingByLang, { spaces: 2 });
  console.log(`💾 Saved JSON report to ${outCollected}`);

  const md = ["# Trending Videos (Filtered & Whitelisted)", `Generated: ${new Date().toISOString()}`, ""];
  for (const lang of Object.keys(trendingByLang)) {
    md.push(`## ${lang}`);
    for (const it of trendingByLang[lang]) {
      md.push(`- [${it.title}](${it.url}) — ${it.views.toLocaleString()} views — ${it.views_per_day.toLocaleString()} views/day — keyword: ${it.keyword}`);
    }
    md.push("");
  }
  fs.writeFileSync(outMD, md.join("\n"));
  console.log(`💾 Saved Markdown report to ${outMD}`);

  // final CLI log (clickable links)
  console.log("\n🎯 Trending Videos by Language (whitelisted & filtered):\n");
  for (const lang of Object.keys(trendingByLang)) {
    console.log(`## ${lang}`);
    if (!trendingByLang[lang].length) {
      console.log("- (no viral candidates found)");
    } else {
      for (const v of trendingByLang[lang]) {
        console.log(`- ${v.title} — ${v.views.toLocaleString()} views — ${v.views_per_day.toLocaleString()} views/day`);
        console.log(`  ${v.url}`);
      }
    }
    console.log("");
  }

  console.log("🏁 Done. JSON and Markdown reports saved.");
})();

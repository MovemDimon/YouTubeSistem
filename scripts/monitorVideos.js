const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs-extra');
const path = require('path');

const VIEW_THRESHOLD = parseInt(process.env.VIEW_THRESHOLD || '5000', 10);
const MAX_PER_KEYWORD = parseInt(process.env.MAX_PER_KEYWORD || '500', 10);
const YT_API_KEY = process.env.YT_API_KEY || process.env.YOUTUBE_API_KEY || null;

// Normalize cookie env vars (accept JSON or header-string)
function normalizeCookieValue(raw) {
  if (!raw) return null;
  // If looks like JSON (starts with {), try parse
  const trimmed = String(raw).trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const obj = JSON.parse(trimmed);
      if (obj && typeof obj === 'object') {
        const parts = [];
        for (const [k, v] of Object.entries(obj)) {
          if (v === null || v === undefined) continue;
          // ensure no semicolons in value
          parts.push(`${k}=${String(v)}`);
        }
        return parts.join('; ');
      }
    } catch (e) {
      // fallthrough
    }
  }
  // otherwise assume already cookie header
  return trimmed;
}

const rawCookies = [
  process.env.COOKIE1, process.env.COOKIE2, process.env.COOKIE3,
  process.env.COOKIE4, process.env.COOKIE5, process.env.COOKIE6, process.env.COOKIE7
].filter(Boolean);

const cookies = rawCookies.map(normalizeCookieValue).filter(Boolean);

// polite helper
const wait = (ms) => new Promise(r => setTimeout(r, ms));

const kwDir = path.join(__dirname, '..', 'data', 'keywords');
const outCollected = path.join(__dirname, '..', 'data', 'collectedVideos.json');
const outMD = path.join(__dirname, '..', 'data', 'trending_videos.md');

fs.ensureDirSync(path.join(__dirname, '..', 'data'));

// Load keywords files
function loadKeywords() {
  const result = {};
  if (!fs.existsSync(kwDir)) return result;
  const files = fs.readdirSync(kwDir).filter(f => f.endsWith('.json'));
  for (const file of files) {
    const lang = path.basename(file, '.json');
    try {
      const data = fs.readJsonSync(path.join(kwDir, file));
      if (Array.isArray(data)) result[lang] = data;
      else if (typeof data === 'object') {
        // If stored as { "en": [...] } or keyed object, normalize
        if (Array.isArray(data[lang])) result[lang] = data[lang];
        else result[lang] = Object.values(data).flat().filter(Boolean);
      } else result[lang] = [];
    } catch (e) {
      console.warn('Failed to parse', file, e.message);
      result[lang] = [];
    }
  }
  return result;
}

// dedupe by videoId (keep first)
function dedupe(arr) {
  const map = new Map();
  for (const it of arr) {
    if (!it || !it.videoId) continue;
    if (!map.has(it.videoId)) map.set(it.videoId, it);
  }
  return Array.from(map.values());
}

function parseHumanNumber(s) {
  if (!s) return 0;
  s = String(s).replace(/\u202f/g,'').replace(/,/g,'').trim();
  const last = s.slice(-1).toUpperCase();
  if (last === 'K') return Math.round(parseFloat(s.slice(0,-1)) * 1000);
  if (last === 'M') return Math.round(parseFloat(s.slice(0,-1)) * 1000000);
  if (last === 'B') return Math.round(parseFloat(s.slice(0,-1)) * 1000000000);
  // try plain int
  const n = parseInt(s,10);
  return Number.isNaN(n) ? 0 : n;
}

/* ========== SEARCH (API or Scrape) ========== */

async function ytApiSearch(keyword, maxResults = 25) {
  const searchUrl = 'https://www.googleapis.com/youtube/v3/search';
  let allIds = [];
  let nextPageToken = null;

  while (allIds.length < maxResults) {
    const sResp = await axios.get(searchUrl, {
      params: {
        key: YT_API_KEY,
        q: keyword,
        part: 'snippet',
        type: 'video',
        order: 'date',
        maxResults: 50,
        pageToken: nextPageToken || undefined
      },
      timeout: 20000
    });

    const items = sResp.data.items || [];
    allIds.push(...items.map(i => i.id?.videoId).filter(Boolean));

    nextPageToken = sResp.data.nextPageToken;
    if (!nextPageToken) break;
  }

  // فقط همون تعداد مورد نیاز رو نگه داریم
  allIds = allIds.slice(0, maxResults);

  if (allIds.length === 0) return [];

  const vResp = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
    params: {
      key: YT_API_KEY,
      id: allIds.join(','),
      part: 'snippet,statistics'
    },
    timeout: 20000
  });

  return (vResp.data.items || []).map(v => ({
    videoId: v.id,
    title: v.snippet?.title || '',
    url: `https://www.youtube.com/watch?v=${v.id}`,
    views: parseInt(v.statistics?.viewCount || '0', 10),
    publishedAt: v.snippet?.publishedAt || null
  }));
}


async function scrapeSearch(keyword, maxResults = 25) {
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(keyword)}&sp=EgIQAQ%3D%3D`;
  const headers = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36' };
  if (cookies.length) headers['Cookie'] = cookies[Math.floor(Math.random()*cookies.length)];
  const resp = await axios.get(url, { headers, timeout: 20000 });
  const html = resp.data;
  const m = html.match(/ytInitialData\s*=\s*(\{.+?\});<\/script>/s) || html.match(/var ytInitialData = (\{.+?\});/s) || html.match(/window\["ytInitialData"\]\s*=\s*(\{.+?\});/s);
  if (!m) return [];
  const json = JSON.parse(m[1]);
  const videos = [];
  function walk(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (obj.videoRenderer && obj.videoRenderer.videoId) {
      videos.push(obj.videoRenderer);
      return;
    }
    for (const k of Object.keys(obj)) walk(obj[k]);
  }
  walk(json);
  const out = [];
  for (const vr of videos.slice(0, maxResults)) {
    const videoId = vr.videoId;
    const title = Array.isArray(vr.title?.runs) ? vr.title.runs.map(r=>r.text).join('') : (vr.title?.simpleText || '');
    let views = 0;
    try {
      const txt = vr?.viewCountText?.simpleText || vr?.shortViewCountText?.simpleText || (vr?.viewCountText?.runs && vr.viewCountText.runs.map(r=>r.text).join(''));
      if (txt) {
        const mm = txt.replace(/\u202f/g,'').match(/([\d,.KMkmb]+)\s*views?/i);
        if (mm) views = parseHumanNumber(mm[1]);
      }
    } catch(e){}
    const publishedAt = vr?.publishedTimeText?.simpleText || null;
    out.push({ videoId, title, url: `https://www.youtube.com/watch?v=${videoId}`, views, publishedAt });
  }
  return out;
}

async function getVideoViews(videoId) {
  try {
    if (YT_API_KEY) {
      const resp = await axios.get('https://www.googleapis.com/youtube/v3/videos', { params: { key: YT_API_KEY, id: videoId, part: 'statistics' }, timeout: 20000 });
      const it = (resp.data.items || [])[0];
      if (it && it.statistics && it.statistics.viewCount) return parseInt(it.statistics.viewCount, 10);
      return null;
    } else {
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      const headers = { 'User-Agent': 'Mozilla/5.0' };
      if (cookies.length) headers['Cookie'] = cookies[Math.floor(Math.random()*cookies.length)];
      const r = await axios.get(url, { headers, timeout: 20000 });
      const html = r.data;
      // attempt to find viewCount
      const mm = html.match(/"viewCount":"?(\d+)"?/);
      if (mm) return parseInt(mm[1],10);
      // fallback: try player response
      const m = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
      if (m) {
        try {
          const obj = JSON.parse(m[1]);
          const vc = obj?.videoDetails?.viewCount;
          if (vc) return parseInt(vc,10);
        } catch(e){}
      }
      return null;
    }
  } catch (e) {
    return null;
  }
}

/* ========== MAIN FLOW ========== */

(async () => {
  try {
    console.log('--- Video monitor started ---');
    console.log('VIEW_THRESHOLD=', VIEW_THRESHOLD, 'MAX_PER_KEYWORD=', MAX_PER_KEYWORD);
    if (!YT_API_KEY && cookies.length === 0) {
      console.error('ERROR: No YT API key and no cookies provided. Please set YT_API_KEY or COOKIE1..COOKIE7 in secrets.');
      process.exit(1);
    }
    console.log(`Using ${YT_API_KEY ? 'YouTube Data API' : 'scraping (with cookies if provided)'} method.`);

    const keywordsByLang = loadKeywords();
    const langs = Object.keys(keywordsByLang);
    if (langs.length === 0) {
      console.error('No keyword files found in data/keywords/. Place en.json fa.json etc.');
      process.exit(1);
    }
    console.log('Detected languages:', langs.join(', '));

    const collected = [];

    for (const [lang, kws] of Object.entries(keywordsByLang)) {
      if (!Array.isArray(kws) || kws.length === 0) continue;
      console.log(`Searching ${kws.length} keywords for lang=${lang} ...`);
      for (const kw of kws) {
        try {
          let vids = [];
          if (YT_API_KEY) {
            vids = await ytApiSearch(kw, MAX_PER_KEYWORD);
          } else {
            vids = await scrapeSearch(kw, MAX_PER_KEYWORD);
          }
          vids = vids.map(v => ({ ...v, language: lang }));
          collected.push(...vids);
          // small polite pause per keyword to avoid throttling
          await wait(600);
        } catch (err) {
          console.warn('Search error for', kw, (err && err.message) ? err.message.slice(0,200) : err);
          await wait(1200);
        }
      }
    }

    const deduped = dedupe(collected);
    fs.writeJsonSync(outCollected, deduped, { spaces: 2 });
    console.log(`Collected ${deduped.length} unique videos. Saved to ${outCollected}`);

    // WAIT 1 hour (workflow remains alive)
    console.log('Waiting 1 hour to measure growth (workflow will stay alive)...');
    await wait(60 * 60 * 1000);

    console.log('Re-checking views for collected videos...');
    const trendingByLang = {};
    let checked = 0;
    for (const v of deduped) {
      checked++;
      // polite delay per video
      await wait(500);
      const newViews = await getVideoViews(v.videoId);
      if (newViews === null) {
        console.warn(`Could not fetch views for ${v.videoId}`);
        continue;
      }
      const growth = newViews - (v.views || 0);
      if (growth >= VIEW_THRESHOLD) {
        if (!trendingByLang[v.language]) trendingByLang[v.language] = [];
        trendingByLang[v.language].push({ ...v, newViews, growth });
      }
      if (checked % 50 === 0) console.log(`Checked ${checked}/${deduped.length}`);
    }

    // sort each language by growth desc
    for (const lang of Object.keys(trendingByLang)) {
      trendingByLang[lang].sort((a,b) => b.growth - a.growth);
    }

    // Write markdown report
    const mdLines = ['# Trending Videos (filtered by growth)', `Generated at: ${new Date().toISOString()}`, ''];
    for (const lang of Object.keys(trendingByLang)) {
      mdLines.push(`## Language: ${lang}`);
      for (const it of trendingByLang[lang]) {
        mdLines.push(`- [${it.title}](${it.url}) — +${it.growth.toLocaleString()} views — total ${it.newViews.toLocaleString()}`);
      }
      mdLines.push('');
    }
    fs.writeFileSync(outMD, mdLines.join('\n'));
    console.log(`Wrote markdown report to ${outMD}`);

    // Console log clickable links (GitHub renders them)
    console.log('\n=== Trending Videos ===');
    for (const lang of Object.keys(trendingByLang)) {
      console.log(`\n--- ${lang} ---`);
      for (const it of trendingByLang[lang]) {
        console.log(`✅ [${it.title}](${it.url}) | +${it.growth} views | total=${it.newViews}`);
      }
    }

    console.log('\nDone.');
    process.exit(0);

  } catch (err) {
    console.error('Fatal error:', err && err.message ? err.message : err);
    process.exit(1);
  }
})();

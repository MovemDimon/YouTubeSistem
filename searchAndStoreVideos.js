import fs from 'fs';
import { ACCOUNTS } from './youtube_cookies.js';
import { pickRandom, sleep } from './utils.js';

const LANGS = ['en', 'fa', 'ru', 'es', 'hi'];

async function searchYouTube(keyword, cookie) {
  const params = new URLSearchParams({
    search_query: keyword,
    sp: 'EgIQAQ%253D%253D', // فیلتر ویدیو
  });

  const res = await fetch(`https://www.youtube.com/results?${params}`, {
    headers: {
      'Cookie': cookie,
      'User-Agent': 'Mozilla/5.0',
    },
  });

  const text = await res.text();
  const json = JSON.parse(text.split('var ytInitialData = ')[1].split(';</script>')[0]);

  const items = json.contents.twoColumnSearchResultsRenderer.primaryContents.sectionListRenderer.contents
    .flatMap(x => x.itemSectionRenderer?.contents || [])
    .map(x => x.videoRenderer)
    .filter(Boolean);

  return items.map(v => ({
    videoId: v.videoId,
    title: v.title.runs[0].text,
    views: parseInt(v.viewCountText?.simpleText?.replace(/[^\d]/g, '') || 0),
    published: v.publishedTimeText?.simpleText || '',
  }));
}

async function main() {
  for (const lang of LANGS) {
    const keywords = JSON.parse(fs.readFileSync(`data/keywords/${lang}.json`, 'utf8'));
    const results = [];

    for (const keyword of keywords) {
      const account = pickRandom(ACCOUNTS);
      try {
        const videos = await searchYouTube(keyword, account.cookie);
        results.push(...videos);
        await sleep(2000 + Math.random() * 2000);
      } catch (e) {
        console.warn(`❌ Failed to fetch for ${keyword}:`, e.message);
      }
    }

    const unique = Object.values(Object.fromEntries(results.map(v => [v.videoId, v])));
    fs.writeFileSync(`data/videos/${lang}.json`, JSON.stringify(unique, null, 2));
    console.log(`✅ Saved ${unique.length} videos for [${lang}]`);
  }
}

main();

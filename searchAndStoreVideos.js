import fs from 'fs';
import { ACCOUNTS } from './youtube_cookies.js';
import { pickRandom, delay, retryOperation, validateFile } from './utils.js'; // تغییر sleep به delay

const LANGS = ['en', 'fa', 'ru', 'es', 'hi'];
const MAX_ATTEMPTS = 3;

async function searchYouTube(keyword, cookie) {
  if (!cookie) throw new Error('Invalid cookie');

  const params = new URLSearchParams({
    search_query: keyword,
    sp: 'EgIQAQ%253D%253D',
  });

  const res = await fetch(`https://www.youtube.com/results?${params}`, {
    headers: {
      'Cookie': cookie,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    },
  });

  const text = await res.text();
  const ytDataMatch = text.split('var ytInitialData = ');
  
  if (ytDataMatch.length < 2) {
    throw new Error('YouTube data structure not found');
  }
  
  const jsonStr = ytDataMatch[1].split(';</script>')[0];
  const json = JSON.parse(jsonStr);

  // اعتبارسنجی ساختار داده
  const getSafe = (obj, ...path) => path.reduce((o, p) => o?.[p], obj);
  
  const items = getSafe(
    json,
    'contents',
    'twoColumnSearchResultsRenderer',
    'primaryContents',
    'sectionListRenderer',
    'contents'
  ) || [];

  const videos = items.flatMap(section => 
    (section.itemSectionRenderer?.contents || [])
      .map(item => item.videoRenderer)
      .filter(Boolean)
      .map(v => ({
        videoId: v.videoId,
        title: v.title?.runs?.[0]?.text || 'No title',
        views: parseInt(v.viewCountText?.simpleText?.replace(/[^\d]/g, '') || 0),
        published: v.publishedTimeText?.simpleText || '',
      }))
  );

  return videos;
}

async function main() {
  // ایجاد پوشه videos اگر وجود ندارد
  if (!fs.existsSync('data/videos')) {
    fs.mkdirSync('data/videos', { recursive: true });
  }

  for (const lang of LANGS) {
    const keywordsPath = `data/keywords/${lang}.json`;
    if (!fs.existsSync(keywordsPath)) {
      console.warn(`Skipping ${lang}: keywords file not found`);
      continue;
    }

    const keywords = JSON.parse(validateFile(keywordsPath));
    const results = [];

    for (const keyword of keywords) {
      const validAccounts = ACCOUNTS.filter(a => a.cookie);
      if (validAccounts.length === 0) {
        throw new Error('No valid accounts available');
      }

      const account = pickRandom(validAccounts);
      try {
        const videos = await retryOperation(
          () => searchYouTube(keyword, account.cookie),
          "searchYouTube",
          MAX_ATTEMPTS
        );
        
        results.push(...videos);
        console.log(`🔍 [${lang}] Found ${videos.length} videos for "${keyword}"`);
        
        await delay(3000 + Math.random() * 4000); // تغییر sleep به delay
      } catch (e) {
        console.warn(`❌ [${lang}] Failed for "${keyword}": ${e.message}`);
      }
    }

    const uniqueVideos = Object.values(
      results.reduce((acc, video) => {
        if (video.videoId) acc[video.videoId] = video;
        return acc;
      }, {})
    );
    
    if (uniqueVideos.length > 0) {
      fs.writeFileSync(`data/videos/${lang}.json`, JSON.stringify(uniqueVideos, null, 2));
      console.log(`✅ [${lang}] Saved ${uniqueVideos.length} unique videos`);
    }
  }
}

main().catch(e => console.error('🔥 Search failed:', e));

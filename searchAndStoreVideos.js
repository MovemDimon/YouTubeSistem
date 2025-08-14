import fs from 'fs';
import { ACCOUNTS } from './youtube_cookies.js';
import { pickRandom, delay, retryOperation, validateFile } from './utils.js';

const LANGS = ['en', 'fa', 'ru', 'es', 'hi'];
const MAX_ATTEMPTS = 3;
const MAX_VIDEOS_PER_LANG = 500; // محدودیت تعداد ویدیوهای ذخیره شده
const MIN_VIDEOS_FOR_SKIP = 50; // حداقل ویدیوهای مورد نیاز برای صرف‌نظر از جستجو

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

export async function searchAndStoreVideos() {
  if (!fs.existsSync('data/videos')) {
    fs.mkdirSync('data/videos', { recursive: true });
  }

  for (const lang of LANGS) {
    const keywordsPath = `data/keywords/${lang}.json`;
    if (!fs.existsSync(keywordsPath)) {
      console.warn(`⚠️ Skipping ${lang}: keywords file not found`);
      continue;
    }

    // بارگیری ویدیوهای موجود
    let existingVideos = [];
    try {
      if (fs.existsSync(`data/videos/${lang}.json`)) {
        existingVideos = JSON.parse(fs.readFileSync(`data/videos/${lang}.json`, 'utf-8'));
        console.log(`ℹ️ [${lang}] Loaded ${existingVideos.length} existing videos`);
      }
    } catch (e) {
      console.warn(`⚠️ Error loading existing videos for ${lang}:`, e.message);
    }

    // اگر ویدیوهای کافی موجود است، جستجو نکنید
    if (existingVideos.length >= MIN_VIDEOS_FOR_SKIP) {
      console.log(`⏩ [${lang}] Skipping search (enough videos already)`);
      continue;
    }

    const keywords = JSON.parse(validateFile(keywordsPath));
    const results = [...existingVideos];
    let keywordsProcessed = 0;

    for (const keyword of keywords) {
      if (results.length >= MAX_VIDEOS_PER_LANG) break;

      const validAccounts = ACCOUNTS.filter(a => a.cookie);
      if (validAccounts.length === 0) {
        throw new Error('❌ No valid accounts available');
      }

      const account = pickRandom(validAccounts);
      try {
        const videos = await retryOperation(
          () => searchYouTube(keyword, account.cookie),
          "searchYouTube",
          MAX_ATTEMPTS
        );
        
        // فیلتر ویدیوهای تکراری
        const newVideos = videos.filter(v => 
          !results.some(existing => existing.videoId === v.videoId)
        );
        
        results.push(...newVideos);
        keywordsProcessed++;
        console.log(`🔍 [${lang}] Found ${newVideos.length} new videos for "${keyword}" (Total: ${results.length})`);
        
        await delay(2000 + Math.random() * 3000); // کاهش تاخیر
      } catch (e) {
        console.warn(`⚠️ [${lang}] Failed for "${keyword}":`, e.message);
      }
    }

    // ذخیره فقط اگر ویدیوی جدیدی اضافه شده
    if (keywordsProcessed > 0) {
      const uniqueVideos = results
        .filter((v, i, a) => a.findIndex(t => t.videoId === v.videoId) === i)
        .slice(0, MAX_VIDEOS_PER_LANG);
      
      fs.writeFileSync(`data/videos/${lang}.json`, JSON.stringify(uniqueVideos, null, 2));
      console.log(`✅ [${lang}] Saved ${uniqueVideos.length} videos (${keywordsProcessed} keywords processed)`);
    }
  }
}

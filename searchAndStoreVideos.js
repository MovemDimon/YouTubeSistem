import fs from 'fs';
import { ACCOUNTS } from './youtube_cookies.js';
import { pickRandom, delay, retryOperation } from './utils.js';

const LANGS = ['en', 'fa', 'ru', 'es', 'hi'];
const MAX_ATTEMPTS = 3;
const MIN_VIDEOS_PER_LANG = 10;
const DATA_PATH = './data';

async function searchYouTube(keyword, cookie) {
  const params = new URLSearchParams({
    search_query: keyword,
    sp: 'EgIQAQ%253D%253D',
  });

  const response = await fetch(`https://www.youtube.com/results?${params}`, {
    headers: {
      'Cookie': cookie,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    },
  });

  const html = await response.text();
  const videoIds = [...html.matchAll(/"videoId":"(.*?)"/g)]
    .map(match => match[1])
    .filter(id => id && id.length === 11);

  return Array.from(new Set(videoIds));
}

export async function searchAndStoreVideos() {
  // ایجاد پوشه‌ها اگر وجود نداشته باشند
  if (!fs.existsSync(`${DATA_PATH}/videos`)) {
    fs.mkdirSync(`${DATA_PATH}/videos`, { recursive: true });
  }
  
  if (!fs.existsSync(`${DATA_PATH}/keywords`)) {
    fs.mkdirSync(`${DATA_PATH}/keywords`, { recursive: true });
  }

  for (const lang of LANGS) {
    const videoFile = `${DATA_PATH}/videos/${lang}.json`;
    const keywordFile = `${DATA_PATH}/keywords/${lang}.json`;
    
    // ایجاد فایل‌ها اگر وجود نداشته باشند
    if (!fs.existsSync(videoFile)) fs.writeFileSync(videoFile, '[]');
    if (!fs.existsSync(keywordFile)) fs.writeFileSync(keywordFile, '[]');
    
    // بررسی تعداد ویدیوهای موجود
    let videos = JSON.parse(fs.readFileSync(videoFile, 'utf-8'));
    if (videos.length >= MIN_VIDEOS_PER_LANG) {
      console.log(`⏩ Skipping ${lang}, enough videos (${videos.length})`);
      continue;
    }
    
    // بارگیری کلمات کلیدی
    const keywords = JSON.parse(fs.readFileSync(keywordFile, 'utf-8'));
    if (keywords.length === 0) {
      console.warn(`⚠️ No keywords for ${lang}, skipping...`);
      continue;
    }
    
    // جستجوی ویدیوها
    console.log(`🔍 Searching videos for ${lang}...`);
    const account = pickRandom(ACCOUNTS.filter(a => a.cookie));
    
    for (const keyword of keywords) {
      if (videos.length >= MIN_VIDEOS_PER_LANG) break;
      
      try {
        const newVideoIds = await retryOperation(
          () => searchYouTube(keyword, account.cookie),
          "YouTube Search",
          MAX_ATTEMPTS
        );
        
        // فیلتر ویدیوهای تکراری
        const uniqueVideos = newVideoIds
          .filter(id => !videos.some(v => v.id === id))
          .map(id => ({ id }));
        
        if (uniqueVideos.length > 0) {
          videos = [...videos, ...uniqueVideos];
          fs.writeFileSync(videoFile, JSON.stringify(videos, null, 2));
          console.log(`✅ Added ${uniqueVideos.length} videos for "${keyword}"`);
        }
        
        await delay(2000 + Math.random() * 3000);
      } catch (error) {
        console.error(`❌ Search failed for "${keyword}":`, error.message);
      }
    }
  }
}

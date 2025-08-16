import fs from 'fs';
import path from 'path';
import { ACCOUNTS } from './youtube_cookies.js';
import { pickRandom, delay, retryOperation, ensureFileExists, readJSONFile } from './utils.js';

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
    timeout: 30000
  });

  const html = await response.text();
  const videoIds = [...html.matchAll(/"videoId":"(.*?)"/g)]
    .map(match => match[1])
    .filter(id => id && id.length === 11);

  return Array.from(new Set(videoIds));
}

export async function searchAndStoreVideos() {
  // ایجاد پوشه‌ها اگر وجود ندارند
  const videosDir = `${DATA_PATH}/videos`;
  const keywordsDir = `${DATA_PATH}/keywords`;
  
  ensureFileExists(videosDir, '', true);
  ensureFileExists(keywordsDir, '', true);

  for (const lang of LANGS) {
    const videoFile = `${videosDir}/${lang}.json`;
    const keywordFile = `${keywordsDir}/${lang}.json`;
    
    // ایجاد فایل‌ها اگر وجود ندارند
    ensureFileExists(videoFile, '[]');
    ensureFileExists(keywordFile, '[]');

    // خواندن ایمن فایل‌ها
    let videos = readJSONFile(videoFile, []);
    const keywords = readJSONFile(keywordFile, []);

    // اگر کلمات کلیدی وجود ندارند، از کلمات پیش‌فرض استفاده کنید
    if (keywords.length === 0) {
      console.warn(`⚠️ No keywords for ${lang}, using fallback...`);
      const fallbackKeywords = {
        en: ["technology", "programming", "web development"],
        fa: ["تکنولوژی", "برنامه نویسی", "یوتیوب"],
        ru: ["технологии", "программирование", "интернет"],
        es: ["tecnología", "programación", "desarrollo web"],
        hi: ["तकनीक", "प्रोग्रामिंग", "वेब विकास"]
      };
      fs.writeFileSync(keywordFile, JSON.stringify(fallbackKeywords[lang] || fallbackKeywords.en, null, 2));
    }

    // اگر هنوز ویدیوهای کافی داریم، ادامه ندهید
    if (videos.length >= MIN_VIDEOS_PER_LANG) {
      console.log(`⏩ Skipping ${lang}, enough videos (${videos.length})`);
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
          
          // ذخیره موقت در فایل
          const tempFile = `${videoFile}.tmp`;
          fs.writeFileSync(tempFile, JSON.stringify(videos, null, 2));
          fs.renameSync(tempFile, videoFile);
          
          console.log(`✅ Added ${uniqueVideos.length} videos for "${keyword}"`);
        }
        
        // تأخیر انسانی بین جستجوها
        await delay(5000 + Math.random() * 5000);
      } catch (error) {
        console.error(`❌ Search failed for "${keyword}":`, error.message);
      }
    }
  }
}

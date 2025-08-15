import { initBrowser } from './youtubeBrowserActions.js';
import { searchAndStoreVideos } from './searchAndStoreVideos.js';
import { ACCOUNTS } from './youtube_cookies.js';
import { postComment, postReply, likeComment } from './youtubeBrowserActions.js';
import { delay, pickRandom, shuffle, readTextFile, retryOperation, ensureFileExists } from './utils.js';
import fs from 'fs';
import path from 'path';

// تنظیمات سیستم
const MIN_VIDEOS_PER_LANG = 10;
const LANGS = ['en', 'fa', 'ru', 'es', 'hi'];
const COMMENT_DISTRIBUTION = ['en', 'en', 'en', 'ru', 'es', 'hi', 'fa'];
const DATA_PATH = './data';
const MAX_RETRIES = 2;
const MIN_DELAY = 3000; // 3 ثانیه
const MAX_DELAY = 10000; // 10 ثانیه

// تابع جدید: ایجاد فایل‌های ضروری اگر وجود ندارند
async function initializeDataFiles() {
  // ایجاد پوشه‌های اصلی
  const directories = [
    `${DATA_PATH}/videos`,
    `${DATA_PATH}/comments`,
    `${DATA_PATH}/replies`,
    `${DATA_PATH}/keywords`
  ];
  
  directories.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`📁 Created directory: ${dir}`);
    }
  });
  
  // ایجاد فایل‌های ویدیو خالی اگر وجود ندارند
  LANGS.forEach(lang => {
    const videoFile = `${DATA_PATH}/videos/${lang}.json`;
    ensureFileExists(videoFile, '[]');
  });
  
  // ایجاد فایل‌های کامنت و ریپلای نمونه اگر خالی هستند
  LANGS.forEach(lang => {
    const commentFile = `${DATA_PATH}/comments/${lang}.txt`;
    const replyFile = `${DATA_PATH}/replies/${lang}.txt`;
    
    if (ensureFileExists(commentFile) && fs.readFileSync(commentFile, 'utf-8').trim() === '') {
      fs.writeFileSync(commentFile, `کامنت نمونه به زبان ${lang}\nکامنت دیگر به زبان ${lang}`);
    }
    
    if (ensureFileExists(replyFile) && fs.readFileSync(replyFile, 'utf-8').trim() === '') {
      fs.writeFileSync(replyFile, `ریپلای نمونه به زبان ${lang}\nریپلای دیگر به زبان ${lang}`);
    }
  });
}

// تابع بهبود یافته برای بررسی وضعیت ویدیوها
async function ensureVideoCounts() {
  for (const lang of LANGS) {
    const videoFile = `${DATA_PATH}/videos/${lang}.json`;
    
    // ایجاد فایل اگر وجود ندارد
    ensureFileExists(videoFile, '[]');
    
    // خواندن و پردازش ایمن فایل JSON
    let videos = [];
    try {
      const content = fs.readFileSync(videoFile, 'utf-8').trim();
      
      if (content) {
        videos = JSON.parse(content);
      } else {
        console.warn(`⚠️ Empty file detected for ${lang}, initializing...`);
        fs.writeFileSync(videoFile, '[]');
      }
    } catch (e) {
      console.error(`❌ Error parsing ${videoFile}:`, e.message);
      console.log('Reinitializing video file...');
      fs.writeFileSync(videoFile, '[]');
    }

    if (videos.length < MIN_VIDEOS_PER_LANG) {
      console.log(`⚠️ ${lang} has only ${videos.length} videos, collecting more...`);
      await retryOperation(
        () => searchAndStoreVideos(),
        "searchAndStoreVideos",
        MAX_RETRIES
      );
    }
  }
}

// تابع بهبود یافته برای اجرای اصلی
async function main() {
  try {
    // مرحله 0: مقداردهی اولیه فایل‌ها
    console.log('⚙️ Initializing data files...');
    await initializeDataFiles();
    
    // مرحله 1: بررسی ویدیوها با مدیریت خطا
    console.log('🔍 Checking video counts...');
    await ensureVideoCounts();

    // مرحله 2: آماده‌سازی داده‌ها با بررسی وجود فایل‌ها
    console.log('📚 Loading comments and replies...');
    const comments = {};
    const replies = {};
    
    for (const lang of LANGS) {
      const commentFile = `${DATA_PATH}/comments/${lang}.txt`;
      const replyFile = `${DATA_PATH}/replies/${lang}.txt`;
      
      // ایجاد فایل‌های کامنت و ریپلای اگر وجود ندارند
      ensureFileExists(commentFile, `کامنت نمونه به زبان ${lang}`);
      ensureFileExists(replyFile, `ریپلای نمونه به زبان ${lang}`);
      
      comments[lang] = readTextFile(commentFile);
      replies[lang] = readTextFile(replyFile);
      
      // بررسی وجود کامنت‌ها
      if (comments[lang].length === 0) {
        throw new Error(`No comments found for ${lang}`);
      }
    }

    // مرحله 3: تنظیم حساب‌ها با اعتبارسنجی
    console.log('👥 Validating and setting up accounts...');
    const validAccounts = ACCOUNTS.filter(a => a.cookie && a.cookie.length > 30);
    
    if (validAccounts.length < 7) {
      throw new Error(`Only ${validAccounts.length} valid accounts found, need 7`);
    }
    
    const activeAccounts = shuffle(validAccounts.slice(0, 7));
    const langAssignment = shuffle([...COMMENT_DISTRIBUTION]);
    
    const browserInstances = await Promise.all(
      activeAccounts.map(() => initBrowser({ headless: true, stealth: true }))
    );

    // مرحله 4: ارسال کامنت‌ها
    console.log('💬 Starting comment posting...');
    const postedComments = [];
    
    for (let i = 0; i < activeAccounts.length; i++) {
      const account = activeAccounts[i];
      const browser = browserInstances[i];
      const lang = langAssignment[i];
      
      // تأخیر رندوم انسانی
      const delayTime = MIN_DELAY + Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY));
      console.log(`⏳ Account ${i+1}: ${delayTime/1000}s delay before comment`);
      await delay(delayTime);
      
      try {
        // خواندن ویدیوها با مدیریت خطا
        const videoFile = `${DATA_PATH}/videos/${lang}.json`;
        let videos = [];
        
        try {
          videos = JSON.parse(fs.readFileSync(videoFile, 'utf-8'));
        } catch (e) {
          console.error(`❌ Error reading videos for ${lang}:`, e.message);
          // اگر خطا در خواندن فایل، از فایل زبانی دیگر استفاده کن
          const fallbackLang = LANGS.find(l => l !== lang) || 'en';
          console.log(`🔄 Using fallback language: ${fallbackLang}`);
          videos = JSON.parse(fs.readFileSync(`${DATA_PATH}/videos/${fallbackLang}.json`, 'utf-8'));
        }
        
        if (videos.length === 0) {
          throw new Error(`No videos available for ${lang}`);
        }
        
        const video = pickRandom(videos);
        const comment = pickRandom(comments[lang]);

        console.log(`📝 [${lang}] Posting comment to video: ${video.id}`);
        const commentId = await retryOperation(
          () => postComment(browser, account.cookie, video.id, comment),
          "postComment",
          MAX_RETRIES
        );
        
        // ذخیره اطلاعات کامنت
        postedComments.push({
          videoId: video.id,
          commentId,
          lang,
          text: comment,
          accountIndex: i
        });

        // لایک اولیه توسط حساب اصلی
        console.log(`❤️ Adding initial like...`);
        await retryOperation(
          () => likeComment(browser, account.cookie, video.id, commentId),
          "likeComment",
          MAX_RETRIES
        );
        
      } catch (error) {
        console.error(`❌ Error for account ${i+1}:`, error.message);
      }
    }

    // مرحله 5: تعاملات اضافی (لایک‌ها و ریپلای‌ها)
    console.log('🔄 Processing interactions...');
    for (const comment of postedComments) {
      // تعیین تعداد لایک‌ها (3-7)
      const likeCount = 3 + Math.floor(Math.random() * 5);
      // تعیین تعداد ریپلای‌ها (0-3)
      const replyCount = Math.floor(Math.random() * 4);
      
      console.log(`🔄 Processing comment ${comment.commentId} (${likeCount} likes, ${replyCount} replies)`);
      
      let likeCounter = 1; // لایک اولیه قبلاً ثبت شده
      let replyCounter = 0;
      
      for (let i = 0; i < activeAccounts.length; i++) {
        if (likeCounter >= likeCount && replyCounter >= replyCount) break;
        if (i === comment.accountIndex) continue;
        
        const account = activeAccounts[i];
        const browser = browserInstances[i];
        const delayTime = MIN_DELAY + Math.floor(Math.random() * (MAX_DELAY - MIN_DELAY));
        
        // لایک‌های اضافی
        if (likeCounter < likeCount) {
          console.log(`⏳ Account ${i+1}: ${delayTime/1000}s delay before like`);
          await delay(delayTime);
          
          try {
            await retryOperation(
              () => likeComment(browser, account.cookie, comment.videoId, comment.commentId),
              "likeComment",
              MAX_RETRIES
            );
            likeCounter++;
          } catch (error) {
            console.error(`❌ Like error for account ${i+1}:`, error.message);
          }
        }

        // ریپلای‌ها
        if (replyCounter < replyCount && Math.random() > 0.5) {
          console.log(`⏳ Account ${i+1}: ${delayTime/1000}s delay before reply`);
          await delay(delayTime);
          
          try {
            const replyText = pickRandom(replies[comment.lang]);
            await retryOperation(
              () => postReply(browser, account.cookie, comment.videoId, comment.commentId, replyText),
              "postReply",
              MAX_RETRIES
            );
            replyCounter++;
          } catch (error) {
            console.error(`❌ Reply error for account ${i+1}:`, error.message);
          }
        }
      }
    }

    console.log('✅ All operations completed successfully!');
  } catch (error) {
    console.error('‼️ Critical system error:', error);
    process.exit(1);
  } finally {
    // بستن مرورگرها
    await Promise.all(browserInstances.map(browser => browser.close()));
    console.log('🔒 All browsers closed');
  }
}

// شروع سیستم
main().catch(console.error);

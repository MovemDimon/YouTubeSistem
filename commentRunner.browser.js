import { initBrowser, postComment } from './youtubeBrowserActions.js';
import { ACCOUNTS } from './youtube_cookies.js';
import { delay, shuffle } from './utils.js';
import fs from 'fs';

const MAX_COMMENTS = 10000;
const MIN_DELAY = 30000; // 30 ثانیه حداقل تاخیر

async function main() {
  const browser = await initBrowser({ 
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    // بارگیری وضعیت با هندلینگ خطا
    let status;
    try {
      status = JSON.parse(fs.readFileSync('status.json', 'utf-8')) || { posted_comments: 0 };
    } catch (e) {
      status = { posted_comments: 0 };
    }
    
    // انتخاب زبان و ویدیوها
    const lang = 'hi';
    const videos = JSON.parse(fs.readFileSync(`data/videos/${lang}.json`, 'utf-8'));
    const selected = shuffle(videos).slice(0, 5);

    // انتخاب حساب تصادفی
    const validAccounts = ACCOUNTS.filter(a => a.cookie);
    if (validAccounts.length === 0) throw new Error('No valid accounts available');
    const account = shuffle(validAccounts)[0];

    for (const video of selected) {
      try {
        console.log(`🎬 Processing video: ${video.id}`);
        
        // ارسال کامنت
        await postComment(browser, account.cookie, video.id, "Great video! Thanks for sharing.");
        console.log(`💬 Comment posted to ${video.id}`);
        
        // افزایش شمارنده
        status.posted_comments++;
        fs.writeFileSync('status.json', JSON.stringify(status, null, 2));
        
        // تاخیر تصادفی
        const waitTime = MIN_DELAY + Math.random() * 30000;
        console.log(`⏳ Waiting ${Math.round(waitTime/1000)} seconds...`);
        await delay(waitTime);

      } catch (error) {
        console.error(`❌ Error processing video ${video.id}:`, error.message);
      }
    }

  } finally {
    await browser.close();
  }
}

main().catch(console.error);

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { delay } from './utils.js';

// فعال‌سازی پلاگین‌های امنیتی
puppeteer.use(StealthPlugin());

// تنظیمات جدید برای محیط GitHub Actions
const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--disable-gpu',
  '--disable-software-rasterizer',
  '--disable-features=IsolateOrigins,site-per-process',
  '--enable-features=NetworkService',
  '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
];

// تابع ایجاد مرورگر
export async function initBrowser(opts = {}) {
  const browser = await puppeteer.launch({
    headless: opts.headless ?? 'new',
    args: BROWSER_ARGS,
    defaultViewport: { width: 1366, height: 768 },
    ignoreHTTPSErrors: true,
    protocolTimeout: 60000, // افزایش تایم‌اوت به 60 ثانیه
    dumpio: true, // فعال‌سازی لاگ‌های دیباگ
    slowMo: opts.slowMo || 0 // کاهش سرعت عملیات
  });
  
  console.log('✅ Browser initialized successfully');
  return browser;
}

// تنظیم کوکی‌ها
async function setCookies(page, cookie) {
  await page.setCookie({
    name: 'CONSENT',
    value: 'YES+cb.20210328-17-p0.en+FX+410',
    domain: '.youtube.com',
    path: '/'
  });

  const cookies = cookie.split(';').map(pair => {
    const [name, value] = pair.trim().split('=');
    return { 
      name: name.trim(), 
      value: decodeURIComponent(value.trim()),
      domain: '.youtube.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'None'
    };
  });
  
  await page.setCookie(...cookies);
  await delay(1000);
}

// بررسی فعال بودن کامنت‌ها
async function checkCommentsEnabled(page) {
  const disabledSelector = '#message.ytd-comments-header-renderer';
  const isDisabled = await page.$(disabledSelector);
  
  if (isDisabled) {
    const message = await page.evaluate(el => el.textContent, isDisabled);
    if (message.includes('disabled') || message.includes('off')) {
      throw new Error('Comments are disabled for this video');
    }
  }
  
  return true;
}

// ارسال کامنت
export async function postComment(browser, cookie, videoId, text) {
  const page = await browser.newPage();
  try {
    // تنظیمات اولیه
    await page.setJavaScriptEnabled(true);
    await page.setExtraHTTPHeaders({ 
      'accept-language': 'en-US,en;q=0.9',
      'sec-ch-ua': '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"'
    });
    
    // تنظیم کوکی‌ها
    await setCookies(page, cookie);
    
    // بازکردن ویدیو
    await page.goto(`https://www.youtube.com/watch?v=${videoId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    // بررسی خطاهای یوتیوب
    const errorPage = await page.$('#error-page');
    if (errorPage) {
      const errorCode = await page.$eval('.error-code', el => el.textContent);
      throw new Error(`YouTube error: ${errorCode}`);
    }
    
    // اسکرول به بخش کامنت‌ها
    await page.evaluate(() => window.scrollBy(0, 1200));
    await delay(2000);
    
    // بررسی فعال بودن کامنت‌ها
    await checkCommentsEnabled(page);
    
    // فعال‌سازی باکس کامنت
    const commentBox = await page.$('#placeholder-area');
    if (!commentBox) throw new Error('Comment box not found');
    
    await commentBox.click();
    await delay(1000);
    
    // تایپ کامنت
    await page.keyboard.type(text, { 
      delay: 30 + Math.random() * 70
    });
    await delay(1000);
    
    // ارسال کامنت
    const submitButton = await page.$('#submit-button');
    if (!submitButton) throw new Error('Submit button not found');
    
    await submitButton.click();
    await delay(3000);
    
    // دریافت شناسه کامنت
    const commentId = await page.evaluate(() => {
      const comments = document.querySelectorAll('ytd-comment-thread-renderer');
      return comments[comments.length - 1]?.getAttribute('data-comment-id');
    });
    
    if (!commentId) throw new Error('Failed to get comment ID');
    
    return commentId;
  } catch (error) {
    await page.screenshot({ path: `debug_${Date.now()}.png` });
    throw error;
  } finally {
    await page.close();
  }
}

// ارسال ریپلای
export async function postReply(browser, cookie, videoId, commentId, text) {
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({ 
      'accept-language': 'en-US,en;q=0.9',
      'sec-ch-ua': '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"'
    });
    
    await setCookies(page, cookie);
    await page.goto(`https://www.youtube.com/watch?v=${videoId}&lc=${commentId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    // بازکردن بخش ریپلای
    const replyButton = await page.$(`[data-comment-id="${commentId}"] #reply-button`);
    if (!replyButton) throw new Error('Reply button not found');
    
    await replyButton.click();
    await delay(1000);
    
    // تایپ ریپلای
    const replyBox = await page.$('#contenteditable-root');
    if (!replyBox) throw new Error('Reply box not found');
    
    await replyBox.click();
    await page.keyboard.type(text, {
      delay: 30 + Math.random() * 70
    });
    await delay(1000);
    
    // ارسال ریپلای
    const submitButton = await page.$('#submit-button');
    if (!submitButton) throw new Error('Reply submit button not found');
    
    await submitButton.click();
    await delay(3000);
    
    return true;
  } catch (error) {
    await page.screenshot({ path: `debug_reply_${Date.now()}.png` });
    throw error;
  } finally {
    await page.close();
  }
}

// لایک کامنت
export async function likeComment(browser, cookie, videoId, commentId) {
  const page = await browser.newPage();
  try {
    await page.setExtraHTTPHeaders({ 
      'accept-language': 'en-US,en;q=0.9',
      'sec-ch-ua': '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"'
    });
    
    await setCookies(page, cookie);
    await page.goto(`https://www.youtube.com/watch?v=${videoId}&lc=${commentId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    // یافتن دکمه لایک
    const likeButton = await page.$(`[data-comment-id="${commentId}"] #like-button`);
    if (!likeButton) throw new Error('Like button not found');
    
    await likeButton.click();
    await delay(3000);
    
    return true;
  } catch (error) {
    await page.screenshot({ path: `debug_like_${Date.now()}.png` });
    throw error;
  } finally {
    await page.close();
  }
}

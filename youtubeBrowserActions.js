import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import RecaptchaPlugin from 'puppeteer-extra-plugin-recaptcha';
import { delay } from './utils.js';

// فعال‌سازی پلاگین‌های امنیتی
puppeteer.use(StealthPlugin());
puppeteer.use(
  RecaptchaPlugin({
    provider: { id: '2captcha', token: process.env.TWO_CAPTCHA_TOKEN },
    visualFeedback: true
  })
);

// تنظیمات رفتار انسانی
const HUMAN_LIKE_DELAY = {
  min: 100,
  max: 500,
  typing: 50,
  action: 1000
};

// ایجاد مرورگر با قابلیت استیلث
export async function initBrowser(opts = {}) {
  const browser = await puppeteer.launch({
    headless: opts.headless ?? 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    ],
    defaultViewport: { width: 1366, height: 768 },
    ignoreHTTPSErrors: true
  });
  return browser;
}

// تنظیم کوکی‌ها به صورت امن
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
  await delay(HUMAN_LIKE_DELAY.action);
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

// ارسال کامنت با مدیریت خطاهای یوتیوب
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
      timeout: 20000
    });
    
    // بررسی خطاهای یوتیوب
    const errorPage = await page.$('#error-page');
    if (errorPage) {
      const errorCode = await page.$eval('.error-code', el => el.textContent);
      throw new Error(`YouTube error: ${errorCode}`);
    }
    
    // اسکرول به بخش کامنت‌ها
    await page.evaluate(() => window.scrollTo(0, 800));
    await delay(HUMAN_LIKE_DELAY.action);
    
    // بررسی فعال بودن کامنت‌ها
    await checkCommentsEnabled(page);
    
    // فعال‌سازی باکس کامنت
    const commentBox = await page.waitForSelector('#placeholder-area', { timeout: 10000 });
    await commentBox.click();
    await delay(HUMAN_LIKE_DELAY.action);
    
    // تایپ کامنت با رفتار انسانی
    const commentInput = await page.$('#contenteditable-root');
    for (const char of text) {
      await commentInput.type(char, {
        delay: HUMAN_LIKE_DELAY.typing + Math.random() * HUMAN_LIKE_DELAY.typing
      });
    }
    await delay(HUMAN_LIKE_DELAY.action);
    
    // ارسال کامنت
    const submitButton = await page.waitForSelector('#submit-button:not([disabled])', { timeout: 5000 });
    await submitButton.click();
    
    // انتظار برای تأیید ارسال
    await page.waitForSelector('.ytp-videowall-still', { timeout: 5000 });
    await delay(3000);
    
    // دریافت شناسه کامنت
    const commentId = await page.evaluate(() => {
      const comments = document.querySelectorAll('ytd-comment-thread-renderer');
      return comments.length > 0 ? comments[comments.length - 1].getAttribute('data-comment-id') : null;
    });
    
    if (!commentId) throw new Error('Failed to get comment ID');
    
    return commentId;
  } catch (error) {
    // ذخیره اسکرین‌شات برای دیباگ
    await page.screenshot({ path: `debug_${Date.now()}.png` });
    throw error;
  } finally {
    await page.close();
  }
}

// ارسال ریپلای با مدیریت خطاها
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
      timeout: 20000
    });
    
    // بازکردن بخش ریپلای
    const replyButton = await page.waitForSelector(`[data-comment-id="${commentId}"] #reply-button`, { timeout: 10000 });
    await replyButton.click();
    await delay(HUMAN_LIKE_DELAY.action);
    
    // تایپ ریپلای
    const replyInput = await page.waitForSelector('#contenteditable-root', { timeout: 5000 });
    for (const char of text) {
      await replyInput.type(char, {
        delay: HUMAN_LIKE_DELAY.typing + Math.random() * HUMAN_LIKE_DELAY.typing
      });
    }
    await delay(HUMAN_LIKE_DELAY.action);
    
    // ارسال ریپلای
    const submitButton = await page.waitForSelector('#submit-button:not([disabled])', { timeout: 5000 });
    await submitButton.click();
    
    // انتظار برای تأیید ارسال
    await page.waitForSelector('.ytp-videowall-still', { timeout: 5000 });
    await delay(3000);
    
    return true;
  } catch (error) {
    await page.screenshot({ path: `debug_reply_${Date.now()}.png` });
    throw error;
  } finally {
    await page.close();
  }
}

// لایک کامنت با مدیریت خطاها
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
      timeout: 20000
    });
    
    // یافتن دکمه لایک
    const likeButton = await page.waitForSelector(`[data-comment-id="${commentId}"] #like-button`, { timeout: 10000 });
    const isLiked = await page.evaluate(btn => btn.getAttribute('aria-pressed') === 'true', likeButton);
    
    if (!isLiked) {
      await likeButton.click();
      await delay(3000);
      
      // تأیید لایک
      const isLikedNow = await page.evaluate(btn => btn.getAttribute('aria-pressed') === 'true', likeButton);
      if (!isLikedNow) throw new Error('Like action failed');
    }
    
    return true;
  } catch (error) {
    await page.screenshot({ path: `debug_like_${Date.now()}.png` });
    throw error;
  } finally {
    await page.close();
  }
}

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { delay } from './utils.js';

// فعال‌سازی پلاگین Stealth
puppeteer.use(StealthPlugin());

// تنظیمات مرورگر برای GitHub Actions
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
    protocolTimeout: 60000,
    dumpio: true,
    slowMo: opts.slowMo || 0
  });
  
  console.log('✅ Browser initialized successfully');
  return browser;
}

// ست کردن کوکی‌ها
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

// گوش دادن به Network برای گرفتن commentId بعد از ارسال
async function waitForCommentIdFromNetwork(page) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout waiting for commentId')), 15000);
    page.on('response', async res => {
      if (res.url().includes('comment_service_ajax') || res.url().includes('create_comment')) {
        try {
          const json = await res.json();
          const id = json?.comment?.commentRenderer?.commentId
                  || json?.actions?.find(a => a.createCommentAction)?.createCommentAction?.comment?.commentRenderer?.commentId;
          if (id) {
            clearTimeout(timeout);
            resolve(id);
          }
        } catch (e) {}
      }
    });
  });
}

// ارسال کامنت
export async function postComment(browser, cookie, videoId, text) {
  const page = await browser.newPage();
  try {
    await page.setJavaScriptEnabled(true);
    await page.setExtraHTTPHeaders({ 
      'accept-language': 'en-US,en;q=0.9',
      'sec-ch-ua': '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"'
    });
    
    // کوکی‌ها
    await setCookies(page, cookie);
    
    // ویدئو
    await page.goto(`https://www.youtube.com/watch?v=${videoId}`, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    
    // خطای احتمالی یوتیوب
    const errorPage = await page.$('#error-page');
    if (errorPage) {
      const errorCode = await page.$eval('.error-code', el => el.textContent);
      throw new Error(`YouTube error: ${errorCode}`);
    }
    
    // اسکرول به پایین
    await page.evaluate(() => window.scrollBy(0, 1200));
    await delay(2000);
    
    // چک فعال بودن
    await checkCommentsEnabled(page);
    
    // سلکتورهای جدید برای باکس کامنت
    const commentBox = await page.$('#simplebox-placeholder, #contenteditable-root, div#textbox');
    if (!commentBox) throw new Error('Comment box not found');
    
    await commentBox.click();
    await delay(1000);
    
    await page.keyboard.type(text, { 
      delay: 30 + Math.random() * 70
    });
    await delay(1000);
    
    // سلکتورهای جدید برای دکمه ارسال
    const submitButton = await page.$('ytd-commentbox #submit-button, tp-yt-paper-button#submit-button, div#submit-button button');
    if (!submitButton) throw new Error('Submit button not found');
    
    const commentIdPromise = waitForCommentIdFromNetwork(page);
    await submitButton.click();
    await delay(3000);
    
    let commentId;
    try {
      commentId = await commentIdPromise;
    } catch {
      commentId = await page.evaluate(() => {
        const el = document.querySelector('ytd-comment-thread-renderer:last-of-type, ytd-comment-view-model:last-of-type');
        return el?.getAttribute('data-comment-id');
      });
    }
    
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
    
    // سلکتورهای جدید ریپلای
    const replyButton = await page.$(`[data-comment-id="${commentId}"] #reply-button, [data-comment-id="${commentId}"] tp-yt-paper-button#reply-button`);
    if (!replyButton) throw new Error('Reply button not found');
    
    await replyButton.click();
    await delay(1000);
    
    const replyBox = await page.$('#contenteditable-root, div#textbox');
    if (!replyBox) throw new Error('Reply box not found');
    
    await replyBox.click();
    await page.keyboard.type(text, {
      delay: 30 + Math.random() * 70
    });
    await delay(1000);
    
    const submitButton = await page.$('#submit-button, div#submit-button button');
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

// لایک کردن کامنت
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
    
    const likeButton = await page.$(`[data-comment-id="${commentId}"] #like-button, [data-comment-id="${commentId}"] button[aria-label*="like"]`);
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

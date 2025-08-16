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
  '--autoplay-policy=user-gesture-required',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-breakpad',
  '--disable-crash-reporter',
  '--disable-dev-shm-usage',
  '--disable-notifications',
  '--disable-sync',
  '--disable-translate',
  '--mute-audio',
  '--no-default-browser-check',
  '--no-first-run',
  '--no-zygote',
  '--single-process',
  '--window-size=1920,1080',
  '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
];

// تابع ایجاد مرورگر
export async function initBrowser(opts = {}) {
  const config = {
    headless: opts.headless || 'new',
    args: [...BROWSER_ARGS, ...(opts.args || [])],
    defaultViewport: { width: 1366, height: 768 },
    ignoreHTTPSErrors: true,
    protocolTimeout: opts.protocolTimeout || 120000,
    dumpio: true,
    slowMo: opts.slowMo || 0
  };
  
  const browser = await puppeteer.launch(config);
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
  await delay(2000);
}

// بررسی فعال بودن کامنت‌ها
async function checkCommentsEnabled(page) {
  const disabledSelectors = [
    '#message.ytd-comments-header-renderer',
    '.ytd-comments-header-renderer > .disabled-comments',
    'yt-formatted-string[contains(text(), "disabled")]'
  ];
  
  for (const selector of disabledSelectors) {
    const element = await page.$(selector);
    if (element) {
      const message = await page.evaluate(el => el.textContent, element);
      if (message.toLowerCase().includes('disabled') || 
          message.toLowerCase().includes('off')) {
        throw new Error('Comments are disabled for this video');
      }
    }
  }
  
  return true;
}

// تابع جدید برای تشخیص CAPTCHA
async function checkForCaptcha(page) {
  const captchaSelectors = [
    '#captcha-container',
    '.captcha-box',
    'form[action*="captcha"]'
  ];
  
  for (const selector of captchaSelectors) {
    if (await page.$(selector)) {
      await page.screenshot({ path: `captcha_${Date.now()}.png` });
      throw new Error('CAPTCHA detected - manual intervention required');
    }
  }
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
      timeout: 60000
    });
    
    // بررسی CAPTCHA
    await checkForCaptcha(page);
    
    // بررسی خطاهای یوتیوب
    const errorPage = await page.$('#error-page');
    if (errorPage) {
      const errorCode = await page.$eval('.error-code', el => el.textContent);
      throw new Error(`YouTube error: ${errorCode}`);
    }
    
    // اسکرول به بخش کامنت‌ها
    await page.evaluate(() => window.scrollBy(0, 1500));
    await delay(3000);
    
    // بررسی فعال بودن کامنت‌ها
    await checkCommentsEnabled(page);
    
    // فعال‌سازی باکس کامنت (نسخه بهبودیافته)
    const commentBox = await page.waitForSelector(
      '#placeholder-area, #comments-container, ytd-commentbox',
      { visible: true, timeout: 15000 }
    );
    await commentBox.click();
    await delay(2000);
    
    // تایپ کامنت (افزودن بررسی اضافه)
    const editable = await page.waitForSelector(
      '#contenteditable-root, .ytd-commentbox',
      { visible: true, timeout: 10000 }
    );
    await editable.click();
    await page.keyboard.type(text, { 
      delay: 50 + Math.random() * 100
    });
    await delay(2000);
    
    // ارسال کامنت (روش جایگزین)
    const submitButtons = await page.$$(
      'ytd-button-renderer#submit-button, #submit-button, button[aria-label="Comment"], button[aria-label="نظر دادن"], button[aria-label="Комментировать"]'
    );

    if (submitButtons.length > 0) {
      await submitButtons[0].click();
    } else {
      // روش جایگزین با استفاده از کلیدهای صفحه‌کلید
      await page.keyboard.press('Enter');
      await delay(1000);
      await page.keyboard.down('Control');
      await page.keyboard.press('Enter');
      await page.keyboard.up('Control');
    }
    
    await delay(5000);
    
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
      timeout: 60000
    });
    
    // بررسی CAPTCHA
    await checkForCaptcha(page);
    
    // بازکردن بخش ریپلای
    const replyButton = await page.waitForSelector(
      `[data-comment-id="${commentId}"] #reply-button, [data-comment-id="${commentId}"] .ytd-button-renderer`,
      { visible: true, timeout: 10000 }
    );
    await replyButton.click();
    await delay(2000);
    
    // تایپ ریپلای
    const replyBox = await page.waitForSelector(
      '#contenteditable-root, .ytd-commentbox',
      { visible: true, timeout: 10000 }
    );
    await replyBox.click();
    await page.keyboard.type(text, {
      delay: 50 + Math.random() * 100
    });
    await delay(2000);
    
    // ارسال ریپلای
    const submitButton = await page.waitForSelector(
      '#submit-button, ytd-button-renderer#submit-button',
      { visible: true, timeout: 10000 }
    );
    await submitButton.click();
    await delay(5000);
    
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
      timeout: 60000
    });
    
    // یافتن دکمه لایک
    const likeButton = await page.waitForSelector(
      `[data-comment-id="${commentId}"] #like-button, [data-comment-id="${commentId}"] .ytd-toggle-button-renderer`,
      { visible: true, timeout: 10000 }
    );
    await likeButton.click();
    await delay(5000);
    
    return true;
  } catch (error) {
    await page.screenshot({ path: `debug_like_${Date.now()}.png` });
    throw error;
  } finally {
    await page.close();
  }
}

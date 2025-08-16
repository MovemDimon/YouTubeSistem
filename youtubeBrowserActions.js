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

// بررسی فعال بودن کامنت‌ها (نسخه اصلاح شده)
async function checkCommentsEnabled(page) {
  const disabledSelectors = [
    '#message.ytd-comments-header-renderer',
    '.ytd-comments-header-renderer > .disabled-comments',
    'yt-formatted-string.comment-dialog-renderer-message'
  ];
  
  // کلمات کلیدی برای تشخیص غیرفعال بودن کامنت‌ها
  const disabledKeywords = [
    'disabled', 'off', 'غیرفعال', 'отключен', 'desactivado', 'अक्षम'
  ];
  
  for (const selector of disabledSelectors) {
    const element = await page.$(selector);
    if (element) {
      const message = await page.evaluate(el => el.textContent, element);
      if (disabledKeywords.some(keyword => message.toLowerCase().includes(keyword))) {
        throw new Error('Comments are disabled for this video');
      }
    }
  }
  
  return true;
}

// تابع کمکی برای انتظار برای سلکتورها (نسخه بهبودیافته)
async function waitForSelectors(page, selectors, timeout = 20000) {
  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { 
        timeout,
        visible: true,
        hidden: false
      });
      return selector;
    } catch (e) {
      // ادامه به سلکتور بعدی
    }
  }
  
  // اگر هیچ سلکتوری پیدا نشد، اسکرین‌شات بگیر
  await page.screenshot({ path: `selector_error_${Date.now()}.png` });
  throw new Error('None of the selectors found: ' + selectors.join(', '));
}

// ارسال کامنت (نسخه کاملاً اصلاح شده)
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
    
    // بازکردن ویدیو با تنظیمات جدید
    await page.goto(`https://www.youtube.com/watch?v=${videoId}`, {
      waitUntil: 'networkidle2',
      timeout: 120000
    });
    
    // بررسی CAPTCHA
    await checkForCaptcha(page);
    
    // تأخیر تصادفی بیشتر
    await delay(5000 + Math.random() * 5000);
    
    // اسکرول به بخش کامنت‌ها با روش جدید
    await page.evaluate(() => {
      const commentSection = document.querySelector('ytd-comments');
      if (commentSection) {
        commentSection.scrollIntoView({behavior: 'smooth'});
      } else {
        window.scrollBy(0, 1500);
      }
    });
    await delay(3000);
    
    // بررسی فعال بودن کامنت‌ها
    await checkCommentsEnabled(page);
    
    // فعال‌سازی باکس کامنت با سلکتورهای جایگزین
    const commentBoxSelector = await waitForSelectors(page, [
      '#placeholder-area',
      '#comments-container',
      'ytd-commentbox',
      'ytd-comment-simplebox-renderer',
      '.ytd-comments-header-renderer',
      'ytd-commentbox#commentbox'
    ], 25000);
    
    const commentBox = await page.$(commentBoxSelector);
    await commentBox.click({ delay: 100 + Math.random() * 200 });
    await delay(3000);
    
    // تایپ کامنت با سلکتورهای جایگزین
    const editableSelector = await waitForSelectors(page, [
      '#contenteditable-root',
      '.ytd-commentbox',
      'div#contenteditable-root',
      'ytd-commentbox div[contenteditable="true"]',
      'ytd-comment-simplebox-renderer div[contenteditable="true"]',
      'div.ytd-commentbox'
    ], 30000);
    
    await page.click(editableSelector, { delay: 100 });
    await delay(1000);
    
    // تایپ با رفتار انسانی
    for (const char of text) {
      await page.keyboard.type(char, { 
        delay: 50 + Math.random() * 150 
      });
      // تأخیر تصادفی بعد از هر 5 کاراکتر
      if (Math.random() > 0.8) await delay(100 + Math.random() * 400);
    }
    await delay(2000);
    
    // ارسال کامنت با سلکتورهای جایگزین
    const submitSelectors = [
      'ytd-button-renderer#submit-button',
      '#submit-button',
      'button[aria-label="Comment"]',
      'button[aria-label="نظر دادن"]',
      'button[aria-label="Комментировать"]',
      'button[aria-label="Comentar"]',
      'button[aria-label="टिप्पणी करें"]',
      'yt-button-shape button',
      'paper-button.ytd-commentbox'
    ];
    
    const submitButtonSelector = await waitForSelectors(page, submitSelectors, 15000);
    await page.click(submitButtonSelector, { delay: 200 });
    await delay(5000);
    
    // دریافت شناسه کامنت با روش جایگزین
    const commentId = await page.evaluate(() => {
      // روش 1: استفاده از آخرین کامنت
      const comments = document.querySelectorAll('ytd-comment-thread-renderer');
      if (comments.length > 0) return comments[comments.length - 1].getAttribute('data-comment-id');
      
      // روش 2: استفاده از عناصر واقع در صفحه
      const commentElement = document.querySelector('ytd-comment-renderer[data-comment-id]');
      if (commentElement) return commentElement.getAttribute('data-comment-id');
      
      // روش 3: جستجو در محتوای صفحه
      const match = document.body.innerHTML.match(/"commentId":"(.*?)"/);
      if (match && match[1]) return match[1];
      
      return null;
    });
    
    if (!commentId) {
      await page.screenshot({ path: `comment_id_error_${Date.now()}.png` });
      throw new Error('Failed to get comment ID');
    }
    
    return commentId;
  } catch (error) {
    await page.screenshot({ path: `debug_${Date.now()}.png` });
    throw error;
  } finally {
    await page.close();
  }
}

// ارسال ریپلای (بدون تغییر)
export async function postReply(browser, cookie, videoId, commentId, text) {
  // ... کد قبلی بدون تغییر
}

// لایک کامنت (بدون تغییر)
export async function likeComment(browser, cookie, videoId, commentId) {
  // ... کد قبلی بدون تغییر
}

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

// تابع جدید برای کلیک ایمن روی عناصر
async function safeClick(page, selector, options = {}) {
  // اسکرول به عنصر
  await page.evaluate(selector => {
    const element = document.querySelector(selector);
    if (element) {
      element.scrollIntoView({behavior: 'smooth', block: 'center'});
    }
  }, selector);
  
  await delay(1000);
  
  // کلیک با استفاده از JavaScript
  await page.evaluate(selector => {
    const element = document.querySelector(selector);
    if (element) {
      element.click();
    } else {
      throw new Error('Element not found for safeClick');
    }
  }, selector);
  
  await delay(options.delay || 1000);
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
        commentSection.scrollIntoView({behavior: 'smooth', block: 'start'});
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
    
    // استفاده از کلیک ایمن
    await safeClick(page, commentBoxSelector, { delay: 2000 });
    
    // سلکتورهای به‌روز برای باکس نوشتن کامنت
    const editableSelectors = [
      '#simplebox-placeholder', // تمرکز روی باکس نوشتن کامنت (موثر و پایدار)
      'yt-formatted-string#placeholder-area', // نسخه‌ی جدید placeholder
      'div#contenteditable-root', // ورژن‌های قدیمی‌تر
      'ytd-comment-simplebox-renderer[contenteditable]', // fallback
    ];
    
    const editableSelector = await waitForSelectors(page, editableSelectors, 30000);
    
    // استفاده از کلیک ایمن برای باکس متن
    await safeClick(page, editableSelector, { delay: 1000 });
    
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
    
    // استفاده از کلیک ایمن برای دکمه ارسال
    await safeClick(page, submitButtonSelector, { delay: 2000 });
    
    // دریافت شناسه کامنت با روش پیشرفته
    const commentId = await getCommentId(page, text);
    
    return commentId;
  } catch (error) {
    await page.screenshot({ path: `debug_${Date.now()}.png` });
    throw error;
  } finally {
    await page.close();
  }
}

// تابع جدید برای دریافت شناسه کامنت با روش‌های پیشرفته
async function getCommentId(page, commentText) {
  // روش 1: انتظار برای ظاهر شدن کامنت و دریافت مستقیم
  try {
    await page.waitForSelector('ytd-comment-thread-renderer', { timeout: 15000 });
    
    const commentId = await page.evaluate((text) => {
      const maxCheckLength = 30;
      const searchText = text.substring(0, Math.min(text.length, maxCheckLength));
      
      // جستجوی کامنت با متن مشابه
      const comments = document.querySelectorAll('ytd-comment-thread-renderer');
      for (const comment of comments) {
        if (comment.textContent.includes(searchText)) {
          return comment.getAttribute('data-comment-id');
        }
      }
      
      // استفاده از آخرین کامنت اگر پیدا نشد
      if (comments.length > 0) {
        return comments[0].getAttribute('data-comment-id');
      }
      
      return null;
    }, commentText);
    
    if (commentId) return commentId;
  } catch (e) {
    console.warn('⚠️ Method 1 for comment ID failed:', e.message);
  }
  
  // روش 2: جستجو در ساختار صفحه
  try {
    const commentId = await page.evaluate(() => {
      // جستجو در عناصر جدید
      const newComments = document.querySelectorAll('ytd-comment-thread-renderer');
      if (newComments.length > 0) return newComments[0].getAttribute('data-comment-id');
      
      // جستجو با استفاده از کلاس‌ها
      const commentElements = document.querySelectorAll('[data-comment-id]');
      if (commentElements.length > 0) {
        return commentElements[commentElements.length - 1].getAttribute('data-comment-id');
      }
      
      return null;
    });
    
    if (commentId) return commentId;
  } catch (e) {
    console.warn('⚠️ Method 2 for comment ID failed:', e.message);
  }
  
  // روش 3: جستجو در شبکه و پاسخ‌های AJAX
  try {
    const commentId = await getCommentIdFromNetwork(page);
    if (commentId) return commentId;
  } catch (e) {
    console.warn('⚠️ Method 3 for comment ID failed:', e.message);
  }
  
  // روش 4: جستجو در محتوای HTML
  try {
    const commentId = await page.evaluate(() => {
      const match = document.body.innerHTML.match(/"commentId":"(.*?)"/);
      return match ? match[1] : null;
    });
    
    if (commentId) return commentId;
  } catch (e) {
    console.warn('⚠️ Method 4 for comment ID failed:', e.message);
  }
  
  // روش 5: جستجو در لاگ‌های کنسول
  try {
    const commentId = await page.evaluate(() => {
      for (const log of window.console.logs) {
        const match = log.match(/commentId=(\w+)/);
        if (match) return match[1];
      }
      return null;
    });
    
    if (commentId) return commentId;
  } catch (e) {
    console.warn('⚠️ Method 5 for comment ID failed:', e.message);
  }
  
  // اگر همه روش‌ها شکست خوردند
  await page.screenshot({ path: `comment_id_error_${Date.now()}.png` });
  throw new Error('Failed to get comment ID after 5 attempts');
}

// تابع جدید برای دریافت شناسه کامنت از ترافیک شبکه
async function getCommentIdFromNetwork(page) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 10000);
    
    page.on('response', async (response) => {
      if (response.url().includes('/comment_service_ajax')) {
        try {
          const data = await response.json();
          if (data && data.actions) {
            for (const action of data.actions) {
              if (action.createCommentAction) {
                const commentId = action.createCommentAction?.contents?.commentThreadRenderer?.comment?.commentRenderer?.commentId;
                if (commentId) {
                  clearTimeout(timeout);
                  resolve(commentId);
                }
              }
            }
          }
        } catch (e) {
          // خطا در پردازش پاسخ
        }
      }
    });
  });
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
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    
    // بررسی CAPTCHA
    await checkForCaptcha(page);
    
    // بازکردن بخش ریپلای
    const replyButtonSelector = await waitForSelectors(page, [
      `[data-comment-id="${commentId}"] #reply-button`,
      `[data-comment-id="${commentId}"] .ytd-button-renderer`,
      `#reply-button-${commentId}`
    ], 15000);
    
    await safeClick(page, replyButtonSelector, { delay: 2000 });
    
    // تایپ ریپلای
    const replyBoxSelector = await waitForSelectors(page, [
      '#contenteditable-root',
      '.ytd-commentbox',
      'div#contenteditable-root.reply'
    ], 15000);
    
    await safeClick(page, replyBoxSelector, { delay: 1000 });
    
    // تایپ با رفتار انسانی
    for (const char of text) {
      await page.keyboard.type(char, { 
        delay: 50 + Math.random() * 100 
      });
      if (Math.random() > 0.8) await delay(100 + Math.random() * 300);
    }
    await delay(2000);
    
    // ارسال ریپلای
    const submitButtonSelector = await waitForSelectors(page, [
      '#submit-button',
      'ytd-button-renderer#submit-button',
      'button[aria-label="Reply"]',
      'button[aria-label="ارسال"]'
    ], 15000);
    
    await safeClick(page, submitButtonSelector, { delay: 2000 });
    
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
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    
    // یافتن دکمه لایک
    const likeButtonSelector = await waitForSelectors(page, [
      `[data-comment-id="${commentId}"] #like-button`,
      `[data-comment-id="${commentId}"] .ytd-toggle-button-renderer`,
      `#like-button-${commentId}`
    ], 15000);
    
    await safeClick(page, likeButtonSelector, { delay: 2000 });
    
    return true;
  } catch (error) {
    await page.screenshot({ path: `debug_like_${Date.now()}.png` });
    throw error;
  } finally {
    await page.close();
  }
  }

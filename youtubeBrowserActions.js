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

// ======= توابع جدید برای شناسایی commentId ======= //
function extractCommentIdFromObj(obj) {
  if (!obj) return null;
  if (typeof obj === 'string') {
    const m = obj.match(/"commentId"\s*:\s*"([^"]+)"/i) || 
              obj.match(/"id"\s*:\s*"([A-Za-z0-9_-]{8,})"/i);
    return m ? m[1] : null;
  }
  if (typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (/(commentId|comment_id|topLevelComment|id)$/i.test(k) && 
          typeof v === 'string' && 
          v.length > 8) {
        if (/^[A-Za-z0-9_-]{8,}$/.test(v)) return v;
      }
      const nested = extractCommentIdFromObj(v);
      if (nested) return nested;
    }
  }
  return null;
}

async function tryParseResponseForId(response) {
  try {
    // تلاش برای تجزیه JSON
    const ct = response.headers()['content-type'] || '';
    if (ct.includes('application/json')) {
      const j = await response.json();
      const id = extractCommentIdFromObj(j);
      if (id) return { id, raw: j };
      return { id: null, raw: j };
    }
  } catch (e) {
    // خطا در تجزیه JSON
  }

  try {
    // تجزیه متن خام
    const txt = await response.text();
    const m = txt.match(/"commentId"\s*:\s*"([^"]+)"/i) || 
              txt.match(/"id"\s*:\s*"([A-Za-z0-9_-]{8,})"/i);
    if (m) return { id: m[1], raw: txt };
    
    // جستجوی بلوک JSON در متن
    const jmatch = txt.match(/\{[\s\S]*\}/);
    if (jmatch) {
      try {
        const j = JSON.parse(jmatch[0]);
        const id = extractCommentIdFromObj(j);
        if (id) return { id, raw: j };
        return { id: null, raw: j };
      } catch(_) {}
    }
    return { id: null, raw: txt };
  } catch (e) {
    return { id: null, raw: null };
  }
}

// تابع جستجو در DOM (اجرا در محیط مرورگر)
const domFallbackFn = (expectedText) => {
  function norm(s){ 
    return (s||'').replace(/\s+/g,' ').trim().toLowerCase(); 
  }
  
  const threads = Array.from(document.querySelectorAll(
    'ytd-comment-thread-renderer, ytd-comment-view-renderer, ytd-comment-renderer'
  ));
  
  // جستجو از جدیدترین کامنت‌ها
  for (let i = threads.length - 1; i >= 0; i--) {
    const t = threads[i];
    const contentEl = t.querySelector(
      '#content-text, yt-formatted-string#content-text, ytd-expander yt-formatted-string'
    );
    const content = contentEl ? norm(contentEl.innerText) : '';
    
    if (!content) continue;
    
    // مقایسه متن نرمال‌شده
    if (content === norm(expectedText) || 
        content.includes(norm(expectedText).slice(0, 40))) {
      // روش ۱: شناسه از data attribute
      const dataId = t.getAttribute('data-comment-id');
      if (dataId) return dataId;
      
      // روش ۲: شناسه از لینک انتشار
      const a = t.querySelector('a#published-time, a[href*="lc="]');
      if (a && a.href) {
        try {
          const u = new URL(a.href);
          const lc = u.searchParams.get('lc');
          if (lc) return lc;
        } catch(e){}
      }
    }
  }
  return null;
};

async function getCommentIdAfterSubmit(page, submitButtonElementHandle, commentText, opts = {}) {
  const patterns = opts.patterns || [
    '/comment_service_ajax',
    '/youtubei/',
    '/comment/create_comment',
    '/comment/create',
    '/comment_service'
  ];
  
  const networkTimeout = opts.networkTimeout || 15000;
  const domTimeout = opts.domTimeout || 8000;

  // تنظیم شنونده شبکه قبل از کلیک
  const waitForResponsePromise = page.waitForResponse(response => {
    try {
      const url = response.url();
      return response.request().method() === 'POST' && 
             patterns.some(p => url.includes(p));
    } catch (e) { 
      return false; 
    }
  }, { timeout: networkTimeout }).catch(() => null);

  // کلیک با دو روش مختلف
  try {
    await submitButtonElementHandle.click();
  } catch (e) {
    await page.evaluate(el => el.click(), submitButtonElementHandle).catch(()=>{});
  }

  // ===== لایه ۱: شناسایی از شبکه =====
  const resp = await waitForResponsePromise;
  if (resp) {
    const parsed = await tryParseResponseForId(resp);
    if (parsed.id) {
      return { id: parsed.id, source: 'network', raw: parsed.raw };
    }
  }

  // ===== لایه ۲: شناسایی از DOM =====
  try {
    // انتظار برای ظاهر شدن کامنت‌ها
    await page.waitForSelector(
      'ytd-comment-thread-renderer, ytd-comment-view-renderer', 
      { timeout: domTimeout }
    );
  } catch(e) {}

  // اجرای جستجوگر DOM در مرورگر
  const idFromDOM = await page.evaluate(domFallbackFn, commentText).catch(()=>null);
  if (idFromDOM) return { id: idFromDOM, source: 'dom' };

  // ===== لایه ۳: شناسایی آخرین کامنت =====
  const lastId = await page.evaluate(() => {
    const last = document.querySelector(
      'ytd-comment-thread-renderer:last-of-type, ' +
      'ytd-comment-view-renderer:last-of-type, ' +
      'ytd-comment-renderer:last-of-type'
    );
    return last ? (last.getAttribute('data-comment-id') || null) : null;
  }).catch(()=>null);
  
  if (lastId) return { id: lastId, source: 'dom-last' };

  return { id: null, source: null };
}

async function getCommentIdWithRetries(page, submitButtonEl, commentText, attempts = 3) {
  let backoff = 1000;
  for (let i = 0; i < attempts; i++) {
    const res = await getCommentIdAfterSubmit(
      page, 
      submitButtonEl, 
      commentText, 
      { 
        networkTimeout: 15000, 
        domTimeout: 8000 
      }
    );
    
    if (res.id) return res;
    
    // ذخیره‌سازی اطلاعات دیباگ
    try {
      await page.screenshot({ 
        path: `commentid_retry_${i}_${Date.now()}.png`,
        fullPage: true 
      });
    } catch(e) {}
    
    await delay(backoff);
    backoff *= 2;
  }
  return { id: null, source: 'failed' };
}

// ارسال کامنت (نسخه کاملاً بازنویسی شده)
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
      waitUntil: 'networkidle2',
      timeout: 120000
    });
    
    // بررسی CAPTCHA
    await checkForCaptcha(page);
    await delay(5000 + Math.random() * 5000);
    
    // اسکرول به بخش کامنت‌ها
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
    
    // فعال‌سازی باکس کامنت
    const commentBoxSelector = await waitForSelectors(page, [
      '#placeholder-area',
      '#comments-container',
      'ytd-commentbox',
      'ytd-comment-simplebox-renderer',
      '.ytd-comments-header-renderer',
      'ytd-commentbox#commentbox'
    ], 25000);
    
    await safeClick(page, commentBoxSelector, { delay: 2000 });
    
    // یافتن باکس متن
    const editableSelectors = [
      '#simplebox-placeholder',
      'yt-formatted-string#placeholder-area',
      'div#contenteditable-root',
      'ytd-comment-simplebox-renderer[contenteditable]',
    ];
    
    const editableSelector = await waitForSelectors(page, editableSelectors, 30000);
    await safeClick(page, editableSelector, { delay: 1000 });
    
    // تایپ متن با رفتار انسانی
    for (const char of text) {
      await page.keyboard.type(char, { 
        delay: 50 + Math.random() * 150 
      });
      if (Math.random() > 0.8) await delay(100 + Math.random() * 400);
    }
    await delay(2000);
    
    // یافتن دکمه ارسال
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
    
    // ===== بخش حیاتی: ارسال و دریافت شناسه =====
    const submitButton = await page.$(submitButtonSelector);
    if (!submitButton) {
      throw new Error('Submit button element not found');
    }
    
    // استفاده از سیستم شناسایی مقاوم
    const result = await getCommentIdWithRetries(page, submitButton, text, 3);
    
    if (!result.id) {
      console.error(`❌ Failed to get comment ID (source: ${result.source})`);
      await page.screenshot({ path: `comment_failed_${Date.now()}.png` });
      throw new Error('Failed to post comment');
    }
    
    console.log(`✅ Comment ID: ${result.id} (source: ${result.source})`);
    return result.id;
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

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { delay } from './utils.js';

// فعال‌سازی پلاگین‌های امنیتی
puppeteer.use(StealthPlugin());

// تنظیمات بهینه‌سازی شده برای GitHub Actions
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
    protocolTimeout: opts.protocolTimeout || 180000, // افزایش زمان انتظار
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

// تابع تشخیص CAPTCHA
async function checkForCaptcha(page) {
  const captchaSelectors = [
    '#captcha-container',
    '.captcha-box',
    'form[action*="captcha"]',
    'iframe[src*="recaptcha"]'
  ];
  
  for (const selector of captchaSelectors) {
    if (await page.$(selector)) {
      await page.screenshot({ path: `captcha_${Date.now()}.png` });
      throw new Error('CAPTCHA detected - manual intervention required');
    }
  }
}

// بررسی فعال بودن کامنت‌ها
async function checkCommentsEnabled(page) {
  const disabledSelectors = [
    '#message.ytd-comments-header-renderer',
    '.ytd-comments-header-renderer > .disabled-comments',
    'yt-formatted-string.comment-dialog-renderer-message',
    'yt-formatted-string[contains(text(), "comments are turned off")]'
  ];
  
  const disabledKeywords = [
    'disabled', 'off', 'غیرفعال', 'отключен', 'desactivado', 'अक्षम', '关闭评论'
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

// تابع کمکی برای انتظار برای سلکتورها
async function waitForSelectors(page, selectors, timeout = 30000) {
  for (const selector of selectors) {
    try {
      const element = await page.waitForSelector(selector, { 
        timeout,
        visible: true,
        hidden: false
      });
      return selector;
    } catch (e) {
      // ادامه به سلکتور بعدی
    }
  }
  
  await page.screenshot({ path: `selector_error_${Date.now()}.png` });
  throw new Error('None of the selectors found: ' + selectors.join(', '));
}

// تابع برای کلیک ایمن روی عناصر
async function safeClick(page, selector, options = {}) {
  await page.evaluate(selector => {
    const element = document.querySelector(selector);
    if (element) {
      element.scrollIntoView({behavior: 'smooth', block: 'center'});
    }
  }, selector);
  
  await delay(1000);
  
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

// تابع جدید: تشخیص شناسه کامنت از طریق MutationObserver
async function detectCommentViaMutationObserver(page, text) {
  return page.evaluate((searchText) => {
    return new Promise((resolve) => {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === 1 && node.matches?.('ytd-comment-thread-renderer')) {
              const commentText = node.textContent || '';
              if (commentText.includes(searchText)) {
                const commentId = node.getAttribute('id')?.replace('comment-thread-', '');
                if (commentId) {
                  resolve(commentId);
                  observer.disconnect();
                  return;
                }
              }
            }
          }
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });
      
      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, 30000);
    });
  }, text.substring(0, 50));
}

// تابع بهبود یافته برای دریافت شناسه کامنت از شبکه
async function getCommentIdFromNetwork(page) {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 30000);
    
    const handler = async (response) => {
      try {
        const url = response.url();
        if (url.includes('/comment_service_ajax') || 
            url.includes('/create_comment') || 
            url.includes('/comment')) {
          
          const data = await response.json();
          
          // الگوهای جدید شناسایی شناسه کامنت
          const patterns = [
            data?.actions?.[0]?.createCommentAction?.contents?.commentThreadRenderer?.comment?.commentRenderer?.commentId,
            data?.response?.comment?.commentId,
            data?.comment?.commentId,
            data?.payload?.actions?.[0]?.createCommentAction?.commentCreateEntityKey,
            data?.frameworkUpdates?.entityBatchUpdate?.mutations?.[0]?.payload?.commentEntity?.key,
            data?.actions?.[0]?.addChatItemAction?.item?.liveChatTextMessageRenderer?.id
          ];

          for (const pattern of patterns) {
            if (pattern) {
              clearTimeout(timeout);
              page.off('response', handler);
              resolve(pattern);
              return;
            }
          }
        }
      } catch (e) {
        console.warn('Error processing network response:', e.message);
      }
    };
    
    page.on('response', handler);
  });
}

// تابع نهایی برای دریافت شناسه کامنت
async function getCommentId(page, commentText) {
  // روش 1: Mutation Observer (جدید و بسیار موثر)
  try {
    const commentId = await detectCommentViaMutationObserver(page, commentText);
    if (commentId) return commentId;
  } catch (e) {
    console.warn('⚠️ MutationObserver method failed:', e.message);
  }
  
  // روش 2: جستجو در شبکه
  try {
    const commentId = await getCommentIdFromNetwork(page);
    if (commentId) return commentId;
  } catch (e) {
    console.warn('⚠️ Network method failed:', e.message);
  }
  
  // روش 3: جستجوی مستقیم در DOM
  try {
    await page.waitForSelector('ytd-comment-thread-renderer, ytd-comment-renderer', { timeout: 30000 });
    
    const commentId = await page.evaluate((text) => {
      const comments = [
        ...document.querySelectorAll('ytd-comment-thread-renderer, ytd-comment-renderer')
      ];
      
      // جستجو بر اساس متن و حساب کاربری
      const matchingComment = comments.find(comment => {
        try {
          const content = comment.querySelector('#content-text')?.textContent?.trim() || '';
          const author = comment.querySelector('#author-text')?.textContent?.trim() || '';
          const currentUser = document.querySelector('#channel-name')?.textContent?.trim() || '';
          
          return content.includes(text.substring(0, 30)) && 
                 author === currentUser;
        } catch (e) {
          return false;
        }
      });
      
      return matchingComment?.getAttribute('id')?.replace('comment-', '') || 
             matchingComment?.getAttribute('data-comment-id') || 
             null;
    }, commentText);
    
    if (commentId) return commentId;
  } catch (e) {
    console.warn('⚠️ DOM search method failed:', e.message);
  }
  
  // روش 4: جستجو در localStorage
  try {
    const commentId = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.includes('commentId') || key.includes('comment_id')) {
          const value = localStorage.getItem(key);
          if (value && value.length > 10) return value;
        }
      }
      return null;
    });
    
    if (commentId) return commentId;
  } catch (e) {
    console.warn('⚠️ LocalStorage method failed:', e.message);
  }
  
  // روش 5: جستجو در محتوای HTML
  try {
    const commentId = await page.evaluate(() => {
      const html = document.documentElement.innerHTML;
      const regex = /"commentId":"(.*?)"/;
      const match = html.match(regex);
      return match ? match[1] : null;
    });
    
    if (commentId) return commentId;
  } catch (e) {
    console.warn('⚠️ HTML regex method failed:', e.message);
  }
  
  // روش 6: بررسی نوتیفیکیشن موفقیت‌آمیز
  try {
    const hasSuccess = await page.evaluate(() => {
      return !!document.querySelector('.ytp-toast-success');
    });
    
    if (hasSuccess) {
      console.log('✅ Comment posted successfully but ID not found');
      return 'success-no-id';
    }
  } catch (e) {
    console.warn('⚠️ Success notification check failed:', e.message);
  }
  
  await page.screenshot({ path: `comment_id_error_${Date.now()}.png` });
  throw new Error('Failed to get comment ID after 6 attempts');
}

// ارسال کامنت (نسخه پایدار نهایی)
export async function postComment(browser, cookie, videoId, text) {
  const page = await browser.newPage();
  try {
    // فعال‌سازی لاگ‌های دیباگ
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('response', res => console.log(`RESPONSE [${res.status()}] ${res.url()}`));
    page.on('requestfailed', req => console.error('REQUEST FAILED:', req.url(), req.failure()?.errorText));
    
    await page.setJavaScriptEnabled(true);
    await page.setExtraHTTPHeaders({ 
      'accept-language': 'en-US,en;q=0.9',
      'sec-ch-ua': '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"'
    });
    
    await setCookies(page, cookie);
    
    await page.goto(`https://www.youtube.com/watch?v=${videoId}`, {
      waitUntil: 'networkidle2',
      timeout: 120000
    });
    
    await checkForCaptcha(page);
    await delay(5000 + Math.random() * 5000);
    
    // اسکرول به بخش کامنت‌ها
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight * 0.7);
    });
    await delay(3000);
    
    await checkCommentsEnabled(page);
    
    // فعال‌سازی باکس کامنت
    const commentBoxSelector = await waitForSelectors(page, [
      '#placeholder-area',
      '#comments-container',
      'ytd-commentbox',
      'ytd-comment-simplebox-renderer'
    ], 30000);
    
    await safeClick(page, commentBoxSelector, { delay: 2000 });
    
    // تایپ کامنت
    const editableSelector = await waitForSelectors(page, [
      '#simplebox-placeholder',
      'yt-formatted-string#placeholder-area',
      'div#contenteditable-root'
    ], 30000);
    
    await safeClick(page, editableSelector, { delay: 1000 });
    
    for (const char of text) {
      await page.keyboard.type(char, { 
        delay: 50 + Math.random() * 150 
      });
      if (Math.random() > 0.8) await delay(100 + Math.random() * 400);
    }
    await delay(2000);
    
    // ارسال کامنت
    const submitButtonSelector = await waitForSelectors(page, [
      'ytd-button-renderer#submit-button',
      '#submit-button',
      'button[aria-label="Comment"]',
      'button[aria-label="نظر دادن"]',
      'button[aria-label="Комментировать"]',
      'button[aria-label="Comentar"]',
      'button[aria-label="टिप्पणी करें"]'
    ], 20000);
    
    await safeClick(page, submitButtonSelector, { delay: 3000 });
    
    // انتظار برای ثبت کامنت
    await delay(8000); // افزایش زمان انتظار
    
    // دریافت شناسه کامنت
    const commentId = await getCommentId(page, text);
    
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
      waitUntil: 'networkidle2',
      timeout: 60000
    });
    
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
      '#contenteditable-root.reply',
      '.ytd-commentbox',
      'div#contenteditable-root'
    ], 15000);
    
    await safeClick(page, replyBoxSelector, { delay: 1000 });
    
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
      'button[aria-label="Reply"]'
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

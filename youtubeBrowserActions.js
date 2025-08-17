import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { delay } from './utils.js';
import fs from 'fs';

// فعال‌سازی پلاگین‌های امنیتی
puppeteer.use(StealthPlugin());

// تنظیمات مرورگر
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
      await captureDebug(page, 'captcha_detected');
      throw new Error('CAPTCHA detected - manual intervention required');
    }
  }
}

// بررسی فعال بودن کامنت‌ها
async function checkCommentsEnabled(page) {
  const disabledSelectors = [
    '#message.ytd-comments-header-renderer',
    '.ytd-comments-header-renderer > .disabled-comments',
    'yt-formatted-string.comment-dialog-renderer-message'
  ];
  
  const disabledKeywords = [
    'disabled', 'off', 'غیرفعال', 'отключен', 'desactivado', 'अक्षम'
  ];
  
  for (const selector of disabledSelectors) {
    const element = await page.$(selector);
    if (element) {
      const message = await page.evaluate(el => el.textContent, element);
      if (disabledKeywords.some(keyword => message.toLowerCase().includes(keyword))) {
        await captureDebug(page, 'comments_disabled');
        throw new Error('Comments are disabled for this video');
      }
    }
  }
  
  return true;
}

// تابع کمکی برای انتظار برای سلکتورها
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
  
  await captureDebug(page, 'selector_not_found');
  throw new Error('None of the selectors found: ' + selectors.join(', '));
}

// تابع کلیک ایمن روی عناصر
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

// ================ سیستم لاگ‌گیری و دیباگ پیشرفته ================ //
const DEBUG_DIR = './debug_logs';

// ایجاد دایرکتوری لاگ‌ها
if (!fs.existsSync(DEBUG_DIR)) {
  fs.mkdirSync(DEBUG_DIR);
}

// تابع ذخیره لاگ‌ها
function saveLogEntry(logData) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logFileName = `${DEBUG_DIR}/debug_${timestamp}.json`;
  
  try {
    fs.writeFileSync(logFileName, JSON.stringify(logData, null, 2));
    return logFileName;
  } catch (e) {
    console.error('⚠️ Failed to save log file:', e);
    return null;
  }
}

// تابع ثبت عکس‌های دیباگ
async function captureDebug(page, context = 'debug') {
  const timestamp = Date.now();
  const screenshotPath = `${DEBUG_DIR}/${context}_${timestamp}.png`;
  
  try {
    await page.screenshot({ 
      path: screenshotPath,
      fullPage: true
    });
    return screenshotPath;
  } catch (e) {
    console.error(`⚠️ Failed to capture screenshot (${context}):`, e);
    return null;
  }
}

// تابع تشخیص موانع
async function detectBlockers(page) {
  return await page.evaluate(() => {
    const blockers = {};
    
    // تشخیص کپچا
    blockers.captcha = !!document.querySelector('div#captcha-container, iframe[src*="recaptcha"]');
    
    // تشخیص نیاز به لاگین
    blockers.loginRequired = !!document.querySelector('a[href*="/accounts.google.com/ServiceLogin"]');
    
    // تشخیص کوکی‌بار
    blockers.cookieConsent = !!document.querySelector('ytd-consent-bump-v2-lightbox');
    
    // تشخیص مدال‌ها
    blockers.modal = !!document.querySelector('ytd-popup-container, .overlay');
    
    // تشخیص خطاهای عمومی
    const errorMessages = [
      'برای نظر دادن وارد شوید',
      'sign in to comment',
      'comments are turned off',
      'نظرات غیرفعال شده‌اند',
      'unable to post comment',
      'error occurred'
    ];
    
    blockers.errors = [];
    const pageText = document.body.innerText.toLowerCase();
    errorMessages.forEach(msg => {
      if (pageText.includes(msg.toLowerCase())) {
        blockers.errors.push(msg);
      }
    });
    
    return blockers;
  });
}

// ================ سیستم ارسال و شناسایی کامنت ================ //
async function robustCommentPosting(page, submitButton, commentText) {
  const MAX_ATTEMPTS = 3;
  const logData = {
    startTime: new Date().toISOString(),
    videoUrl: page.url(),
    commentText,
    steps: [],
    finalResult: null
  };
  
  const logStep = (step, status, details = {}) => {
    const stepEntry = {
      timestamp: new Date().toISOString(),
      step,
      status,
      details
    };
    logData.steps.push(stepEntry);
    console.log(`[${step}] ${status}`, details);
  };
  
  // شمارش اولیه کامنت‌ها
  let initialCommentCount;
  try {
    initialCommentCount = await page.evaluate(() => {
      return document.querySelectorAll('ytd-comment-thread-renderer').length;
    });
    logStep('initial_comment_count', 'success', { count: initialCommentCount });
  } catch (e) {
    logStep('initial_comment_count', 'failed', { error: e.message });
    initialCommentCount = 0;
  }
  
  // تلاش‌های متوالی
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const attemptLog = {
      attempt,
      networkResponse: null,
      domResult: null,
      blockers: null,
      error: null
    };
    
    logStep('attempt_start', 'info', { attempt });
    
    try {
      // تشخیص موانع قبل از ارسال
      const preBlockers = await detectBlockers(page);
      if (Object.values(preBlockers).some(v => v === true || (Array.isArray(v) && v.length > 0))) {
        attemptLog.blockers = preBlockers;
        logStep('pre_blockers_detected', 'warning', preBlockers);
        await captureDebug(page, `pre_blockers_attempt_${attempt}`);
        
        // ذخیره لاگ و ادامه به تلاش بعدی
        logData.attempts = logData.attempts || [];
        logData.attempts.push(attemptLog);
        await delay(2000 * attempt);
        continue;
      }
      
      // تنظیم شنونده شبکه
      const networkPromise = page.waitForResponse(response => {
        const url = response.url();
        return [
          '/comment_service_ajax',
          '/youtubei/',
          '/comment/create_comment',
          '/comment_service'
        ].some(pattern => url.includes(pattern));
      }, { timeout: 15000 }).catch(() => null);
      
      // کلیک روی دکمه ارسال
      try {
        await submitButton.click({ delay: 100 });
        logStep('submit_click', 'success', { method: 'elementHandle' });
      } catch (clickError) {
        try {
          await page.evaluate(btn => btn.click(), submitButton);
          logStep('submit_click', 'success', { method: 'evaluate' });
        } catch (evaluateError) {
          logStep('submit_click', 'failed', { 
            elementHandleError: clickError.message,
            evaluateError: evaluateError.message
          });
          throw new Error('کلیک روی دکمه ارسال ناموفق بود');
        }
      }
      
      // انتظار برای نتایج
      const [networkResponse] = await Promise.all([
        networkPromise,
        page.waitForFunction(
          count => document.querySelectorAll('ytd-comment-thread-renderer').length > count,
          { timeout: 10000, polling: 500 },
          initialCommentCount
        ).catch(() => null)
      ]);
      
      // پردازش پاسخ شبکه
      if (networkResponse) {
        attemptLog.networkResponse = {
          url: networkResponse.url(),
          status: networkResponse.status(),
          headers: networkResponse.headers()
        };
        
        try {
          const responseBody = await networkResponse.text();
          attemptLog.networkResponse.body = responseBody.substring(0, 2000); // ذخیره بخشی از بدنه
          
          // استخراج شناسه کامنت
          const idMatch = responseBody.match(/"commentId"\s*:\s*"([^"]+)"/i) || 
                         responseBody.match(/"id"\s*:\s*"([A-Za-z0-9_-]{16,})"/i);
          
          if (idMatch && idMatch[1]) {
            logStep('comment_id_found', 'success', { 
              source: 'network', 
              commentId: idMatch[1],
              attempt
            });
            
            logData.finalResult = {
              status: 'success',
              commentId: idMatch[1],
              source: 'network',
              attempt
            };
            
            saveLogEntry(logData);
            return idMatch[1];
          }
        } catch (parseError) {
          logStep('network_parse_error', 'error', { 
            error: parseError.message,
            attempt
          });
        }
      } else {
        logStep('network_timeout', 'warning', { attempt });
      }
      
      // جستجو در DOM
      try {
        const commentId = await page.evaluate((text) => {
          const normalize = (s) => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();
          const targetText = normalize(text).substring(0, 60);
          
          const comments = Array.from(
            document.querySelectorAll('ytd-comment-thread-renderer')
          );
          
          // جستجو از جدیدترین کامنت
          for (let i = comments.length - 1; i >= 0; i--) {
            const comment = comments[i];
            const contentEl = comment.querySelector('#content-text, #content');
            if (!contentEl) continue;
            
            const contentText = normalize(contentEl.textContent);
            if (contentText.includes(targetText)) {
              // استخراج شناسه
              return comment.getAttribute('data-comment-id') || null;
            }
          }
          return null;
        }, commentText);
        
        if (commentId) {
          logStep('comment_id_found', 'success', { 
            source: 'dom', 
            commentId,
            attempt
          });
          
          logData.finalResult = {
            status: 'success',
            commentId,
            source: 'dom',
            attempt
          };
          
          saveLogEntry(logData);
          return commentId;
        }
        
        logStep('dom_search_failed', 'warning', { attempt });
        attemptLog.domResult = 'not_found';
      } catch (domError) {
        logStep('dom_search_error', 'error', { 
          error: domError.message,
          attempt
        });
        attemptLog.error = domError.message;
      }
      
      // تشخیص موانع پس از ارسال
      const postBlockers = await detectBlockers(page);
      if (Object.values(postBlockers).some(v => v === true || (Array.isArray(v) && v.length > 0))) {
        attemptLog.blockers = postBlockers;
        logStep('post_blockers_detected', 'warning', postBlockers);
        await captureDebug(page, `post_blockers_attempt_${attempt}`);
      }
      
      // استراتژی Fallback: آخرین کامنت
      try {
        const lastCommentId = await page.evaluate(() => {
          const lastComment = document.querySelector('ytd-comment-thread-renderer:last-child');
          return lastComment ? lastComment.getAttribute('data-comment-id') : null;
        });
        
        if (lastCommentId) {
          logStep('fallback_comment_id', 'warning', {
            source: 'fallback',
            commentId: lastCommentId,
            attempt
          });
          
          logData.finalResult = {
            status: 'fallback',
            commentId: lastCommentId,
            source: 'fallback',
            attempt
          };
          
          saveLogEntry(logData);
          return lastCommentId;
        }
      } catch (fallbackError) {
        logStep('fallback_failed', 'error', {
          error: fallbackError.message,
          attempt
        });
      }
      
    } catch (attemptError) {
      logStep('attempt_error', 'error', {
        attempt,
        error: attemptError.message
      });
      attemptLog.error = attemptError.message;
    } finally {
      // ذخیره اطلاعات دیباگ برای این تلاش
      logData.attempts = logData.attempts || [];
      logData.attempts.push(attemptLog);
      
      // عکس‌برداری پس از هر تلاش ناموفق
      if (attempt < MAX_ATTEMPTS) {
        await captureDebug(page, `attempt_${attempt}_debug`);
      }
      
      // تاخیر بین تلاش‌ها
      if (attempt < MAX_ATTEMPTS) {
        const waitTime = 3000 * attempt;
        logStep('attempt_delay', 'info', { waitTime });
        await delay(waitTime);
      }
    }
  }
  
  // تلاش‌ها ناموفق بودند
  await captureDebug(page, 'final_debug');
  
  // ثبت لاگ نهایی
  logData.finalResult = {
    status: 'failed',
    message: 'تمامی تلاش‌ها ناموفق بودند'
  };
  
  const logPath = saveLogEntry(logData);
  logStep('process_complete', 'error', {
    status: 'failed',
    logPath
  });
  
  throw new Error('Failed to post comment after all attempts');
}

// ================ تابع اصلی ارسال کامنت ================ //
export async function postComment(browser, cookie, videoId, text) {
  const page = await browser.newPage();
  const startTime = Date.now();
  
  try {
    // تنظیمات اولیه
    await page.setJavaScriptEnabled(true);
    await page.setExtraHTTPHeaders({ 
      'accept-language': 'en-US,en;q=0.9',
      'sec-ch-ua': '"Google Chrome";v="125", "Chromium";v="125", "Not.A/Brand";v="24"'
    });
    
    // ثبت رویداد شروع
    console.log(`📝 Starting comment process for video: ${videoId}`);
    console.log(`🔑 Using cookie: ${cookie.substring(0, 30)}...`);
    
    // تنظیم کوکی‌ها
    console.log('🍪 Setting cookies...');
    await setCookies(page, cookie);
    
    // بازکردن ویدیو
    const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
    console.log(`🌐 Navigating to: ${videoUrl}`);
    await page.goto(videoUrl, {
      waitUntil: 'networkidle2',
      timeout: 120000
    });
    
    // بررسی CAPTCHA
    console.log('🔍 Checking for CAPTCHA...');
    await checkForCaptcha(page);
    
    // تاخیر تصادفی
    const randomDelay = 3000 + Math.random() * 4000;
    console.log(`⏳ Random delay: ${Math.round(randomDelay)}ms`);
    await delay(randomDelay);
    
    // اسکرول به بخش کامنت‌ها
    console.log('🖱 Scrolling to comments section...');
    await page.evaluate(() => {
      const commentSection = document.querySelector('ytd-comments');
      if (commentSection) {
        commentSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.scrollBy(0, 200);
      } else {
        window.scrollBy(0, 1500);
      }
    });
    await delay(2000);
    
    // بررسی فعال بودن کامنت‌ها
    console.log('🔍 Checking if comments are enabled...');
    await checkCommentsEnabled(page);
    
    // فعال‌سازی باکس کامنت
    console.log('📝 Activating comment box...');
    const commentBoxSelector = await waitForSelectors(page, [
      '#placeholder-area',
      'ytd-commentbox',
      'ytd-comment-simplebox-renderer'
    ], 15000);
    
    await safeClick(page, commentBoxSelector, { delay: 1500 });
    console.log('✅ Comment box activated');
    
    // یافتن باکس متن
    console.log('⌨️ Finding text input field...');
    const editableSelector = await waitForSelectors(page, [
      '#contenteditable-root',
      'div#contenteditable-root',
      '[contenteditable="true"]'
    ], 10000);
    
    await safeClick(page, editableSelector, { delay: 1000 });
    console.log('✅ Text input field ready');
    
    // تایپ متن
    console.log(`⌨️ Typing comment (${text.length} characters)...`);
    for (const char of text) {
      await page.keyboard.type(char, { 
        delay: 30 + Math.random() * 120 
      });
      if (Math.random() > 0.85) await delay(50 + Math.random() * 300);
    }
    await delay(1000);
    console.log('✅ Comment text entered');
    
    // یافتن دکمه ارسال
    console.log('🔍 Finding submit button...');
    const submitButtonSelector = await waitForSelectors(page, [
      'ytd-button-renderer#submit-button',
      '#submit-button',
      'button[aria-label="Comment"]',
      'button[aria-label="نظر دادن"]',
      'yt-button-shape.button'
    ], 10000);
    
    const submitButton = await page.$(submitButtonSelector);
    if (!submitButton) {
      throw new Error('دکمه ارسال یافت نشد');
    }
    console.log('✅ Submit button found');
    
    // ارسال و شناسایی کامنت
    console.log('🚀 Posting comment and retrieving ID...');
    const commentId = await robustCommentPosting(page, submitButton, text);
    
    // محاسبه زمان اجرا
    const duration = (Date.now() - startTime) / 1000;
    console.log(`✅ Comment posted successfully! ID: ${commentId} (${duration.toFixed(1)}s)`);
    
    return commentId;
    
  } catch (error) {
    // ثبت خطا و لاگ‌گیری
    const duration = (Date.now() - startTime) / 1000;
    console.error(`❌ Critical error: ${error.message} (${duration.toFixed(1)}s)`);
    
    // ذخیره لاگ نهایی
    await captureDebug(page, 'critical_error');
    
    throw error;
  } finally {
    // بستن صفحه
    await page.close();
  }
}

// توابع دیگر (postReply, likeComment) بدون تغییر باقی می‌مانند
// ... 

// youtubeBrowserActions.js
import puppeteer from 'puppeteer';
import fs from 'fs/promises';

/**
 * Helper delay
 */
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Init puppeteer browser (call once)
 */
export async function initBrowser(opts = {}) {
  const defaultArgs = ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'];
  const browser = await puppeteer.launch({
    headless: opts.headless ?? true,
    args: opts.args ?? defaultArgs,
    defaultViewport: opts.viewport ?? { width: 1366, height: 768 }
  });
  return browser;
}

/**
 * Set cookies on page.
 * cookieInput can be:
 *  - JSON array string (exported by cookie extensions),
 *  - JS array/object (already parsed),
 *  - raw cookie header string "A=1; B=2;".
 * We normalize and call page.setCookie(...)
 */
export async function setCookiesOnPage(page, cookieInput) {
  // if path is file, read it
  if (typeof cookieInput === 'string' && cookieInput.trim().startsWith('file:')) {
    const path = cookieInput.replace(/^file:/, '');
    cookieInput = await fs.readFile(path, 'utf8');
  }

  let cookies = [];
  try {
    if (typeof cookieInput === 'string') {
      const s = cookieInput.trim();
      if (s.startsWith('[') || s.startsWith('{')) {
        // JSON
        const parsed = JSON.parse(s);
        if (Array.isArray(parsed)) {
          cookies = parsed.map(c => ({
            name: c.name,
            value: c.value,
            domain: c.domain?.replace(/^\./, '') || '.youtube.com',
            path: c.path || '/',
            expires: c.expirationDate || (c.expires || undefined),
            httpOnly: !!c.httpOnly,
            secure: !!c.secure,
          }));
        } else if (parsed.name && parsed.value) {
          cookies = [{
            name: parsed.name,
            value: parsed.value,
            domain: parsed.domain?.replace(/^\./, '') || '.youtube.com',
            path: parsed.path || '/',
            httpOnly: !!parsed.httpOnly,
            secure: !!parsed.secure,
          }];
        } else {
          // fallback: treat as raw header string
          throw new Error('json-not-cookie-array');
        }
      } else {
        // raw cookie header "A=1; B=2"
        const pairs = s.split(';').map(p => p.trim()).filter(Boolean);
        cookies = pairs.map(p => {
          const [name, ...rest] = p.split('=');
          return { name: name.trim(), value: rest.join('=').trim(), domain: '.youtube.com', path: '/' };
        });
      }
    } else if (Array.isArray(cookieInput)) {
      cookies = cookieInput.map(c => ({ name: c.name, value: c.value, domain: c.domain?.replace(/^\./, '') || '.youtube.com', path: c.path || '/' }));
    } else if (cookieInput && cookieInput.name) {
      cookies = [{ name: cookieInput.name, value: cookieInput.value, domain: cookieInput.domain?.replace(/^\./, '') || '.youtube.com', path: cookieInput.path || '/' }];
    }
  } catch (e) {
    // on parse error fallback to raw parse
    const raw = String(cookieInput || '');
    const pairs = raw.split(';').map(p => p.trim()).filter(Boolean);
    cookies = pairs.map(p => { const [name, ...rest] = p.split('='); return { name: name.trim(), value: rest.join('=').trim(), domain: '.youtube.com', path: '/' }; });
  }

  // ensure domains start with dot for setCookie
  cookies = cookies.map(c => {
    if (!c.domain.startsWith('.')) c.domain = '.' + c.domain;
    // puppeteer cookie expects expiry numeric seconds maybe; leave undefined for session cookies
    return c;
  });

  // set cookies
  await page.setCookie(...cookies);
}

/**
 * Robust selector helper to focus the comment box.
 * It tries several selectors and actions to focus and make contenteditable ready.
 */
async function focusCommentBox(page) {
  // try multiple approaches
  const attempts = [
    async () => {
      // click placeholder
      const placeholder = await page.$('ytd-comment-simplebox-renderer #placeholder-area');
      if (placeholder) { await placeholder.click({delay:50}); return true; }
      return false;
    },
    async () => {
      // click contenteditable if present
      const ce = await page.$('ytd-comment-simplebox-renderer #contenteditable-root, div#contenteditable-root[contenteditable="true"]');
      if (ce) { await ce.click({delay:50}); return true; }
      return false;
    },
    async () => {
      // fallback: click the comment box region
      const box = await page.$('ytd-comment-simplebox-renderer');
      if (box) { await box.click({delay:50}); return true; }
      return false;
    }
  ];

  for (const fn of attempts) {
    try {
      const ok = await fn();
      if (ok) {
        // small delay to allow editor to initialize
        await delay(600);
        return true;
      }
    } catch (e) { /* continue */ }
  }
  return false;
}

/**
 * Type the text into contenteditable reliably.
 * Uses evaluate for direct insertion if typing is flaky.
 */
async function enterCommentText(page, text) {
  const ceSelectors = [
    'ytd-comment-simplebox-renderer #contenteditable-root',
    'div#contenteditable-root[contenteditable="true"]',
    'ytd-commentbox #contenteditable-root'
  ];
  for (const sel of ceSelectors) {
    const el = await page.$(sel);
    if (!el) continue;
    try {
      // try typing with character delay to mimic human
      await el.focus();
      await page.keyboard.type(text, {delay: 30});
      return true;
    } catch (e) {
      // fallback: set innerText directly
      try {
        await page.evaluate((s, t) => {
          const el = document.querySelector(s);
          if (!el) return false;
          el.focus();
          el.innerText = t;
          // dispatch input events
          const ev = new InputEvent('input', { bubbles: true });
          el.dispatchEvent(ev);
          return true;
        }, sel, text);
        return true;
      } catch (ee) { /* continue */ }
    }
  }
  return false;
}

/**
 * Click submit — tries a few possible selectors
 */
async function clickSubmitButton(page) {
  // possible selectors for submit
  const submitSelectors = [
    'ytd-comment-simplebox-renderer #submit-button',
    'ytd-comment-simplebox-renderer tp-yt-paper-button#submit-button',
    'ytd-comment-simplebox-renderer yt-icon-button#submit-button',
    'ytd-commentbox #submit-button',
    'div#placeholder-area + div paper-button#submit-button'
  ];
  for (const sel of submitSelectors) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click({delay: 50});
        return true;
      }
    } catch (e) { /* ignore */ }
  }

  // fallback: find button by aria-label or text content "Comment" / localized may vary
  try {
    const btn = await page.$x("//yt-formatted-string[contains(translate(., 'COMMENT','comment'), 'comment')]/ancestor::button");
    if (btn && btn[0]) { await btn[0].click({delay:50}); return true; }
  } catch (e) { /* ignore */ }

  return false;
}

/**
 * postComment(browser, cookieInput, videoId, text, opts)
 * cookieInput: JSON string or raw cookie header or array
 * opts: { waitFor: ms, timeoutSelector: selector }
 */
export async function postComment(browser, cookieInput, videoId, text, opts = {}) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(opts.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });

    // set cookies (support file: path or json)
    await setCookiesOnPage(page, cookieInput);

    // go to video
    await page.goto(`https://www.youtube.com/watch?v=${videoId}`, { waitUntil: 'networkidle2', timeout: 45000 });

    // wait for comments area to load (comments are usually in #comments)
    // sometimes comments are lazy-loaded; scroll to forces load
    await page.evaluate(() => window.scrollBy(0, 800));
    await delay(900);
    // wait for simplebox or comments area
    try {
      await page.waitForSelector('ytd-comment-simplebox-renderer, #comments', { timeout: 15000 });
    } catch (e) {
      // comments may be disabled or blocked
      throw new Error('comments-area-not-found-or-disabled');
    }

    // focus comment box
    const ok = await focusCommentBox(page);
    if (!ok) throw new Error('failed-to-focus-comment-box');

    // enter text
    const entered = await enterCommentText(page, text);
    if (!entered) throw new Error('failed-to-enter-comment-text');

    // small human-like delay
    await delay(600 + Math.floor(Math.random() * 400));

    // click submit
    const clicked = await clickSubmitButton(page);
    if (!clicked) throw new Error('failed-to-click-submit');

    // wait a bit for comment to appear; check for new comment containing snippet of text
    const short = text.slice(0, 30).replace(/["'`]/g,'').trim();
    let success = false;
    const maxCheck = 10;
    for (let i=0;i<maxCheck;i++) {
      await delay(1000 + Math.random() * 700);
      // search for comment text in rendered comments
      const found = await page.evaluate((snippet) => {
        const nodes = Array.from(document.querySelectorAll('ytd-comment-thread-renderer,ytd-comment-renderer'));
        return nodes.some(n => n.innerText && n.innerText.includes(snippet));
      }, short);
      if (found) { success = true; break; }
    }

    if (!success) {
      // sometimes comments are published but not immediately visible; still treat as success if response status shows no dialog
      throw new Error('comment-not-confirmed-visible');
    }

    return true;
  } finally {
    try { await page.close(); } catch(_) {}
  }
}

/**
 * postReply: find parent comment by commentId or by snippet text and reply.
 * parentId: if you have commentId, pass it. If null, specify parentTextSnippet in opts.
 */
export async function postReply(browser, cookieInput, videoId, parentId, text, opts = {}) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(opts.userAgent);
    await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });
    await setCookiesOnPage(page, cookieInput);

    await page.goto(`https://www.youtube.com/watch?v=${videoId}`, { waitUntil: 'networkidle2', timeout: 45000 });
    await page.evaluate(() => window.scrollBy(0, 900));
    await delay(900);

    // try find comment element
    let replyButton = null;
    if (parentId) {
      // try attribute matching
      replyButton = await page.$(`[data-comment-id="${parentId}"] yt-button-renderer#reply-button, [data-comment-id="${parentId}"] #reply-button`);
    }

    if (!replyButton && opts.parentText) {
      // search by snippet text
      const parentText = opts.parentText;
      const elHandle = await page.$x(`//ytd-comment-thread-renderer[contains(., "${parentText}") or contains(., "${parentText.slice(0,20)}")]`);
      if (elHandle && elHandle[0]) {
        // find reply button inside it
        try {
          replyButton = await elHandle[0].$('ytd-button-renderer#reply-button, #reply-button, tp-yt-paper-button[aria-label*="Reply"]');
        } catch (e) {}
      }
    }

    if (!replyButton) {
      // fallback: open first reply button (user may want to reply top-level)
      try {
        const all = await page.$$('ytd-comment-thread-renderer ytd-button-renderer#reply-button, ytd-comment-thread-renderer #reply-button');
        if (all && all[0]) replyButton = all[0];
      } catch (e) {}
    }

    if (!replyButton) throw new Error('reply-button-not-found');

    await replyButton.click({ delay: 100 });
    await delay(700);

    // find reply editor under that thread
    // wait for reply editor contenteditable
    await page.waitForSelector('div#contenteditable-root[contenteditable="true"]', { timeout: 8000 });

    const typed = await enterCommentText(page, text);
    if (!typed) throw new Error('failed-to-enter-reply-text');

    await delay(500 + Math.random()*400);
    const clicked = await clickSubmitButton(page);
    if (!clicked) throw new Error('failed-to-click-submit-reply');

    // wait for reply to appear
    const snippet = text.slice(0, 30);
    let ok = false;
    for (let i=0;i<12;i++) {
      await delay(800);
      const found = await page.evaluate((s) => {
        const nodes = Array.from(document.querySelectorAll('ytd-comment-renderer'));
        return nodes.some(n => n.innerText && n.innerText.includes(s));
      }, snippet);
      if (found) { ok = true; break; }
    }
    if (!ok) throw new Error('reply-not-confirmed-visible');

    return true;
  } finally {
    try { await page.close(); } catch(_) {}
  }
}

/**
 * likeComment: find comment by id or snippet and click like button
 */
export async function likeComment(browser, cookieInput, videoId, commentIdOrSnippet, opts = {}) {
  const page = await browser.newPage();
  try {
    await page.setUserAgent(opts.userAgent);
    await page.setExtraHTTPHeaders({ 'accept-language': 'en-US,en;q=0.9' });
    await setCookiesOnPage(page, cookieInput);

    await page.goto(`https://www.youtube.com/watch?v=${videoId}`, { waitUntil: 'networkidle2', timeout: 45000 });
    await page.evaluate(() => window.scrollBy(0, 800));
    await delay(900);

    // find comment by data-comment-id
    let likeBtn = null;
    if (commentIdOrSnippet && commentIdOrSnippet.startsWith('U')) {
      likeBtn = await page.$(`[data-comment-id="${commentIdOrSnippet}"] #vote-like, [data-comment-id="${commentIdOrSnippet}"] tp-yt-paper-icon-button#like-button`);
    }
    if (!likeBtn) {
      // search by snippet text
      const snippet = commentIdOrSnippet && commentIdOrSnippet.length > 0 ? commentIdOrSnippet : null;
      if (snippet) {
        const el = await page.$x(`//ytd-comment-renderer[contains(., "${snippet}") or contains(., "${snippet.slice(0,20)}")]`);
        if (el && el[0]) {
          // try find like button inside it
          try {
            likeBtn = await el[0].$('ytd-toggle-button-renderer #button, #vote-like, tp-yt-paper-icon-button');
          } catch(e){}
        }
      }
    }

    if (!likeBtn) {
      // fallback: like first comment's like button
      const all = await page.$$('ytd-comment-renderer ytd-toggle-button-renderer #button, ytd-comment-renderer #vote-like');
      if (all && all[0]) likeBtn = all[0];
    }

    if (!likeBtn) throw new Error('like-button-not-found');

    await likeBtn.click({ delay: 100 });
    await delay(600 + Math.random() * 400);
    return true;
  } finally {
    try { await page.close(); } catch(_) {}
  }
}

const chromium = require('chrome-aws-lambda');
const fs = require('fs');
const path = require('path');

(async () => {
  const likesFile = path.join(__dirname, '../likes.json');
  const data = JSON.parse(fs.readFileSync(likesFile, 'utf-8'));
  const operations = data.comments
    .flatMap(item => {
      // بازسازی آرایه عملیات
      const ops = [];
      for (let i = item.likedSoFar - item.totalLikes; i < 0; i++) { }
      return [];
    });

  // اگر عملیات در args بود
  const input = process.argv[2];
  const ops = input
    ? JSON.parse(fs.readFileSync(path.join(__dirname, '..', input)))
    : operations;

  if (ops.length === 0) {
    console.log('No like operations.');
    return;
  }

  const browser = await chromium.puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath,
    headless: chromium.headless,
  });
  const page = await browser.newPage();

  // TODO: ابتدا لاگین با YOUTUBE_USERS[accountIndex]
  // این بخش بسته به روش لاگین شماست (کوکی یا OAuth UI)

  for (const op of ops) {
    const { commentId, accountIndex } = op;
    // URL صفحه ویدیو یا لینک کامنت
    const url = `https://www.youtube.com/watch?v=${commentId.videoId}&lc=${commentId}`;
    await page.goto(url, { waitUntil: 'networkidle2' });
    // کلیک روی دکمه لایک
    await page.click('button[aria-label*="like this comment"]');
    console.log(`Liked comment ${commentId} by account ${accountIndex}`);
  }

  await browser.close();
})();
